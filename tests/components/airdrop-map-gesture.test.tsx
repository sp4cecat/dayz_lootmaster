import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { AirdropDropLocationMap, type DropLocation } from '../../src/components/AirdropDropLocationMap';
import type { MapMetadata } from '../../src/consts/maps';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

const BOX = 600;
const WORLD = 12000;

const MAP: MapMetadata = {
  id: 'test', displayName: 'Test Map', worldSize: WORLD, imagePath: '/test.jpg',
};

/**
 * jsdom has no layout engine, no ResizeObserver, no PointerEvent and no pointer capture,
 * so the map can't measure itself or receive pointer gestures without these. Everything
 * stubbed here is browser plumbing, not component behaviour.
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

async function render(locations: DropLocation[], onChange: (l: DropLocation[]) => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <AirdropDropLocationMap
        map={MAP} locations={locations} selectedIndex={0}
        onSelect={() => {}} onChange={onChange}
      />
    );
  });
  // The viewport is the outermost rendered element.
  return container.firstElementChild as HTMLElement;
}

describe('AirdropDropLocationMap background gesture', () => {
  const initial: DropLocation[] = [{ Name: 'A', x: 1000, z: 2000, Radius: 300 }];

  it('treats a press-and-release in place as a click that moves the selected location', async () => {
    const onChange = vi.fn();
    const viewport = await render(initial, onChange);

    // Dead centre of a 600px box on a 12000m world -> (6000, 6000).
    await act(async () => {
      pointer(viewport, 'pointerdown', 300, 300);
      pointer(viewport, 'pointerup', 300, 300);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ x: 6000, z: 6000 });
  });

  it('inverts the Z axis relative to screen Y', async () => {
    const onChange = vi.fn();
    const viewport = await render(initial, onChange);

    // Top-left corner -> world (0, worldSize).
    await act(async () => {
      pointer(viewport, 'pointerdown', 0, 0);
      pointer(viewport, 'pointerup', 0, 0);
    });

    expect(onChange.mock.calls[0][0][0]).toMatchObject({ x: 0, z: WORLD });
  });

  it('tolerates jitter within the click threshold', async () => {
    const onChange = vi.fn();
    const viewport = await render(initial, onChange);

    await act(async () => {
      pointer(viewport, 'pointerdown', 300, 300);
      pointer(viewport, 'pointermove', 302, 301); // ~2.2px, under CLICK_SLOP
      pointer(viewport, 'pointerup', 302, 301);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    // Still uses the press coordinates, not the release ones.
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ x: 6000, z: 6000 });
  });

  it('treats a drag as a pan and does NOT move the selected location', async () => {
    const onChange = vi.fn();
    const viewport = await render(initial, onChange);

    await act(async () => {
      pointer(viewport, 'pointerdown', 300, 300);
      pointer(viewport, 'pointermove', 320, 300); // 20px, well past CLICK_SLOP
      pointer(viewport, 'pointerup', 320, 300);
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows no zoom controls when the image is too small to zoom into', async () => {
    // jsdom never fires <img> load, so naturalSize stays null and computeMaxScale returns 1 —
    // the same state a real 554px Chernarus asset reaches in a 600px box. Controls must be
    // absent and the wheel must stay untrapped so the page can still scroll.
    const viewport = await render(initial, vi.fn());

    expect(viewport.querySelector('button[title="Zoom in"]')).toBeNull();

    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -240 });
    await act(async () => { viewport.dispatchEvent(wheel); });
    expect(wheel.defaultPrevented).toBe(false);
  });

  it('does nothing on a click when no location is selected', async () => {
    const onChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AirdropDropLocationMap
          map={MAP} locations={initial} selectedIndex={null}
          onSelect={() => {}} onChange={onChange}
        />
      );
    });
    const viewport = container.firstElementChild as HTMLElement;

    await act(async () => {
      pointer(viewport, 'pointerdown', 100, 100);
      pointer(viewport, 'pointerup', 100, 100);
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
