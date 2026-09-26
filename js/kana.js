// Text normalization only. These functions do not measure recorded vowel duration.
export function hiraganaScript(text) {
  return String(text || '').normalize('NFKC').replace(/[\u30a1-\u30f6]/g,
    ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

const VOWELS = [
  ['あ', 'あかがさざただなはばぱまやらわぁゃゎ'],
  ['い', 'いきぎしじちぢにひびぴみりゐぃ'],
  ['う', 'うくぐすずつづぬふぶぷむゆるゔぅゅ'],
  ['え', 'えけげせぜてでねへべぺめれゑぇ'],
  ['お', 'おこごそぞとどのほぼぽもよろをぉょ'],
];

export function expandLongVowels(text, reference = '') {
  const source = hiraganaScript(text);
  const target = hiraganaScript(reference).replace(/[\s、。，．,.!！?？・「」『』（）()]/g, '');
  let result = '';
  for (const ch of source) {
    if (!'ーｰ―−–—-'.includes(ch)) { result += ch; continue; }
    const vowel = VOWELS.find(([, chars]) => chars.includes(result.at(-1)))?.[0];
    if (!vowel) { result += ch; continue; }
    // Only an explicit long-vowel mark can use the target's standard spelling.
    // Never restore a missing vowel in a short pronunciation such as おい.
    const next = target[result.length];
    const equivalent = next === vowel || (vowel === 'お' && next === 'う') || (vowel === 'え' && next === 'い');
    result += equivalent && target.startsWith(result) ? next : vowel;
  }
  return result;
}

export function countMorae(text) {
  let count = 0;
  let previous = '';
  for (const ch of hiraganaScript(text)) {
    if (!/[ぁ-ゖー]/.test(ch)) { previous = ''; continue; }
    if (!('ゃゅょぁぃぅぇぉゎ'.includes(ch) && /[ぁ-ゖ]/.test(previous))) count++;
    previous = ch;
  }
  return count;
}
