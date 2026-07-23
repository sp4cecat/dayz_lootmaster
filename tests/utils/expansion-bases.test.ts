import { describe, it, expect } from 'vitest';
import {
  stampVersion, zoneToDrop, applyDropToZone,
  TERRITORY_VERSION, BASEBUILDING_VERSION,
  type BuildZone,
} from '../../src/utils/expansionBases.ts';

describe('stampVersion', () => {
  it('stamps the default version when absent', () => {
    expect(stampVersion({ EnableTerritories: 1 }, TERRITORY_VERSION))
      .toEqual({ EnableTerritories: 1, m_Version: TERRITORY_VERSION });
  });

  it('preserves an existing version (never downgrades a newer file)', () => {
    expect(stampVersion({ m_Version: 9, a: 1 }, BASEBUILDING_VERSION).m_Version).toBe(9);
  });

  it('replaces a zero/invalid version with the default', () => {
    expect(stampVersion({ m_Version: 0 }, TERRITORY_VERSION).m_Version).toBe(TERRITORY_VERSION);
  });

  it('carries through fields the UI never surfaced', () => {
    const src = { m_Version: 5, SomeFutureField: 'keep', Nested: { x: 1 } };
    const out = stampVersion(src, BASEBUILDING_VERSION);
    expect(out.SomeFutureField).toBe('keep');
    expect(out.Nested).toEqual({ x: 1 });
  });

  it('returns a new object (does not mutate the input)', () => {
    const src = { a: 1 };
    const out = stampVersion(src, 6);
    expect(out).not.toBe(src);
    expect((src as any).m_Version).toBeUndefined();
  });
});

describe('zone <-> drop adapter', () => {
  const zone: BuildZone = {
    Name: 'Swamp',
    Center: [3764, 0, 9292],
    Radius: 1000,
    Items: ['Fireplace'],
    IsWhitelist: 1,
    CustomMessage: 'Too swampy to build',
  };

  it('maps Center[x,0,z] onto the map DropLocation shape', () => {
    expect(zoneToDrop(zone)).toEqual({ Name: 'Swamp', x: 3764, z: 9292, Radius: 1000 });
  });

  it('tolerates a missing/short Center', () => {
    expect(zoneToDrop({ ...zone, Center: undefined as any })).toEqual({ Name: 'Swamp', x: 0, z: 0, Radius: 1000 });
  });

  it('folds a map edit back onto the zone, preserving non-geometry fields', () => {
    const moved = applyDropToZone(zone, { Name: 'Swamp', x: 4000.6, z: 9000.2, Radius: 800.9 });
    expect(moved.Center).toEqual([4001, 0, 9000]);
    expect(moved.Radius).toBe(801);
    // Items / IsWhitelist / CustomMessage ride along untouched.
    expect(moved.Items).toEqual(['Fireplace']);
    expect(moved.IsWhitelist).toBe(1);
    expect(moved.CustomMessage).toBe('Too swampy to build');
  });

  it('keeps the existing radius when the drop omits it', () => {
    const moved = applyDropToZone(zone, { Name: 'Swamp', x: 1, z: 2 });
    expect(moved.Radius).toBe(1000);
  });

  it('round-trips coordinates through the adapter', () => {
    const back = applyDropToZone(zone, zoneToDrop(zone));
    expect(back.Center).toEqual([3764, 0, 9292]);
    expect(back.Radius).toBe(1000);
  });
});
