/**
 * Presentation for player-flag severities, shared by the flags rail, the live
 * map's player card and the nav badge so a "high" reads the same everywhere.
 *
 * The bands are open-ended strings on the wire (the scorer owns them), so an
 * unknown band falls to the neutral style rather than crashing a render.
 */

import { CHIP } from './actionKinds';
import type { FlagSeverity } from '@/types/history';

export const SEVERITY_ORDER: readonly FlagSeverity[] = ['none', 'low', 'medium', 'high', 'critical'];

/** Position in the band order; unknown bands sort below `none`. */
export function severityRank(severity: string | null | undefined): number {
  return SEVERITY_ORDER.indexOf((severity ?? 'none') as FlagSeverity);
}

/** True when `severity` is at or above `min` — the same test the backend applies. */
export function severityAtLeast(severity: string | null | undefined, min: string): boolean {
  return severityRank(severity) >= severityRank(min);
}

/**
 * Chip classes for a severity. High and critical share the error palette on
 * purpose: both mean "act on this", and a fifth colour would only dilute red.
 */
export function severityChipClass(severity: string | null | undefined): string {
  switch (severity) {
    case 'critical':
    case 'high':
      return CHIP.error;
    case 'medium':
      return CHIP.warning;
    default:
      return CHIP.gray;
  }
}

/** Human label for a band. */
export function severityLabel(severity: string | null | undefined): string {
  if (!severity || severity === 'none') return 'None';
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}
