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
import { mkdir, readFile, writeFile, stat, appendFile } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT || 4317);
const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, '..', 'data'));

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

function typesPath(group, fileBase) {
  // Special-case vanilla to map to data/db/types.xml
  if (group === 'vanilla') {
    return join(DATA_DIR, 'db', 'types.xml');
  }
  return join(DATA_DIR, 'db', 'types', group, `${fileBase}.xml`);
}

function groupDirPath(group) {
  // Where to place changes.txt for this group
  if (group === 'vanilla') {
    return join(DATA_DIR, 'db');
  }
  return join(DATA_DIR, 'db', 'types', group);
}

function economyCorePath() {
  // Explicitly use ./data/cfgeconomycore.xml
  return join(DATA_DIR, 'cfgeconomycore.xml');
}

function extractTypeNames(xml) {
  // Lightweight extraction of <type name="..."> occurrences
  const names = new Set();
  const re = /<type\s+[^>]*\bname="([^"]+)"/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) names.add(m[1]);
  }
  return names;
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

async function ensureDirFor(filePath) {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
}

async function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
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
        send(res, 200, xml, { 'Content-Type': 'application/xml; charset=utf-8' });
      } catch {
        // If missing, return a minimal valid empty document instead of 404
        const empty = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<economycore></economycore>\n';
        send(res, 200, empty, { 'Content-Type': 'application/xml; charset=utf-8' });
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
        try {
          const p = typesPath(group, fileBase);
          const xml = await readFile(p, 'utf8');
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
        const p = typesPath(group, fileBase);

        // Read previous content if present for diff
        let prev = '';
        try {
          prev = await readFile(p, 'utf8');
        } catch {
          // no previous file
        }

        // Write new content
        await ensureDirFor(p);
        await writeFile(p, body, 'utf8');

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
            const dir = groupDirPath(group);
            await mkdir(dir, { recursive: true });
            let block = `File: ${fileBase}.xml\n` + changes.join('\n') + '\n\n';
            await appendFile(join(dir, 'changes.txt'), block, 'utf8');
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('Failed to append changes.txt:', e);
        }

        send(res, 200, JSON.stringify({ ok: true, path: p }), { 'Content-Type': 'application/json' });
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
