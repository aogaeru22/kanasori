import { openStore, hashPassword } from './store.mjs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const [action, id, name, ...classIds] = process.argv.slice(2);
if (!['teacher', 'class'].includes(action) || !id || !name || (action === 'teacher' && (!process.env.SETUP_SECRET || process.env.SETUP_SECRET.length < 12))) {
  console.error('교사 생성 시 SETUP_SECRET에 12자 이상 비밀번호를 설정하세요.\nnode server/admin.mjs class 학급ID "학급 이름"\nnode server/admin.mjs teacher 교사ID "교사 이름" 학급ID [학급ID...]');
  process.exit(1);
}
const db = openStore(resolve(process.env.DATA_DIR || 'data', 'kanasori.sqlite'));
try {
  if (db.ready) await db.ready;
  await db.transaction(async tx => {
    if (action === 'class') {
      // The legacy code column is retained for existing databases; student entry no longer checks it.
      await tx.prepare('INSERT INTO classes VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(id, name, hashPassword(randomUUID()));
    } else {
      for (const classId of classIds) if (!await tx.prepare('SELECT id FROM classes WHERE id=?').get(classId)) throw new Error(`먼저 학급을 만드세요: ${classId}`);
      await tx.prepare('INSERT INTO teachers VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,password=excluded.password').run(id, name, hashPassword(process.env.SETUP_SECRET));
      await tx.prepare('DELETE FROM permissions WHERE teacher=?').run(id);
      for (const classId of classIds) await tx.prepare('INSERT INTO permissions VALUES (?,?)').run(id, classId);
      await tx.prepare('DELETE FROM sessions WHERE role=? AND owner=?').run('teacher', id);
    }
  });
  console.log(`${action === 'class' ? '학급' : '교사'} 설정 완료: ${id}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await db.close(); }
