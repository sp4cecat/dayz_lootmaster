import { describe, it, expect } from 'vitest';
import { MAX_TRACKS, TRACK_COLORS, trackColors } from '../../src/utils/trackColors';

describe('trackColors', () => {
  it('assigns by position in the selection', () => {
    const c = trackColors(['a', 'b', 'c']);
    expect(c.get('a')).toBe(TRACK_COLORS[0]);
    expect(c.get('b')).toBe(TRACK_COLORS[1]);
    expect(c.get('c')).toBe(TRACK_COLORS[2]);
  });

  it('leaves existing players their colour when another is added', () => {
    // Selection is append-on-click, so watching two survivors and adding a third
    // must not recolour the two already on the map mid-replay.
    const before = trackColors(['a', 'b']);
    const after = trackColors(['a', 'b', 'c']);
    expect(after.get('a')).toBe(before.get('a'));
    expect(after.get('b')).toBe(before.get('b'));
  });

  it('has no colour for a player who is not selected', () => {
    // The roster swatch keys off this: an unselected row wears no colour, because
    // nothing on the map is wearing one for it.
    expect(trackColors(['a']).get('b')).toBeUndefined();
  });

  it('cycles once past the palette, which is why the selection is capped', () => {
    const pids = Array.from({ length: MAX_TRACKS + 1 }, (_, i) => `p${i}`);
    const c = trackColors(pids);
    expect(c.get(`p${MAX_TRACKS}`)).toBe(c.get('p0'));
    expect(MAX_TRACKS).toBe(TRACK_COLORS.length);
  });

  it('keys off the selection, so a player with no samples keeps their slot', () => {
    // Tracks come back filtered to whoever actually had rows. Deriving colour from
    // that array would let a player with no samples donate their colour to the next.
    const c = trackColors(['quiet', 'busy']);
    expect(c.get('busy')).toBe(TRACK_COLORS[1]);
  });
});
