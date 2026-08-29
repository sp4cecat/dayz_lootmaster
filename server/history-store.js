/**
 * Durable history for the companion mod's live stream.
 *
 * The live store (ingest-store.js) keeps exactly one snapshot and overwrites it
 * every tick — deliberately, because `modConnected()` must reflect a fresh push
 * rather than a stale cache. This module is the other half of that decision: a
 * *tee* off the same POST that records every tick to disk so player movement,
 * vitals and (later) actions and inventories can be queried after the fact.
 *
 * It is a tee and never a dependency. `/ingest/snapshot` MUST return 2xx — the
 * mod treats any non-2xx as an error and un-latches catalog delivery — so every
 * entry point here is designed to be called inside a try/catch and to degrade to
 * "recording is unhealthy, everything else still works".
 *
 * Storage is `node:sqlite`, built into Node 22.5+/24 with no native build and no
 * new dependency, which keeps the server's zero-runtime-dependency property (it
 * is otherwise Node stdlib plus `moment`). It is flagged experimental upstream,
 * so ALL SQL is confined to this file: swapping in better-sqlite3 is a one-file
 * change if the API churns.
 *
 * Scoping: `/ingest/*` carries no X-Profile-ID and is profile-independent, so
 * history is too. Every table nonetheless carries `srv` so a future deployment
 * with two game servers pushing at one backend can partition without a migration.
 */

import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { num, modStat, modStr, modAlive, normPosition } from './mod-wire.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * `node:sqlite` is loaded through process.getBuiltinModule rather than a static
 * import on purpose. Vite's bundled list of Node builtins predates it, so a static
 * `import ... from 'node:sqlite'` makes Vite strip the prefix, look for a package
 * called "sqlite", and fail — which would take the whole Vitest server suite down
 * with it. getBuiltinModule (Node 22.3+) exists for exactly this: reach a builtin
 * without handing a specifier to a bundler.
 *
 * It also gives us a clean answer on a Node that predates node:sqlite — undefined
 * rather than an unhandled module-resolution throw at import time.
 */
// eslint-disable-next-line no-undef
const sqlite = process.getBuiltinModule?.('node:sqlite');
const DatabaseSync = sqlite?.DatabaseSync;

/* eslint-disable no-undef */
const DB_FILE = process.env.HISTORY_DB_FILE
    ? resolve(process.env.HISTORY_DB_FILE)
    : resolve(join(__dirname, '.cache', 'history.db'));

// Recording is on unless explicitly disabled. Vitest never touches the real DB —
// same guard the catalog and spawn-ledger persisters use.
const PERSIST_DISABLED = !!process.env.VITEST || process.env.NODE_ENV === 'test';
const ENABLED = process.env.HISTORY_ENABLED !== '0';

// AI are 40+ entities on a busy server and would dwarf the player stream, so they
// are opt-in rather than on by default.
const RECORD_AI = process.env.HISTORY_RECORD_AI === '1';

const DAY_MS = 24 * 60 * 60 * 1000;
const FULL_DAYS = Number(process.env.HISTORY_FULL_DAYS || 7);
const THIN_DAYS = Number(process.env.HISTORY_THIN_DAYS || 90);
/* eslint-enable no-undef */

/** Spatial bucket edge in metres. See cellFor(). */
const CELL_M = 256;
/** Thinned resolution for positions older than FULL_DAYS. */
const THIN_BUCKET_MS = 60 * 1000;

const DEFAULT_SRV = 'default';

let db = null;
let ready = false;

// Recorder health, surfaced through stats() so a silently-dead writer is visible
// rather than looking like "the server was quiet".
let lastWriteAt = 0;
let writes = 0;
let failures = 0;
let lastError = null;
let lastErrorAt = 0;
let lastLogAt = 0;

/**
 * Pack a world position into a single-integer 256 m grid bucket.
 *
 * This is what turns "who was within 150 m of this base last week" into an index
 * seek over a handful of cells instead of a scan of every row in the range. DayZ
 * worlds top out at 16384 m, i.e. 64 cells per axis, so 16 bits per axis is ample
 * headroom and the packed value stays well inside a small integer.
 *
 * Computed on write and never derived at query time — an expression over x/z at
 * query time cannot use an index.
 */
export function cellFor(x, z) {
    const cx = Math.floor(x / CELL_M) & 0xffff;
    const cz = Math.floor(z / CELL_M) & 0xffff;
    return (cx << 16) | cz;
}

/** Every cell touched by the circle (x, z, radius). Used to drive area queries. */
export function cellsForCircle(x, z, radius) {
    const out = [];
    const minX = Math.floor((x - radius) / CELL_M);
    const maxX = Math.floor((x + radius) / CELL_M);
    const minZ = Math.floor((z - radius) / CELL_M);
    const maxZ = Math.floor((z + radius) / CELL_M);
    for (let cx = minX; cx <= maxX; cx++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
            out.push(((cx & 0xffff) << 16) | (cz & 0xffff));
        }
    }
    return out;
}

// ---- schema ----------------------------------------------------------------

// Ordered migration ladder. Each entry runs once, in order, and bumps user_version.
// Append only — never edit a shipped step, or databases in the field diverge from
// fresh ones.
const MIGRATIONS = [
    // v1 — positions, roster, server heartbeat.
    (d) => {
        d.exec(`
            CREATE TABLE IF NOT EXISTS player_pos (
                srv    TEXT    NOT NULL DEFAULT 'default',
                pid    TEXT    NOT NULL,
                ts     INTEGER NOT NULL,
                x REAL, y REAL, z REAL,
                cell   INTEGER NOT NULL,
                health REAL, blood REAL, shock REAL, energy REAL, water REAL,
                alive  INTEGER,
                hands  TEXT,
                PRIMARY KEY (srv, pid, ts)
            ) WITHOUT ROWID;

            CREATE INDEX IF NOT EXISTS ix_pos_cell ON player_pos(srv, cell, ts);
            CREATE INDEX IF NOT EXISTS ix_pos_ts   ON player_pos(srv, ts);

            CREATE TABLE IF NOT EXISTS player_seen (
                srv        TEXT NOT NULL DEFAULT 'default',
                pid        TEXT NOT NULL,
                name       TEXT,
                steam_id   TEXT,
                first_seen INTEGER,
                last_seen  INTEGER,
                PRIMARY KEY (srv, pid)
            );

            CREATE TABLE IF NOT EXISTS server_tick (
                srv    TEXT    NOT NULL DEFAULT 'default',
                ts     INTEGER NOT NULL,
                online INTEGER, ai INTEGER, fps REAL,
                hour   INTEGER, minute INTEGER,
                overcast REAL, rain REAL, fog REAL,
                PRIMARY KEY (srv, ts)
            ) WITHOUT ROWID;
        `);
    },

    // v2 — provenance, so backfilled admin-log rows are distinguishable from the
    // mod's live stream. Without this the two are indistinguishable and the gap
    // rule below cannot work: ADM samples land ~5 min apart, so every one of them
    // would read as an absence, shatter the path and render nothing.
    (d) => {
        d.exec(`
            ALTER TABLE player_pos ADD COLUMN src TEXT NOT NULL DEFAULT 'mod';
            ALTER TABLE player_pos ADD COLUMN run_start INTEGER;
        `);
    },

    // v3 — the action log and inventory snapshots pushed by the mod's event hooks.
    //
    // Both are rowid tables, not WITHOUT ROWID like player_pos: an action has no
    // natural key (two players can drop the same class at the same millisecond),
    // and a snapshot is addressed by a stable id in a URL. AUTOINCREMENT also
    // rules out id reuse after a delete, which matters when a rollback audit row
    // references a snapshot id.
    (d) => {
        d.exec(`
            CREATE TABLE IF NOT EXISTS action (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                srv     TEXT    NOT NULL DEFAULT 'default',
                ts      INTEGER NOT NULL,
                pid     TEXT,                    -- actor; null for un-attributed world events
                kind    TEXT    NOT NULL,
                cls     TEXT,                    -- item classname involved, when there is one
                x REAL, y REAL, z REAL,
                cell    INTEGER,                 -- null when the event carried no position
                detail  TEXT,                    -- free-form, mod-supplied
                -- Idempotency: (session, n) is the mod's own monotonic event number
                -- within one mission run. A retried batch re-inserts nothing.
                session TEXT,
                n       INTEGER
            );

            CREATE UNIQUE INDEX IF NOT EXISTS ux_action_seq  ON action(srv, session, n)
                WHERE session IS NOT NULL;
            CREATE INDEX IF NOT EXISTS ix_action_ts   ON action(srv, ts);
            CREATE INDEX IF NOT EXISTS ix_action_pid  ON action(srv, pid, ts);
            CREATE INDEX IF NOT EXISTS ix_action_cell ON action(srv, cell, ts);

            CREATE TABLE IF NOT EXISTS inv_snapshot (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                srv     TEXT    NOT NULL DEFAULT 'default',
                pid     TEXT    NOT NULL,
                ts      INTEGER NOT NULL,
                reason  TEXT    NOT NULL,        -- connect | disconnect | death | manual
                x REAL, y REAL, z REAL,
                cell    INTEGER,
                health REAL, blood REAL, shock REAL, energy REAL, water REAL,
                -- Denormalised so the snapshot LIST never has to parse a tree.
                items     INTEGER NOT NULL DEFAULT 0,
                truncated INTEGER NOT NULL DEFAULT 0,
                tree      TEXT    NOT NULL,      -- JSON; the unit of retrieval
                session TEXT,
                n       INTEGER
            );

            CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_seq ON inv_snapshot(srv, session, n)
                WHERE session IS NOT NULL;
            CREATE INDEX IF NOT EXISTS ix_inv_pid ON inv_snapshot(srv, pid, ts);
        `);
    },
];

/**
 * Open the database and bring the schema up to date. Safe to call more than once.
 * Returns true when recording is live, false when disabled or unavailable — the
 * caller treats false as "skip recording", never as a fatal error.
 */
export function init() {
    if (ready) return true;
    if (!ENABLED || PERSIST_DISABLED) return false;
    if (!DatabaseSync) {
        recordFailure(new Error('node:sqlite unavailable — Node 22.5+ is required to record history'));
        return false;
    }
    try {
        mkdirSync(dirname(DB_FILE), { recursive: true });
        db = new DatabaseSync(DB_FILE);
        // WAL lets the query routes read while the 5 s writer holds a transaction;
        // under the default rollback journal every /api/history/* call would
        // contend with ingest. NORMAL sync trades an fsync per commit for the
        // possibility of losing the last few ticks on a host crash — the right
        // trade for telemetry.
        db.exec('PRAGMA journal_mode = WAL');
        db.exec('PRAGMA synchronous = NORMAL');
        db.exec('PRAGMA foreign_keys = ON');
        db.exec('PRAGMA auto_vacuum = INCREMENTAL');
        runMigrations();
        ready = true;
        return true;
    } catch (err) {
        recordFailure(err);
        db = null;
        return false;
    }
}

function runMigrations() {
    const current = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
    for (let v = current; v < MIGRATIONS.length; v++) {
        MIGRATIONS[v](db);
        // PRAGMA does not accept a bound parameter, and v+1 is a loop counter.
        db.exec(`PRAGMA user_version = ${v + 1}`);
    }
}

/** Test seam: open against an explicit path (usually ':memory:'). */
export function _openForTest(file = ':memory:') {
    close();
    db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL');
    runMigrations();
    ready = true;
    lastWriteAt = 0; writes = 0; failures = 0; lastError = null; lastErrorAt = 0;
    return db;
}

export function close() {
    if (db) {
        try { db.close(); } catch { /* already closed */ }
    }
    db = null;
    ready = false;
}

function recordFailure(err) {
    failures += 1;
    lastError = (err && err.message) || String(err);
    lastErrorAt = Date.now();
    // Throttled: a broken disk would otherwise emit a line every 5 seconds forever.
    if (lastErrorAt - lastLogAt > 60000) {
        lastLogAt = lastErrorAt;
        console.warn(`[history] recording failed: ${lastError}`);
    }
}

// ---- write path ------------------------------------------------------------

/**
 * Record one mod snapshot. Called from the /ingest/snapshot handler INSIDE a
 * try/catch — it also swallows its own errors, because a recording fault must
 * never turn into a non-2xx on the route that gates catalog delivery.
 *
 * `at` is the backend's receive time, not the mod's in-game clock: the in-game
 * clock is a game-world time-of-day that wraps and can be accelerated, so it is
 * stored as data (server_tick.hour/minute) and never used as an index.
 */
export function recordSnapshot(data, at = Date.now(), srv = DEFAULT_SRV) {
    if (!ready && !init()) return false;
    if (!data || typeof data !== 'object') return false;

    try {
        const rows = [];
        const players = Array.isArray(data.players) ? data.players : [];
        for (const p of players) {
            const row = toPosRow(p, at, srv);
            if (row) rows.push(row);
        }
        if (RECORD_AI && Array.isArray(data.ai)) {
            for (const a of data.ai) {
                // AI ids are "<netLow>:<netHigh>"; prefix so they can never collide
                // with a BI plain id and can be filtered out of player queries.
                const row = toPosRow(a, at, srv, 'ai:');
                if (row) rows.push(row);
            }
        }

        const insPos = db.prepare(`
            INSERT OR REPLACE INTO player_pos
                (srv, pid, ts, x, y, z, cell, health, blood, shock, energy, water, alive, hands)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        const insSeen = db.prepare(`
            INSERT INTO player_seen (srv, pid, name, steam_id, first_seen, last_seen)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(srv, pid) DO UPDATE SET
                last_seen = excluded.last_seen,
                -- Keep the most recent non-null name; a row that arrives mid-auth
                -- with an empty name must not blank a name we already resolved.
                name      = COALESCE(excluded.name, player_seen.name),
                steam_id  = COALESCE(excluded.steam_id, player_seen.steam_id)`);

        // One transaction per tick: ~10-50 inserts committed together is a single
        // fsync instead of one per row.
        db.exec('BEGIN');
        try {
            for (const r of rows) {
                insPos.run(r.srv, r.pid, r.ts, r.x, r.y, r.z, r.cell,
                    r.health, r.blood, r.shock, r.energy, r.water, r.alive, r.hands);
                insSeen.run(r.srv, r.pid, r.name, r.steamId, r.ts, r.ts);
            }
            recordServerTick(data.server, at, srv);
            db.exec('COMMIT');
        } catch (inner) {
            try { db.exec('ROLLBACK'); } catch { /* transaction already unwound */ }
            throw inner;
        }

        lastWriteAt = at;
        writes += 1;
        return true;
    } catch (err) {
        recordFailure(err);
        return false;
    }
}

function toPosRow(p, at, srv, pidPrefix = '') {
    if (!p || typeof p !== 'object') return null;
    const pos = normPosition(p.pos);
    if (!pos) return null;                       // a row we cannot place is not history
    const rawId = modStr(p.steamId) || modStr(p.id);
    if (!rawId) return null;                     // nor is one we cannot attribute
    const [x, y, z] = pos;
    return {
        srv,
        pid: pidPrefix + rawId,
        ts: at,
        x, y, z,
        cell: cellFor(x, z),
        health: modStat(p.health),
        blood: modStat(p.blood),
        shock: modStat(p.shock),
        energy: modStat(p.energy),
        water: modStat(p.water),
        // SQLite has no boolean type; store 1/0/null so "unknown" survives.
        alive: boolToInt(modAlive(p.alive)),
        hands: modStr(p.hands),
        name: modStr(p.name),
        steamId: modStr(p.steamId),
    };
}

const boolToInt = (b) => (b === null ? null : b ? 1 : 0);

/**
 * Bulk-insert rows backfilled from admin logs. Returns the number actually stored.
 *
 * Two differences from recordSnapshot, both load-bearing:
 *
 * **OR IGNORE, not OR REPLACE.** A mod sample and an imported sample can land on
 * the same (pid, ts). The mod's is better in every way — real blood, shock and
 * hands, a recorded rather than inferred clock — so it must win. Ignoring also
 * makes re-importing an archive a no-op instead of a rewrite, which is what lets
 * the user re-run an import without thinking about it.
 *
 * **src='adm'.** See ADM_PRESENCE_GAP_MS: consumers have to be able to tell a
 * 5-minute roster cadence from a 5-second stream, or absence detection misfires.
 *
 * Unlike the ingest tee this DOES throw. An import is a foreground action the user
 * asked for and is watching, so a failure must surface rather than be swallowed.
 */
export function recordAdmRows(rows, srv = DEFAULT_SRV) {
    if (!ready && !init()) return 0;
    if (!Array.isArray(rows) || !rows.length) return 0;

    const insPos = db.prepare(`
        INSERT OR IGNORE INTO player_pos
            (srv, pid, ts, x, y, z, cell, health, blood, shock, energy, water, alive, hands, src, run_start)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'adm', ?)`);
    const insSeen = db.prepare(`
        INSERT INTO player_seen (srv, pid, name, steam_id, first_seen, last_seen)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(srv, pid) DO UPDATE SET
            first_seen = MIN(first_seen, excluded.first_seen),
            last_seen  = MAX(last_seen,  excluded.last_seen),
            name       = COALESCE(player_seen.name, excluded.name),
            steam_id   = COALESCE(player_seen.steam_id, excluded.steam_id)`);

    let inserted = 0;
    db.exec('BEGIN');
    try {
        for (const r of rows) {
            if (!Number.isFinite(r.x) || !Number.isFinite(r.z) || !Number.isFinite(r.ts)) continue;
            const res = insPos.run(
                srv, r.pid, r.ts, r.x, r.y, r.z, cellFor(r.x, r.z),
                r.health, r.blood ?? null, r.shock ?? null, r.energy, r.water,
                boolToInt(r.alive ?? null), null, r.runStart ?? null,
            );
            inserted += res.changes || 0;
            insSeen.run(srv, r.pid, r.name ?? null, r.steamId ?? null, r.ts, r.ts);
        }
        db.exec('COMMIT');
    } catch (err) {
        try { db.exec('ROLLBACK'); } catch { /* transaction already unwound */ }
        recordFailure(err);
        throw err;
    }
    return inserted;
}

function recordServerTick(server, at, srv) {
    if (!server || typeof server !== 'object') return;
    const w = server.weather && typeof server.weather === 'object' ? server.weather : {};
    db.prepare(`
        INSERT OR REPLACE INTO server_tick
            (srv, ts, online, ai, fps, hour, minute, overcast, rain, fog)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        srv, at,
        modStat(server.online), modStat(server.ai), modStat(server.fps),
        modStat(server.hour), modStat(server.minute),
        modStat(w.overcast), modStat(w.rain), modStat(w.fog),
    );
}

// ---- write path: actions and inventories -----------------------------------

/**
 * How stale a mod-reported event may claim to be before we stop believing it.
 *
 * Events carry `age` (milliseconds between the thing happening and the batch
 * being posted) rather than an absolute timestamp, because the mod has no wall
 * clock — `GetGame().GetTime()` counts from mission start. Subtracting age from
 * the receive time keeps the whole store on one clock, which is the same choice
 * recordSnapshot makes and the reason a rollback can be lined up against a path.
 *
 * The cap stops a garbage age from back-dating a row into the middle of an
 * archive, where it would be indistinguishable from real evidence.
 */
const MAX_EVENT_AGE_MS = 60 * 60 * 1000;

function instantFor(at, age) {
    const a = num(age);
    if (a === null || a <= 0) return at;
    return at - Math.min(a, MAX_EVENT_AGE_MS);
}

/** Bounds on a stored inventory tree. The mod caps too; this does not trust it. */
export const INV_MAX_NODES = 4000;
export const INV_MAX_DEPTH = 12;
/** Longest `detail` string kept on an action row. */
const DETAIL_MAX = 512;

/**
 * Normalise the mod's inventory tree, applying our own node and depth caps.
 *
 * Returns `{ tree, count, truncated }`. `truncated` is OR-ed with whatever the mod
 * reported: a tree that is short for either reason is short, and presenting a
 * partial loadout as complete is what turns a rollback into a silent theft.
 */
export function normalizeTree(nodes, state) {
    const s = state || { left: INV_MAX_NODES, truncated: false, depth: 0 };
    if (!Array.isArray(nodes) || s.depth > INV_MAX_DEPTH) {
        if (Array.isArray(nodes) && nodes.length) s.truncated = true;
        return { tree: [], state: s };
    }
    const out = [];
    for (const n of nodes) {
        if (!n || typeof n !== 'object') continue;
        const cls = modStr(n.cls);
        if (!cls) continue;                      // a node we cannot name cannot be restored
        if (s.left <= 0) { s.truncated = true; break; }
        s.left -= 1;
        const child = normalizeTree(n.children, { ...s, depth: s.depth + 1 });
        // The recursion consumed budget and may have truncated; carry both back up.
        s.left = child.state.left;
        s.truncated = s.truncated || child.state.truncated;
        out.push({
            cls,
            // "" means "not in a slot" (i.e. cargo) — a sentinel, not a slot name.
            slot: modStr(n.slot),
            where: modStr(n.where) || 'cargo',
            health01: modStat(n.health01),
            healthLevel: modStat(n.healthLevel),
            quantity: modStat(n.quantity),
            quantityMax: modStat(n.quantityMax),
            row: modStat(n.row),
            col: modStat(n.col),
            displayName: modStr(n.displayName),
            children: child.tree,
        });
    }
    return { tree: out, state: s };
}

/** Count nodes in a normalised tree. Stored so the list view never parses JSON. */
function countNodes(tree) {
    let n = 0;
    for (const node of tree) n += 1 + countNodes(node.children);
    return n;
}

function toActionRow(e, at, srv, session) {
    if (!e || typeof e !== 'object') return null;
    const kind = modStr(e.kind);
    if (!kind) return null;                      // an event with no verb is not an event
    const pos = normPosition(e.pos);
    const detail = modStr(e.detail);
    const n = num(e.n);
    return {
        srv,
        ts: instantFor(at, e.age),
        pid: modStr(e.pid),
        kind,
        cls: modStr(e.cls),
        x: pos ? pos[0] : null,
        y: pos ? pos[1] : null,
        z: pos ? pos[2] : null,
        cell: pos ? cellFor(pos[0], pos[2]) : null,
        detail: detail ? detail.slice(0, DETAIL_MAX) : null,
        session,
        n: n === null ? null : Math.trunc(n),
    };
}

/**
 * Record a batch of action events. Called from /ingest/events inside a try/catch,
 * and swallows its own errors for the same reason recordSnapshot does.
 *
 * Insertion is OR IGNORE against (srv, session, n), so the mod can retry a batch
 * it never saw acknowledged without duplicating half of it. That matters more
 * here than for snapshots: a snapshot re-sent is a position we already had, but a
 * pickup re-sent is a second pickup that never happened.
 */
export function recordEvents(batch, at = Date.now(), srv = DEFAULT_SRV) {
    if (!ready && !init()) return 0;
    if (!batch || typeof batch !== 'object') return 0;
    const events = Array.isArray(batch.events) ? batch.events : [];
    if (!events.length) return 0;
    const session = modStr(batch.session);

    try {
        const ins = db.prepare(`
            INSERT OR IGNORE INTO action
                (srv, ts, pid, kind, cls, x, y, z, cell, detail, session, n)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
        let inserted = 0;
        db.exec('BEGIN');
        try {
            for (const e of events) {
                const r = toActionRow(e, at, srv, session);
                if (!r) continue;
                const res = ins.run(r.srv, r.ts, r.pid, r.kind, r.cls,
                    r.x, r.y, r.z, r.cell, r.detail, r.session, r.n);
                inserted += Number(res.changes || 0);
            }
            db.exec('COMMIT');
        } catch (inner) {
            try { db.exec('ROLLBACK'); } catch { /* already unwound */ }
            throw inner;
        }
        lastWriteAt = at;
        writes += 1;
        return inserted;
    } catch (err) {
        recordFailure(err);
        return 0;
    }
}

/**
 * Record one action originating HERE rather than in the game — currently only the
 * rollback audit row. It carries no session, so it is exempt from the dedup index
 * and can never collide with a mod-assigned sequence number.
 *
 * Unlike recordEvents this throws: an audit row that silently failed to write
 * would leave an applied rollback with no trace, which is worse than the rollback
 * failing outright.
 */
export function recordAction({ ts = Date.now(), pid = null, kind, cls = null, pos = null, detail = null }, srv = DEFAULT_SRV) {
    if (!ready && !init()) return null;
    const p = normPosition(pos);
    const res = db.prepare(`
        INSERT INTO action (srv, ts, pid, kind, cls, x, y, z, cell, detail)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        srv, ts, pid, kind, cls,
        p ? p[0] : null, p ? p[1] : null, p ? p[2] : null,
        p ? cellFor(p[0], p[2]) : null,
        detail ? String(detail).slice(0, DETAIL_MAX) : null,
    );
    return Number(res.lastInsertRowid);
}

/**
 * Record one inventory snapshot. Returns the stored row's id, or null.
 *
 * The tree is stored as JSON in one column rather than exploded into rows. It is
 * only ever read whole — a rollback needs every node or none of them — and a
 * normalised item table would mean a recursive CTE on every read to answer a
 * question nobody asks ("which players ever carried an SVD" is what the action
 * log is for).
 */
export function recordInventory(payload, at = Date.now(), srv = DEFAULT_SRV) {
    if (!ready && !init()) return null;
    if (!payload || typeof payload !== 'object') return null;
    const pid = modStr(payload.pid);
    if (!pid) return null;                       // a loadout we cannot attribute is not evidence

    try {
        const { tree, state } = normalizeTree(payload.tree);
        const pos = normPosition(payload.pos);
        const stats = payload.stats && typeof payload.stats === 'object' ? payload.stats : {};
        const session = modStr(payload.session);
        const n = num(payload.n);
        const res = db.prepare(`
            INSERT OR IGNORE INTO inv_snapshot
                (srv, pid, ts, reason, x, y, z, cell,
                 health, blood, shock, energy, water,
                 items, truncated, tree, session, n)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            srv, pid, instantFor(at, payload.age), modStr(payload.reason) || 'manual',
            pos ? pos[0] : null, pos ? pos[1] : null, pos ? pos[2] : null,
            pos ? cellFor(pos[0], pos[2]) : null,
            modStat(stats.health), modStat(stats.blood), modStat(stats.shock),
            modStat(stats.energy), modStat(stats.water),
            countNodes(tree),
            // The mod's own truncation flag OR ours — see normalizeTree.
            (state.truncated || payload.truncated === true || payload.truncated === 1) ? 1 : 0,
            JSON.stringify(tree),
            session, n === null ? null : Math.trunc(n),
        );
        lastWriteAt = at;
        writes += 1;
        return res.changes ? Number(res.lastInsertRowid) : null;
    } catch (err) {
        recordFailure(err);
        return null;
    }
}

// ---- read path -------------------------------------------------------------

const asPoint = (r) => ({
    ts: r.ts,
    x: r.x,
    y: r.y,
    z: r.z,
    health: r.health,
    blood: r.blood,
    shock: r.shock,
    energy: r.energy,
    water: r.water,
    alive: r.alive === null ? null : r.alive === 1,
    hands: r.hands,
    // Where this sample came from: the mod's 5 s stream, or an imported admin log.
    // Exposed so the UI can be honest about a track's real resolution.
    src: r.src || 'mod',
    // True when the player was ABSENT between the previous point and this one.
    // Only ever set here, from the raw sampling — see queryTrack.
    gap: r.isGap === 1,
});

/**
 * How long a player must be missing from the snapshot stream before it counts as
 * an absence rather than a hiccup. The mod pushes every ~5 s, so a minute is a
 * dozen missed ticks — comfortably past a server stutter, well short of a logout.
 */
export const PRESENCE_GAP_MS = 60_000;

/**
 * The same threshold for rows backfilled from admin logs.
 *
 * DayZ writes its positioned player roster every ~5 minutes, so the mod's
 * one-minute rule would mark literally every imported sample as an absence —
 * shattering each track into single points that draw nothing. Twenty minutes
 * clears several missed roster dumps while still being far short of a session.
 */
export const ADM_PRESENCE_GAP_MS = 20 * 60_000;

/**
 * Per-row absence threshold, chosen by the row's own source.
 *
 * Inlined rather than bound: node:sqlite binds every JS number as REAL, and a
 * REAL comparison here would be subtly wrong in the same way the float division
 * in prune() was. These are module constants, never user input.
 */
const GAP_MS_SQL = `CASE WHEN src = 'adm' THEN ${ADM_PRESENCE_GAP_MS} ELSE ${PRESENCE_GAP_MS} END`;

/** Players with at least one sample in [from, to]. */
export function listPlayers({ from, to, srv = DEFAULT_SRV } = {}) {
    if (!ready && !init()) return [];
    return db.prepare(`
        SELECT p.pid                AS pid,
               s.name               AS name,
               s.steam_id           AS steamId,
               COUNT(*)             AS samples,
               MIN(p.ts)            AS firstTs,
               MAX(p.ts)            AS lastTs
          FROM player_pos p
          LEFT JOIN player_seen s ON s.srv = p.srv AND s.pid = p.pid
         WHERE p.srv = ? AND p.ts BETWEEN ? AND ?
         GROUP BY p.pid
         ORDER BY samples DESC`).all(srv, from, to);
}

/**
 * Ordered points per player over [from, to].
 *
 * Decimation is two-stage. A SQL modulo stride caps how many rows are ever
 * materialised (a week of one player at 5 s is 120 k rows, and pulling all of
 * them into JS to throw 118 k away is the slow way to do it); the caller then
 * applies Ramer-Douglas-Peucker to the survivors. The stride is deliberately
 * coarse and shape-blind, which is exactly why RDP runs after it rather than
 * instead of it — a stride alone clips corners, and corners are the route.
 *
 * ## Why absence is a flag and not a timestamp comparison
 *
 * Every point carries `gap`: "the player was not here between the previous point
 * and this one". It is computed HERE, from the raw sampling, because after
 * decimation a time difference no longer means anything about presence. A player
 * walking a straight road for an hour collapses to two points an hour apart, and a
 * consumer that infers absence from that interval will shatter the path and refuse
 * to interpolate — which is exactly the bug this flag exists to prevent.
 *
 * The gap boundaries are force-retained through the stride (`dt`/`dtNext`) so
 * thinning can never silently discard the evidence of an absence.
 */
export function queryTrack({ pids, from, to, maxRows = 20000, srv = DEFAULT_SRV }) {
    if (!ready && !init()) return [];
    const ids = (Array.isArray(pids) ? pids : [pids]).filter(Boolean).map(String);
    if (!ids.length) return [];

    const holes = ids.map(() => '?').join(',');
    const total = db.prepare(
        `SELECT COUNT(*) AS c FROM player_pos
          WHERE srv = ? AND pid IN (${holes}) AND ts BETWEEN ? AND ?`,
    ).get(srv, ...ids, from, to).c;

    const stride = total > maxRows ? Math.ceil(total / maxRows) : 1;

    // `rn % stride = 0` over a per-player row number: an even sample of each
    // track, not of the interleaved union (which would favour whoever was online).
    //
    // Binding `stride` is safe here even though node:sqlite binds JS numbers as
    // REAL, because SQLite's `%` casts both operands to INTEGER first. `/` does
    // NOT — see the inlined bucket size in prune(), which is the same hazard.
    // `dt` is the interval back to the previous RAW sample and `dtNext` the interval
    // forward. Rows on either side of a real absence are kept regardless of the
    // stride, so thinning can never erase a gap boundary.
    const rows = db.prepare(`
        SELECT pid, ts, x, y, z, health, blood, shock, energy, water, alive, hands, src,
               CASE WHEN runStartFlag = 1 OR dt > gapMs THEN 1 ELSE 0 END AS isGap
          FROM (
            SELECT *,
                   ROW_NUMBER() OVER (PARTITION BY pid ORDER BY ts) AS rn,
                   ts - LAG(ts)  OVER (PARTITION BY pid ORDER BY ts) AS dt,
                   LEAD(ts) OVER (PARTITION BY pid ORDER BY ts) - ts AS dtNext,
                   ${GAP_MS_SQL} AS gapMs,
                   run_start AS runStartFlag,
                   LEAD(run_start) OVER (PARTITION BY pid ORDER BY ts) AS nextRunStart
              FROM player_pos
             WHERE srv = ? AND pid IN (${holes}) AND ts BETWEEN ? AND ?
          )
         WHERE (rn - 1) % ? = 0
            OR dt > gapMs OR dtNext > gapMs
            OR runStartFlag = 1 OR nextRunStart = 1
         ORDER BY pid, ts`).all(srv, ...ids, from, to, stride);

    const byPid = new Map();
    for (const r of rows) {
        let t = byPid.get(r.pid);
        if (!t) { t = []; byPid.set(r.pid, t); }
        t.push(asPoint(r));
    }
    const names = nameMap(ids, srv);
    return ids
        .filter(pid => byPid.has(pid))
        .map(pid => ({
            pid,
            name: names.get(pid) || null,
            stride,
            points: byPid.get(pid),
        }));
}

function nameMap(pids, srv) {
    const out = new Map();
    if (!pids.length) return out;
    const holes = pids.map(() => '?').join(',');
    for (const r of db.prepare(
        `SELECT pid, name FROM player_seen WHERE srv = ? AND pid IN (${holes})`,
    ).all(srv, ...pids)) {
        out.set(r.pid, r.name);
    }
    return out;
}

/**
 * One row per player, nearest to `ts` within `tol` ms. The playback frame.
 *
 * Playback interpolates client-side from a track it already holds, so this is for
 * seeking and for "who was online at this instant" — not a per-frame call.
 */
export function queryAt({ ts, tol = 30000, srv = DEFAULT_SRV }) {
    if (!ready && !init()) return [];
    const rows = db.prepare(`
        SELECT pid, ts, x, y, z, health, blood, shock, energy, water, alive, hands, src
          FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY pid ORDER BY ABS(ts - ?)) AS rn
              FROM player_pos
             WHERE srv = ? AND ts BETWEEN ? AND ?
          )
         WHERE rn = 1`).all(ts, srv, ts - tol, ts + tol);
    const names = nameMap(rows.map(r => r.pid), srv);
    return rows.map(r => ({ pid: r.pid, name: names.get(r.pid) || null, ...asPoint(r) }));
}

/**
 * Who was inside the circle (x, z, radius) during [from, to].
 *
 * Returns presence INTERVALS, not points. Consecutive in-radius samples collapse
 * into one visit; a gap longer than `gapMs` starts a new one. A raw point dump
 * would be thousands of rows all saying "this player stood here", and the useful
 * questions ("when, for how long, how close") are interval questions.
 *
 * The cell index does the coarse work; the exact planar distance test then
 * discards the corners of the covered cells. Distance is X/Z only — elevation
 * never participates, matching the ADM search this sits alongside.
 */
export function queryArea({ x, z, radius, from, to, gapMs = 60000, srv = DEFAULT_SRV }) {
    if (!ready && !init()) return [];
    const cells = cellsForCircle(x, z, radius);
    if (!cells.length) return [];
    const holes = cells.map(() => '?').join(',');
    const r2 = radius * radius;

    const rows = db.prepare(`
        SELECT pid, ts, x, y, z
          FROM player_pos
         WHERE srv = ? AND cell IN (${holes}) AND ts BETWEEN ? AND ?
         ORDER BY pid, ts`).all(srv, ...cells, from, to);

    const visits = [];
    let cur = null;
    for (const r of rows) {
        const dx = r.x - x, dz = r.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2);
        if (cur && cur.pid === r.pid && r.ts - cur.leftAt <= gapMs) {
            cur.leftAt = r.ts;
            cur.samples += 1;
            if (d < cur.closestM) { cur.closestM = d; cur.closestAt = r.ts; }
        } else {
            cur = {
                pid: r.pid, enteredAt: r.ts, leftAt: r.ts, samples: 1,
                closestM: d, closestAt: r.ts,
            };
            visits.push(cur);
        }
    }

    const names = nameMap([...new Set(visits.map(v => v.pid))], srv);
    return visits
        .map(v => ({
            ...v,
            name: names.get(v.pid) || null,
            durationMs: v.leftAt - v.enteredAt,
            closestM: Math.round(v.closestM * 10) / 10,
        }))
        .sort((a, b) => a.enteredAt - b.enteredAt);
}

/**
 * Action-log query: by player, by kind, by time, and optionally by circle.
 *
 * The circle filter goes through the same `cell` index as queryArea and then
 * re-tests exact planar distance, so "what happened at this base" costs an index
 * seek over a handful of buckets rather than a scan. Rows with no position (a
 * connect, say) are excluded when a circle is given — a location-less event
 * cannot honestly be claimed to have happened inside one.
 *
 * `limit` is a hard cap, and `truncated` says whether it bit. A feed that silently
 * stops at 500 rows reads as "nothing else happened".
 */
export function queryActions({
    pids, kinds, from, to, x, z, radius, limit = 1000, srv = DEFAULT_SRV,
} = {}) {
    if (!ready && !init()) return { items: [], truncated: false };

    const where = ['srv = ?', 'ts BETWEEN ? AND ?'];
    const args = [srv, from, to];

    const ids = (Array.isArray(pids) ? pids : pids ? [pids] : []).filter(Boolean).map(String);
    if (ids.length) {
        where.push(`pid IN (${ids.map(() => '?').join(',')})`);
        args.push(...ids);
    }
    const kindList = (Array.isArray(kinds) ? kinds : kinds ? [kinds] : []).filter(Boolean).map(String);
    if (kindList.length) {
        where.push(`kind IN (${kindList.map(() => '?').join(',')})`);
        args.push(...kindList);
    }

    const circle = Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(radius) && radius > 0;
    if (circle) {
        const cells = cellsForCircle(x, z, radius);
        where.push(`cell IN (${cells.map(() => '?').join(',')})`);
        args.push(...cells);
    }

    // One extra row, so "did the limit bite" is answered without a COUNT(*).
    const cap = Math.max(1, Math.min(limit, 10000));
    const rows = db.prepare(`
        SELECT id, ts, pid, kind, cls, x, y, z, detail
          FROM action
         WHERE ${where.join(' AND ')}
         ORDER BY ts DESC
         LIMIT ?`).all(...args, cap + 1);

    let kept = rows;
    if (circle) {
        const r2 = radius * radius;
        kept = rows.filter((r) => {
            if (r.x === null || r.z === null) return false;
            const dx = r.x - x, dz = r.z - z;
            return dx * dx + dz * dz <= r2;
        });
    }
    // Measured on the SQL result, not the distance-filtered one: the LIMIT bit if
    // the database had more rows to give, whether or not the circle then discarded
    // some of them.
    const truncated = rows.length > cap;
    if (kept.length > cap) kept = kept.slice(0, cap);

    const names = nameMap([...new Set(kept.map(r => r.pid).filter(Boolean))], srv);
    return {
        truncated,
        // Chronological for a feed, even though the LIMIT had to run newest-first.
        items: kept.reverse().map(r => ({
            id: r.id,
            ts: r.ts,
            pid: r.pid,
            name: r.pid ? (names.get(r.pid) || null) : null,
            kind: r.kind,
            cls: r.cls,
            x: r.x, y: r.y, z: r.z,
            detail: r.detail,
        })),
    };
}

/** Distinct action kinds present in the window; drives the feed's filter chips. */
export function actionKinds({ from, to, srv = DEFAULT_SRV } = {}) {
    if (!ready && !init()) return [];
    return db.prepare(
        `SELECT kind, COUNT(*) AS count FROM action
          WHERE srv = ? AND ts BETWEEN ? AND ?
          GROUP BY kind ORDER BY count DESC`,
    ).all(srv, from, to);
}

/**
 * Inventory snapshots for a player (or everyone), newest first, WITHOUT the tree.
 *
 * The tree is deliberately not selected: a list of a season's snapshots would be
 * tens of megabytes of JSON to render a dozen rows of "when, why, how many items".
 * Fetch one by id when it is actually opened.
 */
export function listInventory({ pid, from, to, limit = 200, srv = DEFAULT_SRV } = {}) {
    if (!ready && !init()) return [];
    const where = ['srv = ?'];
    const args = [srv];
    if (pid) { where.push('pid = ?'); args.push(String(pid)); }
    if (Number.isFinite(from) && Number.isFinite(to)) {
        where.push('ts BETWEEN ? AND ?');
        args.push(from, to);
    }
    const rows = db.prepare(`
        SELECT id, pid, ts, reason, x, y, z, health, blood, shock, energy, water,
               items, truncated
          FROM inv_snapshot
         WHERE ${where.join(' AND ')}
         ORDER BY ts DESC
         LIMIT ?`).all(...args, Math.max(1, Math.min(limit, 2000)));

    const names = nameMap([...new Set(rows.map(r => r.pid))], srv);
    return rows.map(r => ({
        id: r.id,
        pid: r.pid,
        name: names.get(r.pid) || null,
        ts: r.ts,
        reason: r.reason,
        pos: r.x === null ? null : { x: r.x, y: r.y, z: r.z },
        stats: {
            health: r.health, blood: r.blood, shock: r.shock,
            energy: r.energy, water: r.water,
        },
        items: r.items,
        truncated: r.truncated === 1,
    }));
}

/** One snapshot with its tree parsed, or null. */
export function getInventory(id, srv = DEFAULT_SRV) {
    if (!ready && !init()) return null;
    const r = db.prepare(
        'SELECT * FROM inv_snapshot WHERE srv = ? AND id = ?',
    ).get(srv, Number(id));
    if (!r) return null;
    let tree = [];
    try {
        tree = JSON.parse(r.tree);
    } catch {
        // Unparseable JSON means the row is not a loadout any more. Report it as an
        // empty, truncated tree rather than throwing: the snapshot's metadata is
        // still true, and a rollback will correctly refuse to restore nothing.
        return {
            id: r.id, pid: r.pid, name: nameMap([r.pid], srv).get(r.pid) || null,
            ts: r.ts, reason: r.reason,
            pos: r.x === null ? null : { x: r.x, y: r.y, z: r.z },
            stats: { health: r.health, blood: r.blood, shock: r.shock, energy: r.energy, water: r.water },
            items: 0, truncated: true, corrupt: true, tree: [],
        };
    }
    return {
        id: r.id,
        pid: r.pid,
        name: nameMap([r.pid], srv).get(r.pid) || null,
        ts: r.ts,
        reason: r.reason,
        pos: r.x === null ? null : { x: r.x, y: r.y, z: r.z },
        stats: {
            health: r.health, blood: r.blood, shock: r.shock,
            energy: r.energy, water: r.water,
        },
        items: r.items,
        truncated: r.truncated === 1,
        tree,
    };
}

/** Recorder health + volume. Drives the tool's empty/unhealthy states. */
export function stats(srv = DEFAULT_SRV) {
    const base = {
        enabled: ENABLED && !PERSIST_DISABLED,
        ready,
        dbFile: DB_FILE,
        writes,
        failures,
        lastWriteAt: lastWriteAt || null,
        lastError,
        lastErrorAt: lastErrorAt || null,
        recordAi: RECORD_AI,
        retention: { fullDays: FULL_DAYS, thinDays: THIN_DAYS },
    };
    if (!ready && !init()) return { ...base, rows: 0, players: 0, from: null, to: null, bytes: null, actions: 0, inventories: 0 };
    try {
        const agg = db.prepare(
            'SELECT COUNT(*) AS rows, MIN(ts) AS lo, MAX(ts) AS hi FROM player_pos WHERE srv = ?',
        ).get(srv);
        const players = db.prepare(
            'SELECT COUNT(*) AS c FROM player_seen WHERE srv = ?',
        ).get(srv).c;
        // Split by provenance so the tool can say what a range is actually made of.
        // "4 million rows" reads very differently when most of them are 5-minute
        // admin-log backfill rather than 5-second mod samples.
        const bySrc = { mod: 0, adm: 0 };
        for (const r of db.prepare(
            'SELECT src, COUNT(*) AS c FROM player_pos WHERE srv = ? GROUP BY src',
        ).all(srv)) {
            bySrc[r.src] = r.c;
        }
        // Reported separately from `rows`, not folded into it. "4 million records"
        // would hide the fact that the action log is empty because the mod predates
        // the event hooks — which is exactly the question the actions feed raises
        // when it shows nothing.
        const actions = db.prepare('SELECT COUNT(*) AS c FROM action WHERE srv = ?').get(srv).c;
        const inventories = db.prepare('SELECT COUNT(*) AS c FROM inv_snapshot WHERE srv = ?').get(srv).c;
        let bytes = null;
        try { bytes = statSync(DB_FILE).size; } catch { /* :memory: has no file */ }
        return {
            ...base, ready: true,
            rows: agg.rows, players, from: agg.lo, to: agg.hi, bytes, bySrc,
            actions, inventories,
        };
    } catch (err) {
        recordFailure(err);
        return { ...base, rows: 0, players: 0, from: null, to: null, bytes: null, actions: 0, inventories: 0 };
    }
}

// ---- retention -------------------------------------------------------------

/**
 * Apply the tiered retention policy. Returns what it removed.
 *
 *   newer than FULL_DAYS  full 5 s fidelity, untouched
 *   FULL_DAYS..THIN_DAYS  thinned to one sample per player per minute
 *   older than THIN_DAYS  deleted
 *
 * Thinning keeps the FIRST sample in each minute bucket rather than an average:
 * a real observed position, at a real timestamp, is still evidence. A synthesised
 * mean of two positions is a place the player provably never stood.
 */
export function prune(now = Date.now(), srv = DEFAULT_SRV) {
    if (!ready && !init()) return null;
    const thinCutoff = now - FULL_DAYS * DAY_MS;
    const dropCutoff = now - THIN_DAYS * DAY_MS;
    const result = { thinned: 0, dropped: 0, ticksThinned: 0, actionsDropped: 0, inventoriesDropped: 0 };

    try {
        db.exec('BEGIN');
        try {
            // Imported admin-log rows are exempt from retention, and the exemption
            // is the whole reason the import is worth having. An archive is almost
            // always OLDER than the drop cutoff — backfilling 2022 logs into a
            // 90-day window would delete every row on the next hourly pass.
            //
            // They are also cheap to keep (a 5-minute roster cadence, not 5-second)
            // and impossible to recover once the operator deletes the log archive,
            // whereas mod rows are replaced continuously by the live stream. If this
            // ever needs a bound, it should be an explicit "forget imported range"
            // action, not a silent age sweep.
            const dropped = db.prepare(
                "DELETE FROM player_pos WHERE srv = ? AND ts < ? AND src <> 'adm'",
            ).run(srv, dropCutoff);
            result.dropped = Number(dropped.changes || 0);

            // The bucket size is INLINED, not bound. node:sqlite binds every JS
            // number as REAL, so `ts / ?` is float division — 1000000/60000 comes
            // back as 16.666… and every row lands in its own group, which makes the
            // whole DELETE a silent no-op that still reports success. A literal
            // keeps it integer division. THIN_BUCKET_MS is a module constant, never
            // user input, so interpolating it is not an injection surface.
            // Row-value IN needs SQLite 3.15+; Node bundles far newer.
            const thinned = db.prepare(`
                DELETE FROM player_pos
                 WHERE srv = ? AND ts < ? AND ts >= ? AND src <> 'adm'
                   AND (pid, ts) NOT IN (
                        SELECT pid, MIN(ts) FROM player_pos
                         WHERE srv = ? AND ts < ? AND ts >= ?
                         GROUP BY pid, ts / ${THIN_BUCKET_MS})`,
            ).run(srv, thinCutoff, dropCutoff, srv, thinCutoff, dropCutoff);
            result.thinned = Number(thinned.changes || 0);

            const ticks = db.prepare(`
                DELETE FROM server_tick
                 WHERE srv = ? AND ts < ?
                   AND ts NOT IN (
                        SELECT MIN(ts) FROM server_tick
                         WHERE srv = ? AND ts < ? GROUP BY ts / ${THIN_BUCKET_MS})`,
            ).run(srv, thinCutoff, srv, thinCutoff);
            result.ticksThinned = Number(ticks.changes || 0);

            db.prepare('DELETE FROM server_tick WHERE srv = ? AND ts < ?').run(srv, dropCutoff);

            // Actions and inventories are kept at FULL fidelity to the drop cutoff
            // and then deleted outright — never thinned. Thinning a position stream
            // loses resolution; thinning an action log loses events, and "he picked
            // it up at 04:12" has no coarser version that is still true.
            const acts = db.prepare('DELETE FROM action WHERE srv = ? AND ts < ?').run(srv, dropCutoff);
            result.actionsDropped = Number(acts.changes || 0);
            const invs = db.prepare('DELETE FROM inv_snapshot WHERE srv = ? AND ts < ?').run(srv, dropCutoff);
            result.inventoriesDropped = Number(invs.changes || 0);

            db.exec('COMMIT');
        } catch (inner) {
            try { db.exec('ROLLBACK'); } catch { /* already unwound */ }
            throw inner;
        }

        // Incremental, never a blocking full VACUUM: this runs on a live server.
        if (result.dropped || result.thinned || result.actionsDropped || result.inventoriesDropped) {
            try { db.exec('PRAGMA incremental_vacuum'); } catch { /* best effort */ }
        }
        return result;
    } catch (err) {
        recordFailure(err);
        return null;
    }
}

let pruneTimer = null;

/** Prune now, then hourly. The timer is unref()'d so it never holds the process open. */
export function startRetention() {
    if (pruneTimer || !ENABLED || PERSIST_DISABLED) return;
    prune();
    pruneTimer = setInterval(() => prune(), 60 * 60 * 1000);
    pruneTimer.unref?.();
}

export function stopRetention() {
    if (pruneTimer) clearInterval(pruneTimer);
    pruneTimer = null;
}
