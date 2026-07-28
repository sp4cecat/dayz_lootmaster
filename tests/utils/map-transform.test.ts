import { describe, it, expect } from 'vitest';
import {
  computeMaxScale, worldToViewport, worldLenToViewport, viewportToContent,
  contentToWorld, zoomAt, clampTransform, IDENTITY_TRANSFORM,
  type MapTransform,
} from '../../src/utils/mapTransform.ts';

const DEER_ISLE = 16384;   // worldSize of the largest bundled map
const CHERNARUS = 15360;

describe('computeMaxScale', () => {
  it('returns 1 when the image size is unknown (never loaded / broken asset)', () => {
    expect(computeMaxScale(null, 600)).toBe(1);
    expect(computeMaxScale(0, 600)).toBe(1);
  });

  it('returns 1 when the box has not been measured yet', () => {
    expect(computeMaxScale(16384, 0)).toBe(1);
  });

  it('never goes below 1 — a small image just means no zoom, not zoom-out', () => {
    // Chernarus' asset is 554px; in a 600px box it is already displayed above native.
    expect(computeMaxScale(554, 600)).toBe(1);
  });

  it('is the ratio that puts one image pixel on one CSS pixel', () => {
    expect(computeMaxScale(554, 500)).toBeCloseTo(1.108, 3);
    expect(computeMaxScale(16384, 600)).toBeCloseTo(27.307, 3);
    expect(computeMaxScale(3072, 819)).toBeCloseTo(3.751, 3);
  });
});

describe('world <-> viewport projection', () => {
  const size = 600;

  it('maps the world origin to the bottom-left corner (Z is inverted)', () => {
    const { px, py } = worldToViewport(0, 0, DEER_ISLE, size, IDENTITY_TRANSFORM);
    expect(px).toBe(0);
    expect(py).toBe(size);
  });

  it('maps max Z to the top edge', () => {
    const { py } = worldToViewport(0, DEER_ISLE, DEER_ISLE, size, IDENTITY_TRANSFORM);
    expect(py).toBe(0);
  });

  it('maps the world centre to the box centre', () => {
    const { px, py } = worldToViewport(DEER_ISLE / 2, DEER_ISLE / 2, DEER_ISLE, size, IDENTITY_TRANSFORM);
    expect(px).toBe(size / 2);
    expect(py).toBe(size / 2);
  });

  it('reproduces the pre-zoom formula exactly under the identity transform', () => {
    // Regression lock against the original (pos / worldSize) * size and
    // worldSize - pxToWorld(relY, size) implementation.
    for (const [x, z] of [[0, 0], [1234, 9876], [15360, 15360], [7680, 100]]) {
      const { px, py } = worldToViewport(x, z, CHERNARUS, size, IDENTITY_TRANSFORM);
      expect(px).toBeCloseTo((x / CHERNARUS) * size, 10);
      expect(py).toBeCloseTo(size - (z / CHERNARUS) * size, 10);
    }
  });

  it('round-trips world -> viewport -> content -> world under several transforms', () => {
    const transforms: MapTransform[] = [
      IDENTITY_TRANSFORM,
      { x: 0, y: 0, scale: 4 },
      { x: -320, y: -880, scale: 6.5 },
      { x: 55, y: -12, scale: 1.25 },
    ];
    for (const t of transforms) {
      for (const [x, z] of [[4096, 12288], [1, 16383], [8192, 8192]]) {
        const { px, py } = worldToViewport(x, z, DEER_ISLE, size, t);
        const { cx, cy } = viewportToContent(px, py, size, t);
        const back = contentToWorld(cx, cy, DEER_ISLE, size);
        expect(back.x).toBeCloseTo(x, 6);
        expect(back.z).toBeCloseTo(z, 6);
      }
    }
  });

  it('scales world lengths by the zoom factor', () => {
    const t = { x: 0, y: 0, scale: 3 };
    // A 1000m radius on a 16384m world in a 600px box: 36.6px at fit, 3x that zoomed.
    expect(worldLenToViewport(1000, DEER_ISLE, size, IDENTITY_TRANSFORM)).toBeCloseTo(36.621, 3);
    expect(worldLenToViewport(1000, DEER_ISLE, size, t)).toBeCloseTo(109.863, 3);
  });
});

describe('viewportToContent clamping', () => {
  const size = 600;

  it('clamps to the map square when the pointer leaves the image', () => {
    expect(viewportToContent(-500, -500, size, IDENTITY_TRANSFORM)).toEqual({ cx: 0, cy: 0 });
    expect(viewportToContent(9999, 9999, size, IDENTITY_TRANSFORM)).toEqual({ cx: size, cy: size });
  });

  it('clamps in content space, not screen space, while panned', () => {
    // Panned so content x=0 sits at viewport x=-1200. A pointer at viewport 0 is well
    // inside the map, and must NOT be clamped to the left edge the way a raw
    // clamp(clientX - rect.left, 0, size) would have done.
    const t = { x: -1200, y: 0, scale: 4 };
    expect(viewportToContent(0, 0, size, t).cx).toBeCloseTo(300, 6);
  });
});

describe('zoomAt', () => {
  const size = 600;

  it('keeps the world point under the cursor pinned while zooming', () => {
    // The single most valuable assertion here: project a world point, zoom about its
    // viewport position, re-project, and it must not have moved.
    let t: MapTransform = IDENTITY_TRANSFORM;
    const [wx, wz] = [11230, 10190];
    const before = worldToViewport(wx, wz, DEER_ISLE, size, t);

    for (const nextScale of [1.7, 4, 12, 27.3]) {
      t = zoomAt(t, nextScale, before.px, before.py);
      const after = worldToViewport(wx, wz, DEER_ISLE, size, t);
      expect(after.px).toBeCloseTo(before.px, 9);
      expect(after.py).toBeCloseTo(before.py, 9);
    }
  });

  it('is a no-op when the scale does not change', () => {
    const t = { x: -40, y: 17, scale: 2.5 };
    const next = zoomAt(t, 2.5, 123, 456);
    expect(next.x).toBeCloseTo(t.x, 9);
    expect(next.y).toBeCloseTo(t.y, 9);
    expect(next.scale).toBe(2.5);
  });
});

describe('clampTransform', () => {
  const size = 600;

  it('forces the identity transform at scale 1 in a square viewport', () => {
    expect(clampTransform({ x: -250, y: 400, scale: 1 }, size, size, size, 8))
      .toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('clamps scale into [1, maxScale]', () => {
    expect(clampTransform({ x: 0, y: 0, scale: 0.2 }, size, size, size, 8).scale).toBe(1);
    expect(clampTransform({ x: 0, y: 0, scale: 99 }, size, size, size, 8).scale).toBe(8);
  });

  it('treats a maxScale below 1 as no zoom at all', () => {
    expect(clampTransform({ x: 0, y: 0, scale: 3 }, size, size, size, 0.6).scale).toBe(1);
  });

  it('centres an axis when the scaled image is smaller than the viewport', () => {
    // 600px content in an 800px-wide viewport at scale 1 -> 100px of letterboxing each side.
    expect(clampTransform({ x: -999, y: 0, scale: 1 }, size, 800, 600, 4).x).toBe(100);
  });

  it('pins the edges so the image cannot be dragged off screen', () => {
    // At scale 4 the span is 2400px in a 600px viewport: x may range over [-1800, 0].
    expect(clampTransform({ x: 500, y: 0, scale: 4 }, size, 600, 600, 8).x).toBe(0);
    expect(clampTransform({ x: -9999, y: 0, scale: 4 }, size, 600, 600, 8).x).toBe(-1800);
    expect(clampTransform({ x: -900, y: 0, scale: 4 }, size, 600, 600, 8).x).toBe(-900);
  });
});
