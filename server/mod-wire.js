/**
 * Shared normalisation for the companion mod's wire format.
 *
 * Extracted from cftools-service.js so the live path and the history recorder
 * cannot drift: a sentinel collapsed in one and not the other is how "unknown"
 * ends up stored as a reading of -1 and rendered as "Level -1" months later.
 *
 * The convention these encode is documented at length in openapi-ingest.json:
 * Enforce's JsonSerializer writes every declared member of a class and cannot
 * omit one per-instance, so a field that is meaningless for a given row still
 * arrives, carrying a sentinel. A numeric unknown is -1, a string unknown is "",
 * an object unknown is null or absent — and a consumer must collapse ALL of them.
 */

export const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The mod's StatValue() returns -1 for a stat the engine doesn't declare, which
 * is "unknown", not a reading — collapse it (and any other negative) to null.
 */
export const modStat = (v) => {
    const n = num(v);
    return n === null || n < 0 ? null : n;
};

/**
 * Same idea as modStat, for strings. Absence alone is not a usable signal, so
 * both "" and a non-string collapse to null.
 */
export const modStr = (v) => {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    return s ? s : null;
};

/**
 * The mod declares `alive` as an Enforce `bool`, but its JsonSerializer emits
 * bools as 1/0 — hence the `integer, enum [0,1]` in openapi-ingest.json (the same
 * quirk buildCatalogDetail works around for the catalog's boolean flags).
 * Accept true/false too in case that ever changes, and only claim knowledge when
 * the field is actually present.
 */
export function modAlive(v) {
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    return null;
}

/**
 * Accepts [x,y,z] (DayZ world: y = height), {x,y,z}, or an Enforce vector rendered
 * as a string ("<7500, 300, 2500>" from vector.ToString(), or "7500 300 2500");
 * returns [x,y,z] or null. GameLabs' `_ServerEvent.position` is a typed Enforce
 * `vector`, and how that lands in JSON is the mod's choice, not ours — a shape we
 * don't recognise drops the entity from the map entirely, so accept all three.
 */
export function normPosition(pos) {
    if (typeof pos === 'string') {
        const parts = pos.replace(/[<>]/g, '').split(/[\s,]+/).filter(Boolean).map(Number);
        if (parts.length >= 2) return normPosition(parts);
        return null;
    }
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

/**
 * Both territory systems key members by BI GUID, which is not numeric. A purely
 * numeric 15-20 digit id is a steam64 that arrived under the generic `id` key.
 */
export const looksSteam64 = (s) => typeof s === 'string' && /^\d{15,20}$/.test(s);
