import { describe, it, expect } from 'vitest';
import {
  SESSION_CAP_MS, SESSION_FALLBACK_MS, TICKER_KINDS, WINDOW_PRESET_MS,
  historyDeepLinkParams, quantiseNow, sessionStartFrom, windowFor,
} from '../../src/utils/liveWindow';

const STEP = 30_000;
// A step boundary, so the fixed-point and stability cases mean what they say.
const NOW = 1_700_000_010_000;

describe('quantiseNow', () => {
  it('rounds up to the next step so the window always covers the present', () => {
    expect(quantiseNow(NOW + 1, STEP)).toBe(NOW + STEP);
    expect(quantiseNow(NOW + STEP - 1, STEP)).toBe(NOW + STEP);
  });

  it('is a fixed point on a boundary', () => {
    expect(quantiseNow(NOW, STEP)).toBe(NOW);
  });

  it('is stable within a step, so a 5 s re-render cannot move a fetch key', () => {
    const a = quantiseNow(NOW + 1_000, STEP);
    const b = quantiseNow(NOW + 6_000, STEP);
    const c = quantiseNow(NOW + 29_000, STEP);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe('windowFor', () => {
  it('resolves the fixed presets relative to now', () => {
    expect(windowFor('15m', NOW, null)).toEqual({ from: NOW - WINDOW_PRESET_MS['15m'], to: NOW });
    expect(windowFor('1h', NOW, null)).toEqual({ from: NOW - WINDOW_PRESET_MS['1h'], to: NOW });
    expect(windowFor('6h', NOW, null)).toEqual({ from: NOW - WINDOW_PRESET_MS['6h'], to: NOW });
  });

  it('starts a session window at the connect when it is inside the cap', () => {
    const start = NOW - 2 * 3600_000;
    expect(windowFor('session', NOW, start)).toEqual({ from: start, to: NOW });
  });

  it('caps a session window at 6 h for a connect further back than that', () => {
    const start = NOW - 9 * 3600_000;
    expect(windowFor('session', NOW, start)).toEqual({ from: NOW - SESSION_CAP_MS, to: NOW });
  });

  it('falls back to the last hour when nothing says when the session began', () => {
    expect(windowFor('session', NOW, null)).toEqual({ from: NOW - SESSION_FALLBACK_MS, to: NOW });
  });
});

describe('sessionStartFrom', () => {
  it('uses the newest connect when there is one', () => {
    expect(sessionStartFrom(NOW - 1000, true, NOW)).toEqual({ sessionStart: NOW - 1000, sessionKind: 'connect' });
  });

  // The longest sessions must not get the shortest windows.
  it('treats "no connect but the mod emits them" as a session longer than the lookup', () => {
    expect(sessionStartFrom(null, true, NOW)).toEqual({ sessionStart: NOW - SESSION_CAP_MS, sessionKind: 'capped' });
  });

  it('admits it does not know on a mod without event hooks', () => {
    expect(sessionStartFrom(null, false, NOW)).toEqual({ sessionStart: null, sessionKind: 'unknown' });
  });
});

describe('TICKER_KINDS', () => {
  it('shows kills alongside deaths', () => {
    expect(TICKER_KINDS).toContain('death');
    expect(TICKER_KINDS).toContain('kill');
  });

  it('leaves hits and damage taken out, or a firefight would flood the list', () => {
    expect(TICKER_KINDS).not.toContain('hit');
    expect(TICKER_KINDS).not.toContain('damaged');
  });
});

describe('historyDeepLinkParams', () => {
  it('stringifies the range so the hash router can carry it', () => {
    expect(historyDeepLinkParams('765', 1000.4, 2000.6)).toEqual({ pid: '765', from: '1000', to: '2001' });
  });
});
