/**
 * The week's Porch Live locations, from Asana.
 *
 * Each week has a task named like "[Idolatry] : Live Locations Week 7", due on
 * the Porch date. The locations are in a comment on it, usually from Makayla:
 * "@Kirk For 10/27: Fort Worth, Midland, Greater Lafayette". When they change,
 * a new comment is added, so the newest comment that lists locations wins.
 *
 * The browser calls the Asana API directly with the operator's personal
 * access token, which is kept only in that browser.
 */

const API = 'https://app.asana.com/api/1.0';

// "For 10/27: Fort Worth, Midland" / "10/13: Greater Lafayette, Wheaton, Dayton"
const DATED_LIST = /(?:^|\s)(?:for\s+)?(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\s*:\s*(.+)$/is;

/** Split "Fort Worth, Midland and Greater Lafayette" into names. */
export function splitLocations(list) {
  return list
    .replace(/https?:\/\/\S+/g, '')
    .split(/\s*(?:,|;|&|\band\b|\n)\s*/i)
    .map(s => s.trim().replace(/[.!]+$/, ''))
    .filter(Boolean);
}

/**
 * Read one comment: { month, day, locations } if it lists locations for a
 * date, otherwise null.
 */
export function parseLocationsComment(text) {
  const m = (text || '').trim().match(DATED_LIST);
  if (!m) return null;
  const locations = splitLocations(m[3]);
  return locations.length ? { month: +m[1], day: +m[2], locations } : null;
}

/**
 * Pick the locations for a date (YYYY-MM-DD) from a task's comments
 * (oldest first): the newest comment listing locations for that date, or
 * failing that the newest comment listing any.
 */
export function pickLocations(comments, date) {
  const [, month, day] = (date || '').split('-').map(Number);
  const parsed = comments
    .map(c => ({ ...c, found: parseLocationsComment(c.text) }))
    .filter(c => c.found);
  const forDate = parsed.filter(c => c.found.month === month && c.found.day === day);
  const pick = (forDate.length ? forDate : parsed).at(-1);
  if (!pick) return null;
  return {
    locations: pick.found.locations,
    author: pick.created_by?.name || '',
    at: pick.created_at,
    otherDate: !forDate.length,
  };
}

async function get(path, token) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (res.status === 401) throw new Error('Asana didn’t accept the token. Check it in Settings.');
  if (!res.ok) throw new Error(`Asana returned ${res.status}.`);
  return (await res.json()).data;
}

function shiftDate(date, days) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Find the Live Locations task for a Porch date and read its locations.
 * @returns { locations, task: { name, url }, author, otherDate } or null if there's no task
 */
export async function fetchLiveLocations({ token, date }) {
  const me = await get('/users/me?opt_fields=workspaces.name', token);
  const workspaces = me.workspaces || [];
  const workspace = workspaces.find(w => /watermark/i.test(w.name)) || workspaces[0];
  if (!workspace) throw new Error('No Asana workspace found for this token.');

  // The task is due on the Porch date; allow a couple of days either side
  const params = new URLSearchParams({
    text: 'Live Locations',
    due_on_after: shiftDate(date, -3),
    due_on_before: shiftDate(date, 3),
    opt_fields: 'name,due_on,permalink_url,completed',
    limit: '20',
  });
  const tasks = (await get(`/workspaces/${workspace.gid}/tasks/search?${params}`, token))
    .filter(t => /live locations/i.test(t.name) && !/send|graphics/i.test(t.name));
  if (!tasks.length) return null;
  const distance = t => Math.abs(new Date(`${t.due_on}T12:00:00`) - new Date(`${date}T12:00:00`));
  const task = tasks.sort((a, b) => distance(a) - distance(b))[0];

  const stories = await get(`/tasks/${task.gid}/stories?opt_fields=created_at,created_by.name,resource_subtype,text`, token);
  const comments = stories.filter(s => s.resource_subtype === 'comment_added');
  const picked = pickLocations(comments, date);
  return { locations: picked?.locations || [], author: picked?.author || '', otherDate: !!picked?.otherDate, task: { name: task.name, url: task.permalink_url, due: task.due_on } };
}
