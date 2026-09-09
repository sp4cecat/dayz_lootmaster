/**
 * Discord webhook delivery for loot-cycle flags.
 *
 * One embed per notable event — a flag crossing the configured severity, or an
 * automatic rung firing — with the evidence an admin needs to decide whether to
 * look further, and a deep link into Player History for when they do.
 *
 * Failures are reported, never thrown: the runner records them as an
 * `enforcement` row with action 'webhook' so a dead URL is visible in the same
 * place as everything else, and a Discord outage can never stall detection.
 */

const SEVERITY_COLOUR = {
    critical: 0xdc2626,
    high: 0xef4444,
    medium: 0xf59e0b,
    low: 0x94a3b8,
    none: 0x64748b,
};

const MAX_FACTORS = 3;
const MAX_CYCLES = 4;

const fmtHeld = (ms) => (ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

/**
 * Build the embed for a flag. Exported so the shape is testable without a socket.
 *
 * @param {object} flag       PlayerFlag (see history-store.js flagFromRow)
 * @param {object} opts
 * @param {string} opts.event 'raised' | 'escalated' | 'notice' | 'warning' | 'kick' | 'tempban'
 * @param {string} [opts.baseUrl]  where Player History lives, for the deep link
 */
export function buildEmbed(flag, { event, baseUrl = '', text = null, now = Date.now() } = {}) {
    const ev = flag.evidence || {};
    const factors = Array.isArray(ev.factors) ? ev.factors.filter(f => f.points > 0).slice(0, MAX_FACTORS) : [];
    const cycles = Array.isArray(ev.cycles) ? ev.cycles.slice(-MAX_CYCLES) : [];
    const who = flag.name ? `${flag.name} (${flag.pid})` : flag.pid;
    const from = Math.max(0, (flag.updatedAt || now) - 60 * 60_000);
    const to = (flag.updatedAt || now) + 5 * 60_000;
    const link = baseUrl ? `${baseUrl.replace(/\/$/, '')}/#?pid=${encodeURIComponent(flag.pid)}&from=${from}&to=${to}` : null;

    const titleFor = {
        raised: 'Loot cycling flagged',
        escalated: 'Loot cycling escalated',
        notice: 'Loot cycling notice sent',
        warning: 'Loot cycling warning sent',
        kick: 'Player kicked for loot cycling',
        tempban: 'Player temp-banned for loot cycling',
    };

    const fields = [
        { name: 'Severity', value: `${flag.severity} (${flag.score}/100, peak ${flag.peak})`, inline: true },
        { name: 'Ladder', value: `rung ${flag.rung}`, inline: true },
    ];
    if (factors.length) {
        fields.push({
            name: 'Evidence',
            value: factors.map(f => `• ${f.detail || f.label} (${Math.round(f.points)}/${f.max})`).join('\n').slice(0, 1000),
        });
    }
    if (cycles.length) {
        fields.push({
            name: 'Recent cycles',
            value: cycles.map(c => `• ${c.cls} · held ${fmtHeld(c.heldMs)}`
                + (c.distM != null ? ` · ${Math.round(c.distM)} m from pickup` : '')
                + (c.fresh ? ' · fresh spawn' : '')).join('\n').slice(0, 1000),
        });
    }
    if (ev.excuse && Array.isArray(ev.excuse.reasons) && ev.excuse.reasons.length) {
        fields.push({ name: 'Mitigating', value: ev.excuse.reasons.join('\n').slice(0, 1000) });
    }
    if (text) fields.push({ name: 'Message', value: String(text).slice(0, 1000) });

    return {
        title: titleFor[event] || 'Loot cycling',
        description: who + (link ? `\n[Open in Player History](${link})` : ''),
        color: SEVERITY_COLOUR[flag.severity] ?? SEVERITY_COLOUR.none,
        fields,
        timestamp: new Date(now).toISOString(),
    };
}

/**
 * POST one embed. Resolves `{ ok, status, error }`; never rejects.
 * `fetchImpl` is injectable for tests; Node's global fetch otherwise.
 */
export async function postWebhook(url, embed, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
    if (!url || typeof url !== 'string') return { ok: false, status: 0, error: 'no webhook url' };
    if (typeof fetchImpl !== 'function') return { ok: false, status: 0, error: 'fetch unavailable' };
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
        const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] }),
            signal: ctl ? ctl.signal : undefined,
        });
        if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
        return { ok: true, status: res.status, error: null };
    } catch (err) {
        return { ok: false, status: 0, error: (err && err.message) || String(err) };
    } finally {
        if (timer) clearTimeout(timer);
    }
}
