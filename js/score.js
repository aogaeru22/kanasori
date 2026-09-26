import { expandLongVowels } from './kana.js';

const VOICED_BASE = {
  が: "か", ぎ: "き", ぐ: "く", げ: "け", ご: "こ",
  ざ: "さ", じ: "し", ず: "す", ぜ: "せ", ぞ: "そ",
  だ: "た", ぢ: "ち", づ: "つ", で: "て", ど: "と",
  ば: "は", び: "ひ", ぶ: "ふ", べ: "へ", ぼ: "ほ",
  ぱ: "は", ぴ: "ひ", ぷ: "ふ", ぺ: "へ", ぽ: "ほ",
};

function baseKana(ch) {
  return VOICED_BASE[ch] || ch;
}

function substitutionCost(a, b) {
  if (a === b) return 0;
  if (baseKana(a) === baseKana(b)) return 0.35;
  if ((a === "つ" && b === "す") || (a === "す" && b === "つ")) return 0.45;
  return 1;
}

export function normalizeKana(input) {
  if (!input) return "";
  let text = String(input).normalize("NFKC").toLowerCase();
  text = text.replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  text = text.replace(/[\s、。，．,.!！?？・「」『』（）()〜~]/g, "");
  text = expandLongVowels(text);
  return text;
}

export function parseRuby(source) {
  const parts = [];
  const pattern = /\{([^{}|]+)\|([^{}|]+)\}/g;
  let last = 0;
  let match = pattern.exec(source);
  while (match) {
    if (match.index > last) parts.push({ t: source.slice(last, match.index) });
    parts.push({ t: match[1], r: match[2] });
    last = pattern.lastIndex;
    match = pattern.exec(source);
  }
  if (last < source.length) parts.push({ t: source.slice(last) });
  return parts;
}

export function rubyPlain(source) {
  return String(source || "").replace(/\{([^{}|]+)\|[^{}|]+\}/g, "$1");
}

export function rubyReading(source) {
  return String(source || "").replace(/\{[^{}|]+\|([^{}|]+)\}/g, "$1");
}

export function readingPairs(source) {
  const pairs = [];
  const pattern = /\{([^{}|]+)\|([^{}|]+)\}/g;
  let match = pattern.exec(source);
  while (match) {
    pairs.push([match[1], match[2]]);
    match = pattern.exec(source);
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  return pairs;
}

export function applyReadings(text, pairs) {
  let next = String(text || "");
  pairs.forEach(([kanji, reading]) => {
    next = next.split(kanji).join(reading);
  });
  return next;
}

function align(target, heard) {
  const m = target.length;
  const n = heard.length;
  const cost = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i += 1) cost[i][0] = i;
  for (let j = 1; j <= n; j += 1) cost[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const sub = substitutionCost(target[i - 1], heard[j - 1]);
      const replace = cost[i - 1][j - 1] + sub;
      const del = cost[i - 1][j] + 1;
      const ins = cost[i][j - 1] + 1;
      cost[i][j] = Math.min(replace, del, ins);
    }
  }

  const marks = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const sub = substitutionCost(target[i - 1], heard[j - 1]);
      if (cost[i][j] === cost[i - 1][j - 1] + sub) {
        const kind = sub === 0 ? "ok" : sub < 1 ? "close" : "bad";
        marks.push({ ch: target[i - 1], kind });
        i -= 1;
        j -= 1;
        continue;
      }
    }
    if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      marks.push({ ch: target[i - 1], kind: "bad" });
      i -= 1;
      continue;
    }
    j -= 1;
  }
  marks.reverse();

  const denom = Math.max(m, n, 1);
  const score = !m || !n
    ? 0
    : Math.max(0, Math.min(100, Math.round((1 - cost[m][n] / denom) * 100)));

  return { score, marks };
}

export function assess(targetReading, heardText, rubySource = "") {
  const target = normalizeKana(targetReading);
  const pairs = readingPairs(rubySource);
  const candidates = [heardText, applyReadings(heardText, pairs)];
  let best = null;

  candidates.forEach((candidate) => {
    const result = align(target, normalizeKana(expandLongVowels(candidate, targetReading)));
    if (!best || result.score > best.score) best = result;
  });

  return best || { score: 0, marks: [] };
}
