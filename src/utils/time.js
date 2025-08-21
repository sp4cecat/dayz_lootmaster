/**
 * Format a lifetime in seconds as non-zero unit parts:
 * n week/s n day/s n hour/s n minute/s n second/s
 * If all units are zero, returns "0 seconds".
 * @param {number} secs
 * @returns {string}
 */
export function formatLifetime(secs) {
  let total = Math.max(0, Math.floor(Number(secs) || 0));
  const WEEK = 7 * 24 * 60 * 60;
  const DAY = 24 * 60 * 60;
  const HOUR = 60 * 60;
  const MINUTE = 60;

  const weeks = Math.floor(total / WEEK);
  total %= WEEK;
  const days = Math.floor(total / DAY);
  total %= DAY;
  const hours = Math.floor(total / HOUR);
  total %= HOUR;
  const minutes = Math.floor(total / MINUTE);
  const seconds = total % MINUTE;

  const s = (n, singular) => `${n} ${singular}${n === 1 ? '' : 's'}`;
  const parts = [];
  if (weeks) parts.push(s(weeks, 'week'));
  if (days) parts.push(s(days, 'day'));
  if (hours) parts.push(s(hours, 'hour'));
  if (minutes) parts.push(s(minutes, 'minute'));
  if (seconds) parts.push(s(seconds, 'second'));
  return parts.length ? parts.join(' ') : '0 seconds';
}
