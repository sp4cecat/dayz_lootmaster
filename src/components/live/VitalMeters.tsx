import { cx } from '@/utils/cx';
import { VITAL_MAX } from '@/utils/liveWindow';
import type { LivePlayer } from '@/types/cftools';

/** Bar colour per vital; blood is red on purpose, health green — the game's own cues. */
const TONES = {
  health: 'bg-success-500',
  blood: 'bg-error-500',
  shock: 'bg-warning-500',
  energy: 'bg-amber-500',
  water: 'bg-sky-500',
} as const;

interface VitalBarProps {
  label?: string;
  value: number;
  max: number;
  tone: string;
  /** A bare bar with no label or number, for a roster row. */
  compact?: boolean;
  title?: string;
}

/** One meter. The fill width is the clamped fraction, so an over-range value is a full bar, not a broken layout. */
export function VitalBar({ label, value, max, tone, compact, title }: VitalBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bar = (
    <span
      data-testid="vital-bar"
      title={title}
      className={cx('block rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden', compact ? 'h-1 w-10' : 'h-1.5 w-full')}
    >
      <span className={cx('block h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
    </span>
  );
  if (compact) return bar;
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-12 shrink-0 text-[11px] text-gray-500 dark:text-gray-400">{label}</span>
      {bar}
      <span className="w-10 shrink-0 text-right text-[11px] font-medium tabular-nums text-gray-900 dark:text-white">
        {Math.round(value)}
      </span>
    </div>
  );
}

/**
 * Health, blood, shock, energy and water as meters. Each renders only when the
 * mod supplied it — the card's rule is that a CF-Tools-only server shows no dead
 * placeholders, and a row of empty bars would be exactly that.
 */
export default function VitalMeters({ player }: { player: LivePlayer }) {
  const rows: { key: keyof typeof VITAL_MAX; label: string; value: number | null }[] = [
    { key: 'health', label: 'Health', value: player.health },
    { key: 'blood', label: 'Blood', value: player.blood },
    { key: 'shock', label: 'Shock', value: player.shock },
    { key: 'energy', label: 'Energy', value: player.energy },
    { key: 'water', label: 'Water', value: player.water },
  ];
  const shown = rows.filter((r): r is typeof r & { value: number } => r.value != null);
  if (!shown.length) return null;
  return (
    <div data-testid="vital-meters" className="py-1">
      {shown.map(r => (
        <VitalBar key={r.key} label={r.label} value={r.value} max={VITAL_MAX[r.key]} tone={TONES[r.key]} />
      ))}
    </div>
  );
}
