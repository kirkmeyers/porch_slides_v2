import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLocations, splitLocations, datedForAnotherDay } from '../src/locations.js';
import { parseRequestFile } from '../src/requests.js';
import { withBlanks, buildPresentation, readPresentationText } from '../src/propresenter.js';
import { parseTheme, resolveLayouts } from '../src/theme.js';
import { THEME_CONFIGS } from '../src/themes/configs.js';

test('reads the locations the listener sends', () => {
  assert.deepEqual(parseLocations('Fort Worth, Midland, Greater Lafayette').locations, ['Fort Worth', 'Midland', 'Greater Lafayette']);
  const comment = parseLocations('https://app.asana.com/1/1000/profile/2000 For 10/27: Fort Worth, Midland and Greater Lafayette');
  assert.deepEqual(comment, { locations: ['Fort Worth', 'Midland', 'Greater Lafayette'], month: 10, day: 27 });
  assert.equal(datedForAnotherDay(comment, '2026-10-27'), false);
  assert.equal(datedForAnotherDay(comment, '2026-11-03'), true);
  assert.deepEqual(splitLocations('Wheaton & Dayton; Boise.'), ['Wheaton', 'Dayton', 'Boise']);
});

test('a request file carries the locations and their Asana task', () => {
  const p = parseRequestFile('# date: 2026-10-27\n# locations: Fort Worth, Midland\n# locations-task: https://app.asana.com/0/1/2\nSlide 1: Mark 9:9');
  assert.equal(p.header.locations, 'Fort Worth, Midland');
  assert.equal(p.header['locations-task'], 'https://app.asana.com/0/1/2');
});

test('the locations go on the third intro slide, as text and in its notes', () => {
  const config = THEME_CONFIGS[0];
  const layouts = resolveLayouts(config, parseTheme(new Uint8Array(readFileSync(new URL(`../src/themes/${config.file}/Theme.bin`, import.meta.url)))));
  const all = withBlanks([], { locations: ['Fort Worth', 'Midland'] });
  assert.equal(all[2].label, 'Porch Live Locations - Confidence ONLY');
  assert.equal(all[2].layout, 'point');
  assert.equal(all[2].text, 'Fort Worth\nMidland');
  assert.equal(all[2].notes, 'Porch Live Locations: Fort Worth, Midland');
  const texts = readPresentationText(buildPresentation('t', all, layouts, { w: 3840, h: 2160 }));
  assert.ok(texts[2].some(t => t.includes('Fort Worth\\\nMidland')), 'locations on the slide');
  assert.ok(texts[2].some(t => t.includes('Porch Live Locations: Fort Worth, Midland')), 'and in the notes');
  assert.deepEqual(texts[0], []);
  // Without locations it stays a plain blank
  assert.equal(withBlanks([])[2].layout, null);
  assert.equal(withBlanks([])[2].notes, 'Porch Live Locations - Confidence ONLY');
});
