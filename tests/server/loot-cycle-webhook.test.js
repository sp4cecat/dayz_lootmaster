import { describe, it, expect } from 'vitest';
import { buildEmbed, postWebhook } from '../../server/loot-cycle-webhook.js';

const flag = {
    pid: '76561198000000001', name: 'Cycler', kind: 'loot_cycle',
    score: 82, severity: 'critical', peak: 82, rung: 1, updatedAt: 1_700_000_000_000,
    evidence: {
        factors: [
            { key: 'quickCycles', label: 'Quick', points: 25, max: 30, detail: '9 items dropped within 20 s of pickup' },
            { key: 'freshCycles', label: 'Fresh', points: 0, max: 25, detail: null },
        ],
        cycles: [{ cls: 'Rag', heldMs: 6000, distM: 2.4, fresh: true }],
        excuse: { multiplier: 1, reasons: [] },
    },
};

describe('buildEmbed', () => {
    it('carries who, how bad, the evidence and a deep link', () => {
        const e = buildEmbed(flag, { event: 'raised', baseUrl: 'http://host:4317/' });
        expect(e.title).toMatch(/flagged/);
        expect(e.description).toContain('Cycler (76561198000000001)');
        expect(e.description).toContain('http://host:4317/#?pid=76561198000000001&from=');
        const evidence = e.fields.find(f => f.name === 'Evidence');
        expect(evidence.value).toContain('9 items dropped within 20 s');
        expect(evidence.value).not.toContain('Fresh');            // zero-point factors are noise
        const cycles = e.fields.find(f => f.name === 'Recent cycles');
        expect(cycles.value).toContain('Rag · held 6 s · 2 m from pickup · fresh spawn');
    });

    it('omits the link when there is no base url', () => {
        const e = buildEmbed(flag, { event: 'kick' });
        expect(e.description).not.toContain('http');
        expect(e.title).toMatch(/kicked/);
    });
});

describe('postWebhook', () => {
    it('reports an HTTP failure without throwing', async () => {
        const r = await postWebhook('https://x/y', {}, { fetchImpl: async () => ({ ok: false, status: 404 }) });
        expect(r).toEqual({ ok: false, status: 404, error: 'HTTP 404' });
    });

    it('reports a thrown fetch without throwing', async () => {
        const r = await postWebhook('https://x/y', {}, { fetchImpl: async () => { throw new Error('boom'); } });
        expect(r.ok).toBe(false);
        expect(r.error).toBe('boom');
    });

    it('sends one embed as JSON', async () => {
        let seen = null;
        const r = await postWebhook('https://x/y', { title: 't' }, {
            fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 204 }; },
        });
        expect(r.ok).toBe(true);
        expect(seen.url).toBe('https://x/y');
        expect(JSON.parse(seen.init.body)).toEqual({ embeds: [{ title: 't' }] });
    });

    it('refuses a missing url up front', async () => {
        const r = await postWebhook(null, {});
        expect(r.ok).toBe(false);
    });
});
