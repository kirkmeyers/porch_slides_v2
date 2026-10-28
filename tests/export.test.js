import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTheme, resolveLayouts } from '../src/theme.js';
import { THEME_CONFIGS } from '../src/themes/configs.js';
import { parseRequestFile } from '../src/requests.js';
import { buildSlides } from '../src/slides.js';
import { buildPresentation, fillRtf, withBlanks, slideNotes } from '../src/propresenter.js';
import { decode, get, getAll, getMessage, asString, asDouble, asInt } from '../src/protobuf.js';

const measure = (s, style) => s.length * style.size * 0.5;
const metricsFor = style => ({ ascent: style.size * 0.95, descent: style.size * 0.25 });
const chapter = async () => Array.from({ length: 40 }, (_, i) => ({ verse: i + 1, text: `Text of verse ${i + 1}, with enough words to fill part of a line.` }));
const sample = readFileSync(new URL('../reference/sample-requests.txt', import.meta.url), 'utf8');

function layoutsFor(id) {
  const config = THEME_CONFIGS.find(c => c.id === id);
  const theme = parseTheme(new Uint8Array(readFileSync(new URL(`../src/themes/${config.file}/Theme.bin`, import.meta.url))));
  return { config, layouts: resolveLayouts(config, theme) };
}

async function deck(id) {
  const { config, layouts } = layoutsFor(id);
  const ctx = { layouts, measure, metricsFor, fetchChapter: chapter, context: 2, sentenceCasePoints: config.sentenceCasePoints };
  return { layouts, ...(await buildSlides(parseRequestFile(sample), ctx)) };
}

test('each theme resolves its scripture, quote and point slides', () => {
  for (const c of THEME_CONFIGS) {
    const { layouts } = layoutsFor(c.id);
    assert.equal(layouts.scripture.text.style.font, 'NHaasGroteskDSPro-55Rg');
    assert.equal(layouts.scripture.text.style.size, 82);
    assert.equal(layouts.scripture.text.style.align, 'justify');
    assert.equal(layouts.scripture.reference.style.caps, true);
    assert.equal(layouts.scripture.slide.elements.filter(e => e.fill).length, 1, 'the divider');
    assert.equal(layouts.quote.reference.style.font, 'IBMPlexMono');
    assert.equal(layouts.point.text.style.size, 96);
  }
});

test('The Inner Life moves the Lover’s boxes to its own positions', () => {
  const { layouts } = layoutsFor('inner-life');
  const ref = layouts.scripture.reference;
  assert.deepEqual(ref.bounds, { x: 330, y: 690, w: 821, h: 371 });
  assert.equal(ref.style.align, 'right');
  assert.match(ref.rtf, /\\qr\\partightenfactor0/);
  const raw = getMessage(decode(ref.raw), 1);
  assert.equal(asDouble(get(getMessage(getMessage(raw, 3), 1), 1)), 330);
  assert.equal(layouts.point.text.style.caps, false);
});

test('fills a text box with superscript verse numbers and see-through context', () => {
  const template = '{\\rtf1\\ansi{\\fonttbl\\f0\\fnil\\fcharset0 NHaasGroteskDSPro-55Rg;}\n{\\colortbl;\\red255\\green255\\blue255;\\red0\\green0\\blue0;}\n{\\*\\expandedcolortbl;;\\cssrgb\\c0\\c0\\c0\\c25000;}\n\\pard\\tx0\\pardirnatural\\qj\\partightenfactor0\n\n\\f0\\fs164 \\cf2 \\CocoaLigature0 Old text}';
  const rtf = fillRtf(template, '{^9^And} ^10^So “they”', 0.25, 'left');
  assert.ok(rtf.includes('\\red0\\green0\\blue0;\\red0\\green0\\blue0;\\red0\\green0\\blue0;}'));
  assert.ok(rtf.includes('\\cssrgb\\c0\\c0\\c0;\\cssrgb\\c0\\c0\\c0\\c25000;}'), 'the dim color carries its opacity');
  assert.ok(rtf.includes('\\f0\\fs164 \\cf3 \\CocoaLigature0 \\cf4 \\super 9\\nosupersub And\\cf3  \\super 10\\nosupersub So \\uc0\\u8220 they\\uc0\\u8221 }'));
  assert.ok(rtf.includes('\\ql\\partightenfactor0'));
  assert.ok(!rtf.includes('Old text'));
});

test('builds Porch slides: one per verse, reference over the verse, notes for the monitor', async () => {
  const { slides } = await deck('porch-generic');
  const mark = slides.filter(s => s.group === 'e0');
  assert.equal(mark.length, 5);
  assert.deepEqual(mark.map(s => s.reference), ['Mark\n9:9', 'Mark\n9:10', 'Mark\n9:11', 'Mark\n9:12', 'Mark\n9:13']);
  assert.ok(mark.every(s => s.lines <= 9 && !s.overflow));
  const psalm = slides.find(s => s.reference === 'Psalm\n46:1');
  assert.equal(psalm.align, 'left');
  assert.equal(slideNotes(mark[1]), 'Mark 9:10 - Text of verse 10, with enough words to fill part of a line.');
  const romans = slides.find(s => s.reference === 'Romans\n8:18');
  assert.ok(romans.text.includes('I consider that our present sufferings'));
  const quote = slides.find(s => s.kind === 'quote');
  assert.ok(quote.text.startsWith('“I have learned'));
});

test('exports live text with the intro blanks, a closing blank and clean text attributes', async () => {
  const { slides, layouts } = await deck('inner-life');
  const all = withBlanks(slides);
  assert.equal(all.length, slides.length + 6);
  assert.equal(all[2].label, 'Porch Live Locations - Confidence ONLY');
  const bytes = buildPresentation('20261027 - Inner_Life - Smith', all, layouts, { w: 3840, h: 2160 });
  const cues = getAll(decode(bytes), 13);
  assert.equal(cues.length, all.length);
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes('Porch Live Locations - Confidence ONLY'));
  assert.ok(text.includes('\\super 10\\nosupersub'));
  assert.ok(!text.includes('Lorum ipsem'), 'template sample text is replaced');
  assert.ok(text.includes('Theology of suffering'), 'Inner Life points are in sentence case');

  // The template's per-range attributes (sized for its sample text) are dropped;
  // an all-caps box gets one capitalization range over its new text
  const firstScripture = cues[5];
  const found = [];
  const walk = (bytesIn, depth) => {
    if (depth > 12) return;
    let fields;
    try { fields = decode(bytesIn); } catch { return; }
    for (const f of fields) {
      if (f.wire !== 2) continue;
      const s = asString(f);
      if (s && s.startsWith('{\\rtf1')) found.push(fields);
      else walk(f.value, depth + 1);
    }
  };
  walk(firstScripture.value, 0);
  assert.ok(found.length >= 2);
  let capsBoxes = 0;
  for (const textMsg of found) {
    const attrs = getMessage(textMsg, 3);
    if (!attrs) continue;
    const ranges = getAll(attrs, 13).map(f => decode(f.value));
    if (asInt(get(attrs, 2)) !== 1) {
      assert.equal(ranges.length, 0);
      continue;
    }
    capsBoxes += 1;
    assert.equal(ranges.length, 1);
    assert.equal(asInt(get(getMessage(ranges[0], 1), 2)), 'Mark\n9:9'.length);
    assert.equal(asInt(get(ranges[0], 2)), 1);
  }
  assert.equal(capsBoxes, 1, 'the reference');
});
