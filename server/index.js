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
import {mkdir, readFile, writeFile, stat, appendFile, readdir} from 'node:fs/promises';
import moment from 'moment';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// eslint-disable-next-line no-undef
const PORT = Number(process.env.PORT || 4317);
// eslint-disable-next-line no-undef
const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, '..', 'data'));

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Editor-ID',
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

function defsPath() {
    return join(DATA_DIR, 'cfglimitsdefinition.xml');
}

function economyCorePath() {
    // Explicitly use ./data/cfgeconomycore.xml
    return join(DATA_DIR, 'cfgeconomycore.xml');
}

function marketDirPath() {
    // Expansion Market categories directory
    return join(DATA_DIR, 'profiles', 'ExpansionMod', 'Market');
}

function traderZonesDirPath() {
    // Expansion Trader Zones directory (per user spec)
    return join(DATA_DIR, 'expansion', 'traderzones');
}

function tradersDirPath() {
    // Expansion Traders (.map files) directory
    return join(DATA_DIR, 'expansion', 'traders');
}

function traderProfilesDirPath() {
    // Expansion Trader profiles JSON directory
    return join(DATA_DIR, 'profiles', 'ExpansionMod', 'Traders');
}

async function removeItemFromMarketplaceCompletely(className) {
    const classNameLower = className.toLowerCase();
    const marketDir = marketDirPath();
    const traderZonesDir = traderZonesDirPath();

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
        const traderDir = traderProfilesDirPath();
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

// Cache of group -> folder path (relative to DATA_DIR), derived from cfgeconomycore.xml
/** @type {Record<string, string>|null} */
let groupFolderCache = null;
// Cache of group -> declared type file names (from cfgeconomycore.xml)
/** @type {Record<string, string[]>|null} */
let groupFilesCache = null;

/**
 * Load and cache group -> folder mapping by reading cfgeconomycore.xml.
 * The "group" is the last path segment of the folder attribute.
 * Example: <ce folder="db/types/spacecat_colours"> => group "spacecat_colours"
 */
async function getGroupFolderMap() {
    if (groupFolderCache) return groupFolderCache;
    await loadEconomyCoreCaches();
    return groupFolderCache || {};
}

/**
 * Load and cache group -> declared type file names mapping.
 * Only <file type="types"> entries are considered.
 */
async function getGroupFilesMap() {
    if (groupFilesCache) return groupFilesCache;
    await loadEconomyCoreCaches();
    return groupFilesCache || {};
}

async function loadEconomyCoreCaches() {
    groupFolderCache = {};
    groupFilesCache = {};
    try {
        const xml = await readFile(economyCorePath(), 'utf8');
        // Match each <ce folder="...">...</ce>
        const ceRe = /<ce\b[^>]*\bfolder="([^"]+)"[^>]*>([\s\S]*?)<\/ce>/gi;
        let ceMatch;
        while ((ceMatch = ceRe.exec(xml)) !== null) {
            const folder = ceMatch[1];

            if (!folder) continue;
            const parts = folder.split('/').filter(Boolean);
            const group = parts[parts.length - 1];
            if (!group) continue;
            if (!groupFolderCache[group]) groupFolderCache[group] = folder;
            const content = ceMatch[2] || '';
            // Collect <file name="..." type="types"/>
            const fileRe = /<file\b[^>]*\bname="([^"]+)"[^>]*\btype="([^"]+)"[^>]*\/?>/gi;
            let fMatch;
            const files = [];
            while ((fMatch = fileRe.exec(content)) !== null) {
                const name = fMatch[1];
                const type = (fMatch[2] || '').trim().toLowerCase();
                if (name && type === 'types') files.push(name);
            }
            if (files.length) groupFilesCache[group] = files;
        }
    } catch {
        // leave caches as empty objects if read fails
    }
}

// Test existence helper
/**
 * Strictly resolve a group's declared folder relative path from cfgeconomycore.xml.
 * Returns null if not declared (non-vanilla).
 */
async function getDeclaredGroupFolder(group) {
    const map = await getGroupFolderMap();
    return map[group] || null;
}

/**
 * Strictly resolve the declared file name (with extension) for a group by requested base name.
 * Case-insensitive match against declared file names' basenames.
 * Returns null if not declared.
 */
async function getDeclaredFileName(group, fileBase) {
    const filesMap = await getGroupFilesMap();
    const declared = filesMap[group] || [];
    const match = declared.find(n => n.replace(/\.xml$/i, '').toLowerCase() === String(fileBase).toLowerCase());
    return match || null;
}

/**
 * Compute the on-disk path for a types file for a given group and file base (strict to declarations).
 * Vanilla is special-cased to DATA_DIR/db/types.xml.
 * Returns null for undeclared non-vanilla groups or files.
 */
async function declaredTypesFilePath(group, fileBase) {

    if (group === 'vanilla') {
        return join(DATA_DIR, 'db', 'types.xml');
    }
    // Allow saving to vanilla_overrides even if not declared; create folder on write
    if (group === 'vanilla_overrides') {
        return join(DATA_DIR, 'db', 'vanilla_overrides', `${fileBase}.xml`);
    }
    const folder = await getDeclaredGroupFolder(group);
    if (!folder) return null;
    const declaredName = await getDeclaredFileName(group, fileBase);
    if (!declaredName) return null;
    return join(DATA_DIR, folder, declaredName);
}

/**
 * Compute the on-disk directory for a group's files (for changes.txt), strictly via declarations.
 */
async function declaredGroupDir(group) {
    if (group === 'vanilla') return join(DATA_DIR, 'db');
    if (group === 'vanilla_overrides') return join(DATA_DIR, 'db', 'vanilla_overrides');
    const folder = await getDeclaredGroupFolder(group);
    return folder ? join(DATA_DIR, folder) : null;
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
async function generateStashReport(start, end) {
    const root = join(DATA_DIR, 'logs');
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
    const posRe = /\{\s*<\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*>\s*}\s*$/;

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
            const z = Number(pm[3]);
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
    const m = /^(\d{1,2}:\d{2}:\d{2})\s+\|\s+Player/i.exec(line);
    return m ? m[1] : null;
}

// Extract pos=<x, y, z>; returns {x, z} or null (planar X/Z distance)
function tryParseLinePos(line) {
    const m = /pos=<\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*>/i.exec(line);
    if (!m) return null;
    const x = Number(m[1]);
    const z = Number(m[2]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return {x, z};
}

// Extract (id=XYZ ...); returns id string or null
function tryParseLineId(line) {
    const m = /\(id=([^=]+=)/i.exec(line);
    return m ? m[1] : null;
}

async function collectAdmRecordsInRange(start, end, posFilter, idSet) {
    const root = join(DATA_DIR, 'logs');
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
 * Build a minimal economycore XML by scanning DATA_DIR/db and DATA_DIR/db/types.
 */
async function synthesizeEconomyCoreXml() {
    const lines = ['<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>', '<economycore>', '\t<classes></classes>', '\t<defaults></defaults>'];

    // Helper to list group directories and XML files
    async function listGroupsAt(relBase) {
        const absBase = join(DATA_DIR, relBase);
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
 * Lint .xml and .json files under DATA_DIR using shared utils in src/utils/lint.js
 */
async function lintDataDir() {
    const { lintText } = await import('../src/utils/lint.js');
    const files = await walkFiles(DATA_DIR, (name) => /\.(xml|json)$/i.test(name));
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
        dataDir: DATA_DIR,
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

        // GET/PUT definitions (allow optional trailing slash)
        if (pathname === '/api/definitions' || pathname === '/api/definitions/') {
            if (req.method === 'GET') {
                try {
                    const xml = await readFile(defsPath(), 'utf8');
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
                const p = defsPath();
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
                const xml = await readFile(economyCorePath(), 'utf8');
                const content = String(xml || '').trim();
                if (content.length > 0) {
                    send(res, 200, xml, {'Content-Type': 'application/xml; charset=utf-8'});
                } else {
                    const synth = await synthesizeEconomyCoreXml();
                    send(res, 200, synth, {'Content-Type': 'application/xml; charset=utf-8'});
                }
            } catch {
                // If missing, synthesize from filesystem structure
                const synth = await synthesizeEconomyCoreXml();
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
                const report = await generateStashReport(start && !isNaN(start.getTime()) ? start : null, end && !isNaN(end.getTime()) ? end : null);
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
                    const spatialLines = await collectAdmRecordsInRange(start, end, {x: xf, z: zf, radius: rf}, undefined);
                    const idSet = new Set();
                    for (const row of spatialLines) {
                        const id = tryParseLineId(row);
                        if (id) idSet.add(id);
                    }

                    if (expandByIds) {
                        // Pass 2: collect by ids only (ignore positional filter), preserving order
                        lines = await collectAdmRecordsInRange(start, end, undefined, idSet);
                    }
                    else
                        lines = spatialLines;
                } else {
                    // No spatial filtering; single pass
                    lines = await collectAdmRecordsInRange(start, end, undefined, undefined);
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

        // Match /api/types/:group/:file
        const matchTypes = pathname.match(/^\/api\/types\/([^/]+)\/([^/]+)$/);
        if (matchTypes) {
            const [, groupRaw, fileRaw] = matchTypes;
            if (!isSafeName(groupRaw) || !isSafeName(fileRaw)) {
                badRequest(res, 'Invalid group or file');
                return;
            }
            const group = groupRaw;
            const fileBase = fileRaw.replace(/\.xml$/i, ''); // tolerate .xml in URL

            if (req.method === 'GET') {
                const target = await declaredTypesFilePath(group, fileBase);
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
                // Never allow persisting to the vanilla base file (./data/db/types.xml)
                if (group === 'vanilla' && fileBase === 'types') {
                    badRequest(res, 'Persisting to vanilla types.xml is not allowed.');
                    return;
                }
                const target = await declaredTypesFilePath(group, fileBase);
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
                        const dir = await declaredGroupDir(group);
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

        // Market categories: list
        if (pathname === '/api/market/categories') {
            if (req.method !== 'GET') {
                methodNotAllowed(res);
                return;
            }
            try {
                const dir = marketDirPath();
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
            if (!isSafeName(nameRaw)) {
                badRequest(res, 'Invalid category name');
                return;
            }
            const fileBase = nameRaw.replace(/\.json$/i, '');
            const target = join(marketDirPath(), `${fileBase}.json`);

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
                const results = await removeItemFromMarketplaceCompletely(className);
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
                const dir = tradersDirPath();
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
            const target = join(tradersDirPath(), `${fileBase}.map`);

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
                const dir = traderProfilesDirPath();
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
            const target = join(traderProfilesDirPath(), `${fileBase}.json`);

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
                const dir = traderZonesDirPath();
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
            if (!isSafeName(zoneRaw)) {
                badRequest(res, 'Invalid trader zone name');
                return;
            }
            const fileBase = zoneRaw.replace(/\.json$/i, '');
            const target = join(traderZonesDirPath(), `${fileBase}.json`);

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

        // Lint files (.xml, .json) under DATA_DIR
        if (pathname === '/api/lint') {
            if (req.method !== 'GET') {
                methodNotAllowed(res);
                return;
            }
            try {
                const report = await lintDataDir();
                send(res, 200, JSON.stringify(report), { 'Content-Type': 'application/json' });
            } catch (e) {
                send(res, 500, JSON.stringify({ error: 'Lint failed', detail: e && e.message ? e.message : String(e) }), { 'Content-Type': 'application/json' });
            }
            return;
        }

        // Health check / root
        if (pathname === '/' || pathname === '/api/health') {
            // Also indicate if data dir exists
            let dataOk = true;
            try {
                await stat(DATA_DIR);
            } catch {
                dataOk = false;
            }
            send(
                res,
                200,
                JSON.stringify({ok: true, dataDir: DATA_DIR, dataAvailable: dataOk}),
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
    try {
        await mkdir(DATA_DIR, {recursive: true});
    } catch {
        // ignore directory creation errors; health endpoint will report availability
    }
    console.log(`XML persistence server listening on http://localhost:${PORT}\nData dir: ${DATA_DIR}`);
});
