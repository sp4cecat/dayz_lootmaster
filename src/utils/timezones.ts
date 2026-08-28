import { fmtOffset } from '@/utils/formatOffset';

/**
 * Timezone helpers for the profile and log-import UIs.
 *
 * DayZ logs record a bare wall clock, so which zone the game server runs in is a
 * setting rather than something the data can tell us. These are display-side
 * mirrors of `server/log-clock.js`; the server is still the authority on how a
 * log line becomes an instant.
 */

/** The zone this browser is in. A sane default, never an assumption. */
export const browserTimeZone = (() => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
})();

/**
 * Every zone the runtime knows. `supportedValuesOf` is widely available but not
 * universal, so a handful of common zones back it up rather than an empty list.
 */
export function listTimeZones(): string[] {
    try {
        const withValues = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
        const all = withValues.supportedValuesOf?.('timeZone');
        if (all?.length) return all;
    } catch { /* fall through */ }
    return [browserTimeZone, 'UTC', 'Australia/Sydney', 'Australia/Brisbane',
        'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles'];
}

/** Minutes east of UTC that `timeZone` is on at an instant. 660 = +11:00. */
export function zoneOffsetAt(ms: number, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms));
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** "Australia/Sydney (UTC+11:00)" — the offset makes a long list scannable. */
export function zoneOptions(at = Date.now()): { label: string; value: string }[] {
    return listTimeZones().map((tz) => {
        let suffix = '';
        try {
            suffix = ` (${fmtOffset(zoneOffsetAt(at, tz))})`;
        } catch { /* a zone the formatter dislikes still deserves to be listed */ }
        return { label: `${tz}${suffix}`, value: tz };
    });
}
