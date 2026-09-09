/**
 * Loot-cycle scorer — who is churning spawn points rather than looting them.
 *
 * "Loot cycling" is picking up loot you do not want so the spawn point frees and
 * something better respawns. Nobody does it by accident: its signature is a
 * pickup followed by a drop of the same item seconds later, over and over, in the
 * same building, on items that had only just spawned. The trouble is that the
 * innocent version of every one of those signals also exists — a player tidying a
 * base drops dozens of things in a minute, a player sorting loot into a crate
 * "picks up and stashes" all afternoon, and a player who dies drops everything at
 * once without touching a key.
 *
 * ## Why pairing comes before scoring
 *
 * The raw `action` feed is a list of pickups and drops with no link between them.
 * A drop on its own is not evidence of anything: the item may have come out of a
 * tent, a corpse, or a crafting recipe. So the first job is to pair each drop with
 * the pickup that put the item in the player's hands, and only the pairings that
 * survive a set of exclusions become "cycles". Everything that scores is computed
 * over cycles; everything that does not pair is counted the other way, as
 * evidence that the player is doing something else entirely.
 *
 * Pairing prefers the mod's item identity (`iid`) — the same physical entity —
 * and falls back to class-name FIFO when identity is missing, because an older
 * mod build sends none. That fallback is why `capable.iid === false` silences the
 * score outright: class pairing is a fair display aid but a poor basis for
 * punishing anyone, and a missing field must never raise a score.
 *
 * ## Why the state is bounded and replayable
 *
 * The runner keeps one `PlayerState` per active player and feeds rows as they
 * arrive; nothing here touches a clock, a file, or the database. Every list is
 * pruned to the trailing scoring window, the open-pickup map is capped, idle
 * players are evicted by `sweep`, and a restart costs exactly one replay of the
 * last hour of rows. `nextFlag` is the persisted-flag hysteresis in the same pure
 * style, so the ladder that acts on a flag can be tested without a timer.
 */

// ---------------------------------------------------------------------------
// Tuning constants. Exported so tests can assert against them and so an operator
// reading a surprising number can find the knob that produced it.
// ---------------------------------------------------------------------------

/** Trailing window over which factors are computed. Everything older is forgotten. */
export const WINDOW_MS = 60 * 60_000;

/**
 * Oldest open pickup a drop may still pair with by class. Past this the pickup is
 * dead: even matched by identity it could not be held briefly enough to be a cycle.
 */
export const PAIR_WINDOW_MS = 30 * 60_000;

/** A pairing held longer than this is loot that was used or carried, not cycled. */
export const CYCLE_MAX_HELD_MS = 10 * 60_000;

/** "Quick" — dropped almost immediately. Also the limit for a stash to count as a cycle. */
export const QUICK_MS = 20_000;

/** Pickups this soon after a connect are the client re-firing inventory hooks on load. */
export const LOAD_GRACE_MS = 90_000;

/** A dump is at least this many cycle-drops... */
export const DUMP_MIN = 5;

/** ...inside this span. */
export const DUMP_SPAN_MS = 60_000;

/** Sliding span for the peak-rate factor. */
export const RATE_SPAN_MS = 10 * 60_000;

/** Below this many pickups a discard ratio is noise: one cycle out of one is 100%. */
export const RATIO_MIN_PICKUPS = 8;

/** Drop within this distance of the pickup = same room or building = the spawn point itself. */
export const SPAWN_RADIUS_M = 15;

/** Cap on open (unpaired) pickups per player. Oldest is evicted past this. */
export const OPEN_MAX = 400;

/** A player with no rows for this long is dropped from the state map. */
export const IDLE_EVICT_MS = 2 * 3_600_000;

/** Greedy cluster radius for a player's own deploy/stash events. */
export const HOME_CLUSTER_M = 50;

/** A cluster needs this many events to count as a home. */
export const HOME_MIN_EVENTS = 3;

/** Radius of a storage-derived home zone. */
export const HOME_RADIUS_M = 50;

/** Consecutive evaluations above the current band before a flag is promoted. */
export const RAISE_CONSECUTIVE = 2;

/** A flag holds its level until the smoothed score falls this far below the band's floor. */
export const HOLD_MARGIN = 10;

/** How fast a smoothed score decays under clean play, points per hour. */
export const DECAY_PER_HOUR = 15;

/** Cycles carried on an evaluated row, newest last. */
export const OUTPUT_CYCLES_MAX = 200;

/** Exculpatory multipliers. Missing context leaves the multiplier at exactly 1. */
export const TRIAGE_MULT = 0.5;
export const AT_HOME_MULT = 0.7;
export const STASHING_MULT = 0.7;
export const TRIAGE_MIN_ORPHANS = 5;
export const EXCUSE_MIN = 0.3;

/**
 * Scoring weights. `k` is the saturation half-point: a factor reaches half its
 * max at v == k. `k: null` marks the one linear factor.
 */
export const WEIGHTS = {
    quickCycles:     { k: 4,    max: 30, label: 'Items dropped within seconds of pickup' },
    freshCycles:     { k: 3,    max: 25, label: 'Freshly spawned items discarded' },
    cycleRate:       { k: 6,    max: 15, label: 'Peak cycles in ten minutes' },
    dumpBursts:      { k: 1,    max: 15, label: 'Dumps of many cycled items at once' },
    cycleRatio:      { k: null, max: 10, label: 'Share of pickups discarded' },
    spawnZoneDrops:  { k: 4,    max: 15, label: 'Dropped where they were picked up' },
    distinctClasses: { k: 4,    max: 10, label: 'Different item classes cycled' },
};

/**
 * Normaliser: the score a player would reach if every factor saturated at once.
 * A test asserts this equals the sum of the maxes above — get it wrong and every
 * score is quietly mis-scaled.
 */
export const LOG_MAX = 120;

/** Severity bands. `none` is reserved for a literal zero so "low" always means something. */
export const SEVERITY_BANDS = [
    { min: 75, key: 'critical' },
    { min: 50, key: 'high' },
    { min: 25, key: 'medium' },
    { min: 1,  key: 'low' },
    { min: 0,  key: 'none' },
];

const HOUR_MS = 3_600_000;

const SILENT_DETAIL = 'mod predates item identity; not scored';
const FRESH_SILENT_DETAIL = 'fresh flag unavailable';

const KINDS = new Set(['pickup', 'drop', 'stash', 'deploy', 'destroy', 'death', 'connect', 'disconnect']);

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Saturating curve: 0 at v=0, max/2 at v=k, asymptotic to max. No cliffs, no runaway. */
const sat = (v, k, max) => (v <= 0 ? 0 : (max * v) / (v + k));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function severityFor(score) {
    for (const b of SEVERITY_BANDS) if (score >= b.min) return b.key;
    return 'none';
}

const LEVEL_RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
const rank = (level) => LEVEL_RANK[level] ?? 0;
const bandMin = (level) => {
    const b = SEVERITY_BANDS.find(x => x.key === level);
    return b ? b.min : 0;
};

/** Most items inside any sliding window of `spanMs`, by `field`. */
function maxInWindow(items, spanMs, field) {
    if (!items.length) return { count: 0, from: null, to: null };
    const sorted = [...items].sort((a, b) => a[field] - b[field]);
    let best = { count: 0, from: null, to: null };
    let j = 0;
    for (let i = 0; i < sorted.length; i++) {
        if (j < i) j = i;
        while (j + 1 < sorted.length && sorted[j + 1][field] - sorted[i][field] <= spanMs) j++;
        const count = j - i + 1;
        if (count > best.count) best = { count, from: sorted[i][field], to: sorted[j][field] };
    }
    return best;
}

/**
 * Greedy non-overlapping bursts: walking forward, every run of at least
 * `DUMP_MIN` drops inside `DUMP_SPAN_MS` becomes one burst and the walk resumes
 * after it. Greedy is deliberate — the question is "how many times did they empty
 * their pockets", not "what is the densest possible minute".
 */
function dumpBursts(cycles) {
    const ts = cycles.map(c => c.dropTs).sort((a, b) => a - b);
    const out = [];
    let i = 0;
    while (i < ts.length) {
        let j = i;
        while (j + 1 < ts.length && ts[j + 1] - ts[i] <= DUMP_SPAN_MS) j++;
        const count = j - i + 1;
        if (count >= DUMP_MIN) {
            out.push({ count, spanMs: ts[j] - ts[i], at: ts[i] });
            i = j + 1;
        } else {
            i++;
        }
    }
    return out;
}

function median(values) {
    if (!values.length) return 0;
    const s = [...values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** HH:MM in the given zone (host local when omitted; UTC if the zone is unknown). */
function fmtClock(ts, timeZone) {
    const opts = { hour: '2-digit', minute: '2-digit', hour12: false };
    try {
        return new Date(ts).toLocaleTimeString('en-GB', timeZone ? { ...opts, timeZone } : opts);
    } catch {
        return new Date(ts).toLocaleTimeString('en-GB', { ...opts, timeZone: 'UTC' });
    }
}

/** Remove leading entries whose timestamp (`field` or the value itself) is before `cutoff`. */
function pruneFront(arr, cutoff, field = null) {
    let n = 0;
    while (n < arr.length && (field ? arr[n][field] : arr[n]) < cutoff) n++;
    if (n) arr.splice(0, n);
}

const countSince = (arr, cutoff) => {
    let n = 0;
    for (let i = arr.length - 1; i >= 0 && arr[i] >= cutoff; i--) n++;
    return n;
};

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------------------
// Home zones
// ---------------------------------------------------------------------------

/**
 * Cluster a player's own deploy/stash positions into home zones.
 *
 * Greedy single pass: each event joins the first cluster whose running centroid
 * is within `clusterM`, else starts a new one. Only clusters with `minEvents`
 * survive — one buried bag is a cache, three tents is a base. The runner appends
 * territory zones itself; this helper knows nothing about flags.
 *
 * @param events {x, z, ts}[] — that player's deploy + stash rows
 * @returns {x, z, r, count, source: 'storage'}[] most-used first
 */
export function buildHomeZones(events, {
    clusterM = HOME_CLUSTER_M,
    minEvents = HOME_MIN_EVENTS,
    r = HOME_RADIUS_M,
} = {}) {
    const clusters = [];
    for (const e of events || []) {
        if (!e || !finite(e.x) || !finite(e.z)) continue;
        let hit = null;
        for (const c of clusters) {
            if (Math.hypot(c.x - e.x, c.z - e.z) <= clusterM) { hit = c; break; }
        }
        if (hit) {
            hit.count += 1;
            hit.x += (e.x - hit.x) / hit.count;
            hit.z += (e.z - hit.z) / hit.count;
        } else {
            clusters.push({ x: e.x, z: e.z, count: 1 });
        }
    }
    return clusters
        .filter(c => c.count >= minEvents)
        .sort((a, b) => b.count - a.count)
        .map(c => ({ x: round(c.x, 1), z: round(c.z, 1), r, count: c.count, source: 'storage' }));
}

function inHomeZone(zones, x, z) {
    if (!zones || !zones.length || !finite(x) || !finite(z)) return false;
    return zones.some(zone => finite(zone.x) && finite(zone.z)
        && Math.hypot(zone.x - x, zone.z - z) <= (finite(zone.r) ? zone.r : HOME_RADIUS_M));
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * @returns {{ players: Map<string, object>, lastTs: number|null, lastId: number|null, lossy: number[] }}
 *   `lossy` holds the timestamps of rows carrying a batch-loss marker. It is
 *   state-wide, not per player: `dropped` rides on the first row of a batch that
 *   mixed every online player's events, so a loss is a loss for everyone.
 */
export function createState() {
    return { players: new Map(), lastTs: null, lastId: null, lossy: [] };
}

function newPlayer(pid) {
    return {
        pid,
        /** @type {Map<number, object>} open pickups by item identity */
        open: new Map(),
        /** @type {Map<string, object[]>} open pickups by class, FIFO — includes the ones above */
        openByCls: new Map(),
        openCount: 0,
        cycles: [],        // Cycle records, ascending by dropTs
        pickups: [],       // { ts, cls, iid } counted pickups (grace-period ones excluded)
        orphanDrops: [],   // ts
        homeDrops: [],     // ts
        stashDrops: [],    // ts — stashes that closed a pairing
        totalDrops: [],    // ts — every drop/stash row
        lastConnectTs: null,
        lastDeathTs: null,
        lastRowTs: null,
    };
}

function ensurePlayer(state, pid) {
    let p = state.players.get(pid);
    if (!p) state.players.set(pid, p = newPlayer(pid));
    return p;
}

function removeOpen(p, pk) {
    if (pk.iid != null && p.open.get(pk.iid) === pk) p.open.delete(pk.iid);
    const list = p.openByCls.get(pk.cls);
    if (list) {
        const i = list.indexOf(pk);
        if (i >= 0) {
            list.splice(i, 1);
            p.openCount -= 1;
        }
        if (!list.length) p.openByCls.delete(pk.cls);
    }
}

function evictOldestOpen(p) {
    let oldest = null;
    for (const list of p.openByCls.values()) {
        if (list.length && (!oldest || list[0].ts < oldest.ts)) oldest = list[0];
    }
    if (oldest) removeOpen(p, oldest);
    else { p.open.clear(); p.openCount = 0; }
}

function openPickup(p, pk) {
    if (pk.iid != null) {
        // The same entity picked up again means we missed it leaving the inventory
        // (a drop outside the funnel, a lost batch). The newer pickup is the truth.
        const dup = p.open.get(pk.iid);
        if (dup) removeOpen(p, dup);
        p.open.set(pk.iid, pk);
    }
    let list = p.openByCls.get(pk.cls);
    if (!list) p.openByCls.set(pk.cls, list = []);
    list.push(pk);
    p.openCount += 1;
    while (p.openCount > OPEN_MAX) evictOldestOpen(p);
}

/**
 * Pair a drop with an open pickup: identity first, then class FIFO within
 * PAIR_WINDOW_MS. Returns null for an orphan.
 */
function takeOpen(p, row) {
    if (row.iid != null) {
        const pk = p.open.get(row.iid);
        if (pk) {
            removeOpen(p, pk);
            return { pk, matched: 'iid' };
        }
    }
    const list = p.openByCls.get(row.cls);
    if (list) {
        while (list.length && row.ts - list[0].ts > PAIR_WINDOW_MS) removeOpen(p, list[0]);
        if (list.length) {
            const pk = list[0];
            removeOpen(p, pk);
            return { pk, matched: 'cls' };
        }
    }
    return null;
}

function clearOpen(p) {
    p.open.clear();
    p.openByCls.clear();
    p.openCount = 0;
}

function prunePlayer(p, cutoff) {
    pruneFront(p.cycles, cutoff, 'dropTs');
    pruneFront(p.pickups, cutoff, 'ts');
    pruneFront(p.orphanDrops, cutoff);
    pruneFront(p.homeDrops, cutoff);
    pruneFront(p.stashDrops, cutoff);
    pruneFront(p.totalDrops, cutoff);
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

/**
 * Feed action rows into the state.
 *
 * @param rows ascending by (ts, id). Kinds outside the known set are ignored.
 *   Row shape: { id, ts, pid, kind, cls, x, y, z, detail, iid, fresh, held, dropped }
 *   with `iid`/`fresh`/`held` null on rows from a mod that predates them.
 * @param opts.homeZones Map<pid, {x, z, r, source}[]> — drops inside one are never cycles.
 */
export function ingest(state, rows, { homeZones = null } = {}) {
    for (const row of rows || []) {
        if (!row || !finite(row.ts) || !KINDS.has(row.kind)) continue;

        state.lastTs = state.lastTs == null ? row.ts : Math.max(state.lastTs, row.ts);
        if (row.id != null) state.lastId = row.id;
        if (finite(row.dropped) && row.dropped > 0) state.lossy.push(row.ts);
        pruneFront(state.lossy, row.ts - WINDOW_MS);

        const pid = row.pid;
        if (pid == null || pid === '') continue;
        const p = ensurePlayer(state, pid);
        p.lastRowTs = p.lastRowTs == null ? row.ts : Math.max(p.lastRowTs, row.ts);
        prunePlayer(p, row.ts - WINDOW_MS);

        switch (row.kind) {
            case 'connect':
                // Loading re-fires inventory hooks; nothing in hand before this is trustworthy.
                p.lastConnectTs = row.ts;
                clearOpen(p);
                break;
            case 'disconnect':
                clearOpen(p);
                break;
            case 'death':
                // Everything hits the ground at once without a keypress. Open pickups
                // are void; cycles already banked stay — a dump-then-die still counts.
                p.lastDeathTs = row.ts;
                clearOpen(p);
                break;
            case 'pickup': {
                if (p.lastConnectTs != null && row.ts - p.lastConnectTs <= LOAD_GRACE_MS) break;
                const pk = {
                    ts: row.ts,
                    cls: row.cls == null ? '' : String(row.cls),
                    iid: finite(row.iid) ? row.iid : null,
                    fresh: row.fresh === 1 || row.fresh === 0 ? row.fresh : null,
                    x: finite(row.x) ? row.x : null,
                    z: finite(row.z) ? row.z : null,
                };
                p.pickups.push({ ts: pk.ts, cls: pk.cls, iid: pk.iid });
                openPickup(p, pk);
                break;
            }
            case 'deploy':
            case 'destroy': {
                // The item left the inventory by a route that is not a drop. Close the
                // oldest pickup of its class quietly so a later drop of another one
                // does not inherit its pickup.
                const list = p.openByCls.get(row.cls == null ? '' : String(row.cls));
                if (list && list.length) removeOpen(p, list[0]);
                break;
            }
            case 'drop':
            case 'stash':
                ingestDrop(p, row, homeZones);
                break;
            default:
                break;
        }
    }
}

function ingestDrop(p, row, homeZones) {
    p.totalDrops.push(row.ts);
    const zones = homeZones && typeof homeZones.get === 'function' ? homeZones.get(p.pid) : null;
    const home = inHomeZone(zones, row.x, row.z);
    if (home) p.homeDrops.push(row.ts);

    const norm = { ...row, cls: row.cls == null ? '' : String(row.cls), iid: finite(row.iid) ? row.iid : null };
    const hit = takeOpen(p, norm);
    if (!hit) {
        p.orphanDrops.push(row.ts);
        return;
    }
    const { pk, matched } = hit;
    if (row.kind === 'stash') p.stashDrops.push(row.ts);

    // The mod's own held time is measured on the entity and survives anything we
    // may have missed; the timestamp delta is the fallback for an older build.
    const heldMs = finite(row.held) && row.held >= 0 ? row.held : Math.max(0, row.ts - pk.ts);

    const isCycle = heldMs <= CYCLE_MAX_HELD_MS
        && !home
        && (row.kind !== 'stash' || heldMs <= QUICK_MS);
    if (!isCycle) return;

    const dropX = finite(row.x) ? row.x : null;
    const dropZ = finite(row.z) ? row.z : null;
    const distM = pk.x != null && pk.z != null && dropX != null && dropZ != null
        ? round(Math.hypot(pk.x - dropX, pk.z - dropZ), 1) : null;

    p.cycles.push({
        pid: p.pid,
        cls: norm.cls,
        iid: norm.iid ?? pk.iid,
        pickTs: pk.ts,
        dropTs: row.ts,
        heldMs,
        fresh: pk.fresh,
        pickX: pk.x, pickZ: pk.z,
        dropX, dropZ,
        distM,
        kind: row.kind,
        matched,
    });
}

// ---------------------------------------------------------------------------
// Evaluate
// ---------------------------------------------------------------------------

function mergeWeights(overrides) {
    if (!overrides || typeof overrides !== 'object') return WEIGHTS;
    const out = { ...WEIGHTS };
    for (const key of Object.keys(WEIGHTS)) {
        const o = overrides[key];
        if (o && typeof o === 'object') out[key] = { ...WEIGHTS[key], ...o };
    }
    return out;
}

/**
 * Score every player in the state over the trailing window ending at `now`.
 *
 * @param opts.now       evaluation instant; defaults to the newest ingested row
 * @param opts.capable   { iid, fresh } — whether ANY row server-wide carried that
 *   field recently. `iid === false` silences every factor (`silent: 'legacy-mod'`);
 *   `fresh === false` silences only `freshCycles`. Pairings are still reported.
 * @param opts.weights   per-key overrides merged over WEIGHTS
 * @param opts.timeZone  IANA zone for the clock times inside evidence strings
 */
export function evaluate(state, { now = null, capable = {}, weights: overrides = null, timeZone = null } = {}) {
    const at = finite(now) ? now : (state.lastTs ?? 0);
    const cutoff = at - WINDOW_MS;
    const weights = mergeWeights(overrides);
    // With overrides the normaliser tracks the merged maxes, so 100 still means
    // "every factor saturated"; untouched, this is exactly LOG_MAX.
    const logMax = Object.values(weights).reduce((s, w) => s + w.max, 0) || LOG_MAX;
    const lossy = state.lossy.some(ts => ts >= cutoff);
    const silent = capable && capable.iid === false ? 'legacy-mod' : null;
    const freshSilent = !!silent || (capable && capable.fresh === false);

    const rows = [];
    for (const p of state.players.values()) {
        rows.push(scorePlayer(p, { cutoff, weights, logMax, silent, freshSilent, lossy, timeZone }));
    }
    rows.sort((a, b) => (b.score - a.score)
        || (b.counts.cycles - a.counts.cycles)
        || String(a.pid).localeCompare(String(b.pid)));

    return {
        players: rows,
        summary: {
            players: rows.length,
            flagged: rows.filter(r => r.severity !== 'none').length,
            topScore: rows.length ? rows[0].score : 0,
            lossy,
        },
    };
}

function scorePlayer(p, { cutoff, weights, logMax, silent, freshSilent, lossy, timeZone }) {
    const cycles = p.cycles.filter(c => c.dropTs >= cutoff);
    const pickups = p.pickups.filter(k => k.ts >= cutoff).length;
    const orphanDrops = countSince(p.orphanDrops, cutoff);
    const homeDrops = countSince(p.homeDrops, cutoff);
    const stashDrops = countSince(p.stashDrops, cutoff);
    const totalDrops = countSince(p.totalDrops, cutoff);

    const factors = [];
    const add = (key, value, points, detail, unit) => {
        const w = weights[key];
        let pts = points;
        let text = detail || null;
        if (silent) { pts = 0; text = SILENT_DETAIL; }
        else if (key === 'freshCycles' && freshSilent) { pts = 0; text = FRESH_SILENT_DETAIL; }
        factors.push({
            key, label: w.label, value: round(value, 2), unit: unit || null,
            points: round(clamp(pts, 0, w.max), 2), max: w.max,
            detail: text,
        });
    };

    const quick = cycles.filter(c => c.heldMs <= QUICK_MS);
    add('quickCycles', quick.length, sat(quick.length, weights.quickCycles.k, weights.quickCycles.max),
        quick.length
            ? `${plural(quick.length, 'item')} dropped within ${QUICK_MS / 1000} s of pickup (median ${round(median(quick.map(c => c.heldMs)) / 1000, 1)} s)`
            : null, 'items');

    const fresh = cycles.filter(c => c.fresh === 1);
    add('freshCycles', fresh.length, sat(fresh.length, weights.freshCycles.k, weights.freshCycles.max),
        fresh.length ? `${plural(fresh.length, 'freshly spawned item')} picked up and discarded` : null, 'items');

    const peak = maxInWindow(cycles, RATE_SPAN_MS, 'dropTs');
    add('cycleRate', peak.count, sat(peak.count, weights.cycleRate.k, weights.cycleRate.max),
        peak.count
            ? `peak ${plural(peak.count, 'cycle')} in ${RATE_SPAN_MS / 60_000} min (${fmtClock(peak.from, timeZone)}–${fmtClock(peak.to, timeZone)})`
            : null, 'cycles');

    const bursts = dumpBursts(cycles);
    add('dumpBursts', bursts.length, sat(bursts.length, weights.dumpBursts.k, weights.dumpBursts.max),
        bursts.length
            ? `${plural(bursts.length, 'dump')}: ${bursts.slice(0, 3)
                .map(b => `${b.count} items in ${Math.round(b.spanMs / 1000)} s at ${fmtClock(b.at, timeZone)}`)
                .join(', ')}${bursts.length > 3 ? ', …' : ''}`
            : null, 'dumps');

    const ratio = pickups >= RATIO_MIN_PICKUPS ? clamp(cycles.length / pickups, 0, 1) : 0;
    add('cycleRatio', ratio, weights.cycleRatio.max * ratio,
        pickups >= RATIO_MIN_PICKUPS
            ? `${Math.round(ratio * 100)}% of ${pickups} pickups discarded within ${CYCLE_MAX_HELD_MS / 60_000} min`
            : null, 'ratio');

    const spawnZone = cycles.filter(c => c.distM != null && c.distM <= SPAWN_RADIUS_M);
    add('spawnZoneDrops', spawnZone.length, sat(spawnZone.length, weights.spawnZoneDrops.k, weights.spawnZoneDrops.max),
        spawnZone.length
            ? `${plural(spawnZone.length, 'item')} dropped within ${SPAWN_RADIUS_M} m of where they were picked up`
            : null, 'items');

    const classes = new Set(cycles.map(c => c.cls)).size;
    add('distinctClasses', classes, sat(classes, weights.distinctClasses.k, weights.distinctClasses.max),
        classes ? `${classes} different item class${classes === 1 ? '' : 'es'} cycled` : null, 'classes');

    // -- exculpatory evidence ------------------------------------------------
    // Each reason multiplies; the floor stops three excuses from erasing a score
    // outright, because "it was at home" does not make forty quick cycles vanish.
    const reasons = [];
    const notes = [];
    let m = 1;
    if (orphanDrops >= Math.max(TRIAGE_MIN_ORPHANS, 2 * cycles.length)) {
        m *= TRIAGE_MULT;
        reasons.push('triage');
        notes.push(`${plural(orphanDrops, 'drop')} had no matching pickup (storage, corpse or crafting output)`);
    }
    if (totalDrops > 0 && homeDrops >= 0.5 * totalDrops) {
        m *= AT_HOME_MULT;
        reasons.push('atHome');
        notes.push(`${homeDrops} of ${plural(totalDrops, 'drop')} landed inside their own base`);
    }
    const pairings = totalDrops - orphanDrops;
    if (pairings > 0 && stashDrops >= 0.5 * pairings) {
        m *= STASHING_MULT;
        reasons.push('stashing');
        notes.push(`${stashDrops} of ${plural(pairings, 'paired drop')} went into storage`);
    }
    const multiplier = round(clamp(m, EXCUSE_MIN, 1), 3);

    const base = factors.reduce((s, f) => s + f.points, 0);
    const score = silent ? 0 : Math.round(clamp((100 * base / logMax) * multiplier, 0, 100));

    return {
        pid: p.pid,
        score,
        severity: severityFor(score),
        silent,
        factors: factors.sort((a, b) => b.points - a.points),
        excuse: { multiplier, reasons, notes },
        counts: {
            cycles: cycles.length,
            pickups,
            orphanDrops,
            homeDrops,
            stashDrops,
            totalDrops,
        },
        cycles: cycles.slice(-OUTPUT_CYCLES_MAX),
        lossy,
        lastSeen: p.lastRowTs,
    };
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

/**
 * Evict players idle for IDLE_EVICT_MS and trim what remains to the window.
 * @returns number of players evicted
 */
export function sweep(state, now) {
    let evicted = 0;
    for (const [pid, p] of state.players) {
        if (p.lastRowTs == null || now - p.lastRowTs >= IDLE_EVICT_MS) {
            state.players.delete(pid);
            evicted += 1;
            continue;
        }
        prunePlayer(p, now - WINDOW_MS);
        for (const list of Array.from(p.openByCls.values())) {
            while (list.length && now - list[0].ts > PAIR_WINDOW_MS) removeOpen(p, list[0]);
        }
    }
    pruneFront(state.lossy, now - WINDOW_MS);
    return evicted;
}

// ---------------------------------------------------------------------------
// Flag hysteresis
// ---------------------------------------------------------------------------

/**
 * Advance a persisted flag by one evaluation.
 *
 * Three rules, all pure:
 *  - `smoothed = max(score, prev.smoothed − DECAY_PER_HOUR × hours)`: a flag
 *    forgets slowly, so one clean tick between two dumps does not reset it.
 *  - promotion needs RAISE_CONSECUTIVE evaluations whose OWN score sits above
 *    the current level; the target is the lowest band the whole run agreed on,
 *    so one spike does not jump two rungs of the ladder. The raw score is used
 *    here, not the smoothed one: smoothing decays slowly enough that a single
 *    spike would otherwise promote itself on the next clean tick.
 *  - demotion holds the level until `smoothed` is HOLD_MARGIN below the band's
 *    floor (never below 1, so `none` is reachable), then drops straight to the
 *    band `smoothed` is actually in.
 *
 * @param prev  previous flag or null (= none, smoothed 0, no candidate)
 * @param input { score, ts, factors? } — `factors` are kept as `lastFactors` only
 *   when the level changes, so the stored evidence is the evidence that raised it.
 */
export function nextFlag(prev, { score, ts, factors = null }) {
    const base = prev || {};
    const level0 = LEVEL_RANK[base.level] != null ? base.level : 'none';
    const smoothed0 = finite(base.smoothed) ? base.smoothed : 0;
    const hours = finite(base.lastEvalTs) ? Math.max(0, ts - base.lastEvalTs) / HOUR_MS : 0;
    const s = clamp(finite(score) ? score : 0, 0, 100);
    const smoothed = round(Math.max(s, smoothed0 - DECAY_PER_HOUR * hours), 3);
    const raw = severityFor(s);            // this evaluation on its own
    const held = severityFor(smoothed);    // what the decayed history says

    let level = level0;
    let hits = finite(base.hits) ? base.hits : 0;
    let candidate = LEVEL_RANK[base.candidate] != null ? base.candidate : null;
    let raisedAt = finite(base.raisedAt) ? base.raisedAt : null;

    if (rank(raw) > rank(level0)) {
        const keep = candidate && rank(candidate) > rank(level0) && rank(candidate) < rank(raw);
        candidate = keep ? candidate : raw;
        hits += 1;
        if (hits >= RAISE_CONSECUTIVE) {
            level = candidate;
            raisedAt = ts;
            hits = 0;
            candidate = null;
        }
    } else {
        hits = 0;
        candidate = null;
        if (rank(held) < rank(level0)) {
            const hold = Math.max(bandMin(level0) - HOLD_MARGIN, 1);
            if (smoothed < hold) level = held;
        }
    }

    const changed = level !== level0;
    return {
        level,
        smoothed,
        hits,
        candidate,
        raisedAt: changed && rank(level) > rank(level0) ? ts : raisedAt,
        lastEvalTs: ts,
        peak: Math.max(finite(base.peak) ? base.peak : 0, s),
        lastFactors: changed ? (factors || null) : (base.lastFactors ?? null),
        changed,
    };
}
