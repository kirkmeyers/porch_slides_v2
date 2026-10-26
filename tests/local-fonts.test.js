import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fontNames, checkFontFile } from '../src/local-fonts.js';

// A minimal font file: just a name table with a family, full name and PostScript name
function fakeFont(names) {
  const entries = Object.entries(names);
  const strings = entries.map(([, s]) => [...s].flatMap(c => [0, c.charCodeAt(0)]));
  const nameLen = 6 + entries.length * 12 + strings.reduce((n, s) => n + s.length, 0);
  const buf = new ArrayBuffer(12 + 16 + nameLen);
  const v = new DataView(buf);
  v.setUint16(4, 1);
  [...'name'].forEach((c, i) => v.setUint8(12 + i, c.charCodeAt(0)));
  const off = 28;
  v.setUint32(12 + 8, off);
  v.setUint16(off + 2, entries.length);
  v.setUint16(off + 4, 6 + entries.length * 12);
  let at = 0;
  entries.forEach(([id, ], i) => {
    const r = off + 6 + i * 12;
    v.setUint16(r, 3);
    v.setUint16(r + 6, +id);
    v.setUint16(r + 8, strings[i].length);
    v.setUint16(r + 10, at);
    strings[i].forEach((b, k) => v.setUint8(off + 6 + entries.length * 12 + at + k, b));
    at += strings[i].length;
  });
  return buf;
}

test('reads the names inside a font file', () => {
  const buf = fakeFont({ 1: 'NeueHaasGroteskDisp Pro', 4: 'NHaasGroteskDSPro-55Rg', 6: 'NHaasGroteskDSPro-55Rg', 16: 'Neue Haas Grotesk Display Pro' });
  assert.deepEqual(fontNames(buf), { family: 'Neue Haas Grotesk Display Pro', fullName: 'NHaasGroteskDSPro-55Rg', postScriptName: 'NHaasGroteskDSPro-55Rg' });
});

test('accepts only the font the themes use', () => {
  const wanted = ['NHaasGroteskDSPro-55Rg', 'Neue Haas Grotesk Display'];
  assert.equal(checkFontFile(fakeFont({ 4: 'NHaasGroteskDSPro-55Rg', 6: 'NHaasGroteskDSPro-55Rg' }), wanted), '');
  assert.match(checkFontFile(fakeFont({ 4: 'Helvetica Neue', 6: 'HelveticaNeue' }), wanted), /Helvetica Neue, not/);
  assert.equal(checkFontFile(new ArrayBuffer(4), wanted), 'That isn’t a font file.');
});
