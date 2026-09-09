/**
 * Loot-cycle policy store: what the detector is allowed to DO about what it sees.
 *
 * Lives in its own gitignored file (server/.cache/loot-cycle.json) rather than
 * profiles.json for the same reason the CF Tools credentials do: it carries a
 * Discord webhook URL, which is a bearer secret, and profiles are exported and
 * dev-seeded. Keyed by `srv` like the history tables, because the detector runs
 * over the profile-independent /ingest stream; `profileId` is the one bridge back
 * to a profile, and only because kick/ban over CF Tools need that profile's binding.
 *
 * The ladder is ordered rungs. The runner fires an `auto` rung by itself once the
 * flag's severity reaches it; a manual rung only ever appears as a button. It
 * never skips a manual rung to reach an automatic one above it, so an operator who
 * sets rung 3 to manual has made everything above it manual too, whatever the
 * flags on those rungs say.
 */

import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* eslint-disable no-undef */
const CONFIG_FILE = process.env.LOOT_CYCLE_CONFIG_FILE
    ? resolve(process.env.LOOT_CYCLE_CONFIG_FILE)
    : resolve(join(__dirname, '.cache', 'loot-cycle.json'));
const PERSIST_DISABLED = !!process.env.VITEST || process.env.NODE_ENV === 'test';
/* eslint-enable no-undef */

export const SEVERITIES = ['none', 'low', 'medium', 'high', 'critical'];
export const ACTIONS = ['notice', 'warning', 'kick', 'tempban'];

export const DEFAULT_LADDER = [
    {
        rung: 1, severity: 'medium', action: 'notice', auto: true,
        text: 'Heads up: picking loot up just to drop it again (loot cycling) is against the server rules. Please stop.',
    },
    {
        rung: 2, severity: 'high', action: 'warning', auto: true,
        text: 'Warning: loot cycling has been detected on your account. Continuing will get you kicked or banned.',
    },
    {
        rung: 3, severity: 'critical', action: 'kick', auto: false,
        text: 'Kicked for loot cycling.',
    },
    {
        rung: 4, severity: 'critical', action: 'tempban', auto: false, repeat: 2, minutes: 1440,
        text: 'Temporary ban for repeated loot cycling.',
    },
];

export function defaultPolicy() {
    return {
        enabled: true,
        profileId: null,
        ladder: DEFAULT_LADDER.map(r => ({ ...r })),
        cooldownMs: 15 * 60_000,
        webhook: { url: null, minSeverity: 'high' },
        weights: null,
    };
}

let store = {};           // { [srv]: policy }

// ---- persistence (mirrors cftools-config.js) ----

let saveTimer = null;
function persist() {
    if (PERSIST_DISABLED) return;
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
        saveTimer = null;
        // eslint-disable-next-line no-undef
        const tmp = `${CONFIG_FILE}.tmp-${process.pid}-${crypto.randomUUID()}`;
        try {
            await mkdir(dirname(CONFIG_FILE), { recursive: true });
            await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
            await rename(tmp, CONFIG_FILE);
        } catch {
            try { await rm(tmp, { force: true }); } catch { /* ignore */ }
        }
    }, 500);
}

export async function loadConfig() {
    try {
        const parsed = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object') {
            store = {};
            for (const [srv, p] of Object.entries(parsed)) store[srv] = normalise(p);
        }
    } catch {
        store = {};
    }
    return store;
}

export function _resetState() { store = {}; }

// ---- validation ----

const clampInt = (v, lo, hi, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, Math.trunc(n)));
};

function normaliseRung(r, i) {
    const base = DEFAULT_LADDER[i] || DEFAULT_LADDER[DEFAULT_LADDER.length - 1];
    const out = {
        rung: i + 1,
        severity: SEVERITIES.includes(r?.severity) && r.severity !== 'none' ? r.severity : base.severity,
        action: ACTIONS.includes(r?.action) ? r.action : base.action,
        auto: r?.auto === true,
        text: typeof r?.text === 'string' ? r.text.slice(0, 500) : base.text,
    };
    if (out.action === 'tempban') out.minutes = clampInt(r?.minutes, 1, 60 * 24 * 365, base.minutes || 1440);
    if (r?.repeat !== undefined && r?.repeat !== null) out.repeat = clampInt(r.repeat, 1, 100, 1);
    return out;
}

/** Bring any shape (file, PUT body) to a valid policy. Unknown keys are dropped. */
export function normalise(p, prev = defaultPolicy()) {
    const src = p && typeof p === 'object' ? p : {};
    const ladderIn = Array.isArray(src.ladder) ? src.ladder.slice(0, 8) : prev.ladder;
    const webhookIn = src.webhook && typeof src.webhook === 'object' ? src.webhook : {};
    let url = prev.webhook.url;
    if ('url' in webhookIn) {
        url = typeof webhookIn.url === 'string' && /^https:\/\//.test(webhookIn.url.trim())
            ? webhookIn.url.trim() : null;
    }
    let weights = prev.weights;
    if ('weights' in src) {
        weights = null;
        if (src.weights && typeof src.weights === 'object') {
            weights = {};
            for (const [k, w] of Object.entries(src.weights)) {
                if (!w || typeof w !== 'object') continue;
                const max = Number(w.max);
                const kk = w.k === null ? null : Number(w.k);
                if (!Number.isFinite(max)) continue;
                weights[k] = { k: Number.isFinite(kk) ? kk : null, max: Math.max(0, max) };
            }
            if (!Object.keys(weights).length) weights = null;
        }
    }
    return {
        enabled: 'enabled' in src ? src.enabled === true : prev.enabled,
        profileId: 'profileId' in src
            ? (typeof src.profileId === 'string' && src.profileId ? src.profileId : null)
            : prev.profileId,
        ladder: ladderIn.map(normaliseRung),
        cooldownMs: 'cooldownMs' in src ? clampInt(src.cooldownMs, 0, 24 * 3600_000, prev.cooldownMs) : prev.cooldownMs,
        webhook: {
            url,
            minSeverity: SEVERITIES.includes(webhookIn.minSeverity) ? webhookIn.minSeverity : prev.webhook.minSeverity,
        },
        weights,
    };
}

export function getPolicy(srv = 'default') {
    if (!store[srv]) store[srv] = defaultPolicy();
    return store[srv];
}

/** Merge a partial update over the current policy, persist, and return the result. */
export function setPolicy(patch, srv = 'default') {
    store[srv] = normalise(patch, getPolicy(srv));
    persist();
    return store[srv];
}

/** What the browser is allowed to see: the webhook URL becomes a boolean. */
export function redactedView(policy) {
    return {
        enabled: policy.enabled,
        profileId: policy.profileId,
        ladder: policy.ladder.map(r => ({ ...r })),
        cooldownMs: policy.cooldownMs,
        webhook: { set: !!policy.webhook.url, minSeverity: policy.webhook.minSeverity },
        weights: policy.weights ? { ...policy.weights } : null,
    };
}
