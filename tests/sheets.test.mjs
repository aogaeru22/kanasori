import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {createSheetsSync} from '../server/sheets.mjs';
test('sheet delivery retries failures, acknowledges IDs and survives worker restart', async()=>{
 const db=openStore(':memory:');
 db.exec("INSERT INTO classes VALUES ('class-301','3학년 1반','unused'); INSERT INTO teachers VALUES ('t','교사','unused'); INSERT INTO permissions VALUES ('t','class-301'); INSERT INTO attempts VALUES ('test-id','private-session','class-301','30101','테스트','a','あ','あ',100,1,'2026-09-26T00:00:00Z')");
 let calls=0, bad=true;
 const options={url:'https://script.google.com/macros/s/test/exec',token:'test-secret',fetcher:async(url,opts)=>{
  calls++; const body=JSON.parse(opts.body); assert.equal(body.record.owner,undefined); assert.equal(body.record.className,'3학년 1반');
  return Response.json(bad?{ok:false}:{ok:true,id:body.record.id});
 }};
 const sync=createSheetsSync(db,options);
 await sync.flush(); assert.equal(sync.status('t').pending,1); assert.equal(sync.status('t').failed,true);
 bad=false; await Promise.all([sync.flush(),sync.flush()]); assert.equal(calls,2);assert.equal(sync.status('t').sent,1);
 sync.close(); const restarted=createSheetsSync(db,options);await restarted.flush();assert.equal(calls,2);
 assert.equal(restarted.status('other').total,0);restarted.close();
 db.exec('DELETE FROM sheet_receipts');
 const preview=createSheetsSync(db,{...options,preview:true});await preview.flush();assert.equal(calls,2);preview.close();db.close();
});
