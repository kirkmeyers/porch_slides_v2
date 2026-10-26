import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutPassage, fillBlock, blockText, poetryLines, passageFormat } from '../src/passage.js';
import { wrapLines, plainText } from '../src/layout.js';

// 10px per character, a 400px box: about 40 characters a line
const measure = (s, style) => s.length * style.size;
const style = { size: 10 };
const countLines = t => wrapLines(t, 400, measure, style).length;
const opts = { maxLines: 9, countLines, format: 'prose', bookId: 41, chapter: 9 };
const chapter = Array.from({ length: 30 }, (_, i) => ({ verse: i + 1, text: `Words of verse ${i + 1} that fill out about one line.` }));

test('marks the verse being read and dims the rest', () => {
  assert.equal(blockText(chapter.slice(0, 2), 2, null, opts), '{^1^Words of verse 1 that fill out about one line.} ^2^Words of verse 2 that fill out about one line.');
});

test('fills a block to the line limit, ending on part of a verse', () => {
  const b = fillBlock(chapter, 1, 1, { ...opts, maxLines: 6 });
  assert.deepEqual(b.whole, [1, 2, 3, 4]);
  assert.equal(b.partial, 'Words of verse 5 that fill out about', 'the last line is filled with the start of verse 5');
  assert.equal(b.end, 5);
  assert.equal(b.lines, 6);
  assert.ok(b.text.endsWith('{^5^Words of verse 5 that fill out\u00A0about}'));
  // The verse being read is never cut short
  assert.equal(fillBlock(chapter, 5, 1, { ...opts, maxLines: 6 }).partial, null);
});

test('keeps the block in place while the highlight moves down it', () => {
  const slides = layoutPassage(chapter, [9, 10, 11, 12], opts);
  assert.equal(slides.length, 4);
  assert.ok(slides.every(s => s.start === 9 && s.lines <= 9));
  slides.forEach((s, i) => {
    const bright = plainText(s.text.replace(/\{[^}]*\}/g, ''));
    assert.ok(bright.includes(`verse ${9 + i} `), `slide ${i} reads verse ${9 + i}`);
  });
});

test('a single verse gets context before it', () => {
  const [s] = layoutPassage(chapter, [10], { ...opts, context: 2 });
  assert.equal(s.start, 8);
  assert.equal(layoutPassage(chapter, [10], { ...opts, context: 0 })[0].start, 10);
});

test('starts a new block when the verse being read would run out of context', () => {
  const slides = layoutPassage(chapter, Array.from({ length: 12 }, (_, i) => i + 1), opts);
  const starts = [...new Set(slides.map(s => s.start))];
  assert.ok(starts.length > 1);
  // A later block keeps up to two verses already read above as context
  const second = slides.find(s => s.start !== 1);
  assert.equal(second.verse - second.start, 2);
});

test('splits a verse too long for one slide', () => {
  const long = [{ verse: 1, text: Array.from({ length: 120 }, (_, i) => `w${i}`).join(' ') }];
  const slides = layoutPassage(long, [1], opts);
  assert.ok(slides.length > 1);
  assert.ok(slides.every(s => s.lines <= 9 && s.text.startsWith('^1^')));
});

test('poetry breaks at its pauses, and poems inside prose are set in lines', () => {
  assert.equal(poetryLines('God is our refuge and strength, a very present help in trouble.'), 'God is our refuge and strength,\na very present help in trouble.');
  assert.equal(poetryLines('The LORD is my shepherd; I shall not want.'), 'The LORD is my shepherd;\nI shall not want.');
  assert.equal(passageFormat(19, 23, []), 'poetry');
  const isaiah = [{ verse: 3, text: 'And one called to another and said: “Holy, holy, holy is the LORD of hosts; the whole earth is full of his glory!”' }];
  assert.equal(passageFormat(23, 6, isaiah), 'mixed');
  assert.equal(
    blockText(isaiah, 3, null, { format: 'mixed', bookId: 23, chapter: 6 }),
    '^3^And one called to another and said:\n“Holy, holy, holy is the LORD of hosts;\nthe whole earth is full of his glory!”',
  );
});
