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

    if (/^\s*is connected/.test(tail)) subject.kind = 'connect';
    else if (/has been disconnected/.test(tail)) subject.kind = 'disconnect';
    else if (/^\s*died\./.test(tail)) {
        subject.kind = 'death';
        subject.alive = false;
        // `died. Stats> Water: 390.382 Energy: 193.751 Bleed sources: 0`
        const w = /Water:\s*(-?[\d.]+)/.exec(tail);
        const e = /Energy:\s*(-?[\d.]+)/.exec(tail);
        if (w) subject.water = Number(w[1]);
        if (e) subject.energy = Number(e[1]);
    } else if (/killed by/.test(tail)) {
        subject.kind = 'death';
        subject.alive = false;
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
    };
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
 */
export function parseAdmFile(text) {
    const rows = text.split(/\r?\n/);
    const out = [];
    const advance = createDayCounter();

    for (const row of rows) {
        const obs = parseAdmLine(row);
        if (!obs.length) continue;
        const dayOffset = advance(obs[0].secOfDay);
        for (const o of obs) {
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
