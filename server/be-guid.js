/**
 * BattlEye GUID from a steam64.
 *
 * BattlEye identifies a player by the MD5 of the ASCII bytes "BE" followed by the
 * 64-bit Steam id in little-endian byte order, rendered as 32 lowercase hex
 * digits. That is the id `bans.txt` and the RCon `addBan` command take — a ban by
 * steam64 is not a thing BattlEye understands, so an automated temp ban has to
 * make this conversion itself.
 *
 * Pure and dependency-free. Verify against a real pair from the live server's
 * BattlEye/bans.txt before trusting it in anger: the algorithm is the community-
 * documented one and the byte order is the part that is easy to get wrong.
 */

import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const STEAM64_RE = /^\d{15,20}$/;

/** True when `s` is a plausible steam64 (numeric, 17-ish digits). */
export function isSteam64(s) {
    return typeof s === 'string' && STEAM64_RE.test(s);
}

/**
 * @param {string} steam64  decimal string; a number would lose precision past 2^53
 * @returns {string|null}   32 lowercase hex chars, or null for a malformed input
 */
export function beGuidFor(steam64) {
    if (!isSteam64(steam64)) return null;
    let id;
    try { id = BigInt(steam64); } catch { return null; }
    const buf = Buffer.alloc(10);
    buf.write('BE', 0, 'ascii');
    buf.writeBigUInt64LE(id, 2);
    return createHash('md5').update(buf).digest('hex');
}
