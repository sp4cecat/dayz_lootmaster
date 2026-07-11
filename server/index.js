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
import {mkdir, readFile, writeFile, stat, appendFile, readdir, cp, rm} from 'node:fs/promises';
import crypto from 'node:crypto';
import moment from 'moment';
import * as ingest from './ingest-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// eslint-disable-next-line no-undef
const PORT = Number(process.env.PORT || 4317);

// eslint-disable-next-line no-undef
const IS_DEV = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
const TEST_PROFILE_ID = 'example-dev-data';

const PROFILES_FILE = resolve(join(__dirname, 'profiles.json'));
let profiles = [];

// Shared, profile-independent modular loadout templates, persisted alongside profiles.json.
const LOADOUTS_FILE = resolve(join(__dirname, 'loadouts.json'));
// Read-modify-write on a single JSON file; writes are serialized through this chain so that
// overlapping saves (e.g. a bulk import firing many PUTs in quick succession) can't lose updates.
let loadoutsWriteChain = Promise.resolve();

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
    await writeFile(PROFILES_FILE, JSON.stringify(toSave, null, 2), 'utf8');
}

// Modular loadout templates are shared/global (not keyed by profile). Missing/corrupt file
// reads as an empty list.
async function loadLoadouts() {
    try {
        return JSON.parse(await readFile(LOADOUTS_FILE, 'utf8'));
    } catch {
        return [];
    }
}

// Apply `mutator` to the current list and persist the result, serialized behind any in-flight
// write. The returned promise resolves/rejects for this specific mutation, while the shared
// chain swallows rejections so a single failed write never blocks later ones.
function mutateLoadouts(mutator) {
    const run = loadoutsWriteChain.then(async () => {
        const list = await loadLoadouts();
        const next = mutator(list);
        await writeFile(LOADOUTS_FILE, JSON.stringify(next, null, 2), 'utf8');
        return next;
    });
    loadoutsWriteChain = run.catch(() => {});
    return run;
}

// Ensure profiles are loaded on start
await loadProfiles();

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS,DELETE',
        'Access-Control-Allow-Headers': 'Content-Type, X-Editor-ID, X-Profile-ID',
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
        airdropMissionsDirPath: join(missionPath, 'expansion', 'missions'),
        dbDirPath: join(missionPath, 'db'),
        logsDirPath: join(serverPath, 'log_storage'),
        expansionLogsDirPath: join(profilesPath, 'ExpansionMod', 'Logs'),
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

    await writeFile(join(targetDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
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
                    await writeFile(filePath, JSON.stringify(json, null, 4) + '\n', 'utf8');
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
                await writeFile(filePath, JSON.stringify(json, null, 4) + '\n', 'utf8');
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
                await writeFile(filePath, JSON.stringify(json, null, 4) + '\n', 'utf8');
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
        await writeFile(economyCore, newXml, 'utf8');
        
        // Clear caches to force reload
        groupFolderCaches.delete(profile.id);
        groupFilesCaches.delete(profile.id);
        groupSpawnableFilesCaches.delete(profile.id);
    } catch (e) {
        console.error('Failed to update economycore:', e);
    }
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
    await writeFile(backup, content, 'utf8');
    return backup;
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
        const startDate = parseAdmStartDate(f);
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
        // Compute UTC+10 "midnight" for the file date, as an absolute instant
        const tzOffsetMs = 10 * 60 * 60 * 1000;
        const shifted = new Date(bucket.startDate.getTime() + tzOffsetMs); // shift to get UTC+10 calendar components
        const baseMidnightUtcPlus10Ms = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 0, 0, 0) - tzOffsetMs;
        const baseDate = new Date(baseMidnightUtcPlus10Ms);

        let dayOffset = 0;
        let lastSec = null;

        for (const row of bucket.rows) {
            const t = tryParseLineTime(row);
            if (!t) continue;

            const sec = hmsToSec(t);
            if (sec == null) continue;

            if (lastSec != null && sec < lastSec) {
                // Midnight rollover within the same file
                dayOffset += 1;
            }
            lastSec = sec;

            // Build per-line timestamp as base + dayOffset + seconds-of-day (all anchored to UTC+10)
            const dt = new Date(baseDate.getTime() + dayOffset * 24 * 60 * 60 * 1000 + sec * 1000);

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

function parseAdmStartDate(filePath) {
    // Interpret filename timestamps as local time in UTC+10 and convert to an absolute instant.
    // Supports patterns like:
    //  - YYYY-MM-DD_HH-MM-SS
    //  - YYYY-MM-DD-HH-MM-SS
    //  - YYYYMMDD_HHMMSS
    //  - YYYY-MM-DD (defaults time to 00:00:00)
    const name = String(filePath).split(/[\\/]/).pop() || '';
    const tzOffsetMs = 10 * 60 * 60 * 1000;

    let m;
    // Full datetime variants
    m = name.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[T _-]?(\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
    if (m) {
        const y = Number(m[1]), mon = Number(m[2]) - 1, d = Number(m[3]);
        const h = Number(m[4]), mi = Number(m[5]), s = Number(m[6]);
        // Convert "UTC+10 local time" to UTC instant by subtracting the offset
        const utcMs = Date.UTC(y, mon, d, h, mi, s) - tzOffsetMs;
        const dt = new Date(utcMs);
        return isNaN(dt.getTime()) ? null : dt;
    }
    // Date-only
    m = name.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/);
    if (m) {
        const y = Number(m[1]), mon = Number(m[2]) - 1, d = Number(m[3]);
        const utcMs = Date.UTC(y, mon, d, 0, 0, 0) - tzOffsetMs;
        const dt = new Date(utcMs);
        return isNaN(dt.getTime()) ? null : dt;
    }

    // Unknown filename format => skip the file
    return null;
}

function tryParseLineTime(line) {
    const m = /^\s*(\d{1,2}:\d{2}:\d{2})\s+\|\s+Player/i.exec(line);
    return m ? m[1] : null;
}

// Extract pos=<x, y, z>; returns {x, z} or null (planar X/Z distance, y is vertical/height)
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

function parseExpLogStartDate(filePath) {
    // ExpLog_YYYY-MM-DD_HH-mm-ss.log — interpret as UTC+10 local time
    const name = String(filePath).split(/[\\/]/).pop() || '';
    const tzOffsetMs = 10 * 60 * 60 * 1000;

    const m = name.match(/ExpLog_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/i);
    if (m) {
        const y = Number(m[1]), mon = Number(m[2]) - 1, d = Number(m[3]);
        const h = Number(m[4]), mi = Number(m[5]), s = Number(m[6]);
        const utcMs = Date.UTC(y, mon, d, h, mi, s) - tzOffsetMs;
        const dt = new Date(utcMs);
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
        const startDate = parseExpLogStartDate(f);
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
        // Compute UTC+10 "midnight" for the file date, as an absolute instant
        const tzOffsetMs = 10 * 60 * 60 * 1000;
        const shifted = new Date(bucket.startDate.getTime() + tzOffsetMs);
        const baseMidnightUtcPlus10Ms = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 0, 0, 0) - tzOffsetMs;
        const baseDate = new Date(baseMidnightUtcPlus10Ms);

        let dayOffset = 0;
        let lastSec = null;

        for (const row of bucket.rows) {
            const t = tryParseExpLineTime(row);
            if (!t) continue;

            const sec = hmsToSec(t);
            if (sec == null) continue;

            if (lastSec != null && sec < lastSec) {
                dayOffset += 1;
            }
            lastSec = sec;

            const dt = new Date(baseDate.getTime() + dayOffset * 24 * 60 * 60 * 1000 + sec * 1000);

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

async function collectAdmRecordsInRange(start, end, posFilter, idSet, paths) {
    const root = paths.logsDirPath;
    const files = await listAdmFiles(root);

    // Read all files and capture their start datetime (from filename) and lines
    const fileBuckets = [];
    for (const f of files) {
        let text = '';
        try {
            text = await readFile(f, 'utf8');
        } catch {
            continue;
        }
        const startDate = parseAdmStartDate(f);
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
        // Compute UTC+10 "midnight" for the file date, as an absolute instant
        const tzOffsetMs = 10 * 60 * 60 * 1000;
        const shifted = new Date(bucket.startDate.getTime() + tzOffsetMs); // shift to get UTC+10 calendar components
        const baseMidnightUtcPlus10Ms = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 0, 0, 0) - tzOffsetMs;
        const baseDate = new Date(baseMidnightUtcPlus10Ms);

        let dayOffset = 0;
        let lastSec = null;

        for (const row of bucket.rows) {
            const t = tryParseLineTime(row);
            if (!t) continue;

            const sec = hmsToSec(t);
            if (sec == null) continue;

            if (lastSec != null && sec < lastSec) {
                // Midnight rollover within the same file
                dayOffset += 1;
            }
            lastSec = sec;

            // Build per-line timestamp as base + dayOffset + seconds-of-day (all anchored to UTC+10)
            const dt = new Date(baseDate.getTime() + dayOffset * 24 * 60 * 60 * 1000 + sec * 1000);

            // Ensure the adjusted datetime lies within the requested range
            if (dt < start || dt > end) continue;

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

async function ensureDirFor(filePath) {
    const dir = dirname(filePath);
    await mkdir(dir, {recursive: true});
}

async function readBody(req) {
    return new Promise((resolveBody, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
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
        send(res, 200, JSON.stringify({ ok: true, modConnected }), { 'Content-Type': 'application/json' });
        return true;
    }

    // /api/catalog/types — bulk summaries for the displayName lookup.
    if (parts.length === 3 && parts[2] === 'types') {
        const { types } = ingest.getCatalog();
        const list = Object.keys(types).map(name => ({ name, displayName: types[name].displayName || null }));
        send(res, 200, JSON.stringify({ count: list.length, types: list }), { 'Content-Type': 'application/json' });
        return true;
    }

    // /api/catalog/types/:name — normalized detail + attachment graph.
    if (parts.length === 4 && parts[2] === 'types') {
        const name = decodeURIComponent(parts[3]);
        send(res, 200, JSON.stringify(buildCatalogDetail(name)), { 'Content-Type': 'application/json' });
        return true;
    }

    notFound(res);
    return true;
}

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
        ingest.setSnapshot(await parseBody());
        send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
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
        const payload = body.items !== undefined ? body.items : body.result;
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
                        missionName: data.missionName
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


        // Modular loadout templates (shared/global; profile-independent, stored in loadouts.json).
        // Registered before the X-Profile-ID gate so the list is not tied to a selected profile.
        if (pathname === '/api/loadouts' || pathname.startsWith('/api/loadouts/')) {
            const idMatch = pathname.match(/^\/api\/loadouts\/(.+)$/);
            const id = idMatch ? decodeURIComponent(idMatch[1]) : null;

            if (req.method === 'GET' && !id) {
                const list = await loadLoadouts();
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
                    await mutateLoadouts((list) => {
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
                await mutateLoadouts((list) => list.filter((l) => l.id !== id));
                send(res, 200, JSON.stringify({ok: true}), {'Content-Type': 'application/json'});
                return;
            }
            methodNotAllowed(res);
            return;
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
                await ensureDirFor(p);
                await writeFile(p, body, 'utf8');
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

                // Parse input timestamps as UTC+10 local times using moment
                const parseUtcPlus10 = (s) => {
                    if (typeof s !== 'string') return moment.invalid();
                    const formats = [
                        'YYYY-MM-DDTHH:mm:ss',
                        'YYYY-MM-DD HH:mm:ss',
                        'YYYY-MM-DDTHH:mm',
                        'YYYY-MM-DD HH:mm',
                        'YYYY-MM-DD'
                    ];
                    const m = moment(s, formats, true);
                    if (!m.isValid()) return moment.invalid();
                    return m.utcOffset(600, true).utc();
                };

                const startM = parseUtcPlus10(data.start);
                const endM = parseUtcPlus10(data.end);
                if (!data.start || !data.end || !startM.isValid() || !endM.isValid() || startM.isAfter(endM)) {
                    badRequest(res, 'Invalid start/end datetimes.');
                    return;
                }
                const start = startM.toDate();
                const end = endM.toDate();

                // Use X/Z for planar distance; accept data.z primarily, fall back to legacy data.y for compatibility
                const xf = Number(data.x);
                let zf = Number(data.z);
                const rf = Number(data.radius);
                if (!Number.isFinite(zf) && Number.isFinite(Number(data.y))) {
                    zf = Number(data.y); // backward compatibility with legacy clients
                }
                const hasFilter = Number.isFinite(xf) && Number.isFinite(zf) && Number.isFinite(rf);
                const expandByIds = !!data.expandByIds;

                let lines;
                if (hasFilter) {
                    // Pass 1: collect within radius to determine unique ids
                    const spatialLines = await collectAdmRecordsInRange(start, end, {x: xf, z: zf, radius: rf}, undefined, paths);
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
                    lines = await collectAdmRecordsInRange(start, end, undefined, undefined, paths);
                }

                // Prepend header with start datetime in UTC+10 and build filename using moment
                const header = `AdminLog started on ${startM.clone().utcOffset(600).format('YYYY-MM-DD')} at ${startM.clone().utcOffset(600).format('HH:mm:ss')}`;
                const content = [header, ...lines].join('\n');

                const filename = `${startM.clone().utcOffset(600).format('YYYY-MM-DD_HH-mm-ss')}_to_${endM.clone().utcOffset(600).format('YYYY-MM-DD_HH-mm-ss')}.ADM`;
                send(res, 200, content, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Content-Disposition': `attachment; filename="${filename}"`
                });
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

                const parseUtcPlus10 = (s) => {
                    if (typeof s !== 'string') return moment.invalid();
                    const formats = [
                        'YYYY-MM-DDTHH:mm:ss',
                        'YYYY-MM-DD HH:mm:ss',
                        'YYYY-MM-DDTHH:mm',
                        'YYYY-MM-DD HH:mm',
                        'YYYY-MM-DD'
                    ];
                    const m = moment(s, formats, true);
                    if (!m.isValid()) return moment.invalid();
                    return m.utcOffset(600, true).utc();
                };

                const startM = parseUtcPlus10(data.start);
                const endM = parseUtcPlus10(data.end);
                if (!data.start || !data.end || !startM.isValid() || !endM.isValid() || startM.isAfter(endM)) {
                    badRequest(res, 'Invalid start/end datetimes.');
                    return;
                }
                const start = startM.toDate();
                const end = endM.toDate();

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

                const header = `ExpansionLog started on ${startM.clone().utcOffset(600).format('YYYY-MM-DD')} at ${startM.clone().utcOffset(600).format('HH:mm:ss')}`;
                const content = [header, ...lines].join('\n');

                const filename = `${startM.clone().utcOffset(600).format('YYYY-MM-DD_HH-mm-ss')}_to_${endM.clone().utcOffset(600).format('YYYY-MM-DD_HH-mm-ss')}.log`;
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
                    const content = await readFile(target, 'utf8');
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
                    await mkdir(dirname(target), { recursive: true });
                    await writeFile(target, JSON.stringify(parsed, null, 4), 'utf8');
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
                    const content = await readFile(target, 'utf8');
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
                    await mkdir(dirname(target), { recursive: true });
                    await writeFile(target, JSON.stringify(parsed, null, 4), 'utf8');
                    send(res, 200, JSON.stringify({ ok: true }), {'Content-Type': 'application/json'});
                } catch (e) {
                    badRequest(res, `Invalid MissionSettings payload: ${e.message}`);
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
                            missions.push({ file: entry.name, data: JSON.parse(raw) });
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
                    await mkdir(dir, { recursive: true });
                    await writeFile(join(dir, fileName), JSON.stringify(parsed, null, 4), 'utf8');
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

                const parseUtcPlus10 = (s) => {
                    if (typeof s !== 'string') return moment.invalid();
                    const formats = [
                        'YYYY-MM-DDTHH:mm:ss',
                        'YYYY-MM-DD HH:mm:ss',
                        'YYYY-MM-DDTHH:mm',
                        'YYYY-MM-DD HH:mm',
                        'YYYY-MM-DD'
                    ];
                    const m = moment(s, formats, true);
                    if (!m.isValid()) return moment.invalid();
                    return m.utcOffset(600, true).utc();
                };

                const startM = parseUtcPlus10(data.start);
                const endM = parseUtcPlus10(data.end);
                if (!data.start || !data.end || !startM.isValid() || !endM.isValid() || startM.isAfter(endM)) {
                    badRequest(res, 'Invalid start/end datetimes.');
                    return;
                }
                const start = startM.toDate();
                const end = endM.toDate();
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
                await ensureDirFor(target);
                await writeFile(target, body, 'utf8');

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
                await ensureDirFor(target);
                await writeFile(target, body, 'utf8');
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
                    await ensureDirFor(target);
                    await writeFile(target, JSON.stringify(parsed, null, 4), 'utf8');
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
                await ensureDirFor(target);
                await writeFile(target, body, 'utf8');

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
                        await ensureDirFor(filePath);
                        await writeFile(filePath, JSON.stringify(parsed, null, 4), 'utf8');
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
                    await ensureDirFor(target);
                    const formatted = JSON.stringify(parsed, null, 4);
                    await writeFile(target, formatted + (formatted.endsWith('\n') ? '' : '\n'), 'utf8');
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
                    await ensureDirFor(target);
                    await writeFile(target, line + (line.endsWith('\n') ? '' : '\n'), 'utf8');
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
                    await ensureDirFor(target);
                    const formatted = JSON.stringify(parsed, null, 4);
                    await writeFile(target, formatted + (formatted.endsWith('\n') ? '' : '\n'), 'utf8');
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
                    await ensureDirFor(target);
                    const formatted = JSON.stringify(parsed, null, 4);
                    await writeFile(target, formatted + (formatted.endsWith('\n') ? '' : '\n'), 'utf8');
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
    console.log(`XML persistence server listening on http://localhost:${PORT}`);
});
