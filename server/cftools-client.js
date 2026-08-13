/**
 * CF Tools Cloud Data API client (https://data.cftools.cloud).
 *
 * The first outbound HTTP client in this backend — uses the Node >= 20 global
 * fetch, keeping the stdlib-only dependency constraint. Everything the app
 * knows about CF Tools goes through here:
 *
 *  - Auth: POST /v1/auth/register with the stored application credentials →
 *    bearer token, held in memory only (cheap to reacquire, nothing
 *    token-shaped on disk). Treated as expired after 23h; any 401 invalidates
 *    it, re-registers once and retries the request once. Registration is
 *    serialized behind an in-flight promise so concurrent requests trigger a
 *    single auth round-trip.
 *
 *  - Rate limits: the Data API rate-limits per route, so every read goes
 *    through cachedGet() — a per-(apiId, routeKey) TTL cache with in-flight
 *    dedup (concurrent misses share one upstream fetch). On 429 the route
 *    enters a cooldown (Retry-After honored, default 10s) and the stale cache
 *    entry is served marked stale:true; other upstream errors likewise serve
 *    stale when available.
 *
 * Errors are thrown as CfToolsError with a `reason` matching the house
 * degradation vocabulary: not_configured | auth_failed | no_grant |
 * rate_limited | unreachable.
 */

import * as cfg from './cftools-config.js';

// eslint-disable-next-line no-undef
const BASE_URL = (process.env.CFTOOLS_BASE_URL || 'https://data.cftools.cloud').replace(/\/$/, '');
const USER_AGENT = 'Lootmaster/1.0';

const TOKEN_LIFETIME_MS = 23 * 60 * 60 * 1000; // API tokens last ~24h; refresh at 23h
const DEFAULT_COOLDOWN_MS = 10_000;

export class CfToolsError extends Error {
    constructor(reason, message, status) {
        super(message || reason);
        this.name = 'CfToolsError';
        this.reason = reason;   // not_configured | auth_failed | no_grant | rate_limited | unreachable
        this.status = status || 0;
    }
}

let token = null;
let tokenAt = 0;
let authInflight = null;

const now = () => Date.now();

// ---- auth ----

async function registerToken() {
    const creds = cfg.getAppCredentials();
    if (!creds) throw new CfToolsError('not_configured', 'CF Tools application credentials not set');
    let res;
    try {
        res = await fetch(`${BASE_URL}/v1/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
            body: JSON.stringify({ application_id: creds.applicationId, secret: creds.secret }),
        });
    } catch (e) {
        throw new CfToolsError('unreachable', `CF Tools unreachable: ${e.message}`);
    }
    if (res.status === 401 || res.status === 403) {
        throw new CfToolsError('auth_failed', 'CF Tools rejected the application credentials', res.status);
    }
    if (!res.ok) {
        throw new CfToolsError('unreachable', `CF Tools auth failed with HTTP ${res.status}`, res.status);
    }
    const data = await res.json().catch(() => null);
    if (!data || !data.token) throw new CfToolsError('unreachable', 'CF Tools auth returned no token');
    token = data.token;
    tokenAt = now();
    return token;
}

function getToken() {
    if (token && now() - tokenAt < TOKEN_LIFETIME_MS) return Promise.resolve(token);
    if (!authInflight) {
        authInflight = registerToken().finally(() => { authInflight = null; });
    }
    return authInflight;
}

function invalidateToken() {
    token = null;
    tokenAt = 0;
}

// ---- request core ----

function buildUrl(path, query) {
    const url = new URL(`${BASE_URL}${path}`);
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
        }
    }
    return url;
}

async function doFetch(method, path, { body, query } = {}) {
    const bearer = await getToken();
    const headers = { Authorization: `Bearer ${bearer}`, 'User-Agent': USER_AGENT };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
        return await fetch(buildUrl(path, query), {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    } catch (e) {
        throw new CfToolsError('unreachable', `CF Tools unreachable: ${e.message}`);
    }
}

/**
 * Authenticated request with 401-reauth-retry-once. Resolves the parsed JSON
 * body ({} for empty 2xx responses); throws CfToolsError otherwise.
 */
export async function request(method, path, opts = {}) {
    let res = await doFetch(method, path, opts);
    if (res.status === 401) {
        // Token expired server-side — re-register once and retry once.
        invalidateToken();
        res = await doFetch(method, path, opts);
    }
    if (res.status === 401) throw new CfToolsError('auth_failed', 'CF Tools rejected the token after re-auth', 401);
    if (res.status === 403) throw new CfToolsError('no_grant', 'The CF Tools application has no grant for this resource', 403);
    if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After')) || 0;
        const err = new CfToolsError('rate_limited', 'CF Tools rate limit hit', 429);
        err.retryAfterMs = retryAfter > 0 ? retryAfter * 1000 : DEFAULT_COOLDOWN_MS;
        throw err;
    }
    if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).error || ''; } catch { /* ignore */ }
        throw new CfToolsError('unreachable', `CF Tools HTTP ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
    }
    return res.json().catch(() => ({}));
}

// ---- TTL cache (reads only; mutations must never cache) ----

// key -> { at, data, error, inflight, cooldownUntil }
const cache = new Map();

function cacheEntry(key) {
    let e = cache.get(key);
    if (!e) { e = { at: 0, data: undefined, inflight: null, cooldownUntil: 0 }; cache.set(key, e); }
    return e;
}

/**
 * TTL-cached GET keyed by (apiId, routeKey). Returns { at, stale, data }.
 * Concurrent misses share one upstream fetch. On rate-limit/cooldown or any
 * upstream error, serves the last good entry marked stale:true when one
 * exists; otherwise rethrows.
 */
export async function cachedGet(apiId, routeKey, path, ttlMs, query) {
    const key = `${apiId || '-'}:${routeKey}`;
    const entry = cacheEntry(key);
    const fresh = entry.data !== undefined && now() - entry.at < ttlMs;
    if (fresh) return { at: entry.at, stale: false, data: entry.data };

    const stale = () => (entry.data !== undefined ? { at: entry.at, stale: true, data: entry.data } : null);

    if (now() < entry.cooldownUntil) {
        const s = stale();
        if (s) return s;
        throw new CfToolsError('rate_limited', 'CF Tools rate limit cooldown active', 429);
    }

    if (!entry.inflight) {
        entry.inflight = request('GET', path, { query })
            .then((data) => {
                entry.data = data;
                entry.at = now();
                return data;
            })
            .catch((err) => {
                if (err && err.reason === 'rate_limited') {
                    entry.cooldownUntil = now() + (err.retryAfterMs || DEFAULT_COOLDOWN_MS);
                }
                throw err;
            })
            .finally(() => { entry.inflight = null; });
    }

    try {
        const data = await entry.inflight;
        return { at: entry.at, stale: false, data };
    } catch (err) {
        const s = stale();
        if (s) return s;
        throw err;
    }
}

// ---- endpoint surface ----

// TTLs bound upstream cadence regardless of frontend poll rate.
export const TTL = {
    grants: 300_000,
    info: 60_000,
    statistics: 60_000,
    sessions: 5_000,
    playerStats: 30_000,
    leaderboard: 60_000,
    glActions: 300_000,
    glVehicles: 30_000,
    glEvents: 30_000,
};

export const getGrants = () =>
    cachedGet(null, 'grants', '/v1/@app/grants', TTL.grants);

export const getServerInfo = (apiId) =>
    cachedGet(apiId, 'info', `/v1/server/${apiId}/info`, TTL.info);

export const getStatistics = (apiId) =>
    cachedGet(apiId, 'statistics', `/v1/server/${apiId}/statistics`, TTL.statistics);

export const getSessions = (apiId) =>
    cachedGet(apiId, 'sessions', `/v1/server/${apiId}/GSM/list`, TTL.sessions);

export const getPlayerStats = (apiId, ref) =>
    cachedGet(apiId, `player:${ref}`, `/v2/server/${apiId}/player`, TTL.playerStats, { cftools_id: ref });

export const getLeaderboard = (apiId, { stat, order, limit }) =>
    cachedGet(apiId, `leaderboard:${stat}:${order}:${limit}`, `/v1/server/${apiId}/leaderboard`, TTL.leaderboard, {
        stat, order: order === 'ASC' ? -1 : 1, limit,
    });

export const getGameLabsActions = (apiId) =>
    cachedGet(apiId, 'glActions', `/v1/server/${apiId}/GameLabs/actions`, TTL.glActions);

export const getVehicles = (apiId) =>
    cachedGet(apiId, 'glVehicles', `/v1/server/${apiId}/GameLabs/entity-vehicles`, TTL.glVehicles);

export const getEvents = (apiId) =>
    cachedGet(apiId, 'glEvents', `/v1/server/${apiId}/GameLabs/entity-events`, TTL.glEvents);

// Mutations — never cached.

export const kick = (apiId, gamesessionId, reason) =>
    request('POST', `/v1/server/${apiId}/kick`, { body: { gamesession_id: gamesessionId, reason: reason || 'Kicked by admin' } });

export const messagePrivate = (apiId, gamesessionId, content) =>
    request('POST', `/v1/server/${apiId}/message-private`, { body: { gamesession_id: gamesessionId, content } });

export const messageServer = (apiId, content) =>
    request('POST', `/v1/server/${apiId}/message-server`, { body: { content } });

export const rawRcon = (apiId, command) =>
    request('POST', `/v1/server/${apiId}/raw`, { body: { command } });

export const postGameLabsAction = (apiId, { actionCode, actionContext, referenceKey, parameters }) =>
    request('POST', `/v1/server/${apiId}/GameLabs/action`, {
        body: {
            actionCode,
            actionContext: actionContext || 'world',
            referenceKey: referenceKey ?? null,
            parameters: parameters || {},
        },
    });

/** Test seam: reset token, in-flight auth and the TTL cache. */
export function _resetState() {
    token = null;
    tokenAt = 0;
    authInflight = null;
    cache.clear();
}
