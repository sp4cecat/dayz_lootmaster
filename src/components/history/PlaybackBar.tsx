import { Play, Pause, SkipBack, SkipForward, RotateCcw, FastForward } from 'lucide-react';
import { cx } from '@/utils/cx';
import { PLAYBACK_SPEEDS, type PlaybackClock } from '@/hooks/usePlaybackClock';
import type { PresenceSegment } from '@/utils/trackSampling';

/** Step size for the skip buttons: one mod tick either way. */
const STEP_MS = 5000;

function formatClock(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatSpeed(s: number): string {
  return s >= 60 ? `${s}×` : `${s}×`;
}

interface PlaybackBarProps {
  clock: PlaybackClock;
  from: number;
  to: number;
  /** Rendered under the scrubber, e.g. how many players are present right now. */
  status?: React.ReactNode;
  /** When the selected players were present; drawn behind the scrubber. */
  segments?: PresenceSegment[];
}

/**
 * Transport controls for the playback mode.
 *
 * Times render in the browser's local zone via toLocaleString. History is stored as
 * epoch ms end to end precisely so the zone is a presentation choice; the log
 * readers convert into the game server's zone at the point of parsing instead
 * (server/log-clock.js), which is a different question from where the viewer sits.
 */
export default function PlaybackBar({ clock, from, to, status, segments = [] }: PlaybackBarProps) {
  return (
    <div className="flex flex-col gap-2 bg-gray-50 dark:bg-gray-900/50 p-3 rounded-xl border border-gray-200 dark:border-gray-800 shrink-0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={clock.toggle}
          title={clock.playing ? 'Pause' : 'Play'}
          aria-label={clock.playing ? 'Pause' : 'Play'}
          className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors shrink-0"
        >
          {clock.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>

        <button
          type="button"
          onClick={() => clock.step(-STEP_MS)}
          title="Back 5 seconds"
          aria-label="Back 5 seconds"
          className="flex items-center justify-center h-8 w-8 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <SkipBack size={14} />
        </button>
        <button
          type="button"
          onClick={() => clock.step(STEP_MS)}
          title="Forward 5 seconds"
          aria-label="Forward 5 seconds"
          className="flex items-center justify-center h-8 w-8 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <SkipForward size={14} />
        </button>
        <button
          type="button"
          onClick={() => clock.seek(from)}
          title="Back to start"
          aria-label="Back to start"
          className="flex items-center justify-center h-8 w-8 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <RotateCcw size={14} />
        </button>

        <div className="font-mono text-xs text-gray-700 dark:text-gray-300 tabular-nums shrink-0">
          {formatClock(clock.ts)}
        </div>

        {clock.canSkipEmpty && (
          <button
            type="button"
            onClick={() => clock.setSkipEmpty(!clock.skipEmpty)}
            title={clock.skipEmpty
              ? 'Skipping stretches where nobody is present. Click to play the window in full.'
              : 'Playing every second of the window, including stretches with nobody present.'}
            aria-pressed={clock.skipEmpty}
            className={cx(
              'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors shrink-0',
              clock.skipEmpty
                ? 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/20 dark:text-primary-300 dark:border-primary-800'
                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700',
            )}
          >
            <FastForward size={12} />
            Skip empty
          </button>
        )}

        <div className="flex items-center gap-1 ml-auto shrink-0">
          {PLAYBACK_SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => clock.setSpeed(s)}
              className={cx(
                'px-2 py-1 rounded-md text-[11px] font-medium border transition-colors tabular-nums',
                clock.speed === s
                  ? 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/20 dark:text-primary-300 dark:border-primary-800'
                  : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700',
              )}
            >
              {formatSpeed(s)}
            </button>
          ))}
        </div>
      </div>

      {/*
        * Presence drawn behind the scrubber. Over a window sized to an imported
        * archive a player is online for a few percent of it, so without this the
        * thumb sits still for minutes at a time and there is no way to tell a
        * long empty stretch from a broken transport.
        */}
      <div className="relative">
        {segments.length > 0 && (
          <div
            className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden pointer-events-none"
            aria-hidden="true"
          >
            {segments.map((s) => (
              <div
                key={s.from}
                // The right border separates sessions that the presence scale
                // butts up against each other, so the count of them stays legible.
                className="absolute inset-y-0 bg-primary-300 dark:bg-primary-700 border-r border-gray-50 dark:border-gray-900"
                style={{
                  // Positioned on the clock's own scale, so the strip agrees with
                  // the thumb whether or not empty stretches are being skipped.
                  left: `${clock.positionOf(s.from) * 100}%`,
                  // A short session over a long window rounds to nothing; keep a
                  // hairline so it stays visible as a place you can seek to.
                  width: `max(2px, ${(clock.positionOf(s.to) - clock.positionOf(s.from)) * 100}%)`,
                }}
              />
            ))}
          </div>
        )}
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(clock.progress * 1000)}
          onChange={(e) => clock.seekProgress(Number(e.target.value) / 1000)}
          aria-label="Playback position"
          className="relative w-full accent-primary-600 cursor-pointer bg-transparent"
        />
      </div>

      <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
        <span>{formatClock(from)}</span>
        {status && <span className="text-gray-500 dark:text-gray-400">{status}</span>}
        <span>{formatClock(to)}</span>
      </div>
    </div>
  );
}
