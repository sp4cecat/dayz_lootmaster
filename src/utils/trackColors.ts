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

export function trackColor(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length];
}
