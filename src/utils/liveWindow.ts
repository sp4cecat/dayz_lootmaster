/**
 * Time windows for the Live Map's history integration.
 *
 * The history hooks key their fetches on `from`/`to`, and the live map re-renders
 * every 5 s on the snapshot poll. A `Date.now()` read on each render would therefore
 * refetch every history query five seconds apart, for no new information. Everything
 * here works off a QUANTISED clock instead: `to` only changes on a step boundary, so a
 * snapshot tick can never touch a fetch key.
 *
 * Pure so it can be unit-tested in jsdom, where nothing else about a map can be.
 */

export type WindowPreset = '15m' | '1h' | '6h' | 'session';

export const WINDOW_PRESETS: readonly WindowPreset[] = ['15m', '1h', '6h', 'session'];

export const WINDOW_PRESET_MS: Record<Exclude<WindowPreset, 'session'>, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
};

/** The most a "session" window is allowed to reach back. */
export const SESSION_CAP_MS = 6 * 60 * 60_000;
/** Used when nothing says when the session began. */
export const SESSION_FALLBACK_MS = 60 * 60_000;
/**
 * How far back the connect lookup searches. Wider than the cap on purpose: a player
 * seven hours in has no connect inside a 6 h lookup, and the wrong answer to that is
 * the 1 h fallback — the longest sessions would get the shortest windows.
 */
export const SESSION_LOOKUP_MS = 24 * 60 * 60_000;
/** The connect lookup re-runs on this grain; a session start does not move. */
export const SESSION_LOOKUP_STEP_MS = 5 * 60_000;

/** The one kind the session lookup asks for. Module-level so the fetch key is stable. */
export const CONNECT_KINDS: readonly string[] = ['connect'];

/**
 * What the server-wide ticker shows: things an admin reacts to, not every pickup.
 *
 * `kill` is in (a player killing something is news); `hit` and `damaged` are not.
 * A firefight is dozens of hits a minute and a horde is a `damaged` per bite, so
 * either would push every death and connect out of a 15-minute list within
 * seconds. They stay in the Player History feed, which has filter chips.
 */
export const TICKER_KINDS: readonly string[] = ['death', 'kill', 'connect', 'disconnect', 'kicked', 'warned', 'banned'];
export const TICKER_SPAN_MS = 15 * 60_000;

/** How far a player can be and still count as "nearby" in the card. */
export const NEARBY_RADIUS_M = 500;

/**
 * Upper bounds for the vitals meters. From P:\scripts\3_game\playerconstants.c
 * (SL_ENERGY_MAX / SL_WATER_MAX = 5000) and the engine's GlobalHealth and shock
 * ranges; blood tops out at 5000 in PlayerStats.
 */
export const VITAL_MAX = {
  health: 100,
  blood: 5000,
  shock: 100,
  energy: 5000,
  water: 5000,
} as const;

/**
 * Round an instant UP to the next multiple of `step`.
 *
 * Ceil rather than floor so the window always covers the present: a `to` that sat
 * up to a step in the past would drop the most recent samples, and the inventory
 * panel's "widen `to` past a fresh capture" logic assumes `to >= now`.
 */
export function quantiseNow(ms: number, stepMs: number): number {
  return Math.ceil(ms / stepMs) * stepMs;
}

export type SessionKind = 'connect' | 'capped' | 'unknown';

/**
 * Where the current session starts, from what the connect lookup found.
 *
 * Three outcomes, each with a different honest label:
 *  - a connect inside the lookup → that instant ('connect');
 *  - none, but the mod does emit connects → they have been on longer than the lookup,
 *    so the window is simply the cap ('capped');
 *  - none, and the window holds no connects for anyone → the mod predates the event
 *    hooks, and nothing can say when they joined ('unknown', fallback length).
 */
export function sessionStartFrom(
  newestConnect: number | null,
  modEmitsConnects: boolean,
  now: number,
): { sessionStart: number | null; sessionKind: SessionKind } {
  if (newestConnect != null) return { sessionStart: newestConnect, sessionKind: 'connect' };
  if (modEmitsConnects) return { sessionStart: now - SESSION_CAP_MS, sessionKind: 'capped' };
  return { sessionStart: null, sessionKind: 'unknown' };
}

/** The `[from, to]` a preset resolves to at `now`. */
export function windowFor(
  preset: WindowPreset,
  now: number,
  sessionStart: number | null,
): { from: number; to: number } {
  if (preset !== 'session') return { from: now - WINDOW_PRESET_MS[preset], to: now };
  if (sessionStart == null) return { from: now - SESSION_FALLBACK_MS, to: now };
  return { from: Math.max(sessionStart, now - SESSION_CAP_MS), to: now };
}

/**
 * Query params for the Player History deep link. Matches what `useHistorySeed`
 * in PlayerHistoryView reads: a pid list and a complete, ordered range.
 */
export function historyDeepLinkParams(pid: string, from: number, to: number): Record<string, string> {
  return { pid, from: String(Math.round(from)), to: String(Math.round(to)) };
}

/** The screen the deep link lands on. */
export const HISTORY_VIEW = 'map-tools:player-history';
