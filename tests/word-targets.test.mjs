import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WORD_TARGETS, wordTarget } from '../js/word-targets.js';
import { assess } from '../js/score.js';
import { createApp } from '../classroom-server.mjs';
import { openStore, hashPassword } from '../server/store.mjs';

test('all 46 visible words have distinct, bounded selectable circles', () => {
  assert.equal(Object.values(WORD_TARGETS).flat().length, 46);
  for (const [row, words] of Object.entries(WORD_TARGETS)) {
    assert.equal(words.length, ['ya','wa'].includes(row) ? 3 : 5);
    for (const [index, word] of words.entries()) {
      assert.ok(word.x - word.radius > 0 && word.x + word.radius < 800);
      assert.ok(word.y - word.radius >= 71 && word.y + word.radius < 480);
      assert.equal(assess(word.reading, word.reading).score, 100);
      assert.equal(wordTarget(row,index).reading, word.reading);
      for (const other of words.slice(index+1)) assert.ok(Math.hypot(word.x-other.x,word.y-other.y) > word.radius+other.radius);
    }
  }
  assert.equal(WORD_TARGETS.ta[1].reading,'ちかてつ');
  assert.equal(WORD_TARGETS.ta[3].reading,'てき');
  assert.equal(WORD_TARGETS.ta[4].reading,'とし');
  assert.ok(WORD_TARGETS.ta[1].x > 500); // Nested translation moves it from left to right.
  assert.equal(WORD_TARGETS.na[1].reading,'にく');
  assert.equal(WORD_TARGETS.na[4].reading,'のき');
  assert.ok(WORD_TARGETS.na[4].x < 300);
  assert.equal(WORD_TARGETS.wa[2].radius,71); // Phrase has a larger circle.
  assert.equal(wordTarget('ya',4),null);
});

test('word scoring maps known kanji and marks only mismatched target characters', () => {
  const word = wordTarget('ta',1);
  assert.equal(assess(word.reading,'地下鉄',word.ruby).score,100);
  const result = assess(word.reading,'ちかてす',word.ruby);
  assert.deepEqual(result.marks.map(m=>m.kind),['ok','ok','ok','close']);
  assert.equal(assess(word.reading,'ああああ',word.ruby).score,0);
});

test('server validates and saves the selected word rather than the whole row', async t => {
  const db = openStore(':memory:');
  db.prepare('INSERT INTO classes VALUES (?,?,?)').run('demo','테스트',hashPassword('test-class-code'));
  db.prepare('INSERT INTO roster VALUES (?,?,?)').run('demo','test','가상 테스트');
  const {server} = createApp({db,studentClassId:'demo'});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie='';
  const post = (path,data)=>fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(data)});
  const join=await post('/api/join',{number:'test',name:'가상 테스트',consent:true});
  cookie=join.headers.get('set-cookie').split(';')[0];
  const kana=await post('/api/reading',{lesson:'a-word-1',heard:'オーイ'});
  assert.equal(kana.status,200);
  assert.equal((await kana.json()).reading,'おおい');
  const unrelated=await post('/api/reading',{lesson:'a-word-0',heard:'猫'});
  assert.equal((await unrelated.json()).reading,'ねこ');
  const voice=await fetch(base+'/audio/feedback/100.wav');
  assert.equal(voice.headers.get('content-type'),'audio/wav');
  assert.equal(Buffer.from(await voice.arrayBuffer()).subarray(0,4).toString(),'RIFF');
  assert.equal((await fetch(base+'/audio/feedback/101.wav')).status,404);
  const response=await post('/api/attempts',{id:randomUUID(),lesson:'ta-word-1',heard:'地下鉄',score:0,target:'fake'});
  assert.equal(response.status,201);
  assert.equal((await response.json()).score,100);
  const saved=db.prepare('SELECT target,lesson,score FROM attempts').get();
  assert.deepEqual({...saved},{target:'ちかてつ',lesson:'ta-word-1',score:100});
  const invalid=await post('/api/attempts',{id:randomUUID(),lesson:'ya-word-4',heard:'やま'});
  assert.equal(invalid.status,400);
  const longVowel=await post('/api/attempts',{id:randomUUID(),lesson:'a-word-1',heard:'おーい'});
  assert.deepEqual(await longVowel.json().then(({heard,score})=>({heard,score})),{heard:'おおい',score:100});
  const shortVowel=await post('/api/attempts',{id:randomUUID(),lesson:'a-word-1',heard:'おい'});
  assert.ok((await shortVowel.json()).score<100);
});
