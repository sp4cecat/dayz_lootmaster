import { useCallback, useEffect, useRef, useState } from 'react';

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
 */

export interface PlaybackClock {
  /** Current playhead, epoch ms. */
  ts: number;
  playing: boolean;
  speed: number;
  /** 0..1 through the window; convenient for a scrubber. */
  progress: number;
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
}

export function usePlaybackClock(from: number, to: number, initialSpeed = 16): PlaybackClock {
  const span = Math.max(1, to - from);
  const [ts, setTs] = useState(from);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(initialSpeed);

  const tsRef = useRef(ts);
  tsRef.current = ts;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  // Re-anchor to the start whenever the window changes, so changing the range
  // never leaves the playhead stranded outside it.
  useEffect(() => {
    setTs(from);
    setPlaying(false);
  }, [from, to]);

  const clamp = useCallback((v: number) => Math.min(Math.max(v, from), to), [from, to]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = 0;

    const frame = (now: number) => {
      // First frame after play(): establish a baseline instead of integrating a
      // delta measured from page load.
      if (!last) last = now;
      const deltaMs = now - last;
      last = now;

      const next = tsRef.current + deltaMs * speedRef.current;
      if (next >= to) {
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
    if (tsRef.current >= to) setTs(from);
    setPlaying(true);
  }, [from, to]);

  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  const seek = useCallback((v: number) => {
    setPlaying(false);
    setTs(clamp(v));
  }, [clamp]);

  const seekProgress = useCallback((p: number) => {
    seek(from + p * span);
  }, [seek, from, span]);

  const step = useCallback((deltaMs: number) => {
    setPlaying(false);
    setTs((cur) => clamp(cur + deltaMs));
  }, [clamp]);

  return {
    ts,
    playing,
    speed,
    progress: (ts - from) / span,
    play,
    pause,
    toggle,
    seek,
    seekProgress,
    step,
    setSpeed,
  };
}

export default usePlaybackClock;
