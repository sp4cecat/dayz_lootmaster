/**
 * Underground stash report — who is digging up other people's stashes.
 *
 * A player who buries a stash and digs it back up is playing the game. A player
 * who repeatedly unearths stashes belonging to strangers is either extremely
 * lucky or running a stash radar, and this report exists to tell those apart.
 *
 * ## Why the matching is positional
 *
 * ADM logs a bury and a dig-up as unrelated events. The entity ids do not join:
 * a WaterproofBag becomes an UndergroundStash when buried, so the class and the
 * network id both change between the two halves of a stash's life. The one thing
 * that survives is the position, and it survives EXACTLY — measured across a real
 * 122-file archive, all 45 matchable pairs sit at 0.000 m on X and Z. Only the
 * elevation moves, by ~0.2 m, as the stash pops out of the ground.
 *
 * That precision is not a nicety, it is what makes the report possible at all.
 * Buries cluster hard (in the same archive, 45 of 86 have another bury within 1 m,
 * and players routinely re-bury in the very same hole), so a metres-wide tolerance
 * would attribute thefts to the wrong victim more often than not.
 *
 * ## Layering
 *
 * `buildLedger` and `scoreReport` are pure: events in, verdicts out, no clock, no
 * filesystem, no database. That is deliberate — the matching rules are the part
 * that can be quietly wrong, so they are the part that has to be cheap to test.
 * IO lives at the bottom of the file; the history-store cross-check lives in
 * stash-track.js so this module can be imported with no side effects.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseStashLine, parseAdmFilenameDate } from './adm-parse.js';
import { createDayClock, localFields, wallToMs } from './log-clock.js';

// ---------------------------------------------------------------------------
// Tuning constants. Exported so tests can assert against them and so an operator
// reading a surprising number can find the knob that produced it.
// ---------------------------------------------------------------------------

/**
 * How far a dig-up may sit from a bury and still be the same stash, in metres.
 *
 * Observed drift is zero, so this is pure insurance against coordinate re-printing:
 * ADM writes ~6 significant figures, making the quantum 0.1 m at the far edge of a
 * 15 km map. 0.5 m clears that by 5x while staying well under the 0.83 m median
 * spacing between neighbouring buries. It is a RADIUS, not a per-axis box — the
 * old +/-1 per axis reached 1.41 m diagonally, which is squarely into "wrong stash".
 */
export const MATCH_TOLERANCE_M = 0.5;

/** Grid cell size. Must exceed 2x the tolerance so a 3x3 scan provably covers the disc. */
export const GRID_CELL_M = 4;

/**
 * A bury older than this cannot be matched: the stash despawned. 45 days is
 * UndergroundStash's default `lifetime` (3888000 s). Servers with a modded
 * lifetime can override it; `meta.ledger.expiredBuries` makes a wrong value visible.
 */
export const MAX_BURY_AGE_MS = 45 * 86_400_000;

/** Sweep interval for expired buries, in events. Bounds grid growth on long archives. */
const SWEEP_EVERY = 10_000;

/**
 * Scoring weights. Two families:
 *
 *  - THEFT factors need a matched bury, so they are silent on a short archive.
 *  - BEHAVIOUR factors need only the digs themselves. These are what catch a
 *    radar user whose victims' buries predate the logs — which, in the sample
 *    archive, is the single most suspicious player in the entire data set.
 *
 * `k` is the saturation half-point: a factor reaches half its max at v == k.
 */
export const WEIGHTS = {
    foreignDigs:     { k: 2,    max: 30, label: 'Stashes dug up belonging to others' },
    distinctVictims: { k: 1.5,  max: 20, label: 'Distinct players robbed' },
    quickDig:        { k: null, max: 10, label: 'Dug up shortly after burial' },
    foreignRatio:    { k: null, max: 10, label: 'Share of digs that were not their own' },
    digDensity:      { k: 1.5,  max: 25, label: 'Distinct stashes found in one hour' },
    tightCluster:    { k: 1.5,  max: 15, label: 'Stashes found in one tight cluster' },
    geoSpread:       { k: 2000, max: 10, label: 'Spread of dig locations' },
    impliedSpeed:    { k: null, max: 15, label: 'Travel speed between consecutive digs' },
    unownedDigs:     { k: 3,    max: 15, label: 'Digs with no bury of their own nearby' },
};

/**
 * Normaliser: the score a player would reach if every factor saturated at once.
 * A test asserts this equals the sum of the maxes above — get it wrong and every
 * score in the report is quietly mis-scaled.
 */
export const LOG_MAX = 150;

/** Severity bands. `none` is reserved for a literal zero so "low" always means something. */
export const SEVERITY_BANDS = [
    { min: 75, key: 'critical' },
    { min: 50, key: 'high' },
    { min: 25, key: 'medium' },
    { min: 1,  key: 'low' },
    { min: 0,  key: 'none' },
];

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Ledger age over which a dig is fully "covered" — i.e. we would have seen its bury. */
const COVERAGE_WINDOW_MS = 14 * DAY_MS;

/** Radius within which a nearby bury of the digger's own excuses an unmatched dig. */
const OWN_BURY_RADIUS_M = 50;

/** Digs closer together in time than this are treated as one session for clustering. */
const CLUSTER_SESSION_MS = 6 * HOUR_MS;

/** Radius defining a "tight cluster" of finds. */
const CLUSTER_RADIUS_M = 15;

/** Consecutive digs further apart in time than this say nothing about travel speed. */
const SPEED_MAX_GAP_MS = 30 * 60_000;

/**
 * Implied-speed thresholds, m/s. Deliberately specific rather than sensitive:
 * anything a ground vehicle could do scores zero, because "they drove" is a
 * complete and boring explanation. Only genuinely impossible movement counts.
 */
const SPEED_FREE_MS = 30;   // 108 km/h — faster than any vanilla ground vehicle
const SPEED_FULL_MS = 45;   // 162 km/h — no legitimate explanation

// ---------------------------------------------------------------------------
// Pure core: the ledger
// ---------------------------------------------------------------------------

const cellKey = (x, z) => `${Math.floor(x / GRID_CELL_M)}|${Math.floor(z / GRID_CELL_M)}`;

/**
 * Reconstruct every stash's life from a stream of dig events.
 *
 * @param events StashEvent[] ascending by (ts, fileIndex, lineIndex). The tuple
 *   matters: a bury and a dig-up genuinely land on the same second in real logs
 *   (a player unearths a stash and immediately re-buries it), and only file order
 *   says which came first.
 *
 * DELIBERATELY WINDOW-BLIND. The caller's date range must not reach in here. The
 * previous implementation filtered lines by date before matching, which meant a
 * stash buried before the window could never be matched — so narrowing the range
 * silently converted real thefts into zeroes, the exact opposite of what a report
 * that exists to find thefts should do. The window is applied afterwards, to the
 * dig-ups being reported, never to the buries being matched against.
 */
export function buildLedger(events, {
    toleranceM = MATCH_TOLERANCE_M,
    maxBuryAgeMs = MAX_BURY_AGE_MS,
} = {}) {
    /** @type {Map<string, object[]>} open (undug) buries by grid cell */
    const grid = new Map();
    /** @type {Map<string, object[]>} every bury by owner, for the own-bury-nearby test */
    const byOwner = new Map();

    const entries = [];
    const stats = {
        buries: 0, digs: 0, own: 0, foreign: 0, unknown: 0,
        exact: 0, nearby: 0, stackedBuries: 0, expiredBuries: 0,
    };

    let seen = 0;
    for (const ev of events) {
        if (++seen % SWEEP_EVERY === 0) sweepExpired(grid, ev.ts - maxBuryAgeMs);

        if (ev.action === 'in') {
            stats.buries += 1;
            const bury = { ...ev, consumed: false };
            const key = cellKey(ev.x, ev.z);
            let bucket = grid.get(key);
            if (!bucket) grid.set(key, bucket = []);
            // Two stashes cannot share a position. A stack deeper than one means a
            // dig-out line was lost (a rotation gap, an unreadable file) rather than
            // that two things are buried in one hole. LIFO still picks the right one
            // — the most recent bury is what is actually in the ground — but the
            // count is surfaced so a parse bug does not hide inside a plausible number.
            if (bucket.some(b => !b.consumed && Math.hypot(b.x - ev.x, b.z - ev.z) <= toleranceM)) {
                stats.stackedBuries += 1;
            }
            bucket.push(bury);

            let owned = byOwner.get(ev.pid);
            if (!owned) byOwner.set(ev.pid, owned = []);
            owned.push(bury);
            continue;
        }

        stats.digs += 1;
        const match = findBury(grid, ev, toleranceM, maxBuryAgeMs, stats);

        let owner;
        if (!match) owner = 'unknown';
        else if (match.pid === ev.pid) owner = 'own';
        else owner = 'foreign';
        stats[owner] += 1;

        if (match) {
            match.consumed = true;
            // The hole is empty now. Splicing it out is what stops one bury being
            // credited to every later dig at the same spot — the bug that let a
            // player dig up five separate stashes in an 8 m circle and read as
            // entirely innocent.
            const bucket = grid.get(cellKey(match.x, match.z));
            if (bucket) {
                const i = bucket.indexOf(match);
                if (i >= 0) bucket.splice(i, 1);
            }
            const d = Math.hypot(match.x - ev.x, match.z - ev.z);
            if (d === 0) stats.exact += 1; else stats.nearby += 1;
        }

        entries.push({
            i: entries.length,
            ts: ev.ts,
            x: ev.x, z: ev.z, y: ev.y,
            stashClass: ev.cls,
            digger: { id: ev.pid, alias: ev.alias || null },
            owner,
            bury: match ? {
                ts: match.ts, id: match.pid, alias: match.alias || null,
                cls: match.cls, x: match.x, z: match.z,
                file: match.file, line: match.line,
            } : null,
            secondsSinceBury: match ? Math.round((ev.ts - match.ts) / 1000) : null,
            matchDistanceM: match ? round(Math.hypot(match.x - ev.x, match.z - ev.z), 3) : null,
            file: ev.file, line: ev.line,
        });
    }

    // Buries still in the ground at the end of the archive, for the summary.
    let openAtEnd = 0;
    for (const bucket of grid.values()) openAtEnd += bucket.length;

    return { entries, stats: { ...stats, openAtEnd }, byOwner };
}

/**
 * Nearest open bury within tolerance, or null.
 *
 * Nearest rather than first-found-scanning-backwards: with buries clustered at
 * sub-metre spacing, "the most recent one that happens to be in range" and "the
 * one actually at this position" are frequently different stashes owned by
 * different people. Ties break on the newest bury (LIFO), which is what correctly
 * reconstructs a re-bury chain in the same hole.
 */
function findBury(grid, ev, toleranceM, maxBuryAgeMs, stats) {
    const cx = Math.floor(ev.x / GRID_CELL_M);
    const cz = Math.floor(ev.z / GRID_CELL_M);
    let best = null;
    let bestD = Infinity;
    let sawExpired = false;

    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const bucket = grid.get(`${cx + dx}|${cz + dz}`);
            if (!bucket) continue;
            for (const b of bucket) {
                if (b.consumed || b.ts > ev.ts) continue;
                const d = Math.hypot(b.x - ev.x, b.z - ev.z);
                if (d > toleranceM) continue;
                if (ev.ts - b.ts > maxBuryAgeMs) { sawExpired = true; continue; }
                if (d < bestD || (d === bestD && best && b.ts > best.ts)) {
                    best = b;
                    bestD = d;
                }
            }
        }
    }
    // Only counted when it changed the outcome: a stash that despawned before this
    // dig cannot be the one dug up, so the dig is genuinely unattributable.
    if (!best && sawExpired && stats) stats.expiredBuries += 1;
    return best;
}

function sweepExpired(grid, cutoffTs) {
    for (const [key, bucket] of grid) {
        const live = bucket.filter(b => b.ts >= cutoffTs);
        if (live.length === 0) grid.delete(key);
        else if (live.length !== bucket.length) grid.set(key, live);
    }
}

// ---------------------------------------------------------------------------
// Pure core: scoring
// ---------------------------------------------------------------------------

/** Saturating curve: 0 at v=0, max/2 at v=k, asymptotic to max. No cliffs, no runaway. */
const sat = (v, k, max) => (v <= 0 ? 0 : (max * v) / (v + k));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;

export function severityFor(score) {
    for (const b of SEVERITY_BANDS) if (score >= b.min) return b.key;
    return 'none';
}

/**
 * Rank players by how much their digging looks like a stash radar.
 *
 * @param entries  ledger entries already filtered to the reporting window
 * @param opts.ledgerFrom  earliest instant the archive covers, for confidence
 * @param opts.aliases     Map<pid, Set<string>>
 * @param opts.byOwner     Map<pid, bury[]> from buildLedger. Spans the WHOLE archive,
 *   not the window, so "did they bury anything around here" stays answerable when
 *   the window is narrow.
 * @param opts.tracks      Map<pid, trackSummary> from stash-track, optional
 */
export function scoreReport(entries, {
    ledgerFrom = null,
    window = null,
    aliases = new Map(),
    byOwner = new Map(),
    tracks = new Map(),
    weights = WEIGHTS,
} = {}) {
    /** @type {Map<string, object>} */
    const players = new Map();
    const ensure = (pid) => {
        let p = players.get(pid);
        if (!p) {
            players.set(pid, p = {
                id: pid,
                aliases: Array.from(aliases.get(pid) || []),
                digs: [], victims: new Set(),
                counts: { buried: 0, buriedAllTime: 0, dugOwn: 0, dugForeign: 0, dugUnknown: 0, dugTotal: 0 },
            });
        }
        return p;
    };

    // Everyone who buried something is a row, even with zero digs — an operator
    // scanning for a name should find it rather than conclude it is not in the logs.
    for (const [pid, buries] of byOwner) ensure(pid).counts.buriedAllTime = buries.length;

    for (const e of entries) {
        const p = ensure(e.digger.id);
        p.digs.push(e);
        p.counts.dugTotal += 1;
        if (e.owner === 'own') p.counts.dugOwn += 1;
        else if (e.owner === 'foreign') {
            p.counts.dugForeign += 1;
            if (e.bury) p.victims.add(e.bury.id);
        } else p.counts.dugUnknown += 1;
    }
    // Buries inside the reported window, shown next to the dig counts. Uses the
    // caller's window rather than the span of the digs — those are different
    // questions, and with no digs in range the dig-span answer is "everything".
    const lo = window && window.from != null ? window.from : -Infinity;
    const hi = window && window.to != null ? window.to : Infinity;
    for (const [pid, buries] of byOwner) {
        const p = players.get(pid);
        if (!p) continue;
        p.counts.buried = buries.filter(b => b.ts >= lo && b.ts <= hi).length;
    }

    const rows = [];
    for (const p of players.values()) {
        const suspect = p.digs.filter(d => d.owner !== 'own');
        const factors = [];
        const add = (key, value, points, detail, unit) => {
            const w = weights[key];
            factors.push({
                key, label: w.label, value: round(value, 2), unit: unit || null,
                points: round(clamp(points, 0, w.max), 2), max: w.max,
                detail: detail || null,
            });
        };

        const coverage = coverageFor(p.digs, ledgerFrom);

        // -- theft factors -----------------------------------------------------
        const foreign = p.digs.filter(d => d.owner === 'foreign');
        add('foreignDigs', foreign.length, sat(foreign.length, weights.foreignDigs.k, weights.foreignDigs.max),
            foreign.length ? `${foreign.length} confirmed dig-up${foreign.length === 1 ? '' : 's'} of another player's stash` : null);

        add('distinctVictims', p.victims.size, sat(p.victims.size, weights.distinctVictims.k, weights.distinctVictims.max),
            p.victims.size ? `${p.victims.size} different player${p.victims.size === 1 ? '' : 's'} robbed` : null);

        const quickest = foreign.length
            ? Math.min(...foreign.map(d => d.secondsSinceBury ?? Infinity)) : null;
        if (quickest != null && Number.isFinite(quickest)) {
            // Linear 10 at <=15 min, 0 at >=6 h. Fast is suspicious because a stash
            // buried minutes ago was found without any chance to stumble on it.
            const pts = weights.quickDig.max * clamp((21600 - quickest) / (21600 - 900), 0, 1);
            add('quickDig', quickest, pts, `dug up ${fmtDuration(quickest * 1000)} after it was buried`, 's');
        } else {
            add('quickDig', 0, 0, null, 's');
        }

        const classified = p.counts.dugForeign + p.counts.dugOwn;
        // Below 3 classified digs the ratio is noise: one foreign dig out of one is 100%.
        const ratio = classified >= 3 ? p.counts.dugForeign / classified : 0;
        add('foreignRatio', classified >= 3 ? ratio : 0, weights.foreignRatio.max * ratio,
            classified >= 3 ? `${Math.round(ratio * 100)}% of ${classified} attributable digs were not their own` : null);

        // -- behaviour factors -------------------------------------------------
        const density = maxInWindow(suspect, HOUR_MS);
        add('digDensity', density.count, sat(density.count - 1, weights.digDensity.k, weights.digDensity.max),
            density.count > 1 ? `${density.count} distinct stashes within one hour` : null, 'stashes');

        const cluster = tightestCluster(suspect);
        add('tightCluster', cluster.count, sat(cluster.count - 1, weights.tightCluster.k, weights.tightCluster.max),
            cluster.count > 1 ? `${cluster.count} stashes found within ${Math.round(cluster.radius)} m of each other` : null, 'stashes');

        const spread = maxSeparation(suspect);
        add('geoSpread', spread, sat(spread, weights.geoSpread.k, weights.geoSpread.max),
            spread > 0 ? `digs span ${fmtDistance(spread)}` : null, 'm');

        const speed = maxImpliedSpeed(suspect);
        const speedPts = weights.impliedSpeed.max
            * clamp((speed - SPEED_FREE_MS) / (SPEED_FULL_MS - SPEED_FREE_MS), 0, 1);
        add('impliedSpeed', speed, speedPts,
            speed > SPEED_FREE_MS
                ? `${Math.round(speed)} m/s (${Math.round(speed * 3.6)} km/h) between consecutive digs`
                : (speed > 0 ? `peak ${round(speed, 1)} m/s — within normal travel` : null), 'm/s');

        const unowned = suspect.filter(d => !hasOwnBuryNear(byOwner.get(p.id), d));
        // Scaled by coverage: on a young archive we genuinely cannot assert that a
        // dug-up stash was not theirs, and asserting it anyway would manufacture
        // suspicion out of a short log retention.
        add('unownedDigs', unowned.length,
            sat(unowned.length, weights.unownedDigs.k, weights.unownedDigs.max) * coverage.value,
            unowned.length
                ? `${unowned.length} dig${unowned.length === 1 ? '' : 's'} with no bury of their own within ${OWN_BURY_RADIUS_M} m`
                  + (coverage.value < 0.99 ? ` (x${round(coverage.value, 2)} ledger coverage)` : '')
                : null);

        const base = factors.reduce((s, f) => s + f.points, 0);
        const track = tracks.get(p.id) || { available: false, reason: 'no-samples', analysed: 0, multiplier: 1 };
        const score = Math.round(clamp((100 * base / LOG_MAX) * (track.multiplier ?? 1), 0, 100));

        rows.push({
            id: p.id,
            aliases: p.aliases,
            score,
            severity: severityFor(score),
            confidence: round(coverage.value, 2),
            confidenceNote: coverage.note,
            counts: p.counts,
            victims: Array.from(p.victims).map(id => ({ id, alias: firstAlias(aliases, id) })),
            factors: factors.sort((a, b) => b.points - a.points),
            track,
            events: p.digs.map(d => d.i),
        });
    }

    rows.sort(defaultSort);

    const summary = {
        players: rows.length,
        flagged: rows.filter(r => r.severity !== 'none').length,
        topScore: rows.length ? rows[0].score : 0,
        victims: new Set(entries.filter(e => e.owner === 'foreign' && e.bury).map(e => e.bury.id)).size,
    };
    return { players: rows, summary };
}

/** score desc, then the raw evidence, then id for a stable order across runs. */
function defaultSort(a, b) {
    return (b.score - a.score)
        || (b.counts.dugForeign - a.counts.dugForeign)
        || (b.counts.dugUnknown - a.counts.dugUnknown)
        || a.id.localeCompare(b.id);
}

export const SORTS = {
    score: defaultSort,
    foreign: (a, b) => (b.counts.dugForeign - a.counts.dugForeign) || defaultSort(a, b),
    unknown: (a, b) => (b.counts.dugUnknown - a.counts.dugUnknown) || defaultSort(a, b),
    buried: (a, b) => (b.counts.buried - a.counts.buried) || defaultSort(a, b),
    digs: (a, b) => (b.counts.dugTotal - a.counts.dugTotal) || defaultSort(a, b),
};

/**
 * How much of this player's dig history the bury ledger could plausibly explain.
 *
 * Reported next to the score, never folded into it — with a one-day-old archive a
 * player can look damning on behaviour alone and still be entirely innocent, and
 * the honest thing is to say so rather than to quietly deflate the number.
 */
function coverageFor(digs, ledgerFrom) {
    if (!digs.length || ledgerFrom == null) return { value: 1, note: null };
    const per = digs.map(d => clamp((d.ts - ledgerFrom) / COVERAGE_WINDOW_MS, 0, 1));
    const value = per.reduce((s, v) => s + v, 0) / per.length;
    if (value >= 0.99) return { value: 1, note: null };
    const thin = per.filter(v => v < 1).length;
    return {
        value,
        note: `${thin} of ${per.length} digs predate the bury ledger by less than ${COVERAGE_WINDOW_MS / DAY_MS} days`,
    };
}

/** Did this player bury anything near here? Their own camp explains a lot of digging. */
function hasOwnBuryNear(buries, dig) {
    if (!buries) return false;
    return buries.some(b => Math.hypot(b.x - dig.x, b.z - dig.z) <= OWN_BURY_RADIUS_M);
}

/** Most distinct dig positions inside any sliding window of `spanMs`. */
function maxInWindow(digs, spanMs) {
    if (!digs.length) return { count: 0, from: null, to: null };
    const sorted = [...digs].sort((a, b) => a.ts - b.ts);
    let best = { count: 0, from: null, to: null };
    for (let i = 0; i < sorted.length; i++) {
        const seen = [];
        let j = i;
        for (; j < sorted.length && sorted[j].ts - sorted[i].ts <= spanMs; j++) {
            if (!seen.some(p => Math.hypot(p.x - sorted[j].x, p.z - sorted[j].z) <= MATCH_TOLERANCE_M)) {
                seen.push(sorted[j]);
            }
        }
        if (seen.length > best.count) best = { count: seen.length, from: sorted[i].ts, to: sorted[j - 1].ts };
    }
    return best;
}

/**
 * Largest set of distinct stashes found close together in space and in one session.
 *
 * Finding several separate buried containers inside a 15 m circle is the tell that
 * survives having no idea who owned them: a shovel does not do that.
 */
function tightestCluster(digs) {
    if (!digs.length) return { count: 0, radius: 0 };
    let best = { count: 0, radius: 0 };
    for (const anchor of digs) {
        const near = digs.filter(d =>
            Math.abs(d.ts - anchor.ts) <= CLUSTER_SESSION_MS
            && Math.hypot(d.x - anchor.x, d.z - anchor.z) <= CLUSTER_RADIUS_M);
        const distinct = [];
        for (const d of near) {
            if (!distinct.some(p => Math.hypot(p.x - d.x, p.z - d.z) <= MATCH_TOLERANCE_M)) distinct.push(d);
        }
        if (distinct.length > best.count) {
            best = { count: distinct.length, radius: maxSeparation(distinct) };
        }
    }
    return best;
}

/** Greatest pairwise distance in a set of digs, metres. */
function maxSeparation(digs) {
    let max = 0;
    for (let i = 0; i < digs.length; i++) {
        for (let j = i + 1; j < digs.length; j++) {
            const d = Math.hypot(digs[i].x - digs[j].x, digs[i].z - digs[j].z);
            if (d > max) max = d;
        }
    }
    return max;
}

/** Fastest implied travel between consecutive digs that are close enough in time to mean anything. */
function maxImpliedSpeed(digs) {
    const sorted = [...digs].sort((a, b) => a.ts - b.ts);
    let max = 0;
    for (let i = 1; i < sorted.length; i++) {
        const dt = sorted[i].ts - sorted[i - 1].ts;
        if (dt <= 0 || dt > SPEED_MAX_GAP_MS) continue;
        const d = Math.hypot(sorted[i].x - sorted[i - 1].x, sorted[i].z - sorted[i - 1].z);
        const v = d / (dt / 1000);
        if (v > max) max = v;
    }
    return max;
}

function firstAlias(aliases, pid) {
    const set = aliases.get(pid);
    if (!set) return null;
    for (const a of set) return a;
    return null;
}

function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 90) return `${s}s`;
    if (s < 5400) return `${Math.round(s / 60)}m`;
    if (s < 172800) return `${round(s / 3600, 1)}h`;
    return `${round(s / 86400, 1)}d`;
}

function fmtDistance(m) {
    return m >= 1000 ? `${round(m / 1000, 1)} km` : `${Math.round(m)} m`;
}

// ---------------------------------------------------------------------------
// IO: reading dig events out of the ADM archive
// ---------------------------------------------------------------------------

/**
 * Parsed events per file, keyed by path.
 *
 * Log files are append-only and all but the newest are frozen, so re-parsing the
 * whole archive on every request is pure waste. Not persisted: a cold rebuild is
 * tens of milliseconds and the parse is deterministic, so a file format would buy
 * nothing and add a way to be wrong.
 */
const fileCache = new Map();
const FILE_CACHE_MAX = 5000;

function isDigitsName(name) {
    return /^\d+$/.test(name);
}

/** Every `.ADM` under the log root, recursing only DayZ's unix-timestamped folders. */
async function listAdmFiles(root) {
    const out = [];
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const ent of entries) {
        if (ent.isDirectory() && isDigitsName(ent.name)) {
            out.push(...await listAdmFiles(join(root, ent.name)));
        } else if (ent.isFile() && /\.ADM$/i.test(ent.name)) {
            out.push(join(root, ent.name));
        }
    }
    return out;
}

/** The file's own local date, from its name. Files we cannot date are skipped. */
function admFileDate(filePath, timeZone) {
    const fields = parseAdmFilenameDate(filePath);
    if (fields) {
        const ms = wallToMs(fields, timeZone);
        return Number.isFinite(ms) ? new Date(ms) : null;
    }
    const name = String(filePath).split(/[\\/]/).pop() || '';
    const m = name.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/);
    if (!m) return null;
    const ms = wallToMs({ y: +m[1], mon: +m[2] - 1, d: +m[3], h: 0, mi: 0, s: 0 }, timeZone);
    return Number.isFinite(ms) ? new Date(ms) : null;
}

async function parseFileEvents(path, startDate, timeZone) {
    const text = await readFile(path, 'utf8');
    const rows = text.split(/\r?\n/);
    // Lines carry a time of day and nothing else, so they are read against the
    // file's own date; the clock handles midnight rollover and the DST replay hour.
    const clock = createDayClock(localFields(startDate.getTime(), timeZone), timeZone);
    const events = [];
    let timestamped = 0;

    for (let line = 0; line < rows.length; line++) {
        const row = rows[line];
        if (!/^\s*\d{1,2}:\d{2}:\d{2}\s*\|/.test(row)) continue;
        timestamped += 1;
        const s = parseStashLine(row);
        if (!s) continue;
        if (!Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
        events.push({
            ts: clock.at(s.secOfDay),
            action: s.action,
            pid: s.guid,
            alias: s.name,
            cls: s.cls,
            entityId: s.entityId,
            x: s.x, y: s.y, z: s.z,
            px: s.px, pz: s.pz,
            file: path,
            line: line + 1,
        });
    }
    return { events, lines: rows.length, timestamped };
}

/**
 * Read every dig event in the archive, in absolute time order.
 *
 * No date filtering happens here — see the note on buildLedger. The whole archive
 * is always read because a bury from six weeks ago is exactly what makes a dig-up
 * today attributable.
 */
export async function collectStashEvents(paths) {
    const t0 = Date.now();
    const root = paths.logsDirPath;
    const found = await listAdmFiles(root);

    const dated = [];
    for (const f of found) {
        const startDate = admFileDate(f, paths.logTimeZone);
        if (startDate) dated.push({ path: f, startDate });
    }
    dated.sort((a, b) => (a.startDate - b.startDate) || String(a.path).localeCompare(String(b.path)));

    const meta = {
        files: { found: found.length, dated: dated.length, read: 0, cached: 0, failed: 0 },
        lines: { scanned: 0, timestamped: 0, stash: 0, in: 0, out: 0 },
    };

    const events = [];
    // Bounded concurrency: free on a cold FS cache, harmless warm.
    const CONCURRENCY = 8;
    const perFile = new Array(dated.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, dated.length) }, async () => {
        for (let i = next++; i < dated.length; i = next++) {
            const { path, startDate } = dated[i];
            try {
                const st = await stat(path);
                const hit = fileCache.get(path);
                if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size && hit.zone === paths.logTimeZone) {
                    perFile[i] = hit;
                    meta.files.cached += 1;
                    continue;
                }
                const parsed = await parseFileEvents(path, startDate, paths.logTimeZone);
                const rec = { ...parsed, mtimeMs: st.mtimeMs, size: st.size, zone: paths.logTimeZone };
                fileCache.set(path, rec);
                perFile[i] = rec;
                meta.files.read += 1;
            } catch {
                meta.files.failed += 1;
            }
        }
    }));

    // Rotation deletes old files; drop their cache entries so the map does not grow forever.
    if (fileCache.size > FILE_CACHE_MAX) {
        const live = new Set(dated.map(d => d.path));
        for (const key of fileCache.keys()) if (!live.has(key)) fileCache.delete(key);
    }

    for (let i = 0; i < perFile.length; i++) {
        const rec = perFile[i];
        if (!rec) continue;
        meta.lines.scanned += rec.lines;
        meta.lines.timestamped += rec.timestamped;
        for (let j = 0; j < rec.events.length; j++) {
            // fileIndex/lineIndex break timestamp ties in log order — a stash dug up
            // and re-buried in the same second must not resolve backwards.
            events.push({ ...rec.events[j], fileIndex: i, lineIndex: j });
        }
    }

    events.sort((a, b) => (a.ts - b.ts) || (a.fileIndex - b.fileIndex) || (a.lineIndex - b.lineIndex));

    meta.lines.stash = events.length;
    meta.lines.in = events.filter(e => e.action === 'in').length;
    meta.lines.out = events.length - meta.lines.in;
    meta.readMs = Date.now() - t0;

    return { events, meta };
}

/** Drop every cached file parse. Exported for tests and for a forced refresh. */
export function clearFileCache() {
    fileCache.clear();
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/**
 * Build the full report.
 *
 * @param annotate optional (entries, ctx) => trackMeta — injected rather than
 *   imported so this module stays free of database dependencies and so the
 *   history cross-check can be omitted entirely in tests.
 */
export async function generateStashReport({ paths, start = null, end = null, options = {}, annotate = null }) {
    const t0 = Date.now();
    const { events, meta } = await collectStashEvents(paths);

    const maxBuryAgeMs = Number.isFinite(options.maxBuryAgeDays)
        ? clamp(options.maxBuryAgeDays, 1, 365) * DAY_MS
        : MAX_BURY_AGE_MS;

    const tMatch = Date.now();
    const { entries, stats, byOwner } = buildLedger(events, { maxBuryAgeMs });
    const matchMs = Date.now() - tMatch;

    const ledgerFrom = events.length ? events[0].ts : null;
    const ledgerTo = events.length ? events[events.length - 1].ts : null;

    // The window applies HERE and nowhere earlier.
    const inWindow = entries.filter(e =>
        (start == null || e.ts >= start) && (end == null || e.ts <= end));

    const aliases = new Map();
    for (const ev of events) {
        if (!ev.alias) continue;
        let set = aliases.get(ev.pid);
        if (!set) aliases.set(ev.pid, set = new Set());
        set.add(ev.alias);
    }

    let track = { available: false, reason: 'disabled', analysed: 0 };
    let tracks = new Map();
    const tTrack = Date.now();
    if (annotate) {
        try {
            const res = await annotate(inWindow, { ledgerFrom, options });
            track = res.meta;
            tracks = res.tracks || new Map();
        } catch (e) {
            track = { available: false, reason: 'error', error: String(e && e.message || e), analysed: 0 };
        }
    }
    const trackMs = Date.now() - tTrack;

    const { players, summary } = scoreReport(inWindow, {
        ledgerFrom, window: { from: start, to: end }, aliases, byOwner, tracks,
    });

    const sorted = SORTS[options.sort] ? [...players].sort(SORTS[options.sort]) : players;
    const filtered = Number.isFinite(options.minScore)
        ? sorted.filter(p => p.score >= options.minScore) : sorted;

    const windowed = {
        own: inWindow.filter(e => e.owner === 'own').length,
        foreign: inWindow.filter(e => e.owner === 'foreign').length,
        unknown: inWindow.filter(e => e.owner === 'unknown').length,
    };

    return {
        ok: true,
        version: 2,
        window: {
            from: start, to: end,
            timeZone: paths.logTimeZone || null,
        },
        summary: {
            buries: stats.buries,
            digs: inWindow.length,
            ...windowed,
            players: summary.players,
            flagged: summary.flagged,
            victims: summary.victims,
            topScore: summary.topScore,
        },
        players: filtered,
        ledger: options.includeLedger === false ? [] : inWindow,
        meta: {
            files: meta.files,
            lines: meta.lines,
            ledger: {
                from: ledgerFrom, to: ledgerTo,
                spanDays: ledgerFrom != null ? round((ledgerTo - ledgerFrom) / DAY_MS, 1) : 0,
                own: stats.own, foreign: stats.foreign, unknown: stats.unknown,
                openAtEnd: stats.openAtEnd,
                stackedBuries: stats.stackedBuries,
                expiredBuries: stats.expiredBuries,
                maxBuryAgeDays: round(maxBuryAgeMs / DAY_MS, 1),
            },
            coverage: {
                digsInWindow: inWindow.length,
                digsOutsideWindow: entries.length - inWindow.length,
                windowStartsBeforeLedger: start != null && ledgerFrom != null && start < ledgerFrom,
                windowEndsAfterLedger: end != null && ledgerTo != null && end > ledgerTo,
            },
            match: {
                toleranceM: MATCH_TOLERANCE_M, cellM: GRID_CELL_M,
                exact: stats.exact, nearby: stats.nearby, unmatched: stats.unknown,
            },
            track,
            timings: { readMs: meta.readMs, matchMs, trackMs, totalMs: Date.now() - t0 },
            weights: { logMax: LOG_MAX },
        },
    };
}
