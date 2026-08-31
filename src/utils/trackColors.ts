/**
 * Per-player track colours for the Player History tool.
 *
 * Shared by the path renderer, the playback markers and the roster swatches, which
 * must agree: the colour is the only thing tying a line on the map to a name in the
 * list, so a mismatch silently attributes one player's movements to another.
 *
 * Assignment is by position in the selection, not by player id — a stable hash of
 * the id would be nice, but adjacent hues are indistinguishable on a dark map and
 * two selected players landing on near-identical colours is the failure that
 * actually matters here.
 *
 * ## Derive the map once, in one place
 *
 * `trackColors` exists because three call sites each computed an index of their own:
 * the roster used `selected.indexOf(pid)` while the paths and the playback markers
 * used a position in the `tracks` array — which arrives sorted by pid and filtered to
 * whoever actually had samples. With one player selected those orderings coincide.
 * With two they diverge, and the swatch beside a name then belongs to somebody else's
 * line, which is exactly the misattribution the colours are here to prevent.
 *
 * So: build the map from the SELECTION, pass it down, and never index a palette at
 * the point of use. Keying off the selection also means a player who returned no
 * samples still holds their colour rather than silently donating it to the next one.
 */

/** Distinct, reasonably colourblind-tolerant hues. Cycles beyond its length. */
export const TRACK_COLORS = [
  '#f97316', // orange
  '#38bdf8', // sky
  '#a78bfa', // violet
  '#4ade80', // green
  '#f472b6', // pink
  '#facc15', // yellow
  '#2dd4bf', // teal
  '#fb7185', // rose
];

/**
 * How many players can be replayed at once.
 *
 * The palette length, not an arbitrary limit: past it the colours cycle and two
 * players on the map become genuinely indistinguishable, which defeats the point of
 * having colours at all.
 */
export const MAX_TRACKS = TRACK_COLORS.length;

export function trackColor(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length];
}

/** Colour per pid, by selection order. The one source every consumer reads. */
export function trackColors(pids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  pids.forEach((pid, i) => out.set(pid, trackColor(i)));
  return out;
}
