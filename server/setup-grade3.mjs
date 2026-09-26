import {openStore,hashPassword} from './store.mjs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const db=openStore(resolve(process.env.DATA_DIR || 'data','kanasori.sqlite'));
try {
 if (db.ready) await db.ready;
 await db.transaction(async tx => {
  for(let n=1;n<=10;n++) await tx.prepare('INSERT INTO classes VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run('class-'+(300+n),'3학년 '+n+'반',hashPassword(randomUUID()));
 });
 console.log('3학년 1~10반 설정 완료. 학생 명단과 교사 권한은 별도로 등록하세요.');
} finally {await db.close();}
