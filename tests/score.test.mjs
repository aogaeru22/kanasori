import assert from "node:assert/strict";
import { applyReadings, assess, normalizeKana, readingPairs, rubyPlain, rubyReading } from "../js/score.js";

assert.equal(normalizeKana("ガクセイ。"), "がくせい");
assert.equal(normalizeKana("こーひー"), "こおひい");
assert.equal(assess('おおい','おーい').score,100);
assert.equal(assess('おかあさん','おかーさん').score,100);
assert.ok(assess('おおい','おい').score<100);
assert.ok(assess('おかあさん','おかさん').score<100);
assert.ok(assess('おい','おーい').score<100);
assert.ok(assess('おおい','おーーい').score<100);
assert.equal(rubyPlain("{駅|えき}はどこですか。"), "駅はどこですか。");
assert.equal(rubyReading("{私|わたし}は{学生|がくせい}です。"), "わたしはがくせいです。");

const exact = assess("おはようございます。", "おはようございます");
assert.equal(exact.score, 100);
assert.ok(exact.marks.every((mark) => mark.kind === "ok"));

const katakana = assess("がくせい", "ガクセイ");
assert.equal(katakana.score, 100);

const voiced = assess("がくせい", "かくせい");
assert.ok(voiced.score >= 85 && voiced.score < 100);
assert.equal(voiced.marks[0].kind, "close");

const different = assess("こんにちは", "さようなら");
assert.ok(different.score < 40);

const empty = assess("こんにちは", "");
assert.equal(empty.score, 0);

const ruby = "{私|わたし}は{学生|がくせい}です。";
const fromKanji = assess(rubyReading(ruby), "私は学生です", ruby);
assert.equal(fromKanji.score, 100);
assert.equal(applyReadings("私は学生です", readingPairs(ruby)), "わたしはがくせいです");

const particle = assess("こんにちは", "こんにちわ");
assert.ok(particle.score >= 70 && particle.score < 100);

console.log("score tests passed");
