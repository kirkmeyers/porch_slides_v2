import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRuns, wrapLines, setDim, isAllDim, sliceText, readingText, preventOrphan } from '../src/layout.js';

// 10px a character at size 10
const measure = (s, style) => s.length * style.size;

test('reads dimmed runs and verse numbers', () => {
  assert.deepEqual(parseRuns('{^9^And} ^10^So'), [
    { text: '9', dim: true, sup: true },
    { text: 'And', dim: true, sup: false },
    { text: ' ', dim: false, sup: false },
    { text: '10', dim: false, sup: true },
    { text: 'So', dim: false, sup: false },
  ]);
  assert.equal(readingText('{^9^And} ^10^So'), 'And So');
});

test('a verse number stays with its word and is measured small', () => {
  const lines = wrapLines('^10^So they kept', 1000, measure, { size: 10 });
  assert.equal(lines[0].count, 3);
  assert.equal(lines[0].words[0].width, 2 * 5 + 2 * 10); // "10" at half size, then "So"
});

test('marks lines that end a paragraph, which justification leaves alone', () => {
  const lines = wrapLines('aaaa bbbb cccc dddd\neeee', 100, measure, { size: 10 });
  assert.deepEqual(lines.map(l => l.endsParagraph), [false, true, true]); // aaaa bbbb / cccc dddd / eeee
});

test('dims and slices without losing verse numbers', () => {
  const t = '^9^And as they were ^10^So';
  // Plain text "9And as they were 10So": offsets count the verse numbers
  assert.equal(setDim(t, 0, 17, true), '{^9^And as they were} ^10^So');
  assert.equal(isAllDim(setDim(t, 0, 17, true), 0, 17), true);
  assert.equal(sliceText(t, 17, 22), ' ^10^So');
  assert.equal(setDim('set sail from Crete and incurred', 14, 19, true), 'set sail from {Crete} and incurred');
});

test('keeps the last two words together', () => {
  assert.equal(preventOrphan('one two three'), 'one two three');
  assert.equal(preventOrphan(preventOrphan('one two three')), 'one two three');
});
