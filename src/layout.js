/**
 * Text layout shared by the preview, PNG export and the slide builder.
 *
 * Slide text is plain text with a little markup:
 *   \n        a hard line break (exported to ProPresenter as a line break)
 *   {words}   de-emphasized (dimmed) words: the context verses around the one being read
 *   ^12^      a verse number, set as a superscript
 *        a non-breaking space, which keeps a verse from ending on one word
 *
 * Measuring is injected (`measure(str, style) -> px`) so the same code runs in
 * the browser (canvas) and in tests.
 */

// Verse numbers: half size, raised. ProPresenter's own superscript in the Porch
// templates is set at half the text size (41pt numbers in 82pt text).
export const SUP_SCALE = 0.5;
export const SUP_RISE = 0.42;

export const NBSP = ' ';

export function supStyle(style) {
  return { ...style, size: style.size * SUP_SCALE };
}

/** Split text into runs: [{ text, dim, sup }]. Unbalanced braces are treated as text. */
export function parseRuns(text) {
  const runs = [];
  let dim = false;
  let sup = false;
  let buf = '';
  const flush = () => {
    if (buf) runs.push({ text: buf, dim, sup });
    buf = '';
  };
  for (const ch of text || '') {
    if (ch === '{' && !dim) {
      flush();
      dim = true;
    } else if (ch === '}' && dim) {
      flush();
      dim = false;
    } else if (ch === '^') {
      flush();
      sup = !sup;
    } else {
      buf += ch;
    }
  }
  flush();
  return runs;
}

/** Text without markup. */
export function plainText(text) {
  return parseRuns(text).map(r => r.text).join('');
}

/** Text without markup or verse numbers, for notes and labels. */
export function readingText(text) {
  return parseRuns(text)
    .filter(r => !r.sup)
    .map(r => r.text)
    .join('')
    .replace(new RegExp(NBSP, 'g'), ' ');
}

/**
 * Break text into words, each a list of segments { text, dim, sup }, plus the
 * hard breaks. A verse number and the word after it are one word.
 */
function tokenize(text) {
  const tokens = []; // { segs: [...] } | { br: true }
  let cur = null;
  const end = () => {
    if (cur) tokens.push(cur);
    cur = null;
  };
  for (const run of parseRuns(text)) {
    for (const p of run.text.split(/(\n| +)/)) {
      if (p === '\n') {
        end();
        tokens.push({ br: true });
      } else if (/^ +$/.test(p)) {
        end();
      } else if (p) {
        if (!cur) cur = { segs: [] };
        cur.segs.push({ text: p, dim: run.dim, sup: run.sup });
      }
    }
  }
  end();
  return tokens;
}

function segWidth(seg, measure, style) {
  return measure(seg.text, seg.sup ? supStyle(style) : style);
}

/**
 * Wrap text to a width. Returns lines:
 *   { words: [{ segs, width }], width, count, endsParagraph }
 * `endsParagraph` is true for a line that ends at a hard break or the end of
 * the text; ProPresenter doesn't stretch those lines when justifying.
 */
export function wrapLines(text, maxWidth, measure, style) {
  const lines = [];
  let cur = [];
  const space = measure(' ', style);
  const lineWidth = words => words.reduce((w, t, i) => w + t.width + (i ? space : 0), 0);

  const flush = endsParagraph => {
    lines.push({ words: cur, width: lineWidth(cur), count: cur.length, endsParagraph });
    cur = [];
  };

  for (const t of tokenize(text)) {
    if (t.br) {
      flush(true);
      continue;
    }
    const word = { segs: t.segs, width: t.segs.reduce((w, s) => w + segWidth(s, measure, style), 0) };
    if (cur.length && lineWidth([...cur, word]) > maxWidth) flush(false);
    cur.push(word);
  }
  if (cur.length || lines.length === 0) flush(true);
  return lines;
}

export function countLines(text, maxWidth, measure, style) {
  if (!plainText(text).trim()) return 0;
  return wrapLines(text, maxWidth, measure, style).length;
}

/**
 * Line pitch in px. ProPresenter (Core Text) scales the font's natural line
 * height by the paragraph's line-height multiple and adds any extra leading.
 */
export function linePitch(style, fontMetrics) {
  return (fontMetrics.ascent + fontMetrics.descent) * style.lineMultiple + style.leading;
}

/**
 * Distance from a line's top to its baseline. Core Text splits the space a
 * line-height multiple adds (or removes) evenly above and below the glyphs;
 * extra leading goes below. Measured against ProPresenter's own exports.
 */
export function baselineOffset(style, fontMetrics) {
  const natural = fontMetrics.ascent + fontMetrics.descent;
  return fontMetrics.ascent + (natural * style.lineMultiple - natural) / 2;
}

// ProPresenter text boxes keep 5pt of padding inside their left and right edges
// (Cocoa's line fragment padding), so text wraps and aligns in a narrower area.
export const TEXT_INSET = 5;

export function textArea(element) {
  const { x, w } = element.bounds;
  return { x: x + TEXT_INSET, w: w - TEXT_INSET * 2 };
}

/** Apply the text box's capitalization (e.g. references set in all caps). */
export function applyCase(text, style) {
  return style.caps ? text.toUpperCase() : text;
}

export function maxLinesFor(element, fontMetrics) {
  return Math.max(1, Math.floor((element.bounds.h + 0.5) / linePitch(element.style, fontMetrics)));
}

/**
 * Keep a block from ending on a single word, as porch_slides does: the last
 * space becomes a non-breaking space, so the last two words wrap together.
 */
export function preventOrphan(text) {
  const t = (text || '').replace(new RegExp(NBSP, 'g'), ' ');
  const at = t.lastIndexOf(' ');
  return at < 0 ? t : t.slice(0, at) + NBSP + t.slice(at + 1);
}

/**
 * Balance a short text (a sermon point) over the fewest lines it needs, so
 * the lines come out close to equal length instead of one long line and a
 * stub. Leaves text that already has hard breaks alone.
 */
export function balanceLines(text, maxWidth, measure, style) {
  if (text.includes('\n') || /[{}^]/.test(text)) return text;
  const lineCount = wrapLines(text, maxWidth, measure, style).length;
  const words = text.split(/\s+/).filter(Boolean);
  if (lineCount < 2 || lineCount > 4 || words.length > 40) return text;

  const space = measure(' ', style);
  const widths = words.map(w => measure(w, style));
  const span = (a, b) => widths.slice(a, b).reduce((s, w) => s + w, 0) + space * (b - a - 1);

  // Try every way to break into `lineCount` lines; prefer even lines and
  // breaks at phrase boundaries ("…for your life / in his power…")
  let best = null;
  const search = (start, breaks) => {
    if (breaks.length === lineCount - 1) {
      const lines = [...breaks, words.length].map((end, i) => [i ? breaks[i - 1] : 0, end]);
      const lineWidths = lines.map(([a, b]) => span(a, b));
      if (lineWidths.some(w => w > maxWidth)) return;
      let score = Math.max(...lineWidths);
      for (const b of breaks) {
        if (TRAILING_WEAK.has(words[b - 1].toLowerCase())) score += maxWidth * 0.25;
        if (LEADING_PHRASE.has(words[b].toLowerCase())) score -= maxWidth * 0.12;
      }
      if (!best || score < best.score) best = { score, breaks: [...breaks] };
      return;
    }
    for (let b = start + 1; b < words.length; b++) search(b, [...breaks, b]);
  };
  search(0, []);
  if (!best) return text;
  const ends = [...best.breaks, words.length];
  return ends.map((end, i) => words.slice(i ? ends[i - 1] : 0, end).join(' ')).join('\n');
}

// Words a line shouldn't end on, and words that start a phrase
const TRAILING_WEAK = new Set(['a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'and', 'or', 'but', 'his', 'her', 'my', 'your', 'our', 'their', 'its', 'is', 'are', 'will', 'be']);
const LEADING_PHRASE = new Set(['in', 'and', 'but', 'at', 'with', 'by', 'because', 'that', 'so', 'when', 'who', 'which', 'through']);

/**
 * Split text that is too tall for the box into chunks that fit, breaking
 * between sentences when possible, then between clauses, then between words.
 */
export function splitToFit(text, maxWidth, maxLines, measure, style) {
  const fits = t => wrapLines(t, maxWidth, measure, style).length <= maxLines;
  if (fits(text)) return [text];
  const flat = text.replace(/\n/g, ' ');
  for (const pattern of [/(?<=[.?!][’”"]?)\s+/, /(?<=[;:,—][’”"]?)\s*/, /\s+/]) {
    const pieces = flat.split(pattern).filter(Boolean);
    if (pieces.length < 2) continue;
    const chunks = [];
    let cur = '';
    let ok = true;
    for (const p of pieces) {
      const joiner = cur && !cur.endsWith('—') ? ' ' : '';
      const candidate = cur ? cur + joiner + p : p;
      if (fits(candidate)) {
        cur = candidate;
      } else {
        if (!cur || !fits(p)) {
          ok = false;
          break;
        }
        chunks.push(cur);
        cur = p;
      }
    }
    if (ok) {
      if (cur) chunks.push(cur);
      return chunks;
    }
  }
  return [text];
}

/** Per-character flags for marked-up text: { chars, dim: boolean[], sup: boolean[] }. */
function charFlags(text) {
  let chars = '';
  const dim = [];
  const sup = [];
  for (const run of parseRuns(text)) {
    chars += run.text;
    for (let i = 0; i < run.text.length; i++) {
      dim.push(run.dim);
      sup.push(run.sup);
    }
  }
  return { chars, dim, sup };
}

function fromFlags(chars, dimFlags, sup) {
  // Spaces and line breaks take the dim state of the words on both sides, so braces hug words
  const dim = dimFlags.map((d, i) => (/\s/.test(chars[i]) ? !!(dimFlags[i - 1] && dimFlags[i + 1]) : d));
  let out = '';
  let inDim = false;
  let inSup = false;
  for (let i = 0; i < chars.length; i++) {
    if (inDim && !dim[i]) {
      out += '}';
      inDim = false;
    }
    if (!inDim && dim[i]) {
      out += '{';
      inDim = true;
    }
    if (inSup !== !!sup[i]) {
      out += '^';
      inSup = !inSup;
    }
    out += chars[i];
  }
  if (inDim) out += '}';
  if (inSup) out += '^';
  return out;
}

/** True if every character between plain-text offsets start and end is dimmed. */
export function isAllDim(text, start, end) {
  const { chars, dim } = charFlags(text);
  let any = false;
  for (let i = start; i < end; i++) {
    if (/\s/.test(chars[i])) continue; // a double-click can pick up the space after a word
    if (!dim[i]) return false;
    any = true;
  }
  return any;
}

/** Dim (or undim) the characters between plain-text offsets start and end. */
export function setDim(text, start, end, value) {
  const { chars, dim, sup } = charFlags(text);
  for (let i = Math.max(0, start); i < Math.min(chars.length, end); i++) {
    dim[i] = value;
  }
  return fromFlags(chars, dim, sup);
}

/** Part of a text between plain-text offsets, keeping its markup. */
export function sliceText(text, start, end) {
  const { chars, dim, sup } = charFlags(text);
  return fromFlags(chars.slice(start, end), dim.slice(start, end), sup.slice(start, end));
}
