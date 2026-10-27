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
  // A later block keeps the verse just read above as context
  const second = slides.find(s => s.start !== 1);
  assert.equal(second.verse - second.start, 1);
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

test('the block changes as few times as it can', () => {
  // Verses of different lengths, as in a real chapter
  const lengths = [2, 3, 2, 2, 2, 1, 2, 3, 1, 1, 3, 3, 2];
  const ch = lengths.map((n, i) => ({ verse: i + 1, text: Array.from({ length: n * 6 }, () => 'word').join(' ') }));
  const slides = layoutPassage(ch, ch.map(v => v.verse), opts);
  assert.deepEqual(slides.map(s => s.verse), ch.map(v => v.verse));
  assert.ok(slides.every(s => s.lines <= 9));
  const blocks = [];
  for (const s of slides) {
    const last = blocks[blocks.length - 1];
    if (last && last.start === s.start && last.end === s.end) last.read.push(s.verse);
    else blocks.push({ start: s.start, end: s.end, read: [s.verse] });
  }
  assert.equal(blocks[0].start, 1);
  blocks.forEach((b, k) => {
    const lastRead = b.read[b.read.length - 1];
    const next = blocks[k + 1];
    if (next) {
      // A block only changes when the next verse would have no whole verse below it
      // (the block's last whole verse is its end, or the one before a cut-short verse)
      assert.ok(next.read[0] >= b.end - 1, `block ${k} changed before it had to`);
      // and the new block keeps the verse just read on top
      if (k + 1 < blocks.length - 1) assert.equal(next.start, lastRead);
    }
  });
  // The last block ends on the chapter's last verse
  assert.equal(blocks[blocks.length - 1].end, 13);
});
