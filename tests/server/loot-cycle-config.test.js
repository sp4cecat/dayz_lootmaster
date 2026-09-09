import { describe, it, expect, beforeEach } from 'vitest';
import {
    defaultPolicy, normalise, getPolicy, setPolicy, redactedView, DEFAULT_LADDER, _resetState,
} from '../../server/loot-cycle-config.js';

/**
 * The policy store is what turns a score into a consequence, so the validation
 * here is the difference between "the operator typed a typo" and "the runner
 * kicked somebody on a rung that does not exist".
 */

beforeEach(() => _resetState());

describe('defaultPolicy', () => {
    it('starts with warnings automatic and removals manual', () => {
        const p = defaultPolicy();
        expect(p.ladder.map(r => [r.action, r.auto])).toEqual([
            ['notice', true], ['warning', true], ['kick', false], ['tempban', false],
        ]);
        expect(p.enabled).toBe(true);
        expect(p.webhook.url).toBeNull();
    });
});

describe('normalise', () => {
    it('renumbers rungs in order and drops unknown actions back to the default', () => {
        const p = normalise({ ladder: [
            { rung: 7, severity: 'low', action: 'notice', auto: true, text: 'a' },
            { rung: 1, severity: 'bogus', action: 'explode', auto: 'yes', text: 5 },
        ] });
        expect(p.ladder.map(r => r.rung)).toEqual([1, 2]);
        expect(p.ladder[1].severity).toBe(DEFAULT_LADDER[1].severity);
        expect(p.ladder[1].action).toBe(DEFAULT_LADDER[1].action);
        expect(p.ladder[1].auto).toBe(false);          // only a literal true turns auto on
        expect(p.ladder[1].text).toBe(DEFAULT_LADDER[1].text);
    });

    it('keeps tempban minutes bounded and gives a tempban rung minutes even when omitted', () => {
        const p = normalise({ ladder: [{ action: 'tempban', severity: 'critical', text: 'x', minutes: -5 }] });
        expect(p.ladder[0].minutes).toBeGreaterThanOrEqual(1);
        const q = normalise({ ladder: [{ action: 'tempban', severity: 'critical', text: 'x' }] });
        expect(q.ladder[0].minutes).toBe(DEFAULT_LADDER[0].minutes || 1440);
    });

    it('only accepts an https webhook and clears on null', () => {
        const a = normalise({ webhook: { url: 'http://example.com/hook' } });
        expect(a.webhook.url).toBeNull();
        const b = normalise({ webhook: { url: 'https://discord.com/api/webhooks/1/abc' } });
        expect(b.webhook.url).toBe('https://discord.com/api/webhooks/1/abc');
        const c = normalise({ webhook: { url: null } }, b);
        expect(c.webhook.url).toBeNull();
    });

    it('leaves the webhook alone when the patch does not mention url', () => {
        const prev = normalise({ webhook: { url: 'https://discord.com/api/webhooks/1/abc' } });
        const next = normalise({ webhook: { minSeverity: 'critical' } }, prev);
        expect(next.webhook.url).toBe(prev.webhook.url);
        expect(next.webhook.minSeverity).toBe('critical');
    });

    it('accepts weight overrides and drops malformed ones', () => {
        const p = normalise({ weights: { quickCycles: { k: 2, max: 40 }, junk: { k: 'a', max: 'b' } } });
        expect(p.weights).toEqual({ quickCycles: { k: 2, max: 40 } });
        const q = normalise({ weights: null }, p);
        expect(q.weights).toBeNull();
    });
});

describe('setPolicy / redactedView', () => {
    it('merges a partial over the stored policy', () => {
        setPolicy({ enabled: false });
        expect(getPolicy().enabled).toBe(false);
        expect(getPolicy().ladder).toHaveLength(DEFAULT_LADDER.length);
    });

    it('never hands the webhook url to the browser', () => {
        setPolicy({ webhook: { url: 'https://discord.com/api/webhooks/1/abc' } });
        const view = redactedView(getPolicy());
        expect(view.webhook).toEqual({ set: true, minSeverity: 'high' });
        expect(JSON.stringify(view)).not.toContain('discord.com');
    });
});
