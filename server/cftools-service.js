/**
 * CF Tools shaping layer: turns raw Data API payloads into the stable,
 * minimal shapes the frontend consumes, and owns the degradation story.
 *
 * House style: reads never 5xx. Every builder returns a shape with
 * `connected` and, when false, a `reason` from the shared vocabulary:
 * not_configured | no_api_id | no_profile | auth_failed | no_grant |
 * rate_limited | unreachable.
 *
 * Layer freshness: /live responses carry per-layer { at, stale, items } so a
 * rate-limited or erroring upstream dims that one layer instead of blanking
 * the map (stale entries come from the client cache's stale-serve).
 */

import * as cf from './cftools-client.js';
import * as cfg from './cftools-config.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Accepts [x,y,z] (DayZ world: y = height) or {x,y,z}; returns [x,y,z] or null.
function normPosition(pos) {
    if (Array.isArray(pos) && pos.length >= 2) {
        const x = num(pos[0]);
        const y = num(pos[1]) ?? 0;
        const z = num(pos.length >= 3 ? pos[2] : pos[1]);
        if (x === null || z === null) return null;
        return [x, pos.length >= 3 ? (y ?? 0) : 0, z];
    }
    if (pos && typeof pos === 'object') {
        const x = num(pos.x), z = num(pos.z);
        if (x === null || z === null) return null;
        return [x, num(pos.y) ?? 0, z];
    }
    return null;
}

function reasonOf(err) {
    return (err && err.reason) || 'unreachable';
}

/** Resolve a profile's CF Tools binding. Returns { apiId } or { error: reason }. */
export function resolveBinding(profile) {
    if (!cfg.getAppCredentials()) return { error: 'not_configured' };
    if (!profile) return { error: 'no_profile' };
    const binding = cfg.getServerBinding(profile.id);
    if (!binding || !binding.apiId) return { error: 'no_api_id' };
    return { apiId: binding.apiId, label: binding.label || null };
}

// ---- status ----

/**
 * Connection status + capabilities for the status badge / layer gating.
 * Capability-granular: a grant without GameLabs degrades the vehicle/event
 * layers, not the whole feature.
 */
export async function buildStatus(profile) {
    const bound = resolveBinding(profile);
    if (bound.error) return { connected: false, reason: bound.error };
    try {
        const { data, stale } = await cf.getServerInfo(bound.apiId);
        const server = data && data.server ? data.server : {};
        const integration = server.gameserver && server.gameserver.game_integration
            ? server.gameserver.game_integration : {};
        const capabilities = Array.isArray(integration.capabilities) ? integration.capabilities : [];
        return {
            connected: true,
            stale: !!stale,
            apiId: bound.apiId,
            nickname: (server._object && server._object.nickname) || bound.label || null,
            capabilities: {
                // GSM/session data rides on the base integration; GameLabs layers need the mod.
                gsm: integration.status !== false,
                gameLabs: capabilities.some(c => /gamelabs/i.test(String(c))),
            },
        };
    } catch (err) {
        return { connected: false, reason: reasonOf(err), apiId: bound.apiId };
    }
}

// ---- grants (settings dropdown) ----

/** Grant list for the server-binding dropdown; nickname resolved best-effort. */
export async function buildGrants() {
    if (!cfg.getAppCredentials()) return { connected: false, reason: 'not_configured', grants: [] };
    try {
        const { data } = await cf.getGrants();
        const raw = (data && data.tokens && Array.isArray(data.tokens.server)) ? data.tokens.server : [];
        const grants = raw
            .filter(g => g && g.resource && g.resource.id)
            .map(g => ({
                apiId: g.resource.id,
                identifier: g.resource.identifier || null,
                gameserverId: g.resource.gameserver_id || null,
            }));
        // Best-effort display names from /info (cached 60s; failures leave name null).
        await Promise.all(grants.map(async (g) => {
            try {
                const { data: info } = await cf.getServerInfo(g.apiId);
                g.name = (info && info.server && info.server._object && info.server._object.nickname) || null;
            } catch { g.name = null; }
        }));
        return { connected: true, grants };
    } catch (err) {
        return { connected: false, reason: reasonOf(err), grants: [] };
    }
}

// ---- live snapshot (map layers) ----

function normalizePlayer(session) {
    if (!session || typeof session !== 'object') return null;
    const gamedata = session.gamedata || {};
    const live = session.live || {};
    const persona = session.persona || {};
    return {
        sessionId: session.id || null,
        cftoolsId: session.cftools_id || null,
        name: gamedata.player_name || (persona.profile && persona.profile.name) || 'Unknown',
        steamId: gamedata.steam64 || null,
        // position may legitimately be absent (player still loading in) — the
        // marker is simply omitted while the roster row still shows.
        position: normPosition(live.position && live.position.latest),
        ping: live.ping ? num(live.ping.actual) : null,
        loaded: !!live.loaded,
        banCount: session.info ? num(session.info.ban_count) : null,
    };
}

function entityList(data) {
    if (!data || typeof data !== 'object') return [];
    if (Array.isArray(data.entities)) return data.entities;
    if (Array.isArray(data.vehicles)) return data.vehicles;
    if (Array.isArray(data.events)) return data.events;
    return [];
}

function normalizeVehicle(v) {
    if (!v || typeof v !== 'object') return null;
    const position = normPosition(v.position || v.pos);
    if (!position) return null;
    return {
        id: v.id || v.reference || null,
        className: v.classname || v.className || v.class_name || null,
        displayName: v.display_name || v.displayName || null,
        position,
        speed: num(v.speed),
        health: num(v.health),
    };
}

// Event `type` keys the icon; territory flags are split into their own layer.
function normalizeEvent(e) {
    if (!e || typeof e !== 'object') return null;
    const position = normPosition(e.position || e.pos);
    if (!position) return null;
    const className = e.classname || e.className || e.class_name || null;
    const rawType = String(e.type || e.event_type || '').toLowerCase();
    let type = rawType || null;
    if (!type && className) {
        const cn = className.toLowerCase();
        if (cn.includes('territoryflag')) type = 'territory_flag';
        else if (cn.includes('crashbase') || cn.includes('wreck')) type = 'helicrash';
        else if (cn.includes('contaminated')) type = 'contaminated_area';
    }
    return {
        id: e.id || e.reference || null,
        type: type || 'unknown',
        className,
        displayName: e.display_name || e.displayName || null,
        position,
    };
}

const isTerritory = (ev) =>
    ev.type === 'territory_flag' || (ev.className && /territoryflag/i.test(ev.className));

/**
 * Combined live snapshot for the map. `layers` is a Set/array of
 * 'players' | 'vehicles' | 'events' | 'territories'. Each requested layer
 * resolves independently: { at, stale, items } on success, { error: reason,
 * items: [] } on failure — one failing upstream never blanks the others.
 */
export async function buildLiveSnapshot(profile, layers) {
    const bound = resolveBinding(profile);
    if (bound.error) return { connected: false, reason: bound.error };
    const want = new Set(layers && layers.length ? layers : ['players', 'vehicles', 'events', 'territories']);
    const out = { connected: true, apiId: bound.apiId };

    const tasks = [];

    if (want.has('players')) {
        tasks.push(cf.getSessions(bound.apiId)
            .then(({ at, stale, data }) => {
                const sessions = (data && Array.isArray(data.sessions)) ? data.sessions : [];
                out.players = { at, stale, items: sessions.map(normalizePlayer).filter(Boolean) };
            })
            .catch((err) => { out.players = { error: reasonOf(err), items: [] }; }));
    }

    if (want.has('vehicles')) {
        tasks.push(cf.getVehicles(bound.apiId)
            .then(({ at, stale, data }) => {
                out.vehicles = { at, stale, items: entityList(data).map(normalizeVehicle).filter(Boolean) };
            })
            .catch((err) => { out.vehicles = { error: reasonOf(err), items: [] }; }));
    }

    if (want.has('events') || want.has('territories')) {
        tasks.push(cf.getEvents(bound.apiId)
            .then(({ at, stale, data }) => {
                const events = entityList(data).map(normalizeEvent).filter(Boolean);
                if (want.has('events')) {
                    out.events = { at, stale, items: events.filter(e => !isTerritory(e)) };
                }
                if (want.has('territories')) {
                    out.territories = { at, stale, items: events.filter(isTerritory) };
                }
            })
            .catch((err) => {
                if (want.has('events')) out.events = { error: reasonOf(err), items: [] };
                if (want.has('territories')) out.territories = { error: reasonOf(err), items: [] };
            }));
    }

    await Promise.all(tasks);
    return out;
}

// ---- GameLabs actions ----

// Built-in action codes drift across GameLabs versions, so resolve against the
// live action list instead of trusting the well-known CFCloud_* codes blindly —
// a missing action means the UI hides that button rather than firing a dud.
// The exact-match candidates come first (current GameLabs builds), the loose
// patterns catch renames.
const ACTION_PATTERNS = {
    teleport: [/^CFCloud_TeleportPlayer$/, /teleport/i],
    heal: [/^CFCloud_HealPlayer$/, /heal/i],
    kill: [/^CFCloud_KillPlayer$/, /(^|_)kill/i],
    spawn: [/^CFCloud_SpawnPlayerItem$/, /spawn.*item|item.*spawn/i],
};

export function resolveActionCode(actions, wanted) {
    const list = Array.isArray(actions) ? actions : [];
    const patterns = ACTION_PATTERNS[wanted] || [];
    for (const pattern of patterns) {
        const hit = list.find(a => a && pattern.test(String(a.actionCode || a.code || '')));
        if (hit) return hit.actionCode || hit.code;
    }
    return null;
}

export async function listGameLabsActions(apiId) {
    const { data } = await cf.getGameLabsActions(apiId);
    if (data && Array.isArray(data.available_actions)) return data.available_actions;
    if (data && Array.isArray(data.actions)) return data.actions;
    if (Array.isArray(data)) return data;
    return [];
}

// referenceKey for player-context actions is the player's steam64 (per the
// GameLabs spec and official SDKs) — NOT the CF Tools session id.

/** Teleport a player to world coordinates. y (height) optional — 0 lets the engine snap to ground. */
export async function teleportPlayer(apiId, steam64, { x, y, z }) {
    const code = resolveActionCode(await listGameLabsActions(apiId), 'teleport');
    if (!code) throw new cf.CfToolsError('no_grant', 'No teleport action available (is GameLabs installed?)');
    return cf.postGameLabsAction(apiId, {
        actionCode: code,
        actionContext: 'player',
        referenceKey: steam64,
        parameters: {
            vector: { dataType: 'vector', valueVectorX: x, valueVectorY: y ?? 0, valueVectorZ: z },
        },
    });
}

export async function healPlayer(apiId, steam64) {
    const code = resolveActionCode(await listGameLabsActions(apiId), 'heal');
    if (!code) throw new cf.CfToolsError('no_grant', 'No heal action available (is GameLabs installed?)');
    return cf.postGameLabsAction(apiId, { actionCode: code, actionContext: 'player', referenceKey: steam64, parameters: {} });
}

export async function killPlayer(apiId, steam64) {
    const code = resolveActionCode(await listGameLabsActions(apiId), 'kill');
    if (!code) throw new cf.CfToolsError('no_grant', 'No kill action available (is GameLabs installed?)');
    return cf.postGameLabsAction(apiId, { actionCode: code, actionContext: 'player', referenceKey: steam64, parameters: {} });
}

function spawnParameters(className, quantity) {
    return {
        item: { dataType: 'string', valueString: String(className) },
        quantity: { dataType: 'int', valueInt: quantity },
        debug: { dataType: 'boolean', valueBoolean: false },
        stacked: { dataType: 'boolean', valueBoolean: false },
    };
}

export async function spawnItem(apiId, steam64, className, quantity = 1) {
    const code = resolveActionCode(await listGameLabsActions(apiId), 'spawn');
    if (!code) throw new cf.CfToolsError('no_grant', 'No spawn action available (is GameLabs installed?)');
    return cf.postGameLabsAction(apiId, {
        actionCode: code,
        actionContext: 'player',
        referenceKey: steam64,
        parameters: spawnParameters(className, quantity),
    });
}

/**
 * Spawn a flat item list onto a player, sequentially (~300ms spacing — the
 * GameLabs order queue on the game server is processed per-tick; a burst can
 * drop orders). Returns per-item results; a failure doesn't abort the rest.
 */
export async function spawnLoadout(apiId, steam64, items, { delayMs = 300 } = {}) {
    const spawnCode = resolveActionCode(await listGameLabsActions(apiId), 'spawn');
    if (!spawnCode) throw new cf.CfToolsError('no_grant', 'No spawn action available (is GameLabs installed?)');
    const results = [];
    for (const item of items) {
        const className = typeof item === 'string' ? item : item && item.className;
        const quantity = (item && typeof item === 'object' && Number(item.quantity)) || 1;
        if (!className) continue;
        try {
            await cf.postGameLabsAction(apiId, {
                actionCode: spawnCode,
                actionContext: 'player',
                referenceKey: steam64,
                parameters: spawnParameters(className, quantity),
            });
            results.push({ className, ok: true });
        } catch (err) {
            results.push({ className, ok: false, error: reasonOf(err) });
        }
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }
    return results;
}
