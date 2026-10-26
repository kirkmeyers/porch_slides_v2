import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchChapter, setLocalBible, canFetchTranslation, restoreLord } from '../src/bible.js';
import { validateBible, verseCount } from '../src/local-bibles.js';
import { loadPassageText } from '../src/slides.js';

// The shape of Sunday Slides' niv84.json: { translation, books: { [bookId]: { [chapter]: { [verse]: text } } } }
const sample = { translation: 'NIV', name: 'NIV 84', books: { 43: { 11: { 35: 'Jesus wept.', 36: 'Then the Jews said, “See how he loved him!”' } } } };

test('reads the NIV 84 file Sunday Slides makes', () => {
  assert.equal(verseCount(sample), 2);
  assert.match(validateBible(sample), /66/); // a real file has all 66 books
  assert.match(validateBible({ hello: 1 }), /niv84\.json/);
});

test('a passage takes its NIV 84 text from the loaded file', async () => {
  assert.equal(canFetchTranslation('NIV'), false);
  setLocalBible('NIV', sample);
  assert.equal(canFetchTranslation('NIV 84'), true);
  assert.equal(canFetchTranslation('NIV2011'), false); // the 2011 text still has to be pasted in
  const passage = { bookId: 43, book: 'John', chapter: 11, targets: [35], translation: 'NIV', sourceTranslation: 'NIV', verses: null, manuscript: null, checks: [] };
  await loadPassageText(passage, fetchChapter);
  assert.deepEqual(passage.verses.map(v => v.verse), [35, 36]);
  assert.deepEqual(passage.checks, []);
  setLocalBible('NIV', null);
  assert.equal(await fetchChapter(43, 11, 'NIV'), null);
});

test('LORD takes its case from the ESV verse', () => {
  assert.equal(restoreLord('The Lord is my shepherd', 'The LORD is my shepherd; I shall not want.'), 'The LORD is my shepherd');
  assert.equal(restoreLord('the Lord', 'the LORD and the LORD'), 'the Lord');
});
