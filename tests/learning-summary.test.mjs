import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLearning } from '../js/learning-summary.js';
const row = (classId, number, score, day, extra = {}) => ({id:`${classId}-${number}-${day}`,classId,number,name:`학생${number}`,score,at:`2026-09-${String(day).padStart(2,'0')}T09:00:00Z`,lesson:'a',target:'あいうえお',...extra});
test('student weighting, chronological growth, class isolation and 100-point bin',()=>{
  const summary = summarizeLearning([row('a','1',100,3),row('a','1',60,1),row('a','1',80,2),row('a','2',20,1),row('b','1',60,1),row('b','1',40,2)]);
  assert.equal(summary.students.length,3);
  assert.equal(summary.attempts,6);
  assert.equal(summary.average,50); // (80 + 20 + 50) / 3; not an attempt-weighted average.
  assert.equal(summary.growth,10); // (+40 - 20) / 2; one-attempt students are excluded.
  assert.equal(summary.comparableCount,2); assert.equal(summary.improved,1); assert.equal(summary.declined,1);
  assert.equal(summary.classes.find(item=>item.classId==='a').average,50);
  assert.equal(summary.bins[9].count,1); assert.equal(summary.bins.reduce((sum,bin)=>sum+bin.count,0),6);
  const student = summary.students.find(s=>s.classId==='a' && s.number==='1');
  assert.deepEqual(student.scores,[60,80,100]); assert.equal(student.first,60); assert.equal(student.last,100);
  assert.equal(summary.students.find(s=>s.number==='2').delta,null);
});
test('empty and pending results do not become zero or fabricated growth',()=>{
  const empty = summarizeLearning([]); assert.equal(empty.average,null); assert.equal(empty.growth,null); assert.deepEqual(empty.students,[]);
  const summary = summarizeLearning([row('a','1',null,1),row('a','1',80,2)]);
  assert.equal(summary.average,80); assert.equal(summary.growth,null); assert.equal(summary.students[0].count,2); assert.equal(summary.scoredCount,1);
});
test('attention explanations and weakest lessons are based on visible attempts',()=>{
  const summary = summarizeLearning([row('a','1',90,1),row('a','1',60,2,{lesson:'ka',target:'かきくけこ'}),row('a','2',30,1)]);
  assert.equal(summary.students[0].number,'2');
  const fallen = summary.students.find(s=>s.number==='1');
  assert.ok(fallen.reasons.some(reason=>reason.includes('30점'))); assert.equal(fallen.weakest.target,'かきくけこ');
  assert.equal(summary.lessons[0].average,60); assert.equal(summary.lessons.find(l=>l.lesson==='a').passRate,50);
});
