/**
 * Minimal Node server to persist and serve XML files for the app.
 * No external dependencies required (uses built-in http/fs/url).
 *
 * Endpoints:
 *  - GET  /api/definitions                      -> data/cfglimitsdefinition.xml
 *  - PUT  /api/definitions                      -> write body to cfglimitsdefinition.xml
 *  - GET  /api/types/:group/:file               -> data/db/types/:group/:file.xml
 *  - PUT  /api/types/:group/:file               -> write body to data/db/types/:group/:file.xml
 *
 * Configure base data directory via DATA_DIR env (default: ./data).
 *
 * Start: node server/index.js
 */

import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {mkdir, readFile, stat, appendFile, readdir, cp, rm, rename, open} from 'node:fs/promises';
import crypto from 'node:crypto';
import moment from 'moment';
import * as ingest from './ingest-store.js';
import * as history from './history-store.js';
import {simplifyToBudget} from './simplify-path.js';
import * as admImport from './adm-import.js';
import {
    createDayClock, localFields, wallToMs, normalizeTimeZone, hostTimeZone,
} from './log-clock.js';
import * as cftoolsConfig from './cftools-config.js';
import * as cftools from './cftools-client.js';
import * as cftoolsService from './cftools-service.js';
import {isAllowedSpawnableFileName} from './spawnable-files.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// eslint-disable-next-line no-undef
const PORT = Number(process.env.PORT || 4317);

// eslint-disable-next-line no-undef
const IS_DEV = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
const TEST_PROFILE_ID = 'example-dev-data';

const PROFILES_FILE = resolve(join(__dirname, 'profiles.json'));
let profiles = [];

// Legacy global loadouts file. Loadouts are now stored per-map under
// mpmissions/<missionName>/.lootmaster/loadouts.json (see getPaths().loadoutsPath); this file is
// retained ONLY as a seed source: the first time a map's loadouts file is accessed and missing,
// its contents are copied in. It is never written to anymore — it stays as an untouched backup.
const LEGACY_LOADOUTS_FILE = resolve(join(__dirname, 'loadouts.json'));
// Read-modify-write on each map's loadouts.json; writes are serialized per target path through
// these chains so that overlapping saves (e.g. a bulk import firing many PUTs in quick succession)
// can't lose updates. Keyed by absolute target path so different maps serialize independently.
const loadoutsWriteChains = new Map();

const KNOWN_ADDONS = [
    { 
        id: 'deerisle', 
        name: 'Deerisle',
        probes: [
            { type: 'profile', folder: 'Deerisle' }
        ]
    },
    {
        id: 'expansion',
        name: 'Expansion',
        probes: [
            { type: 'profile', folder: 'ExpansionMod' },
            { type: 'mission', folder: 'expansion' }
        ]
    }
];

async function getDetectedAddons(serverPath, missionName) {
    if (!serverPath) return [];
    const detected = [];
    for (const addon of KNOWN_ADDONS) {
        let isDetected = false;
        for (const probe of addon.probes) {
            try {
                let checkPath;
                if (probe.type === 'profile') {
                    checkPath = join(serverPath, 'profiles', probe.folder);
                } else if (probe.type === 'mission' && missionName) {
                    checkPath = join(serverPath, 'mpmissions', missionName, probe.folder);
                }
                
                if (checkPath) {
                    const s = await stat(checkPath);
                    if (s.isDirectory()) {
                        isDetected = true;
                        break;
                    }
                }
            } catch {
                // ignore
            }
        }
        if (isDetected) {
            detected.push(addon.id);
        }
    }
    return detected;
}

async function loadProfiles() {
    try {
        const data = await readFile(PROFILES_FILE, 'utf8');
        profiles = JSON.parse(data);
    } catch {
        profiles = [];
        await saveProfiles();
    }

    if (IS_DEV) {
        const testPath = resolve(join(__dirname, '..', 'example dayz server directory'));
        try {
            await stat(testPath);
            if (!profiles.some(p => p.id === TEST_PROFILE_ID)) {
                // Prepend to profiles list so it's easily visible
                profiles.unshift({
                    id: TEST_PROFILE_ID,
                    name: 'Example Server (Dev Data)',
                    serverPath: testPath,
                    missionName: 'empty.deerisle'
                });
                console.log(`[DEV] Injected test profile: ${testPath}`);
            }
        } catch {
            console.warn(`[DEV] Dev mode active but test data directory not found at ${testPath}`);
        }
    }
}

async function saveProfiles() {
    const toSave = profiles.filter(p => p.id !== TEST_PROFILE_ID);
    await writeFileAtomic(PROFILES_FILE, JSON.stringify(toSave, null, 2));
}

// Load one map's loadout list from `target`. On a missing/corrupt file, seed it from the legacy
// global loadouts file (if present) so every existing map inherits the old shared library on first
// access; the seed write goes through the per-path chain to avoid a double-seed race between
// concurrent GETs. Returns [] when neither the target nor the legacy file yields valid JSON.
async function loadLoadouts(target) {
    try {
        return JSON.parse(await readValidJsonFile(target));
    } catch {
        // Target missing or corrupt — attempt a one-time seed from the legacy global file.
        let seed;
        try {
            seed = JSON.parse(await readFile(LEGACY_LOADOUTS_FILE, 'utf8'));
        } catch {
            return [];
        }
        if (!Array.isArray(seed)) return [];
        await enqueueLoadoutWrite(target, async () => {
            // Re-check under the chain: another request may have seeded/written since we missed.
            try {
                await readValidJsonFile(target);
                return; // already present — don't clobber
            } catch { /* still missing/corrupt — write the seed */ }
            await writeFileAtomic(target, JSON.stringify(seed, null, 2));
        });
        return seed;
    }
}

// Serialize `work` behind any in-flight write for `target`. The returned promise resolves/rejects
// for this specific unit of work, while the stored chain swallows rejections so a single failed
// write never blocks later ones.
function enqueueLoadoutWrite(target, work) {
    const prev = loadoutsWriteChains.get(target) || Promise.resolve();
    const run = prev.then(work);
    loadoutsWriteChains.set(target, run.catch(() => {}));
    return run;
}

// Apply `mutator` to `target`'s current list and persist the result, serialized per target path.
function mutateLoadouts(target, mutator) {
    return enqueueLoadoutWrite(target, async () => {
        const list = await loadLoadouts(target);
        const next = mutator(list);
        await writeFileAtomic(target, JSON.stringify(next, null, 2));
        return next;
    });
}

// Ensure profiles are loaded on start
await loadProfiles();
// CF Tools Cloud credentials + per-profile server bindings (server/.cache/cftools.json)
await cftoolsConfig.loadConfig();

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS,DELETE',
        'Access-Control-Allow-Headers': 'Content-Type, X-Editor-ID, X-Profile-ID',
        // Custom diagnostic headers are invisible to cross-origin fetch() unless exposed
        'Access-Control-Expose-Headers': 'X-Adm-Files-Found, X-Adm-Files-Dated, X-Adm-Lines-In-Range, X-Adm-Match-Count, X-Adm-Nearest-Distance',
    };
}

function send(res, status, body, headers = {}) {
    res.writeHead(status, {...headers, ...corsHeaders()});
    res.end(body);
}

function isSafeName(s) {
    // allow letters, numbers, dash, underscore and dot (for file base we add .xml separately)
    return typeof s === 'string' && /^[A-Za-z0-9._-]+$/.test(s);
}

/**
 * Which timezone a profile's game server writes its logs in.
 *
 * DayZ logs a bare wall clock, so this is the only thing that turns a log line
 * into a moment. It used to be hardcoded to UTC+10, which is wrong for half the
 * year anywhere that observes daylight saving — Australia/Sydney is on AEDT
 * (+11:00) from October to April. Configured per profile because it is a
 * property of the game server, not of this machine.
 */
function logTimeZoneFor(profile) {
    return normalizeTimeZone(profile?.logTimeZone)
        // eslint-disable-next-line no-undef
        || normalizeTimeZone(process.env.LOG_TIMEZONE)
        || hostTimeZone;
}

/** The datetime formats the log-query UI sends. Wall clock only — no zone. */
const SERVER_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Read an operator-typed datetime as the game server's local time.
 *
 * The picker shows, and the operator thinks in, the times printed in the logs —
 * so the range they type has to be resolved through the same zone the logs are
 * read in, or a search misses the first or last hour of what it should return.
 * Returns epoch ms, or null if the string is not one of the accepted shapes.
 */
function parseServerLocal(s, timeZone) {
    const m = SERVER_LOCAL_RE.exec(typeof s === 'string' ? s.trim() : '');
    if (!m) return null;
    return wallToMs({
        y: Number(m[1]), mon: Number(m[2]) - 1, d: Number(m[3]),
        h: Number(m[4] || 0), mi: Number(m[5] || 0), s: Number(m[6] || 0),
    }, timeZone);
}

/** An instant as the server's local clock would have shown it, for headers and filenames. */
function serverLocalParts(ms, timeZone) {
    const f = localFields(ms, timeZone);
    const p = (n) => String(n).padStart(2, '0');
    const date = `${f.y}-${p(f.mon + 1)}-${p(f.d)}`;
    return { date, time: `${p(f.h)}:${p(f.mi)}:${p(f.s)}`, stamp: `${date}_${p(f.h)}-${p(f.mi)}-${p(f.s)}` };
}

function getPaths(profile) {
    if (!profile) return null;
    const { serverPath, missionName } = profile;
    const missionPath = join(serverPath, 'mpmissions', missionName);
    const profilesPath = join(serverPath, 'profiles');

    return {
        defsPath: join(missionPath, 'cfglimitsdefinition.xml'),
        economyCorePath: join(missionPath, 'cfgeconomycore.xml'),
        marketDirPath: join(profilesPath, 'ExpansionMod', 'Market'),
        traderZonesDirPath: join(missionPath, 'expansion', 'traderzones'),
        tradersDirPath: join(missionPath, 'expansion', 'traders'),
        traderProfilesDirPath: join(profilesPath, 'ExpansionMod', 'Traders'),
        airdropSettingsPath: join(profilesPath, 'ExpansionMod', 'Settings', 'AirdropSettings.json'),
        missionSettingsPath: join(profilesPath, 'ExpansionMod', 'Settings', 'MissionSettings.json'),
        territorySettingsPath: join(profilesPath, 'ExpansionMod', 'Settings', 'TerritorySettings.json'),
        baseBuildingSettingsPath: join(missionPath, 'expansion', 'settings', 'BaseBuildingSettings.json'),
        airdropMissionsDirPath: join(missionPath, 'expansion', 'missions'),
        airdropLocationsPath: join(missionPath, '.lootmaster', 'airdrop-locations.json'),
        airdropLootListsPath: join(missionPath, '.lootmaster', 'airdrop-loot-lists.json'),
        loadoutsPath: join(missionPath, '.lootmaster', 'loadouts.json'),
        dbDirPath: join(missionPath, 'db'),
        logsDirPath: join(serverPath, 'log_storage'),
        expansionLogsDirPath: join(profilesPath, 'ExpansionMod', 'Logs'),
        // Carried alongside the paths because every log reader needs it to make
        // sense of the files it finds there.
        logTimeZone: logTimeZoneFor(profile),
        missionPath,
        profilesPath
    };
}

async function getSnapshotPaths(profileId) {
    const profile = profiles.find(p => String(p.id).toLowerCase() === String(profileId).toLowerCase());
    if (!profile) return { snapshotDir: null, paths: null };
    const paths = getPaths(profile);
    const snapshotDir = join(paths.missionPath, '.lootmaster', 'snapshots');
    return { snapshotDir, paths };
}

async function internalCreateSnapshot(profileId, name, description, editorId) {
    const { snapshotDir, paths } = await getSnapshotPaths(profileId);
    if (!paths) throw new Error('Profile not found');

    const snapshotId = crypto.randomUUID();
    const targetDir = join(snapshotDir, snapshotId);
    await mkdir(targetDir, { recursive: true });

    // Files to copy from mission root
    const filesToCopy = [
        'cfgeconomycore.xml',
        'cfglimitsdefinition.xml',
        'cfgspawnabletypes.xml',
        'cfgrandompresets.xml'
    ];

    for (const f of filesToCopy) {
        try {
            const src = join(paths.missionPath, f);
            await stat(src);
            await cp(src, join(targetDir, f));
        } catch { /* ignore if file doesn't exist */ }
    }

    // Copy db directory
    try {
        const dbSrc = join(paths.missionPath, 'db');
        await stat(dbSrc);
        await cp(dbSrc, join(targetDir, 'db'), { recursive: true });
    } catch { /* ignore */ }

    // Also include Expansion configs if they exist in the mission
    try {
        const expSrc = join(paths.missionPath, 'expansion');
        await stat(expSrc);
        await cp(expSrc, join(targetDir, 'expansion'), { recursive: true });
    } catch { /* ignore */ }

    // Copy Expansion Market and Trader Profiles if they exist (outside mission folder)
    try {
        await stat(paths.marketDirPath);
        await cp(paths.marketDirPath, join(targetDir, 'ExpansionMod', 'Market'), { recursive: true });
    } catch { /* ignore */ }
    try {
        await stat(paths.traderProfilesDirPath);
        await cp(paths.traderProfilesDirPath, join(targetDir, 'ExpansionMod', 'Traders'), { recursive: true });
    } catch { /* ignore */ }

    const metadata = {
        id: snapshotId,
        name,
        description,
        timestamp: new Date().toISOString(),
        editorId
    };

    await writeFileAtomic(join(targetDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
    return metadata;
}

async function removeItemFromMarketplaceCompletely(className, paths) {
    const classNameLower = className.toLowerCase();
    const marketDir = paths.marketDirPath;
    const traderZonesDir = paths.traderZonesDirPath;

    const report = {
        marketFiles: 0,
        traderZoneFiles: 0,
        traderFiles: 0
    };

    // 1. Remove from all Market category files
    try {
        const marketFiles = await readdir(marketDir);
        for (const file of marketFiles) {
            if (!file.toLowerCase().endsWith('.json')) continue;
            const filePath = join(marketDir, file);
            const content = await readFile(filePath, 'utf8');
            let json;
            try {
                json = JSON.parse(content);
            } catch { continue; }

            if (json && Array.isArray(json.Items)) {
                let changed = false;
                const initialLen = json.Items.length;
                json.Items = json.Items.filter(it => (it.ClassName || '').toLowerCase() !== classNameLower);
                if (json.Items.length !== initialLen) {
                    changed = true;
                }

                // Also remove from Variants and SpawnAttachments of other items
                for (const item of json.Items) {
                    if (Array.isArray(item.Variants)) {
                        const vLen = item.Variants.length;
                        item.Variants = item.Variants.filter(v => (v || '').toLowerCase() !== classNameLower);
                        if (item.Variants.length !== vLen) {
                            changed = true;
                        }
                    }
                    if (Array.isArray(item.SpawnAttachments)) {
                        const aLen = item.SpawnAttachments.length;
                        item.SpawnAttachments = item.SpawnAttachments.filter(a => (a || '').toLowerCase() !== classNameLower);
                        if (item.SpawnAttachments.length !== aLen) {
                            changed = true;
                        }
                    }
                }

                if (changed) {
                    await writeFileAtomic(filePath, JSON.stringify(json, null, 4) + '\n');
                    report.marketFiles++;
                }
            }
        }
    } catch (e) {
        console.error('Error removing from market files:', e);
    }

    // 2. Remove from all Trader Zone files
    try {
        const tzFiles = await readdir(traderZonesDir);
        for (const file of tzFiles) {
            if (!file.toLowerCase().endsWith('.json')) continue;
            const filePath = join(traderZonesDir, file);
            const content = await readFile(filePath, 'utf8');
            let json;
            try {
                json = JSON.parse(content);
            } catch { continue; }

            let changed = false;
            if (json && typeof json === 'object') {
                // Check top-level
                for (const key of Object.keys(json)) {
                    if (key.toLowerCase() === classNameLower) {
                        delete json[key];
                        changed = true;
                    }
                }
                // Check "Stock" object (common in Expansion Trader Zones)
                if (json.Stock && typeof json.Stock === 'object' && !Array.isArray(json.Stock)) {
                    for (const key of Object.keys(json.Stock)) {
                        if (key.toLowerCase() === classNameLower) {
                            delete json.Stock[key];
                            changed = true;
                        }
                    }
                }
            }

            if (changed) {
                await writeFileAtomic(filePath, JSON.stringify(json, null, 4) + '\n');
                report.traderZoneFiles++;
            }
        }
    } catch (e) {
        console.error('Error removing from trader zone files:', e);
    }

    // 3. Remove from all Trader profile files
    try {
        const traderDir = paths.traderProfilesDirPath;
        const traderFiles = await readdir(traderDir);
        for (const file of traderFiles) {
            if (!file.toLowerCase().endsWith('.json')) continue;
            const filePath = join(traderDir, file);
            const content = await readFile(filePath, 'utf8');
            let json;
            try {
                json = JSON.parse(content);
            } catch { continue; }

            let changed = false;
            if (json && typeof json === 'object') {
                // Check "Items" object (common in Expansion Trader profiles)
                if (json.Items && typeof json.Items === 'object' && !Array.isArray(json.Items)) {
                    for (const key of Object.keys(json.Items)) {
                        if (key.toLowerCase() === classNameLower) {
                            delete json.Items[key];
                            changed = true;
                        }
                    }
                }
            }

            if (changed) {
                await writeFileAtomic(filePath, JSON.stringify(json, null, 4) + '\n');
                report.traderFiles++;
            }
        }
    } catch (e) {
        console.error('Error removing from trader files:', e);
    }

    return report;
}

const groupFolderCaches = new Map();
const groupFilesCaches = new Map();
const groupSpawnableFilesCaches = new Map();

async function getGroupFolderMap(profile, paths) {
    let cache = groupFolderCaches.get(profile.id);
    if (cache) return cache;
    await loadEconomyCoreCaches(profile, paths);
    return groupFolderCaches.get(profile.id) || {};
}

async function getGroupFilesMap(profile, paths) {
    let cache = groupFilesCaches.get(profile.id);
    if (cache) return cache;
    await loadEconomyCoreCaches(profile, paths);
    return groupFilesCaches.get(profile.id) || {};
}

async function getGroupSpawnableFilesMap(profile, paths) {
    let cache = groupSpawnableFilesCaches.get(profile.id);
    if (cache) return cache;
    await loadEconomyCoreCaches(profile, paths);
    return groupSpawnableFilesCaches.get(profile.id) || {};
}

async function loadEconomyCoreCaches(profile, paths) {
    const folderCache = {};
    const filesCache = {};
    const spawnableFilesCache = {};
    groupFolderCaches.set(profile.id, folderCache);
    groupFilesCaches.set(profile.id, filesCache);
    groupSpawnableFilesCaches.set(profile.id, spawnableFilesCache);
    try {
        const xml = await readFile(paths.economyCorePath, 'utf8');
        // Match each <ce folder="...">...</ce>
        const ceRe = /<ce\b[^>]*\bfolder="([^"]+)"[^>]*>([\s\S]*?)<\/ce>/gi;
        let ceMatch;
        while ((ceMatch = ceRe.exec(xml)) !== null) {
            const folder = ceMatch[1];

            if (!folder) continue;
            const parts = folder.split('/').filter(Boolean);
            const group = parts[parts.length - 1];
            if (!group) continue;
            if (!folderCache[group]) folderCache[group] = folder;
            const content = ceMatch[2] || '';
            // Collect <file name="..." type="types"/> or type="spawnabletypes"
            const fileRe = /<file\b[^>]*\bname="([^"]+)"[^>]*\btype="([^"]+)"[^>]*\/?>/gi;
            let fMatch;
            const files = [];
            const spawnableFiles = [];
            while ((fMatch = fileRe.exec(content)) !== null) {
                const name = fMatch[1];
                const type = (fMatch[2] || '').trim().toLowerCase();
                if (name && type === 'types') files.push(name);
                if (name && type === 'spawnabletypes') spawnableFiles.push(name);
            }
            if (files.length) filesCache[group] = files;
            if (spawnableFiles.length) spawnableFilesCache[group] = spawnableFiles;
        }
    } catch {
        // leave caches as empty objects if read fails
    }
}

async function getDeclaredGroupFolder(profile, paths, group) {
    const map = await getGroupFolderMap(profile, paths);
    return map[group] || null;
}

async function getDeclaredFileName(profile, paths, group, fileBase) {
    const filesMap = await getGroupFilesMap(profile, paths);
    const declared = filesMap[group] || [];
    const match = declared.find(n => n.replace(/\.xml$/i, '').toLowerCase() === String(fileBase).toLowerCase());
    return match || null;
}

async function declaredTypesFilePath(profile, paths, group, fileBase) {
    if (group === 'vanilla') {
        return join(paths.dbDirPath, 'types.xml');
    }
    if (group === 'vanilla_overrides') {
        return join(paths.dbDirPath, 'vanilla_overrides', `${fileBase}.xml`);
    }
    const folder = await getDeclaredGroupFolder(profile, paths, group);
    if (!folder) return null;
    const declaredName = await getDeclaredFileName(profile, paths, group, fileBase);
    if (!declaredName) return null;
    return join(paths.missionPath, folder, declaredName);
}

async function declaredGroupDir(profile, paths, group) {
    if (group === 'vanilla') return paths.dbDirPath;
    if (group === 'vanilla_overrides') return join(paths.dbDirPath, 'vanilla_overrides');
    const folder = await getDeclaredGroupFolder(profile, paths, group);
    return folder ? join(paths.missionPath, folder) : null;
}

async function firstExistingPath(paths) {
    for (const target of paths) {
        try {
            await stat(target);
            return target;
        } catch {
            // try next candidate
        }
    }
    return paths[0] || null;
}

/**
 * Whether `fileName` may be read/written as a spawnabletypes file of `group`, per the
 * declarations in cfgeconomycore.xml. See server/spawnable-files.js for the rules.
 * @returns {Promise<boolean>}
 */
async function isSpawnableFileNameAllowed(profile, paths, group, fileName) {
    const spawnableMap = await getGroupSpawnableFilesMap(profile, paths);
    const typesMap = await getGroupFilesMap(profile, paths);
    return isAllowedSpawnableFileName({
        group,
        fileName,
        declaredSpawnable: spawnableMap[group] || [],
        declaredTypes: typesMap[group] || []
    });
}

async function spawnableTypesFilePath(profile, paths, group, fileName = null) {
    if (group === '__root' || group === 'vanilla' || group === 'vanilla_overrides') {
        if (fileName) {
            return join(paths.missionPath, fileName);
        }
        return firstExistingPath([
            join(paths.missionPath, 'cfgspawnabletypes.xml'),
            join(paths.missionPath, 'cfgspawnabletype.xml')
        ]);
    }

    const folder = await getDeclaredGroupFolder(profile, paths, group);

    if (fileName) {
        if (folder) {
            return join(paths.missionPath, folder, fileName);
        }
    }

    const spawnableFilesMap = await getGroupSpawnableFilesMap(profile, paths);
    const declaredSpawnable = spawnableFilesMap[group] || [];
    if (declaredSpawnable.length > 0) {
        if (folder) {
            return join(paths.missionPath, folder, declaredSpawnable[0]);
        }
    }

    const dir = await declaredGroupDir(profile, paths, group);
    return dir ? firstExistingPath([
        join(dir, 'spawnabletypes.xml'),
        join(dir, 'cfgspawnabletypes.xml'),
        join(dir, 'cfgspawnabletype.xml')
    ]) : null;
}

async function ensureSpawnableTypeFileInEconomyCore(profile, paths, group, fileName) {
    const economyCore = paths.economyCorePath;
    try {
        let xml = await readFile(economyCore, 'utf8');
        const folder = await getDeclaredGroupFolder(profile, paths, group);
        if (!folder) return;

        // Escape folder name for regex if it contains special chars
        const escapedFolder = folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Find the specific ce block for this folder
        const ceRe = new RegExp(`(<ce\\s+folder="${escapedFolder}"[^>]*>)([\\s\\S]*?)(<\\/ce>)`, 'i');
        const match = xml.match(ceRe);
        if (!match) return;

        const [full, openTag, inner, closeTag] = match;
        
        // Check if file entry already exists in this ce block
        const fileRe = new RegExp(`<file\\b[^>]*\\bname="${fileName}"[^>]*\\btype="spawnabletypes"[^>]*\\/?>`, 'i');
        if (fileRe.test(inner)) return;

        const insertion = `\n        <file name="${fileName}" type="spawnabletypes" />`;
        
        // Try to find where to insert. If there are existing <file> tags, insert after the last one.
        // Otherwise insert at the end of the block.
        let newInner = inner;
        const lastFileMatch = Array.from(inner.matchAll(/<file\b[^>]*\/>/gi)).pop();
        if (lastFileMatch) {
            const lastFileIndex = lastFileMatch.index + lastFileMatch[0].length;
            newInner = inner.substring(0, lastFileIndex) + insertion + inner.substring(lastFileIndex);
        } else {
            newInner = inner.trimEnd() + insertion + '\n    ';
        }

        const newXml = xml.replace(full, openTag + newInner + closeTag);
        await writeFileAtomic(economyCore, newXml);
        
        // Clear caches to force reload
        groupFolderCaches.delete(profile.id);
        groupFilesCaches.delete(profile.id);
        groupSpawnableFilesCaches.delete(profile.id);
    } catch (e) {
        console.error('Failed to update economycore:', e);
    }
}

/**
 * Ensure cfgeconomycore.xml declares `folder` with the given files.
 * Unlike ensureSpawnableTypeFileInEconomyCore, this also creates a brand-new
 * <ce folder="..."> block when one does not exist yet (the new-group path).
 * `files` is an array of { name, type } e.g.
 *   [{name:'types.xml', type:'types'}, {name:'spawnabletypes.xml', type:'spawnabletypes'}]
 */
async function ensureTypesGroupInEconomyCore(profile, paths, folder, files) {
    const economyCore = paths.economyCorePath;
    let xml;
    let fromDisk = true;
    try {
        xml = await readFile(economyCore, 'utf8');
        if (!String(xml || '').trim()) throw new Error('empty');
    } catch {
        // File missing/empty: materialize from filesystem scan first, since the
        // GET route synthesizes on the fly but never persists to disk.
        xml = await synthesizeEconomyCoreXml(paths);
        fromDisk = false;
    }

    const escapedFolder = folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ceRe = new RegExp(`(<ce\\s+folder="${escapedFolder}"[^>]*>)([\\s\\S]*?)(<\\/ce>)`, 'i');
    const match = xml.match(ceRe);

    const fileTag = (f) => `<file name="${f.name}" type="${f.type}"/>`;

    if (match) {
        // Block exists: insert any missing <file> entries after the last <file/>.
        const [full, openTag, inner, closeTag] = match;
        let newInner = inner;
        for (const f of files) {
            const fileRe = new RegExp(`<file\\b[^>]*\\bname="${f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*\\btype="${f.type}"[^>]*\\/?>`, 'i');
            if (fileRe.test(newInner)) continue;
            const insertion = `\n        ${fileTag(f)}`;
            const lastFileMatch = Array.from(newInner.matchAll(/<file\b[^>]*\/>/gi)).pop();
            if (lastFileMatch) {
                const idx = lastFileMatch.index + lastFileMatch[0].length;
                newInner = newInner.substring(0, idx) + insertion + newInner.substring(idx);
            } else {
                newInner = newInner.trimEnd() + insertion + '\n    ';
            }
        }
        if (newInner !== inner) {
            const newXml = xml.replace(full, openTag + newInner + closeTag);
            if (fromDisk) await createBackupIfExists(economyCore);
            await writeFileAtomic(economyCore, newXml);
        } else if (!fromDisk) {
            // economycore was synthesized (not persisted) but already declares this
            // block/files — still write it so the declaration survives on disk.
            await writeFileAtomic(economyCore, xml);
        }
    } else {
        // No block: insert a whole new <ce folder> block before </economycore>.
        const block = `\t<ce folder="${folder}">\n` +
            files.map(f => `\t\t${fileTag(f)}`).join('\n') +
            `\n\t</ce>\n`;
        let newXml;
        if (/<\/economycore>/i.test(xml)) {
            newXml = xml.replace(/<\/economycore>/i, block + '</economycore>');
        } else {
            // Malformed/missing root close: append defensively.
            newXml = xml.trimEnd() + '\n' + block + '</economycore>\n';
        }
        if (fromDisk) await createBackupIfExists(economyCore);
        await writeFileAtomic(economyCore, newXml);
    }

    // Clear caches to force reload so declaredTypesFilePath resolves the new group.
    groupFolderCaches.delete(profile.id);
    groupFilesCaches.delete(profile.id);
    groupSpawnableFilesCaches.delete(profile.id);
}

async function createBackupIfExists(target) {
    try {
        await stat(target);
    } catch {
        return null;
    }
    const backupDir = join(dirname(target), '.lootmaster-backups');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = join(backupDir, `${String(target).split(/[\\/]/).pop()}.${stamp}.bak`);
    await mkdir(backupDir, {recursive: true});
    const content = await readFile(target, 'utf8');
    await writeFileAtomic(backup, content);
    return backup;
}

/**
 * Atomically and durably write a file: write to a same-directory temp file,
 * fsync it, rename over the target, then fsync the directory.
 * Prevents the zero-filled/truncated-file corruption that occurs when a plain
 * writeFile (truncate-then-write, no fsync) is interrupted by a crash/power-loss.
 * On failure the target is never touched, so the previous good file survives.
 * @param {string} target absolute path to write
 * @param {string} data file contents (utf8)
 * @returns {Promise<string>} the target path
 */
async function writeFileAtomic(target, data) {
    const dir = dirname(target);
    await mkdir(dir, {recursive: true});
    // Same-dir temp so rename() is atomic (same filesystem). A per-write random token
    // (plus PID) keeps the temp path unique so two concurrent writes to the SAME target
    // (e.g. two editors saving the same types file) can't clobber each other's temp file.
    // eslint-disable-next-line no-undef
    const tmp = join(dir, `.${String(target).split(/[\\/]/).pop()}.tmp-${process.pid}-${crypto.randomUUID()}`);
    let fh;
    try {
        fh = await open(tmp, 'w');
        await fh.writeFile(data, 'utf8');
        await fh.sync();          // flush temp file data to stable storage
        await fh.close();
        fh = null;
        await rename(tmp, target); // atomic replace on same volume
    } catch (e) {
        // On any failure the target is left untouched; remove the orphaned temp file.
        if (fh) { try { await fh.close(); } catch { /* ignore */ } }
        try { await rm(tmp, {force: true}); } catch { /* ignore */ }
        throw e;
    }
    // Best-effort: fsync the directory so the rename itself is durable.
    try {
        const dh = await open(dir, 'r');
        try { await dh.sync(); } finally { await dh.close(); }
    } catch { /* directory fsync unsupported (e.g. Windows) — file fsync + atomic rename still applied */ }
    return target;
}

/**
 * Try to use /src/utils/xml.js parseTypesXml to parse XML into Type[] on the server.
 * Falls back to internal regex parser if DOMParser or import is not available.
 * @param {string} xml
 * @returns {Promise<Record<string, any>>}
 */
async function parseTypesWithSrcHelpers(xml) {
    try {
        // Dynamic import to avoid hard dependency at startup
        const mod = await import('../src/utils/xml.js');
        if (mod && typeof mod.parseTypesXml === 'function') {
            const arr = mod.parseTypesXml(xml); // may throw if DOMParser is unavailable
            return typesArrayToMap(arr);
        }
    } catch {
        // ignore and fallback
    }
    return parseTypesToMap(xml);
}

/**
 * Convert Type[] from /src/utils/xml helpers into a comparable map for diffing.
 * @param {Array<any>} arr
 */
function typesArrayToMap(arr) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const t of arr || []) {
        out[t.name] = {
            category: t.category || '',
            nominal: String(t.nominal ?? ''),
            min: String(t.min ?? ''),
            lifetime: String(t.lifetime ?? ''),
            restock: String(t.restock ?? ''),
            quantmin: String(t.quantmin ?? ''),
            quantmax: String(t.quantmax ?? ''),
            usage: Array.isArray(t.usage) ? [...t.usage].sort() : [],
            value: Array.isArray(t.value) ? [...t.value].sort() : [],
            tag: Array.isArray(t.tag) ? [...t.tag].sort() : [],
            flags: {
                count_in_cargo: t.flags?.count_in_cargo ? 1 : 0,
                count_in_hoarder: t.flags?.count_in_hoarder ? 1 : 0,
                count_in_map: t.flags?.count_in_map ? 1 : 0,
                count_in_player: t.flags?.count_in_player ? 1 : 0,
                crafted: t.flags?.crafted ? 1 : 0,
                deloot: t.flags?.deloot ? 1 : 0
            }
        };
    }
    return out;
}

// Minimal XML parsing for types to compute field-level diffs
function parseTypesToMap(xml) {
    /** @type {Record<string, any>} */
    const out = {};
    if (!xml || typeof xml !== 'string') return out;
    const typeRe = /<type\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/type>/gi;
    let m;
    while ((m = typeRe.exec(xml)) !== null) {
        const name = m[1];
        const inner = m[2] || '';
        const getTxt = (tag) => {
            const r = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
            const mm = inner.match(r);
            return mm ? mm[1].trim() : '';
        };
        const getAttrInSelfClosing = (tag, attr) => {
            const r = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"[^>]*\\/?>`, 'i');
            const mm = inner.match(r);
            return mm ? mm[1] : null;
        };
        const getAttrNameList = (tag) => {
            const reg = new RegExp(`<${tag}\\b[^>]*\\bname="([^"]+)"[^>]*\\/?>`, 'gi');
            const arr = [];
            let am;
            while ((am = reg.exec(inner)) !== null) {
                if (am[1]) arr.push(am[1]);
            }
            arr.sort((a, b) => a.localeCompare(b));
            return arr;
        };

        const nominal = getTxt('nominal');
        const min = getTxt('min');
        const lifetime = getTxt('lifetime');
        const restock = getTxt('restock');
        const quantmin = getTxt('quantmin');
        const quantmax = getTxt('quantmax');
        const category = (inner.match(/<category\b[^>]*name="([^"]+)"/i)?.[1]) || '';

        const usage = getAttrNameList('usage');
        const value = getAttrNameList('value');
        const tagArr = getAttrNameList('tag');

        const flags = {
            count_in_cargo: +(getAttrInSelfClosing('flags', 'count_in_cargo') || '0'),
            count_in_hoarder: +(getAttrInSelfClosing('flags', 'count_in_hoarder') || '0'),
            count_in_map: +(getAttrInSelfClosing('flags', 'count_in_map') || '0'),
            count_in_player: +(getAttrInSelfClosing('flags', 'count_in_player') || '0'),
            crafted: +(getAttrInSelfClosing('flags', 'crafted') || '0'),
            deloot: +(getAttrInSelfClosing('flags', 'deloot') || '0'),
        };

        out[name] = {
            category,
            nominal, min, lifetime, restock,
            quantmin, quantmax,
            usage, value, tag: tagArr,
            flags
        };
    }
    return out;
}

function diffTypeFields(a = {}, b = {}) {
    const specs = [];
    const cmp = (label, key) => {
        if ((a[key] ?? '') !== (b[key] ?? '')) specs.push(`${label}(${a[key] ?? ''} > ${b[key] ?? ''})`);
    };
    cmp('Category', 'category');
    cmp('Nominal', 'nominal');
    cmp('Min', 'min');
    cmp('Lifetime', 'lifetime');
    cmp('Restock', 'restock');
    cmp('Quantmin', 'quantmin');
    cmp('Quantmax', 'quantmax');

    // Flags: per-flag 0/1 diffs only
    const fk = ['count_in_cargo', 'count_in_hoarder', 'count_in_map', 'count_in_player', 'crafted', 'deloot'];
    const flagDiffs = [];
    for (const k of fk) {
        const av = (a.flags?.[k] ?? 0) ? 1 : 0;
        const bv = (b.flags?.[k] ?? 0) ? 1 : 0;
        if (av !== bv) flagDiffs.push(`${k}: ${av} > ${bv}`);
    }
    if (flagDiffs.length) specs.push(`Flags(${flagDiffs.join(', ')})`);

    // Array fields
    const arrFields = [
        ['Usage', 'usage'],
        ['Value', 'value'],
        ['Tag', 'tag']
    ];
    for (const [label, key] of arrFields) {
        const aa = Array.isArray(a[key]) ? a[key] : [];
        const bb = Array.isArray(b[key]) ? b[key] : [];
        if (JSON.stringify(aa) !== JSON.stringify(bb)) {
            specs.push(`${label}([${aa.join(', ')}] > [${bb.join(', ')}])`);
        }
    }

    return specs;
}

// Build a stash report using positions matching:
// - Parse {<x, y, z>} at end of line and use (x, z)
// - For each "Dug out", scan backward to find the nearest prior "Dug in" within ±1 on x and z
//   If player ids match => dugUpOwn, otherwise dugUpOthers (ignore if no prior dug-in match)
async function generateStashReport(start, end, paths) {
    const root = paths.logsDirPath;
    const files = await listAdmFiles(root);

    // Load buckets sorted by file start datetime (inferred from filename)
    const buckets = [];
    for (const f of files) {
        let text = '';
        try {
            text = await readFile(f, 'utf8');
        } catch {
            continue;
        }
        const startDate = parseAdmStartDate(f, paths.logTimeZone);
        if (!startDate) continue;
        buckets.push({path: f, startDate, rows: text.split(/\r?\n/)});
    }
    buckets.sort((a, b) => {
        const diff = a.startDate - b.startDate;
        return diff !== 0 ? diff : String(a.path).localeCompare(String(b.path));
    });

    // Aggregate per-player
    /** @type {Map<string, { aliases: Set<string>, dugIn: number, dugUpOwn: number, dugUpOthers: number }>} */
    const byId = new Map();

    // Collect all events in time order with positions
    /** @type {{dt: Date, type: 'in'|'out', pid: string, alias?: string, x: number, z: number}[]} */
    const events = [];
    const posRe = /(?:at position\s+)?(?:\{?\s*)?<\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*>\s*\}?\s*$/;

    // Helper: HH:MM:SS -> seconds of day
    const hmsToSec = (t) => {
        const parts = t.split(':').map(Number);
        if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    };

    for (const bucket of buckets) {
        // Lines carry a time of day and nothing else, so they are read against the
        // file's own local date in the server's zone.
        const clock = createDayClock(
            localFields(bucket.startDate.getTime(), paths.logTimeZone), paths.logTimeZone);

        for (const row of bucket.rows) {
            const t = tryParseLineTime(row);
            if (!t) continue;

            const sec = hmsToSec(t);
            if (sec == null) continue;

            const dt = new Date(clock.at(sec));

            // Time constraint (open-ended if missing)
            if (start && dt < start) continue;
            if (end && dt > end) continue;

            // Determine event type and capture position
            const isIn = /\bDug in\b/i.test(row);
            const isOut = /\bDug out\b/i.test(row);
            if (!isIn && !isOut) continue;

            const idMatch = /\(id=(\S+)\s/i.exec(row);
            if (!idMatch) continue;
            const pid = idMatch[1];
            const aliasMatch = /Player "([^"]+)"/i.exec(row);
            const alias = aliasMatch ? aliasMatch[1] : undefined;

            const pm = posRe.exec(row);
            if (!pm) continue;
            const x = Number(pm[1]);
            const z = Number(pm[3]); // In <X, Y, Z> format at end of line, Z is 3rd
            if (!Number.isFinite(x) || !Number.isFinite(z)) continue;

            // Prime per-player entry and aliases
            if (!byId.has(pid)) byId.set(pid, {aliases: new Set(), dugIn: 0, dugUpOwn: 0, dugUpOthers: 0});
            if (alias) byId.get(pid).aliases.add(alias);

            if (isIn) {
                byId.get(pid).dugIn += 1;
                events.push({dt, type: 'in', pid, alias, x, z});
            } else if (isOut) {
                events.push({dt, type: 'out', pid, alias, x, z});
            }
        }
    }

    // Events are already in ascending time order due to bucket ordering and per-file order
    // For each 'out', scan backwards to find most recent 'in' within ±1 on x and z
    const within = (a, b) => Math.abs(a - b) <= 1;

    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev.type !== 'out') continue;
        // Scan backward
        let matched = false;
        for (let j = i - 1; j >= 0; j--) {
            const prev = events[j];
            if (prev.type !== 'in') continue;
            if (!within(prev.x, ev.x) || !within(prev.z, ev.z)) continue;
            // Found matching dug-in
            const entry = byId.get(ev.pid) || byId.set(ev.pid, {aliases: new Set(), dugIn: 0, dugUpOwn: 0, dugUpOthers: 0}).get(ev.pid);
            if (prev.pid === ev.pid) entry.dugUpOwn += 1;
            else entry.dugUpOthers += 1;
            matched = true;
            break;
        }
        // If no matching dug-in was found, ignore this dug-out (do not count)
        if (!matched) {
            // no-op
        }
    }

    // Build final sorted report
    const report = Array.from(byId.entries()).map(([id, v]) => ({
        id,
        aliases: Array.from(v.aliases.values()),
        dugIn: v.dugIn,
        dugUpOwn: v.dugUpOwn,
        dugUpOthers: v.dugUpOthers
    })).sort((a, b) =>
        (b.dugIn - a.dugIn) ||
        (b.dugUpOwn - a.dugUpOwn) ||
        a.id.localeCompare(b.id)
    );

    return report;
}


function formatTs(d) {
    // Preserve original format but use moment for consistency
    return moment(d).format('DD-MM-YY H:mm:ss');
}

// ----- ADM records utilities -----
function pad2(n) {
    return String(n).padStart(2, '0');
}

function FILE_NAME_FROM_RANGE(start, end) {
    const fmt = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
    return `${fmt(start)}_to_${fmt(end)}.ADM`;
}

function isDigitsName(name) {
    return /^\d+$/.test(name);
}

async function listAdmFiles(logsRoot) {
    /** @type {string[]} */
    const out = [];
    let entries = [];
    try {
        entries = await readdir(logsRoot, {withFileTypes: true});
    } catch {
        return out;
    }
    for (const ent of entries) {
        if (ent.isDirectory() && isDigitsName(ent.name)) {
            const dir = join(logsRoot, ent.name);
            // Recurse only numeric directories
            const nested = await listAdmFiles(dir);
            out.push(...nested);
        } else if (ent.isFile() && /\.ADM$/i.test(ent.name)) {
            out.push(join(logsRoot, ent.name));
        }
    }
    return out;
}

function parseAdmStartDate(filePath, timeZone) {
    // The filename records the server's local time, so it is read in the server's
    // zone rather than a fixed offset. Supports patterns like:
    //  - YYYY-MM-DD_HH-MM-SS
    //  - YYYY-MM-DD-HH-MM-SS
    //  - YYYYMMDD_HHMMSS
    //  - YYYY-MM-DD (defaults time to 00:00:00)
    const name = String(filePath).split(/[\\/]/).pop() || '';

    let m;
    // Full datetime variants
    m = name.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[T _-]?(\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
    if (m) {
        const dt = new Date(wallToMs({
            y: Number(m[1]), mon: Number(m[2]) - 1, d: Number(m[3]),
            h: Number(m[4]), mi: Number(m[5]), s: Number(m[6]),
        }, timeZone));
        return isNaN(dt.getTime()) ? null : dt;
    }
    // Date-only
    m = name.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/);
    if (m) {
        const dt = new Date(wallToMs({
            y: Number(m[1]), mon: Number(m[2]) - 1, d: Number(m[3]), h: 0, mi: 0, s: 0,
        }, timeZone));
        return isNaN(dt.getTime()) ? null : dt;
    }

    // Unknown filename format => skip the file
    return null;
}

function tryParseLineTime(line) {
    const m = /^\s*(\d{1,2}:\d{2}:\d{2})\s+\|\s+Player/i.exec(line);
    return m ? m[1] : null;
}

// Extract a world position; returns {x, z} or null. Distance is planar X/Z -- Y is vertical
// (elevation) and never participates. Note ADM's pos=<> writes the axes as <x, z, y>, while a
// raw engine vector is <x, y, z>; the two branches below account for that difference.
function tryParseLinePos(line) {
    // 1. pos=<X, Z, Y> (Player status in ADM logs)
    let m = /pos\s*=?\s*<\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*>/i.exec(line);
    if (m) {
        const x = Number(m[1]);
        const z = Number(m[2]); // Z is the second coordinate in pos=<X, Z, Y>
        if (Number.isFinite(x) && Number.isFinite(z)) return { x, z };
    }
    // 2. <X, Y, Z> format (Actions, Stashes)
    // Supports: "at position <X, Y, Z>" and "{<X, Y, Z>}"
    m = /(?:at position\s+|\{\s*)<\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*>/i.exec(line);
    if (m) {
        const x = Number(m[1]);
        const z = Number(m[3]); // Z is 3rd in <X, Y, Z>
        if (Number.isFinite(x) && Number.isFinite(z)) return { x, z };
    }
    return null;
}

// Extract (id=XYZ ...); returns id string or null
function tryParseLineId(line) {
    const m = /\(id=([^)\s=]+=?)/i.exec(line);
    return m ? m[1] : null;
}

// ── Expansion Log helpers ──

async function listExpansionLogFiles(logsRoot) {
    /** @type {string[]} */
    const out = [];
    let entries = [];
    try {
        entries = await readdir(logsRoot, {withFileTypes: true});
    } catch {
        return out;
    }
    for (const ent of entries) {
        if (ent.isFile() && /\.log$/i.test(ent.name)) {
            out.push(join(logsRoot, ent.name));
        }
    }
    return out;
}

function parseExpLogStartDate(filePath, timeZone) {
    // ExpLog_YYYY-MM-DD_HH-mm-ss.log — the server's local time, same as .ADM.
    const name = String(filePath).split(/[\\/]/).pop() || '';

    const m = name.match(/ExpLog_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/i);
    if (m) {
        const dt = new Date(wallToMs({
            y: Number(m[1]), mon: Number(m[2]) - 1, d: Number(m[3]),
            h: Number(m[4]), mi: Number(m[5]), s: Number(m[6]),
        }, timeZone));
        return isNaN(dt.getTime()) ? null : dt;
    }
    return null;
}

function tryParseExpLineTime(line) {
    // Expansion lines start with HH:MM:SS.mmm (milliseconds)
    const m = /^(\d{1,2}:\d{2}:\d{2})\.\d+/.exec(line);
    return m ? m[1] : null;
}

async function collectExpansionRecordsInRange(start, end, posFilter, idSet, paths) {
    const root = paths.expansionLogsDirPath;
    const files = await listExpansionLogFiles(root);

    // Read all files and capture their start datetime (from filename) and lines
    const fileBuckets = [];
    for (const f of files) {
        let text = '';
        try {
            text = await readFile(f, 'utf8');
        } catch {
            continue;
        }
        const startDate = parseExpLogStartDate(f, paths.logTimeZone);
        if (!startDate) continue;
        const rows = text.split(/\r?\n/);
        fileBuckets.push({path: f, startDate, rows});
    }

    // Order files by their start datetime (earlier first), tie-breaker by path
    fileBuckets.sort((a, b) => {
        const diff = a.startDate - b.startDate;
        return diff !== 0 ? diff : String(a.path).localeCompare(String(b.path));
    });

    /** @type {string[]} */
    const lines = [];

    const usePos = posFilter && Number.isFinite(posFilter.x) && Number.isFinite(posFilter.z) && Number.isFinite(posFilter.radius);
    const useIds = idSet && idSet.size > 0;

    // Helper: HH:MM:SS -> seconds of day
    const hmsToSec = (t) => {
        const parts = t.split(':').map(Number);
        if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    };

    // For each file (in start-date order), walk lines in original order and include those within range
    for (const bucket of fileBuckets) {
        const clock = createDayClock(
            localFields(bucket.startDate.getTime(), paths.logTimeZone), paths.logTimeZone);

        for (const row of bucket.rows) {
            const t = tryParseExpLineTime(row);
            if (!t) continue;

            const sec = hmsToSec(t);
            if (sec == null) continue;

            const dt = new Date(clock.at(sec));

            if (dt < start || dt > end) continue;

            if (useIds) {
                const id = tryParseLineId(row);
                if (!id || !idSet.has(id)) continue;
            } else if (usePos) {
                const pos = tryParseLinePos(row);
                if (!pos) continue;
                const dx = pos.x - posFilter.x;
                const dz = pos.z - posFilter.z;
                const dist = Math.hypot(dx, dz);
                if (dist > posFilter.radius) continue;
            }

            lines.push(row);
        }
    }

    return lines;
}

/**
 * @param stats optional out-param; when supplied it is populated with diagnostics
 *              ({filesFound, filesDated, linesInRange, nearestDistance}) so callers can
 *              explain an empty result instead of just returning nothing.
 */
async function collectAdmRecordsInRange(start, end, posFilter, idSet, paths, stats) {
    const root = paths.logsDirPath;
    const files = await listAdmFiles(root);
    if (stats) {
        stats.filesFound = files.length;
        stats.filesDated = 0;
        stats.linesInRange = 0;
        stats.nearestDistance = Infinity;
    }

    // Read all files and capture their start datetime (from filename) and lines
    const fileBuckets = [];
    for (const f of files) {
        let text = '';
        try {
            text = await readFile(f, 'utf8');
        } catch {
            continue;
        }
        const startDate = parseAdmStartDate(f, paths.logTimeZone);
        if (!startDate) continue;
        const rows = text.split(/\r?\n/);
        fileBuckets.push({path: f, startDate, rows});
    }
    if (stats) stats.filesDated = fileBuckets.length;

    // Order files by their start datetime (earlier first), tie-breaker by path
    fileBuckets.sort((a, b) => {
        const diff = a.startDate - b.startDate;
        return diff !== 0 ? diff : String(a.path).localeCompare(String(b.path));
    });

    /** @type {string[]} */
    const lines = [];

    const usePos = posFilter && Number.isFinite(posFilter.x) && Number.isFinite(posFilter.z) && Number.isFinite(posFilter.radius);
    const useIds = idSet && idSet.size > 0;

    // Helper: HH:MM:SS -> seconds of day
    const hmsToSec = (t) => {
        const parts = t.split(':').map(Number);
        if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    };

    // For each file (in start-date order), walk lines in original order and include those within range
    for (const bucket of fileBuckets) {
        const clock = createDayClock(
            localFields(bucket.startDate.getTime(), paths.logTimeZone), paths.logTimeZone);

        for (const row of bucket.rows) {
            const t = tryParseLineTime(row);
            if (!t) continue;

            const sec = hmsToSec(t);
            if (sec == null) continue;

            const dt = new Date(clock.at(sec));

            // Ensure the adjusted datetime lies within the requested range
            if (dt < start || dt > end) continue;
            if (stats) stats.linesInRange += 1;

            // If idSet provided, it takes priority (ignore positional filter)
            if (useIds) {
                const id = tryParseLineId(row);
                if (!id || !idSet.has(id)) continue;
            } else if (usePos) {
                const pos = tryParseLinePos(row);
                if (!pos) continue;
                const dx = pos.x - posFilter.x;
                const dz = pos.z - posFilter.z;
                const dist = Math.hypot(dx, dz);
                // Track the closest in-range position even when it falls outside the radius,
                // so an empty result can suggest how far the radius would have to reach.
                if (stats && dist < stats.nearestDistance) stats.nearestDistance = dist;
                if (dist > posFilter.radius) continue;
            }

            lines.push(row);
        }
    }

    // Preserve original order; do not sort here
    return lines;
}

/**
 * Build a minimal economycore XML by scanning missionPath/db and missionPath/db/types.
 */
async function synthesizeEconomyCoreXml(paths) {
    const lines = ['<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>', '<economycore>', '\t<classes></classes>', '\t<defaults></defaults>'];

    // Helper to list group directories and XML files
    async function listGroupsAt(relBase) {
        const absBase = join(paths.missionPath, relBase);
        let entries = [];
        try {
            entries = await (await import('node:fs/promises')).readdir(absBase, {withFileTypes: true});
        } catch {
            return [];
        }
        const out = [];
        for (const dirent of entries) {
            if (!dirent.isDirectory()) continue;
            const group = dirent.name;
            const groupDir = join(absBase, group);
            let files = [];
            try {
                const fEntries = await (await import('node:fs/promises')).readdir(groupDir, {withFileTypes: true});
                files = fEntries.filter(e => e.isFile() && /\.xml$/i.test(e.name)).map(e => e.name);
            } catch {
                files = [];
            }
            if (files.length) {
                out.push({folder: `${relBase}/${group}`, files: files.sort((a, b) => a.localeCompare(b))});
            }
        }
        return out.sort((a, b) => a.folder.localeCompare(b.folder));
    }

    const groupsDb = await listGroupsAt('db');
    const groupsDbTypes = await listGroupsAt('db/types');

    const all = [...groupsDb, ...groupsDbTypes];
    for (const {folder, files} of all) {
        lines.push(`\t<ce folder="${folder}">`);
        for (const name of files) {
            // Only include types files (type="types")
            lines.push(`\t\t<file name="${name}" type="types"/>`);
        }
        lines.push('\t</ce>');
    }

    lines.push('</economycore>');
    return lines.join('\n');
}

// Read a settings file and confirm it parses as JSON. Throws (handled as 404 by the
// callers' catch blocks) when the file is empty, all-NUL (crash-corrupted), or otherwise
// not valid JSON — so the client falls back to defaults instead of choking on garbage.
async function readValidJsonFile(target) {
    const content = await readFile(target, 'utf8');
    JSON.parse(content); // throws on '', NUL-filled, or malformed content
    return content;
}

/**
 * Read a request body, optionally refusing one over `maxBytes`.
 *
 * The cap is opt-in rather than global because the existing callers are the
 * profile/mission writers, whose payloads are already bounded by what the editor
 * can produce. It exists for the mod's ingest routes: an inventory tree is the
 * first genuinely unbounded POST body on this server, and a runaway one would
 * otherwise be buffered whole before anything got a chance to reject it.
 *
 * Counting bytes (not string length) because that is what the buffer costs, and
 * destroying the socket rather than draining: a client that has already sent more
 * than the limit is not going to be talked out of the rest of it.
 */
async function readBody(req, maxBytes = 0) {
    return new Promise((resolveBody, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (maxBytes && size > maxBytes) {
                const err = new Error(`Request body exceeds ${maxBytes} bytes.`);
                err.code = 'BODY_TOO_LARGE';
                req.destroy();
                reject(err);
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => {
            // eslint-disable-next-line no-undef
            resolveBody(Buffer.concat(chunks).toString('utf8'));
        });
        req.on('error', reject);
    });
}

function notFound(res) {
    send(res, 404, JSON.stringify({error: 'Not found'}), {'Content-Type': 'application/json'});
}

function methodNotAllowed(res) {
    send(res, 405, JSON.stringify({error: 'Method not allowed'}), {'Content-Type': 'application/json'});
}

function badRequest(res, message) {
    send(res, 400, JSON.stringify({error: message || 'Bad request'}), {'Content-Type': 'application/json'});
}

// ---- DayZ Server API (companion mod) catalog + ingest ----
// The companion mod pushes its live state and config catalog directly to this
// backend's /ingest/* routes (see server/ingest-store.js and openapi-ingest.json);
// there is no separate service to proxy to. The /api/catalog/* routes below are
// the read side, serving type metadata (displayName, description) and the
// both-directions attachment graph out of that in-memory store. Everything
// degrades gracefully: an unpopulated store yields an empty/disconnected shape
// (never a 5xx) so the client can fall back to bare class names.

// Client-facing /api/catalog/types/:name shape, built from the ingest store.
// Mirrors normalizeTypeDetail's output (src/utils/catalog.js) so the client hook
// and TypeMetaPanel keep the same contract they had against the old proxy.
function buildCatalogDetail(name) {
    const detail = ingest.getTypeDetail(name);
    return {
        name,
        displayName: (detail && detail.displayName) || null,
        description: (detail && detail.description) || null,
        // accepts: items that attach ONTO this object; fitsInto: objects this attaches onto.
        accepts: ingest.getCompatibleAttachments(name),
        fitsInto: ingest.getObjectsAcceptingItem(name),
        exposesSlots: detail && Array.isArray(detail.attachments) ? detail.attachments : null,
        occupiesSlots: detail && Array.isArray(detail.inventorySlot) ? detail.inventorySlot : null,
        // cargoSize: [rows, cols] capacity; present/non-zero product ⇒ the item is a container.
        cargoSize: detail && Array.isArray(detail.cargoSize) ? detail.cargoSize : null,
        // isContainer: Container_Base descendant — holds cargo even when cargoSize is empty
        // (storage containers' grids live in the p3d, not itemsCargoSize). The mod's Enforce
        // JsonSerializer emits bool as 1/0 (number), so coerce truthiness; absent ⇒ null (unknown).
        isContainer: detail && detail.isContainer != null ? !!detail.isContainer : null,
        // isDeployable: item that can be placed/deployed into the world (base-building kits, tents,
        // traps, fireplaces, garden plots, deployable containers). Emitted by the mod as bool 1/0;
        // absent ⇒ null (unknown). Used to scope Expansion base-building deployable pickers.
        isDeployable: detail && detail.isDeployable != null ? !!detail.isDeployable : null,
        // magazines: compatible magazine classes (CfgWeapons magazines[]); empty for non-weapons.
        magazines: detail && Array.isArray(detail.magazines) ? detail.magazines : null,
        // hitpoints: base durability (DamageSystem GlobalHealth Health hitpoints); 0/null if none.
        hitpoints: detail && typeof detail.hitpoints === 'number' ? detail.hitpoints : null,
        // armor: DamageSystem GlobalArmor rows, one per declared damage-type (cfgAmmo class).
        armor: detail && Array.isArray(detail.armor) ? detail.armor : null,
    };
}

// Handles any /api/catalog/* route (read side). Returns true if it took the request.
async function handleCatalogRoute(pathname, req, res) {
    const parts = pathname.split('/').filter(Boolean); // ['api','catalog',...]
    if (parts[0] !== 'api' || parts[1] !== 'catalog') return false;
    if (req.method !== 'GET') { methodNotAllowed(res); return true; }

    // /api/catalog/health — is the mod actively pushing?
    if (parts.length === 3 && parts[2] === 'health') {
        const modConnected = ingest.modConnected();
        const { at: snapshotAt } = ingest.getSnapshot();   // ms epoch of last live push; 0 when never synced
        const { at: catalogAt } = ingest.getCatalog();     // ms epoch of last catalog import
        send(res, 200, JSON.stringify({ ok: true, modConnected, snapshotAt, catalogAt }), { 'Content-Type': 'application/json' });
        return true;
    }

    // /api/catalog/types — bulk summaries for the displayName lookup.
    if (parts.length === 3 && parts[2] === 'types') {
        const { types } = ingest.getCatalog();
        // isDeployable is carried on the bulk summary (unlike the other detail fields) so the
        // client can filter the full type list to deployable items during search without fetching
        // every per-item detail. Emitted by the mod as bool 1/0; absent ⇒ null (unknown).
        const list = Object.keys(types).map(name => ({
            name,
            displayName: types[name].displayName || null,
            isDeployable: types[name].isDeployable != null ? !!types[name].isDeployable : null,
        }));
        send(res, 200, JSON.stringify({ count: list.length, types: list }), { 'Content-Type': 'application/json' });
        return true;
    }

    // /api/catalog/types/:name — normalized detail + attachment graph.
    if (parts.length === 4 && parts[2] === 'types') {
        const name = decodeURIComponent(parts[3]);
        send(res, 200, JSON.stringify(buildCatalogDetail(name)), { 'Content-Type': 'application/json' });
        return true;
    }

    // /api/catalog/slots — occupiable attachment-slot vocabulary (union of items' inventorySlot[]).
    if (parts.length === 3 && parts[2] === 'slots') {
        const slots = ingest.listOccupiableSlots();
        send(res, 200, JSON.stringify({ count: slots.length, slots }), { 'Content-Type': 'application/json' });
        return true;
    }

    // /api/catalog/slots/:slot — items that occupy the given slot (what fits a slot-scoped pool).
    if (parts.length === 4 && parts[2] === 'slots') {
        const slot = decodeURIComponent(parts[3]);
        const items = ingest.getItemsForSlot(slot);
        send(res, 200, JSON.stringify({ slot, count: items.length, items }), { 'Content-Type': 'application/json' });
        return true;
    }

    notFound(res);
    return true;
}

// Body caps for the two ingest routes that carry unbounded, mod-generated payloads.
// Sized from what the mod actually produces: an event batch is a few hundred small
// records, and the largest realistic inventory (a fully-kitted player with a loaded
// backpack) serialises well under 200 KB. Both leave an order of magnitude of head-
// room, so hitting one means something is wrong rather than merely busy.
const INGEST_EVENTS_MAX_BYTES = 1024 * 1024;
const INGEST_INVENTORY_MAX_BYTES = 2 * 1024 * 1024;

// Handles the mod-facing /ingest/* routes (write side; no X-Profile-ID). The mod
// PUSHES snapshots/catalog and POLLS the command queue. Every push MUST get a 2xx
// (the mod treats non-2xx as an error and retries). Returns true if it took the request.
async function handleIngestRoute(pathname, req, res) {
    const parts = pathname.split('/').filter(Boolean); // ['ingest',...]
    if (parts[0] !== 'ingest') return false;

    const parseBody = async () => {
        const raw = await readBody(req);
        return raw ? JSON.parse(raw) : {};
    };

    // POST /ingest/snapshot — full live state each tick (no deltas).
    if (parts.length === 2 && parts[1] === 'snapshot' && req.method === 'POST') {
        const body = await parseBody();
        ingest.setSnapshot(body);
        // History is a TEE, never a dependency. This route MUST return 2xx: the mod
        // treats any non-2xx as an error and un-latches catalog delivery, so a full
        // disk or a corrupt DB would cost us the item catalog as well as history.
        // recordSnapshot swallows its own errors and tracks them for /api/history/stats;
        // this catch is the belt to that braces.
        try { history.recordSnapshot(body); } catch { /* never fails the ingest */ }
        send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
        return true;
    }

    // POST /ingest/events — a drained batch of action events (pickup/drop/death/...).
    //
    // Separate from /ingest/snapshot rather than piggy-backed on it, because the
    // snapshot is the one request that gates catalog delivery and must stay small
    // and predictable. Events are bursty: a firefight can produce a hundred in the
    // window a single snapshot covers.
    if (parts.length === 2 && parts[1] === 'events' && req.method === 'POST') {
        let body;
        try {
            body = JSON.parse((await readBody(req, INGEST_EVENTS_MAX_BYTES)) || '{}');
        } catch (err) {
            // A 413 here is safe in a way it would not be on /ingest/snapshot: the
            // mod re-queues an un-acked batch, and (session, n) makes the retry
            // idempotent, so refusing an oversized batch costs a round trip and
            // never the item catalog.
            if (err.code === 'BODY_TOO_LARGE') {
                send(res, 413, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json' });
            } else {
                badRequest(res, 'Malformed events batch.');
            }
            return true;
        }
        let stored = 0;
        try { stored = history.recordEvents(body); } catch { /* never fails the ingest */ }
        send(res, 200, JSON.stringify({ ok: true, stored }), { 'Content-Type': 'application/json' });
        return true;
    }

    // POST /ingest/inventory — one player's full inventory tree at a moment.
    if (parts.length === 2 && parts[1] === 'inventory' && req.method === 'POST') {
        let body;
        try {
            body = JSON.parse((await readBody(req, INGEST_INVENTORY_MAX_BYTES)) || '{}');
        } catch (err) {
            if (err.code === 'BODY_TOO_LARGE') {
                send(res, 413, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json' });
            } else {
                badRequest(res, 'Malformed inventory snapshot.');
            }
            return true;
        }
        let id = null;
        try { id = history.recordInventory(body); } catch { /* never fails the ingest */ }
        send(res, 200, JSON.stringify({ ok: true, id }), { 'Content-Type': 'application/json' });
        return true;
    }

    // POST /ingest/catalog — config-derived type metadata, chunked (reset->clear, else merge).
    if (parts.length === 2 && parts[1] === 'catalog' && req.method === 'POST') {
        ingest.setCatalog(await parseBody());
        send(res, 200, JSON.stringify({ ok: true, types: Object.keys(ingest.getCatalog().types).length }), { 'Content-Type': 'application/json' });
        return true;
    }

    // POST /ingest/commands/ack — a command result (broadcast/kick: result; scanItems: items).
    if (parts.length === 3 && parts[1] === 'commands' && parts[2] === 'ack' && req.method === 'POST') {
        const body = await parseBody();
        if (body.id === undefined) { badRequest(res, 'id required'); return true; }
        // Three ack shapes, one route. scanItems answers with `items`, a rollback
        // with a `restore` object of per-node counts, and everything else with a
        // bare `result` string. Checked most-specific-first so a restore's counts
        // are never flattened to the word "ok".
        const payload = body.items !== undefined ? body.items
            : body.restore !== undefined ? body.restore
                : body.result;
        const ok = ingest.ackCommand(body.id, payload);
        send(res, ok ? 200 : 404, JSON.stringify({ ok }), { 'Content-Type': 'application/json' });
        return true;
    }

    // GET /ingest/commands — pending commands for the mod to run (empty when idle).
    if (parts.length === 2 && parts[1] === 'commands' && req.method === 'GET') {
        send(res, 200, JSON.stringify({ commands: ingest.takePendingCommands() }), { 'Content-Type': 'application/json' });
        return true;
    }

    methodNotAllowed(res);
    return true;
}

// How long GET /items blocks waiting for the mod to ack a scanItems command before
// giving up with 504. The mod's round-trip is ~2-4 s; 10 s leaves headroom.
// eslint-disable-next-line no-undef
const ITEM_SCAN_TIMEOUT_MS = Number(process.env.ITEM_SCAN_TIMEOUT_MS || 10000);

// Await a command's ack (delivered out-of-band on POST /ingest/commands/ack) up to
// timeoutMs. Resolves the done command, or null on timeout. Polls because the ack
// arrives on a separate HTTP request handled concurrently.
function waitForCommand(id, timeoutMs) {
    return new Promise((resolve) => {
        const started = Date.now();
        const tick = () => {
            const cmd = ingest.getCommand(id);
            if (cmd && cmd.status === 'done') { resolve(cmd); return; }
            if (Date.now() - started >= timeoutMs) { resolve(null); return; }
            setTimeout(tick, 150);
        };
        tick();
    });
}

// Enqueue a scanItems command centred on (x,z), block on the mod's ack, and send the
// ItemScan response. Shared by GET /items and GET /items/near/{playerId}.
async function runItemScan(res, x, z, radius) {
    const cmd = ingest.enqueueCommand('scanItems', { x, z, radius });
    const done = await waitForCommand(cmd.id, ITEM_SCAN_TIMEOUT_MS);
    if (!done) {
        send(res, 504, JSON.stringify({ error: 'The mod did not respond in time; retry.' }), { 'Content-Type': 'application/json' });
        return;
    }
    const items = Array.isArray(done.result) ? done.result : [];
    const body = { center: { x, z }, radius, count: items.length, items };
    send(res, 200, JSON.stringify(body), { 'Content-Type': 'application/json' });
}

// Handles the live world-item scan routes (GET /items, GET /items/near/{playerId}).
// Region-scoped only; enqueues a scanItems command for the companion mod and blocks on
// the round-trip. Profile-independent. Returns true if it took the request.
async function handleItemsRoute(url, req, res) {
    const parts = url.pathname.split('/').filter(Boolean); // ['items'] or ['items','near',id]

    if (req.method !== 'GET') { methodNotAllowed(res); return true; }

    // The scan is a live round-trip to the mod, so it must be connected.
    if (!ingest.modConnected()) {
        send(res, 503, JSON.stringify({ error: 'Mod not connected; live scan unavailable.' }), { 'Content-Type': 'application/json' });
        return true;
    }

    // radius: default 30, capped at 200 (DayZ has no performant map-wide enumeration).
    const rawRadius = url.searchParams.get('radius');
    let radius = rawRadius === null || rawRadius === '' ? 30 : Number(rawRadius);
    if (!Number.isFinite(radius) || radius <= 0) radius = 30;
    if (radius > 200) radius = 200;

    // GET /items?x&z&radius
    if (parts.length === 1) {
        const x = Number(url.searchParams.get('x'));
        const z = Number(url.searchParams.get('z'));
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
            badRequest(res, 'x and z query parameters are required and must be numeric.');
            return true;
        }
        await runItemScan(res, x, z, radius);
        return true;
    }

    // GET /items/near/{playerId} — resolve the centre from the latest snapshot's players.
    if (parts.length === 3 && parts[1] === 'near') {
        const playerId = decodeURIComponent(parts[2]);
        const snap = ingest.getSnapshot().data;
        const players = snap && Array.isArray(snap.players) ? snap.players : [];
        const player = players.find(p => p && (p.id === playerId || p.steamId === playerId || p.name === playerId));
        if (!player || !Array.isArray(player.pos) || player.pos.length < 3) {
            send(res, 404, JSON.stringify({ error: 'Player not found or offline.' }), { 'Content-Type': 'application/json' });
            return true;
        }
        await runItemScan(res, Number(player.pos[0]), Number(player.pos[2]), radius);
        return true;
    }

    notFound(res);
    return true;
}

// ---- Player history (recorded from the companion mod's snapshot stream) ----
// Profile-independent, like /ingest and /api/catalog: the data source is the mod,
// not a server profile. House style for reads — never 5xx. An unavailable store
// answers 200 { available: false, reason } so the tool can render its own empty
// state instead of showing a transport error for a feature that is merely off.

/** Default span when the caller supplies no range: the last 6 hours. */
const HISTORY_DEFAULT_SPAN_MS = 6 * 60 * 60 * 1000;
/** Points per track after decimation. Enough to draw; small enough to send. */
const HISTORY_DEFAULT_BUDGET = 2000;
const HISTORY_MAX_BUDGET = 20000;
/**
 * Ceiling on players per track request.
 *
 * Deliberately far looser than the 8 the UI offers: that number is a palette limit
 * (see trackColors.ts), this one guards an unbounded IN-list and an unbounded
 * response. The server must not depend on the client for either.
 */
const HISTORY_MAX_IDS = 32;

// Resolve ?from/?to into an epoch-ms range. Both optional; `to` defaults to now
// and `from` to HISTORY_DEFAULT_SPAN_MS before it.
function historyRange(url) {
    const now = Date.now();
    const toRaw = Number(url.searchParams.get('to'));
    const fromRaw = Number(url.searchParams.get('from'));
    const to = Number.isFinite(toRaw) && toRaw > 0 ? toRaw : now;
    const from = Number.isFinite(fromRaw) && fromRaw >= 0 ? fromRaw : to - HISTORY_DEFAULT_SPAN_MS;
    return { from: Math.min(from, to), to: Math.max(from, to) };
}

// ----- ADM import job -------------------------------------------------------
//
// One import at a time, tracked in memory. Deliberately not persisted: a job that
// did not finish is not resumable anyway (the process holding the transaction is
// gone), and a stale "running" record surviving a restart would be worse than no
// record at all. Re-running an import is cheap and idempotent — see recordAdmRows.

let admJob = null;

function startAdmImport({ files, zone, ledger, root }) {
    const controller = new AbortController();
    admJob = {
        running: true,
        startedAt: Date.now(),
        finishedAt: null,
        root,
        timeZone: typeof zone === 'string' ? zone : null,
        offsetMinutes: typeof zone === 'object' ? zone.offsetMinutes : null,
        totalFiles: files.filter(f => !f.skip).length,
        progress: null,
        result: null,
        error: null,
        controller,
    };

    // Intentionally not awaited: the route returns 202 and the client polls.
    admImport.importAdmArchive({
        files, zone, ledger, srv: 'default',
        signal: controller.signal,
        onProgress: (p) => { if (admJob) admJob.progress = p; },
    }).then((result) => {
        if (!admJob) return;
        admJob.result = result;
        admJob.aborted = controller.signal.aborted;
    }).catch((err) => {
        if (admJob) admJob.error = err.message;
    }).finally(() => {
        if (admJob) { admJob.running = false; admJob.finishedAt = Date.now(); }
    });
}

function admJobState() {
    if (!admJob) return { running: false, idle: true };
    const { controller, ...rest } = admJob;
    void controller;
    return { ...rest, idle: false };
}

async function handleHistoryRoute(url, req, res) {
    const parts = url.pathname.split('/').filter(Boolean); // ['api','history',...]
    if (parts[0] !== 'api' || parts[1] !== 'history') return false;
    const route = parts.slice(2).join('/');

    // POST /api/history/rollback — the one write in this namespace. Handled before
    // the GET gate, and deliberately NOT a read route: it changes the game world,
    // so it reports real errors rather than degrading to { available: false }.
    if (route === 'rollback' && req.method === 'POST') {
        await handleRollback(req, res);
        return true;
    }

    // POST /api/history/capture — ask the mod to snapshot a player's inventory now.
    //
    // Exists so a rollback can be shown against what the player is ACTUALLY carrying
    // rather than against whatever was last recorded, which for a long session is
    // their connect loadout and nothing like the truth.
    if (route === 'capture' && req.method === 'POST') {
        await handleCaptureInventory(req, res);
        return true;
    }

    if (req.method !== 'GET') { methodNotAllowed(res); return true; }

    // GET /api/history/stats — volume, span and recorder health. Always answers,
    // even when recording is off, because "off" is exactly what the UI needs told.
    if (route === 'stats') {
        json(res, 200, history.stats());
        return true;
    }

    // GET /api/history/online — who the mod says is connected RIGHT NOW.
    //
    // Read straight off the live ingest store rather than through CF Tools, because
    // this tool must work on a server with no CF Tools binding at all — the whole
    // reason it does not gate on it. It answers one question the recorded history
    // cannot: an inventory capture and a rollback both need a LOADED character, and
    // a player who was here ten minutes ago is not one.
    if (route === 'online') {
        const live = ingest.getSnapshot();
        const players = Array.isArray(live.data?.players) ? live.data.players : [];
        json(res, 200, {
            connected: ingest.modConnected(),
            at: live.at || null,
            items: players.map(p => ({
                pid: p.steamId || p.id || null,
                name: p.name || null,
            })).filter(p => p.pid),
        });
        return true;
    }

    const st = history.stats();
    if (!st.enabled) {
        json(res, 200, { available: false, reason: 'disabled', items: [] });
        return true;
    }
    if (!st.ready) {
        json(res, 200, { available: false, reason: 'error', error: st.lastError, items: [] });
        return true;
    }

    const { from, to } = historyRange(url);

    // GET /api/history/players?from&to — who has samples in the window.
    if (route === 'players') {
        json(res, 200, { available: true, from, to, items: history.listPlayers({ from, to }) });
        return true;
    }

    // GET /api/history/track?ids=a,b&from&to&max= — decimated paths, one per player.
    if (route === 'track') {
        const ids = (url.searchParams.get('ids') || '')
            .split(',').map(s => s.trim()).filter(Boolean);
        if (!ids.length) { badRequest(res, 'ids query parameter is required.'); return true; }
        if (ids.length > HISTORY_MAX_IDS) {
            badRequest(res, `Too many players: ${ids.length} requested, ${HISTORY_MAX_IDS} maximum.`);
            return true;
        }

        const rawMax = Number(url.searchParams.get('max'));
        const budget = Number.isFinite(rawMax) && rawMax >= 2
            ? Math.min(rawMax, HISTORY_MAX_BUDGET)
            : HISTORY_DEFAULT_BUDGET;

        // Two-stage decimation. The SQL stride caps what is ever materialised (a
        // week of one player is ~120k rows); RDP then trims to the budget while
        // keeping the corners a stride alone would clip. Both stages report, so a
        // thinned track is never silently presented as complete.
        //
        // RDP runs PER RUN OF PRESENCE, not across the whole track. Simplifying
        // across an absence would let it drop the very points that mark where the
        // player left and came back, and a `gap` flag that survives on one point
        // but not its neighbour describes an absence that starts nowhere.
        const tracks = history.queryTrack({ pids: ids, from, to }).map(t => {
            const runs = [];
            for (const p of t.points) {
                if (p.gap || !runs.length) runs.push([]);
                runs[runs.length - 1].push(p);
            }
            // Share the budget by run length so one long run cannot starve the rest.
            const total = t.points.length || 1;
            const points = runs.flatMap((run) => {
                const share = Math.max(2, Math.round(budget * (run.length / total)));
                const simplified = simplifyToBudget(run, share);
                // simplifyToBudget copies points, so re-assert the run boundary: the
                // first point of every run after the first still opens an absence.
                if (simplified.length) simplified[0] = { ...simplified[0], gap: run[0].gap };
                return simplified;
            });
            return {
                ...t,
                points,
                runs: runs.length,
                sampled: points.length,
                simplified: points.length < t.points.length,
            };
        });
        json(res, 200, { available: true, from, to, budget, items: tracks });
        return true;
    }

    // GET /api/history/at?ts&tol — one row per player nearest an instant (seek).
    if (route === 'at') {
        const ts = Number(url.searchParams.get('ts'));
        if (!Number.isFinite(ts)) { badRequest(res, 'ts query parameter is required.'); return true; }
        const rawTol = Number(url.searchParams.get('tol'));
        const tol = Number.isFinite(rawTol) && rawTol > 0 ? rawTol : 30000;
        json(res, 200, { available: true, ts, tol, items: history.queryAt({ ts, tol }) });
        return true;
    }

    // GET /api/history/area?x&z&radius&from&to — presence intervals in a circle.
    if (route === 'area') {
        const x = Number(url.searchParams.get('x'));
        const z = Number(url.searchParams.get('z'));
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
            badRequest(res, 'x and z query parameters are required and must be numeric.');
            return true;
        }
        const rawRadius = Number(url.searchParams.get('radius'));
        // No 200 m cap here, unlike /items: that limit is the game engine's spatial
        // query cost, and this is an indexed read of rows we already hold.
        const radius = Number.isFinite(rawRadius) && rawRadius > 0 ? rawRadius : 100;
        const rawGap = Number(url.searchParams.get('gap'));
        const gapMs = Number.isFinite(rawGap) && rawGap > 0 ? rawGap : 60000;
        json(res, 200, {
            available: true, from, to, center: { x, z }, radius,
            items: history.queryArea({ x, z, radius, from, to, gapMs }),
        });
        return true;
    }

    // GET /api/history/actions?ids&kinds&from&to&x&z&radius&limit — the action feed.
    if (route === 'actions') {
        const ids = (url.searchParams.get('ids') || '')
            .split(',').map(s => s.trim()).filter(Boolean);
        const kinds = (url.searchParams.get('kinds') || '')
            .split(',').map(s => s.trim()).filter(Boolean);
        const x = Number(url.searchParams.get('x'));
        const z = Number(url.searchParams.get('z'));
        const radius = Number(url.searchParams.get('radius'));
        const rawLimit = Number(url.searchParams.get('limit'));
        const limit = Number.isFinite(rawLimit) && rawLimit > 0
            ? Math.min(rawLimit, HISTORY_ACTION_MAX)
            : HISTORY_ACTION_DEFAULT;

        const result = history.queryActions({ pids: ids, kinds, from, to, x, z, radius, limit });
        json(res, 200, {
            available: true, from, to, limit,
            truncated: result.truncated,
            // The kinds present in the window, so the filter chips show what can
            // actually be filtered rather than a hard-coded list the mod may not
            // even emit on this server.
            kinds: history.actionKinds({ from, to }),
            items: result.items,
        });
        return true;
    }

    // GET /api/history/inventory?pid&from&to — snapshot list, WITHOUT the trees.
    if (route === 'inventory') {
        const pid = url.searchParams.get('pid') || undefined;
        json(res, 200, {
            available: true, from, to, pid: pid ?? null,
            items: history.listInventory({ pid, from, to }),
        });
        return true;
    }

    // GET /api/history/inventory/:id — one snapshot with its full tree.
    if (parts.length === 4 && parts[2] === 'inventory') {
        const id = Number(parts[3]);
        if (!Number.isFinite(id)) { badRequest(res, 'Snapshot id must be numeric.'); return true; }
        const snap = history.getInventory(id);
        if (!snap) { notFound(res); return true; }
        json(res, 200, { available: true, ...decorateInventory(snap) });
        return true;
    }

    notFound(res);
    return true;
}

/** Rows per action feed request. */
const HISTORY_ACTION_DEFAULT = 500;
const HISTORY_ACTION_MAX = 5000;

/**
 * Resolve every classname in a stored tree to its catalog display name.
 *
 * Done on read rather than on write on purpose: the catalog arrives from the mod
 * after the first successful snapshot and can be re-exported at any time, so a
 * name baked in at capture would be frozen at whatever we knew then — including
 * "nothing at all" for a snapshot recorded before the catalog landed. The mod's
 * own displayName is kept as the fallback for a class the catalog has dropped.
 */
function decorateInventory(snap) {
    const walk = (nodes) => nodes.map((n) => ({
        ...n,
        displayName: ingest.getTypeDetail(n.cls)?.displayName || n.displayName || n.cls,
        children: walk(n.children || []),
    }));
    return { ...snap, tree: walk(snap.tree || []) };
}

/**
 * Re-expand our nulls into the mod's sentinels on the way back out.
 *
 * The store collapses `-1` and `""` to null on ingest, because a consumer that has
 * to re-check for -1 everywhere eventually forgets somewhere and renders "Level
 * -1". Handing those nulls straight back to the mod would be a different bug:
 * Enforce's JsonSerializer deserialises into declared primitives, and a `null`
 * where it expects a float is not something it can represent — it rejects the
 * parse, and one bad node takes the WHOLE command list with it. So the boundary
 * that collapsed them expands them again.
 */
function toModNode(n) {
    return {
        cls: n.cls,
        slot: n.slot ?? '',
        where: n.where || 'cargo',
        health01: n.health01 ?? -1,
        healthLevel: n.healthLevel ?? -1,
        quantity: n.quantity ?? -1,
        quantityMax: n.quantityMax ?? -1,
        row: n.row ?? -1,
        col: n.col ?? -1,
        displayName: n.displayName ?? '',
        children: toModTree(n.children),
    };
}

function toModTree(nodes) {
    return (Array.isArray(nodes) ? nodes : []).map(toModNode);
}

function toModStats(s) {
    const v = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : -1);
    return {
        health: v(s?.health), blood: v(s?.blood), shock: v(s?.shock),
        energy: v(s?.energy), water: v(s?.water),
    };
}

// How long POST /api/history/rollback waits for the mod to ack. A restore rebuilds
// an entire inventory tree entity by entity, so it is slower than a scanItems sweep
// — but it still runs inside one server tick, and 20 s is a stall, not a slow path.
// eslint-disable-next-line no-undef
const ROLLBACK_TIMEOUT_MS = Number(process.env.ROLLBACK_TIMEOUT_MS || 20000);

/**
 * Ask the mod to capture a player's inventory right now.
 *
 * The ack only confirms the capture was QUEUED. The snapshot itself arrives over
 * /ingest/inventory on the mod's next flush, up to `eventFlushInterval` seconds
 * later, so the response says so and the caller polls the snapshot list rather
 * than being handed a tree that does not exist yet. Pretending otherwise would
 * mean either blocking for six seconds or returning a stale snapshot as if it
 * were fresh.
 */
async function handleCaptureInventory(req, res) {
    let body;
    try {
        body = JSON.parse((await readBody(req, 4096)) || '{}');
    } catch {
        badRequest(res, 'Malformed request body.');
        return;
    }
    const playerId = String(body.playerId || '');
    if (!playerId) { badRequest(res, 'playerId is required.'); return; }

    if (!ingest.modConnected()) {
        json(res, 503, { error: 'Mod not connected; a live capture is unavailable.' });
        return;
    }

    const cmd = ingest.enqueueCommand('captureInventory', { playerId });
    const done = await waitForCommand(cmd.id, ITEM_SCAN_TIMEOUT_MS);
    if (!done) {
        json(res, 504, { error: 'The mod did not respond in time; retry.' });
        return;
    }
    if (done.result !== 'ok') {
        json(res, 409, {
            error: 'That player is not online, so there is no loaded character to read.',
            reason: String(done.result || 'player_not_found'),
        });
        return;
    }
    // The id the snapshot will be stored under is not knowable yet — it is assigned
    // on arrival. The caller watches the list for a newer row instead.
    json(res, 202, { queued: true, playerId, since: Date.now() });
}

/**
 * Apply a stored inventory snapshot back onto a live player.
 *
 * An action route, not a read route: it changes the game world, so every failure
 * is a real status code. It refuses rather than half-applies when
 *
 *   - the mod is not connected (nothing would run the command),
 *   - the target is not online (a character that is not loaded has no inventory
 *     to rebuild — the engine would have nowhere to put the items), or
 *   - the snapshot is truncated (restoring a knowingly partial loadout and
 *     reporting success is how an operator ends up believing they undid a bug
 *     they only half undid).
 *
 * Every applied rollback is written back into the action log, so the audit trail
 * lives in the same table as the events that motivated it.
 */
async function handleRollback(req, res) {
    let body;
    try {
        body = JSON.parse((await readBody(req, INGEST_INVENTORY_MAX_BYTES)) || '{}');
    } catch {
        badRequest(res, 'Malformed request body.');
        return;
    }

    const snapshotId = Number(body.snapshotId);
    if (!Number.isFinite(snapshotId)) { badRequest(res, 'snapshotId is required.'); return; }

    const snap = history.getInventory(snapshotId);
    if (!snap) { notFound(res); return; }

    if (!ingest.modConnected()) {
        json(res, 503, { error: 'Mod not connected; a rollback cannot be applied.' });
        return;
    }
    if (snap.truncated && body.allowTruncated !== true) {
        json(res, 409, {
            error: 'This snapshot was truncated when it was captured, so restoring it would '
                + 'silently drop items. Re-send with allowTruncated to apply it anyway.',
            reason: 'truncated',
        });
        return;
    }
    if (!snap.tree.length) {
        json(res, 409, { error: 'This snapshot recorded no items.', reason: 'empty' });
        return;
    }

    // The target is the snapshot's own player unless the caller names another —
    // restoring onto a different character is a legitimate admin move (a wiped
    // account, a reinstalled server) but it must be asked for explicitly.
    const playerId = String(body.playerId || snap.pid);
    const live = ingest.getSnapshot().data || {};
    const online = (Array.isArray(live.players) ? live.players : [])
        .some(p => p.id === playerId || p.steamId === playerId);
    if (!online) {
        json(res, 409, {
            error: 'That player is not online. A character that is not loaded has no '
                + 'inventory to rebuild.',
            reason: 'offline',
        });
        return;
    }

    // Vitals are opt-in and off by default, because the commonest snapshot to roll
    // back to is a DEATH — where the recorded health is 0. Re-applying that would
    // kill the character the operator just restored. The mod refuses a non-positive
    // value as well, but omitting the key entirely is the clearer contract.
    const args = { playerId, snapshotId, tree: toModTree(snap.tree) };
    if (body.restoreStats === true) args.stats = toModStats(snap.stats);
    const cmd = ingest.enqueueCommand('restorePlayer', args);
    const done = await waitForCommand(cmd.id, ROLLBACK_TIMEOUT_MS);
    if (!done) {
        // Deliberately NOT recorded as an applied rollback: we do not know whether
        // the mod ran it. The operator is told to check rather than reassured.
        json(res, 504, {
            error: 'The mod did not acknowledge the rollback in time. It may or may not '
                + 'have been applied — check the player before retrying.',
            reason: 'timeout',
        });
        return;
    }

    // The mod acks with a per-node result so a partial rebuild is reported rather
    // than assumed complete.
    const result = typeof done.result === 'object' && done.result !== null
        ? done.result
        : { result: String(done.result ?? 'ok') };
    const applied = result.result === 'ok' || result.ok === true || result.ok === 1;

    try {
        history.recordAction({
            pid: playerId,
            kind: applied ? 'rollback' : 'rollback_failed',
            pos: snap.pos ? [snap.pos.x, snap.pos.y, snap.pos.z] : null,
            detail: JSON.stringify({
                snapshotId,
                snapshotTs: snap.ts,
                reason: snap.reason,
                expected: snap.items,
                created: result.created ?? null,
                failed: result.failed ?? null,
                // Rebuilt but into the wrong container: the item is back, the
                // loadout is not the shape it was. Worth keeping in the audit row.
                misplaced: result.misplaced ?? null,
                removed: result.removed ?? null,
                error: result.error ?? null,
            }),
        });
    } catch (err) {
        // An applied rollback with no audit row is worse than a noisy log line.
        console.error('Failed to record the rollback audit row:', err);
    }

    json(res, applied ? 200 : 502, {
        applied,
        snapshotId,
        playerId,
        expected: snap.items,
        ...result,
    });
}

// ---- CF Tools Cloud (Data API + GameLabs) ----
// Read routes never 5xx: they return 200 with { connected:false, reason } so
// the client can degrade per-layer (house style, same as /api/catalog/*).
// Action POSTs are user-triggered (like /items) and DO return real errors.

const json = (res, status, body) => send(res, status, JSON.stringify(body), { 'Content-Type': 'application/json' });

// Map a CfToolsError to an action-route HTTP response.
function sendCftoolsActionError(res, err) {
    const reason = (err && err.reason) || 'unreachable';
    if (reason === 'rate_limited') {
        json(res, 429, { error: 'CF Tools rate limit hit; retry shortly.', reason, retryAfterMs: err.retryAfterMs || 10000 });
    } else if (reason === 'not_configured' || reason === 'no_api_id' || reason === 'no_profile') {
        json(res, 400, { error: err.message || 'CF Tools is not configured for this profile.', reason });
    } else {
        json(res, 502, { error: (err && err.message) || 'CF Tools request failed.', reason });
    }
}

// Handles any /api/cftools/* route. Dispatched BEFORE the profile gate because
// /app and /grants are profile-independent; profile-scoped routes resolve the
// profile themselves from X-Profile-ID. Returns true if it took the request.
async function handleCftoolsRoute(url, req, res) {
    const parts = url.pathname.split('/').filter(Boolean); // ['api','cftools',...]
    if (parts[0] !== 'api' || parts[1] !== 'cftools') return false;
    const route = parts.slice(2).join('/');

    const parseBody = async () => {
        const raw = await readBody(req);
        return raw ? JSON.parse(raw) : {};
    };

    // --- profile-independent: application credentials + grants ---

    if (route === 'app') {
        if (req.method === 'GET') {
            json(res, 200, cftoolsConfig.redactedView());
            return true;
        }
        if (req.method === 'PUT') {
            const body = await parseBody();
            if (!body.applicationId || !body.secret) { badRequest(res, 'applicationId and secret are required'); return true; }
            const previous = cftoolsConfig.getAppCredentials();
            cftoolsConfig.setAppCredentials({ applicationId: body.applicationId, secret: body.secret });
            cftools._resetState(); // old token/caches belong to the old credentials
            try {
                await cftools.getGrants(); // validate by attempting auth
                json(res, 200, { ok: true, ...cftoolsConfig.redactedView() });
            } catch (err) {
                // Bad credentials: roll back so a typo doesn't brick a working setup.
                if (previous) cftoolsConfig.setAppCredentials(previous); else cftoolsConfig.clearAppCredentials();
                cftools._resetState();
                json(res, 200, { ok: false, reason: (err && err.reason) || 'unreachable' });
            }
            return true;
        }
        methodNotAllowed(res);
        return true;
    }

    if (route === 'grants') {
        if (req.method !== 'GET') { methodNotAllowed(res); return true; }
        json(res, 200, await cftoolsService.buildGrants());
        return true;
    }

    // --- profile-scoped ---

    const xProfileId = req.headers['x-profile-id'];
    const profile = profiles.find(p => String(p.id).toLowerCase() === String(xProfileId).toLowerCase());

    if (route === 'binding') {
        if (!profile) { badRequest(res, 'Missing or invalid X-Profile-ID header'); return true; }
        if (req.method === 'GET') {
            json(res, 200, { binding: cftoolsConfig.getServerBinding(profile.id) });
            return true;
        }
        if (req.method === 'PUT') {
            const body = await parseBody();
            cftoolsConfig.setServerBinding(profile.id, body.apiId || null, body.label || null);
            json(res, 200, { ok: true, binding: cftoolsConfig.getServerBinding(profile.id) });
            return true;
        }
        methodNotAllowed(res);
        return true;
    }

    if (route === 'status') {
        if (req.method !== 'GET') { methodNotAllowed(res); return true; }
        json(res, 200, await cftoolsService.buildStatus(profile));
        return true;
    }

    if (route === 'live') {
        if (req.method !== 'GET') { methodNotAllowed(res); return true; }
        const layersParam = url.searchParams.get('layers');
        const layers = layersParam ? layersParam.split(',').map(s => s.trim()).filter(Boolean) : null;
        json(res, 200, await cftoolsService.buildLiveSnapshot(profile, layers));
        return true;
    }

    // Shape diagnostic: the untouched GameLabs payload, for when a layer renders but
    // a field on it is missing (e.g. a territory flag with no parsed tooltip). Reports
    // the envelope and entity key names so a Data API rename is visible, not inferred.
    if (route === 'raw/events' || route === 'raw/vehicles') {
        if (req.method !== 'GET') { methodNotAllowed(res); return true; }
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 25, 1), 200);
        json(res, 200, await cftoolsService.buildRawEntities(profile, route.slice(4), limit));
        return true;
    }

    // Remaining routes all need a resolved binding up-front.
    const bound = cftoolsService.resolveBinding(profile);

    if (route === 'stats' || route === 'leaderboard' || route === 'player' || route === 'gamelabs/actions') {
        if (req.method !== 'GET') { methodNotAllowed(res); return true; }
        if (bound.error) { json(res, 200, { connected: false, reason: bound.error }); return true; }
        try {
            if (route === 'stats') {
                const { data, stale } = await cftools.getStatistics(bound.apiId);
                json(res, 200, { connected: true, stale: !!stale, statistics: data });
            } else if (route === 'leaderboard') {
                const stat = url.searchParams.get('stat') || 'kills';
                const order = url.searchParams.get('order') || 'DESC';
                const limit = Math.min(Number(url.searchParams.get('limit')) || 25, 100);
                const { data, stale } = await cftools.getLeaderboard(bound.apiId, { stat, order, limit });
                json(res, 200, { connected: true, stale: !!stale, leaderboard: (data && data.leaderboard) || [] });
            } else if (route === 'player') {
                const ref = url.searchParams.get('ref');
                if (!ref) { badRequest(res, 'ref query parameter (cftools_id) is required'); return true; }
                const { data, stale } = await cftools.getPlayerStats(bound.apiId, ref);
                json(res, 200, { connected: true, stale: !!stale, player: data });
            } else {
                const actions = await cftoolsService.listGameLabsActions(bound.apiId);
                json(res, 200, { connected: true, actions });
            }
        } catch (err) {
            json(res, 200, { connected: false, reason: (err && err.reason) || 'unreachable' });
        }
        return true;
    }

    // --- action POSTs (real errors) ---

    if (route.startsWith('actions/') || route === 'gamelabs/action') {
        if (req.method !== 'POST') { methodNotAllowed(res); return true; }
        if (bound.error) {
            json(res, 400, { error: 'CF Tools is not configured for this profile.', reason: bound.error });
            return true;
        }
        const body = await parseBody();
        try {
            switch (route) {
                case 'actions/kick': {
                    if (!body.sessionId) { badRequest(res, 'sessionId is required'); return true; }
                    await cftools.kick(bound.apiId, body.sessionId, body.reason);
                    break;
                }
                case 'actions/message': {
                    if (!body.content) { badRequest(res, 'content is required'); return true; }
                    if (body.sessionId) await cftools.messagePrivate(bound.apiId, body.sessionId, body.content);
                    else await cftools.messageServer(bound.apiId, body.content);
                    break;
                }
                case 'actions/raw': {
                    if (!body.command) { badRequest(res, 'command is required'); return true; }
                    await cftools.rawRcon(bound.apiId, body.command);
                    break;
                }
                case 'actions/teleport': {
                    if (!body.steam64 || !Number.isFinite(Number(body.x)) || !Number.isFinite(Number(body.z))) {
                        badRequest(res, 'steam64, x and z are required'); return true;
                    }
                    await cftoolsService.teleportPlayer(bound.apiId, body.steam64, {
                        x: Number(body.x), y: Number(body.y) || 0, z: Number(body.z),
                    });
                    break;
                }
                case 'actions/heal': {
                    if (!body.steam64) { badRequest(res, 'steam64 is required'); return true; }
                    await cftoolsService.healPlayer(bound.apiId, body.steam64);
                    break;
                }
                case 'actions/kill': {
                    if (!body.steam64) { badRequest(res, 'steam64 is required'); return true; }
                    await cftoolsService.killPlayer(bound.apiId, body.steam64);
                    break;
                }
                case 'actions/spawn-item': {
                    if (!body.steam64 || !body.className) { badRequest(res, 'steam64 and className are required'); return true; }
                    await cftoolsService.spawnItem(bound.apiId, body.steam64, body.className, Number(body.quantity) || 1);
                    break;
                }
                case 'actions/spawn-loadout': {
                    if (!body.steam64 || !Array.isArray(body.items) || body.items.length === 0) {
                        badRequest(res, 'steam64 and a non-empty items array are required'); return true;
                    }
                    const results = await cftoolsService.spawnLoadout(bound.apiId, body.steam64, body.items);
                    json(res, 200, { ok: results.every(r => r.ok), results });
                    return true;
                }
                case 'gamelabs/action': {
                    if (!body.actionCode) { badRequest(res, 'actionCode is required'); return true; }
                    await cftools.postGameLabsAction(bound.apiId, {
                        actionCode: body.actionCode,
                        actionContext: body.actionContext,
                        referenceKey: body.referenceKey,
                        parameters: body.parameters,
                    });
                    break;
                }
                default:
                    notFound(res);
                    return true;
            }
            json(res, 200, { ok: true });
        } catch (err) {
            sendCftoolsActionError(res, err);
        }
        return true;
    }

    notFound(res);
    return true;
}

/**
 * Recursively walk a directory and collect files accepted by the predicate.
 * @param {string} base
 * @param {(name:string)=>boolean} accept
 * @returns {Promise<string[]>}
 */
async function walkFiles(base, accept) {
    /** @type {string[]} */
    const out = [];
    async function walk(dir) {
        let entries = [];
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            const p = join(dir, e.name);
            if (e.isDirectory()) {
                await walk(p);
                continue;
            }
            if (e.isFile()) {
                if (accept(e.name)) out.push(p);
                continue;
            }
            // Follow symlinks/junctions: determine target type via stat
            // This is important on Windows where junctions may appear as reparse points (isSymbolicLink)
            // and Dirent.isDirectory()/isFile() can both be false.
            if (typeof e.isSymbolicLink === 'function' && e.isSymbolicLink()) {
                try {
                    const s = await stat(p);
                    // Node's Stat has isDirectory/isFile
                    if (typeof s.isDirectory === 'function' && s.isDirectory()) {
                        await walk(p);
                    } else if (typeof s.isFile === 'function' && s.isFile()) {
                        if (accept(e.name)) out.push(p);
                    }
                } catch {
                    // Broken link or inaccessible target: skip
                }
                continue;
            }
        }
    }
    await walk(base);
    return out;
}

/**
 * Lint .xml and .json files under a directory using shared utils in src/utils/lint.js
 */
async function lintDataDir(root) {
    const { lintText } = await import('../src/utils/lint.js');
    const files = await walkFiles(root, (name) => /\.(xml|json)$/i.test(name));
    /** @type {{ path: string, type: 'xml'|'json', error: string }[]} */
    const failures = [];
    let okCount = 0;
    for (const p of files) {
        let content = '';
        try {
            content = await readFile(p, 'utf8');
        } catch (e) {
            failures.push({ path: p, type: p.toLowerCase().endsWith('.json') ? 'json' : 'xml', error: 'Failed to read: ' + (e && e.message ? e.message : String(e)) });
            continue;
        }
        const kind = p.toLowerCase().endsWith('.json') ? 'json' : 'xml';
        const res = lintText(kind, content);
        if (res.ok) {
            okCount++;
        } else {
            /** @type {{ path: string, type: 'xml'|'json', error: string, line?: number, column?: number }} */
            const fail = { path: p, type: /** @type {'xml'|'json'} */(kind), error: res.error };
            if (Number.isFinite(res.line) && Number.isFinite(res.column)) {
                // @ts-ignore - runtime check above
                fail.line = res.line;
                // @ts-ignore - runtime check above
                fail.column = res.column;
            }
            failures.push(fail);
        }
    }
    return {
        ok: failures.length === 0,
        dataDir: root,
        totals: { files: files.length, ok: okCount, failed: failures.length },
        failures
    };
}

// Parse a single-line trader .map entry into structured data
function parseTraderMapLine(line) {
    const raw = String(line || '').trim();
    // Expected: Class.File|x y z|ox oy oz|a,b,c
    const parts = raw.split('|');
    const head = (parts[0] || '').trim();
    const dotIdx = head.lastIndexOf('.');
    const className = dotIdx > 0 ? head.slice(0, dotIdx) : '';
    const traderFileName = dotIdx > 0 ? head.slice(dotIdx + 1) : '';
    const pos = (parts[1] || '').trim().split(/\s+/).map(Number).filter(n => !Number.isNaN(n));
    while (pos.length < 3) pos.push(0);
    const ori = (parts[2] || '').trim().split(/\s+/).map(Number).filter(n => !Number.isNaN(n));
    while (ori.length < 3) ori.push(0);
    const gear = (parts[3] || '').trim().length
        ? (parts[3] || '').split(',').map(s => s.trim()).filter(Boolean)
        : [];
    return {
        className,
        traderFileName,
        position: pos.slice(0, 3),
        orientation: ori.slice(0, 3),
        gear
    };
}

// Build a single-line trader .map entry from structured data
function buildTraderMapLine({ className, traderFileName, position, orientation, gear }) {
    const pos = (Array.isArray(position) ? position : []).map(n => Number(n)).slice(0, 3);
    while (pos.length < 3) pos.push(0);
    const ori = (Array.isArray(orientation) ? orientation : []).map(n => Number(n)).slice(0, 3);
    while (ori.length < 3) ori.push(0);
    const posStr = `${pos[0]} ${pos[1]} ${pos[2]}`;
    const oriStr = `${ori[0]} ${ori[1]} ${ori[2]}`;
    const gearArr = Array.isArray(gear) ? gear.map(s => String(s).trim()).filter(Boolean) : [];
    const gearStr = gearArr.join(',');
    return `${String(className)}.${String(traderFileName)}|${posStr}|${oriStr}|${gearStr}`;
}

const server = http.createServer(async (req, res) => {
    try {
        // Preflight CORS
        if (req.method === 'OPTIONS') {
            send(res, 204, '', {});
            return;
        }

        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const {pathname} = url;

        // Companion-mod catalog read side (profile-independent; handled before the profile check)
        if (pathname.startsWith('/api/catalog')) {
            if (await handleCatalogRoute(pathname, req, res)) return;
        }

        // Companion-mod ingest write side (mod-facing push/poll; no X-Profile-ID)
        if (pathname.startsWith('/ingest')) {
            if (await handleIngestRoute(pathname, req, res)) return;
        }

        // Live world-item scan (profile-independent; round-trips a scanItems command to the mod)
        if (pathname === '/items' || pathname.startsWith('/items/')) {
            if (await handleItemsRoute(url, req, res)) return;
        }

        // Recorded player history (profile-independent; sourced from the mod's snapshot
        // stream, so it must be reachable on a server with no CF Tools binding at all)
        if (pathname.startsWith('/api/history')) {
            if (await handleHistoryRoute(url, req, res)) return;
        }

        // CF Tools Cloud proxy (resolves its own profile; /app and /grants are profile-independent)
        if (pathname.startsWith('/api/cftools')) {
            if (await handleCftoolsRoute(url, req, res)) return;
        }

        // Profile & Snapshot Management
        if (pathname === '/api/profiles' || pathname.startsWith('/api/profiles/')) {
            const parts = pathname.split('/').filter(Boolean);
            
            // /api/profiles
            if (parts.length === 2) {
                if (req.method === 'GET') {
                    const profilesWithAddons = await Promise.all(profiles.map(async (p) => {
                        return {
                            ...p,
                            addons: await getDetectedAddons(p.serverPath, p.missionName)
                        };
                    }));
                    send(res, 200, JSON.stringify(profilesWithAddons), {'Content-Type': 'application/json'});
                    return;
                }
                if (req.method === 'POST') {
                    const body = await readBody(req);
                    const data = JSON.parse(body || '{}');
                    if (!data.name || !data.serverPath || !data.missionName) {
                        badRequest(res, 'Missing name, serverPath or missionName');
                        return;
                    }
                    const newProfile = {
                        id: crypto.randomUUID(),
                        name: data.name,
                        serverPath: resolve(data.serverPath),
                        missionName: data.missionName,
                        // Stored only when the runtime recognises it; a junk zone
                        // here would silently fall back and misdate every log line.
                        logTimeZone: normalizeTimeZone(data.logTimeZone) || hostTimeZone
                    };
                    profiles.push(newProfile);
                    await saveProfiles();
                    send(res, 201, JSON.stringify(newProfile), {'Content-Type': 'application/json'});
                    return;
                }
                methodNotAllowed(res);
                return;
            }

            const profileId = parts[2];

            // /api/profiles/:id/snapshots
            if (parts.length === 4 && parts[3] === 'snapshots') {
                const { snapshotDir } = await getSnapshotPaths(profileId);
                if (!snapshotDir) { notFound(res); return; }

                if (req.method === 'GET') {
                    try {
                        const entries = await readdir(snapshotDir, { withFileTypes: true });
                        const snapshots = [];
                        for (const entry of entries) {
                            if (entry.isDirectory()) {
                                try {
                                    const metaPath = join(snapshotDir, entry.name, 'metadata.json');
                                    const metaData = await readFile(metaPath, 'utf8');
                                    snapshots.push(JSON.parse(metaData));
                                } catch { /* skip */ }
                            }
                        }
                        snapshots.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                        send(res, 200, JSON.stringify(snapshots), { 'Content-Type': 'application/json' });
                    } catch {
                        send(res, 200, JSON.stringify([]), { 'Content-Type': 'application/json' });
                    }
                    return;
                }
                if (req.method === 'POST') {
                    const body = await readBody(req);
                    const data = JSON.parse(body || '{}');
                    try {
                        const metadata = await internalCreateSnapshot(
                            profileId,
                            data.name,
                            data.description,
                            req.headers['x-editor-id']
                        );
                        send(res, 201, JSON.stringify(metadata), { 'Content-Type': 'application/json' });
                    } catch (e) {
                        send(res, 500, JSON.stringify({ error: e.message }), { 'Content-Type': 'application/json' });
                    }
                    return;
                }
                methodNotAllowed(res);
                return;
            }

            // /api/profiles/:id/snapshots/:snapshotId
            if (parts.length === 5 && parts[3] === 'snapshots') {
                const snapshotId = parts[4];
                const { snapshotDir } = await getSnapshotPaths(profileId);
                if (!snapshotDir) { notFound(res); return; }

                if (req.method === 'DELETE') {
                    try {
                        await rm(join(snapshotDir, snapshotId), { recursive: true, force: true });
                        send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
                    } catch (e) {
                        send(res, 500, JSON.stringify({ error: e.message }), { 'Content-Type': 'application/json' });
                    }
                    return;
                }
                methodNotAllowed(res);
                return;
            }

            // /api/profiles/:id/snapshots/:snapshotId/restore
            if (parts.length === 6 && parts[3] === 'snapshots' && parts[5] === 'restore') {
                const snapshotId = parts[4];
                const { snapshotDir, paths: pPaths } = await getSnapshotPaths(profileId);
                if (!pPaths) { notFound(res); return; }

                if (req.method === 'POST') {
                    const srcDir = join(snapshotDir, snapshotId);
                    try {
                        await stat(srcDir);
                        const meta = await readFile(join(srcDir, 'metadata.json'), 'utf8');
                        const metaJson = JSON.parse(meta);
                        await internalCreateSnapshot(profileId, `Pre-restore: ${metaJson.name}`, `Auto backup before restore`, 'system');
                        const items = await readdir(srcDir);
                        for (const item of items) {
                            if (item === 'metadata.json') continue;
                            const src = join(srcDir, item);
                            const dest = item === 'ExpansionMod' ? join(pPaths.profilesPath, 'ExpansionMod') : join(pPaths.missionPath, item);
                            try { await rm(dest, { recursive: true, force: true }); } catch { /* ignore */ }
                            await cp(src, dest, { recursive: true });
                        }
                        send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
                    } catch (e) {
                        send(res, 500, JSON.stringify({ error: e.message }), { 'Content-Type': 'application/json' });
                    }
                    return;
                }
                methodNotAllowed(res);
                return;
            }

            // /api/profiles/:id/missions
            if (parts.length === 4 && parts[3] === 'missions') {
                const profile = profiles.find(p => String(p.id).toLowerCase() === String(profileId).toLowerCase());
                if (!profile) { notFound(res); return; }
                try {
                    const mpmissionsPath = join(profile.serverPath, 'mpmissions');
                    const entries = await readdir(mpmissionsPath, { withFileTypes: true });
                    const missions = entries.filter(e => e.isDirectory()).map(e => e.name);
                    send(res, 200, JSON.stringify(missions), {'Content-Type': 'application/json'});
                } catch {
                    send(res, 200, JSON.stringify([]), {'Content-Type': 'application/json'});
                }
                return;
            }

            // /api/profiles/:id (Individual profile operations)
            if (parts.length === 3) {
                const index = profiles.findIndex(p => p.id === profileId);
                if (index === -1) { notFound(res); return; }

                if (req.method === 'GET') {
                    const profileWithAddons = { ...profiles[index], addons: await getDetectedAddons(profiles[index].serverPath, profiles[index].missionName) };
                    send(res, 200, JSON.stringify(profileWithAddons), {'Content-Type': 'application/json'});
                    return;
                }
                if (req.method === 'PUT') {
                    const body = await readBody(req);
                    const data = JSON.parse(body || '{}');
                    profiles[index] = { ...profiles[index], ...data, id: profileId };
                    if ('logTimeZone' in data) {
                        profiles[index].logTimeZone =
                            normalizeTimeZone(data.logTimeZone) || hostTimeZone;
                    }
                    await saveProfiles();
                    groupFolderCaches.delete(profileId);
                    groupFilesCaches.delete(profileId);
                    send(res, 200, JSON.stringify(profiles[index]), {'Content-Type': 'application/json'});
                    return;
                }
                if (req.method === 'DELETE') {
                    profiles.splice(index, 1);
                    await saveProfiles();
                    groupFolderCaches.delete(profileId);
                    groupFilesCaches.delete(profileId);
                    send(res, 200, JSON.stringify({ok: true}), {'Content-Type': 'application/json'});
                    return;
                }
                methodNotAllowed(res);
                return;
            }
        }


        // Helper to scan missions for a raw path (used when creating a new profile)
        if (pathname === '/api/scan-missions' && req.method === 'POST') {
            const body = await readBody(req);
            const data = JSON.parse(body || '{}');
            if (!data.serverPath) {
                badRequest(res, 'Missing serverPath');
                return;
            }
            try {
                const resolvedServerPath = resolve(data.serverPath);
                const mpmissionsPath = join(resolvedServerPath, 'mpmissions');
                console.log(`[API] Scanning missions in: ${mpmissionsPath}`);
                
                // Check if directory exists first
                const s = await stat(mpmissionsPath);
                if (!s.isDirectory()) {
                    throw new Error('mpmissions is not a directory');
                }

                const entries = await readdir(mpmissionsPath, { withFileTypes: true });
                const missions = entries.filter(e => e.isDirectory()).map(e => e.name);
                console.log(`[API] Found ${missions.length} missions: ${missions.join(', ')}`);
                
                if (missions.length === 0) {
                    send(res, 200, JSON.stringify({
                        missions: [],
                        warning: 'mpmissions folder exists but contains no mission subfolders.'
                    }), {'Content-Type': 'application/json'});
                } else {
                    send(res, 200, JSON.stringify({
                        missions,
                        ok: true
                    }), {'Content-Type': 'application/json'});
                }
            } catch (err) {
                console.error(`[API] Error scanning missions in ${data.serverPath}:`, err.message);
                const message = err.code === 'ENOENT' 
                    ? `Could not find 'mpmissions' folder in: ${data.serverPath}`
                    : err.message;
                send(res, 404, JSON.stringify({
                    error: message,
                    missions: []
                }), {'Content-Type': 'application/json'});
            }
            return;
        }

        // All other /api/ endpoints require a profile ID header
        const xProfileId = req.headers['x-profile-id'];
        const profile = profiles.find(p => String(p.id).toLowerCase() === String(xProfileId).toLowerCase());

        if (!profile && pathname.startsWith('/api/') && pathname !== '/api/health') {
            console.warn(`[400] Profile not found for path: ${pathname}, Profile ID: ${xProfileId}`);
            send(res, 400, JSON.stringify({error: 'Missing or invalid X-Profile-ID header'}), {'Content-Type': 'application/json'});
            return;
        }

        const paths = profile ? getPaths(profile) : null;

        // GET/PUT definitions (allow optional trailing slash)
        if (pathname === '/api/definitions' || pathname === '/api/definitions/') {
            if (req.method === 'GET') {
                try {
                    const xml = await readFile(paths.defsPath, 'utf8');
                    send(res, 200, xml, {'Content-Type': 'application/xml; charset=utf-8'});
                } catch {
                    notFound(res);
                }
                return;
            }
            if (req.method === 'PUT') {
                const body = await readBody(req);
                if (!body || typeof body !== 'string') {
                    badRequest(res, 'Empty body');
                    return;
                }
                const p = paths.defsPath;
                await createBackupIfExists(p);
                await writeFileAtomic(p, body);
                send(res, 200, JSON.stringify({ok: true}), {'Content-Type': 'application/json'});
                return;
            }
            methodNotAllowed(res);
            return;
        }

        // GET economy core (cfgeconomycore.xml)
        if (pathname === '/api/economycore' || pathname === '/api/economycore/') {
            try {
                const xml = await readFile(paths.economyCorePath, 'utf8');
                const content = String(xml || '').trim();
                if (content.length > 0) {
                    send(res, 200, xml, {'Content-Type': 'application/xml; charset=utf-8'});
                } else {
                    const synth = await synthesizeEconomyCoreXml(paths);
                    send(res, 200, synth, {'Content-Type': 'application/xml; charset=utf-8'});
                }
            } catch {
                // If missing, synthesize from filesystem structure
                const synth = await synthesizeEconomyCoreXml(paths);
                send(res, 200, synth, {'Content-Type': 'application/xml; charset=utf-8'});
            }
            return;
        }

        // POST create a new custom types group (a <ce folder="db/<name>"> block with
        // an empty types.xml + spawnabletypes.xml on disk). Distinct from the types PUT
        // so that "create structure" and "write content" stay separate concerns.
        if (pathname === '/api/types-group' || pathname === '/api/types-group/') {
            if (req.method !== 'POST') {
                methodNotAllowed(res);
                return;
            }
            let data;
            try {
                data = JSON.parse(await readBody(req) || '{}');
            } catch {
                badRequest(res, 'Invalid JSON body');
                return;
            }
            const group = String(data.name || '').trim();
            if (!isSafeName(group)) {
                badRequest(res, 'Invalid group name (letters, numbers, dot, dash, underscore only)');
                return;
            }
            const reserved = new Set(['vanilla', 'vanilla_overrides', '__root']);
            if (reserved.has(group.toLowerCase())) {
                badRequest(res, `"${group}" is a reserved group name`);
                return;
            }
            const folder = `db/${group}`;
            const seedFiles = [
                { name: 'types.xml', type: 'types' },
                { name: 'spawnabletypes.xml', type: 'spawnabletypes' },
            ];

            // Idempotent: if the group is already declared, report it rather than erroring.
            const existingFolders = await getGroupFolderMap(profile, paths);
            const alreadyExists = Object.prototype.hasOwnProperty.call(existingFolders, group);

            // Create the folder + empty seed files on disk (only if absent).
            const dir = join(paths.missionPath, folder);
            await mkdir(dir, {recursive: true});
            const seeds = {
                'types.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<types>\n</types>\n',
                'spawnabletypes.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<spawnabletypes>\n</spawnabletypes>\n',
            };
            for (const [name, content] of Object.entries(seeds)) {
                const target = join(dir, name);
                let exists = false;
                try {
                    await stat(target);
                    exists = true;
                } catch {
                    // absent
                }
                if (!exists) {
                    await writeFileAtomic(target, content);
                }
            }

            // Register the group + files in cfgeconomycore.xml and invalidate caches.
            await ensureTypesGroupInEconomyCore(profile, paths, folder, seedFiles);

            send(res, 200, JSON.stringify({
                ok: true,
                group,
                folder,
                file: 'types',
                spawnableFile: 'spawnabletypes',
                alreadyExists,
            }), {'Content-Type': 'application/json'});
            return;
        }

        // POST stash report within range; returns JSON { players: [{id, aliases[], count}] }
        if (pathname === '/api/logs/stash-report') {
            if (req.method !== 'POST') {
                methodNotAllowed(res);
                return;
            }
            try {
                const body = await readBody(req);
                const data = JSON.parse(body || '{}');
                const start = data.start ? new Date(data.start) : null;
                const end = data.end ? new Date(data.end) : null;
                if ((start && isNaN(start.getTime())) || (end && isNaN(end.getTime())) || (start && end && start > end)) {
                    badRequest(res, 'Invalid start/end datetimes.');
                    return;
                }
                const report = await generateStashReport(start && !isNaN(start.getTime()) ? start : null, end && !isNaN(end.getTime()) ? end : null, paths);
                send(res, 200, JSON.stringify({players: report}), {'Content-Type': 'application/json'});
            } catch {
                send(res, 500, JSON.stringify({error: 'Failed to generate stash report'}), {'Content-Type': 'application/json'});
            }
            return;
        }

        // ----- ADM -> history import -----
        //
        // These sit behind the profile gate, unlike the rest of /api/history/*.
        // The import needs serverPath to find both the log archive and the mod's
        // GUID ledger, and neither is knowable without a profile.

        // GET preview: what would be imported, and in which timezone.
        if (pathname === '/api/logs/adm/scan') {
            if (req.method !== 'GET') { methodNotAllowed(res); return; }
            try {
                const root = url.searchParams.get('root') || paths.logsDirPath;
                // The zone comes from the profile; an explicit one lets the panel
                // preview a different choice before committing to it.
                const zone = admImport.toZone(
                    url.searchParams.get('timeZone') || paths.logTimeZone);
                const [scan, ledger] = await Promise.all([
                    admImport.scanAdmArchive(root, zone),
                    admImport.readGuidLedger(profile.serverPath),
                ]);
                send(res, 200, JSON.stringify({
                    root,
                    defaultRoot: paths.logsDirPath,
                    profileTimeZone: paths.logTimeZone,
                    offset: scan.offset,
                    zone: scan.zone,
                    ledger: { ok: ledger.ok, size: ledger.size, path: ledger.path, error: ledger.error || null },
                    files: scan.files.map(f => ({
                        path: f.path,
                        bytes: f.bytes,
                        startsAt: f.header ? admImport.headerInstant(f.header, zone) : null,
                        detectedOffset: f.detected ? f.detected.offsetMinutes : null,
                        detectedSource: f.detected ? f.detected.source : null,
                        confident: !!f.confident,
                        skip: f.skip,
                    })),
                }), {'Content-Type': 'application/json'});
            } catch (e) {
                send(res, 500, JSON.stringify({error: `Failed to scan logs: ${e.message}`}), {'Content-Type': 'application/json'});
            }
            return;
        }

        // POST start an import; GET poll it; DELETE cancel it.
        if (pathname === '/api/logs/adm/import') {
            if (req.method === 'GET') {
                send(res, 200, JSON.stringify(admJobState()), {'Content-Type': 'application/json'});
                return;
            }
            if (req.method === 'DELETE') {
                admJob?.controller.abort();
                send(res, 200, JSON.stringify(admJobState()), {'Content-Type': 'application/json'});
                return;
            }
            if (req.method !== 'POST') { methodNotAllowed(res); return; }
            if (admJob && admJob.running) {
                // An import is a long write against one database; two at once would
                // interleave transactions and make the progress meaningless.
                send(res, 409, JSON.stringify({error: 'An import is already running', job: admJobState()}),
                    {'Content-Type': 'application/json'});
                return;
            }
            try {
                const data = JSON.parse(await readBody(req) || '{}');
                const root = data.root || paths.logsDirPath;
                // A zone name is the normal case. A bare offset is the escape hatch
                // for an archive from a server whose zone nobody remembers.
                const zone = admImport.toZone(
                    Number.isFinite(data.offsetMinutes) && !data.timeZone
                        ? { offsetMinutes: Number(data.offsetMinutes) }
                        : (data.timeZone || paths.logTimeZone));
                const scan = await admImport.scanAdmArchive(root, zone);
                const only = Array.isArray(data.paths) && data.paths.length
                    ? new Set(data.paths.map(String))
                    : null;
                const files = only ? scan.files.filter(f => only.has(f.path)) : scan.files;
                const ledger = await admImport.readGuidLedger(profile.serverPath);

                startAdmImport({ files, zone, ledger: ledger.map, root });
                send(res, 202, JSON.stringify(admJobState()), {'Content-Type': 'application/json'});
            } catch (e) {
                send(res, 500, JSON.stringify({error: `Failed to start import: ${e.message}`}), {'Content-Type': 'application/json'});
            }
            return;
        }

        // POST logs ADM records within range, returns a downloadable file
        if (pathname === '/api/logs/adm') {
            if (req.method !== 'POST') {
                methodNotAllowed(res);
                return;
            }
            let body = '';
            try {
                body = await readBody(req);
                const data = JSON.parse(body || '{}');

                const startMs = parseServerLocal(data.start, paths.logTimeZone);
                const endMs = parseServerLocal(data.end, paths.logTimeZone);
                if (startMs === null || endMs === null || startMs > endMs) {
                    badRequest(res, 'Invalid start/end datetimes.');
                    return;
                }
                const start = new Date(startMs);
                const end = new Date(endMs);

                // Use X/Z for planar distance; accept data.z primarily, fall back to legacy data.y for compatibility
                const xf = Number(data.x);
                let zf = Number(data.z);
                const rf = Number(data.radius);
                if (!Number.isFinite(zf) && Number.isFinite(Number(data.y))) {
                    zf = Number(data.y); // backward compatibility with legacy clients
                }
                const hasFilter = Number.isFinite(xf) && Number.isFinite(zf) && Number.isFinite(rf);
                const expandByIds = !!data.expandByIds;

                // Diagnostics so the client can explain an empty result rather than
                // silently handing back a header-only file.
                const stats = {};

                let lines;
                if (hasFilter) {
                    // Pass 1: collect within radius to determine unique ids
                    const spatialLines = await collectAdmRecordsInRange(start, end, {x: xf, z: zf, radius: rf}, undefined, paths, stats);
                    const idSet = new Set();
                    for (const row of spatialLines) {
                        const id = tryParseLineId(row);
                        if (id) idSet.add(id);
                    }

                    if (expandByIds) {
                        // Pass 2: collect by ids only (ignore positional filter), preserving order
                        lines = await collectAdmRecordsInRange(start, end, undefined, idSet, paths);
                    }
                    else
                        lines = spatialLines;
                } else {
                    // No spatial filtering; single pass
                    lines = await collectAdmRecordsInRange(start, end, undefined, undefined, paths, stats);
                }

                // The extract is written in the server's local time, exactly like the
                // logs it came from, so anything that reads .ADM files — including
                // this product's own importer — reads it back correctly.
                const startLocal = serverLocalParts(startMs, paths.logTimeZone);
                const endLocal = serverLocalParts(endMs, paths.logTimeZone);
                const header = `AdminLog started on ${startLocal.date} at ${startLocal.time}`;
                const content = [header, ...lines].join('\n');

                const filename = `${startLocal.stamp}_to_${endLocal.stamp}.ADM`;
                const admHeaders = {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Content-Disposition': `attachment; filename="${filename}"`,
                    'X-Adm-Files-Found': String(stats.filesFound ?? 0),
                    'X-Adm-Files-Dated': String(stats.filesDated ?? 0),
                    'X-Adm-Lines-In-Range': String(stats.linesInRange ?? 0),
                    'X-Adm-Match-Count': String(lines.length)
                };
                if (hasFilter && Number.isFinite(stats.nearestDistance)) {
                    admHeaders['X-Adm-Nearest-Distance'] = stats.nearestDistance.toFixed(1);
                }
                send(res, 200, content, admHeaders);
            } catch (e) {
                console.error('ADM fetch error:', e);
                send(res, 500, JSON.stringify({error: 'Failed to fetch ADM records'}), {'Content-Type': 'application/json'});
            }
            return;
        }

        // POST Expansion logs within range, returns a downloadable file
        if (pathname === '/api/logs/expansion') {
            if (req.method !== 'POST') {
                methodNotAllowed(res);
                return;
            }
            let body = '';
            try {
                body = await readBody(req);
                const data = JSON.parse(body || '{}');

                const startMs = parseServerLocal(data.start, paths.logTimeZone);
                const endMs = parseServerLocal(data.end, paths.logTimeZone);
                if (startMs === null || endMs === null || startMs > endMs) {
                    badRequest(res, 'Invalid start/end datetimes.');
                    return;
                }
                const start = new Date(startMs);
                const end = new Date(endMs);

                const xf = Number(data.x);
                let zf = Number(data.z);
                const rf = Number(data.radius);
                if (!Number.isFinite(zf) && Number.isFinite(Number(data.y))) {
                    zf = Number(data.y);
                }
                const hasFilter = Number.isFinite(xf) && Number.isFinite(zf) && Number.isFinite(rf);
                const expandByIds = !!data.expandByIds;

                let lines;
                if (hasFilter) {
                    const spatialLines = await collectExpansionRecordsInRange(start, end, {x: xf, z: zf, radius: rf}, undefined, paths);
                    const idSet = new Set();
                    for (const row of spatialLines) {
                        const id = tryParseLineId(row);
                        if (id) idSet.add(id);
                    }

                    if (expandByIds) {
                        lines = await collectExpansionRecordsInRange(start, end, undefined, idSet, paths);
                    }
                    else
                        lines = spatialLines;
                } else {
                    lines = await collectExpansionRecordsInRange(start, end, undefined, undefined, paths);
                }

                const startLocal = serverLocalParts(startMs, paths.logTimeZone);
                const endLocal = serverLocalParts(endMs, paths.logTimeZone);
                const header = `ExpansionLog started on ${startLocal.date} at ${startLocal.time}`;
                const content = [header, ...lines].join('\n');

                const filename = `${startLocal.stamp}_to_${endLocal.stamp}.log`;
                send(res, 200, content, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Content-Disposition': `attachment; filename="${filename}"`
                });
            } catch (e) {
                console.error('Expansion log fetch error:', e);
                send(res, 500, JSON.stringify({error: 'Failed to fetch Expansion log records'}), {'Content-Type': 'application/json'});
            }
            return;
        }

        // GET/PUT Expansion Airdrop Settings (core settings + containers)
        if (pathname === '/api/expansion/airdrop-settings') {
            const profileId = req.headers['x-profile-id'];
            const profile = profiles.find(p => String(p.id).toLowerCase() === String(profileId).toLowerCase());
            if (!profile) { notFound(res); return; }
            const paths = getPaths(profile);
            const target = paths.airdropSettingsPath;
            if (req.method === 'GET') {
                try {
                    const content = await readValidJsonFile(target);
                    send(res, 200, content, {'Content-Type': 'application/json'});
                } catch {
                    send(res, 404, JSON.stringify({ error: 'AirdropSettings.json not found' }), {'Content-Type': 'application/json'});
                }
                return;
            }
            if (req.method === 'PUT') {
                try {
                    const body = await readBody(req);
                    // Validate JSON before writing to disk
                    const parsed = JSON.parse(body || '{}');
                    // Guard against wiping containers: if the editor fell back to empty
                    // defaults (e.g. a transient failed load) and the user saves, an empty
                    // Containers[] would clobber a populated file — leaving every airdrop
                    // mission with "no compatible container" at spawn. Refuse that write.
                    const incomingContainers = Array.isArray(parsed.Containers) ? parsed.Containers : [];
                    if (incomingContainers.length === 0) {
                        let existingContainers = [];
                        try {
                            const existing = JSON.parse(await readValidJsonFile(target));
                            existingContainers = Array.isArray(existing.Containers) ? existing.Containers : [];
                        } catch { /* no readable existing file — nothing to protect */ }
                        if (existingContainers.length > 0) {
                            send(res, 409, JSON.stringify({ error: `Refusing to save — this would wipe ${existingContainers.length} existing airdrop container(s) from AirdropSettings.json (every mission would then fail with "no compatible container"). Reload the editor so it re-reads the current containers, then save again.` }), {'Content-Type': 'application/json'});
                            return;
                        }
                    }
                    const out = JSON.stringify(parsed, null, 4);
                    await createBackupIfExists(target);
                    await writeFileAtomic(target, out);
                    send(res, 200, JSON.stringify({ ok: true }), {'Content-Type': 'application/json'});
                } catch (e) {
                    badRequest(res, `Invalid AirdropSettings payload: ${e.message}`);
                }
                return;
            }
            methodNotAllowed(res);
            return;
        }

        // GET/PUT Expansion Mission Settings (mission scheduler = airdrop scheduler)
        if (pathname === '/api/expansion/mission-settings') {
            const profileId = req.headers['x-profile-id'];
            const profile = profiles.find(p => String(p.id).toLowerCase() === String(profileId).toLowerCase());
            if (!profile) { notFound(res); return; }
            const paths = getPaths(profile);
            const target = paths.missionSettingsPath;
            if (req.method === 'GET') {
                try {
                    const content = await readValidJsonFile(target);
                    send(res, 200, content, {'Content-Type': 'application/json'});
                } catch {
                    send(res, 404, JSON.stringify({ error: 'MissionSettings.json not found' }), {'Content-Type': 'application/json'});
                }
                return;
            }
            if (req.method === 'PUT') {
                try {
                    const body = await readBody(req);
                    // Validate JSON before writing to disk
                    const parsed = JSON.parse(body || '{}');
                    const out = JSON.stringify(parsed, null, 4);
                    await createBackupIfExists(target);
                    await writeFileAtomic(target, out);
                    send(res, 200, JSON.stringify({ ok: true }), {'Content-Type': 'application/json'});
                } catch (e) {
                    badRequest(res, `Invalid MissionSettings payload: ${e.message}`);
                }
                return;
            }
            methodNotAllowed(res);
            return;
        }

        // GET/PUT Expansion Territory Settings (server-global, under profiles/ExpansionMod/Settings).
        // GET/PUT Expansion Base Building Settings (per-map, under mpmissions/<map>/expansion/settings).
        // Both are edited whole-object so m_Version and any fields the UI doesn't surface are preserved.
        if (pathname === '/api/expansion/territory-settings' || pathname === '/api/expansion/basebuilding-settings') {
            const profileId = req.headers['x-profile-id'];
            const profile = profiles.find(p => String(p.id).toLowerCase() === String(profileId).toLowerCase());
            if (!profile) { notFound(res); return; }
            const paths = getPaths(profile);
            const isTerritory = pathname === '/api/expansion/territory-settings';
            const target = isTerritory ? paths.territorySettingsPath : paths.baseBuildingSettingsPath;
            const label = isTerritory ? 'TerritorySettings.json' : 'BaseBuildingSettings.json';
            if (req.method === 'GET') {
                try {
                    const content = await readValidJsonFile(target);
                    send(res, 200, content, {'Content-Type': 'application/json'});
                } catch {
                    // File missing OR corrupt — client seeds a default object.
                    send(res, 404, JSON.stringify({ error: `${label} not found` }), {'Content-Type': 'application/json'});
                }
                return;
            }
            if (req.method === 'PUT') {
                try {
                    const body = await readBody(req);
                    // Validate JSON before writing to disk
                    const parsed = JSON.parse(body || '{}');
                    const out = JSON.stringify(parsed, null, 4);
                    await createBackupIfExists(target);
                    await writeFileAtomic(target, out);
                    send(res, 200, JSON.stringify({ ok: true }), {'Content-Type': 'application/json'});
                } catch (e) {
                    badRequest(res, `Invalid ${label} payload: ${e.message}`);
                }
                return;
            }
            methodNotAllowed(res);
            return;
        }

        // Modular loadout templates, stored per-map under .lootmaster/loadouts.json. The profile
        // gate above guarantees `paths` here (a request with no valid X-Profile-ID got a 400).
        if (pathname === '/api/loadouts' || pathname.startsWith('/api/loadouts/')) {
            const target = paths.loadoutsPath;
            const idMatch = pathname.match(/^\/api\/loadouts\/(.+)$/);
            const id = idMatch ? decodeURIComponent(idMatch[1]) : null;

            if (req.method === 'GET' && !id) {
                const list = await loadLoadouts(target);
                send(res, 200, JSON.stringify(list), {'Content-Type': 'application/json'});
                return;
            }
            if (req.method === 'PUT' && id) {
                try {
                    const loadout = JSON.parse((await readBody(req)) || '{}');
                    if (!loadout || loadout.id !== id) {
                        badRequest(res, 'Loadout id in body must match the URL');
                        return;
                    }
                    await mutateLoadouts(target, (list) => {
                        const idx = list.findIndex((l) => l.id === id);
                        if (idx >= 0) list[idx] = loadout; else list.push(loadout);
                        return list;
                    });
                    send(res, 200, JSON.stringify({ok: true}), {'Content-Type': 'application/json'});
                } catch (e) {
                    badRequest(res, `Invalid loadout payload: ${e.message}`);
                }
                return;
            }
            if (req.method === 'DELETE' && id) {
                await mutateLoadouts(target, (list) => list.filter((l) => l.id !== id));
                send(res, 200, JSON.stringify({ok: true}), {'Content-Type': 'application/json'});
                return;
            }
            methodNotAllowed(res);
            return;
        }

        // GET/PUT Lootmaster Airdrop Locations library (Lootmaster-owned, not read by the game).
        // Normalised drop zones that missions reference by Name; stored under .lootmaster/.
        if (pathname === '/api/expansion/airdrop-locations') {
            const profileId = req.headers['x-profile-id'];
            const profile = profiles.find(p => String(p.id).toLowerCase() === String(profileId).toLowerCase());
            if (!profile) { notFound(res); return; }
            const paths = getPaths(profile);
            const target = paths.airdropLocationsPath;
            if (req.method === 'GET') {
                try {
                    const content = await readValidJsonFile(target);
                    send(res, 200, content, {'Content-Type': 'application/json'});
                } catch {
                    // File missing OR corrupt (empty/NUL/garbage) — client seeds from existing missions.
                    send(res, 404, JSON.stringify({ error: 'airdrop-locations.json not found' }), {'Content-Type': 'application/json'});
                }
                return;
            }
            if (req.method === 'PUT') {
                try {
                    const body = await readBody(req);
                    // Validate JSON before writing to disk
                    const parsed = JSON.parse(body || '{}');
                    const out = JSON.stringify(parsed, null, 4);
                    await createBackupIfExists(target);
                    await writeFileAtomic(target, out);
                    send(res, 200, JSON.stringify({ ok: true }), {'Content-Type': 'application/json'});
                } catch (e) {
                    badRequest(res, `Invalid airdrop-locations payload: ${e.message}`);
                }
                return;
            }
            methodNotAllowed(res);
            return;
        }

        // GET/PUT Lootmaster Airdrop Loot Lists library (Lootmaster-owned, not read by the game).
        // Reusable named ExpansionLoot[] lists plus link records that bind a list to a
        // container/mission; the list's loot is flattened into those targets on save. Stored
        // under .lootmaster/. Body shape: { lists: [{ id, Name, Loot[] }], links: [{ listId, targetType, targetKey }] }.
        if (pathname === '/api/expansion/airdrop-loot-lists') {
            const profileId = req.headers['x-profile-id'];
            const profile = profiles.find(p => String(p.id).toLowerCase() === String(profileId).toLowerCase());
            if (!profile) { notFound(res); return; }
            const paths = getPaths(profile);
            const target = paths.airdropLootListsPath;
            if (req.method === 'GET') {
                try {
                    const content = await readValidJsonFile(target);
                    send(res, 200, content, {'Content-Type': 'application/json'});
                } catch {
                    // File missing OR corrupt (empty/NUL/garbage) — client seeds an empty library.
                    send(res, 404, JSON.stringify({ error: 'airdrop-loot-lists.json not found' }), {'Content-Type': 'application/json'});
                }
                return;
            }
            if (req.method === 'PUT') {
                try {
                    const body = await readBody(req);
                    // Validate JSON before writing to disk
                    const parsed = JSON.parse(body || '{}');
                    const out = JSON.stringify(parsed, null, 4);
                    await createBackupIfExists(target);
                    await writeFileAtomic(target, out);
                    send(res, 200, JSON.stringify({ ok: true }), {'Content-Type': 'application/json'});
                } catch (e) {
                    badRequest(res, `Invalid airdrop-loot-lists payload: ${e.message}`);
                }
                return;
            }
            methodNotAllowed(res);
            return;
        }

        // Expansion Airdrop Missions (per-drop Airdrop_*.json files)
        //  - GET                       -> list all missions [{ file, data }]
        //  - PUT  ?file=Airdrop_X.json  -> write a single mission file
        //  - DELETE ?file=Airdrop_X.json-> remove a single mission file
        if (pathname === '/api/expansion/airdrop-missions') {
            // Expansion declares DropLocation as a single object (ref ExpansionAirdropLocation).
            // Legacy Lootmaster/hand-authored files stored it as a 1-element array, which the
            // engine rejects ("Expecting instance / Is not json object"). Coerce array -> object.
            // Returns { data, changed } so callers can decide whether to rewrite the file.
            const normalizeMissionDropLocation = (data) => {
                if (!data || typeof data !== 'object') return { data, changed: false };
                const dl = data.DropLocation;
                if (Array.isArray(dl)) {
                    const first = dl[0];
                    if (first && typeof first === 'object') {
                        return { data: { ...data, DropLocation: first }, changed: true };
                    }
                    // Empty/degenerate array: no coordinates to recover — leave untouched
                    // rather than fabricate a drop point.
                    return { data, changed: false };
                }
                return { data, changed: false };
            };

            const profileId = req.headers['x-profile-id'];
            const profile = profiles.find(p => String(p.id).toLowerCase() === String(profileId).toLowerCase());
            if (!profile) { notFound(res); return; }
            const paths = getPaths(profile);
            const dir = paths.airdropMissionsDirPath;

            const isAirdropFile = (name) => isSafeName(name) && /^Airdrop_.+\.json$/i.test(name);

            if (req.method === 'GET') {
                try {
                    const entries = await readdir(dir, { withFileTypes: true });
                    const missions = [];
                    for (const entry of entries) {
                        if (!entry.isFile() || !/^Airdrop_.+\.json$/i.test(entry.name)) continue;
                        try {
                            const raw = await readFile(join(dir, entry.name), 'utf8');
                            const { data: norm, changed } = normalizeMissionDropLocation(JSON.parse(raw));
                            if (changed) {
                                // Self-heal legacy array-form DropLocation on disk so the engine
                                // stops rejecting the file. Back up first; never let a write
                                // failure break the listing.
                                try {
                                    await createBackupIfExists(join(dir, entry.name));
                                    await writeFileAtomic(join(dir, entry.name), JSON.stringify(norm, null, 4));
                                } catch (e) {
                                    console.error(`Failed to self-heal DropLocation in ${entry.name}: ${e.message}`);
                                }
                            }
                            missions.push({ file: entry.name, data: norm });
                        } catch {
                            missions.push({ file: entry.name, data: null, error: 'Failed to parse' });
                        }
                    }
                    missions.sort((a, b) => a.file.localeCompare(b.file));
                    send(res, 200, JSON.stringify(missions), {'Content-Type': 'application/json'});
                } catch {
                    // Directory may not exist yet -> empty list
                    send(res, 200, JSON.stringify([]), {'Content-Type': 'application/json'});
                }
                return;
            }

            if (req.method === 'PUT') {
                const fileName = url.searchParams.get('file');
                if (!isAirdropFile(fileName)) {
                    badRequest(res, 'Mission file name must match Airdrop_*.json and contain only safe characters.');
                    return;
                }
                try {
                    const body = await readBody(req);
                    const parsed = JSON.parse(body || '{}');
                    // Guard: no save path may ever persist an array-form DropLocation.
                    const { data: norm } = normalizeMissionDropLocation(parsed);
                    const missionTarget = join(dir, fileName);
                    await createBackupIfExists(missionTarget);
                    await writeFileAtomic(missionTarget, JSON.stringify(norm, null, 4));
                    send(res, 200, JSON.stringify({ ok: true, file: fileName }), {'Content-Type': 'application/json'});
                } catch (e) {
                    badRequest(res, `Invalid mission payload: ${e.message}`);
                }
                return;
            }

            if (req.method === 'DELETE') {
                const fileName = url.searchParams.get('file');
                if (!isAirdropFile(fileName)) {
                    badRequest(res, 'Mission file name must match Airdrop_*.json and contain only safe characters.');
                    return;
                }
                try {
                    await rm(join(dir, fileName), { force: true });
                    send(res, 200, JSON.stringify({ ok: true, file: fileName }), {'Content-Type': 'application/json'});
                } catch (e) {
                    send(res, 500, JSON.stringify({ error: e.message }), {'Content-Type': 'application/json'});
                }
                return;
            }

            methodNotAllowed(res);
            return;
        }

        // POST logs heatmap-data, returns JSON coordinates array
        if (pathname === '/api/logs/heatmap-data') {
            if (req.method !== 'POST') {
                methodNotAllowed(res);
                return;
            }
            let body = '';
            try {
                body = await readBody(req);
                const data = JSON.parse(body || '{}');

                const startMs = parseServerLocal(data.start, paths.logTimeZone);
                const endMs = parseServerLocal(data.end, paths.logTimeZone);
                if (startMs === null || endMs === null || startMs > endMs) {
                    badRequest(res, 'Invalid start/end datetimes.');
                    return;
                }
                const start = new Date(startMs);
                const end = new Date(endMs);
                const dataType = data.dataType || 'all';

                const lines = await collectAdmRecordsInRange(start, end, undefined, undefined, paths);
                const coords = [];
                const pendingLogins = new Set(); // Player IDs who connected and need their first position

                for (const line of lines) {
                    const id = tryParseLineId(line);

                    if (dataType === 'connect') {
                        if (/\bconnected\b/i.test(line)) {
                            if (id) pendingLogins.add(id);
                        } else if (id && pendingLogins.has(id)) {
                            const pos = tryParseLinePos(line);
                            if (pos) {
                                coords.push(pos);
                                pendingLogins.delete(id);
                            }
                        }
                        continue;
                    }

                    if (dataType === 'disconnect' && !/\bdisconnected\b/i.test(line)) continue;
                    if (dataType === 'kill' && !(/\bkilled\b/i.test(line) || /\bdied\b/i.test(line))) continue;

                    const pos = tryParseLinePos(line);
                    if (pos) {
                        coords.push(pos);
                    }
                }

                send(res, 200, JSON.stringify({coords}), {'Content-Type': 'application/json'});
            } catch (e) {
                console.error('Heatmap data fetch error:', e);
                send(res, 500, JSON.stringify({error: 'Failed to fetch heatmap data'}), {'Content-Type': 'application/json'});
            }
            return;
        }

        const matchSpawnableTypes = pathname.match(/^\/api\/spawnabletypes\/([^/]+)(?:\/(.+))?$/);
        if (matchSpawnableTypes) {
            const [, groupRaw, fileNameRaw] = matchSpawnableTypes;
            const group = decodeURIComponent(groupRaw);
            const fileName = fileNameRaw ? decodeURIComponent(fileNameRaw) : null;
            if (!isSafeName(group)) {
                badRequest(res, 'Invalid group');
                return;
            }
            if (fileName && !(await isSpawnableFileNameAllowed(profile, paths, group, fileName))) {
                badRequest(res, `"${fileName}" is not a spawnabletypes file of group "${group}"`);
                return;
            }
            const target = await spawnableTypesFilePath(profile, paths, group, fileName);
            if (!target) {
                notFound(res);
                return;
            }

            if (req.method === 'GET') {
                try {
                    const xml = await readFile(target, 'utf8');
                    send(res, 200, xml, {'Content-Type': 'application/xml; charset=utf-8'});
                } catch {
                    const empty = '<?xml version="1.0" encoding="UTF-8"?>\n<spawnabletypes></spawnabletypes>\n';
                    send(res, 200, empty, {'Content-Type': 'application/xml; charset=utf-8'});
                }
                return;
            }

            if (req.method === 'PUT') {
                const body = await readBody(req);
                if (!body || typeof body !== 'string') {
                    badRequest(res, 'Empty body');
                    return;
                }

                let isNew = false;
                try {
                    await stat(target);
                } catch {
                    isNew = true;
                }

                const backup = await createBackupIfExists(target);
                await writeFileAtomic(target, body);

                if (isNew && group !== '__root' && group !== 'vanilla' && group !== 'vanilla_overrides') {
                    await ensureSpawnableTypeFileInEconomyCore(profile, paths, group, String(target).split(/[\\/]/).pop());
                }

                send(res, 200, JSON.stringify({ok: true, path: target, backup}), {'Content-Type': 'application/json'});
                return;
            }

            methodNotAllowed(res);
            return;
        }

        if (pathname === '/api/mission/randompresets') {
            const target = join(paths.missionPath, 'cfgrandompresets.xml');
            if (req.method === 'GET') {
                try {
                    const xml = await readFile(target, 'utf8');
                    send(res, 200, xml, {'Content-Type': 'application/xml; charset=utf-8'});
                } catch {
                    const empty = '<?xml version="1.0" encoding="UTF-8"?>\n<randompresets></randompresets>\n';
                    send(res, 200, empty, {'Content-Type': 'application/xml; charset=utf-8'});
                }
                return;
            }
            if (req.method === 'PUT') {
                const body = await readBody(req);
                if (!body || typeof body !== 'string') {
                    badRequest(res, 'Empty body');
                    return;
                }
                const backup = await createBackupIfExists(target);
                await writeFileAtomic(target, body);
                send(res, 200, JSON.stringify({ok: true, path: target, backup}), {'Content-Type': 'application/json'});
                return;
            }
            methodNotAllowed(res);
            return;
        }

        if (pathname === '/api/mission/globals') {
            if (req.method !== 'GET') {
                methodNotAllowed(res);
                return;
            }
            const target = join(paths.dbDirPath, 'globals.xml');
            try {
                const xml = await readFile(target, 'utf8');
                send(res, 200, xml, {'Content-Type': 'application/xml; charset=utf-8'});
            } catch {
                notFound(res);
            }
            return;
        }


        if (pathname === '/api/deerisle/diving-loot') {
            if (!paths?.profilesPath) {
                badRequest(res, 'Profile path not available');
                return;
            }
            const target = join(paths.profilesPath, 'Deerisle', 'DivingLootConfig.json');
            if (req.method === 'GET') {
                try {
                    const content = await readFile(target, 'utf8');
                    const data = JSON.parse(content);
                    // Map divingLootListNormal to Items for frontend compatibility if needed
                    if (!data.Items && data.divingLootListNormal) {
                        data.Items = data.divingLootListNormal;
                    }
                    send(res, 200, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });
                } catch {
                    // Return a default empty config if not found
                    send(res, 200, JSON.stringify({ Items: [], divingLootListNormal: [], divingLootListElite: [] }), { 'Content-Type': 'application/json; charset=utf-8' });
                }
                return;
            }
            if (req.method === 'POST' || req.method === 'PUT') {
                const body = await readBody(req);
                try {
                    const parsed = JSON.parse(body);
                    // Map Items back to divingLootListNormal for mod compatibility
                    if (parsed.Items) {
                        parsed.divingLootListNormal = parsed.Items;
                    }
                    await createBackupIfExists(target);
                    await writeFileAtomic(target, JSON.stringify(parsed, null, 4));
                    send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
                } catch (e) {
                    badRequest(res, `Invalid JSON or write error: ${e.message}`);
                }
                return;
            }
            methodNotAllowed(res);
            return;
        }

        // Match /api/types/:group/:file
        const matchTypes = pathname.match(/^\/api\/types\/([^/]+)\/([^/]+)$/);
        if (matchTypes) {
            const [, groupRaw, fileRaw] = matchTypes;
            const group = decodeURIComponent(groupRaw);
            const fileBase = decodeURIComponent(fileRaw).replace(/\.xml$/i, ''); // tolerate .xml in URL

            if (!isSafeName(group) || !isSafeName(fileBase)) {
                badRequest(res, 'Invalid group or file');
                return;
            }

            if (req.method === 'GET') {
                const target = await declaredTypesFilePath(profile, paths, group, fileBase);
                if (!target) {
                    notFound(res);
                    return;
                }
                try {
                    const xml = await readFile(target, 'utf8');
                    send(res, 200, xml, {'Content-Type': 'application/xml; charset=utf-8'});
                } catch {
                    // If vanilla_overrides/types.xml doesn't exist yet, return an empty types doc
                    if (group === 'vanilla_overrides' && fileBase === 'types') {
                        const empty = '<?xml version="1.0" encoding="UTF-8"?>\n<types></types>\n';
                        send(res, 200, empty, {'Content-Type': 'application/xml; charset=utf-8'});
                    } else {
                        notFound(res);
                    }
                }
                return;
            }
            if (req.method === 'PUT') {
                const body = await readBody(req);
                if (!body || typeof body !== 'string') {
                    badRequest(res, 'Empty body');
                    return;
                }
                // Never allow persisting to the vanilla base file (db/types.xml)
                if (group === 'vanilla' && fileBase === 'types') {
                    badRequest(res, 'Persisting to vanilla types.xml is not allowed.');
                    return;
                }
                const target = await declaredTypesFilePath(profile, paths, group, fileBase);
                if (!target) {
                    badRequest(res, 'Group or file not declared in cfgeconomycore.xml');
                    return;
                }

                // Read previous content if present for diff
                let prev = '';
                try {
                    prev = await readFile(target, 'utf8');
                } catch {
                    // no previous file
                }

                // Write new content
                await createBackupIfExists(target);
                await writeFileAtomic(target, body);

                // Compute detailed changes (added/removed/modified with field-level diffs)
                try {
                    const editorID = (req.headers['x-editor-id'] && String(req.headers['x-editor-id'])) || 'unknown';
                    const oldMap = await parseTypesWithSrcHelpers(prev);
                    const newMap = await parseTypesWithSrcHelpers(body);

                    const oldNames = new Set(Object.keys(oldMap));
                    const newNames = new Set(Object.keys(newMap));

                    const added = [...newNames].filter(n => !oldNames.has(n));
                    const removed = [...oldNames].filter(n => !newNames.has(n));
                    const common = [...oldNames].filter(n => newNames.has(n));

                    const changes = [];

                    // Added
                    for (const name of added) {
                        const ts = new Date();
                        changes.push(`${formatTs(ts)} - [${editorID}] ${name} added`);
                    }
                    // Removed
                    for (const name of removed) {
                        const ts = new Date();
                        changes.push(`${formatTs(ts)} - [${editorID}] ${name} removed`);
                    }
                    // Modified (with fields spec)
                    for (const name of common) {
                        const diffs = diffTypeFields(oldMap[name], newMap[name]);
                        if (diffs.length) {
                            const ts = new Date();
                            changes.push(`${formatTs(ts)} - [${editorID}] ${name} modified [fields: ${diffs.join(', ')}]`);
                        }
                    }

                    if (changes.length) {
                        const dir = await declaredGroupDir(profile, paths, group);
                        if (dir) {
                            await mkdir(dir, {recursive: true});
                            let block = `File: ${fileBase}.xml\n` + changes.join('\n') + '\n\n';
                            await appendFile(join(dir, 'changes.txt'), block, 'utf8');
                        }
                    }
                } catch (e) {
                    console.warn('Failed to append changes.txt:', e);
                }

                send(res, 200, JSON.stringify({ok: true, path: target}), {'Content-Type': 'application/json'});
                return;
            }
            methodNotAllowed(res);
            return;
        }

        // Addon-specific files (e.g. Deerisle)
        if (pathname.startsWith('/api/addons/')) {
            const parts = pathname.split('/');
            if (parts.length < 5) {
                badRequest(res, 'Invalid addon API path');
                return;
            }
            const addonId = parts[3];
            const action = parts[4];
            const addon = KNOWN_ADDONS.find(a => a.id === addonId);
            if (!addon) {
                notFound(res);
                return;
            }

            // KNOWN_ADDONS defines folders per-probe (there is no top-level `addon.folder`);
            // locate the addon's config directory via its profile-type probe.
            const profileProbe = addon.probes.find(p => p.type === 'profile');
            if (!profileProbe) { notFound(res); return; }
            const addonDir = join(paths.profilesPath, profileProbe.folder);

            // GET /api/addons/:addon/files
            if (action === 'files' && req.method === 'GET') {
                try {
                    const entries = await readdir(addonDir, { withFileTypes: true });
                    const files = entries
                        .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.json'))
                        .map(e => e.name.replace(/\.json$/i, ''));
                    send(res, 200, JSON.stringify(files), {'Content-Type': 'application/json'});
                } catch {
                    send(res, 200, JSON.stringify([]), {'Content-Type': 'application/json'});
                }
                return;
            }

            // GET/PUT /api/addons/:addon/file/:name
            if (action === 'file' && parts[5]) {
                const fileName = decodeURIComponent(parts[5]);
                if (!isSafeName(fileName)) {
                    badRequest(res, 'Invalid file name');
                    return;
                }
                const filePath = join(addonDir, `${fileName}.json`);

                if (req.method === 'GET') {
                    try {
                        const content = await readFile(filePath, 'utf8');
                        send(res, 200, content, {'Content-Type': 'application/json'});
                    } catch {
                        notFound(res);
                    }
                    return;
                }
                if (req.method === 'PUT') {
                    const body = await readBody(req);
                    try {
                        // Validate JSON
                        const parsed = JSON.parse(body);
                        await createBackupIfExists(filePath);
                        await writeFileAtomic(filePath, JSON.stringify(parsed, null, 4));
                        send(res, 200, JSON.stringify({ok: true}), {'Content-Type': 'application/json'});
                    } catch (e) {
                        badRequest(res, `Invalid JSON or write error: ${e.message}`);
                    }
                    return;
                }
            }
        }

        // Market categories: list
        if (pathname === '/api/market/categories') {
            if (req.method !== 'GET') {
                methodNotAllowed(res);
                return;
            }
            try {
                const dir = paths.marketDirPath;
                const entries = await readdir(dir, { withFileTypes: true });
                const names = entries
                    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.json'))
                    .map(e => e.name.replace(/\.json$/i, ''))
                    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                send(res, 200, JSON.stringify({ categories: names }), { 'Content-Type': 'application/json' });
            } catch {
                send(res, 200, JSON.stringify({ categories: [] }), { 'Content-Type': 'application/json' });
            }
            return;
        }

        // Market category read/write
        const matchMarketCat = pathname.match(/^\/api\/market\/category\/([^/]+)$/);
        if (matchMarketCat) {
            const [, nameRaw] = matchMarketCat;
            const name = decodeURIComponent(nameRaw);
            if (!isSafeName(name)) {
                badRequest(res, 'Invalid category name');
                return;
            }
            const fileBase = name.replace(/\.json$/i, '');
            const target = join(paths.marketDirPath, `${fileBase}.json`);

            if (req.method === 'GET') {
                try {
                    const json = await readFile(target, 'utf8');
                    send(res, 200, json, { 'Content-Type': 'application/json; charset=utf-8' });
                } catch {
                    notFound(res);
                }
                return;
            }
            if (req.method === 'PUT') {
                const body = await readBody(req);
                if (!body || typeof body !== 'string') {
                    badRequest(res, 'Empty body');
                    return;
                }
                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch {
                    badRequest(res, 'Invalid JSON');
                    return;
                }
                try {
                    const formatted = JSON.stringify(parsed, null, 4);
                    await createBackupIfExists(target);
                    await writeFileAtomic(target, formatted + (formatted.endsWith('\n') ? '' : '\n'));
                    send(res, 200, JSON.stringify({ ok: true, path: target }), { 'Content-Type': 'application/json' });
                } catch {
                    send(res, 500, JSON.stringify({ error: 'Failed to write category' }), { 'Content-Type': 'application/json' });
                }
                return;
            }
            methodNotAllowed(res);
            return;
        }

        // Market remove item from everywhere
        if (pathname === '/api/market/remove-item-completely') {
            if (req.method !== 'POST') {
                methodNotAllowed(res);
                return;
            }
            const body = await readBody(req);
            let parsed;
            try {
                parsed = JSON.parse(body);
            } catch {
                badRequest(res, 'Invalid JSON');
                return;
            }
            const { className } = parsed;
            if (!className) {
                badRequest(res, 'Missing className');
                return;
            }

            try {
                const results = await removeItemFromMarketplaceCompletely(className, paths);
                send(res, 200, JSON.stringify({ ok: true, results }), { 'Content-Type': 'application/json' });
            } catch (e) {
                send(res, 500, JSON.stringify({ error: 'Failed to remove item', detail: String(e) }), { 'Content-Type': 'application/json' });
            }
            return;
        }

        // Traders: list (.map files)
        if (pathname === '/api/traders') {
            if (req.method !== 'GET') {
                methodNotAllowed(res);
                return;
            }
            try {
                const dir = paths.tradersDirPath;
                const entries = await readdir(dir, { withFileTypes: true });
                const names = entries
                    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.map'))
                    .map(e => e.name.replace(/\.map$/i, ''))
                    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                send(res, 200, JSON.stringify({ traders: names }), { 'Content-Type': 'application/json' });
            } catch {
                send(res, 200, JSON.stringify({ traders: [] }), { 'Content-Type': 'application/json' });
            }
            return;
        }

        // Trader read/write (.map)
        const matchTrader = pathname.match(/^\/api\/traders\/([^/]+)$/);
        if (matchTrader) {
            const [, traderRaw] = matchTrader;
            if (!isSafeName(traderRaw)) {
                badRequest(res, 'Invalid trader name');
                return;
            }
            const fileBase = traderRaw.replace(/\.map$/i, '');
            const target = join(paths.tradersDirPath, `${fileBase}.map`);

            if (req.method === 'GET') {
                try {
                    const text = await readFile(target, 'utf8');
                    const line = (text || '').split(/\r?\n/)[0] || '';
                    const parsed = parseTraderMapLine(line);
                    send(res, 200, JSON.stringify({ name: fileBase, ...parsed }), { 'Content-Type': 'application/json' });
                } catch {
                    notFound(res);
                }
                return;
            }
            if (req.method === 'PUT') {
                const body = await readBody(req);
                if (!body || typeof body !== 'string') {
                    badRequest(res, 'Empty body');
                    return;
                }
                let payload;
                try {
                    payload = JSON.parse(body);
                } catch {
                    badRequest(res, 'Invalid JSON');
                    return;
                }
                const { className, traderFileName, position, orientation, gear } = payload || {};
                if (typeof className !== 'string' || !className || typeof traderFileName !== 'string' || !traderFileName) {
                    badRequest(res, 'Missing className or traderFileName');
                    return;
                }
                const pos = Array.isArray(position) ? position.map(Number) : [];
                const ori = Array.isArray(orientation) ? orientation.map(Number) : [];
                const att = Array.isArray(gear) ? gear.map(x => String(x)).filter(Boolean) : [];
                if (pos.length !== 3 || pos.some(n => Number.isNaN(n))) {
                    badRequest(res, 'Invalid position');
                    return;
                }
                if (ori.length !== 3 || ori.some(n => Number.isNaN(n))) {
                    badRequest(res, 'Invalid orientation');
                    return;
                }
                const line = buildTraderMapLine({ className, traderFileName, position: pos, orientation: ori, gear: att });
                try {
                    await createBackupIfExists(target);
                    await writeFileAtomic(target, line + (line.endsWith('\n') ? '' : '\n'));
                    send(res, 200, JSON.stringify({ ok: true, path: target }), { 'Content-Type': 'application/json' });
                } catch {
                    send(res, 500, JSON.stringify({ error: 'Failed to write trader map' }), { 'Content-Type': 'application/json' });
                }
                return;
            }
            methodNotAllowed(res);
            return;
        }

        // Trader profiles: list
        if (pathname === '/api/trader-profiles') {
            if (req.method !== 'GET') {
                methodNotAllowed(res);
                return;
            }
            try {
                const dir = paths.traderProfilesDirPath;
                const entries = await readdir(dir, { withFileTypes: true });
                const names = entries
                    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.json'))
                    .map(e => e.name.replace(/\.json$/i, ''))
                    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                send(res, 200, JSON.stringify({ profiles: names }), { 'Content-Type': 'application/json' });
            } catch {
                send(res, 200, JSON.stringify({ profiles: [] }), { 'Content-Type': 'application/json' });
            }
            return;
        }

        // Trader profile read/write
        const matchTraderProfile = pathname.match(/^\/api\/trader-profile\/([^/]+)$/);
        if (matchTraderProfile) {
            const [, nameRaw] = matchTraderProfile;
            if (!isSafeName(nameRaw)) {
                badRequest(res, 'Invalid trader profile name');
                return;
            }
            const fileBase = nameRaw.replace(/\.json$/i, '');
            const target = join(paths.traderProfilesDirPath, `${fileBase}.json`);

            if (req.method === 'GET') {
                try {
                    const json = await readFile(target, 'utf8');
                    send(res, 200, json, { 'Content-Type': 'application/json; charset=utf-8' });
                } catch {
                    notFound(res);
                }
                return;
            }
            if (req.method === 'PUT') {
                const body = await readBody(req);
                if (!body || typeof body !== 'string') {
                    badRequest(res, 'Empty body');
                    return;
                }
                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch {
                    badRequest(res, 'Invalid JSON');
                    return;
                }
                try {
                    const formatted = JSON.stringify(parsed, null, 4);
                    await createBackupIfExists(target);
                    await writeFileAtomic(target, formatted + (formatted.endsWith('\n') ? '' : '\n'));
                    send(res, 200, JSON.stringify({ ok: true, path: target }), { 'Content-Type': 'application/json' });
                } catch {
                    send(res, 500, JSON.stringify({ error: 'Failed to write trader profile' }), { 'Content-Type': 'application/json' });
                }
                return;
            }
            methodNotAllowed(res);
            return;
        }

        // Trader zones: list
        if (pathname === '/api/traderzones') {
            if (req.method !== 'GET') {
                methodNotAllowed(res);
                return;
            }
            try {
                const dir = paths.traderZonesDirPath;
                const entries = await readdir(dir, { withFileTypes: true });
                const names = entries
                    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.json'))
                    .map(e => e.name.replace(/\.json$/i, ''))
                    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                send(res, 200, JSON.stringify({ zones: names }), { 'Content-Type': 'application/json' });
            } catch {
                send(res, 200, JSON.stringify({ zones: [] }), { 'Content-Type': 'application/json' });
            }
            return;
        }

        // Trader zone read/write
        const matchTraderZone = pathname.match(/^\/api\/traderzones\/([^/]+)$/);
        if (matchTraderZone) {
            const [, zoneRaw] = matchTraderZone;
            const name = decodeURIComponent(zoneRaw);
            if (!isSafeName(name)) {
                badRequest(res, 'Invalid trader zone name');
                return;
            }
            const fileBase = name.replace(/\.json$/i, '');
            const target = join(paths.traderZonesDirPath, `${fileBase}.json`);

            if (req.method === 'GET') {
                try {
                    const json = await readFile(target, 'utf8');
                    send(res, 200, json, { 'Content-Type': 'application/json; charset=utf-8' });
                } catch {
                    notFound(res);
                }
                return;
            }
            if (req.method === 'PUT') {
                const body = await readBody(req);
                if (!body || typeof body !== 'string') {
                    badRequest(res, 'Empty body');
                    return;
                }
                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch {
                    badRequest(res, 'Invalid JSON');
                    return;
                }
                try {
                    const formatted = JSON.stringify(parsed, null, 4);
                    await createBackupIfExists(target);
                    await writeFileAtomic(target, formatted + (formatted.endsWith('\n') ? '' : '\n'));
                    send(res, 200, JSON.stringify({ ok: true, path: target }), { 'Content-Type': 'application/json' });
                } catch {
                    send(res, 500, JSON.stringify({ error: 'Failed to write trader zone' }), { 'Content-Type': 'application/json' });
                }
                return;
            }
            methodNotAllowed(res);
            return;
        }

        // Lint files (.xml, .json)
        if (pathname === '/api/lint') {
            if (req.method !== 'GET') {
                methodNotAllowed(res);
                return;
            }
            try {
                // Lint both mission and profiles
                const missionReport = await lintDataDir(paths.missionPath);
                const profilesReport = await lintDataDir(paths.profilesPath);
                send(res, 200, JSON.stringify({
                    ok: missionReport.ok && profilesReport.ok,
                    mission: missionReport,
                    profiles: profilesReport
                }), {'Content-Type': 'application/json'});
            } catch (e) {
                send(res, 500, JSON.stringify({error: 'Failed to lint files', detail: String(e)}), {'Content-Type': 'application/json'});
            }
            return;
        }

        // Health check / root
        if (pathname === '/' || pathname === '/api/health') {
            send(
                res,
                200,
                JSON.stringify({ok: true, profilesCount: profiles.length}),
                {'Content-Type': 'application/json'}
            );
            return;
        }

        notFound(res);
    } catch (err) {
        console.error('Server error:', err);
        send(res, 500, JSON.stringify({error: 'Internal Server Error'}), {'Content-Type': 'application/json'});
    }
});

server.listen(PORT, async () => {
    // Restore the persisted mod catalog (displayName/attachment graph) so a
    // restart keeps it until the mod's next catalog push. The mod latches
    // catalog delivery after one success, so it won't resend just for our bounce.
    await ingest.loadPersistedCatalog();
    // Open the history database and start the retention timer. Recording is a tee
    // off /ingest/snapshot, so a failure here degrades the history tool and leaves
    // everything else — including the live map — untouched.
    if (history.init()) {
        history.startRetention();
        const h = history.stats();
        console.log(`History recording to ${h.dbFile} (${h.rows} rows, `
            + `${h.retention.fullDays}d full / ${h.retention.thinDays}d thinned)`);
    } else {
        console.log('History recording is off (set HISTORY_ENABLED=1 and Node >= 22.5 to enable).');
    }
    console.log(`XML persistence server listening on http://localhost:${PORT}`);
});
