/**
 * Approach analysis — did the digger find that stash, or did they already know?
 *
 * Counting thefts tells you who dug up other people's stashes. It does not tell
 * you how. A player who raids a base they have been fighting over for a week and
 * a player who walks 600 m across empty forest straight to a buried bag both show
 * up as "dug up a stranger's stash", and only one of them is a problem.
 *
 * The difference is visible in the movement track. Searching for a stash looks
 * like searching: back and forth, changes of direction, time spent nearby. A
 * radar hit looks like a commute — one straight line, ending exactly on the spot,
 * with no prior visit to the area in the player's whole history.
 *
 * ## What this deliberately will not do
 *
 * The multiplier this produces is clamped to [0.75, 1.35] and is EXACTLY 1.0 when
 * nothing resolved. Track coverage is patchy by nature: on a server without the
 * companion mod, history is backfilled from the admin log's ~5-minute roster and
 * only about a quarter of digs have enough samples to say anything. A player must
 * never score higher because the log happened to be watching them.
 *
 * For the same reason absence is never evidence on its own. "Never been near this
 * spot" only counts when the player was demonstrably being sampled at the time;
 * otherwise it is a statement about the log, not about the player.
 */

import * as history from './history-store.js';
import { readGuidLedger, UNRESOLVED_PREFIX } from './adm-import.js';
import { simplifyPath } from './simplify-path.js';

/** How far back to look for the approach to a dig. A sprint covers ~7 km in this. */
export const APPROACH_LOOKBACK_MS = 20 * 60_000;

/** RDP tolerance for counting direction changes. Coarser than a map track — we want turns, not shape. */
const APPROACH_RDP_M = 15;

/** Radius counted as "has been here before". */
export const PRIOR_RADIUS_M = 100;

/** How far back to look for a prior visit. Bounds the cell scan. */
const PRIOR_LOOKBACK_MS = 30 * 86_400_000;

/** A player with no samples at all in this window before the bury cannot be said to have avoided it. */
const PRIOR_MEANINGFUL_MS = 7 * 86_400_000;

/** Beeline thresholds — all four must hold. */
const BEELINE_STRAIGHTNESS = 0.87;
const BEELINE_MIN_APPROACH_M = 300;
const BEELINE_MAX_FINAL_M = 30;
const BEELINE_MAX_TURNS = 1;

/** Minimum samples before a track says anything about shape. */
const MIN_SAMPLES = 3;

/** Per-report lookup budget. Each analysis is a handful of indexed reads. */
export const MAX_LOOKUPS = 200;

/** Multiplier bounds. Asymmetric on purpose: exoneration is cheaper than accusation. */
const MULT_MIN = 0.75;
const MULT_MAX = 1.35;

/**
 * Is there a history database worth querying at all?
 *
 * Gates on `ready` rather than `enabled`. Those mean different things: `enabled`
 * says whether the store should PERSIST what the mod pushes, and this report only
 * ever reads. A store that is open and holds rows is queryable whatever the
 * recorder is doing, and `stats()` refuses to open one that should stay shut — so
 * a server with recording turned off still reports honestly rather than pretending
 * every player came back clean.
 */
export function trackAvailability() {
    let st;
    try {
        st = history.stats();
    } catch (e) {
        return { available: false, reason: 'error', error: String(e && e.message || e) };
    }
    if (!st.ready) return { available: false, reason: st.enabled ? 'not-ready' : 'disabled', rows: 0 };
    if (!st.rows) return { available: false, reason: 'empty', rows: 0 };
    return {
        available: true, reason: null,
        rows: st.rows, bySrc: st.bySrc || null, from: st.from, to: st.to,
    };
}

/**
 * Measure one dig's approach.
 *
 * Returns `{ available: false, reason }` for every miss and never throws — a
 * missing track is the normal case, not an error condition.
 */
export function analyseApproach(entry, historyPid, {
    lookbackMs = APPROACH_LOOKBACK_MS,
    priorRadiusM = PRIOR_RADIUS_M,
} = {}) {
    const out = { available: false, reason: 'no-samples', samples: 0 };

    let tracks;
    try {
        tracks = history.queryTrack({
            pids: [historyPid], from: entry.ts - lookbackMs, to: entry.ts, maxRows: 2000,
        });
    } catch (e) {
        return { available: false, reason: 'error', error: String(e && e.message || e) };
    }

    const t = tracks && tracks[0];
    if (t && t.points && t.points.length >= 2) {
        // An "approach" that spans a logout is not an approach — the player was
        // somewhere else entirely and reconnected. Split on the store's own gap
        // flag and keep only the run that actually ends at the dig, the same thing
        // /api/history/track does before drawing a line between two points.
        const runs = [];
        for (const p of t.points) {
            if (p.gap || !runs.length) runs.push([]);
            runs[runs.length - 1].push(p);
        }
        const run = runs[runs.length - 1];

        if (run.length < MIN_SAMPLES) {
            out.reason = 'too-few-samples';
            out.samples = run.length;
        } else {
            const first = run[0];
            const last = run[run.length - 1];
            let pathM = 0;
            for (let i = 1; i < run.length; i++) {
                pathM += Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z);
            }
            const displacementM = Math.hypot(last.x - first.x, last.z - first.z);
            const straightness = displacementM / Math.max(pathM, 1);
            const turns = Math.max(0, simplifyPath(run, APPROACH_RDP_M).length - 2);

            // Sample cadence changes what these numbers mean. A 5-minute roster
            // dump cannot see the wandering between two points, so it OVER-reports
            // straightness — a search pattern sampled six times looks like a
            // straight line. Reported so the multiplier can discount it rather
            // than confidently drawing the wrong conclusion.
            const resolution = run.every(p => p.src === 'adm') ? 'coarse'
                : run.every(p => p.src === 'mod') ? 'fine' : 'mixed';

            Object.assign(out, {
                available: true, reason: null, resolution,
                samples: run.length, stride: t.stride ?? 1,
                spanMs: last.ts - first.ts,
                pathM: round(pathM), displacementM: round(displacementM),
                straightness: round(straightness, 3), turns,
                approachM: round(Math.hypot(first.x - entry.x, first.z - entry.z)),
                finalM: round(Math.hypot(last.x - entry.x, last.z - entry.z)),
            });
            out.beeline = out.straightness >= BEELINE_STRAIGHTNESS
                && out.approachM >= BEELINE_MIN_APPROACH_M
                && out.finalM <= BEELINE_MAX_FINAL_M
                && out.turns <= BEELINE_MAX_TURNS;
        }
    }

    // Prior presence is a separate question and survives a track too sparse to
    // have a shape, so it is asked regardless of what happened above. It is also
    // the strongest single signal: someone who has camped this hillside for a week
    // finding a stash on it is a neighbour, not a cheat.
    const cutoff = entry.bury ? entry.bury.ts : entry.ts;
    try {
        const visits = history.queryArea({
            x: entry.x, z: entry.z, radius: priorRadiusM,
            from: cutoff - PRIOR_LOOKBACK_MS, to: cutoff,
        }).filter(v => v.pid === historyPid);

        out.priorVisits = visits.length;
        out.everBeforeBury = visits.length > 0;
        if (visits.length) {
            out.priorClosestM = Math.min(...visits.map(v => v.closestM));
            out.lastPriorAt = Math.max(...visits.map(v => v.leftAt));
        }

        // Was the player being watched at all? Without this, a server that only
        // imported last week's logs would mark every long-time resident a stranger.
        const seen = history.queryTrack({
            pids: [historyPid], from: cutoff - PRIOR_MEANINGFUL_MS, to: cutoff, maxRows: 2,
        });
        out.priorMeaningful = !!(seen && seen[0] && seen[0].points.length);
    } catch {
        out.priorVisits = null;
        out.everBeforeBury = null;
        out.priorMeaningful = false;
    }

    if (!out.available && out.priorMeaningful) out.available = true;
    return out;
}

/**
 * Annotate the ledger in place and roll each player's approaches into a multiplier.
 *
 * @returns { meta, tracks: Map<pid, playerTrackSummary> }
 */
export async function annotateApproaches(entries, {
    serverPath,
    lookbackMs = APPROACH_LOOKBACK_MS,
    maxLookups = MAX_LOOKUPS,
} = {}) {
    const avail = trackAvailability();
    const meta = { ...avail, lookups: 0, hits: 0, misses: 0, budgetHit: false, analysed: 0 };

    if (!avail.available || maxLookups <= 0) {
        return { meta, tracks: new Map() };
    }

    let ledger = { ok: false, size: 0, path: null, map: new Map() };
    try {
        ledger = await readGuidLedger(serverPath);
    } catch { /* a missing ledger is normal; the guid: fallback covers it */ }
    meta.guidLedger = { ok: ledger.ok, size: ledger.size, path: ledger.path };

    // Spend the budget where it matters: confirmed thefts first, then unattributed
    // digs, newest first within each. A truncated analysis should still have looked
    // at the most suspicious events.
    const order = entries
        .map((e, idx) => ({ e, idx }))
        .filter(({ e }) => e.owner !== 'own')
        .sort((a, b) => {
            const rank = (o) => (o === 'foreign' ? 0 : 1);
            return rank(a.e.owner) - rank(b.e.owner) || b.e.ts - a.e.ts;
        });

    for (const { e } of order) {
        if (meta.lookups >= maxLookups) {
            meta.budgetHit = true;
            e.approach = { available: false, reason: 'budget' };
            continue;
        }
        meta.lookups += 1;
        const historyPid = resolvePid(e.digger.id, ledger.map);
        const a = analyseApproach(e, historyPid, { lookbackMs });
        e.approach = a;
        e.historyPid = historyPid;
        if (a.available) meta.hits += 1; else meta.misses += 1;
    }
    // Own digs are not analysed — digging up your own stash needs no explanation —
    // but the field is set so the UI never has to distinguish "not analysed" from
    // "missing".
    for (const e of entries) {
        if (!e.approach) e.approach = { available: false, reason: 'not-analysed' };
    }

    const tracks = summarise(entries);
    meta.analysed = Array.from(tracks.values()).reduce((s, t) => s + t.analysed, 0);
    return { meta, tracks };
}

/**
 * The identity bridge. ADM records a BI GUID; the mod records a steam64. Prefer
 * the resolved steam64, fall back to the `guid:` form the importer writes when the
 * ledger cannot resolve — which, on a server that has never run the mod, is every row.
 */
function resolvePid(guid, ledgerMap) {
    const hit = ledgerMap && ledgerMap.get(guid);
    return hit ? hit.steamId : UNRESOLVED_PREFIX + guid;
}

/** Roll per-dig approaches into one multiplier per player. */
function summarise(entries) {
    const byPid = new Map();
    for (const e of entries) {
        if (e.owner === 'own') continue;
        const a = e.approach;
        if (!a || !a.available) continue;
        let s = byPid.get(e.digger.id);
        if (!s) {
            byPid.set(e.digger.id, s = {
                analysed: 0, beelines: 0, strangers: 0, familiar: 0,
                shaped: 0, coarse: 0,
            });
        }
        s.analysed += 1;
        if (a.beeline) s.beelines += 1;
        if (a.beeline != null) s.shaped += 1;
        if (a.resolution === 'coarse') s.coarse += 1;
        if (a.priorMeaningful) {
            if (a.everBeforeBury) s.familiar += 1;
            else s.strangers += 1;
        }
    }

    const out = new Map();
    for (const [pid, s] of byPid) {
        const known = s.familiar + s.strangers;
        const beelineRate = s.shaped ? s.beelines / s.shaped : 0;
        const strangerRate = known ? s.strangers / known : 0;
        const familiarRate = known ? s.familiar / known : 0;

        let m = 1 + 0.20 * beelineRate + 0.15 * strangerRate - 0.25 * familiarRate;
        // Halve the deviation on a coarse track. Claiming a beeline off six roster
        // dumps is exactly the confidently-wrong result the store's src/stride/gap
        // flags exist to prevent.
        if (s.analysed && s.coarse === s.analysed) m = 1 + (m - 1) * 0.5;

        out.set(pid, {
            available: true, reason: null,
            analysed: s.analysed,
            beelines: s.beelines,
            strangerDigs: s.strangers,
            familiarDigs: s.familiar,
            resolution: s.coarse === s.analysed ? 'coarse' : s.coarse ? 'mixed' : 'fine',
            multiplier: round(clamp(m, MULT_MIN, MULT_MAX), 3),
        });
    }
    return out;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, dp = 1) => Math.round(v * 10 ** dp) / 10 ** dp;
