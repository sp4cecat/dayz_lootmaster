import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nextPresence, type PresenceSegment } from '@/utils/trackSampling';

/**
 * A scrubbable clock over a fixed time window, advanced by requestAnimationFrame.
 *
 * Playback time advances at `speed` x wall-clock, so at 60x a minute of real time
 * replays in a second. The clock is driven off the rAF timestamp delta rather than
 * a setInterval tick: an interval drifts, and worse, it keeps firing while the tab
 * is hidden, so a user who switches away for a minute comes back to a playhead
 * that has silently jumped (or, at 60x, run off the end).
 *
 * The current time is state (the view re-renders each frame during playback), but
 * the frame loop reads its own position from a ref so the effect can be armed once
 * per play/pause rather than re-armed 60 times a second.
 *
 * ## Skipping dead air
 *
 * A multiple of real time only works when the window is roughly the length of the
 * thing being watched. It is not: a window covering a backfilled admin-log archive
 * runs for weeks while any one player is online for a few percent of it. Played
 * straight, the transport shows an empty map for hours of real time before the
 * first marker appears, and the scrubber advances by less than a pixel a minute —
 * indistinguishable from being broken.
 *
 * So when `segments` are supplied, the playhead jumps over any stretch where
 * nobody is present. Wall-clock time is still what the readout shows; it is only
 * the *waiting* that is skipped, and the scrubber draws the segments so a jump is
 * something the viewer can see coming rather than a glitch.
 */

export interface PlaybackClock {
  /** Current playhead, epoch ms. */
  ts: number;
  playing: boolean;
  speed: number;
  /** 0..1 through the material being played; convenient for a scrubber. */
  progress: number;
  /** Where an arbitrary instant sits on the same 0..1 scale as `progress`. */
  positionOf: (ts: number) => number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Jump to an absolute timestamp (clamped to the window). */
  seek: (ts: number) => void;
  /** Jump to a 0..1 fraction of the window. */
  seekProgress: (p: number) => void;
  /** Nudge by a signed number of milliseconds. */
  step: (deltaMs: number) => void;
  setSpeed: (speed: number) => void;
  /** Whether stretches with nobody present are jumped over. */
  skipEmpty: boolean;
  setSkipEmpty: (skip: boolean) => void;
  /** True when there is dead air to skip, i.e. when the toggle means anything. */
  canSkipEmpty: boolean;
}

export interface PlaybackOptions {
  /** Fixed starting speed. Omit to fit one to the length of the selection. */
  initialSpeed?: number;
  /** Merged stretches of presence; see presenceSegments. */
  segments?: PresenceSegment[];
}

/** Speed multipliers offered by the transport. */
export const PLAYBACK_SPEEDS = [1, 4, 16, 60, 240];

/** Roughly how long replaying the whole selection should take. */
const TARGET_PLAYBACK_MS = 3 * 60_000;

/**
 * A starting speed suited to how much there is to watch.
 *
 * A fixed default cannot serve both jobs this tool has. 16x is right for an
 * afternoon on a live server and absurd for an imported archive: a player with a
 * day of accumulated presence would take an hour and a half to replay, and the
 * scrubber would advance about a pixel a minute. Fitting the speed to the material
 * keeps a selection watchable whether it is twenty minutes or two weeks; the
 * transport buttons still override it.
 */
export function fitSpeed(playableMs: number): number {
  const want = playableMs / TARGET_PLAYBACK_MS;
  return PLAYBACK_SPEEDS.find((s) => s >= want) ?? PLAYBACK_SPEEDS[PLAYBACK_SPEEDS.length - 1];
}

export function usePlaybackClock(
  from: number,
  to: number,
  { initialSpeed, segments }: PlaybackOptions = {},
): PlaybackClock {
  const span = Math.max(1, to - from);
  const [playing, setPlaying] = useState(false);
  const [skipEmpty, setSkipEmpty] = useState(true);

  const segs = useMemo(() => segments ?? [], [segments]);
  // Only worth skipping when presence is a fraction of the window; otherwise the
  // toggle is a control that does nothing, which is worse than not offering it.
  const covered = useMemo(() => segs.reduce((a, s) => a + (s.to - s.from), 0), [segs]);
  const canSkipEmpty = segs.length > 0 && covered < span * 0.9;

  // Start where the data does. Anchoring to the window start means a range picked
  // to cover an archive parks the playhead days before the first sample.
  const anchor = segs.length ? Math.max(from, segs[0].from) : from;
  const [ts, setTs] = useState(anchor);

  // Tracks arrive after the first render, so the fitted speed has to follow the
  // material — but never over the top of a speed the operator picked themselves.
  const fitted = initialSpeed ?? fitSpeed(skipEmpty && canSkipEmpty ? covered : span);
  const [speed, setSpeedState] = useState(fitted);
  const speedChosen = useRef(initialSpeed !== undefined);
  const setSpeed = useCallback((s: number) => {
    speedChosen.current = true;
    setSpeedState(s);
  }, []);
  useEffect(() => {
    if (!speedChosen.current) setSpeedState(fitted);
  }, [fitted]);

  const tsRef = useRef(ts);
  tsRef.current = ts;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const segsRef = useRef(segs);
  segsRef.current = segs;
  const skipRef = useRef(skipEmpty);
  skipRef.current = skipEmpty && canSkipEmpty;

  // Re-anchor whenever the window changes, so changing the range or the selection
  // never leaves the playhead stranded outside it — or parked in dead air.
  useEffect(() => {
    setTs(anchor);
    setPlaying(false);
  }, [anchor, to]);

  const clamp = useCallback((v: number) => Math.min(Math.max(v, from), to), [from, to]);

  /**
   * The scrubber measures the material being played, not the calendar.
   *
   * While empty stretches are being skipped they are not part of what the viewer
   * watches, and scaling the bar by wall-clock time makes the thumb crawl: a
   * 40-minute session inside a fortnight-wide window is a quarter of one percent
   * of the track, so it reads as a frozen control. Measuring elapsed presence
   * instead makes the thumb move at the rate the map does, and makes dragging it
   * land on data rather than on a random empty Tuesday. The readout and the end
   * labels still show real timestamps, so nothing here disguises when something
   * happened.
   */
  const scale = useMemo(() => {
    if (!skipRef.current || !segs.length) {
      return {
        total: span,
        elapsed: (ts: number) => ts - from,
        at: (elapsed: number) => from + elapsed,
      };
    }
    // Prefix sums, so both directions are a walk over a handful of segments.
    const starts: number[] = [];
    let acc = 0;
    for (const s of segs) { starts.push(acc); acc += s.to - s.from; }
    return {
      total: Math.max(1, acc),
      elapsed: (at: number) => {
        for (let i = segs.length - 1; i >= 0; i--) {
          if (at >= segs[i].from) return starts[i] + Math.min(at, segs[i].to) - segs[i].from;
        }
        return 0;
      },
      at: (elapsed: number) => {
        for (let i = segs.length - 1; i >= 0; i--) {
          if (elapsed >= starts[i]) return Math.min(segs[i].from + (elapsed - starts[i]), segs[i].to);
        }
        return segs[0].from;
      },
    };
  }, [segs, from, span, skipEmpty, canSkipEmpty]);   // eslint-disable-line react-hooks/exhaustive-deps

  const positionOf = useCallback(
    (at: number) => Math.min(1, Math.max(0, scale.elapsed(at) / scale.total)),
    [scale],
  );

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    // -1 rather than 0: rAF timestamps are milliseconds since the time origin, so
    // 0 is a legitimate reading and a falsy check would treat it as "not started"
    // and re-baseline on the following frame, losing that frame's delta.
    let last = -1;

    const frame = (now: number) => {
      // First frame after play(): establish a baseline instead of integrating a
      // delta measured from page load.
      if (last < 0) last = now;
      const deltaMs = now - last;
      last = now;

      const raw = tsRef.current + deltaMs * speedRef.current;
      // Jump over any stretch with nobody in it. Returning null means the last
      // one is behind us, which ends playback exactly as reaching `to` does.
      const next = skipRef.current ? nextPresence(segsRef.current, raw) : raw;
      if (next === null || next >= to) {
        setTs(to);
        setPlaying(false);          // stop at the end rather than looping
        return;
      }
      setTs(next);
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, to]);

  const play = useCallback(() => {
    // Replaying from the end should restart, not sit there doing nothing.
    if (tsRef.current >= to) setTs(anchor);
    // Pressing play after scrubbing into dead air should go somewhere, rather
    // than run the clock forward over an empty map.
    else if (skipRef.current) {
      const at = nextPresence(segsRef.current, tsRef.current);
      if (at !== null && at !== tsRef.current) setTs(at);
    }
    setPlaying(true);
  }, [anchor, to]);

  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  const seek = useCallback((v: number) => {
    setPlaying(false);
    setTs(clamp(v));
  }, [clamp]);

  const seekProgress = useCallback((p: number) => {
    seek(scale.at(p * scale.total));
  }, [seek, scale]);

  const step = useCallback((deltaMs: number) => {
    setPlaying(false);
    setTs((cur) => clamp(cur + deltaMs));
  }, [clamp]);

  return {
    ts,
    playing,
    speed,
    progress: positionOf(ts),
    positionOf,
    play,
    pause,
    toggle,
    seek,
    seekProgress,
    step,
    setSpeed,
    skipEmpty,
    setSkipEmpty,
    canSkipEmpty,
  };
}

export default usePlaybackClock;
