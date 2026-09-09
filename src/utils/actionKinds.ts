/**
 * Presentation for the action log's event kinds.
 *
 * The set is open on purpose. The mod decides what it emits, and a server running
 * an older build emits fewer kinds than this knows about — so an unrecognised kind
 * gets a neutral style and its own name rather than being hidden. A feed that
 * silently drops the one event type it did not expect is worse than an ugly chip.
 */

import {
  Hand, PackageOpen, Archive, Hammer, Trash2, Skull, LogIn, LogOut, RotateCcw,
  MessageSquareWarning, UserX, Ban, Crosshair, Swords, HeartCrack, Circle, type LucideIcon,
} from 'lucide-react';

export interface ActionKindStyle {
  label: string;
  icon: LucideIcon;
  /** Marker/dot colour, used on the map and in the feed. */
  color: string;
  /** Tailwind classes for the filter chip when it is on. */
  chip: string;
}

/**
 * The chip palettes, exported so anything else that needs a small tinted pill
 * (the loot-cycle severity chip, for one) draws from the same set rather than
 * inventing a fourth shade of red.
 */
export const CHIP = {
  success: 'bg-success-50 text-success-700 border-success-200 dark:bg-success-900/20 dark:text-success-300 dark:border-success-800',
  warning: 'bg-warning-50 text-warning-700 border-warning-200 dark:bg-warning-900/20 dark:text-warning-300 dark:border-warning-800',
  primary: 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/20 dark:text-primary-300 dark:border-primary-800',
  error: 'bg-error-50 text-error-700 border-error-200 dark:bg-error-900/20 dark:text-error-300 dark:border-error-800',
  gray: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
} as const;

const KINDS: Record<string, ActionKindStyle> = {
  pickup: { label: 'Picked up', icon: Hand, color: '#22c55e', chip: CHIP.success },
  drop: { label: 'Dropped', icon: PackageOpen, color: '#f59e0b', chip: CHIP.warning },
  stash: { label: 'Stashed', icon: Archive, color: '#6366f1', chip: CHIP.primary },
  deploy: { label: 'Deployed', icon: Hammer, color: '#06b6d4', chip: CHIP.primary },
  destroy: { label: 'Destroyed', icon: Trash2, color: '#ef4444', chip: CHIP.error },
  death: { label: 'Died', icon: Skull, color: '#dc2626', chip: CHIP.error },
  // Combat (spacecat_dayz_server_api 1.5+, and the ADM backfill). `hit` and `kill`
  // are the ATTACKER's rows — the pid is whoever pulled the trigger and the victim
  // is named in the detail — so a `kill` sits beside the victim's own `death` as
  // two rows for one shot. `damaged` is the VICTIM's row for damage no player
  // dealt (infected, animals, AI, falls, fire, vehicles), which is why it is a
  // separate kind rather than a `hit` with the roles swapped: a chip called
  // "Hit" that mixes what a player did with what was done to them would be
  // unreadable.
  hit: { label: 'Hit', icon: Crosshair, color: '#f97316', chip: CHIP.warning },
  kill: { label: 'Killed', icon: Swords, color: '#b91c1c', chip: CHIP.error },
  damaged: { label: 'Damaged', icon: HeartCrack, color: '#eab308', chip: CHIP.warning },
  connect: { label: 'Connected', icon: LogIn, color: '#94a3b8', chip: CHIP.gray },
  disconnect: { label: 'Disconnected', icon: LogOut, color: '#64748b', chip: CHIP.gray },
  rollback: { label: 'Rolled back', icon: RotateCcw, color: '#a855f7', chip: CHIP.primary },
  rollback_failed: { label: 'Rollback failed', icon: RotateCcw, color: '#ef4444', chip: CHIP.error },
  // Written by the loot-cycle ladder rather than the mod's hooks (see
  // server/loot-cycle-runner.js). They sit in the same feed so a warning shows up
  // next to the drops that earned it.
  warned: { label: 'Warned', icon: MessageSquareWarning, color: '#f59e0b', chip: CHIP.warning },
  kicked: { label: 'Kicked', icon: UserX, color: '#ef4444', chip: CHIP.error },
  banned: { label: 'Banned', icon: Ban, color: '#dc2626', chip: CHIP.error },
};

const FALLBACK: ActionKindStyle = {
  label: '', icon: Circle, color: '#94a3b8', chip: CHIP.gray,
};

export function actionKindStyle(kind: string): ActionKindStyle {
  const known = KINDS[kind];
  if (known) return known;
  // An unknown kind still gets a readable label rather than a blank chip.
  return { ...FALLBACK, label: kind.replace(/_/g, ' ') };
}

/** True for kinds whose position is a place worth drawing on the map. */
export function isPlacedKind(kind: string): boolean {
  return kind !== 'connect' && kind !== 'disconnect';
}
