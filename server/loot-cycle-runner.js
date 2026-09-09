/**
 * The loot-cycle detector's loop: cursor over the action log, evaluate, persist
 * flags, and walk the enforcement ladder.
 *
 * Everything with a side effect is injected — the history store, the live ingest
 * store, the policy store, the webhook poster and the three consequence actions
 * (message / kick / tempban) — so the loop can be driven by hand in a test with
 * a fake clock and a recording enforcer. The scoring itself lives in
 * loot-cycle.js and is pure; this file is the only place the two halves meet.
 *
 * ## What it refuses to do
 *
 *  - Escalate on a lossy tick. If the mod reported dropped events in this batch,
 *    a burst may be missing its drops or its pickups, and either way the score is
 *    wrong in an unknown direction. Flags still update; rungs do not fire.
 *  - Escalate on a silent row. An old mod sends no item identity, and a score
 *    built without it is a guess. The flag says so instead.
 *  - Skip a manual rung. The operator turned it manual for a reason.
 *  - Fire the same rung twice in one episode, or message the same player inside
 *    the cooldown.
 */

import * as lootCycle from './loot-cycle.js';

const HOUR_MS = 3_600_000;
const DEFAULT_INTERVAL_MS = 30_000;
const CAPABLE_LOOKBACK_MS = HOUR_MS;
const HOME_DAYS = 30;
const TERRITORY_DEFAULT_R = 150;

const SEVERITY_RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
const rank = (s) => SEVERITY_RANK[s] ?? 0;

/**
 * Territories the live snapshot says this player belongs to, as home zones.
 * The mod's territory rows carry members under several id keys; a member that
 * looks like this pid under any of them counts.
 */
function territoryZones(snapshotData, pid) {
    const out = [];
    const list = Array.isArray(snapshotData?.territories) ? snapshotData.territories : [];
    for (const t of list) {
        const pos = t.pos || t.position;
        const x = Array.isArray(pos) ? Number(pos[0]) : Number(pos?.x);
        const z = Array.isArray(pos) ? Number(pos[pos.length >= 3 ? 2 : 1]) : Number(pos?.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
        const ids = new Set();
        const push = (v) => { if (v !== undefined && v !== null && v !== '') ids.add(String(v)); };
        push(t.ownerId); push(t.ownerSteamId); push(t.owner?.steamId); push(t.owner?.id);
        for (const m of (Array.isArray(t.members) ? t.members : [])) {
            if (typeof m === 'string') push(m);
            else if (m && typeof m === 'object') { push(m.id); push(m.steamId); push(m.uid); }
        }
        if (!ids.has(String(pid))) continue;
        const r = Number(t.radius);
        out.push({ x, z, r: Number.isFinite(r) && r > 0 ? r : TERRITORY_DEFAULT_R, source: 'territory' });
    }
    return out;
}

/**
 * @param {object} deps
 * @param {object} deps.history      history-store module
 * @param {object} deps.ingest       ingest-store module (live snapshot, mod presence)
 * @param {object} deps.policyStore  loot-cycle-config module
 * @param {object} deps.actions      { message(pid, title, text), kick(pid, reason), tempban(pid, minutes, reason) }
 *                                   each resolving { ok, result, expires? }
 * @param {object} deps.webhook      { buildEmbed, postWebhook }
 * @param {string} [deps.baseUrl]    for deep links in webhook embeds
 * @param {function} [deps.now]      clock, for tests
 * @param {string} [deps.srv]
 */
export function createRunner({
    history, ingest, policyStore, actions, webhook,
    baseUrl = '', now = () => Date.now(), srv = 'default', intervalMs = DEFAULT_INTERVAL_MS,
    log = console,
}) {
    let state = lootCycle.createState();
    let cursor = null;           // last action.id consumed; null = not started
    let timer = null;
    let running = false;
    let ticking = false;
    let lastRunAt = null;
    let lastError = null;
    let lastCapable = { iid: false, fresh: false, rows: 0 };
    const homeCache = new Map();     // pid -> { at, zones }
    const HOME_TTL_MS = 10 * 60_000;

    function policy() { return policyStore.getPolicy(srv); }

    function homeZonesFor(pids, t) {
        const zones = new Map();
        const live = ingest.getSnapshot?.()?.data || {};
        for (const pid of pids) {
            let cached = homeCache.get(pid);
            if (!cached || t - cached.at > HOME_TTL_MS) {
                const events = history.homeEvents({ pid, days: HOME_DAYS, now: t, srv });
                cached = { at: t, zones: lootCycle.buildHomeZones(events) };
                homeCache.set(pid, cached);
            }
            zones.set(pid, [...cached.zones, ...territoryZones(live, pid)]);
        }
        return zones;
    }

    /** Feed rows to the scorer with the home context of every player they mention. */
    function ingestRows(rows, t) {
        if (!rows.length) return;
        rows.sort((a, b) => (a.ts - b.ts) || (a.id - b.id));
        const pids = [...new Set(rows.map(r => r.pid).filter(Boolean))];
        lootCycle.ingest(state, rows, { homeZones: homeZonesFor(pids, t) });
    }

    function replay(t) {
        state = lootCycle.createState();
        const { items } = history.actionsInRange({ from: t - lootCycle.WINDOW_MS, to: t, srv });
        ingestRows(items, t);
        cursor = history.maxActionId(srv);
    }

    // ---- ladder ----

    function nextRungFor(flag, pol) {
        const ladder = pol.ladder;
        for (const r of ladder) {
            if (r.rung <= flag.rung) continue;
            if (rank(flag.severity) < rank(r.severity)) return null;   // not reached yet
            if (r.repeat && flag.episodes < r.repeat) return null;      // needs a repeat offender
            return r;                                                  // the next rung, auto or not
        }
        return null;
    }

    async function fire(flag, rung, { auto }) {
        const pol = policy();
        const t = now();
        let res = { ok: false, result: 'error:unknown' };
        let expires = null;
        try {
            if (rung.action === 'notice' || rung.action === 'warning') {
                res = await actions.message(flag.pid, 'Loot cycling', rung.text);
            } else if (rung.action === 'kick') {
                res = await actions.kick(flag.pid, rung.text);
            } else if (rung.action === 'tempban') {
                res = await actions.tempban(flag.pid, rung.minutes || 1440, rung.text, { profileId: pol.profileId });
                if (res.ok) expires = res.expires ?? (t + (rung.minutes || 1440) * 60_000);
            }
        } catch (err) {
            res = { ok: false, result: `error:${(err && err.message) || err}` };
        }

        const id = history.recordEnforcement({
            ts: t, pid: flag.pid, flag: flag.kind, rung: rung.rung, action: rung.action,
            auto, result: res.result ?? (res.ok ? 'ok' : 'error'), expires, detail: rung.text,
        }, srv);
        const row = {
            id, ts: t, pid: flag.pid, flag: flag.kind, rung: rung.rung, action: rung.action,
            auto, result: res.result ?? (res.ok ? 'ok' : 'error'), expires, detail: rung.text,
        };

        if (res.ok) {
            const kind = rung.action === 'kick' ? 'kicked' : rung.action === 'tempban' ? 'banned' : 'warned';
            try {
                history.recordAction({ ts: t, pid: flag.pid, kind, detail: rung.text }, srv);
            } catch (err) {
                log.error?.('[loot-cycle] failed to write the audit action row:', err);
            }
            history.setFlagRung({ pid: flag.pid, kind: flag.kind, rung: rung.rung, now: t, srv });
            flag.rung = rung.rung;
            await notify(flag, rung.action, { text: rung.text });
        }
        return row;
    }

    async function notify(flag, event, { text = null } = {}) {
        const pol = policy();
        const url = pol.webhook?.url;
        if (!url) return;
        if (rank(flag.severity) < rank(pol.webhook.minSeverity)) return;
        const embed = webhook.buildEmbed(flag, { event, baseUrl, text, now: now() });
        const res = await webhook.postWebhook(url, embed);
        if (!res.ok) {
            try {
                history.recordEnforcement({
                    ts: now(), pid: flag.pid, flag: flag.kind, rung: flag.rung, action: 'webhook',
                    auto: true, result: `error:${res.error || res.status}`, detail: event,
                }, srv);
            } catch { /* the failure is already the news */ }
        }
    }

    function lastEnforcementAt(pid) {
        const rows = history.listEnforcement({ pid, flag: 'loot_cycle', limit: 5, srv });
        const real = rows.find(r => r.action !== 'webhook' && r.result === 'ok');
        return real ? real.ts : 0;
    }

    /** Persist one player's evaluation, returning the stored flag and whether it was raised/escalated. */
    function persistEvaluation(pid, row, t) {
        const existing = history.getFlag({ pid, kind: 'loot_cycle', srv });
        const live = existing && !existing.clearedAt;
        // A dismissed flag keeps its hysteresis counters but starts from `none`:
        // the operator said "not this time", not "never count again". Starting
        // from a null state every tick would reset the consecutive-evaluation
        // count each time and make a re-raise impossible.
        const prevState = live
            ? existing.state
            : (existing && existing.state ? { ...existing.state, level: 'none', smoothed: 0 } : null);
        const prevLevel = live ? existing.severity : 'none';
        const next = lootCycle.nextFlag(prevState, { score: row.score, ts: t });

        const raised = prevLevel === 'none' && next.level !== 'none';
        const escalated = !raised && rank(next.level) > rank(prevLevel);
        if (!existing && next.level === 'none' && row.score === 0) return null;   // nothing to say

        history.upsertFlag({
            pid, kind: 'loot_cycle',
            score: row.score, severity: next.level,
            peak: raised ? row.score : Math.max(next.peak || 0, live ? existing.peak : 0),
            rung: raised ? 0 : (live ? existing.rung : 0),
            evidence: row, state: next, now: t,
            raised, uncleared: raised,
        }, srv);
        const flag = history.getFlag({ pid, kind: 'loot_cycle', srv });
        return { flag, raised, escalated };
    }

    async function evaluateAll(rows, t) {
        const pol = policy();
        lastCapable = history.capableSince({ since: t - CAPABLE_LOOKBACK_MS, srv });
        const out = lootCycle.evaluate(state, { now: t, capable: lastCapable, weights: pol.weights || undefined });
        // Lossy is judged over the whole window, not this tick: the mod's drop
        // counter rides on one row of a batch that mixed everyone's events, so a
        // hole cannot be pinned on a player or a moment. The scorer keeps the
        // timestamps; while any sit inside the window, nobody escalates.
        const lossy = !!out.summary?.lossy || rows.some(r => r.dropped != null && r.dropped > 0);
        const seen = new Set();

        for (const row of out.players) {
            seen.add(row.pid);
            const stored = persistEvaluation(row.pid, row, t);
            if (!stored) continue;
            const { flag, raised, escalated } = stored;
            if (raised || escalated) await notify(flag, raised ? 'raised' : 'escalated');
            if (lossy || row.silent || !pol.enabled) continue;
            await maybeFire(flag, pol, t);
        }

        // Flags whose player has gone quiet still need to decay.
        for (const f of history.listFlags({ kind: 'loot_cycle', minSeverity: 'low', srv })) {
            if (seen.has(f.pid)) continue;
            const row = { ...(f.evidence || {}), score: 0, cycles: [], factors: f.evidence?.factors || [] };
            persistEvaluation(f.pid, row, t);
        }
    }

    async function maybeFire(flag, pol, t) {
        const rung = nextRungFor(flag, pol);
        if (!rung || !rung.auto) return;
        if (pol.cooldownMs > 0 && t - lastEnforcementAt(flag.pid) < pol.cooldownMs) return;
        await fire(flag, rung, { auto: true });
    }

    // ---- public ----

    async function tick() {
        if (ticking) return;
        ticking = true;
        const t = now();
        try {
            if (cursor === null) replay(t);
            const rows = history.actionsSince({ afterId: cursor, srv });
            if (rows.length) cursor = rows[rows.length - 1].id;
            ingestRows(rows, t);
            lootCycle.sweep(state, t);
            await evaluateAll(rows, t);
            lastRunAt = t;
            lastError = null;
        } catch (err) {
            lastError = (err && err.message) || String(err);
            log.warn?.(`[loot-cycle] tick failed: ${lastError}`);
        } finally {
            ticking = false;
        }
    }

    function start() {
        if (timer) return;
        running = true;
        tick();
        timer = setInterval(tick, intervalMs);
        timer.unref?.();
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
        running = false;
    }

    /** Operator-triggered rung. Manual rungs are allowed; the ordering rule still holds. */
    async function enforce(pid, rungNo) {
        const pol = policy();
        const flag = history.getFlag({ pid, kind: 'loot_cycle', srv });
        if (!flag) return { error: 'No flag for that player.', reason: 'no_flag', status: 404 };
        const rung = pol.ladder.find(r => r.rung === Number(rungNo));
        if (!rung) return { error: 'No such rung.', reason: 'no_rung', status: 400 };
        if (rung.rung <= flag.rung) return { error: 'That rung has already fired this episode.', reason: 'already_fired', status: 409 };
        const row = await fire(flag, rung, { auto: false });
        return { enforcement: row, ok: row.result === 'ok' };
    }

    /** Score a historical window for one player without touching stored flags. */
    function preview({ pid, from, to }) {
        const fresh = lootCycle.createState();
        const { items, truncated } = history.actionsInRange({ pids: [pid], from, to, srv });
        items.sort((a, b) => (a.ts - b.ts) || (a.id - b.id));
        const zones = homeZonesFor([pid], to);
        lootCycle.ingest(fresh, items, { homeZones: zones });
        const capable = history.capableSince({ since: from, srv });
        // Scored as of the LAST event in the range, not the range's end: the scorer
        // keeps a trailing hour, so evaluating at the end of a week-wide window
        // would prune everything and report an honest-looking zero.
        const end = items.length ? Math.min(to, items[items.length - 1].ts) : to;
        const out = lootCycle.evaluate(fresh, { now: end, capable, weights: policy().weights || undefined });
        const row = out.players.find(p => p.pid === pid) || null;
        return { evidence: row, truncated, rows: items.length, capable, scoredAt: end, windowMs: lootCycle.WINDOW_MS };
    }

    function stats() {
        return {
            enabled: policy().enabled,
            running,
            lastRunAt,
            lastError,
            players: state.players.size,
            cursor: cursor ?? 0,
            capable: lastCapable,
            modConnected: !!ingest.modConnected?.(),
        };
    }

    return { start, stop, tick, enforce, preview, stats, _state: () => state };
}
