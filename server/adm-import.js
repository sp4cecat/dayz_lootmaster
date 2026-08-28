/**
 * Backfill the player-history store from archived DayZ admin logs.
 *
 * The history store only knows what the companion mod pushed it, which means it
 * starts the day the mod was installed. Admin logs usually go back much further,
 * and with `adminLogPlayerList = 1` they carry a full positioned roster every
 * ~5 minutes. This module turns that archive into history rows.
 *
 * Text parsing lives in adm-parse.js; this module does the IO, the identity
 * resolution and the writing.
 *
 * ## Imported rows are second-class, deliberately
 *
 * ADM samples are ~5 minutes apart where the mod's are ~5 seconds, they have no
 * blood/shock/hands, and their clock is inferred rather than recorded. Every row
 * is tagged `src='adm'` so consumers can tell the two apart, and inserts use
 * OR IGNORE so a live mod sample always wins a collision. Re-importing the same
 * archive is therefore a no-op rather than a corruption.
 */

import { readdir, readFile, stat, open } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import {
    parseAdmHeader, parseAdmFilenameDate, parseAdmFile,
    detectOffsetMinutes, lastWallSecond,
} from './adm-parse.js';
import {
    createWallResolver, resolveWall, normalizeTimeZone, hostTimeZone, zoneLabel, fmtOffset,
} from './log-clock.js';
import * as history from './history-store.js';

/** Archives nest by season/date/instance; deep enough for any sane layout. */
const MAX_DEPTH = 6;
/** Enough of the head to reach `AdminLog started on`, which is line 3-4. */
const HEAD_BYTES = 4096;
/** Enough of the tail to be sure of catching at least one timestamped line. */
const TAIL_BYTES = 64 * 1024;
/**
 * Fallback when the archive gives no usable clock signal at all. Only ever used
 * to seed the offset vote; the import itself runs off a zone, which the profile
 * supplies and the user can correct.
 */
export const DEFAULT_OFFSET_MINUTES = 600;
/**
 * How far a raw delta may sit from its snapped quarter-hour before we stop
 * believing it. A server-written log lands within seconds; anything minutes out
 * means the file was copied or edited and its mtime no longer means anything.
 */
const CONFIDENT_SLOP_MIN = 3;

/** Recursively collect *.ADM under a root. Depth-bounded, symlinks not followed. */
export async function walkAdmFiles(root, depth = 0) {
    if (depth > MAX_DEPTH) return [];
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch {
        return [];
    }
    const out = [];
    for (const ent of entries) {
        const full = join(root, ent.name);
        if (ent.isDirectory()) {
            out.push(...await walkAdmFiles(full, depth + 1));
        } else if (ent.isFile() && /\.ADM$/i.test(ent.name)) {
            out.push(full);
        }
    }
    return out;
}

/**
 * A parsed header read in `zone` — an IANA zone name, or `{ offsetMinutes }` for
 * a fixed offset — as an absolute instant.
 */
export const headerInstant = (header, zone) => resolveWall(header, zone).ms;

/**
 * Whatever the caller gave us, as something log-clock can resolve against: an
 * IANA zone name, or `{ offsetMinutes }`. A bare number is read as minutes,
 * because falling back to this machine's zone when someone meant UTC would be a
 * silent hour or ten of error.
 */
export function toZone(spec) {
    if (typeof spec === 'string') return normalizeTimeZone(spec) || hostTimeZone;
    if (Number.isFinite(spec)) return { offsetMinutes: Number(spec) };
    if (spec && Number.isFinite(spec.offsetMinutes)) return { offsetMinutes: Number(spec.offsetMinutes) };
    return hostTimeZone;
}

/** The nearest ancestor folder named like a unix timestamp, in ms. DayZ names crash dirs this way. */
function numericDirMs(filePath) {
    const parts = String(filePath).split(/[\\/]/);
    for (let i = parts.length - 2; i >= 0; i--) {
        if (/^\d{10}$/.test(parts[i])) return Number(parts[i]) * 1000;
    }
    return null;
}

/** Read the first and last slice of a file without loading the middle. */
async function readEnds(path, size) {
    const fh = await open(path, 'r');
    try {
        const head = Buffer.alloc(Math.min(HEAD_BYTES, size));
        await fh.read(head, 0, head.length, 0);
        const tailLen = Math.min(TAIL_BYTES, size);
        const tail = Buffer.alloc(tailLen);
        await fh.read(tail, 0, tailLen, size - tailLen);
        return { head: head.toString('utf8'), tail: tail.toString('utf8') };
    } finally {
        await fh.close();
    }
}

/**
 * Inspect an archive without importing anything.
 *
 * Reads only the head and tail of each file, so previewing a multi-gigabyte
 * archive costs two seeks per file rather than a full parse.
 */
export async function scanAdmArchive(root, zoneSpec) {
    const paths = await walkAdmFiles(root);
    const files = [];

    for (const path of paths) {
        let st;
        try {
            st = await stat(path);
        } catch {
            continue;
        }
        if (!st.size) continue;

        const { head, tail } = await readEnds(path, st.size);
        const header = parseAdmHeader(head) || parseAdmFilenameDate(path);
        if (!header) {
            files.push({ path, bytes: st.size, header: null, skip: 'no date in header or filename' });
            continue;
        }
        const detected = detectOffsetMinutes({
            header,
            lastWallSec: lastWallSecond(tail),
            mtimeMs: st.mtimeMs,
            numericDirMs: numericDirMs(path),
        });
        files.push({
            path,
            bytes: st.size,
            header,
            mtimeMs: st.mtimeMs,
            detected,
            confident: !!detected && Math.abs(detected.rawMinutes - detected.offsetMinutes) <= CONFIDENT_SLOP_MIN,
            skip: null,
        });
    }

    files.sort((a, b) => (a.header && b.header
        ? Date.UTC(a.header.y, a.header.mon, a.header.d, a.header.h, a.header.mi, a.header.s)
          - Date.UTC(b.header.y, b.header.mon, b.header.d, b.header.h, b.header.mi, b.header.s)
        : 0));

    const zone = toZone(zoneSpec);
    return { root, files, offset: voteOffset(files), zone: checkZone(files, zone) };
}

/** "AEDT" for a zone name, "UTC+10:00" for a bare offset. */
const labelFor = (ms, zone) =>
    (typeof zone === 'string' ? zoneLabel(ms, zone) : fmtOffset(zone.offsetMinutes));

/**
 * Hold the chosen zone up against what the files' own timestamps imply.
 *
 * The zone is a property of the server, not of the archive, so it is configured
 * rather than discovered — but a wrong one is invisible in the output, and an
 * hour of error puts a player on the other side of a firefight. So every file's
 * detected offset is compared against what the zone says it should have been on
 * that date, and the disagreement is reported rather than smoothed over.
 *
 * Only the mtime signal is used as evidence. The folder signal is loose enough
 * that it would manufacture conflicts (see voteOffset).
 */
export function checkZone(files, zone) {
    const offsets = new Map();
    let agree = 0;
    let conflict = 0;
    let conflictOffset = null;

    for (const f of files) {
        if (!f.header) continue;
        const at = resolveWall(f.header, zone);
        const predicted = at.offsetMinutes;
        const seen = offsets.get(predicted);
        if (seen) seen.files += 1;
        // Label from an instant the offset was actually in force, so a zone name
        // reads back as the AEDT/AEST an operator recognises.
        else offsets.set(predicted, { minutes: predicted, files: 1, label: labelFor(at.ms, zone) });

        if (!f.confident || f.detected?.source !== 'mtime') continue;
        if (f.detected.offsetMinutes === predicted) agree += 1;
        else {
            conflict += 1;
            if (conflictOffset === null) conflictOffset = f.detected.offsetMinutes;
        }
    }

    return {
        timeZone: typeof zone === 'string' ? zone : null,
        offsetMinutes: typeof zone === 'object' ? zone.offsetMinutes : null,
        // More than one offset means the archive straddles a daylight-saving
        // change — the exact case a single fixed offset gets wrong.
        offsets: [...offsets.values()].sort((a, b) => a.minutes - b.minutes),
        agree,
        conflict,
        conflictOffset,
    };
}

/**
 * Pick one offset for the whole archive by majority vote of the confident files.
 *
 * Per-file detection is only as good as the file's mtime, and an archive that has
 * been copied, zipped or hand-edited will produce scattered nonsense — verified
 * against real extracts that yielded +6.25, -11.75 and +8.25 from the same server.
 * Voting turns that into one answer plus an honest disagreement count, instead of
 * silently importing each file into a different timezone.
 */
export function voteOffset(files) {
    // Tiered, because the two signals are not equally trustworthy. A server-written
    // log's mtime sits seconds from its last line; a unix-named folder is stamped at
    // boot and can precede the admin-log header by minutes. Verified on a real
    // archive: the mtime signal agreed on +11:00 across every substantive file while
    // the folder signal produced +8:00 and +5:30 from near-empty rotations in the
    // same tree. Letting the loose signal vote alongside the tight one would let a
    // handful of empty files outvote the truth.
    for (const source of ['mtime', 'logdir']) {
        const tally = new Map();
        for (const f of files) {
            if (!f.confident || f.detected?.source !== source) continue;
            const k = f.detected.offsetMinutes;
            tally.set(k, (tally.get(k) || 0) + 1);
        }
        if (!tally.size) continue;

        let best = null;
        let votes = 0;
        let counted = 0;
        for (const [k, n] of tally) {
            counted += n;
            if (n > votes) { best = k; votes = n; }
        }
        return {
            offsetMinutes: best,
            source,
            votes,
            total: files.length,
            // Files that produced a different answer using the SAME signal. Real
            // disagreement, worth showing; a weaker signal dissenting is not.
            disagreement: counted - votes,
        };
    }

    return {
        offsetMinutes: DEFAULT_OFFSET_MINUTES,
        source: 'default',
        votes: 0,
        total: files.length,
        disagreement: 0,
    };
}

/**
 * Read the companion mod's GUID ledger: BI GUID -> steam64 + last known name.
 *
 * This is the bridge between the two identity spaces. ADM writes GetId() (a
 * base64url GUID) while the mod's snapshot — and therefore every existing history
 * row — is keyed on GetPlainId() (the steam64). Without this map, imported rows
 * would describe the same people under different ids and never join up.
 *
 * The mod writes it to $profile:spacecat/guid_ledger.json for exactly this kind of
 * cross-referencing, so no mod change is needed. A missing file is normal (the mod
 * may never have run) and simply means nothing resolves.
 */
export async function readGuidLedger(serverPath) {
    const path = join(serverPath, 'profiles', 'spacecat', 'guid_ledger.json');
    try {
        const raw = JSON.parse(await readFile(path, 'utf8'));
        const map = new Map();
        for (const e of raw?.entries || []) {
            if (e?.guid && e?.steamId) map.set(e.guid, { steamId: String(e.steamId), name: e.name || null });
        }
        return { path, ok: true, size: map.size, map };
    } catch (err) {
        return { path, ok: false, size: 0, map: new Map(), error: err.code === 'ENOENT' ? 'not found' : err.message };
    }
}

/**
 * GUIDs with no ledger entry are still worth importing — an unattributed track is
 * far more useful than a dropped one, and the name from the log makes it readable.
 * The prefix keeps them from ever colliding with a real steam64 and marks them as
 * relinkable once the ledger learns the mapping. Mirrors the `ai:` prefix already
 * used for AI rows.
 */
export const UNRESOLVED_PREFIX = 'guid:';

/**
 * Collapse a file's observations into history rows.
 *
 * Two things happen here that the parser cannot do alone:
 *
 * **Merging.** A player can appear twice in one second — a roster dump and a hit,
 * say. The store's primary key is (srv, pid, ts), so they must become one row;
 * merging keeps the richest value for each field rather than letting whichever
 * arrived last win.
 *
 * **Session boundaries.** `is connected` / `has been disconnected` are the only
 * authoritative statements of presence in the whole format, and they carry no
 * position so they cannot be rows themselves. Instead they set `runStart` on the
 * player's next positioned sample, which is what stops the map drawing a line
 * across a logout.
 *
 * **Time.** Each observation's wall clock is resolved through `zone` in file
 * order, so a file that runs through the end of daylight saving lands on the
 * right side of the change instead of an hour of it jumping backwards.
 */
export function rowsForFile(observations, baseFields, zoneSpec) {
    const zone = toZone(zoneSpec);
    const resolve = createWallResolver(zone);
    const byKey = new Map();
    const pendingRunStart = new Set();
    let events = 0;
    let ambiguous = 0;

    for (const o of observations) {
        if (o.kind === 'connect' || o.kind === 'disconnect') {
            pendingRunStart.add(o.guid);
            events += 1;
            continue;
        }
        if (o.x === null) continue;               // nothing to place on a map

        const sec = o.secOfDay;
        const at = resolve({
            y: baseFields.y, mon: baseFields.mon, d: baseFields.d + (o.dayOffset || 0),
            h: Math.floor(sec / 3600), mi: Math.floor(sec / 60) % 60, s: sec % 60,
        });
        if (at.ambiguous) ambiguous += 1;
        const ts = at.ms;
        const key = `${o.guid} ${ts}`;
        const existing = byKey.get(key);
        if (existing) {
            mergeInto(existing, o);
            continue;
        }
        const row = {
            guid: o.guid,
            name: o.name,
            ts,
            x: o.x, y: o.y, z: o.z,
            health: o.health,
            water: o.water,
            energy: o.energy,
            alive: o.alive,
            runStart: pendingRunStart.delete(o.guid) ? 1 : null,
        };
        byKey.set(key, row);
    }

    return { rows: [...byKey.values()].sort((a, b) => a.ts - b.ts), events, ambiguous };
}

/** Keep the more informative of two readings for the same player-second. */
function mergeInto(row, o) {
    if (row.health === null) row.health = o.health;
    if (row.water === null) row.water = o.water;
    if (row.energy === null) row.energy = o.energy;
    // "Known dead" beats "unknown"; a roster line that omits (DEAD) must not
    // resurrect someone the same second's death line just buried.
    if (o.alive === false) row.alive = false;
    if (!row.name && o.name) row.name = o.name;
}

/**
 * Import a set of scanned files into the history store.
 *
 * `onProgress` is called per file so a long archive can report itself; the whole
 * run is otherwise synchronous per file, which keeps peak memory at one file's
 * observations rather than the archive's.
 */
export async function importAdmArchive({
    files, zone: zoneSpec, ledger, srv, onProgress, signal,
}) {
    const zone = toZone(zoneSpec);
    const totals = {
        files: 0, skipped: 0, rows: 0, inserted: 0, events: 0,
        resolved: 0, unresolved: 0, ambiguous: 0,
        unresolvedGuids: new Set(),
        firstTs: null, lastTs: null,
        errors: [],
    };

    for (const f of files) {
        if (signal?.aborted) break;
        if (f.skip || !f.header) { totals.skipped += 1; continue; }

        let text;
        try {
            text = await readFile(f.path, 'utf8');
        } catch (err) {
            totals.skipped += 1;
            totals.errors.push({ path: f.path, error: err.message });
            continue;
        }

        const { rows, events, ambiguous } = rowsForFile(parseAdmFile(text), f.header, zone);
        totals.events += events;
        totals.ambiguous += ambiguous;

        const mapped = rows.map((r) => {
            const hit = ledger.get(r.guid);
            if (hit) totals.resolved += 1;
            else {
                totals.unresolved += 1;
                totals.unresolvedGuids.add(r.guid);
            }
            return {
                pid: hit ? hit.steamId : UNRESOLVED_PREFIX + r.guid,
                steamId: hit ? hit.steamId : null,
                name: r.name || hit?.name || null,
                ts: r.ts,
                x: r.x, y: r.y, z: r.z,
                health: r.health, blood: null, shock: null,
                energy: r.energy, water: r.water,
                alive: r.alive,
                runStart: r.runStart,
            };
        });

        let inserted = 0;
        try {
            inserted = history.recordAdmRows(mapped, srv);
        } catch (err) {
            totals.errors.push({ path: f.path, error: err.message });
        }

        totals.files += 1;
        totals.rows += mapped.length;
        totals.inserted += inserted;
        if (mapped.length) {
            const lo = mapped[0].ts;
            const hi = mapped[mapped.length - 1].ts;
            totals.firstTs = totals.firstTs === null ? lo : Math.min(totals.firstTs, lo);
            totals.lastTs = totals.lastTs === null ? hi : Math.max(totals.lastTs, hi);
        }
        onProgress?.({ ...summarise(totals), current: f.path });
    }

    return summarise(totals);
}

const summarise = (t) => ({
    files: t.files, skipped: t.skipped, rows: t.rows, inserted: t.inserted,
    events: t.events, resolved: t.resolved, unresolved: t.unresolved,
    // Rows inside a replayed daylight-saving hour. Placed by file order, but the
    // wall clock alone could not have told them apart.
    ambiguous: t.ambiguous,
    unresolvedGuids: t.unresolvedGuids.size,
    firstTs: t.firstTs, lastTs: t.lastTs,
    errors: t.errors.slice(0, 10),
});
