import { Play, Pause, SkipBack, SkipForward, RotateCcw } from 'lucide-react';
import { cx } from '@/utils/cx';
import type { PlaybackClock } from '@/hooks/usePlaybackClock';

const SPEEDS = [1, 4, 16, 60, 240];

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
}

/**
 * Transport controls for the playback mode.
 *
 * Times render in the browser's local zone via toLocaleString. That is a deliberate
 * break from the ADM log tooling, which hard-codes UTC+10 (server/index.js
 * parseAdmStartDate); history is stored as epoch ms end to end precisely so it can
 * be shown in whatever zone the person reading it is in.
 */
export default function PlaybackBar({ clock, from, to, status }: PlaybackBarProps) {
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

        <div className="flex items-center gap-1 ml-auto shrink-0">
          {SPEEDS.map((s) => (
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

      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(clock.progress * 1000)}
        onChange={(e) => clock.seekProgress(Number(e.target.value) / 1000)}
        aria-label="Playback position"
        className="w-full accent-primary-600 cursor-pointer"
      />

      <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
        <span>{formatClock(from)}</span>
        {status && <span className="text-gray-500 dark:text-gray-400">{status}</span>}
        <span>{formatClock(to)}</span>
      </div>
    </div>
  );
}
