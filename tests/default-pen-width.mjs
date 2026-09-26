// Match the initial pen width to the existing visible 2pt (penSize2) button.
// The legacy SWF uses internal width 5 for that button; width 2 is its 1pt preset.
import fs from 'node:fs';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { LESSONS } from '../js/lessons.js';

for (const lesson of LESSONS) {
  const file = new URL(`../kana/${lesson.file}`, import.meta.url);
  const source = fs.readFileSync(file);
  const raw = zlib.inflateSync(source.subarray(8));
  const original = Buffer.from(raw);
  // Constant pool index 14 is penSize in these ten drawing controllers.
  const poolAt = raw.indexOf(Buffer.from([0x88]));
  const poolLength = raw.readUInt16LE(poolAt + 1);
  const names = raw.subarray(poolAt + 5, poolAt + 3 + poolLength).toString().split('\0');
  assert.equal(names[14], 'penSize');
  const oldInit = Buffer.from('960700080e07020000001d960200080f', 'hex');
  const newInit = Buffer.from('960700080e07050000001d960200080f', 'hex');
  // Validate the penSize2 handler assigns the same width (5).
  assert.ok(raw.includes(Buffer.from('96020008201c96020008189b05000000000b00960700080e07050000001d4f', 'hex')));
  const at = raw.indexOf(oldInit);
  if (at !== -1) {
    assert.equal(raw.indexOf(oldInit, at + 1), -1);
    newInit.copy(raw, at);
    assert.equal(raw.filter((byte, index) => byte !== original[index]).length, 1);
    fs.writeFileSync(file, Buffer.concat([source.subarray(0, 8), zlib.deflateSync(raw, { level: 9 })]));
  } else {
    assert.ok(raw.includes(newInit));
  }
  console.log(`${lesson.kana}: default matches 2pt button`);
}
