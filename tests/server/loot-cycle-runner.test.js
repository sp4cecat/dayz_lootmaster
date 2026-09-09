import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as history from '../../server/history-store.js';
import * as policyStore from '../../server/loot-cycle-config.js';
import { buildEmbed } from '../../server/loot-cycle-webhook.js';
import { createRunner } from '../../server/loot-cycle-runner.js';

/**
 * The runner is where a score becomes a consequence, so what these tests pin is
 * not the arithmetic (loot-cycle.test.js owns that) but the refusals: no rung on a
 * lossy window, no rung on a legacy mod, no skipping a manual rung, no second
 * message inside the cooldown — and that every rung that does fire leaves an
 * enforcement row and an action-feed row behind it.
 *
 * Real in-memory history store, real policy store, fake clock, recording actions.
 */

const T0 = 1_700_000_000_000;
const PID = '76561198000000001';

function cyclerEvents({ count = 12, fresh = 1, identity = true } = {}) {
    const events = [];
    let n = 0;
    for (let i = 0; i < count; i++) {
        const pickTs = T0 + i * 10_000;
        events.push({
            n: ++n, ts: pickTs, pid: PID, kind: 'pickup', cls: `Item${i}`, pos: [1000, 10, 1000],
            iid: identity ? i + 1 : 0, fresh: identity ? fresh : -1, held: -1,
        });
        events.push({
            n: ++n, ts: pickTs + 6_000, pid: PID, kind: 'drop', cls: `Item${i}`, pos: [1002, 10, 1001],
            iid: identity ? i + 1 : 0, fresh: identity ? 0 : -1, held: identity ? 6_000 : -1,
        });
    }
    return events;
}

/** Store events with ages computed against `at`, the way the mod's batch would arrive. */
function record(events, at, extra = {}) {
    const batch = {
        session: 'run-a', seq: 1,
        events: events.map(e => ({ ...e, age: at - e.ts })),
        ...extra,
    };
    return history.recordEvents(batch, at);
}

function makeRunner({ now, actions, posted }) {
    const ingest = { getSnapshot: () => ({ data: { territories: [] } }), modConnected: () => true };
    const webhook = {
        buildEmbed,
        postWebhook: async (url, embed) => { posted.push({ url, embed }); return { ok: true, status: 204, error: null }; },
    };
    return createRunner({
        history, ingest, policyStore, actions, webhook,
        baseUrl: 'http://test', now, srv: 'default', log: { warn() {}, error() {} },
    });
}

function recordingActions() {
    const calls = [];
    return {
        calls,
        message: async (pid, title, text) => { calls.push(['message', pid, title, text]); return { ok: true, result: 'ok' }; },
        kick: async (pid, reason) => { calls.push(['kick', pid, reason]); return { ok: true, result: 'ok' }; },
        tempban: async (pid, minutes, reason) => { calls.push(['tempban', pid, minutes, reason]); return { ok: true, result: 'ok', expires: 1 }; },
    };
}

let clock;
beforeEach(() => {
    history._openForTest(':memory:');
    policyStore._resetState();
    clock = T0 + 200_000;
});
afterEach(() => history.close());

describe('runner ladder', () => {
    it('raises a flag after two evaluations and walks the automatic rungs one per tick', async () => {
        policyStore.setPolicy({ cooldownMs: 0, webhook: { url: 'https://discord.com/api/webhooks/1/x', minSeverity: 'high' } });
        const actions = recordingActions();
        const posted = [];
        const runner = makeRunner({ now: () => clock, actions, posted });
        record(cyclerEvents(), clock);

        await runner.tick();
        // One evaluation is a suspicion, not a verdict.
        expect(history.listFlags({ minSeverity: 'low' })).toHaveLength(0);
        expect(actions.calls).toHaveLength(0);

        clock += 30_000;
        await runner.tick();
        const [flag] = history.listFlags({ minSeverity: 'low' });
        expect(flag).toBeTruthy();
        expect(['high', 'critical']).toContain(flag.severity);
        expect(flag.episodes).toBe(1);
        // Rung 1 (notice at medium, auto) fired on the raise.
        expect(actions.calls).toEqual([['message', PID, 'Loot cycling', policyStore.DEFAULT_LADDER[0].text]]);
        expect(flag.rung).toBe(1);
        const enf = history.listEnforcement({ pid: PID });
        expect(enf.map(e => [e.action, e.result, e.auto])).toEqual([['notice', 'ok', true]]);
        // ...and the feed shows it in the same table as the evidence.
        const feed = history.queryActions({ pids: [PID], kinds: ['warned'], from: 0, to: clock + 1 }).items;
        expect(feed).toHaveLength(1);
        // The raise itself crossed the webhook threshold.
        expect(posted.length).toBeGreaterThanOrEqual(1);
        expect(posted[0].embed.description).toContain(PID);

        clock += 30_000;
        await runner.tick();
        expect(actions.calls[1]).toEqual(['message', PID, 'Loot cycling', policyStore.DEFAULT_LADDER[1].text]);
        expect(history.getFlag({ pid: PID }).rung).toBe(2);

        // Rung 3 is manual: the runner stops here however many ticks pass.
        clock += 30_000;
        await runner.tick();
        clock += 30_000;
        await runner.tick();
        expect(actions.calls).toHaveLength(2);
        expect(history.getFlag({ pid: PID }).rung).toBe(2);
    });

    it('honours the cooldown between automatic messages', async () => {
        policyStore.setPolicy({ cooldownMs: 15 * 60_000 });
        const actions = recordingActions();
        const runner = makeRunner({ now: () => clock, actions, posted: [] });
        record(cyclerEvents(), clock);
        await runner.tick();
        clock += 30_000;
        await runner.tick();
        clock += 30_000;
        await runner.tick();
        expect(actions.calls).toHaveLength(1);           // rung 2 waits out the cooldown
        clock += 16 * 60_000;
        await runner.tick();
        expect(actions.calls).toHaveLength(2);
    });

    it('lets an operator fire a manual rung, but never one that already fired', async () => {
        policyStore.setPolicy({ cooldownMs: 0 });
        const actions = recordingActions();
        const runner = makeRunner({ now: () => clock, actions, posted: [] });
        record(cyclerEvents(), clock);
        await runner.tick();
        clock += 30_000;
        await runner.tick();
        clock += 30_000;
        await runner.tick();

        const again = await runner.enforce(PID, 2);
        expect(again.reason).toBe('already_fired');
        const kick = await runner.enforce(PID, 3);
        expect(kick.ok).toBe(true);
        expect(actions.calls.at(-1)).toEqual(['kick', PID, policyStore.DEFAULT_LADDER[2].text]);
        expect(history.getFlag({ pid: PID }).rung).toBe(3);
        const kicked = history.queryActions({ pids: [PID], kinds: ['kicked'], from: 0, to: clock + 1 }).items;
        expect(kicked).toHaveLength(1);
        const missing = await runner.enforce('nobody', 1);
        expect(missing.reason).toBe('no_flag');
    });
});

describe('runner refusals', () => {
    it('updates the flag but fires nothing when the mod reported dropped events', async () => {
        policyStore.setPolicy({ cooldownMs: 0 });
        const actions = recordingActions();
        const runner = makeRunner({ now: () => clock, actions, posted: [] });
        record(cyclerEvents(), clock, { dropped: 3 });
        await runner.tick();
        clock += 30_000;
        await runner.tick();
        clock += 30_000;
        await runner.tick();
        const flag = history.getFlag({ pid: PID });
        expect(flag).toBeTruthy();
        expect(flag.evidence.lossy).toBe(true);
        expect(actions.calls).toHaveLength(0);
        expect(history.listEnforcement({ pid: PID })).toHaveLength(0);
    });

    it('scores nothing and flags nobody on a mod that sends no item identity', async () => {
        const actions = recordingActions();
        const runner = makeRunner({ now: () => clock, actions, posted: [] });
        record(cyclerEvents({ identity: false }), clock);
        await runner.tick();
        clock += 30_000;
        await runner.tick();
        expect(history.listFlags({ minSeverity: 'low' })).toHaveLength(0);
        expect(actions.calls).toHaveLength(0);
        expect(runner.stats().capable.iid).toBe(false);
    });

    it('keeps reading but stops acting when the policy is disabled', async () => {
        policyStore.setPolicy({ enabled: false, cooldownMs: 0 });
        const actions = recordingActions();
        const runner = makeRunner({ now: () => clock, actions, posted: [] });
        record(cyclerEvents(), clock);
        await runner.tick();
        clock += 30_000;
        await runner.tick();
        expect(history.listFlags({ minSeverity: 'low' })).toHaveLength(1);
        expect(actions.calls).toHaveLength(0);
    });

    it('records a failed action as a failed enforcement and leaves the rung where it was', async () => {
        policyStore.setPolicy({ cooldownMs: 0 });
        const actions = recordingActions();
        actions.message = async () => ({ ok: false, result: 'player_not_found' });
        const runner = makeRunner({ now: () => clock, actions, posted: [] });
        record(cyclerEvents(), clock);
        await runner.tick();
        clock += 30_000;
        await runner.tick();
        const enf = history.listEnforcement({ pid: PID });
        expect(enf[0].result).toBe('player_not_found');
        expect(history.getFlag({ pid: PID }).rung).toBe(0);
    });
});

describe('runner housekeeping', () => {
    it('dismissing a flag resets the ladder and a fresh episode counts as a repeat', async () => {
        policyStore.setPolicy({ cooldownMs: 0 });
        const actions = recordingActions();
        const runner = makeRunner({ now: () => clock, actions, posted: [] });
        record(cyclerEvents(), clock);
        await runner.tick();
        clock += 30_000;
        await runner.tick();
        expect(history.clearFlag({ pid: PID, now: clock })).toBe(true);
        expect(history.listFlags({ minSeverity: 'low' })).toHaveLength(0);

        // The same behaviour again, well after the first window has expired.
        clock += 3 * 3_600_000;
        const later = cyclerEvents().map(e => ({ ...e, n: e.n + 1000, ts: e.ts + 3 * 3_600_000 + 200_000 }));
        record(later, clock);
        await runner.tick();
        clock += 30_000;
        await runner.tick();
        const flag = history.getFlag({ pid: PID });
        expect(flag.clearedAt).toBeNull();
        expect(flag.episodes).toBe(2);
        expect(flag.rung).toBe(1);                    // the ladder started over
    });

    it('previews a window without touching stored flags', async () => {
        const runner = makeRunner({ now: () => clock, actions: recordingActions(), posted: [] });
        record(cyclerEvents(), clock);
        const out = runner.preview({ pid: PID, from: T0 - 1000, to: clock });
        expect(out.evidence.score).toBeGreaterThanOrEqual(75);
        expect(out.rows).toBe(24);
        // A week-wide range scores the trailing hour before the last event, not zero.
        const wide = runner.preview({ pid: PID, from: 0, to: clock + 7 * 86_400_000 });
        expect(wide.evidence.score).toBe(out.evidence.score);
        expect(wide.scoredAt).toBe(T0 + 11 * 10_000 + 6_000);
        expect(history.listFlags({ minSeverity: 'low' })).toHaveLength(0);
    });

    it('reports itself through stats', async () => {
        const runner = makeRunner({ now: () => clock, actions: recordingActions(), posted: [] });
        record(cyclerEvents(), clock);
        await runner.tick();
        const s = runner.stats();
        expect(s.lastRunAt).toBe(clock);
        expect(s.players).toBe(1);
        expect(s.cursor).toBe(24);
        expect(s.lastError).toBeNull();
    });
});
