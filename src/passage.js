/**
 * The Porch's scripture block, ported from porch_slides.
 *
 * Each scripture slide shows a block of verses filled to the box's line limit
 * (9 lines), with the verse being read at full strength and the verses around
 * it dimmed. Consecutive slides keep the same block while the highlight moves
 * down it, and only start a new block when the next verse would run out of
 * context. A block always starts on a whole verse; the last verse may be cut
 * short to fill the last line.
 *
 * Text comes out in the markup layout.js reads: {dimmed}, ^verse numbers^, \n.
 * Line counting is injected (`countLines(text) -> n`) so this runs in tests.
 */

import { preventOrphan } from './layout.js';

// Job, Psalms, Proverbs, Song of Solomon, Lamentations
const POETIC_BOOK_IDS = new Set([18, 19, 20, 22, 25]);

export function isPoeticBook(bookId) {
  return POETIC_BOOK_IDS.has(Number(bookId));
}

/**
 * Poetry the way porch_slides breaks it: at semicolons and colons; failing
 * that, before a conjunction after a comma; failing that, a long line at the
 * comma nearest its middle. Text that already has line breaks is left alone.
 */
export function poetryLines(text) {
  if (!text || text.includes('\n')) return text || '';
  let t = text.trim();
  if (/[;:]\s+/.test(t)) return t.replace(/([;:])\s+/g, '$1\n');
  if (/,\s+(and|but|for|nor|yet|so)\b/i.test(t)) return t.replace(/,\s+(and|but|for|nor|yet|so)\b/gi, ',\n$1');
  if (t.includes(', ') && t.length > 55) {
    const mid = t.length / 2;
    const commas = [];
    for (let i = t.indexOf(', '); i !== -1; i = t.indexOf(', ', i + 1)) commas.push(i);
    commas.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    t = `${t.slice(0, commas[0] + 1)}\n${t.slice(commas[0] + 2)}`;
  }
  return t;
}

/** The lines of a quoted poem inside a prose verse (also breaks at "!"). */
function embeddedLines(text) {
  let t = text.trim();
  if (/([;:!][”"']?)\s+/.test(t)) t = t.replace(/([;:!][”"']?)\s+/g, '$1\n');
  else if (/,\s+(and|but|for|nor|yet|so)\b/i.test(t)) t = t.replace(/,\s+(and|but|for|nor|yet|so)\b/gi, ',\n$1');
  return t.split('\n').map(s => s.trim()).filter(Boolean);
}

// Well-known poems inside prose books, by "bookId_chapter_verse" (from porch_slides)
const range = (book, chapter, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${book}_${chapter}_${from + i}`);
const EMBEDDED_POETRY = new Set([
  '23_6_3', // Isaiah 6:3
  ...range(42, 1, 46, 55), // Luke 1:46-55, the Magnificat
  ...range(42, 1, 68, 79), // Luke 1:68-79, the Benedictus
  ...range(50, 2, 6, 11), // Philippians 2:6-11
  '54_3_16', // 1 Timothy 3:16
  '1_2_23', // Genesis 2:23
  ...range(2, 15, 1, 18), // Exodus 15:1-18, the Song of the Sea
  '66_4_8', '66_4_11', '66_5_9', '66_5_10', // Revelation 4-5
]);

const QUOTED_POEM = /^([\s\S]*?:)\s*([“"][^”"]+[”"])([\s\S]*)$/;

function isEmbeddedPoetry(bookId, chapter, verse, text) {
  if (EMBEDDED_POETRY.has(`${bookId}_${chapter}_${verse}`)) return true;
  const m = (text || '').match(/:\s*([“"][^”"]+[”"])/);
  return !!m && (/([;:!][”"']?)\s+/.test(m[1]) || /,\s+(and|but|for|nor|yet|so)\b/i.test(m[1]));
}

/**
 * Set a prose verse's embedded poem in lines.
 * Returns { text, endsWithPoetry } (a verse ending in poetry is followed by a break).
 */
function formatEmbedded(text, bookId, chapter, verse) {
  const m = text.match(QUOTED_POEM);
  if (m) {
    const lines = embeddedLines(m[2]);
    if (lines.length > 1) {
      const rest = m[3].trim();
      return { text: [m[1].trim(), ...lines, ...(rest ? [rest] : [])].join('\n'), endsWithPoetry: !rest };
    }
  }
  if (EMBEDDED_POETRY.has(`${bookId}_${chapter}_${verse}`) || isEmbeddedPoetry(bookId, chapter, verse, text)) {
    const lines = embeddedLines(text);
    if (lines.length > 1) return { text: lines.join('\n'), endsWithPoetry: true };
  }
  return { text, endsWithPoetry: false };
}

/** 'poetry' for the poetic books, 'mixed' for prose with an embedded poem, else 'prose'. */
export function passageFormat(bookId, chapter, verses) {
  if (isPoeticBook(bookId)) return 'poetry';
  return verses.some(v => isEmbeddedPoetry(bookId, chapter, v.verse, v.text)) ? 'mixed' : 'prose';
}

/**
 * Build a block's text.
 * @param whole    [{ verse, text }] whole verses, in order
 * @param target   the verse being read (shown at full strength); null for none
 * @param partial  { verse, text } the start of the next verse, or null
 * @param opts     { format, bookId, chapter }
 */
export function blockText(whole, target, partial, { format = 'prose', bookId, chapter } = {}) {
  const parts = [];
  const all = partial ? [...whole, { ...partial, partial: true }] : whole;
  all.forEach((v, i) => {
    let text = v.text.trim();
    let endsWithPoetry = false;
    if (format === 'poetry') {
      text = v.partial ? text : poetryLines(text);
    } else if (format === 'mixed' || isEmbeddedPoetry(bookId, chapter, v.verse, text)) {
      ({ text, endsWithPoetry } = formatEmbedded(text, bookId, chapter, v.verse));
    }
    const body = `^${v.verse}^${text}`;
    parts.push(v.verse === target ? body : `{${body}}`);
    if (i < all.length - 1) parts.push(format === 'poetry' || endsWithPoetry ? '\n' : ' ');
  });
  return preventOrphan(parts.join(''));
}

/**
 * Fill a block to `maxLines` starting at `start` (always a whole verse).
 * Whole verses go in while they fit; then as many words (or poetry lines) of
 * the next verse as fill the last line. The verse being read is never cut.
 */
export function fillBlock(verses, target, start, { maxLines, countLines, format = 'prose', bookId, chapter }) {
  const opts = { format, bookId, chapter };
  const at = n => verses.find(v => v.verse === n);
  if (!at(start)) return null;
  const lines = (whole, partial = null) => countLines(blockText(whole, target, partial, opts));

  const whole = [];
  const last = Math.max(...verses.map(v => v.verse));
  for (let n = start; n <= last; n++) {
    const v = at(n);
    if (!v) break;
    const count = lines([...whole, v]);
    if (count > maxLines) break;
    whole.push(v);
    if (count === maxLines) break;
  }

  // Fill out the last line with the start of the next verse
  let partial = null;
  const endWhole = whole.length ? whole[whole.length - 1].verse : start - 1;
  const next = at(endWhole + 1);
  if (whole.length && next && next.verse !== target && lines(whole) < maxLines) {
    if (format === 'poetry') {
      const couplets = poetryLines(next.text.trim()).split('\n');
      for (let c = 1; c <= couplets.length; c++) {
        const candidate = { verse: next.verse, text: couplets.slice(0, c).join('\n') };
        if (lines(whole, candidate) > maxLines) break;
        partial = candidate;
      }
    } else {
      const words = next.text.trim().split(/\s+/);
      let lo = 1;
      let hi = words.length - 1; // a whole verse would have gone in above
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const candidate = { verse: next.verse, text: words.slice(0, mid).join(' ') };
        if (lines(whole, candidate) <= maxLines) {
          partial = candidate;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
    }
  }

  // Never more than maxLines: drop trailing context, then leading context
  while (lines(whole, partial) > maxLines && whole.length > 1 && whole[whole.length - 1].verse !== target) {
    partial = null;
    whole.pop();
  }
  while (lines(whole, partial) > maxLines && whole.length > 1 && whole[0].verse !== target) {
    whole.shift();
  }

  return {
    text: blockText(whole, target, partial, opts),
    lines: lines(whole, partial),
    start: whole.length ? whole[0].verse : start,
    end: partial ? partial.verse : endWhole,
    whole: whole.map(v => v.verse),
    partial: partial ? partial.text : null,
  };
}

/** Split one verse too long for a slide into pieces that fit, word by word. */
export function splitLongVerse(verse, text, { maxLines, countLines, format }) {
  const words = text.trim().split(/\s+/);
  const pieces = [];
  let cur = [];
  const fits = ws => countLines(preventOrphan(`^${verse}^${format === 'poetry' ? poetryLines(ws.join(' ')) : ws.join(' ')}`)) <= maxLines;
  for (const w of words) {
    if (cur.length && !fits([...cur, w])) {
      pieces.push(cur.join(' '));
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) pieces.push(cur.join(' '));
  return pieces.map(p => preventOrphan(`^${verse}^${p}`));
}

/**
 * Lay out a passage: one slide per verse read, in order.
 *
 * @param verses   [{ verse, text }] the chapter (or the verses the request supplied)
 * @param targets  verse numbers read, in order
 * @param opts     { maxLines, countLines, format, bookId, chapter, context }
 *                 `context`: verses of context before a single-verse request (porch_slides' 2/1/0)
 * @returns [{ verse, text, start, end, lines, split? }]
 */
export function layoutPassage(verses, targets, opts) {
  const { maxLines, countLines, format, context = 2 } = opts;
  const at = n => verses.find(v => v.verse === n);
  const slides = [];
  let block = null;

  targets.forEach((target, i) => {
    const v = at(target);
    if (!v) return;

    // A verse too long for one slide on its own is split across slides
    const single = blockText([v], target, null, opts);
    if (countLines(single) > maxLines) {
      splitLongVerse(target, v.text, opts).forEach((text, p, all) => {
        slides.push({ verse: target, text, start: target, end: target, lines: countLines(text), split: all.length > 1 ? p + 1 : 0 });
      });
      block = null;
      return;
    }

    // Keep the block while the highlight can move down it with context to spare
    let reuse = false;
    if (block && block.whole.includes(target)) {
      const lastWhole = block.whole[block.whole.length - 1];
      const more = i + 1 < targets.length;
      if (target < lastWhole) reuse = true;
      else if (target === lastWhole) reuse = !more && block.whole.length < 4;
    }

    if (!reuse) {
      let start = target;
      const tryStarts = [];
      if (i === 0) {
        if (targets.length > 1) start = targets[0];
        else for (let b = context; b >= 1; b--) tryStarts.push(target - b);
      } else {
        // Later blocks: up to two verses already read stay above as context
        for (let b = 2; b >= 1; b--) if (target - b >= targets[0]) tryStarts.push(target - b);
      }
      for (const s of tryStarts) {
        if (s < 1 || !at(s)) continue;
        const candidate = fillBlock(verses, target, s, opts);
        if (candidate && candidate.whole.includes(target)) {
          start = s;
          break;
        }
      }
      block = fillBlock(verses, target, start, opts);
      if (!block || !block.whole.includes(target)) block = fillBlock(verses, target, target, opts);
    }

    const text = blockText(
      block.whole.map(n => at(n)),
      target,
      block.partial ? { verse: block.end, text: block.partial } : null,
      opts,
    );
    slides.push({ verse: target, text, start: block.start, end: block.end, lines: countLines(text) });
  });
  return slides;
}

/**
 * Rebuild one slide's block between two verses (the editor's context buttons):
 * whole verses from `start` to `end`, the target at full strength.
 */
export function blockBetween(verses, target, start, end, opts) {
  const whole = verses.filter(v => v.verse >= start && v.verse <= end);
  return blockText(whole, target, null, opts);
}
