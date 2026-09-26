import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizedHiragana } from '../server/hiragana.mjs';
import { wordTarget } from '../js/word-targets.js';
import { countMorae, expandLongVowels } from '../js/kana.js';
import { assess } from '../js/score.js';

test('recognized words are rendered as actual hiragana, not copied from the target', async () => {
  const word=wordTarget('a',0);
  assert.equal(await recognizedHiragana('愛',word),'あい');
  assert.equal(await recognizedHiragana('アイ',word),'あい');
  assert.equal(await recognizedHiragana('猫',word),'ねこ');
  assert.equal(await recognizedHiragana('お母さん',{reading:'おかあさん'}),'おかあさん');
  assert.equal(await recognizedHiragana('ABC',word),null);
});

test('long-vowel notation preserves morae but does not claim acoustic timing assessment', async () => {
  const word=wordTarget('a',1);
  assert.equal(await recognizedHiragana('多い',word),'おおい');
  assert.equal(await recognizedHiragana('オーイ',word),'おおい');
  assert.equal(await recognizedHiragana('おい',word),'おい');
  assert.equal(countMorae('おおい'),3);
  assert.equal(countMorae('おかあさん'),5);
  assert.equal(countMorae('きゃく'),2);
  assert.equal(countMorae('きって'),3);
  assert.equal(expandLongVowels('コーコー','こうこう'),'こうこう');
  // A transcript cannot reveal whether two お were separated or sustained.
  assert.equal(assess('おおい','おおい').score,100);
});
