/**
 * CF Tools shaping layer: turns raw Data API payloads into the stable,
 * minimal shapes the frontend consumes, and owns the degradation story.
 *
 * House style: reads never 5xx. Every builder returns a shape with
 * `connected` and, when false, a `reason` from the shared vocabulary:
 * not_configured | no_api_id | no_profile | auth_failed | no_grant |
 * rate_limited | unreachable | mod_offline | mod_no_ai.
 *
 * The last two belong to layers sourced from the companion mod rather than from CF
 * Tools, so they describe the mod's reachability, not the Data API's.
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
// Mod wire-format sentinel handling is shared with the history recorder so the
// live and stored views of a snapshot can never disagree about what "unknown" is.
import { num, modStat, modStr, modAlive, normPosition, looksSteam64 } from './mod-wire.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
 *
 * modStat / modStr / modAlive (the -1 and "" sentinel collapses) live in
 * ./mod-wire.js — shared with the history recorder.
 */
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

// The marker label, which for a territory flag is the whole enriched tooltip and
// therefore the only channel the territory detail arrives on. GameLabs uploads it as
// `displayName` (`_ServerEvent` in Scripts/3_Game/API/definitions.c); the Data API is
// snake_case elsewhere, so `display_name` is the other likely spelling. `name` /
// `label` / `title` are accepted last because `_ServerEvent` has no field by those
// names — if one shows up it can only be this one renamed.
const eventLabel = (e) =>
    e.display_name || e.displayName || e.name || e.label || e.title || null;

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
        displayName: eventLabel(e),
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
    const raw = ev.displayName;
    const parsed = parseTerritoryTooltip(raw);
    if (!parsed) {
        // Nothing labelled to parse, but the label may still be markup — GameLabs' own
        // baseline flag marker emits <b>/<br/> too. Flatten it to its first plain line
        // so the marker title and panel heading never render tags as text.
        if (raw && /[<&]/.test(raw)) ev.displayName = tooltipLines(raw)[0] || null;
        return ev;
    }
    ev.territory = parsed;
    if (parsed.name) ev.displayName = parsed.name;
    ev.origin = 'gamelabs';
    return ev;
}

// ---- companion-mod territories ----
//
// Two sources now feed the territories layer: the GameLabs tooltip parsed above, and
// `territories[]` on the companion mod's /ingest/snapshot.
//
// The mod wins per-field. The tooltip is a lossy, config-gated, string-formatted
// projection of the same state — territory_show_uids strips steam64s,
// territory_show_members drops the roster entirely, territory_max_members truncates
// it, and it exists at all only if spacecat_gamelabs_compat_expansion is installed AND
// ordered correctly. The mod reads the territory modules in-process on the game server.
// Where both have a value the mod's is at least as good; where the mod has none the
// tooltip may still know, hence field-level fill rather than wholesale replacement.

const TERRITORY_JOIN_EPS_M = 5;

function normModTerritoryMember(m) {
    if (!m || typeof m !== 'object') return null;
    const id = modStr(m.id);
    const steamId = modStr(m.steamId) || (looksSteam64(id) ? id : null);
    return {
        id,
        name: modStr(m.name),
        steamId,
        rank: modStr(m.rank),
        permissions: modStat(m.permissions),
        permissionNames: Array.isArray(m.permissionNames)
            ? m.permissionNames.map(modStr).filter(Boolean)
            : [],
        online: modAlive(m.online),
    };
}

// Returns a full LiveEvent-shaped row, so an unmatched mod territory can be appended
// to the layer directly rather than needing a second shape downstream.
function normModTerritory(t) {
    if (!t || typeof t !== 'object') return null;
    // normPosition, NOT normSessionPosition: the mod sends world [x, y, z] while CF
    // Tools GSM sessions send [x, z, height]. Mixing them up puts every row on the
    // wrong axis, which looks entirely plausible on a square map.
    const position = normPosition(t.pos || t.position);
    if (!position) return null; // same drop rule as vehicles and events

    const members = Array.isArray(t.members)
        ? t.members.map(normModTerritoryMember).filter(Boolean)
        : [];
    const name = modStr(t.name);
    const refresher = modStat(t.refresher01);

    const info = {
        // Every key LiveTerritoryInfo declares is present (null when unknown), so no
        // panel consumer can trip over an undefined members array.
        name,
        // The tooltip reports whole percent; refresher01 is 0..1. Convert so both
        // sources land in the same unit.
        flagLevel: refresher === null ? null : Math.round(refresher * 100),
        lifetimeHours: null, // the mod does not compute this; the tooltip may still know
        owner: t.ownerId || t.ownerName || t.ownerSteamId
            ? normModTerritoryMember({
                id: t.ownerId, name: t.ownerName, steamId: t.ownerSteamId, permissions: -1,
            })
            : null,
        territoryId: modStat(t.territoryId),
        level: modStat(t.level),
        memberCount: modStat(t.memberCount) ?? members.length,
        members,
        // The mod sends the whole roster up to its own cap and reports truncation
        // separately; there is no tooltip-style "and N more" line to carry over.
        membersOmitted: 0,
        // mod-only
        objectCount: modStat(t.objects),
        cargoCount: modStat(t.cargo),
        radius: modStat(t.radius),
        scanAge: modStat(t.scanAge),
        membersTruncated: modAlive(t.membersTruncated) === true,
        source: modStr(t.system) || 'unknown',
    };

    const key = modStr(t.key);
    return {
        // Prefixed because GameLabs event ids and the mod's flag keys are unrelated
        // identifiers from different mods — without this they could collide in the
        // marker keyspace.
        id: `mod:${key || `${Math.round(position[0])}:${Math.round(position[2])}`}`,
        type: 'territory_flag',
        className: modStr(t.cls) || 'TerritoryFlag',
        displayName: name,
        position,
        origin: 'mod',
        territory: info,
    };
}

// null when the mod carries no territory source at all (key absent), which is a
// different claim from an empty array ("a source ran and found no flags").
function modTerritoryRows() {
    const snap = ingest.getSnapshot().data;
    if (!snap || !Array.isArray(snap.territories)) return null;
    return snap.territories.map(normModTerritory).filter(Boolean);
}

/**
 * Join mod rows onto GameLabs rows by position, then merge field-by-field.
 *
 * Position is the only join available: the GameLabs `_ServerEvent.id` and the mod's
 * flag key are unrelated handles from different mods. Flags do not move, so this is
 * stable — the same reasoning that makes the spawn ledger's SPAWN_EPS_M work. The
 * epsilon is larger here (5 m vs 2 m) because this compares two INDEPENDENT observers
 * of one object rather than one observer against itself over time, and it is still far
 * below the minimum spacing any territory mod enforces, so it cannot cross-assign
 * neighbouring flags.
 */
function mergeModTerritories(glItems, modRows) {
    // Score every candidate pair, then consume greedily nearest-first, so two adjacent
    // flags cannot both claim the same mod row.
    const pairs = [];
    for (let gi = 0; gi < glItems.length; gi++) {
        for (let mi = 0; mi < modRows.length; mi++) {
            const dx = glItems[gi].position[0] - modRows[mi].position[0];
            const dz = glItems[gi].position[2] - modRows[mi].position[2];
            const d2 = dx * dx + dz * dz;
            if (d2 <= TERRITORY_JOIN_EPS_M * TERRITORY_JOIN_EPS_M) pairs.push({ gi, mi, d2 });
        }
    }
    pairs.sort((a, b) => a.d2 - b.d2);

    const usedGl = new Set();
    const usedMod = new Set();
    for (const { gi, mi } of pairs) {
        if (usedGl.has(gi) || usedMod.has(mi)) continue;
        usedGl.add(gi);
        usedMod.add(mi);

        const ev = glItems[gi];
        const modInfo = modRows[mi].territory;
        const merged = { ...(ev.territory || {}) };
        for (const k of Object.keys(modInfo)) {
            if (modInfo[k] !== null && modInfo[k] !== undefined) merged[k] = modInfo[k];
        }
        // The mod's roster is complete, so it replaces wholesale rather than merging
        // element-wise — and that invalidates the tooltip's display-cap remainder,
        // which would otherwise claim "and N more" on top of a full list.
        if (modInfo.members.length) {
            merged.members = modInfo.members;
            merged.membersOmitted = 0;
        }
        ev.territory = merged;
        ev.origin = 'mixed';
        if (modInfo.name) ev.displayName = modInfo.name;
    }

    // Unmatched mod rows become markers of their own.
    //
    // This deliberately breaks the "never create rows" rule that enrichFromMod follows,
    // and the difference is not an inconsistency. That rule exists because the PLAYERS
    // layer has an authoritative roster (CF Tools sessions) and a phantom player row is
    // a false claim about who is online, with destructive admin actions (kick, ban,
    // teleport) hanging off its steam64. Territories have no authoritative roster: the
    // GameLabs feed is itself best-effort and only exists if that mod is installed and
    // enriching. A flag reported by the server-side mod is read from the territory
    // module in-process, which is strictly closer to the source than a tooltip string
    // round-tripped through GameLabs → CF Tools Cloud → our parser. And a territory
    // marker exposes no destructive per-entity action. Creating rows is correct here
    // and was not there — please don't "restore consistency" by removing this.
    const extra = modRows.filter((_, mi) => !usedMod.has(mi));
    return glItems.concat(extra);
}

/**
 * The single place that decides the territories layer's shape. Called from both the
 * success and failure paths of the GameLabs events fetch.
 */
function buildTerritoryLayer({ glItems, at, stale, glError }) {
    // Mirrors enrichFromMod's first line: a stale mod contributes nothing anywhere, so
    // a mod restart can never blank tooltip-sourced detail.
    const modRows = ingest.modConnected() ? modTerritoryRows() : null;

    if (!modRows || !modRows.length) {
        return glError ? { error: glError, items: [] } : { at, stale, items: glItems };
    }

    const items = mergeModTerritories(glItems, modRows);

    if (glError) {
        // GameLabs is gone but the mod is not. The layer HAS data, so it must not carry
        // `error` — the UI reads that as "empty, show unavailable". Report provenance.
        return { at: ingest.getSnapshot().at, stale: false, items, source: 'mod' };
    }
    return {
        at,
        stale,
        items,
        source: items.some(i => i.origin !== 'gamelabs') ? 'mixed' : 'gamelabs',
    };
}

// ---- companion-mod AI ----

function normModAi(a) {
    if (!a || typeof a !== 'object') return null;
    const position = normPosition(a.pos || a.position); // world [x,y,z] — see normModTerritory
    if (!position) return null;
    const className = modStr(a.cls) || null;
    const handItem = modStr(a.hands);
    const detail = handItem ? ingest.getTypeDetail(handItem) : null;
    return {
        id: modStr(a.id),
        name: modStr(a.name) || className || 'AI',
        className,
        faction: modStr(a.faction),
        group: modStr(a.group),
        groupId: modStat(a.groupId),
        position,
        health: modStat(a.health),
        blood: modStat(a.blood),
        shock: modStat(a.shock),
        energy: modStat(a.energy),
        water: modStat(a.water),
        alive: modAlive(a.alive),
        handItem,
        handItemLabel: (detail && detail.displayName) || null,
        source: modStr(a.source) || 'unknown',
    };
}

/**
 * The AI layer, whose ONLY source is the mod.
 *
 * That makes staleness behave differently from every other mod-fed field: for players
 * the mod merely enriches, so going stale means "stop overwriting". Here it must CLEAR
 * the layer — holding the last known list would paint permanent ghost markers across
 * the map after the game server restarts.
 */
function buildAiLayer() {
    if (!ingest.modConnected()) return { error: 'mod_offline', items: [] };
    const { data, at } = ingest.getSnapshot();
    // Key absent = AI collection is switched off mod-side. Distinct from an empty
    // array, which means detection ran and genuinely found none.
    if (!data || !Array.isArray(data.ai)) return { error: 'mod_no_ai', items: [] };
    return { at, stale: false, items: data.ai.map(normModAi).filter(Boolean) };
}

// ---- companion-mod world clock ----

/**
 * The sentinel the mod sends for "WorldData was not up yet" on `server.temperature`.
 *
 * Temperature is the one numeric on the ingest wire whose valid range spans zero, so
 * it CANNOT go through modStat: that collapses every negative to null, which would
 * silently discard every reading on a winter map. Compare against the sentinel.
 */
const MOD_TEMP_UNKNOWN = -999;

const modTemp = (v) => {
    const n = num(v);
    return n === null || n <= MOD_TEMP_UNKNOWN + 1 ? null : n;
};

/**
 * In-game clock, calendar date and ambient temperature, from the companion mod's
 * heartbeat. CF Tools has no equivalent — none of this is in the Data API — so this
 * block is mod-only and simply absent when the mod is not reporting.
 *
 * Every field is independently nullable rather than the whole block being all-or-
 * nothing: an older mod build sends the date and no temperature, and dropping the
 * clock because of that would be a regression for anyone who has not redeployed.
 */
function buildWorldInfo() {
    if (!ingest.modConnected()) return { error: 'mod_offline' };
    const { data, at } = ingest.getSnapshot();
    const srv = data && typeof data.server === 'object' ? data.server : null;
    if (!srv) return { error: 'mod_offline' };

    // Hour and minute are 0-based, so modStat's "negative is unknown" rule holds, but
    // its treatment of 0 must not: midnight is 00:00 and the zeroth minute is real.
    const hour = modStat(srv.hour);
    const minute = modStat(srv.minute);
    // Month and day are 1-based; a 0 is a value the engine cannot produce, so it is
    // as much an absence as a negative is.
    const month = modStat(srv.month) || null;
    const day = modStat(srv.day) || null;
    return {
        at,
        // Only a complete h:m pair is a clock. Half of one is a wrong time on screen.
        time: hour === null || minute === null ? null : { hour, minute },
        // Same all-or-nothing rule as the clock, and for the same reason. The year is
        // allowed to be missing on its own: month/day is a renderable date, and the
        // in-game year is the least interesting part of it.
        date: month === null || day === null ? null : { year: modStat(srv.year), month, day },
        temperature: modTemp(srv.temperature),
    };
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
 * 'players' | 'vehicles' | 'events' | 'territories' | 'ai'. Each requested layer
 * resolves independently: { at, stale, items } on success, { error: reason,
 * items: [] } on failure — one failing upstream never blanks the others.
 *
 * 'ai' is the first layer with no CF Tools upstream at all: it comes wholly from the
 * companion mod's snapshot, and degrades with mod_offline / mod_no_ai.
 */
export async function buildLiveSnapshot(profile, layers) {
    const bound = resolveBinding(profile);
    if (bound.error) return { connected: false, reason: bound.error };
    const want = new Set(layers && layers.length
        ? layers
        : ['players', 'vehicles', 'events', 'territories', 'ai']);
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
                    out.territories = buildTerritoryLayer({
                        glItems: events.filter(isTerritory).map(enrichTerritory), at, stale,
                    });
                }
            })
            .catch((err) => {
                if (want.has('events')) out.events = { error: reasonOf(err), items: [] };
                // The mod can carry this layer on its own, so a dead GameLabs upstream
                // is not necessarily an empty layer.
                if (want.has('territories')) {
                    out.territories = buildTerritoryLayer({ glItems: [], glError: reasonOf(err) });
                }
            }));
    }

    // Mod-sourced only — no CF Tools upstream to fail, hence no try/catch.
    if (want.has('ai')) {
        out.ai = buildAiLayer();
    }

    // Not a layer and not layer-gated: the world clock is chrome on the toolbar, not
    // something plotted on the map, so it does not appear in `layers` and cannot be
    // toggled off.
    out.world = buildWorldInfo();

    await Promise.all(tasks);
    return out;
}

// ---- raw payload diagnostic ----

/**
 * The untouched upstream GameLabs payload for one entity kind.
 *
 * Every normalisation step here is a guess about field names that CF Tools does not
 * document — `_ServerEvent` (GameLabs' own upload struct) is camelCase, the Data API
 * is snake_case elsewhere, and a rename anywhere in between silently empties a layer:
 * an unrecognised envelope key yields no entities at all, an unrecognised position
 * drops each entity, and an unrecognised label strips the territory tooltip that the
 * whole territory panel is parsed from. All three look identical from the map.
 *
 * So report the shape rather than infer it. `envelopeKeys` and `keys` answer "what is
 * it actually called" in one request; `entities` carries the first `limit` verbatim.
 * Entity telemetry only — no credentials are in this payload.
 */
export async function buildRawEntities(profile, kind, limit) {
    const bound = resolveBinding(profile);
    if (bound.error) return { connected: false, reason: bound.error };
    try {
        const { at, stale, data } = kind === 'vehicles'
            ? await cf.getVehicles(bound.apiId)
            : await cf.getEvents(bound.apiId);
        const entities = entityList(data);
        const keys = [...new Set(entities.flatMap(
            e => (e && typeof e === 'object') ? Object.keys(e) : [],
        ))].sort();
        return {
            connected: true,
            at,
            stale: !!stale,
            // Empty when `entityList` found no array it recognises — i.e. the envelope
            // itself was renamed, which is the one failure that yields zero markers.
            envelopeKeys: (data && typeof data === 'object') ? Object.keys(data) : [],
            count: entities.length,
            keys,
            entities: entities.slice(0, limit),
        };
    } catch (err) {
        return { connected: false, reason: reasonOf(err) };
    }
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
