/**
 * Turn parsed request entries into slides, in order.
 *
 * Slide shape:
 * {
 *   id, kind: 'scripture' | 'quote' | 'point' | 'blank',
 *   layout: theme layout key ('scripture' | 'quote' | 'point'),
 *   group: id shared by slides made from one request line (a passage's id),
 *   text: slide text (see layout.js for \n, {dim} and ^verse^ markup),
 *   reference: "Mark\n9:10" (scripture), or the author (quote),
 *   ref: { verse, start, end } for scripture: the verse read and the block shown,
 *   align: 'left' for poetry, which is set flush left in the justified box,
 *   source: the text before automatic line breaks (points),
 *   cues: operator notes, added to the ProPresenter slide notes,
 *   checks: things to look at, shown as badges,
 *   lines: how many lines the text takes; overflow: more than the box holds,
 *   needsText: a verse with no text yet (NIV, or Bolls unreachable),
 *   edited: true once the operator changes the text by hand
 * }
 *
 * Scripture slides come from a passage record, kept per group so a passage can
 * be rebuilt in another translation or theme:
 * {
 *   group, bookId, book, chapter, targets: [verses read], translation, sourceTranslation,
 *   verses: [{ verse, text }] the chapter (or supplied verses), or null when there's no text,
 *   manuscript: verses supplied in the request file, or null,
 *   checks
 * }
 */

import { normalizeTranslation, translationName, isNivTranslation, TRANSLATIONS, cleanVerseText, smartQuotes } from './bible.js';
import { parseVerseLines, sentenceCase } from './requests.js';
import { layoutPassage, passageFormat, blockText } from './passage.js';
import { countLines, balanceLines, preventOrphan, textArea, applyCase, maxLinesFor } from './layout.js';

let nextId = 1;
export function newId() {
  return `s${Date.now().toString(36)}${(nextId++).toString(36)}`;
}

export const KIND_LABELS = {
  scripture: 'Scripture',
  quote: 'Quote',
  point: 'Point',
  blank: 'Blank',
};

export function layoutForKind(kind) {
  if (kind === 'scripture' || kind === 'quote') return kind;
  return 'point';
}

export function makeSlide(kind, fields = {}) {
  return {
    id: newId(),
    kind,
    layout: layoutForKind(kind),
    group: fields.group || newId(),
    text: '',
    reference: '',
    ref: null,
    align: null,
    source: fields.text || '',
    cues: [],
    checks: [],
    edited: false,
    ...fields,
  };
}

/** Book name as the reference prints it: a single psalm is "Psalm". */
function displayBook(passage) {
  return passage.bookId === 19 ? 'Psalm' : passage.book;
}

/** The reference box: book over chapter and verse, e.g. "Mark\n9:10". */
export function passageReference(passage, verse) {
  return `${displayBook(passage)}\n${passage.chapter}:${verse}`;
}

/** "Mark 9:9-13" for labels, warnings and file names. */
export function passageLabel(passage) {
  const t = passage.targets;
  const first = t[0];
  const last = t[t.length - 1];
  const contiguous = t.every((v, i) => !i || v === t[i - 1] + 1);
  const verses = t.length === 1 ? `${first}` : contiguous ? `${first}-${last}` : t.join(', ');
  return `${displayBook(passage)} ${passage.chapter}:${verses}`;
}

/** Measuring helpers for a theme layout's text box. */
export function boxMeasure(layout, measure, metricsFor) {
  const el = layout.text;
  const width = textArea(el).w;
  const fromBox = maxLinesFor(el, metricsFor(el.style));
  return {
    maxLines: layout.maxLines ? Math.min(layout.maxLines, fromBox) : fromBox,
    countLines: text => countLines(applyCase(text, el.style), width, measure, el.style),
    width,
  };
}

/**
 * The slides for one passage: one per verse read, each showing its block.
 * Verses with no text become "text needed" slides to type into.
 */
export function passageSlides(passage, { layouts, measure, metricsFor, context = 2 }) {
  const box = boxMeasure(layouts.scripture, measure, metricsFor);
  const base = { group: passage.group };
  const reference = verse => passageReference(passage, verse);
  const needs = verse =>
    makeSlide('scripture', { ...base, reference: reference(verse), ref: { verse, start: verse, end: verse }, needsText: true, lines: 0 });

  let slides;
  if (!passage.verses) {
    slides = passage.targets.map(needs);
  } else {
    const format = passageFormat(passage.bookId, passage.chapter, passage.verses);
    const laid = layoutPassage(passage.verses, passage.targets, {
      ...box,
      format,
      bookId: passage.bookId,
      chapter: passage.chapter,
      context,
    });
    slides = [];
    for (const verse of passage.targets) {
      const forVerse = laid.filter(s => s.verse === verse);
      if (!forVerse.length) {
        slides.push(needs(verse));
        continue;
      }
      for (const s of forVerse) {
        slides.push(makeSlide('scripture', {
          ...base,
          text: s.text,
          source: s.text,
          reference: reference(verse),
          ref: { verse, start: s.start, end: s.end, part: s.split || 0 },
          align: format === 'poetry' ? 'left' : null,
          lines: s.lines,
          overflow: s.lines > box.maxLines,
        }));
      }
    }
  }
  if (slides.length) slides[0].checks = [...passage.checks];
  return slides;
}

/** Rebuild one scripture slide's text between two verses (the editor's context buttons). */
export function slideBlock(passage, slide, start, end, { layouts, measure, metricsFor }) {
  const box = boxMeasure(layouts.scripture, measure, metricsFor);
  const format = passageFormat(passage.bookId, passage.chapter, passage.verses);
  const whole = passage.verses.filter(v => v.verse >= start && v.verse <= end);
  const text = blockText(whole, slide.ref.verse, null, { format, bookId: passage.bookId, chapter: passage.chapter });
  const lines = box.countLines(text);
  return { ...slide, text, ref: { ...slide.ref, start, end }, lines, overflow: lines > box.maxLines, edited: false };
}

/** Lay out a point or quote: balanced lines for points, no one-word last line for quotes. */
export function layoutTextSlide(slide, { layouts, measure, metricsFor }) {
  if (slide.kind === 'blank' || slide.kind === 'scripture') return slide;
  const layout = layouts[slide.layout];
  const box = boxMeasure(layout, measure, metricsFor);
  const style = layout.text.style;
  const source = slide.source || slide.text;
  let text = slide.text;
  if (!slide.edited && slide.kind === 'point') {
    // Balance as it will show (all caps in most themes), then put the breaks in the original text
    const balanced = balanceLines(applyCase(source, style), box.width, measure, style);
    const words = source.split(/\s+/).filter(Boolean);
    let at = 0;
    text = balanced
      .split('\n')
      .map(line => {
        const n = line.split(/\s+/).filter(Boolean).length;
        at += n;
        return words.slice(at - n, at).join(' ');
      })
      .join('\n');
  } else if (!slide.edited) {
    text = preventOrphan(source);
  }
  const lines = box.countLines(text);
  return { ...slide, text, lines, overflow: lines > box.maxLines };
}

/** Recount lines (after a hand edit or a theme change). */
export function measureSlide(slide, ctx) {
  if (slide.kind === 'blank' || !slide.layout) return { ...slide, lines: 0, overflow: false };
  const box = boxMeasure(ctx.layouts[slide.layout], ctx.measure, ctx.metricsFor);
  const lines = slide.needsText ? 0 : box.countLines(slide.text);
  return { ...slide, lines, overflow: lines > box.maxLines };
}

/** Join back-to-back requests for the same chapter ("Mark 9:9-10", "Mark 9:11") into one passage. */
function coalesce(entries) {
  const out = [];
  for (const e of entries) {
    const prev = out[out.length - 1];
    if (
      e.type === 'scripture' && prev && prev.type === 'scripture' &&
      !e.lines.length && !prev.lines.length &&
      prev.bookId === e.bookId && prev.chapter === e.chapter && prev.translation === e.translation &&
      (e.verses[0] === prev.verses[prev.verses.length - 1] + 1 || prev.verses.includes(e.verses[0]))
    ) {
      prev.verses = [...new Set([...prev.verses, ...e.verses])].sort((a, b) => a - b);
      prev.checks.push(...e.checks);
      continue;
    }
    out.push(e.type === 'scripture' ? { ...e, verses: [...e.verses], checks: [...e.checks] } : e);
  }
  return out;
}

/** A known translation code, or the ESV. */
export function translationCode(raw) {
  const code = normalizeTranslation(raw || 'ESV');
  return TRANSLATIONS[code] ? code : 'ESV';
}

/**
 * Get a passage's verse text: the request file's own verses if it has them,
 * otherwise the chapter from Bolls. Bolls doesn't serve the NIV.
 */
export async function loadPassageText(passage, fetchChapter) {
  if (passage.manuscript && passage.translation === passage.sourceTranslation) {
    passage.verses = passage.manuscript;
    return;
  }
  if (isNivTranslation(passage.translation)) {
    passage.verses = null;
    passage.checks.push(`Bolls doesn’t carry the ${translationName(passage.translation)}. Paste the verses in the editor, or type them on each slide.`);
    return;
  }
  passage.verses = await fetchChapter(passage.bookId, passage.chapter, passage.translation);
  if (!passage.verses) passage.checks.push(`Couldn’t get ${passageLabel(passage)} in the ${translationName(passage.translation)} from Bolls. Check the connection, then switch the translation to try again, or paste the verses.`);
  else if (passage.targets.some(v => !passage.verses.find(x => x.verse === v))) {
    passage.checks.push(`Some verses of ${passageLabel(passage)} aren’t in the ${translationName(passage.translation)} chapter; check the reference.`);
  }
}

/**
 * Build slides from a parsed request file.
 * @param ctx { layouts, measure, metricsFor, fetchChapter, context, sentenceCasePoints }
 * @returns { slides, passages }  passages by group id
 */
export async function buildSlides(parsed, ctx) {
  const defaultTranslation = translationCode(parsed.header.translation);
  const slides = [];
  const passages = {};

  for (const [index, entry] of coalesce(parsed.entries).entries()) {
    const group = `e${index}`;
    if (entry.type === 'point') {
      let text = smartQuotes(entry.text);
      const checks = [...entry.checks];
      if (ctx.sentenceCasePoints) {
        const cased = sentenceCase(text);
        if (cased !== text) checks.push('Set in sentence case for this theme; check the capitals.');
        text = cased;
      }
      slides.push(layoutTextSlide(makeSlide('point', { group, text, source: text, checks }), ctx));
      continue;
    }
    if (entry.type === 'quote') {
      const text = `“${smartQuotes(entry.text)}”`;
      const checks = [...entry.checks];
      if (!entry.author) checks.push('No author found before the dash.');
      slides.push(layoutTextSlide(makeSlide('quote', { group, text, source: text, reference: entry.author, checks }), ctx));
      continue;
    }

    // Scripture
    const translation = entry.translation ? translationCode(entry.translation) : defaultTranslation;
    const manuscript = entry.lines.length
      ? parseVerseLines(entry.lines, entry.verses[0]).map(v => ({ verse: v.verse, text: cleanVerseText(v.text) }))
      : null;
    const passage = {
      group,
      bookId: entry.bookId,
      book: entry.book,
      chapter: entry.chapter,
      targets: entry.verses.length ? entry.verses : [1],
      translation,
      sourceTranslation: translation,
      verses: null,
      manuscript,
      checks: [...entry.checks],
    };
    if (manuscript) passage.checks.push('Verse text came from the request file; check it against the Bible.');
    await loadPassageText(passage, ctx.fetchChapter);
    passages[group] = passage;
    slides.push(...passageSlides(passage, ctx));
  }
  return { slides, passages };
}
