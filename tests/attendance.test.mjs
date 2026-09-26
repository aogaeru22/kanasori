import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { openStore, hashPassword } from '../server/store.mjs';

test('roster validation, daily attendance, manual corrections and teacher isolation', async t => {
  const db=openStore(':memory:');
  for(const id of ['a','b']) {
    db.prepare('INSERT INTO classes VALUES (?,?,?)').run(id,id,'unused');
    db.prepare('INSERT INTO teachers VALUES (?,?,?)').run(id,id,hashPassword('password-'+id));
    db.prepare('INSERT INTO permissions VALUES (?,?)').run(id,id);
  }
  const {server}=createApp({db});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(path,data,cookie)=>fetch(base+path,{method:data?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
  let response=await call('/api/login',{password:'password-a'});assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/login',{password:'wrong'})).status,401);
  const students=[{number:'20101',name:'김하루'},{number:'20102',name:'이소라'}];
  assert.equal((await call('/api/teacher/roster',{classId:'a',students},cookie)).status,200);
  assert.equal((await call('/api/teacher/roster',{classId:'b',students},cookie)).status,403);
  assert.equal((await call('/api/teacher/attendance?classId=a')).status,401);
  assert.equal((await call('/api/teacher/attendance?classId=b',null,cookie)).status,403);
  const read=async()=> (await call('/api/teacher/attendance?classId=a',null,cookie)).json();
  assert.equal((await read()).total,2);assert.equal((await read()).present,0);
  assert.equal((await call('/api/join',{number:'20101',name:'틀린 이름',consent:true})).status,400);
  assert.equal((await call('/api/join',{number:'99999',name:'김하루',consent:true})).status,400);
  const join=()=>call('/api/join',{...students[0],consent:true});
  assert.equal((await join()).status,200);assert.equal((await join()).status,200);
  assert.equal((await read()).present,1);
  const mark=status=>call('/api/teacher/attendance',{classId:'a',...students[0],status},cookie);
  assert.equal((await mark('absent')).status,200);assert.equal((await read()).present,0);
  assert.equal((await mark('present')).status,200);assert.equal((await read()).present,1);
  assert.equal((await mark('invalid')).status,400);
  assert.equal((await call('/api/teacher/attendance',{classId:'a',number:'20101',name:'wrong',status:'present'},cookie)).status,400);
  db.prepare('UPDATE attendance SET day=?').run('2000-01-01');assert.equal((await read()).present,0);
  assert.equal((await call('/api/teacher/roster',{classId:'a',students:[{number:'20103',name:'추가'},{number:'20101',name:'다른 이름'}]},cookie)).status,400);
  assert.equal((await read()).total,2); // Failed import is atomic.
  db.prepare('INSERT INTO roster VALUES (?,?,?)').run('b','20701','다른 반');
  response=await call('/api/join',{number:'20701',name:'다른 반',consent:true});assert.equal(response.status,200);
  const studentCookie=response.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await call('/api/me',null,studentCookie)).json()).classId,'b');
  assert.equal((await call('/api/teacher/attendance?classId=b',null,studentCookie)).status,401);
});
