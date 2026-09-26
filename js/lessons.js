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
].map(([id, kana, reading, path]) => ({ id, kana, reading, file: `01_hiragana/${path}.swf` }));
export const PASS_THRESHOLD = 70;
