/**
 * Pure pan/zoom math for the top-down map editors (AirdropDropLocationMap).
 *
 * Three coordinate spaces are in play:
 *
 *   world     DayZ metres, 0..worldSize on both axes. Z is inverted relative to screen Y.
 *   content   CSS px inside the untransformed map square, 0..size. This is the space the
 *             image and every marker live in, and the space `transform` is applied to.
 *   viewport  CSS px relative to the (untransformed) viewport element's top-left — i.e.
 *             what you get from `clientX - rect.left`.
 *
 * The transform maps content -> viewport as `translate(x, y) scale(scale)` with
 * transform-origin `0 0`, so `viewport = content * scale + offset`. Keeping the maths here
 * (rather than inline in the component) is what makes it unit-testable: jsdom has no layout,
 * so this is the only part of the map that can be meaningfully covered by tests.
 */

export interface MapTransform {
  /** Content-space origin offset in viewport px. */
  x: number;
  y: number;
  /** Viewport px per content px. 1 = fit-to-view. */
  scale: number;
}

/** The neutral transform: fit-to-view, no pan. */
export const IDENTITY_TRANSFORM: MapTransform = { x: 0, y: 0, scale: 1 };

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * The zoom ceiling: the scale at which one image pixel covers exactly one CSS pixel.
 *
 * Returns 1 (i.e. no zoom available) when the image is smaller than the box it's rendered
 * in, or when its size isn't known yet — we only ever zoom *in* from fit-to-view, never
 * past native resolution, so upscaling blur is designed out rather than styled around.
 */
export function computeMaxScale(naturalSize: number | null, size: number): number {
  if (!naturalSize || !size) return 1;
  return Math.max(1, naturalSize / size);
}

/** World position -> viewport px. Screen Y is inverted relative to world Z. */
export function worldToViewport(
  x: number, z: number, worldSize: number, size: number, t: MapTransform,
): { px: number; py: number } {
  return {
    px: t.x + (x / worldSize) * size * t.scale,
    py: t.y + (1 - z / worldSize) * size * t.scale,
  };
}

/** A world-space length (e.g. a zone radius) -> viewport px. */
export function worldLenToViewport(
  len: number, worldSize: number, size: number, t: MapTransform,
): number {
  return (len / worldSize) * size * t.scale;
}

/**
 * Viewport px -> content px, clamped to the map square.
 *
 * Clamping belongs here rather than in screen space: once the map is panned, the visible
 * region no longer corresponds to 0..size on screen, so clamping the raw pointer offset
 * would cap drags at the wrong place.
 */
export function viewportToContent(
  px: number, py: number, size: number, t: MapTransform,
): { cx: number; cy: number } {
  return {
    cx: clamp((px - t.x) / t.scale, 0, size),
    cy: clamp((py - t.y) / t.scale, 0, size),
  };
}

/** Content px -> world position. Screen Y is inverted relative to world Z. */
export function contentToWorld(
  cx: number, cy: number, worldSize: number, size: number,
): { x: number; z: number } {
  return {
    x: (cx / size) * worldSize,
    z: worldSize - (cy / size) * worldSize,
  };
}

/**
 * Scale about a viewport-space focus point, keeping whatever is under that point pinned.
 *
 * Convert the focus to content space at the old scale, then re-solve the offset so the same
 * content point lands back under it at the new scale.
 */
export function zoomAt(
  t: MapTransform, nextScale: number, focusX: number, focusY: number,
): MapTransform {
  const contentFocusX = (focusX - t.x) / t.scale;
  const contentFocusY = (focusY - t.y) / t.scale;
  return {
    scale: nextScale,
    x: focusX - contentFocusX * nextScale,
    y: focusY - contentFocusY * nextScale,
  };
}

/**
 * Clamp scale into [1, maxScale] and the pan offset so the map can never be dragged off
 * screen: centred on an axis while the image is smaller than the viewport, otherwise pinned
 * so its edges can't come inside the viewport.
 *
 * At scale 1 in a square viewport this forces {x: 0, y: 0}, so "reset to fit" needs no
 * separate code path — it's just this function applied to a scale-1 transform.
 */
export function clampTransform(
  t: MapTransform, size: number, viewportW: number, viewportH: number, maxScale: number,
): MapTransform {
  const scale = clamp(t.scale, 1, Math.max(1, maxScale));
  const span = size * scale;
  const axis = (v: number, view: number) =>
    span <= view ? (view - span) / 2 : clamp(v, view - span, 0);
  return { scale, x: axis(t.x, viewportW), y: axis(t.y, viewportH) };
}
