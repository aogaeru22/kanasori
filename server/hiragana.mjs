import kuromoji from 'kuromoji';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { applyReadings, readingPairs } from '../js/score.js';
import { hiraganaScript, expandLongVowels, promptedReading } from '../js/kana.js';

const require = createRequire(import.meta.url);
let tokenizerPromise;
function dictionary() {
  return resolve(dirname(require.resolve('kuromoji/package.json')), 'dict');
}
function tokenizer() {
  return tokenizerPromise ??= new Promise((resolvePromise, reject) => {
    let dicPath;
    try { dicPath = dictionary(); } catch (error) { reject(error); return; }
    kuromoji.builder({ dicPath }).build((error, value) => {
      if (error) { tokenizerPromise = null; reject(error); }
      else resolvePromise(value);
    });
  });
}

export async function recognizedHiragana(heard, lesson) {
  const goal = lesson?.reading || '';
  if (goal && promptedReading(goal, heard) === goal) return goal;
  let text = hiraganaScript(applyReadings(heard, readingPairs(lesson?.ruby || '')));
  if (/[^ぁ-ゖー\s、。，．,.!！?？・「」『』（）()〜~―−–—-]/u.test(text)) {
    const parser = await tokenizer();
    text = hiraganaScript(parser.tokenize(text).map(token => token.reading || token.surface_form).join(''));
  }
  text = text.replace(/[\s、。，．,.!！?？・「」『』（）()〜~]/g, '');
  text = promptedReading(goal, expandLongVowels(text, goal));
  if (!/^[ぁ-ゖ]*$/u.test(text)) return null;
  return text;
}
