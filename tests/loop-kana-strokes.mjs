// Loop only the root timeline's labelled stroke demonstrations.
// Intro, pronunciation buttons, drawing tools and embedded audio stay intact.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { LESSONS } from '../js/lessons.js';

const root = new URL('../', import.meta.url);
let total = 0;
for (const lesson of LESSONS) {
  const file = new URL(`kana/${lesson.file}`, root);
  const original = fs.readFileSync(file);
  assert.equal(original.toString('ascii', 0, 3), 'CWS');
  const raw = zlib.inflateSync(original.subarray(8));
  let offset = Math.ceil((5 + 4 * (raw[0] >> 3)) / 8) + 4;
  const parts = [raw.subarray(0, offset)];
  let label = null;
  let changed = 0;
  let existing = 0;
  while (offset < raw.length) {
    const start = offset;
    const header = raw.readUInt16LE(offset);
    offset += 2;
    const code = header >> 6;
    let size = header & 63;
    if (size === 63) { size = raw.readUInt32LE(offset); offset += 4; }
    const body = raw.subarray(offset, offset + size);
    offset += size;
    if (code === 43) label = body.toString('utf8').replace(/\0.*$/, '');
    if (code === 12 && /^aa[1-5]$/.test(label || '')) {
      const name = Buffer.from(label + '\0');
      const action = Buffer.alloc(3);
      action[0] = 0x8c; // ActionGotoLabel
      action.writeUInt16LE(name.length, 1);
      const loop = Buffer.concat([action, name, Buffer.from([0x06, 0])]);
      if (body.equals(Buffer.from([0x07, 0]))) {
        const tag = Buffer.alloc(2);
        tag.writeUInt16LE((12 << 6) | loop.length);
        parts.push(tag, loop);
        changed++;
        continue;
      }
      if (body.equals(loop)) existing++;
    }
    parts.push(raw.subarray(start, offset));
  }
  assert.equal(changed + existing, lesson.id === 'wa' ? 3 : 5, lesson.id);
  if (changed) {
    const backup = new URL(`data/stroke-originals/${lesson.file}`, root);
    fs.mkdirSync(path.dirname(fileURLToPath(backup)), { recursive: true });
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, original);
    const patched = Buffer.concat(parts);
    const header = Buffer.from(original.subarray(0, 8));
    header.writeUInt32LE(patched.length + 8, 4);
    fs.writeFileSync(file, Buffer.concat([header, zlib.deflateSync(patched, { level: 9 })]));
  }
  total += changed;
  console.log(`${lesson.kana}: ${changed} updated, ${existing} already looping`);
}
console.log(`Updated ${total} stroke demonstrations.`);
