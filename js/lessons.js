export const LESSONS = [
  ['a', 'あ', 'あいうえお', 'a_ka_sa/03-02'],
  ['ka', 'か', 'かきくけこ', 'a_ka_sa/03-04'],
  ['sa', 'さ', 'さしすせそ', 'a_ka_sa/03-08'],
  ['ta', 'た', 'たちつてと', 'ta_na_ha/03-02'],
  ['na', 'な', 'なにぬねの', 'ta_na_ha/03-04'],
  ['ha', 'は', 'はひふへほ', 'ta_na_ha/03-07'],
  ['ma', 'ま', 'まみむめも', 'ma_ya_ra_wa/03-01'],
  ['ya', 'や', 'やいゆえよ', 'ma_ya_ra_wa/03-03'],
  ['ra', 'ら', 'らりるれろ', 'ma_ya_ra_wa/03-06'],
  ['wa', 'わ', 'わをん', 'ma_ya_ra_wa/03-09'],
].map(([id, kana, reading, path]) => ({
  id,
  kana,
  reading,
  script: 'hiragana',
  file: `01_hiragana/${path}.swf`,
  voca: `voca_practice_hiragana/${id === 'wa' ? 'wa행_n' : id + '행'}.swf`,
}));

export const KATAKANA_LESSONS = [
  ['kata-a', 'ア', 'アイウエオ', 'a_ka_sa_ta_na-katakana/03-02', 'A행-KA행'],
  ['kata-ka', 'カ', 'カキクケコ', 'a_ka_sa_ta_na-katakana/03-03', 'A행-KA행'],
  ['kata-sa', 'サ', 'サシスセソ', 'a_ka_sa_ta_na-katakana/03-04', 'SA행-TA행'],
  ['kata-ta', 'タ', 'タチツテト', 'a_ka_sa_ta_na-katakana/03-05', 'SA행-TA행'],
  ['kata-na', 'ナ', 'ナニヌネノ', 'a_ka_sa_ta_na-katakana/03-06', 'NA행'],
  ['kata-ha', 'ハ', 'ハヒフヘホ', 'ha_ma_ya_ra_wa-katakana/03-01', 'HA행-MA행'],
  ['kata-ma', 'マ', 'マミムメモ', 'ha_ma_ya_ra_wa-katakana/03-02', 'HA행-MA행'],
  ['kata-ya', 'ヤ', 'ヤイユエヨ', 'ha_ma_ya_ra_wa-katakana/03-03', 'YA행-RA행'],
  ['kata-ra', 'ラ', 'ラリルレロ', 'ha_ma_ya_ra_wa-katakana/03-04', 'YA행-RA행'],
  ['kata-wa', 'ワ', 'ワヲン', 'ha_ma_ya_ra_wa-katakana/03-05', 'WA행'],
].map(([id, kana, reading, path, voca]) => ({
  id,
  kana,
  reading,
  script: 'katakana',
  file: `02_katakana/${path}.swf`,
  voca: `02_katakana/voca_practice_katakana/${voca}.swf`,
}));

export const ALL_LESSONS = [...LESSONS, ...KATAKANA_LESSONS];

export function lessonsFor(script = 'hiragana') {
  return script === 'katakana' ? KATAKANA_LESSONS : LESSONS;
}

export const PASS_THRESHOLD = 70;
