/**
 * Turning a DayZ log's wall clock into an absolute instant.
 *
 * Every log format this product reads — `.ADM`, Expansion `.log` — writes a bare
 * wall clock, with no zone and usually no date on the line at all. Recovering an
 * instant needs two things the file does not contain: which zone the server's
 * clock was in, and which day a given line belongs to.
 *
 * ## Why a zone and not an offset
 *
 * This code originally assumed a fixed UTC+10 everywhere. That is wrong for half
 * the year on any server that observes daylight saving: Australia/Sydney runs
 * +11:00 (AEDT) from October to April and +10:00 (AEST) the rest of the time. A
 * fixed offset silently puts every line in the other half of the year an hour out,
 * and nothing in the data contradicts it — the logs look perfectly reasonable,
 * just wrong. So a zone is stored and the offset is resolved per instant.
 *
 * Fixed offsets are still supported, as `{ offsetMinutes }` in place of a zone
 * name, because an archive from an unknown server may only ever yield an offset.
 *
 * Pure: no IO, no state beyond a formatter cache.
 */

/** `Intl.DateTimeFormat` construction is expensive and these are reused per line. */
const FORMATTERS = new Map();

function formatterFor(timeZone) {
    let f = FORMATTERS.get(timeZone);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        FORMATTERS.set(timeZone, f);
    }
    return f;
}

/** The zone this Lootmaster host runs in. Only ever a default, never an assumption. */
export const hostTimeZone = (() => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
})();

/** True if the runtime's tz database knows this zone name. */
export function isValidTimeZone(tz) {
    if (typeof tz !== 'string' || !tz) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

/** A usable zone name, or null. Callers fall back to their own default. */
export function normalizeTimeZone(tz) {
    return isValidTimeZone(tz) ? tz : null;
}

/** The calendar fields `timeZone` was showing at an instant. */
export function localFields(instantMs, timeZone) {
    const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
    const get = (t) => Number(parts.find((p) => p.type === t)?.value);
    return {
        y: get('year'), mon: get('month') - 1, d: get('day'),
        h: get('hour'), mi: get('minute'), s: get('second'),
    };
}

/** Minutes east of UTC that `timeZone` was on at an instant. 660 = +11:00. */
export function zoneOffsetMinutes(instantMs, timeZone) {
    const whole = Math.floor(instantMs / 1000) * 1000;
    const f = localFields(whole, timeZone);
    return Math.round((Date.UTC(f.y, f.mon, f.d, f.h, f.mi, f.s) - whole) / 60_000);
}

/**
 * A short label for the offset in force at an instant — "AEDT" where the tz
 * database has an abbreviation, "UTC+11:00" where it does not. Display only.
 */
export function zoneLabel(instantMs, timeZone) {
    try {
        const parts = new Intl.DateTimeFormat('en-AU', { timeZone, timeZoneName: 'short' })
            .formatToParts(new Date(instantMs));
        const name = parts.find((p) => p.type === 'timeZoneName')?.value;
        if (name && !/^(GMT|UTC)/i.test(name)) return name;
    } catch { /* fall through to the numeric form */ }
    return fmtOffset(zoneOffsetMinutes(instantMs, timeZone));
}

/** 660 -> "UTC+11:00". The one place the sign convention is written down. */
export function fmtOffset(minutes) {
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

const DAY_MS = 86_400_000;

/**
 * Resolve wall-clock calendar fields to an instant in `zone`.
 *
 * `zone` is either an IANA name or `{ offsetMinutes }` for a fixed offset.
 *
 * Daylight saving makes this a genuine mapping problem rather than a subtraction:
 *
 * - **Ambiguous.** When the clock goes back, an hour of wall time happens twice.
 *   `preferLater` picks the second pass; the caller knows which one it is reading
 *   because it watched the log's clock jump backwards.
 * - **Nonexistent.** When the clock goes forward, an hour of wall time never
 *   happens. A log cannot contain one, but a hand-typed range or a corrupted
 *   header can, so it resolves to the instant the clock jumped to rather than
 *   throwing.
 *
 * Both cases are reported so a caller can surface them instead of guessing.
 */
export function resolveWall(fields, zone, { preferLater = false } = {}) {
    const wallAsUtc = Date.UTC(fields.y, fields.mon, fields.d, fields.h, fields.mi, fields.s);

    if (zone && typeof zone === 'object') {
        const off = Number(zone.offsetMinutes) || 0;
        return { ms: wallAsUtc - off * 60_000, offsetMinutes: off, ambiguous: false, nonexistent: false };
    }

    // Candidate offsets: whatever the zone was on a day either side. A transition
    // is always inside that window, and no zone changes twice in 48 hours.
    const before = zoneOffsetMinutes(wallAsUtc - DAY_MS, zone);
    const after = zoneOffsetMinutes(wallAsUtc + DAY_MS, zone);

    const candidates = [];
    for (const off of new Set([before, after])) {
        const ms = wallAsUtc - off * 60_000;
        // Self-consistency: an instant only explains this wall time if the zone was
        // actually on that offset then.
        if (zoneOffsetMinutes(ms, zone) === off) candidates.push({ ms, off });
    }

    if (!candidates.length) {
        const ms = wallAsUtc - before * 60_000;
        return { ms, offsetMinutes: after, ambiguous: false, nonexistent: true };
    }

    candidates.sort((a, b) => a.ms - b.ms);
    const pick = preferLater ? candidates[candidates.length - 1] : candidates[0];
    return { ms: pick.ms, offsetMinutes: pick.off, ambiguous: candidates.length > 1, nonexistent: false };
}

/** `resolveWall` when only the instant is wanted. */
export const wallToMs = (fields, zone, opts) => resolveWall(fields, zone, opts).ms;

/**
 * A backwards jump this large means the log crossed midnight.
 *
 * It cannot simply be "the clock went backwards". Two subsystems flushing in the
 * same second can write out of order, and — the reason this is hours rather than
 * seconds — the end of daylight saving replays a whole hour of wall time. Reading
 * either as midnight shifts the rest of the file a full day.
 */
export const ROLLOVER_BACK_SEC = 6 * 3600;

/** Lines this far out of order are just interleaved writes, not a clock change. */
export const REORDER_SLOP_SEC = 60;

/**
 * Count which day of a file a line belongs to, from seconds-of-day fed in file
 * order. A log's lines carry no date, so this is the only way to know.
 */
export function createDayCounter() {
    let dayOffset = 0;
    let lastSec = null;

    return function advance(sec) {
        if (lastSec !== null && sec < lastSec - ROLLOVER_BACK_SEC) dayOffset += 1;
        lastSec = sec;
        return dayOffset;
    };
}

/**
 * Resolve a file's wall-clock readings, in file order, to instants.
 *
 * The one thing this adds over `resolveWall` is memory, and it is needed for
 * exactly one case: when daylight saving ends, an hour of wall time is replayed
 * and each reading in it has two possible instants. The log itself says which —
 * lines are written in order, so the reading that keeps the file moving forwards
 * is the right one. Without this, an hour of every autumn's logs jumps back in
 * time and the map draws players teleporting home and back.
 *
 * Where a reading is ambiguous and no earlier line constrains it (the log went
 * quiet across the whole repeated hour), the earlier instant wins — nothing in
 * the data distinguishes them, so this takes the conservative reading.
 */
export function createWallResolver(zone) {
    let lastMs = null;
    return function resolve(fields) {
        const first = resolveWall(fields, zone);
        let out = first;
        if (first.ambiguous && lastMs !== null && first.ms < lastMs) {
            out = resolveWall(fields, zone, { preferLater: true });
        }
        lastMs = out.ms;
        return out;
    };
}

/**
 * The common shape of every log reader here: a file whose date is known, whose
 * lines carry only a time of day.
 *
 * `dateFields` is the file's local calendar date; feed `at()` seconds-of-day in
 * file order and it returns absolute instants, rolling days and daylight saving
 * for you.
 */
export function createDayClock(dateFields, zone) {
    const advance = createDayCounter();
    const resolve = createWallResolver(zone);
    return {
        at(sec) {
            const dayOffset = advance(sec);
            return resolve({
                y: dateFields.y, mon: dateFields.mon, d: dateFields.d + dayOffset,
                h: Math.floor(sec / 3600), mi: Math.floor(sec / 60) % 60, s: sec % 60,
            }).ms;
        },
    };
}
