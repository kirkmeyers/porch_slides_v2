import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocationsComment, pickLocations, splitLocations } from '../src/asana.js';
import { withBlanks } from '../src/propresenter.js';

const mention = 'https://app.asana.com/1/1000/profile/2000';

test('reads the locations out of a Live Locations comment', () => {
  assert.deepEqual(parseLocationsComment(`${mention} For 10/27: Fort Worth, Midland, Greater Lafayette`), { month: 10, day: 27, locations: ['Fort Worth', 'Midland', 'Greater Lafayette'] });
  assert.deepEqual(parseLocationsComment(`${mention} for 10/20: Springfield and Boise`).locations, ['Springfield', 'Boise']);
  assert.deepEqual(parseLocationsComment('10/6: Scottsdale, Fort Worth, Midland').locations, ['Scottsdale', 'Fort Worth', 'Midland']);
  assert.equal(parseLocationsComment('Pulled Scottsdale? Could you add a new item next time?'), null);
  assert.deepEqual(splitLocations('Wheaton & Dayton; Boise.'), ['Wheaton', 'Dayton', 'Boise']);
});

test('the newest comment for the date wins', () => {
  const comments = [
    { text: 'For 10/27: Fort Worth, Midland, Greater Lafayette', created_by: { name: 'A' } },
    { text: 'Thanks!', created_by: { name: 'B' } },
    { text: 'Update for 10/27: Fort Worth and Midland', created_by: { name: 'A' } },
    { text: 'For 11/3: Boise', created_by: { name: 'A' } },
  ];
  const picked = pickLocations(comments, '2026-10-27');
  assert.deepEqual(picked.locations, ['Fort Worth', 'Midland']);
  assert.equal(picked.otherDate, false);
  assert.equal(pickLocations(comments, '2026-12-01').otherDate, true);
  assert.equal(pickLocations([{ text: 'no list here' }], '2026-10-27'), null);
});

test('the locations go in the notes of the third intro blank', () => {
  const all = withBlanks([], { locations: ['Fort Worth', 'Midland'] });
  assert.equal(all[2].label, 'Porch Live Locations - Confidence ONLY');
  assert.equal(all[2].notes, 'Porch Live Locations: Fort Worth, Midland');
  assert.equal(withBlanks([])[2].notes, 'Porch Live Locations - Confidence ONLY');
});

test('the locations are also text on that slide, one per line', async () => {
  const { readFileSync } = await import('node:fs');
  const { parseTheme, resolveLayouts } = await import('../src/theme.js');
  const { THEME_CONFIGS } = await import('../src/themes/configs.js');
  const { buildPresentation, readPresentationText } = await import('../src/propresenter.js');
  const config = THEME_CONFIGS[0];
  const layouts = resolveLayouts(config, parseTheme(new Uint8Array(readFileSync(new URL(`../src/themes/${config.file}/Theme.bin`, import.meta.url)))));
  const all = withBlanks([], { locations: ['Fort Worth', 'Midland'] });
  assert.equal(all[2].layout, 'point');
  assert.equal(all[2].text, 'Fort Worth\nMidland');
  const texts = readPresentationText(buildPresentation('t', all, layouts, { w: 3840, h: 2160 }));
  assert.ok(texts[2].some(t => t.includes('Fort Worth\\\nMidland')), 'locations on the slide');
  assert.ok(texts[2].some(t => t.includes('Porch Live Locations: Fort Worth, Midland')), 'and in the notes');
  // The other intro blanks stay empty, and without locations so does this one
  assert.deepEqual(texts[0], []);
  assert.equal(withBlanks([])[2].layout, null);
});
