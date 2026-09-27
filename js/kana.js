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

const H_ONSET = { は: 'あ', ひ: 'い', ふ: 'う', へ: 'え', ほ: 'お' };

// Whole-utterance forms the ja-JP recognizer returns instead of these words.
// A different word is left unchanged.
const HANGUL_WORD = {
  え: /^에+$/,
  えい: /^(에이|애이|예이|에잇|헤이|에+)$/,
  て: /^(테에+|데에+|테+|데+)$/,
  に: /^(니이+|니+)$/,
  め: /^(메에+|메+)$/,
  ひ: /^(?:히|이)+$/,
  のき: /^노키$/,
  まち: /^마치$/,
  みみ: /^미미+$/,
  あい: /^(아이|하이)$/,
};
const ROMAJI_WORD = {
  え: /^(e|eh|ee)$/,
  えい: /^ei$/,
  て: /^te$/,
  に: /^ni$/,
  め: /^me$/,
  ひ: /^hi+$/,
  のき: /^noki$/,
  まち: /^machi$/,
  みみ: /^mimi$/,
};

// Fold a known engine substitution only when it restores the prompted word.
export function promptedReading(target, heard) {
  const goal = hiraganaScript(target).replace(/[\s、。，．,.!！?？・「」『』（）()〜~]/g, '');
  const raw = String(heard || '').normalize('NFKC').replace(/\s/g, '');
  const spoken = raw.replace(/[、。，．,.!！?？・「」『』（）()〜～~ー\-—–ㅡ…]/g, '');
  if (goal && (HANGUL_WORD[goal]?.test(spoken) || ROMAJI_WORD[goal]?.test(spoken.toLowerCase()))) return goal;
  let text = expandLongVowels(raw.replace(/[、。，．,.!！?？・「」『』（）()〜~]/g, ''), goal);
  if (!goal || text === goal) return text;
  if (text.startsWith(goal) && [...text.slice(goal.length)].every(ch => ch === goal.at(-1) || ch === 'っ')) return goal;
  // いえ is heard as the common word いいえ: the first mora is written twice.
  if (goal === 'いえ' && text.startsWith('いいえ') && [...text.slice(3)].every(ch => ch === 'え' || ch === 'っ')) return goal;
  // れつ is heard as レッツ (れ + っ + つ). One inserted っ restores the word.
  const sokuon = text.indexOf('っ');
  if (sokuon >= 0 && text.slice(0, sokuon) + text.slice(sokuon + 1) === goal) return goal;
  // ほし is completed as the common word ほしい.
  if (goal === 'ほし' && text.replace(/です$/, '') === 'ほしい') return goal;
  // The recognizer collapses みみ to み, or writes a held み as みい / みみい.
  // みみず is the common word it prefers. み alone is not accepted for any other word.
  if (goal === 'みみ' && (/^み[いみ]*$/.test(text) || text === 'みみず' || text === 'みみづ')) return goal;
  // のき is heard as のんき, as a held の, or as the common word ロッキー.
  if (goal === 'のき' && (/^の[んうお]*き$/.test(text) || text === 'ろっきい' || text === 'ろっき')) return goal;
  const vowel = H_ONSET[text[0]];
  if (vowel && vowel + text.slice(1) === goal) return goal;
  // えい is a different word. A held え is already ええ or えっ above.
  if (goal.length === 1 && (text === `${goal}っ` || (goal !== 'え' && text === `${goal}い`))) return goal;
  // A held て is written てえ, and て is often heard as で. と does not have that swap.
  if (goal === 'て' && (/^て[えて]*$/.test(text) || /^で[えで]*$/.test(text))) return goal;
  if (goal === 'め' && /^め[えめ]*$/.test(text)) return goal;
  if (goal === 'と' && /^と[おと]*$/.test(text)) return goal;
  // The recognizer keeps extending に into には or にほん, or hears the mora as る or り.
  if (goal === 'に' && (text.startsWith('に') || /^(?:ん|2|二)+[いに]*$/.test(text) || /^[るり][うるい]*$/.test(text))) return goal;
  // 絵 is this word. A longer word that merely starts with え stays as spoken.
  if (goal === 'え' && text === '絵') return goal;
  // The recognizer writes えい as え, ええ, or えー. A longer word is left as spoken.
  if (goal === 'えい' && /^え[えっい]*$/.test(text)) return goal;
  // ひ is heard as い or ふ, or extended into ひと / ひかり. はい and ふね stay unchanged.
  if (goal === 'ひ' && (text.startsWith('ひ') || /^い+$/.test(text) || /^[びぴ][いびぴ]*$/.test(text) || /^ふ[うふ]*$/.test(text))) return goal;
  return text;
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
