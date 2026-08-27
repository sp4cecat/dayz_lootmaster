/**
 * Format a UTC offset in minutes as "UTC+11:00".
 *
 * Lives outside the component that uses it so that file can stay
 * component-only — the same reason trackColors.ts exists.
 */
export function fmtOffset(minutes: number): string {
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
