import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRequestFile, parseVerseList, parseVerseLines, extractCommunicatorLastName, dateCode, sentenceCase } from '../src/requests.js';

const sample = readFileSync(new URL('../reference/sample-requests.txt', import.meta.url), 'utf8');

test('reads the settings and slide requests of a Porch request file', () => {
  const p = parseRequestFile(sample);
  assert.equal(p.header.theme, 'porch-generic');
  assert.equal(p.header.communicator, 'Jane Smith');
  assert.equal(p.header.date, '2026-10-27');
  assert.deepEqual(p.entries.map(e => e.type), ['scripture', 'point', 'scripture', 'scripture', 'quote', 'scripture', 'point']);
  const mark = p.entries[0];
  assert.equal(mark.book, 'Mark');
  assert.deepEqual(mark.verses, [9, 10, 11, 12, 13]);
  assert.equal(mark.translation, 'ESV');
  assert.equal(p.entries[2].translation, 'NIV');
  assert.equal(p.entries[2].lines.length, 1);
  assert.equal(p.entries[3].book, 'Psalms');
  assert.deepEqual(p.entries[4], { type: 'quote', text: 'I have learned to kiss the wave that throws me against the Rock of Ages.', author: 'Charles Spurgeon', checks: [] });
  assert.deepEqual(p.warnings, []);
});

test('verse lists and supplied verse lines', () => {
  assert.deepEqual(parseVerseList('9-13'), [9, 10, 11, 12, 13]);
  assert.deepEqual(parseVerseList('60; 66'), [60, 66]);
  assert.deepEqual(parseVerseList('7–8, 10'), [7, 8, 10]);
  assert.deepEqual(parseVerseLines(['> 18 For I consider', '> 19 For the creation'], 18), [
    { verse: 18, text: 'For I consider' },
    { verse: 19, text: 'For the creation' },
  ]);
  assert.deepEqual(parseVerseLines(['> For I consider , that'], 18), [{ verse: 18, text: 'For I consider, that' }]);
});

test('points, quotes and lines that only look like references', () => {
  const p = parseRequestFile('Slide 1: Spirit-filled living\nSlide 2: Service starts 7:30\nSlide 3: John 3:36-4:2\n> orphan text\nSlide 4: “Be still.” – Someone Wise');
  assert.equal(p.entries[0].type, 'point');
  assert.equal(p.entries[1].type, 'point');
  assert.equal(p.entries[1].checks.length, 1);
  assert.equal(p.entries[2].type, 'point');
  assert.match(p.entries[2].checks[0], /Cross-chapter/);
  assert.equal(p.warnings.length, 1);
  assert.deepEqual([p.entries[3].text, p.entries[3].author], ['Be still.', 'Someone Wise']);
});

test('unknown settings are reported', () => {
  const p = parseRequestFile('# theme: neon\n# translation: XYZ\nSlide 1: Mark 9:9');
  assert.equal(p.warnings.length, 2);
});

test('file name helpers', () => {
  assert.equal(extractCommunicatorLastName('Jane Smith'), 'Smith');
  assert.equal(extractCommunicatorLastName('John Doe Jr.'), 'Doe');
  assert.equal(dateCode('2026-10-27'), '20261027');
});

test('sentence case keeps capitals on names for God', () => {
  assert.equal(sentenceCase('THE HOLY SPIRIT LEADS US'), 'The Holy Spirit leads us');
  assert.equal(sentenceCase('Trusting god in chapter ii'), 'Trusting God in chapter II');
});

test('a book and chapter with no verses asks for the whole chapter', () => {
  const p = parseRequestFile('Slide 1: 1 Corinthians 13\nSlide 2: Psalm 23 (NIV 84)\nSlide 3: Top 10 reasons');
  assert.deepEqual([p.entries[0].type, p.entries[0].book, p.entries[0].chapter, p.entries[0].wholeChapter], ['scripture', '1 Corinthians', 13, true]);
  assert.equal(p.entries[1].translation, 'NIV 84');
  assert.equal(p.entries[2].type, 'point');
});
