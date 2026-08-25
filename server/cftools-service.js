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

import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import * as cf from './cftools-client.js';
import * as cfg from './cftools-config.js';
import * as ingest from './ingest-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
        // GameLabs detection: the authoritative signal is the actions list — the
        // Data API documents it as empty iff the GameLabs mod is not installed.
        // The /info capability strings don't reliably mention GameLabs (observed
        // live: a server with GameLabs connected and no matching string), so they
        // are only the fallback when the actions probe itself fails. Cached 300s.
        let gameLabs;
        try {
            gameLabs = (await listGameLabsActions(bound.apiId)).length > 0;
        } catch {
            const capabilities = Array.isArray(integration.capabilities) ? integration.capabilities : [];
            gameLabs = capabilities.some(c => /gamelabs/i.test(String(c)));
        }
        return {
            connected: true,
            stale: !!stale,
            apiId: bound.apiId,
            nickname: (server._object && server._object.nickname) || bound.label || null,
            capabilities: {
                // GSM/session data rides on the base integration; GameLabs layers need the mod.
                gsm: integration.status !== false,
                gameLabs,
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

// CF Tools vectors are (x, z, height) on the wire — GSM session positions and
// GameLabs vector params alike (verified live: [4361, 8188, 22.7] on Deer Isle,
// and the mod's GetVector() reads worldZ from the second slot). Reorder
// 3-element session positions to the app's [x, height, z].
function normSessionPosition(raw) {
    if (Array.isArray(raw) && raw.length >= 3) {
        return normPosition([raw[0], raw[2], raw[1]]);
    }
    return normPosition(raw);
}

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
        position: normSessionPosition(live.position && live.position.latest),
        // The GameLabs mod collects per-player health and item-in-hands
        // (_ServerPlayerEx: health, item) and POSTs them to api.gamelabs.cloud,
        // but that is one-way: the public Data API exposes no player entities
        // route (probed 2026-08: /GameLabs/entities/players 404s) and GSM
        // sessions omit both. Extract opportunistically anyway so the UI lights
        // up if CF Tools ever surfaces them; enrichFromMod() is what actually
        // fills these in today.
        health: num(live.health),
        handItem: (typeof live.item === 'string' && live.item) || null,
        handItemLabel: null,
        // Companion-mod only (CF Tools carries none of these) — see enrichFromMod.
        blood: null,
        shock: null,
        energy: null,
        water: null,
        alive: null,
        ping: live.ping ? num(live.ping.actual) : null,
        loaded: !!live.loaded,
        banCount: session.info ? num(session.info.ban_count) : null,
    };
}

/**
 * Fill health / item-in-hands from the companion mod's `/ingest/snapshot`.
 *
 * The mod snapshot is the only source of these: CF Tools' Data API carries
 * neither (see normalizePlayer). CF Tools stays the roster — identity, session,
 * ping, bans, position — and this only enriches rows that already exist, so a
 * snapshot player with no matching session never becomes a phantom marker.
 *
 * Join key is steam64: the mod sends `PlayerIdentity.GetPlainId()`, the same
 * value CF Tools reports as `gamedata.steam64`. In-game name is the fallback
 * for rows where CF Tools has no steam64 yet (still authenticating).
 */
// The mod's StatValue() returns -1 for a stat the engine doesn't declare, which
// is "unknown", not a reading — collapse it (and any other negative) to null.
const modStat = (v) => {
    const n = num(v);
    return n === null || n < 0 ? null : n;
};

// The mod declares `alive` as an Enforce `bool`, but its JsonSerializer emits
// bools as 1/0 — hence the `integer, enum [0,1]` in openapi-ingest.json (same
// quirk buildCatalogDetail works around for the catalog's boolean flags).
// Accept true/false too in case that ever changes, and only claim knowledge
// when the field is actually present.
function modAlive(v) {
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    return null;
}

function enrichFromMod(players) {
    // A stale or absent mod must not blank fields CF Tools might have set.
    if (!ingest.modConnected()) return players;
    const snap = ingest.getSnapshot().data;
    const modPlayers = snap && Array.isArray(snap.players) ? snap.players : [];
    if (!modPlayers.length) return players;

    const byId = new Map();
    const byName = new Map();
    for (const mp of modPlayers) {
        if (!mp || typeof mp !== 'object') continue;
        const id = mp.steamId || mp.id;
        if (id) byId.set(String(id), mp);
        if (mp.name) byName.set(String(mp.name).toLowerCase(), mp);
    }

    for (const p of players) {
        const mp = (p.steamId && byId.get(String(p.steamId)))
            || (p.name && byName.get(String(p.name).toLowerCase()));
        if (!mp) continue;
        const alive = modAlive(mp.alive);
        // CF Tools wins if it ever starts carrying these; the mod fills the gap.
        if (p.health === null) p.health = modStat(mp.health);
        if (p.handItem === null && alive !== false) {
            p.handItem = (typeof mp.hands === 'string' && mp.hands) || null;
        }
        // Mod-only stats: nothing upstream can supply these, so assign directly.
        p.blood = modStat(mp.blood);
        p.shock = modStat(mp.shock);
        p.energy = modStat(mp.energy);
        p.water = modStat(mp.water);
        p.alive = alive;
        if (p.handItem && !p.handItemLabel) {
            const detail = ingest.getTypeDetail(p.handItem);
            p.handItemLabel = (detail && detail.displayName) || null;
        }
    }
    return players;
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
        // Heli crash sites are bare Wreck_* (Wreck_UH1Y/UH60/Mi8*) or CrashBase;
        // Land_Wreck_* cars and StaticObj_Wreck_Train_* are ordinary wrecks.
        else if (cn.startsWith('wreck_') || cn.includes('crashbase') || cn.includes('helicrash')) type = 'helicrash';
        else if (cn.includes('wreck')) type = 'wreck';
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

// ---- territory tooltip parsing ----
//
// spacecat_gamelabs (the @CW_Gamelabs replacement) takes over each territory flag's
// GameLabs marker and gives it an enriched HTML tooltip, built in SGL_TerritoryFlag.c:
//
//   <b>Northwood</b><br/>Flag Level: 87 %<br/>Remaining Lifetime: ~ 41 hours<br/>
//   Owner: PlayerOne (76561198000000000)<br/>
//   Territory: #4 &middot; Level 2 &middot; 3 member(s)<br/>
//   <b>Members</b>:<br/>&nbsp;&nbsp;PlayerTwo (76561198000000001) - Moderator
//
// That whole string arrives verbatim as the event's display_name, so without this the
// panel renders a wall of markup. Parsing is deliberately best-effort: unrecognised
// lines are skipped, and a tooltip that yields nothing returns null so the event is
// left exactly as it is. A flag still showing GameLabs' own baseline marker, or a
// future wording change in the mod, therefore degrades to the old behaviour instead
// of blanking the panel.
//
// The mod escapes player- and territory-supplied text (SGL_Text.EscapeHtml) because
// the panel renders this as HTML, so decoding entities here is required to get the
// original names back.

const HTML_ENTITIES = [
    ['&lt;', '<'],
    ['&gt;', '>'],
    ['&quot;', '"'],
    ['&#39;', "'"],
    ['&nbsp;', ' '],
    ['&middot;', '\u00b7'],
];

function decodeEntities(s) {
    let out = String(s);
    for (const [entity, ch] of HTML_ENTITIES) out = out.split(entity).join(ch);
    // '&amp;' last: decoding it first would turn a literal '&amp;lt;' into '<'.
    return out.split('&amp;').join('&');
}

// Split the tooltip into plain-text lines: <br/> is the separator, every other tag is
// dropped, entities are decoded and runs of whitespace collapse (the &nbsp; roster
// indent is presentational — roster membership is tracked by position instead).
function tooltipLines(html) {
    return String(html)
        .split(/<br\s*\/?>/i)
        .map(seg => decodeEntities(seg.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

const RE_FLAG_LEVEL = /^Flag Level:\s*([\d.]+)\s*%$/i;
const RE_LIFETIME = /^Remaining Lifetime:\s*~?\s*([\d.]+)\s*hours?$/i;
const RE_TERRITORY = /^Territory:\s*#(\d+)\s*\u00b7\s*Level\s*(\d+)\s*\u00b7\s*(\d+)\s*member\(s\)$/i;
const RE_OWNER = /^Owner:\s*(.+)$/i;
const RE_MEMBERS_HEAD = /^Members:\s*(.*)$/i;
const RE_MEMBER = /^(.*?)\s+-\s+(Admin|Moderator|Member)$/i;
const RE_MORE = /^\.\.\.\s*and\s+(\d+)\s+more$/i;

const finite = (v) => (Number.isFinite(v) ? v : null);

// "Name (76561198000000000)" | "76561198000000000" | "Name". Which of the three you get
// depends on territory_show_uids and on whether Expansion knows the player's name.
function parsePlayerRef(raw) {
    const s = String(raw).trim();
    const withUid = /^(.*?)\s*\((\d{5,25})\)$/.exec(s);
    if (withUid) return { name: withUid[1].trim() || null, steamId: withUid[2] };
    if (/^\d{5,25}$/.test(s)) return { name: null, steamId: s };
    return { name: s || null, steamId: null };
}

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/**
 * Parse an enriched territory tooltip into structured fields, or null when the string
 * carries nothing recognisable. Exported for tests; callers use enrichTerritory.
 */
export function parseTerritoryTooltip(html) {
    if (!html || typeof html !== 'string') return null;
    const lines = tooltipLines(html);
    if (!lines.length) return null;

    const out = {
        name: null,
        flagLevel: null,
        lifetimeHours: null,
        owner: null,
        territoryId: null,
        level: null,
        // Expansion's own count — includes the owner, and is unaffected by the
        // territory_max_members display cap, so it can exceed members.length.
        memberCount: null,
        members: [],
        membersOmitted: 0,
    };
    let inRoster = false;
    // Counts only the LABELLED lines. A bare name is not enough to call something an
    // enriched tooltip — otherwise an ordinary marker label parses into an all-null
    // object that the panel would render as an empty block.
    let matched = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let m;

        if ((m = RE_MEMBERS_HEAD.exec(line))) {
            matched++;
            // "<b>Members</b>: none" flattens to "Members: none" — header, but no roster.
            inRoster = !/^none$/i.test(m[1].trim());
            continue;
        }
        if (inRoster) {
            if ((m = RE_MORE.exec(line))) { out.membersOmitted = Number(m[1]); continue; }
            if ((m = RE_MEMBER.exec(line))) {
                out.members.push({ ...parsePlayerRef(m[1]), rank: titleCase(m[2]) });
            }
            // Anything else inside the roster is skipped rather than guessed at.
            continue;
        }
        if ((m = RE_FLAG_LEVEL.exec(line))) { out.flagLevel = finite(Number(m[1])); matched++; continue; }
        if ((m = RE_LIFETIME.exec(line))) { out.lifetimeHours = finite(Number(m[1])); matched++; continue; }
        if ((m = RE_TERRITORY.exec(line))) {
            out.territoryId = finite(Number(m[1]));
            out.level = finite(Number(m[2]));
            out.memberCount = finite(Number(m[3]));
            matched++;
            continue;
        }
        if ((m = RE_OWNER.exec(line))) { out.owner = parsePlayerRef(m[1]); matched++; continue; }
        // The first line is the territory name (bold in the source markup). Only claimed
        // when it matched none of the labelled patterns above.
        if (i === 0) out.name = line;
    }

    return matched ? out : null;
}

// Attach the parsed tooltip and replace displayName with the plain territory name, so
// every existing consumer (marker title, panel heading, GameLabs action label) reads
// cleanly without each having to know about the markup.
function enrichTerritory(ev) {
    const parsed = parseTerritoryTooltip(ev.displayName);
    if (!parsed) return ev;
    ev.territory = parsed;
    if (parsed.name) ev.displayName = parsed.name;
    return ev;
}

// ---- spawn ledger ----
//
// No server log records tracked-item spawns with positions (verified against
// the staging ADM/RPT/script/EventManager/GameLabs logs), but CW_Gamelabs
// registers each item with GameLabs ~100ms after the entity spawns — so the
// FIRST position this backend ever observes for an event id IS its spawn
// position. An event whose current position has left that spot was picked up,
// dropped elsewhere, or stored (including untracked base chests the anchor
// heuristic can't see). Ledger persists across backend restarts; entries prune
// when a FRESH events payload no longer contains the id (entity despawned, or
// the game server restarted and network ids rolled over).
//
// Limit: items that spawned before Lootmaster first polled are ledgered at
// wherever they were first seen — a pre-existing moved item reads "at spawn".

// eslint-disable-next-line no-undef
const SPAWNS_FILE = process.env.CFTOOLS_SPAWNS_FILE
    // eslint-disable-next-line no-undef
    ? resolve(process.env.CFTOOLS_SPAWNS_FILE)
    : resolve(join(__dirname, '.cache', 'cftools-spawns.json'));

// eslint-disable-next-line no-undef
const SPAWNS_PERSIST_DISABLED = !!process.env.VITEST || process.env.NODE_ENV === 'test';

const SPAWN_EPS_M = 2; // horizontal metres; loot settles but does not drift

let spawnLedger = {}; // { [apiId]: { [eventId]: { x, z, at } } }
let ledgerLoaded = false;

async function ensureLedgerLoaded() {
    if (ledgerLoaded) return;
    ledgerLoaded = true;
    if (SPAWNS_PERSIST_DISABLED) return;
    try {
        const parsed = JSON.parse(await readFile(SPAWNS_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object') spawnLedger = parsed;
    } catch { /* nothing saved yet */ }
}

let ledgerSaveTimer = null;
function persistLedger() {
    if (SPAWNS_PERSIST_DISABLED) return;
    if (ledgerSaveTimer) return;
    ledgerSaveTimer = setTimeout(async () => {
        ledgerSaveTimer = null;
        // eslint-disable-next-line no-undef
        const tmp = `${SPAWNS_FILE}.tmp-${process.pid}-${crypto.randomUUID()}`;
        try {
            await mkdir(dirname(SPAWNS_FILE), { recursive: true });
            await writeFile(tmp, JSON.stringify(spawnLedger), 'utf8');
            await rename(tmp, SPAWNS_FILE);
        } catch {
            try { await rm(tmp, { force: true }); } catch { /* ignore */ }
        }
    }, 2000);
}

/**
 * Record first-seen positions and annotate each event with `moved` (left its
 * spawn spot) and `spawnPosition`. Prunes vanished ids only on fresh payloads —
 * a stale-served snapshot must not wipe the ledger.
 */
function applySpawnLedger(apiId, events, fresh) {
    const book = spawnLedger[apiId] || (spawnLedger[apiId] = {});
    const seen = new Set();
    let dirty = false;
    for (const e of events) {
        if (!e.id) continue;
        seen.add(e.id);
        let entry = book[e.id];
        if (!entry) {
            entry = book[e.id] = { x: e.position[0], z: e.position[2], at: Date.now() };
            dirty = true;
        }
        e.moved = Math.abs(e.position[0] - entry.x) > SPAWN_EPS_M
            || Math.abs(e.position[2] - entry.z) > SPAWN_EPS_M;
        e.spawnPosition = [entry.x, 0, entry.z];
    }
    if (fresh) {
        for (const id of Object.keys(book)) {
            if (!seen.has(id)) { delete book[id]; dirty = true; }
        }
    }
    if (dirty) persistLedger();
    return events;
}

/** Test seam: reset the in-memory ledger (persistence is disabled under tests). */
export function _resetSpawnLedger() {
    spawnLedger = {};
    ledgerLoaded = true;
}

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
                out.players = {
                    at, stale,
                    items: enrichFromMod(sessions.map(normalizePlayer).filter(Boolean)),
                };
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
            .then(async ({ at, stale, data }) => {
                await ensureLedgerLoaded();
                const events = applySpawnLedger(
                    bound.apiId, entityList(data).map(normalizeEvent).filter(Boolean), !stale,
                );
                if (want.has('events')) {
                    out.events = { at, stale, items: events.filter(e => !isTerritory(e)) };
                }
                if (want.has('territories')) {
                    out.territories = { at, stale, items: events.filter(isTerritory).map(enrichTerritory) };
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
            // GameLabs GetVector(): worldX = valueVectorX, worldZ = valueVectorY,
            // height = valueVectorZ (0 → SurfaceY snap). NOT the world x/y/z order.
            vector: { dataType: 'vector', valueVectorX: x, valueVectorY: z, valueVectorZ: y ?? 0 },
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
