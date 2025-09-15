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
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir, readFile, writeFile, stat, appendFile, readdir } from 'node:fs/promises';

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
  res.writeHead(status, { ...headers, ...corsHeaders() });
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

    console.log('declaredTypesFilePath', group, fileBase);
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
  const fk = ['count_in_cargo','count_in_hoarder','count_in_map','count_in_player','crafted','deloot'];
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

function formatTs(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const h = String(d.getHours());
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${dd}-${mm}-${yy} ${h}:${m}:${s}`;
}

// ----- ADM records utilities -----
function pad2(n) { return String(n).padStart(2, '0'); }
function fileNameFromRange(start, end) {
  const fmt = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
  return `${fmt(start)}_to_${fmt(end)}.ADM`;
}
function isDigitsName(name) { return /^\d+$/.test(name); }

async function listAdmFiles(logsRoot) {
  /** @type {string[]} */
  const out = [];
  let entries = [];
  try {
    entries = await readdir(logsRoot, { withFileTypes: true });
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

function parseAdmStartDate(text) {
  const m = /AdminLog started on\s+(\d{4}-\d{2}-\d{2})\s+at\s+(\d{1,2}:\d{2}:\d{2})/i.exec(text);
  if (!m) return null;
  const [_, dateStr, timeStr] = m;
  // Interpret as local time
  const d = new Date(`${dateStr}T${timeStr}`);
  return isNaN(d.getTime()) ? null : d;
}

function tryParseLineTime(line) {
  const m = /^(\d{1,2}:\d{2}:\d{2})\s+\|\s+Player/i.exec(line);
  return m ? m[1] : null;
}

async function collectAdmRecordsInRange(start, end) {
  const root = join(DATA_DIR, 'logs');
  const files = await listAdmFiles(root);

  // Read all files and capture their start datetime and lines
  const fileBuckets = [];
  for (const f of files) {
    let text = '';
    try { text = await readFile(f, 'utf8'); } catch { continue; }
    const startDate = parseAdmStartDate(text);
    if (!startDate) continue;
    const rows = text.split(/\r?\n/);
    fileBuckets.push({ path: f, startDate, rows });
  }

  // Order files by their start datetime (earlier first), tie-breaker by path
  fileBuckets.sort((a, b) => {
    const diff = a.startDate - b.startDate;
    return diff !== 0 ? diff : String(a.path).localeCompare(String(b.path));
  });

  /** @type {string[]} */
  const lines = [];

  // For each file (in start-date order), walk lines in original order and include those within range
  for (const bucket of fileBuckets) {
    const dateStr = `${bucket.startDate.getFullYear()}-${pad2(bucket.startDate.getMonth() + 1)}-${pad2(bucket.startDate.getDate())}`;
    for (const row of bucket.rows) {
      const t = tryParseLineTime(row);
      if (!t) continue;
      const dt = new Date(`${dateStr}T${t}`);
      if (isNaN(dt.getTime())) continue;
      if (dt >= start && dt <= end) {
        lines.push(row);
      }
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
      entries = await (await import('node:fs/promises')).readdir(absBase, { withFileTypes: true });
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
        const fEntries = await (await import('node:fs/promises')).readdir(groupDir, { withFileTypes: true });
        files = fEntries.filter(e => e.isFile() && /\.xml$/i.test(e.name)).map(e => e.name);
      } catch {
        files = [];
      }
      if (files.length) {
        out.push({ folder: `${relBase}/${group}`, files: files.sort((a, b) => a.localeCompare(b)) });
      }
    }
    return out.sort((a, b) => a.folder.localeCompare(b.folder));
  }

  const groupsDb = await listGroupsAt('db');
  const groupsDbTypes = await listGroupsAt('db/types');

  const all = [...groupsDb, ...groupsDbTypes];
  for (const { folder, files } of all) {
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
  await mkdir(dir, { recursive: true });
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
  send(res, 404, JSON.stringify({ error: 'Not found' }), { 'Content-Type': 'application/json' });
}

function methodNotAllowed(res) {
  send(res, 405, JSON.stringify({ error: 'Method not allowed' }), { 'Content-Type': 'application/json' });
}

function badRequest(res, message) {
  send(res, 400, JSON.stringify({ error: message || 'Bad request' }), { 'Content-Type': 'application/json' });
}

const server = http.createServer(async (req, res) => {
  try {
    // Preflight CORS
    if (req.method === 'OPTIONS') {
      send(res, 204, '', {});
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const { pathname } = url;

    // GET/PUT definitions (allow optional trailing slash)
    if (pathname === '/api/definitions' || pathname === '/api/definitions/') {
      if (req.method === 'GET') {
        try {
          const xml = await readFile(defsPath(), 'utf8');
          send(res, 200, xml, { 'Content-Type': 'application/xml; charset=utf-8' });
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
        send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
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
          send(res, 200, xml, { 'Content-Type': 'application/xml; charset=utf-8' });
        } else {
          const synth = await synthesizeEconomyCoreXml();
          send(res, 200, synth, { 'Content-Type': 'application/xml; charset=utf-8' });
        }
      } catch {
        // If missing, synthesize from filesystem structure
        const synth = await synthesizeEconomyCoreXml();
        send(res, 200, synth, { 'Content-Type': 'application/xml; charset=utf-8' });
      }
      return;
    }

    // POST logs ADM records within range, returns a downloadable file
    if (pathname === '/api/logs/adm') {
      if (req.method !== 'POST') { methodNotAllowed(res); return; }
      let body = '';
      try {
        body = await readBody(req);
        const data = JSON.parse(body || '{}');
        const start = new Date(data.start);
        const end = new Date(data.end);
        if (!data.start || !data.end || isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
          badRequest(res, 'Invalid start/end datetimes.');
          return;
        }
        const lines = await collectAdmRecordsInRange(start, end);

        // Prepend header with start datetime; keep collected order intact
        const header = `AdminLog started on ${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())} at ${pad2(start.getHours())}:${pad2(start.getMinutes())}:${pad2(start.getSeconds())}`;
        const content = [header, ...lines].join('\n');
        const filename = fileNameFromRange(start, end);
        send(res, 200, content, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('ADM fetch error:', e);
        send(res, 500, JSON.stringify({ error: 'Failed to fetch ADM records' }), { 'Content-Type': 'application/json' });
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
        if (!target) { notFound(res); return; }
        try {
          const xml = await readFile(target, 'utf8');
          send(res, 200, xml, { 'Content-Type': 'application/xml; charset=utf-8' });
        } catch {
          // If vanilla_overrides/types.xml doesn't exist yet, return an empty types doc
          if (group === 'vanilla_overrides' && fileBase === 'types') {
            const empty = '<?xml version="1.0" encoding="UTF-8"?>\n<types></types>\n';
            send(res, 200, empty, { 'Content-Type': 'application/xml; charset=utf-8' });
          } else {
            notFound(res);
          }
        }
        return;
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        console.log("Body", body)
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
          console.log("Target", target)
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
              await mkdir(dir, { recursive: true });
              let block = `File: ${fileBase}.xml\n` + changes.join('\n') + '\n\n';
              await appendFile(join(dir, 'changes.txt'), block, 'utf8');
            }
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('Failed to append changes.txt:', e);
        }

        send(res, 200, JSON.stringify({ ok: true, path: target }), { 'Content-Type': 'application/json' });
        return;
      }
      methodNotAllowed(res);
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
        JSON.stringify({ ok: true, dataDir: DATA_DIR, dataAvailable: dataOk }),
        { 'Content-Type': 'application/json' }
      );
      return;
    }

    notFound(res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Server error:', err);
    send(res, 500, JSON.stringify({ error: 'Internal Server Error' }), { 'Content-Type': 'application/json' });
  }
});

server.listen(PORT, async () => {
  try {
    await mkdir(DATA_DIR, { recursive: true });
  } catch {
    // ignore directory creation errors; health endpoint will report availability
  }
  // eslint-disable-next-line no-console
  console.log(`XML persistence server listening on http://localhost:${PORT}\nData dir: ${DATA_DIR}`);
});
