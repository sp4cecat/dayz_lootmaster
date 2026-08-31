import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useMapPanZoom, type MapPanZoom, type MapPointerHit } from '../../src/hooks/useMapPanZoom';
import { MapZoomControls } from '../../src/components/MapZoomControls';
import { worldToViewport } from '../../src/utils/mapTransform';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

const BOX = 600;
const WORLD = 12000;
/** A Deer-Isle-sized source image: 16384 / 600 gives a maxScale of ~27.3. */
const NATIVE = 16384;

/**
 * jsdom has no layout engine, no ResizeObserver, no PointerEvent and no pointer capture,
 * so the hook can't measure itself or receive gestures without these. Everything stubbed
 * here is browser plumbing, not behaviour under test.
 */
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => BOX });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => BOX });
  Element.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: BOX, bottom: BOX, width: BOX, height: BOX,
    toJSON: () => ({}),
  });
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
});

/** jsdom has no PointerEvent constructor; React 19 listens for the native type name. */
function pointer(el: Element, type: string, clientX: number, clientY: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'button', { value: 0 });
  el.dispatchEvent(e);
}

/** The most recent render's hook value, so tests can drive imperative APIs. */
let view: MapPanZoom;

function Harness({ onClick, blocked }: {
  onClick?: (hit: MapPointerHit) => void;
  blocked?: () => boolean;
}) {
  const v = useMapPanZoom({ worldSize: WORLD, keyboardZoom: true, onBackgroundClick: onClick, isGestureBlocked: blocked });
  view = v;
  return (
    <div ref={v.viewportRef} {...v.viewportHandlers} data-testid="viewport">
      <div style={v.contentStyle} data-testid="content" />
      {v.canZoom && <MapZoomControls map={v} />}
    </div>
  );
}

async function render(props: Parameters<typeof Harness>[0] = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => { createRoot(container).render(<Harness {...props} />); });
  return container.firstElementChild as HTMLElement;
}

/** jsdom never fires <img> load with real dimensions, so feed the hook the size directly. */
async function loadImage(naturalSize = NATIVE) {
  await act(async () => {
    view.imageProps.onLoad({
      currentTarget: { naturalWidth: naturalSize, naturalHeight: naturalSize },
    } as unknown as React.SyntheticEvent<HTMLImageElement>);
  });
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('useMapPanZoom — background gesture', () => {
  it('treats a press-and-release in place as a click, in world coordinates', async () => {
    const onClick = vi.fn();
    const vp = await render({ onClick });

    // Dead centre of a 600px box on a 12000m world -> (6000, 6000).
    await act(async () => {
      pointer(vp, 'pointerdown', 300, 300);
      pointer(vp, 'pointerup', 300, 300);
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0]).toMatchObject({ x: 6000, z: 6000 });
  });

  it('inverts the Z axis relative to screen Y', async () => {
    const onClick = vi.fn();
    const vp = await render({ onClick });

    await act(async () => {
      pointer(vp, 'pointerdown', 0, 0);
      pointer(vp, 'pointerup', 0, 0);
    });

    // Top-left of the screen is the maximum Z corner of the world.
    expect(onClick.mock.calls[0][0]).toMatchObject({ x: 0, z: WORLD });
  });

  it('treats travel past the slop as a pan, not a click', async () => {
    const onClick = vi.fn();
    const vp = await render({ onClick });

    await act(async () => {
      pointer(vp, 'pointerdown', 300, 300);
      pointer(vp, 'pointermove', 320, 300); // 20px, well past CLICK_SLOP
      pointer(vp, 'pointerup', 320, 300);
    });

    expect(onClick).not.toHaveBeenCalled();
  });

  it('tolerates jitter within the slop and uses the press coordinates', async () => {
    const onClick = vi.fn();
    const vp = await render({ onClick });

    await act(async () => {
      pointer(vp, 'pointerdown', 300, 300);
      pointer(vp, 'pointermove', 302, 301); // ~2.2px, under CLICK_SLOP
      pointer(vp, 'pointerup', 302, 301);
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0]).toMatchObject({ x: 6000, z: 6000 });
  });

  it('suppresses the gesture entirely while a marker drag owns the pointer', async () => {
    const onClick = vi.fn();
    const vp = await render({ onClick, blocked: () => true });

    await act(async () => {
      pointer(vp, 'pointerdown', 300, 300);
      pointer(vp, 'pointerup', 300, 300);
    });

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('useMapPanZoom — zoom', () => {
  it('offers no zoom, and no controls, until the image proves it has the pixels', async () => {
    const vp = await render();
    expect(view.canZoom).toBe(false);
    expect(view.maxScale).toBe(1);
    expect(vp.querySelector('button[title="Zoom in"]')).toBeNull();
  });

  it('leaves the wheel alone at the fit limit so the page can still scroll', async () => {
    const vp = await render();
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -240 });
    await act(async () => { vp.dispatchEvent(wheel); });
    expect(wheel.defaultPrevented).toBe(false);
  });

  it('caps zoom at one image pixel per CSS pixel and reveals the controls', async () => {
    const vp = await render();
    await loadImage();

    expect(view.canZoom).toBe(true);
    expect(view.maxScale).toBeCloseTo(NATIVE / BOX, 6);
    expect(vp.querySelector('button[title="Zoom in"]')).not.toBeNull();
    // At fit, "zoom out" and "reset" are the redundant ones.
    expect((vp.querySelector('button[title="Zoom out"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('expresses zoom as layout size, not a CSS scale (which would resample the image)', async () => {
    const vp = await render();
    await loadImage();
    await act(async () => { view.zoomByStep(1); });

    const content = vp.querySelector('[data-testid="content"]') as HTMLElement;
    // 600px box at the 1.5x button step -> a real 900px layout box, and only the pan is a
    // transform. A `scale(1.5)` here would keep width at 600px and blur the map.
    expect(content.style.width).toBe('900px');
    expect(content.style.height).toBe('900px');
    expect(content.style.transform).toBe('translate(-150px, -150px)');
  });

  it('keeps click coordinates exact while zoomed — the main regression risk', async () => {
    const onClick = vi.fn();
    const vp = await render({ onClick });
    await loadImage();
    await act(async () => { view.zoomByStep(1) });

    // Zoomed 1.5x about the box centre, so the centre still maps to the world centre...
    await act(async () => {
      pointer(vp, 'pointerdown', 300, 300);
      pointer(vp, 'pointerup', 300, 300);
    });
    expect(onClick.mock.calls[0][0].x).toBeCloseTo(6000, 6);
    expect(onClick.mock.calls[0][0].z).toBeCloseTo(6000, 6);

    // ...while the top-left of the viewport is now well inside the map, not its corner.
    await act(async () => {
      pointer(vp, 'pointerdown', 0, 0);
      pointer(vp, 'pointerup', 0, 0);
    });
    expect(onClick.mock.calls[1][0].x).toBeCloseTo(2000, 6);
    expect(onClick.mock.calls[1][0].z).toBeCloseTo(10000, 6);
  });

  it('clamps the pan so the map can never be dragged off screen', async () => {
    const vp = await render();
    await loadImage();
    await act(async () => { view.zoomByStep(1); });

    // Span is 900px in a 600px viewport, so x may only range over [-300, 0].
    await act(async () => {
      pointer(vp, 'pointerdown', 300, 300);
      pointer(vp, 'pointermove', 9999, 300);
      pointer(vp, 'pointerup', 9999, 300);
    });
    expect(view.transform.x).toBe(0);

    await act(async () => {
      pointer(vp, 'pointerdown', 300, 300);
      pointer(vp, 'pointermove', -9999, 300);
      pointer(vp, 'pointerup', -9999, 300);
    });
    expect(view.transform.x).toBe(-300);
  });

  it('resets to a centred fit', async () => {
    await render();
    await loadImage();
    await act(async () => { view.zoomByStep(1); });
    expect(view.transform.scale).toBeCloseTo(1.5, 6);

    await act(async () => { view.resetZoom(); });
    expect(view.transform).toEqual({ x: 0, y: 0, scale: 1 });
    expect(view.atMin).toBe(true);
  });

  it('snaps back to fit when the image turns out to be unzoomable', async () => {
    await render();
    await loadImage();
    await act(async () => { view.zoomByStep(1); });
    expect(view.transform.scale).toBeGreaterThan(1);

    // A 554px Chernarus asset in a 600px box: already above native, so no zoom is available
    // and any existing zoom must be given up rather than left stranded past the new ceiling.
    await loadImage(554);
    expect(view.canZoom).toBe(false);
    expect(view.transform).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('zooms with the keyboard when enabled', async () => {
    await render();
    await loadImage();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }));
    });
    expect(view.transform.scale).toBeCloseTo(1.5, 6);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true, cancelable: true }));
    });
    expect(view.transform.scale).toBeCloseTo(1, 6);
  });
});

/**
 * The pan was moved out of `project()` and onto a CSS translate on the marker overlay, so
 * that dragging the map re-renders no markers. That is only safe if the two halves still
 * compose to exactly what a marker used to be given — otherwise every marker in the app
 * silently drifts off the terrain under it, which no unit test of either half alone would
 * catch.
 */
describe('useMapPanZoom — the overlay carries the pan', () => {
  /** `translate(12px, -3px)` -> [12, -3]. */
  function translationOf(style: React.CSSProperties): [number, number] {
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(String(style.transform));
    if (!m) throw new Error(`no translate in ${style.transform}`);
    return [Number(m[1]), Number(m[2])];
  }

  const POINTS: [number, number][] = [
    [0, 0], [WORLD, WORLD], [WORLD / 2, WORLD / 2], [1234, 9876], [WORLD, 0],
  ];

  it('places every marker exactly where the full projection would, at any pan and zoom', async () => {
    const vp = await render();
    await loadImage();

    for (const scale of [1, 2.5, 9]) {
      await act(async () => { view.applyTransform({ x: 0, y: 0, scale }); });
      // Drag somewhere non-trivial; clampTransform decides where it actually lands.
      await act(async () => {
        pointer(vp, 'pointerdown', 400, 400);
        pointer(vp, 'pointermove', 260, 330);
        pointer(vp, 'pointerup', 260, 330);
      });

      const [tx, ty] = translationOf(view.overlayStyle);
      expect(tx).toBe(view.transform.x);
      expect(ty).toBe(view.transform.y);

      for (const [x, z] of POINTS) {
        const marker = view.project(x, z);
        const full = worldToViewport(x, z, WORLD, view.size, view.transform);
        expect(marker.px + tx).toBeCloseTo(full.px, 9);
        expect(marker.py + ty).toBeCloseTo(full.py, 9);
      }
    }
  });

  it('does not change a projected position when only the pan changes', async () => {
    const vp = await render();
    await loadImage();
    await act(async () => { view.applyTransform({ x: 0, y: 0, scale: 4 }); });

    const before = view.project(WORLD / 3, WORLD / 3);
    const panBefore = view.transform.x;

    await act(async () => {
      pointer(vp, 'pointerdown', 500, 500);
      pointer(vp, 'pointermove', 300, 420);
      pointer(vp, 'pointerup', 300, 420);
    });

    expect(view.transform.x).not.toBe(panBefore);   // the map really did move
    expect(view.project(WORLD / 3, WORLD / 3)).toEqual(before);
  });
});

/**
 * Pointermove used to call setTransform directly, which on a high-polling-rate mouse is
 * well over 60 re-renders of the whole tool per second. It is now coalesced onto animation
 * frames — so the thing worth testing is that a drag still moves the map *while the button
 * is held*, not only when it is released.
 */
describe('useMapPanZoom — the pan is coalesced onto animation frames', () => {
  const frame = () => act(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });

  it('applies a held drag on the next frame, without waiting for pointerup', async () => {
    const vp = await render();
    await loadImage();
    await act(async () => { view.applyTransform({ x: 0, y: 0, scale: 2 }); });

    await act(async () => {
      pointer(vp, 'pointerdown', 400, 400);
      pointer(vp, 'pointermove', 300, 300);
    });
    await frame();

    expect(view.isPanning).toBe(true);
    expect(view.transform.x).toBe(-100);
    expect(view.transform.y).toBe(-100);

    // Many moves in one frame collapse to the last one — that is the whole point.
    await act(async () => {
      pointer(vp, 'pointermove', 380, 360);
      pointer(vp, 'pointermove', 360, 350);
      pointer(vp, 'pointermove', 340, 340);
    });
    await frame();
    expect(view.transform.x).toBe(-60);
    expect(view.transform.y).toBe(-60);
  });

  it('commits the final position on pointerup rather than a frame later', async () => {
    const vp = await render();
    await loadImage();
    await act(async () => { view.applyTransform({ x: 0, y: 0, scale: 2 }); });

    await act(async () => {
      pointer(vp, 'pointerdown', 400, 400);
      pointer(vp, 'pointermove', 250, 250);
      pointer(vp, 'pointerup', 250, 250);
    });
    // No frame awaited: a settled gesture must not leave the map lagging behind.
    expect(view.transform.x).toBe(-150);
    expect(view.isPanning).toBe(false);
  });
});
