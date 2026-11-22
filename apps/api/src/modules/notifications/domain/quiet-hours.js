// @ts-check

/**
 * Minutes after local midnight at `at` in an IANA time zone.
 * @param {Date} at
 * @param {string} timeZone
 */
export function localMinute(at, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const value = (/** @type {string} */ type) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return value('hour') * 60 + value('minute');
}

/** Whether a time zone name is valid. @param {string} timeZone */
export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `at` falls in the quiet window `[start, end)` (minutes after local midnight). A
 * window may wrap past midnight (start > end); start = end means no quiet hours.
 * @param {{ startMinute: number, endMinute: number } | null} quiet
 * @param {string} timeZone
 * @param {Date} at
 */
export function inQuietHours(quiet, timeZone, at) {
  if (!quiet || quiet.startMinute === quiet.endMinute) return false;
  const m = localMinute(at, timeZone);
  return quiet.startMinute < quiet.endMinute
    ? m >= quiet.startMinute && m < quiet.endMinute
    : m >= quiet.startMinute || m < quiet.endMinute;
}
