/**
 * Ramer-Douglas-Peucker path simplification, in world metres.
 *
 * A week of one player at the mod's 5 s cadence is ~120k samples, and a player who
 * logs in and stands still contributes thousands of identical points. Sending that
 * is slow and reading it is impossible — but a naive "every Nth sample" stride is
 * worse than either: it clips corners, and on a movement track the corners ARE the
 * information. Where someone turned, doubled back or stopped is the whole question.
 *
 * RDP keeps the points that carry the shape and drops the ones that lie on a line
 * between their neighbours, so a straight sprint down a road collapses to two points
 * while a scuffle around a building keeps its detail.
 *
 * Lives in server/ rather than src/utils/ because the server runs plain Node with no
 * build step and cannot import a .ts module; the decimation happens before the track
 * goes on the wire, so the client never needs its own copy.
 */

/**
 * Perpendicular distance from `p` to the segment `a`-`b`, in the units of the input.
 * Falls back to point distance when the segment is degenerate (a === b), which
 * happens constantly on a stationary player.
 */
function perpendicularDistance(p, a, b) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    if (lenSq === 0) return Math.hypot(p.x - a.x, p.z - a.z);
    // Project p onto the infinite line, clamped to the segment.
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq));
    return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/**
 * Simplify to a tolerance in metres. Endpoints are always kept.
 *
 * Iterative rather than recursive: a 120k-point track recursing per split can blow
 * the stack, and this runs on the request path.
 */
export function simplifyPath(points, toleranceM) {
    if (points.length <= 2 || toleranceM <= 0) return points.slice();

    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;

    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const [first, last] = stack.pop();
        let maxDist = 0;
        let index = -1;
        for (let i = first + 1; i < last; i++) {
            const d = perpendicularDistance(points[i], points[first], points[last]);
            if (d > maxDist) { maxDist = d; index = i; }
        }
        if (index !== -1 && maxDist > toleranceM) {
            keep[index] = 1;
            stack.push([first, index], [index, last]);
        }
    }

    const out = [];
    for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
    return out;
}

/**
 * Simplify down to at most `maxPoints`, discovering the tolerance by bisection.
 *
 * Callers want a budget ("at most 2000 points to draw"), not a tolerance — the
 * tolerance that achieves a given budget depends entirely on the track and differs
 * by orders of magnitude between a cross-map run and an hour spent inside one
 * building. Doubling until the result fits, then bisecting, finds it in ~20 passes
 * without the caller ever having to guess.
 */
export function simplifyToBudget(points, maxPoints) {
    if (points.length <= maxPoints || maxPoints < 2) return points.slice();

    let lo = 0;
    let hi = 1;
    while (simplifyPath(points, hi).length > maxPoints) {
        hi *= 2;
        // A DayZ world is at most ~16 km across; past that everything is collinear
        // within tolerance and further doubling cannot help.
        if (hi > 32768) return simplifyPath(points, hi);
    }

    let best = simplifyPath(points, hi);
    for (let i = 0; i < 20 && hi - lo > 0.5; i++) {
        const mid = (lo + hi) / 2;
        const candidate = simplifyPath(points, mid);
        if (candidate.length > maxPoints) {
            lo = mid;
        } else {
            hi = mid;
            best = candidate;
        }
    }
    return best;
}
