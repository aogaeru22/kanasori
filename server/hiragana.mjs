import kuromoji from 'kuromoji';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { applyReadings, readingPairs } from '../js/score.js';
import { hiraganaScript, expandLongVowels } from '../js/kana.js';

const require = createRequire(import.meta.url);
const dictionary = resolve(dirname(require.resolve('kuromoji/package.json')), 'dict');
let tokenizerPromise;
function tokenizer() {
  return tokenizerPromise ??= new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: dictionary }).build((error, value) => {
      if (error) { tokenizerPromise = null; reject(error); }
      else resolve(value);
    });
  });
}

export async function recognizedHiragana(heard, lesson) {
  let text = hiraganaScript(applyReadings(heard, readingPairs(lesson?.ruby || '')));
  if (/[^ぁ-ゖー\s、。，．,.!！?？・「」『』（）()〜~―−–—-]/u.test(text)) {
    const parser = await tokenizer();
    text = hiraganaScript(parser.tokenize(text).map(token => token.reading || token.surface_form).join(''));
  }
  text = text.replace(/[\s、。，．,.!！?？・「」『』（）()〜~]/g, '');
  text = expandLongVowels(text, lesson?.reading || '');
  if (!/^[ぁ-ゖ]*$/u.test(text)) return null;
  return text;
}
