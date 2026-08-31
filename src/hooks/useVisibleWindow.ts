import { useLayoutEffect, useState } from 'react';
import type { MapPanZoom } from './useMapPanZoom';

/**
 * The region of the map currently on screen, for culling marker layers.
 *
 * Coordinates are in **overlay space** — the same space `view.project()` returns, i.e.
 * pan-free — so a caller culls by comparing projected positions directly.
 *
 * ## Why it lags the viewport on purpose
 *
 * Recomputing the visible set on every pan frame would mean a new array, a new set of
 * React elements and a full reconciliation per frame, which is most of the cost culling
 * was supposed to remove. So the window is inflated by `margin` viewports in each
 * direction and only recomputed once the view actually escapes it. Panning within the
 * margin renders nothing new; the markers just outside are already mounted.
 *
 * Returns null before the map has been measured, which callers should treat as
 * "draw nothing yet" rather than "draw everything".
 */
export interface VisibleWindow {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function contains(win: VisibleWindow, r: VisibleWindow): boolean {
  return r.x0 >= win.x0 && r.y0 >= win.y0 && r.x1 <= win.x1 && r.y1 <= win.y1;
}

export function useVisibleWindow(view: MapPanZoom, margin = 0.5): VisibleWindow | null {
  const { transform, viewportBox, size } = view;
  const [state, setState] = useState<{ win: VisibleWindow; scale: number } | null>(null);

  useLayoutEffect(() => {
    if (!size || !viewportBox.w || !viewportBox.h) return;
    // The overlay carries the pan as translate(t.x, t.y), so screen x=0 is overlay x=-t.x.
    const tight: VisibleWindow = {
      x0: -transform.x,
      y0: -transform.y,
      x1: -transform.x + viewportBox.w,
      y1: -transform.y + viewportBox.h,
    };
    // A zoom rescales every projected position, so the old window is meaningless and the
    // set has to be rebuilt regardless of where the view sits inside it.
    if (state && state.scale === transform.scale && contains(state.win, tight)) return;

    const mx = viewportBox.w * margin;
    const my = viewportBox.h * margin;
    setState({
      scale: transform.scale,
      win: { x0: tight.x0 - mx, y0: tight.y0 - my, x1: tight.x1 + mx, y1: tight.y1 + my },
    });
  }, [transform.x, transform.y, transform.scale, viewportBox.w, viewportBox.h, size, margin, state]);

  return state?.win ?? null;
}
