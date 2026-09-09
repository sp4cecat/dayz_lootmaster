/**
 * ADM log parsing for the history importer.
 *
 * DayZ's admin log is the only record of a server that existed before the
 * companion mod did. It is far coarser than the mod's 5 s stream, but with
 * `adminLogPlayerList = 1` the engine writes a full player roster with positions
 * every ~5 minutes, and that is enough to reconstruct a movement track.
 *
 * This module is pure text -> objects. It performs no IO and touches no database
 * so the line grammar can be tested against real log samples directly.
 *
 * ## The two hard parts
 *
 * **Identity.** ADM records `PlayerIdentity.GetId()` — a base64url BI GUID like
 * `roLHvHBcEudumxXQEox9rgUBaeM2dY_y9qFxHrgo7o0=`. The mod's snapshot records
 * `GetPlainId()`, the steam64. They are different identity spaces and will never
 * join on their own; resolution happens in adm-import.js via the mod's own GUID
 * ledger. This module just reports the GUID it found.
 *
 * **Time.** Lines carry a wall clock ("17:56:45") with no date and no zone. The
 * date comes from the file header; the zone is a server property the user
 * supplies (see log-clock.js), and detectOffsetMinutes below infers a candidate
 * from the file's own timestamps so that choice can be checked rather than
 * trusted.
 */

import { createDayCounter, wallToMs } from './log-clock.js';

/** `AdminLog started on 2025-01-04 at 17:50:50` — the only date inside the file. */
const HEADER_RE = /AdminLog started on (\d{4})-(\d{2})-(\d{2}) at (\d{1,2}):(\d{2}):(\d{2})/;

/**
 * One player reference: `Player "name" (DEAD) (id=GUID pos=<x, z, y>)`.
 *
 * Both the leading space before `(id=` and the `pos=` block are optional — connect
 * and disconnect lines write `Player "name"(id=GUID)` with neither. The capture
 * groups are, in order: name, DEAD marker, guid, x, z, y.
 *
 * Note the coordinate order. DayZ writes `pos=<easting, northing, elevation>`,
 * which in this codebase's axis names is <x, z, y> — y is the vertical. Verified
 * against real Banov logs, where the third value never leaves 190-570 while the
 * first two range across the full 12800 m map.
 */
const PLAYER_RE = new RegExp(
    'Player "([^"]*)"\\s*(\\(DEAD\\)\\s*)?\\(id=([^\\s)]+)'
    + '(?:\\s+pos=<\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*>)?\\)',
);

/** PLAYER_RE pinned to the start of a tail, for "who did it" positions. */
const PLAYER_AT_START_RE = new RegExp('^\\s*' + PLAYER_RE.source);

/**
 * An Expansion AI reference: `AI "Name" (group=6 faction="Mercenaries" pos=<x, z, y>)`.
 *
 * Same shape as a player reference but with no `id=`, so PLAYER_RE never matches
 * it and a bot's shots would otherwise fall through to the bare-ammo branch as an
 * unrecognised tail. Bots have no GUID and never become a pid; the name and
 * position are kept so the feed can say which one it was. Captures: name, x, z, y.
 */
const AI_RE = new RegExp(
    '^\\s*AI "([^"]*)"\\s*\\([^)]*?pos=<\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*>\\)',
);

/**
 * The damage clause every positioned hit carries:
 * `into LeftArm(18) for 102.351 damage (Bullet_762x39)`.
 *
 * The zone can be empty (`into (-1)` — a hit that resolved no component, seen on
 * modded melee and tripwires), so the name group is `\w*` not `\w+`. Captures:
 * zone, component, damage, ammo.
 */
const HIT_MSG_RE = /^\s*into (\w*)\((-?\d+)\) for (-?[\d.]+) damage(?: \(([^)]*)\))?/;

/**
 * The optional weapon clause: `with IZH-18 from 18.8819 meters ` (ranged) or
 * `with Skull Staff - Basic` (melee, no range).
 *
 * Weapon names are DISPLAY names — they carry spaces, hyphens, quotes
 * (`B950 'Blaze'`) and the engine leaves a trailing space after `meters`. So the
 * name is taken lazily and the clause is anchored at end-of-line on a numeric
 * range, which is the only part of it with a fixed shape.
 */
const WITH_RE = /^\s*with (.+?)(?: from (-?[\d.]+) meters)?\s*$/;

/** `explosion (GasCanister_Ammo)` — no attacker, the ammo says what went off. */
const EXPLOSION_RE = /^\s*explosion \(([^)]*)\)\s*$/;

/**
 * `<parent> with <ammo>` — damage from a world object rather than a creature:
 * `Fireplace with FireDamage`, `Boat_01_Blue with TransportHit`, `BBP_Bwall with
 * BarbedWireHit`. The parent is a config class; there is no zone or damage figure.
 */
const AREA_RE = /^\s*(\S+) with (\S+)\s*$/;

/** `<display> into …` — a creature by display name (`Infected`, `Brown Bear`, `Dog`). */
const NAMED_HIT_RE = /^\s*(.+?)\s+(into .*)$/;

/** A bare ammo token and nothing else: `FallDamageHealth`. */
const BARE_RE = /^\s*(\S+)\s*$/;

/**
 * Deaths with nobody to blame. `died.` and `drowned.` carry a Stats> trailer;
 * `bled out` stands alone.
 *
 * NOT here: `committed suicide` and `has drowned while unconscious`. Both are
 * always paired with a `died.` line the same second, so matching them would
 * record every such death twice.
 */
const SELF_DEATH_RE = /^\s*(died\.|drowned\.|bled out)/;

/** `HH:MM:SS | ` line prefix. */
const TIME_RE = /^\s*(\d{1,2}):(\d{2}):(\d{2})\s*\|\s*(.*)$/;

/** ADM writes this for a player whose identity was not resolved. Never a real id. */
const UNKNOWN_ID = 'Unknown';

/**
 * Parse the `AdminLog started on` header.
 * Returns the calendar fields as written — NOT an instant, because the file does
 * not say what zone they are in. Combining them with an offset is the caller's job.
 */
export function parseAdmHeader(text) {
    const m = HEADER_RE.exec(text);
    if (!m) return null;
    return {
        y: Number(m[1]), mon: Number(m[2]) - 1, d: Number(m[3]),
        h: Number(m[4]), mi: Number(m[5]), s: Number(m[6]),
    };
}

/**
 * Same fields, recovered from a filename like
 * `DayZServer_x64_2025_01_04_175050457.ADM`. Used only when the header is missing
 * or the file was truncated before it was written.
 */
export function parseAdmFilenameDate(filePath) {
    const name = String(filePath).split(/[\\/]/).pop() || '';
    const m = name.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[T _-]?(\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
    if (!m) return null;
    return {
        y: Number(m[1]), mon: Number(m[2]) - 1, d: Number(m[3]),
        h: Number(m[4]), mi: Number(m[5]), s: Number(m[6]),
    };
}

/**
 * Calendar fields + a UTC offset in minutes -> an absolute instant.
 * Offset-only, so daylight saving is the caller's problem; use log-clock's
 * `wallToMs` with a zone name where a zone is known.
 */
export function fieldsToMs(f, offsetMinutes) {
    return wallToMs(f, { offsetMinutes });
}

/**
 * Classify one ADM line into zero or more player observations.
 *
 * Returns `[]` for anything unrecognised — separators, the `##### PlayerList log`
 * banner, mod chatter. A hit line yields TWO observations, victim and attacker,
 * because both carry their own position and dropping the attacker's would lose a
 * sample we were handed for free.
 *
 * `secOfDay` is relative to the file's own day; the caller resolves rollovers.
 */
export function parseAdmLine(line) {
    const t = TIME_RE.exec(line);
    if (!t) return [];
    const secOfDay = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
    const body = t[4];
    if (!body.startsWith('Player ')) return [];

    const m = PLAYER_RE.exec(body);
    if (!m) return [];

    const subject = toObservation(m, secOfDay);
    if (!subject) return [];

    // Everything after the subject's closing paren decides what the line means.
    const tail = body.slice(m.index + m[0].length);
    const out = [];

    // `[HP: 5.95662] hit by ...` — the only line that reports live health.
    const hp = /^\[HP:\s*(-?[\d.]+)\]/.exec(tail);
    if (hp) {
        subject.health = Number(hp[1]);
        subject.kind = 'hit';
    }

    // A `(DEAD)` subject or zero health means this blow was the one that killed.
    const lethal = subject.alive === false || (subject.health !== null && subject.health <= 0);

    if (/^\s*is connected/.test(tail)) subject.kind = 'connect';
    else if (/has been disconnected/.test(tail)) subject.kind = 'disconnect';
    else if (SELF_DEATH_RE.test(tail)) {
        subject.kind = 'death';
        subject.alive = false;
        // `died. Stats> Water: 390.382 Energy: 193.751 Bleed sources: 0`
        const w = /Water:\s*(-?[\d.]+)/.exec(tail);
        const e = /Energy:\s*(-?[\d.]+)/.exec(tail);
        if (w) subject.water = Number(w[1]);
        if (e) subject.energy = Number(e[1]);
        subject.combat = selfDeath(tail);
    } else if (/killed by/.test(tail)) {
        subject.kind = 'death';
        subject.alive = false;
        const k = /killed by(.*)$/.exec(tail);
        subject.combat = k ? parseKillTail(k[1]) : null;
    } else if (hp) {
        // Anything past the HP block is `hit by <source> …`. A tail this module
        // cannot read keeps the observation (health and position are still good)
        // and simply reports no combat, rather than guessing at an attacker.
        const h = /^\s*hit by(.*)$/.exec(tail.slice(hp[0].length));
        subject.combat = h ? parseHitTail(h[1], lethal) : null;
    } else if (/^\s*is unconscious/.test(tail)) subject.kind = 'unconscious';
    else if (/^\s*regained consciousness/.test(tail)) subject.kind = 'conscious';
    else if (/^\s*placed /.test(tail)) subject.kind = 'placed';
    else if (/^\s*built /.test(tail)) subject.kind = 'built';

    out.push(subject);

    // The other party on a hit/kill line, positioned in their own right.
    const other = PLAYER_RE.exec(tail);
    if (other) {
        const attacker = toObservation(other, secOfDay);
        // Only keep them if the log actually placed them; a bare `(id=...)` with no
        // pos tells us nothing we can put on a map.
        if (attacker && attacker.x !== null) {
            attacker.kind = 'witness';
            out.push(attacker);
        }
    }
    return out;
}

/**
 * `Dug in`/`Dug out` — a stash being buried or unearthed.
 *
 * Kept separate from parseAdmLine because that function answers "where was this
 * player", and a Dug line already answers it correctly via the subject's own
 * `pos=`. This one answers "what happened to which stash", which has a different
 * shape and only one consumer (stash-report.js). Same grammar, two questions.
 *
 *   ... Dug in WaterproofBag_Orange<0x...> WaterproofBag_Orange:6455 at position <3084.36,4.30308,5334.39>
 *   ... Dug out UndergroundStash<0x...> UndergroundStash:26280 at position <8286,187.615,11917.5>
 *
 * ## The axis trap
 *
 * The two positions on one line use DIFFERENT orders, and confusing them mirrors
 * every stash about the map diagonal:
 *
 *   player  pos=<x, z, y>          DayZ's easting, northing, elevation (see PLAYER_RE)
 *   stash   at position <x, y, z>  a raw engine vector
 *
 * Only the STASH position is a match key. The player's own pos drifts up to 2 m
 * from the hole they are standing over; the stash position is bit-identical
 * between the bury and the dig-up, so px/pz are returned for diagnostics only.
 *
 * `cls` is the buried CONTAINER on a dig-in (WaterproofBag_Orange, DryBag_Black,
 * WoodenCrate...) but always UndergroundStash / UndergroundStashSnow on a dig-out
 * — the container becomes a stash entity when buried. For the same reason the
 * entity ids on the two halves of a stash's life never match, which is why
 * matching has to be positional. `entityId` is provenance, never a join key.
 *
 * Returns null for every line that is not a dig.
 */
export function parseStashLine(line) {
    const t = TIME_RE.exec(line);
    if (!t) return null;
    const body = t[4];
    if (!body.startsWith('Player ')) return null;

    const dug = DUG_RE.exec(body);
    if (!dug) return null;

    const p = PLAYER_RE.exec(body);
    if (!p) return null;
    const guid = p[3];
    if (!guid || guid === UNKNOWN_ID) return null;

    const hasPos = p[4] !== undefined;
    return {
        secOfDay: Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]),
        guid,
        name: p[1] || null,
        action: dug[1].toLowerCase() === 'in' ? 'in' : 'out',
        cls: dug[2],
        entityId: `${dug[2]}:${dug[3]}`,
        // The stash, in engine order <x, y, z>.
        x: Number(dug[4]),
        y: Number(dug[5]),
        z: Number(dug[6]),
        // The player, in ADM order <x, z, y>. Diagnostics only.
        px: hasPos ? Number(p[4]) : null,
        pz: hasPos ? Number(p[5]) : null,
    };
}

/** `Dug in|out <Class><0xPTR> <Class>:<netId> at position <x, y, z>` */
const DUG_RE = /Dug (in|out) ([A-Za-z0-9_]+)<0x[0-9A-Fa-f]+>\s+[A-Za-z0-9_]+:(\d+) at position <\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*>/i;

function toObservation(m, secOfDay) {
    const guid = m[3];
    if (!guid || guid === UNKNOWN_ID) return null;
    const hasPos = m[4] !== undefined;
    return {
        secOfDay,
        guid,
        name: m[1] || null,
        // `(DEAD)` in the roster means the corpse is still in the world. Worth
        // recording as not-alive, but it is not itself a death event.
        alive: m[2] ? false : null,
        x: hasPos ? Number(m[4]) : null,
        z: hasPos ? Number(m[5]) : null,
        y: hasPos ? Number(m[6]) : null,
        kind: 'list',
        health: null, water: null, energy: null,
        // What was done to this player and by whom, on hit and death lines only.
        // See parseHitTail for the shape; null everywhere else, including on a
        // hit line whose tail this module could not read.
        combat: null,
    };
}

// ---- combat tails -------------------------------------------------------------
//
// The `combat` object on an observation:
//
//   {
//     event:     'hit' | 'kill' | 'self',
//     source:    { type, name, guid, x, y, z, display },
//     zone, component, dmg, ammo, weapon, dist, cause, lethal
//   }
//
// `source.type` is one of: `player` (a GUID we can resolve), `ai` (an Expansion
// bot — a name and a position, never an id), `named` (a creature or world object
// by the string the log used), `explosion`, `ammo` (a bare ammo token such as
// FallDamageHealth, where the ammo IS the source), or `none` (`killed by  with
// Fireplace`, where the engine had nothing to name).
//
// `source.display` is set on the hit-line creature form only. There the engine
// writes DISPLAY names (`Infected`, `Brown Bear`); on kill lines it writes config
// classes (`ZmbM_usSoldier_Woodland2_Bitterroot`). The flag lets a consumer know
// which it is holding, because the same animal appears both ways.
//
// Fields the line does not carry are null, never guessed: a melee hit has no
// distance, a kill line has no zone or damage figure, an area hit has neither.

/** An empty combat record for `event`, to be filled by the branch that matched. */
function combatFor(event, source, lethal) {
    return {
        event,
        source,
        zone: null, component: null, dmg: null, ammo: null,
        weapon: null, dist: null, cause: null,
        lethal,
    };
}

function playerSource(m) {
    const hasPos = m[4] !== undefined;
    return {
        type: 'player',
        name: m[1] || null,
        guid: m[3] === UNKNOWN_ID ? null : m[3],
        x: hasPos ? Number(m[4]) : null,
        z: hasPos ? Number(m[5]) : null,
        y: hasPos ? Number(m[6]) : null,
        display: null,
    };
}

function aiSource(m) {
    return {
        type: 'ai', name: m[1] || null, guid: null,
        x: Number(m[2]), z: Number(m[3]), y: Number(m[4]),
        display: null,
    };
}

const namedSource = (name, display) => ({
    type: 'named', name, guid: null, x: null, y: null, z: null, display: display ? name : null,
});

/**
 * A player or AI reference at the start of a tail, with how much of the tail it
 * consumed. Players first: an AI line can never match PLAYER_RE (no `id=`), but
 * the two are checked explicitly rather than by which regex happened to fire.
 */
function actorSource(s) {
    const pm = PLAYER_AT_START_RE.exec(s);
    if (pm) return { source: playerSource(pm), matched: pm[0].length };
    const am = AI_RE.exec(s);
    if (am) return { source: aiSource(am), matched: am[0].length };
    return null;
}

/** Apply an `into …` clause to a combat record. */
function applyHitMsg(c, msg) {
    c.zone = msg[1];
    c.component = Number(msg[2]);
    c.dmg = Number(msg[3]);
    c.ammo = msg[4] ?? null;
}

/**
 * Apply a `with …` clause. `with (MeleeFist)` on a kill line is the engine writing
 * the ammo where the weapon goes because bare hands have no item; it is folded
 * into `ammo` so fists look the same on a hit and on a kill.
 */
function applyWith(c, w) {
    if (!w) return;
    const paren = /^\((.+)\)$/.exec(w[1]);
    if (paren && c.ammo === null) c.ammo = paren[1];
    else c.weapon = w[1];
    if (w[2] !== undefined) c.dist = Number(w[2]);
}

/**
 * Everything after `hit by`. Branches in order of how much each form tells us,
 * because the looser patterns would happily swallow the richer lines:
 *
 *   Player "…" (id=… pos=…) into Zone(N) for D damage (Ammo) [with W [from R meters]]
 *   AI "…" (group=… pos=…) into … (same clause)
 *   explosion (Ammo)
 *   <display name> into … (same clause; no `with`)
 *   <parent class> with <Ammo>
 *   <Ammo>
 *
 * Returns null for a tail that fits none of them. The caller keeps the
 * observation either way — health and position are already read.
 */
function parseHitTail(s, lethal) {
    let m;
    const actor = actorSource(s);
    if (actor) {
        const rest = s.slice(actor.matched);
        const msg = HIT_MSG_RE.exec(rest);
        if (!msg) return null;
        const c = combatFor('hit', actor.source, lethal);
        applyHitMsg(c, msg);
        applyWith(c, WITH_RE.exec(rest.slice(msg[0].length)));
        return c;
    }
    if ((m = EXPLOSION_RE.exec(s))) {
        const c = combatFor('hit', { type: 'explosion', name: m[1], guid: null, x: null, y: null, z: null, display: null }, lethal);
        c.ammo = m[1];
        return c;
    }
    if ((m = NAMED_HIT_RE.exec(s))) {
        const msg = HIT_MSG_RE.exec(m[2]);
        if (msg) {
            const c = combatFor('hit', namedSource(m[1], true), lethal);
            applyHitMsg(c, msg);
            applyWith(c, WITH_RE.exec(m[2].slice(msg[0].length)));
            return c;
        }
    }
    if ((m = AREA_RE.exec(s))) {
        const c = combatFor('hit', namedSource(m[1], false), lethal);
        c.ammo = m[2];
        return c;
    }
    if ((m = BARE_RE.exec(s))) {
        const c = combatFor('hit', { type: 'ammo', name: m[1], guid: null, x: null, y: null, z: null, display: null }, lethal);
        c.ammo = m[1];
        return c;
    }
    return null;
}

/**
 * Everything after `killed by`:
 *
 *   Player "…" (id=… pos=…) with W [from R meters]     (W may be `(MeleeFist)`)
 *   AI "…" (group=… pos=…) with W [from R meters]
 *    with W                                            (no source at all: `killed by  with Fireplace`)
 *   <config class>                                     (ZmbM_…, Boat_01_Blue, Animal_…)
 *
 * `cause` is the string a death row should blame when no player did it.
 */
function parseKillTail(s) {
    let m;
    const actor = actorSource(s);
    if (actor) {
        const c = combatFor('kill', actor.source, true);
        applyWith(c, WITH_RE.exec(s.slice(actor.matched)));
        return c;
    }
    if ((m = WITH_RE.exec(s))) {
        const c = combatFor('kill', { type: 'none', name: null, guid: null, x: null, y: null, z: null, display: null }, true);
        applyWith(c, m);
        c.cause = c.weapon ?? c.ammo;
        return c;
    }
    if ((m = BARE_RE.exec(s))) {
        const c = combatFor('kill', namedSource(m[1], false), true);
        c.cause = m[1];
        return c;
    }
    return null;
}

/** `died.` / `drowned.` / `bled out` — the reason, where the line gives one. */
function selfDeath(tail) {
    const c = combatFor('self', { type: 'none', name: null, guid: null, x: null, y: null, z: null, display: null }, true);
    if (/^\s*drowned\./.test(tail)) c.cause = 'drowned';
    else if (/^\s*bled out/.test(tail)) c.cause = 'bleeding';
    return c;
}

/**
 * Walk a whole file's lines into observations, tagging each with the day of the
 * file it falls on.
 *
 * ADM has no date on its lines, so a file spanning midnight restarts its clock.
 * The rollover rule is shared with every other log reader here (see
 * `createDayCounter`), because a backwards clock is not always midnight: lines
 * can interleave, and the end of daylight saving replays a whole hour.
 *
 * `dayOffset` plus `secOfDay` is the wall-clock reading; turning it into an
 * instant needs a zone and happens in adm-import.js.
 *
 * Each observation is also tagged with its 1-based `line`. The importer derives
 * an action row's sequence number from it, which is what makes re-importing a
 * file a no-op: the line is the only thing about a hit that is stable across runs.
 */
export function parseAdmFile(text) {
    const rows = text.split(/\r?\n/);
    const out = [];
    const advance = createDayCounter();

    for (let i = 0; i < rows.length; i++) {
        const obs = parseAdmLine(rows[i]);
        if (!obs.length) continue;
        const dayOffset = advance(obs[0].secOfDay);
        for (const o of obs) {
            o.line = i + 1;
            o.dayOffset = dayOffset;
            o.offsetSec = dayOffset * 86400 + o.secOfDay;
            out.push(o);
        }
    }
    return out;
}

/** Snap a millisecond delta to the nearest quarter hour, as a minute count. */
export function snapOffsetMinutes(deltaMs) {
    const QUARTER = 15 * 60_000;
    return Math.round(deltaMs / QUARTER) * 15;
}

/**
 * Work out which UTC offset the file's wall clock was written in.
 *
 * Nothing in an ADM file records its zone, so this compares a wall-clock reading
 * against an absolute instant from outside the file and snaps the difference to a
 * quarter hour. Two signals, best first:
 *
 *  1. **File mtime vs the last line.** A rotated log stops being written the moment
 *     the server stops, so mtime and the final timestamp are seconds apart. This is
 *     the tight signal.
 *  2. **Numeric parent folder vs the header.** DayZ names crash/log folders with a
 *     unix timestamp. Looser — the folder is stamped at boot and the header when
 *     admin logging starts, which can be minutes later — so it is the fallback.
 *
 * Returns the snapped offset plus the raw delta and which signal produced it, so
 * the UI can show its working rather than asking the user to trust a number.
 * Returns null when neither signal is available; the caller then falls back to a
 * configured default.
 */
export function detectOffsetMinutes({ header, lastWallSec, mtimeMs, numericDirMs }) {
    if (!header) return null;

    // Signal 1: file mtime against the last line's wall clock.
    //
    // The line gives a time of day but not a date, so the elapsed-day count is
    // unknown. Searching it is safe rather than fiddly: the plausibility window
    // is 26.5 h wide but real offsets span only -12:00..+14:00, so at most one
    // day count can fit, and the first hit is the answer.
    if (Number.isFinite(mtimeMs) && Number.isFinite(lastWallSec)) {
        const midnightAsUtc = Date.UTC(header.y, header.mon, header.d, 0, 0, 0);
        for (let day = 0; day <= MAX_LOG_DAYS; day++) {
            const lastLineAsUtc = midnightAsUtc + (day * 86400 + lastWallSec) * 1000;
            const delta = lastLineAsUtc - mtimeMs;
            if (plausible(delta)) {
                return { offsetMinutes: snapOffsetMinutes(delta), rawMinutes: delta / 60_000, source: 'mtime' };
            }
        }
    }

    // Signal 2: a unix-timestamped log folder against the header. Looser, because
    // the folder is stamped at boot and the header written when admin logging
    // starts — minutes later on a slow start.
    if (Number.isFinite(numericDirMs)) {
        const headerAsUtc = Date.UTC(header.y, header.mon, header.d, header.h, header.mi, header.s);
        const delta = headerAsUtc - numericDirMs;
        if (plausible(delta)) {
            return { offsetMinutes: snapOffsetMinutes(delta), rawMinutes: delta / 60_000, source: 'logdir' };
        }
    }

    return null;
}

/** A single ADM file spanning more than a fortnight is not a real rotation. */
const MAX_LOG_DAYS = 14;

/** Real UTC offsets run -12:00 to +14:00; anything else means the signal is junk. */
const plausible = (deltaMs) => deltaMs >= -12.5 * 3600_000 && deltaMs <= 14.5 * 3600_000;

/** Last `HH:MM:SS |` wall clock in a chunk of text, as seconds of day. */
export function lastWallSecond(text) {
    const re = /^\s*(\d{1,2}):(\d{2}):(\d{2})\s*\|/gm;
    let m, last = null;
    while ((m = re.exec(text)) !== null) last = m;
    if (!last) return null;
    return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}
