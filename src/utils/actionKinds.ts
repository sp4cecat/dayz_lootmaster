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
  Circle, type LucideIcon,
} from 'lucide-react';

export interface ActionKindStyle {
  label: string;
  icon: LucideIcon;
  /** Marker/dot colour, used on the map and in the feed. */
  color: string;
  /** Tailwind classes for the filter chip when it is on. */
  chip: string;
}

const KINDS: Record<string, ActionKindStyle> = {
  pickup: {
    label: 'Picked up', icon: Hand, color: '#22c55e',
    chip: 'bg-success-50 text-success-700 border-success-200 dark:bg-success-900/20 dark:text-success-300 dark:border-success-800',
  },
  drop: {
    label: 'Dropped', icon: PackageOpen, color: '#f59e0b',
    chip: 'bg-warning-50 text-warning-700 border-warning-200 dark:bg-warning-900/20 dark:text-warning-300 dark:border-warning-800',
  },
  stash: {
    label: 'Stashed', icon: Archive, color: '#6366f1',
    chip: 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/20 dark:text-primary-300 dark:border-primary-800',
  },
  deploy: {
    label: 'Deployed', icon: Hammer, color: '#06b6d4',
    chip: 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/20 dark:text-primary-300 dark:border-primary-800',
  },
  destroy: {
    label: 'Destroyed', icon: Trash2, color: '#ef4444',
    chip: 'bg-error-50 text-error-700 border-error-200 dark:bg-error-900/20 dark:text-error-300 dark:border-error-800',
  },
  death: {
    label: 'Died', icon: Skull, color: '#dc2626',
    chip: 'bg-error-50 text-error-700 border-error-200 dark:bg-error-900/20 dark:text-error-300 dark:border-error-800',
  },
  connect: {
    label: 'Connected', icon: LogIn, color: '#94a3b8',
    chip: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  },
  disconnect: {
    label: 'Disconnected', icon: LogOut, color: '#64748b',
    chip: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  },
  rollback: {
    label: 'Rolled back', icon: RotateCcw, color: '#a855f7',
    chip: 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/20 dark:text-primary-300 dark:border-primary-800',
  },
  rollback_failed: {
    label: 'Rollback failed', icon: RotateCcw, color: '#ef4444',
    chip: 'bg-error-50 text-error-700 border-error-200 dark:bg-error-900/20 dark:text-error-300 dark:border-error-800',
  },
};

const FALLBACK: ActionKindStyle = {
  label: '', icon: Circle, color: '#94a3b8',
  chip: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
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
