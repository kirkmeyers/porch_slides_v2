/**
 * Read a ProPresenter 7 theme file and pull out what we need to draw and
 * export slides: each template slide's elements with their bounds, text
 * formatting (from the element's RTF) and image fills.
 *
 * Theme file layout (field numbers, schema-less):
 *   Theme.3            template slide { 1: Slide, 2: name }
 *   Slide.1            Slide.Element { 1: Graphics.Element, ... }
 *   Slide.6            size { 1: width, 2: height }
 *   Graphics.Element   1 uuid, 2 name, 3 bounds, 5 opacity, 9 fill, 13 text
 *   Fill               1 color { 1 r, 2 g, 3 b, 4 a }, 3 media, 4 enabled
 *   Text               5 RTF bytes, 6 vertical alignment (0 top, 1 middle, 2 bottom)
 */

import { decode, get, getAll, getMessage, asString, asDouble, asInt } from './protobuf.js';
import { rewriteElement, setRtfAlign } from './elements.js';

/** Parse the bounds message { 1: origin {1 x, 2 y}, 2: size {1 w, 2 h} }. */
function readBounds(el) {
  const b = getMessage(el, 3);
  if (!b) return { x: 0, y: 0, w: 0, h: 0 };
  const o = getMessage(b, 1) || [];
  const s = getMessage(b, 2) || [];
  return {
    x: asDouble(get(o, 1)),
    y: asDouble(get(o, 2)),
    w: asDouble(get(s, 1)),
    h: asDouble(get(s, 2)),
  };
}

/** Find the image file name in a media fill, if any. */
function readImageFill(el) {
  const fill = getMessage(el, 9);
  const media = fill && getMessage(fill, 3);
  const url = media && getMessage(media, 2);
  if (!url) return null;
  const path = asString(get(url, 1)) || asString(get(url, 2)) || '';
  const name = decodeURIComponent(path.split('/').pop() || '');
  return name || null;
}

/** A shape's solid fill color as [r, g, b, a] in 0-255 (alpha 0-1), or null. */
function readSolidFill(el) {
  const fill = getMessage(el, 9);
  if (!fill || asInt(get(fill, 4)) !== 1) return null;
  const c = getMessage(fill, 1);
  if (!c) return null;
  const ch = n => (get(c, n) ? asDouble(get(c, n)) : 0);
  return [ch(1) * 255, ch(2) * 255, ch(3) * 255, ch(4)];
}

/**
 * Pull formatting out of a Cocoa RTF string. ProPresenter stores text styling
 * in RTF; the values here are in points, which equal pixels on the slide canvas.
 */
export function readRtfStyle(rtf) {
  const font = (rtf.match(/\\fcharset0 ([^;]+);/) || [])[1] || null;
  const fs = rtf.match(/\\fs(\d+)/);
  const sl = rtf.match(/\\sl(-?\d+)\\slmult1/);
  const leading = rtf.match(/\\slleading(\d+)/);
  const expnd = rtf.match(/\\expndtw(-?\d+)/);
  let align = 'left';
  if (/\\qc(?![a-z])/.test(rtf)) align = 'center';
  else if (/\\qr(?![a-z])/.test(rtf)) align = 'right';
  else if (/\\qj(?![a-z])/.test(rtf)) align = 'justify';

  // Color table: index 0 is "auto"; \cfN picks entry N
  const colors = [null];
  const tbl = rtf.match(/\{\\colortbl;([^}]*)\}/);
  if (tbl) {
    for (const entry of tbl[1].split(';')) {
      const m = entry.match(/\\red(\d+)\\green(\d+)\\blue(\d+)/);
      if (m) colors.push([+m[1], +m[2], +m[3]]);
    }
  }
  const body = rtf.split('\\partightenfactor0').pop();
  const cf = body.match(/\\cf(\d+)/);
  const rgb = (cf && colors[+cf[1]]) || [255, 255, 255];

  return {
    font,
    size: fs ? +fs[1] / 2 : 72,
    lineMultiple: sl ? +sl[1] / 240 : 1,
    leading: leading ? +leading[1] / 20 : 0,
    letterSpacing: expnd ? +expnd[1] / 20 : 0,
    align,
    color: rgb,
  };
}

function readElement(slideElementBytes) {
  const se = decode(slideElementBytes);
  const el = getMessage(se, 1);
  if (!el) return null;
  const textMsg = getMessage(el, 13);
  const rtf = textMsg ? asString(get(textMsg, 5)) : null;
  const hasText = !!rtf && /\\fcharset0 /.test(rtf);
  // Text.3 attributes, .2 capitalization: 1 = all caps
  const attrs = textMsg && getMessage(textMsg, 3);
  const caps = !!attrs && asInt(get(attrs, 2)) === 1;
  const image = readImageFill(el);
  return {
    fill: hasText || image ? null : readSolidFill(el), // the divider line beside the scripture
    name: asString(get(el, 2)) || '',
    bounds: readBounds(el),
    opacity: get(el, 5) ? asDouble(get(el, 5)) : 1,
    rtf: hasText ? rtf : null,
    style: hasText ? { ...readRtfStyle(rtf), caps } : null,
    valign: textMsg ? ['top', 'middle', 'bottom'][asInt(get(textMsg, 6))] || 'top' : 'top',
    image,
    raw: slideElementBytes, // Slide.Element bytes, reused for export
  };
}

/** Parse a theme file into { slides: { [name]: { size, elements[] } } }. */
export function parseTheme(bytes) {
  const top = decode(bytes);
  const slides = {};
  for (const t of getAll(top, 3)) {
    const tf = decode(t.value);
    const name = asString(get(tf, 2)) || '';
    const slide = getMessage(tf, 1);
    if (!slide) continue;
    const sizeMsg = getMessage(slide, 6) || [];
    slides[name] = {
      name,
      size: { w: asDouble(get(sizeMsg, 1)) || 3840, h: asDouble(get(sizeMsg, 2)) || 2160 },
      elements: getAll(slide, 1).map(f => readElement(f.value)).filter(Boolean),
    };
  }
  return { slides };
}

/**
 * Move or restyle one element: new bounds, alignment or capitalization, in
 * both the parsed values (for drawing) and the raw bytes (for export).
 */
function adjustElement(el, adj) {
  if (!adj) return el;
  const out = { ...el, bounds: { ...el.bounds, ...(adj.bounds || {}) } };
  if (el.style) {
    out.style = { ...el.style };
    if (adj.align) out.style.align = adj.align;
    if (adj.caps != null) out.style.caps = adj.caps;
    if (adj.align) out.rtf = setRtfAlign(el.rtf, adj.align);
  }
  out.raw = rewriteElement(el.raw, { bounds: out.bounds, align: adj.align, caps: adj.caps });
  return out;
}

/**
 * Resolve a theme config's layouts against the parsed theme file.
 * A layout picks a template slide and names which elements carry the slide's
 * main text and (optionally) its reference line: by element name, or by
 * position among the slide's text boxes when the theme left them unnamed.
 * `adjust` moves or restyles elements ({ text, reference, shapes: [...] }).
 */
export function resolveLayouts(themeConfig, parsed) {
  const layouts = {};
  for (const [key, spec] of Object.entries(themeConfig.layouts)) {
    const found = parsed.slides[spec.slide];
    if (!found) throw new Error(`Theme "${themeConfig.name}" has no slide named "${spec.slide}"`);
    const textEls = found.elements.filter(e => e.rtf);
    const pick = which => (typeof which === 'number' ? textEls[which] : which ? found.elements.find(e => e.name === which) : textEls[0]) || null;
    let text = pick(spec.text);
    let reference = spec.reference != null ? pick(spec.reference) : null;
    if (!text) throw new Error(`Theme layout "${key}" has no text element`);

    let elements = found.elements;
    const adjust = spec.adjust;
    if (adjust) {
      const shapes = found.elements.filter(e => e.fill);
      elements = found.elements.map(e => {
        if (e === text) return (text = adjustElement(e, adjust.text));
        if (e === reference) return (reference = adjustElement(e, adjust.reference));
        const s = shapes.indexOf(e);
        return s >= 0 && adjust.shapes ? adjustElement(e, adjust.shapes[s]) : e;
      });
    }
    layouts[key] = { key, slide: { ...found, elements }, text, reference, maxLines: spec.maxLines || null };
  }
  return layouts;
}
