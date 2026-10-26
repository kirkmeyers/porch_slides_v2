/**
 * Parse a Porch request file (porch_slides' format) into its settings and
 * entries. One slide request per line, optionally numbered "Slide 3:":
 *
 *   # theme: porch-generic        porch-generic | lovers-series | inner-life
 *   # translation: ESV
 *   # communicator: Jane Smith
 *   # title: Idolatry Week 7
 *   # date: 2026-10-27            optional; used in file names (default: today)
 *   Slide 1: Mark 9:9-13 (ESV)    scripture: one slide per verse
 *   Slide 2: Romans 8:18 (NIV)
 *   > 18 For I consider that…     verse text for the line above (one verse per line)
 *   Slide 3: Theology of Suffering                 a point
 *   Slide 4: Charles Spurgeon – "I have learned…"  a quote: author – text
 */

import { lookupBook, normalizeTranslation, TRANSLATIONS } from './bible.js';

export const THEME_ALIASES = {
  'porch-generic': 'porch-generic',
  porch: 'porch-generic',
  generic: 'porch-generic',
  'lovers-series': 'lovers-series',
  lovers: 'lovers-series',
  "lover's": 'lovers-series',
  'inner-life': 'inner-life',
  inner_life: 'inner-life',
  'the-inner-life': 'inner-life',
};

const SLIDE_PREFIX = /^Slide\s*(?:\d+\s*)?:\s*/i;
const TRANSLATION_SUFFIX = String.raw`(?:\s*(?:\(([A-Za-z0-9\s]+)\)|([A-Za-z][A-Za-z0-9\s]*)))?`;
const SCRIPTURE = new RegExp(String.raw`^([1-3]?\s*[^:\n]+?)\s+(\d+)\s*:\s*([\d\s\-,;–—]+?)` + TRANSLATION_SUFFIX + '$', 'i');
const CROSS_CHAPTER = new RegExp(String.raw`^([1-3]?\s*[^:\n]+?)\s+(\d+)\s*:\s*(\d+)\s*[-–—]\s*(\d+)\s*:\s*(\d+)` + TRANSLATION_SUFFIX + '$', 'i');
const QUOTE = /^([^-–—\n]+?)\s+[-–—]\s+["“'‘]?([\s\S]+?)["”'’]?\s*$/;
const CHAPTER_VERSE = /\d+\s*:\s*\d+/;

/** "9-13", "60; 66", "7-8, 10" -> sorted unique verse numbers. */
export function parseVerseList(str) {
  const verses = [];
  for (const part of (str || '').replace(/[–—]/g, '-').split(/[;,]/)) {
    const p = part.trim();
    if (!p) continue;
    const [a, b] = p.split('-').map(s => parseInt(s.trim(), 10));
    if (!Number.isNaN(a) && b != null && !Number.isNaN(b)) for (let i = a; i <= b; i++) verses.push(i);
    else if (!Number.isNaN(a)) verses.push(a);
  }
  return [...new Set(verses)].sort((x, y) => x - y);
}

/** Supplied verse lines ("18 For I consider…", one verse per line) -> [{ verse, text }]. */
export function parseVerseLines(lines, fallbackVerse) {
  const verses = [];
  const tidy = s => s.replace(/\s+([,;:!?.)\]’”])/g, '$1').replace(/[ \t]+/g, ' ').trim();
  for (const raw of lines) {
    const line = raw.trim().replace(/^>\s*/, '');
    if (!line) continue;
    const m = line.match(/^(\d+)[.:\s\-)]+\s*(.*)$/);
    if (m && tidy(m[2])) verses.push({ verse: +m[1], text: tidy(m[2]) });
    else if (verses.length) verses[verses.length - 1].text += ' ' + tidy(line);
    else if (fallbackVerse != null) verses.push({ verse: fallbackVerse, text: tidy(line) });
  }
  return verses;
}

function scriptureEntry(m, raw) {
  const book = lookupBook(m[1].trim());
  if (!book) return null;
  const translation = (m[4] || m[5] || '').trim() || null;
  return { type: 'scripture', bookId: book.id, book: book.name, chapter: +m[2], verses: parseVerseList(m[3]), translation, lines: [], checks: [], raw };
}

/**
 * @returns {{ header, entries, warnings }}
 *   entries: { type: 'scripture', bookId, book, chapter, verses, translation, lines, checks }
 *          | { type: 'quote', text, author, checks } | { type: 'point', text, checks }
 */
export function parseRequestFile(text) {
  const header = {};
  const entries = [];
  const warnings = [];

  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = line.match(/^#\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (m) header[m[1].toLowerCase()] = m[2].trim();
      continue;
    }
    const clean = line.replace(SLIDE_PREFIX, '').trim();
    if (!clean) continue;

    if (clean.startsWith('>')) {
      const last = entries[entries.length - 1];
      if (last && last.type === 'scripture') last.lines.push(clean);
      else warnings.push(`Verse text with no scripture line before it was skipped: "${clean.slice(0, 40)}…"`);
      continue;
    }

    const cross = clean.match(CROSS_CHAPTER);
    if (cross && lookupBook(cross[1].trim())) {
      const book = lookupBook(cross[1].trim()).name;
      entries.push({ type: 'point', text: clean, checks: [`Cross-chapter ranges aren’t supported: request ${book} ${cross[2]} and ${book} ${cross[4]} on separate lines.`] });
      continue;
    }

    const hasChapterVerse = CHAPTER_VERSE.test(clean);
    const scripture = clean.match(SCRIPTURE);
    const entry = scripture && scriptureEntry(scripture, clean);
    if (entry) {
      entries.push(entry);
      continue;
    }

    if (!hasChapterVerse) {
      const q = clean.match(QUOTE);
      if (q) {
        // Usually "Author – quote"; also accept "“quote” – Author"
        const quoteFirst = /^["“‘']/.test(q[1]);
        const author = (quoteFirst ? q[2] : q[1]).trim().replace(/^["“‘']|["”’']$/g, '');
        const quote = (quoteFirst ? q[1] : q[2]).trim().replace(/^["“‘']+|["”’']+$/g, '');
        entries.push({ type: 'quote', text: quote, author, checks: [] });
        continue;
      }
    }

    // Anything else is a point. A "7:30" that isn't a reference gets a warning.
    entries.push({ type: 'point', text: clean, checks: hasChapterVerse ? ['This looks like a reference, but the book wasn’t recognized; it was made a point.'] : [] });
  }

  // Settings that don't match anything known are reported, not guessed
  if (header.theme && !THEME_ALIASES[header.theme.toLowerCase().trim()]) {
    warnings.push(`Unrecognized theme "${header.theme}"; keeping the current theme.`);
  }
  for (const t of [header.translation, ...entries.map(e => e.translation)].filter(Boolean)) {
    if (!TRANSLATIONS[normalizeTranslation(t)]) warnings.push(`Unrecognized translation "${t}"; using the ESV.`);
  }
  return { header, entries, warnings: [...new Set(warnings)] };
}

/** "Jane Smith" -> "Smith", skipping suffixes like Jr. or III. */
export function extractCommunicatorLastName(fullName) {
  if (!fullName || typeof fullName !== 'string') return '';
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const suffixRegex = /^(jr\.?|sr\.?|ii|iii|iv|v|vi)$/i;
  for (let i = words.length - 1; i >= 0; i--) {
    const clean = words[i].replace(/[,.]/g, '').trim();
    if (clean && !suffixRegex.test(clean)) {
      return clean.replace(/[/\\?%*:|"<>]/g, '').trim();
    }
  }
  return '';
}

/** "2026-10-27" -> "20261027" (falls back to today). */
export function dateCode(date) {
  const m = (date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Sentence case for The Inner Life's points, keeping capitals on names for
 * God, pronouns referring to him, and Roman numerals (from porch_slides).
 */
const DIVINE = new Set(['god', 'god’s', "god's", 'lord', 'lord’s', "lord's", 'jesus', 'jesus’', "jesus'", 'jesus’s', "jesus's", 'christ', 'christ’s', "christ's", 'father', 'father’s', "father's", 'son', 'son’s', "son's", 'creator', 'almighty', 'savior', 'saviour', 'messiah', 'yahweh', 'jehovah', 'trinity', 'bible', 'scripture', 'scriptures', 'gospel', 'gospels']);
const REVERENT_PRONOUNS = new Set(['he', 'him', 'his', 'himself', 'you', 'your', 'yours', 'yourself', 'them', 'their', 'theirs']);
const ROMAN = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']);

export function sentenceCase(input) {
  const tokens = (input || '').trim().match(/([A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*|[^A-Za-z0-9]+)/g) || [];
  const words = tokens.map((t, i) => (/^[A-Za-z0-9]/.test(t) ? i : -1)).filter(i => i >= 0);
  let out = '';
  let sentenceStart = true;
  tokens.forEach((t, i) => {
    if (!/^[A-Za-z0-9]/.test(t)) {
      out += t;
      if (/[.!?:\n—–-]/.test(t)) sentenceStart = true;
      return;
    }
    const lower = t.toLowerCase();
    const w = words.indexOf(i);
    const next = (tokens[words[w + 1]] || '').toLowerCase();
    const prev = (tokens[words[w - 1]] || '').toLowerCase();
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    if (lower === 'holy' && (next === 'spirit' || next === 'ghost')) out += 'Holy';
    else if ((lower === 'spirit' || lower === 'ghost') && prev === 'holy') out += cap(lower);
    else if (DIVINE.has(lower) || REVERENT_PRONOUNS.has(lower)) out += cap(lower);
    else if (ROMAN.has(lower)) out += lower.toUpperCase();
    else out += sentenceStart ? cap(lower) : lower;
    sentenceStart = false;
  });
  return out;
}
