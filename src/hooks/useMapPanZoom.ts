import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  IDENTITY_TRANSFORM, MapTransform, clamp, clampTransform, computeMaxScale, contentToWorld,
  viewportToContent, worldLenToViewport, worldToOverlay, zoomAt,
} from '@/utils/mapTransform';

/**
 * Shared pan/zoom behaviour for every top-down map tool (Airdrop drop locations, Bases &
 * Territories zones, the Heat Map and the Item Scanner).
 *
 * The three tools grew their own pan/zoom independently and disagreed on nearly everything:
 * the Heat Map had four discrete zoom breakpoints, an unclamped pan that let you throw the
 * map off screen, and a wheel that always swallowed page scroll; the Item Scanner had no
 * zoom at all. This hook is the single implementation they now all share, so a gesture
 * learned in one tool works in the others.
 *
 * The maths lives in `@/utils/mapTransform` (pure and unit-tested); this hook is only the
 * DOM plumbing — measurement, wheel, pointer gestures and keyboard.
 *
 * ## The contract
 *
 * The consumer renders three layers:
 *
 *   1. the **viewport** — gets `viewportRef` and `viewportHandlers`, is `overflow-hidden`
 *      and `relative`, and is measured;
 *   2. the **content box** — gets `contentStyle`, and holds only things that live in map
 *      space and should scale (`MapImageLayer`, the history TrackLayer);
 *   3. an **overlay** — gets `overlayStyle`, with markers positioned via `project()` so
 *      their handles, borders and labels keep a constant on-screen size while world-sized
 *      things (radius circles) scale via `projectLen()`.
 *
 * Zoom is expressed as a real **layout size** on the content box rather than a CSS
 * `scale()`, so the browser rasterises the image at the zoomed resolution. A composited
 * `scale()` (especially with `will-change`) resamples one fit-sized raster, and the map
 * turns to mush at exactly the zoom levels this feature exists for.
 *
 * ## The pan does not go through `project()`
 *
 * `project()` returns positions relative to the overlay, and the overlay carries the pan
 * as a single CSS translate (`overlayStyle`). Folding the pan into `project()` instead
 * makes every marker's position a function of the pan, so dragging the map re-renders
 * every marker in the tool — on the Live map that is hundreds of stateful components, on
 * a frame budget of 16 ms. Splitting it means a pan moves one composited element and
 * re-renders nothing; only a zoom re-projects.
 *
 * A corollary: `project()` is NOT in viewport/client space, so never compare its output
 * to a `clientX`/`clientY`. Use `toWorld()`, which is unaffected, for pointer maths.
 */

/** Pointer travel (px) that still counts as a click rather than the start of a pan. */
export const CLICK_SLOP = 4;
/** Wheel delta -> zoom factor. Applied exponentially so each notch is a constant ratio. */
const WHEEL_SENSITIVITY = 0.0015;
/** Ratio per press of the +/- buttons and the keyboard shortcuts. */
export const BUTTON_ZOOM_STEP = 1.5;
/** Ignore trivially small zoom ranges (e.g. a 554px image in a 500px box) — not worth the UI. */
export const ZOOM_EPSILON = 0.05;

/** A pointer position resolved into both world metres and content px. */
export interface MapPointerHit {
  /** World X, in metres. */
  x: number;
  /** World Z, in metres. Inverted relative to screen Y. */
  z: number;
  /** Content-space px, useful for measuring distances at a zoom-independent scale. */
  cx: number;
  cy: number;
}

export interface UseMapPanZoomOptions {
  /** Map extent in metres; both axes. */
  worldSize: number;
  /**
   * Edge of the largest available imagery, in px, when it is known up front — i.e. a tile
   * pyramid's `nativeSize`. Supplying it makes `maxScale` correct on the very first paint
   * instead of only after an image load, so the zoom controls stop popping into existence
   * a moment after the map appears. Falls back to the loaded image's own size.
   */
  nativeSize?: number;
  /**
   * Enable wheel zoom and drag-to-pan. Zoom is capped at one image pixel per CSS pixel, so
   * maps whose image is smaller than the rendered box stay fixed. Default true.
   */
  zoomable?: boolean;
  /**
   * Bind `+`/`-` to zoom on `window`. Opt-in, and off by default: the airdrop map renders at
   * up to five places at once, so a window-level listener there would fire several times per
   * keypress. Only enable it where the map is the primary content of a modal.
   */
  keyboardZoom?: boolean;
  /** Called when a press-and-release without meaningful travel lands on the map. */
  onBackgroundClick?: (hit: MapPointerHit) => void;
  /**
   * Return true to suppress the background gesture — used while a marker drag owns the
   * pointer. Marker handles should also `stopPropagation()`; this is the belt to that braces.
   */
  isGestureBlocked?: () => boolean;
}

export interface MapPanZoom {
  /** Attach to the viewport element. A callback ref, so effects can depend on the node. */
  viewportRef: (el: HTMLDivElement | null) => void;
  viewportEl: HTMLDivElement | null;
  /** Edge of the fit-to-view content square, in CSS px. 0 until first measurement. */
  size: number;
  /** Edge of the content square at the current zoom, in CSS px. */
  contentSize: number;
  viewportBox: { w: number; h: number };
  transform: MapTransform;
  maxScale: number;
  /** True when the image is big enough for zooming to be worth offering. */
  canZoom: boolean;
  atMin: boolean;
  atMax: boolean;
  isPanning: boolean;
  /**
   * Edge of the largest available imagery in px: the declared `nativeSize` when there is
   * one, otherwise the loaded image's own size. Null until either is known.
   */
  naturalSize: number | null;
  /** True once the image has failed to load — render a placeholder instead. */
  imageFailed: boolean;
  /** Spread onto the map `<img>` so the hook learns its native size and load state. */
  imageProps: {
    draggable: false;
    onLoad: (e: React.SyntheticEvent<HTMLImageElement>) => void;
    onError: () => void;
  };
  /** Spread onto the viewport element. */
  viewportHandlers: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
  };
  /** Apply to the content box. Carries the zoom as layout size and the pan as a translate. */
  contentStyle: React.CSSProperties;
  /** Apply to the marker overlay. Carries the pan only — markers never scale. */
  overlayStyle: React.CSSProperties;
  /** World position -> px within the overlay. Excludes the pan; see the header. */
  project: (x: number, z: number) => { px: number; py: number };
  /** World length (e.g. a radius) -> viewport px. */
  projectLen: (len: number) => number;
  /** Client (mouse) position -> world. Null before the map has been measured. */
  toWorld: (clientX: number, clientY: number) => MapPointerHit | null;
  zoomByStep: (direction: 1 | -1) => void;
  resetZoom: () => void;
  applyTransform: (next: MapTransform) => void;
}

export function useMapPanZoom({
  worldSize,
  nativeSize,
  zoomable = true,
  keyboardZoom = false,
  onBackgroundClick,
  isGestureBlocked,
}: UseMapPanZoomOptions): MapPanZoom {
  // A state node rather than a ref so the measurement and wheel effects can depend on it.
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<number | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [size, setSize] = useState(0);
  const [viewportBox, setViewportBox] = useState({ w: 0, h: 0 });
  const [transform, setTransform] = useState<MapTransform>(IDENTITY_TRANSFORM);
  const [isPanning, setIsPanning] = useState(false);

  // The largest imagery we know we can show, from either source. A tile manifest reports
  // the whole pyramid (so zoom is available before anything has decoded, and is not capped
  // at the small base image the layer loads first); a bare <img> can only report itself.
  const effectiveNative = Math.max(nativeSize ?? 0, naturalSize ?? 0) || null;
  const maxScale = zoomable ? computeMaxScale(effectiveNative, size) : 1;
  const canZoom = maxScale > 1 + ZOOM_EPSILON;

  // Latest values for handlers that are bound once but must not read stale state.
  const blockedRef = useRef(isGestureBlocked);
  blockedRef.current = isGestureBlocked;
  const clickRef = useRef(onBackgroundClick);
  clickRef.current = onBackgroundClick;

  // Background press: either a click or a pan, decided by how far the pointer travels. Held
  // in a ref so pointermove doesn't re-render until the gesture actually becomes a pan.
  const gestureRef = useRef({
    active: false, panning: false, pointerId: -1,
    startX: 0, startY: 0, startTx: 0, startTy: 0,
  });

  // --- Measurement ---------------------------------------------------------
  // offsetWidth, not getBoundingClientRect: maps mount inside Modal's `animate-in zoom-in-95`,
  // so a rect would report a 95%-scaled box for the first 200ms of the open animation.
  useLayoutEffect(() => {
    if (!viewportEl) return;
    const measure = () => {
      const w = viewportEl.offsetWidth;
      const h = viewportEl.offsetHeight;
      // The content is always a square fitted into the viewport; a non-square viewport
      // letterboxes (clampTransform centres it) rather than skewing the Z axis.
      setSize(Math.floor(Math.min(w, h)));
      setViewportBox({ w, h });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(viewportEl);
    return () => ro.disconnect();
  }, [viewportEl]);

  // Re-clamp whenever the box or the zoom ceiling changes (fullscreen toggle, window resize,
  // image load). Also snaps back to fit when zoom becomes unavailable.
  useEffect(() => {
    setTransform((t) => clampTransform(t, size, viewportBox.w, viewportBox.h, maxScale));
  }, [size, viewportBox.w, viewportBox.h, maxScale]);

  const applyTransform = useCallback((next: MapTransform) => {
    setTransform(clampTransform(next, size, viewportBox.w, viewportBox.h, maxScale));
  }, [size, viewportBox.w, viewportBox.h, maxScale]);

  // --- Projection ----------------------------------------------------------

  // Depends on scale, not on the whole transform: a pan leaves every marker's overlay
  // position untouched, so it must not invalidate this callback.
  const project = useCallback((x: number, z: number) =>
    worldToOverlay(x, z, worldSize, size, transform.scale), [worldSize, size, transform.scale]);

  const projectLen = useCallback((len: number) =>
    worldLenToViewport(len, worldSize, size, transform), [worldSize, size, transform]);

  const toWorld = useCallback((clientX: number, clientY: number): MapPointerHit | null => {
    if (!viewportEl || !size) return null;
    const rect = viewportEl.getBoundingClientRect();
    const { cx, cy } = viewportToContent(clientX - rect.left, clientY - rect.top, size, transform);
    return { ...contentToWorld(cx, cy, worldSize, size), cx, cy };
  }, [viewportEl, size, transform, worldSize]);

  // --- Zoom ----------------------------------------------------------------

  const zoomAbout = useCallback((factor: number, focusX: number, focusY: number) => {
    applyTransform(zoomAt(transform, clamp(transform.scale * factor, 1, maxScale), focusX, focusY));
  }, [applyTransform, transform, maxScale]);

  const zoomByStep = useCallback((direction: 1 | -1) => {
    zoomAbout(direction > 0 ? BUTTON_ZOOM_STEP : 1 / BUTTON_ZOOM_STEP,
      viewportBox.w / 2, viewportBox.h / 2);
  }, [zoomAbout, viewportBox.w, viewportBox.h]);

  const resetZoom = useCallback(() => applyTransform(IDENTITY_TRANSFORM), [applyTransform]);

  // Bound natively and non-passively: React's onWheel is registered passive at the root, so
  // preventDefault() inside it is a no-op.
  useEffect(() => {
    if (!viewportEl || !canZoom) return;
    const onWheel = (e: WheelEvent) => {
      // deltaMode 1 = lines (Firefox), 2 = pages. Without this, FF zooms ~16x slower.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewportBox.h : 1;
      const factor = Math.exp(-e.deltaY * unit * WHEEL_SENSITIVITY);
      const nextScale = clamp(transform.scale * factor, 1, maxScale);
      // Already at a limit and pushing further: let the wheel scroll the page instead of
      // silently swallowing it.
      if (Math.abs(nextScale - transform.scale) < 1e-4) return;
      e.preventDefault();
      const rect = viewportEl.getBoundingClientRect();
      applyTransform(zoomAt(transform, nextScale, e.clientX - rect.left, e.clientY - rect.top));
    };
    viewportEl.addEventListener('wheel', onWheel, { passive: false });
    return () => viewportEl.removeEventListener('wheel', onWheel);
  }, [viewportEl, canZoom, transform, maxScale, viewportBox.h, applyTransform]);

  useEffect(() => {
    if (!keyboardZoom || !canZoom) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomByStep(1); }
      else if (e.key === '-') { e.preventDefault(); zoomByStep(-1); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keyboardZoom, canZoom, zoomByStep]);

  // --- Pan scheduling ------------------------------------------------------
  // A high-polling-rate mouse fires pointermove well above 60 Hz, and each one used to be
  // a `setTransform`, i.e. a full re-render of the tool. Coalesce them onto animation
  // frames instead; nothing can be shown between frames anyway.

  const panFrameRef = useRef(0);
  const panTargetRef = useRef<{ x: number; y: number } | null>(null);
  // Clamp inputs read at flush time rather than captured, so the callbacks below stay
  // stable across a resize or a zoom mid-drag.
  const clampRef = useRef({ size, w: viewportBox.w, h: viewportBox.h, maxScale });
  clampRef.current = { size, w: viewportBox.w, h: viewportBox.h, maxScale };

  const flushPan = useCallback(() => {
    if (panFrameRef.current) {
      cancelAnimationFrame(panFrameRef.current);
      panFrameRef.current = 0;
    }
    const target = panTargetRef.current;
    if (!target) return;
    panTargetRef.current = null;
    const { size: s, w, h, maxScale: ms } = clampRef.current;
    // Functional update: the pending frame must not apply a transform captured before a
    // zoom that landed in between.
    setTransform(t => clampTransform({ ...t, x: target.x, y: target.y }, s, w, h, ms));
  }, []);

  const schedulePan = useCallback((x: number, y: number) => {
    panTargetRef.current = { x, y };
    if (!panFrameRef.current) panFrameRef.current = requestAnimationFrame(flushPan);
  }, [flushPan]);

  useEffect(() => () => {
    if (panFrameRef.current) cancelAnimationFrame(panFrameRef.current);
  }, []);

  // --- Background gesture: click vs drag-to-pan ----------------------------

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || blockedRef.current?.()) return;
    gestureRef.current = {
      active: true, panning: false, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY, startTx: transform.x, startTy: transform.y,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [transform.x, transform.y]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g.active || g.pointerId !== e.pointerId) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.panning) {
      if (Math.hypot(dx, dy) <= CLICK_SLOP) return;
      g.panning = true;
      setIsPanning(true);
    }
    // Absolute from the gesture start, not incremental: accumulating deltas against a clamp
    // makes the pan stick when you push past an edge and reverse.
    schedulePan(g.startTx + dx, g.startTy + dy);
  }, [schedulePan]);

  const endGesture = useCallback((e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gestureRef.current;
    if (!g.active || g.pointerId !== e.pointerId) return;
    const wasClick = !g.panning && !cancelled;
    gestureRef.current = { ...g, active: false, panning: false, pointerId: -1 };
    // Commit the last pan now rather than a frame later, so the transform is settled the
    // instant the gesture ends.
    flushPan();
    setIsPanning(false);
    if (wasClick) {
      // Use the press coordinates — that's what the user aimed at.
      const hit = toWorld(g.startX, g.startY);
      if (hit) clickRef.current?.(hit);
    }
  }, [toWorld, flushPan]);

  const viewportHandlers = useMemo(() => ({
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => endGesture(e, false),
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => endGesture(e, true),
  }), [onPointerDown, onPointerMove, endGesture]);

  const imageProps = useMemo(() => ({
    draggable: false as const,
    onLoad: (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = e.currentTarget;
      const n = Math.min(naturalWidth || 0, naturalHeight || 0);
      if (n > 0) setNaturalSize(n);
    },
    onError: () => setImageFailed(true),
  }), []);

  const contentStyle = useMemo<React.CSSProperties>(() => ({
    position: 'absolute',
    top: 0,
    left: 0,
    width: size ? size * transform.scale : '100%',
    height: size ? size * transform.scale : '100%',
    transform: `translate(${transform.x}px, ${transform.y}px)`,
  }), [size, transform]);

  // Same translate as the content box, over an untransformed full-viewport layer. Markers
  // are laid out inside it at `project()` positions, so they move with the map without
  // scaling and without re-rendering.
  const overlayStyle = useMemo<React.CSSProperties>(() => ({
    position: 'absolute',
    inset: 0,
    transform: `translate(${transform.x}px, ${transform.y}px)`,
  }), [transform.x, transform.y]);

  return {
    viewportRef: setViewportEl,
    viewportEl,
    size,
    contentSize: size * transform.scale,
    viewportBox,
    transform,
    maxScale,
    canZoom,
    atMin: transform.scale <= 1 + 1e-3,
    atMax: transform.scale >= maxScale - 1e-3,
    isPanning,
    naturalSize: effectiveNative,
    imageFailed,
    imageProps,
    viewportHandlers,
    contentStyle,
    overlayStyle,
    project,
    projectLen,
    toWorld,
    zoomByStep,
    resetZoom,
    applyTransform,
  };
}
