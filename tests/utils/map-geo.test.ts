import { describe, it, expect } from 'vitest';
import {
  formatWorldPos, formatPosXml, distanceBearing, compassPoint, formatDistance,
} from '../../src/utils/mapGeo.ts';

describe('formatWorldPos', () => {
  it('emits the GAME order x y z, with the height in the middle', () => {
    // The whole point of this helper: DayZ's y is the height, so the two horizontal
    // axes are the outer components. Getting this backwards silently teleports things
    // into the sky, which is exactly the mistake the GameLabs wire format invites.
    expect(formatWorldPos(7412, 9834)).toBe('7412 0 9834');
    expect(formatWorldPos(7412, 9834, 128)).toBe('7412 128 9834');
  });

  it('defaults the height to 0 — "snap to the surface" for a point picked off a 2D map', () => {
    expect(formatWorldPos(1, 2).split(' ')[1]).toBe('0');
  });

  it('rounds to a tenth of a metre rather than printing float noise', () => {
    expect(formatWorldPos(0.1 + 0.2, 1234.5678)).toBe('0.3 0 1234.6');
  });
});

describe('formatPosXml', () => {
  it('is the cfgeventspawns shape: x/z/a, and no height', () => {
    expect(formatPosXml(4341, 8225)).toBe('<pos x="4341.0" z="8225.0" a="0.0" />');
  });

  it('carries a yaw when given one', () => {
    expect(formatPosXml(10, 20, 90)).toContain('a="90.0"');
  });
});

describe('distanceBearing', () => {
  const origin = { x: 1000, z: 1000 };

  it('measures planar distance in metres', () => {
    expect(distanceBearing(origin, { x: 1300, z: 1400 }).metres).toBeCloseTo(500, 6);
  });

  it('is zero-distance and due north for a point on itself', () => {
    expect(distanceBearing(origin, origin).metres).toBe(0);
  });

  it('treats world +Z as north and +X as east', () => {
    const bearing = (x: number, z: number) => distanceBearing(origin, { x, z }).bearingDeg;
    expect(bearing(1000, 1100)).toBeCloseTo(0, 6);    // north
    expect(bearing(1100, 1000)).toBeCloseTo(90, 6);   // east
    expect(bearing(1000, 900)).toBeCloseTo(180, 6);   // south
    expect(bearing(900, 1000)).toBeCloseTo(270, 6);   // west — not -90
  });

  it('normalises the western half into [0, 360) rather than leaving atan2 negatives', () => {
    const { bearingDeg } = distanceBearing(origin, { x: 900, z: 1100 });
    expect(bearingDeg).toBeCloseTo(315, 6);
  });

  it('is a diagonal at 45° when the legs are equal', () => {
    const { metres, bearingDeg } = distanceBearing(origin, { x: 1100, z: 1100 });
    expect(metres).toBeCloseTo(141.421, 3);
    expect(bearingDeg).toBeCloseTo(45, 6);
  });
});

describe('compassPoint', () => {
  it('snaps to the nearest of the eight points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(44)).toBe('NE');
    expect(compassPoint(91)).toBe('E');
    // 200 is still nearer due south (180) than south-west (225); 210 tips over.
    expect(compassPoint(200)).toBe('S');
    expect(compassPoint(210)).toBe('SW');
  });

  it('wraps 360 back to north instead of running off the end of the table', () => {
    expect(compassPoint(360)).toBe('N');
    expect(compassPoint(359)).toBe('N');
  });
});

describe('formatDistance', () => {
  it('uses metres below a kilometre and kilometres above', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(437.4)).toBe('437 m');
    expect(formatDistance(999)).toBe('999 m');
    expect(formatDistance(1000)).toBe('1.00 km');
    expect(formatDistance(12345)).toBe('12.35 km');
  });
});
