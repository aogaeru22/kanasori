// Local preview: empty grade-three classes; never exported to Google Sheets.
import {createApp} from '../server.mjs';
import {openStore,hashPassword} from './store.mjs';
if(process.env.NODE_ENV==='production') throw new Error('미리보기는 로컬 환경에서만 실행하세요.');
const db=openStore(':memory:');
db.prepare('INSERT INTO teachers VALUES (?,?,?)').run('demo','미리보기',hashPassword('local-demo-password'));
for(let n=1;n<=10;n++) {
 const id='class-'+(300+n);
 db.prepare('INSERT INTO classes VALUES (?,?,?)').run(id,'3학년 '+n+'반',hashPassword('local-demo-code'));
 db.prepare('INSERT INTO permissions VALUES (?,?)').run('demo',id);
}
const {server}=createApp({db,origin:'http://127.0.0.1:5512',secure:false,preview:true});
server.listen(5512,'127.0.0.1',()=>console.log('교사 미리보기: http://127.0.0.1:5512/teacher.html'));
