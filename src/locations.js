/**
 * The week's Porch Live locations, as the PCO listener on Pro 3 sends them in
 * the request file, from the week's "Live Locations" task in Asana:
 *
 *   # locations: Fort Worth, Midland, Greater Lafayette
 *   # locations-task: https://app.asana.com/…   (optional, for checking)
 *
 * The value can also be the Asana comment as written ("For 10/27: Fort Worth,
 * Midland and Greater Lafayette"); the date in front is read and checked
 * against the Porch date.
 */

const DATED_LIST = /(?:^|\s)(?:for\s+)?(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\s*:\s*(.+)$/is;

/** Split "Fort Worth, Midland and Greater Lafayette" into names. */
export function splitLocations(list) {
  return (list || '')
    .replace(/https?:\/\/\S+/g, '')
    .split(/\s*(?:,|;|&|\band\b|\n)\s*/i)
    .map(s => s.trim().replace(/[.!]+$/, ''))
    .filter(Boolean);
}

/**
 * Read a locations value: { locations, month, day } (month and day only when
 * the value starts with a date, as Asana comments do).
 */
export function parseLocations(value) {
  const text = (value || '').replace(/https?:\/\/\S+/g, ' ').trim();
  const m = text.match(DATED_LIST);
  if (m) return { locations: splitLocations(m[3]), month: +m[1], day: +m[2] };
  return { locations: splitLocations(text), month: null, day: null };
}

/** True when a parsed value is dated for a different day than the Porch date (YYYY-MM-DD). */
export function datedForAnotherDay(parsed, date) {
  if (!parsed.month || !date) return false;
  const [, month, day] = date.split('-').map(Number);
  return parsed.month !== month || parsed.day !== day;
}
