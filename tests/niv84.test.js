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
  assert.match(validateBible({ hello: 1 }), /npm run rvbible/);
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

test('a loaded translation file wins over the request file’s verses', async () => {
  const niv = { translation: 'NIV2011', name: 'NIV', books: { 45: { 8: { 17: 'Now if we are children, then we are heirs.', 18: 'I consider that our present sufferings are not worth comparing with the glory that will be revealed in us.', 19: 'For the creation waits in eager expectation.' } } } };
  const request = text => ({
    bookId: 45, book: 'Romans', chapter: 8, targets: [18], translation: 'NIV2011', sourceTranslation: 'NIV2011', verses: null,
    manuscript: [{ verse: 18, text }],
    checks: ['Verse text came from the request file; check it against the Bible.'],
  });
  setLocalBible('NIV2011', niv);

  const same = request('I consider that our present sufferings are not worth comparing with the glory that will be revealed in us.');
  await loadPassageText(same, fetchChapter);
  assert.deepEqual(same.verses.map(v => v.verse), [17, 18, 19], 'the whole chapter, for context');
  assert.deepEqual(same.checks, []);

  const typo = request('I think our sufferings are nothing next to the glory to come.');
  await loadPassageText(typo, fetchChapter);
  assert.equal(typo.verses.find(v => v.verse === 18).text, niv.books[45][8][18]);
  assert.match(typo.checks.join(), /verse 18 doesn’t match the NIV file/);

  setLocalBible('NIV2011', null);
  const none = request('I consider that our present sufferings are not worth comparing with the glory that will be revealed in us.');
  await loadPassageText(none, fetchChapter);
  assert.deepEqual(none.verses.map(v => v.verse), [18], 'without the file, the request’s text');
  assert.match(none.checks.join(), /request file/);
});
