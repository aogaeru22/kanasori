import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp, csvCell } from '../classroom-server.mjs';
import { openStore, hashPassword } from '../server/store.mjs';

test('student assessment, teacher password access, class isolation and CSV', async t => {
  const db = openStore(':memory:');
  for (const id of ['a','b']) {
    db.prepare('INSERT INTO classes VALUES (?,?,?)').run(id,`학급 ${id}`,hashPassword('class-password'));
    db.prepare('INSERT INTO teachers VALUES (?,?,?)').run(id,`교사 ${id}`,hashPassword('teacher-password'));
    db.prepare('INSERT INTO permissions VALUES (?,?)').run(id,id);
  }
  for(const row of [['a','1','학생'],['a','30101','=HYPERLINK("bad")'],['a','30102','두번째 학생'],['b','30101','다른 학급']]) db.prepare('INSERT INTO roster VALUES (?,?,?)').run(...row);
  const mail = [];
  const { server } = createApp({ db, studentClassId:'a', sendMail: async message => { mail.push(message); } });
  const serverB = createApp({ db, studentClassId:'b' }).server;
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  serverB.listen(0,'127.0.0.1'); await once(serverB,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const baseB = `http://127.0.0.1:${serverB.address().port}`;
  t.after(async () => { await Promise.all([server,serverB].map(s=>new Promise(resolve => s.close(resolve)))); db.close(); });
  async function call(path, data, cookie, origin = base) {
    return fetch(base + path,{ method: data === undefined ? 'GET' : 'POST',headers:{ ...(cookie ? { Cookie:cookie } : {}), ...(data === undefined ? {} : { 'Content-Type':'application/json', Origin:origin }) }, ...(data === undefined ? {} : { body:JSON.stringify(data) }) });
  }
  async function join(classId, number, name) {
    const response = classId === 'b'
      ? await fetch(baseB+'/api/join',{method:'POST',headers:{'Content-Type':'application/json',Origin:baseB},body:JSON.stringify({number,name,consent:true})})
      : await call('/api/join',{number,name,consent:true});
    assert.equal(response.status,200);
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    return response.headers.get('set-cookie').split(';')[0];
  }
  async function login(id) {
    const response = await call('/api/login',{id,password:'teacher-password'});
    assert.equal(response.status,200); return response.headers.get('set-cookie').split(';')[0];
  }
  assert.equal((await call('/api/attempts')).status,401);
  assert.equal((await call('/api/export')).status,401);
  assert.equal((await call('/api/login',{id:'a',password:'wrong'})).status,401);
  assert.equal((await call('/api/join',{classId:'a',code:'class-password',number:'1',name:'학생',consent:false})).status,400);
  assert.equal((await call('/api/join',{number:'1',name:' ',consent:true})).status,400);
  const redirected = await call('/api/join',{classId:'b',code:'ignored',number:'1',name:'학생',consent:true});
  assert.equal(redirected.status,200);
  const redirectedCookie = redirected.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await call('/api/me',undefined,redirectedCookie)).json()).classId,'a');
  const a = await join('a','30101','=HYPERLINK("bad")');
  const a2 = await join('a','30102','두번째 학생');
  const b = await join('b','30101','다른 학급');
  const id = randomUUID();
  const assessment = {id,lesson:'a',heard:'あいうえお',score:0,passed:false,number:'fake',classId:'b',name:'fake'};
  let response = await call('/api/attempts',assessment,a);
  assert.equal(response.status,201);
  assert.equal((await response.json()).score,100);
  assert.equal((await call('/api/attempts',assessment,a)).status,200); // lost response retry is idempotent
  assert.equal((await call('/api/attempts',{id:randomUUID(),lesson:'bogus',heard:'あ'},a)).status,400);
  assert.equal((await call('/api/attempts',{id:randomUUID(),lesson:'a',heard:'あ'},a,'https://evil.example')).status,403);
  await call('/api/attempts',{id:randomUUID(),lesson:'a',heard:'さようなら'},a2);
  await call('/api/attempts',{id:randomUUID(),lesson:'ka',heard:'かきくけこ'},b);
  const own = (await (await call('/api/attempts',undefined,a)).json()).rows;
  assert.equal(own.length,1); assert.equal(own[0].number,'30101'); assert.equal(own[0].classId,'a');
  assert.equal((await call('/api/export',undefined,a)).status,401);
  const teacherA = await login('a'); const teacherB = await login('b');
  const resultsA = (await (await call('/api/teacher/attempts',undefined,teacherA)).json()).rows;
  assert.equal(resultsA.length,2); assert.ok(resultsA.every(row => row.classId === 'a'));
  assert.equal((await (await call('/api/teacher/attempts?classId=b',undefined,teacherA)).json()).rows.length,0);
  assert.equal((await (await call('/api/teacher/attempts?number=30101',undefined,teacherA)).json()).rows.length,1);
  assert.equal((await (await call('/api/teacher/attempts',undefined,teacherB)).json()).rows.length,1);
  assert.equal((await call('/api/attempts',assessment,teacherA)).status,401);
  response = await call('/api/export?classId=a&number=30101',undefined,teacherA);
  assert.equal(response.status,200); const csv = await response.text();
  assert.match(csv, /'\=HYPERLINK/); assert.match(csv,/통과/); assert.doesNotMatch(csv,/다른 학급/); assert.doesNotMatch(csv,/두번째 학생/);
  assert.equal((await call('/api/attempts/'+id+'/audio',undefined,teacherA)).status,404);
  assert.ok(!db.prepare('PRAGMA table_info(attempts)').all().some(column => ['audio','mime'].includes(column.name)));
  for (const path of ['/data/kanasori.sqlite','/server.mjs','/classroom-server.mjs','/server/store.mjs','/.env','/package.json','/gas/Code.gs']) assert.equal((await call(path)).status,404,path);
  for (const path of ['/','/teacher.html','/results.html','/js/practice.js','/kana/play.html']) assert.equal((await call(path)).status,200,path);
  const combined = a + '; ' + teacherA;
  assert.equal((await (await call('/api/me',undefined,combined)).json()).role,'student');
  assert.equal((await (await call('/api/teacher/me',undefined,combined)).json()).role,'teacher');
  const personal = (await (await call('/api/attempts',undefined,combined)).json()).rows;
  assert.equal(personal.length,1); assert.equal(personal[0].number,'30101');
  assert.equal((await call('/api/teacher/attempts',undefined,a)).status,401);
  assert.equal((await call('/api/teacher/me',undefined,a)).status,401);
  await call('/api/teacher/logout',{},combined);
  assert.equal((await call('/api/me',undefined,a)).status,200);
  const rejoin = await call('/api/join',{number:'30101',name:'=HYPERLINK("bad")',consent:true},a);
  const rejoinedCookie = rejoin.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await call('/api/attempts',undefined,rejoinedCookie)).json()).rows.length,1);
  const switched = await call('/api/join',{number:'30102',name:'두번째 학생',consent:true},rejoinedCookie);
  const switchedCookie = switched.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await call('/api/attempts',undefined,switchedCookie)).json()).rows.length,0);

  assert.equal((await call('/api/teacher/attempts',undefined,teacherA)).status,401);
  // The server, not just the UI, must accept exactly 70 percent.
  for (const [heard,score,passed] of [['だぢすてど',70,1],['だぢすでど',63,0]]) {
    const result = await (await call('/api/attempts',{id:randomUUID(),lesson:'ta',heard},switchedCookie)).json();
    assert.equal(result.score,score); assert.equal(result.passed,passed);
  }
  db.prepare('UPDATE sessions SET expires=0 WHERE role=?').run('student');
  assert.equal((await call('/api/attempts',undefined,a)).status,401);
  assert.equal((await call('/api/password',{id:'a',current:'wrong',next:'replacement-12',confirm:'replacement-12'})).status,401);
  assert.equal((await call('/api/password',{id:'a',current:'teacher-password',next:'short',confirm:'short'})).status,400);
  assert.equal((await call('/api/password',{id:'a',current:'teacher-password',next:'replacement-12',confirm:'other-password1'})).status,400);
  assert.equal((await call('/api/password',{id:'a',current:'teacher-password',next:'replacement-12',confirm:'replacement-12'})).status,200);
  assert.equal((await call('/api/login',{id:'a',password:'teacher-password'})).status,401);
  assert.equal((await call('/api/login',{id:'a',password:'replacement-12'})).status,200);
  assert.equal((await call('/api/password/code',{})).status,400);
  assert.equal((await call('/api/password/email',{id:'a',current:'wrong',email:'teacher@example.com'})).status,401);
  assert.equal((await call('/api/password/email',{id:'a',current:'replacement-12',email:'teacher@example.com'})).status,200);
  assert.equal((await call('/api/password/code',{})).status,200);
  const code = mail.at(-1).code;
  assert.equal(mail.at(-1).to,'teacher@example.com');
  assert.equal((await call('/api/password/recover',{code:'000000',next:'recovered-pass1',confirm:'recovered-pass1'})).status,401);
  assert.equal((await call('/api/password/recover',{code,next:'recovered-pass1',confirm:'recovered-pass1'})).status,200);
  assert.equal((await call('/api/login',{id:'a',password:'replacement-12'})).status,401);
  assert.equal((await call('/api/login',{id:'a',password:'recovered-pass1'})).status,200);
  assert.equal((await call('/api/password/recover',{code,next:'another-pass123',confirm:'another-pass123'})).status,401);
});

test('CSV quotes and spreadsheet formula protection', () => {
  assert.equal(csvCell('한글,"값"'), '"한글,""값"""');
  for (const value of ['=1+1','+1','-1','@SUM(A1)','  =1']) assert.ok(csvCell(value).startsWith('"\''));
});
