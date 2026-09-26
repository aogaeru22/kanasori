import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, hashPassword, verifyPassword } from './server/store.mjs';
import { LESSONS, PASS_THRESHOLD } from './js/lessons.js';
import { assess } from './js/score.js';
import { wordTarget } from './js/word-targets.js';
import { createSheetsSync } from './server/sheets.mjs';
import { recognizedHiragana } from './server/hiragana.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const MAX_BODY = 16 * 1024;
const dummyHash = hashPassword(randomBytes(24).toString('hex'));
const digest = value => createHash('sha256').update(value).digest('hex');
const failure = (status, message) => Object.assign(new Error(message), { status });
function findLesson(id) {
  const match = /^(a|ka|sa|ta|na|ha|ma|ya|ra|wa)-word-([0-4])$/.exec(id);
  return match ? wordTarget(match[1], Number(match[2])) : LESSONS.find(item => item.id === id);
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function createApp({ db = openStore(resolve(process.env.DATA_DIR || 'data', 'kanasori.sqlite')), origin = process.env.APP_ORIGIN, secure = process.env.NODE_ENV === 'production', preview = false, studentClassId = process.env.STUDENT_CLASS_ID } = {}) {
  const sheets = createSheetsSync(db,{url:process.env.SHEETS_WEB_APP_URL,token:process.env.SHEETS_SYNC_TOKEN,preview});
  const rates = new Map();
  const schoolDay = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const markAttendance = (classId, number, status) => db.prepare('INSERT INTO attendance VALUES (?,?,?,?,?) ON CONFLICT(classId,number,day) DO UPDATE SET status=excluded.status,updated=excluded.updated').run(classId,number,schoolDay(),status,new Date().toISOString());
  function limit(key, max) {
    const now = Date.now();
    if (rates.size > 10000) for (const [k, v] of rates) if (v.until < now) rates.delete(k);
    const entry = rates.get(key);
    if (!entry || entry.until < now) { rates.set(key, { count: 1, until: now + 60000 }); return; }
    if (++entry.count > max) throw failure(429, '요청이 많습니다. 1분 뒤 다시 시도하세요.');
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    const send = (status, data, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      let path = decodeURIComponent(url.pathname);
      if (!path.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) throw failure(405, '허용되지 않는 요청입니다.');
        const relative = path === '/' ? 'index.html' : path.slice(1);
        // Explicit public allowlist: never serve the database, server code, or config secrets.
        const allowed = /^(attendance\.html|index\.html|app\.js|style\.css|teacher\.html|results\.html|js\/[a-z-]+\.js|css\/[a-z-]+\.css)$/.test(relative)
          || /^kana\/(play\.html|catalog\.json|[^.][^\\]*\.(swf|hwp))$/.test(relative)
          || /^fonts\/kyotai-w[234]\.woff2$/.test(relative)
          || /^audio\/feedback\/(?:[0-9]|[1-9][0-9]|100)\.wav$/.test(relative);
        const file = resolve(ROOT, relative);
        if (!allowed || !file.startsWith(ROOT + (ROOT.endsWith(sep) ? '' : sep)) || relative.split('/').some(p => p.startsWith('.')) || relative.includes('\\')) throw failure(404, '찾을 수 없습니다.');
        try {
          const info = await stat(file);
          if (!info.isFile()) throw new Error();
          const types = { '.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.swf': 'application/x-shockwave-flash', '.hwp': 'application/octet-stream' };
          res.writeHead(200, { 'Content-Type': extname(file) === '.wav' ? 'audio/wav' : types[extname(file)] || 'application/octet-stream' });
          res.end(req.method === 'HEAD' ? undefined : await readFile(file));
        } catch { if (!res.headersSent) throw failure(404, '찾을 수 없습니다.'); }
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      if (!['GET', 'POST'].includes(req.method)) throw failure(405, '허용되지 않는 요청입니다.');
      if (req.method === 'POST') {
        const expected = origin || `http://${req.headers.host}`;
        if (req.headers.origin !== expected || req.headers['sec-fetch-site'] === 'cross-site') throw failure(403, '같은 사이트에서 요청하세요.');
        if (!req.headers['content-type']?.startsWith('application/json')) throw failure(415, 'JSON 요청이 필요합니다.');
      }
      const teacherRequest = path === '/api/login' || path === '/api/export' || path.startsWith('/api/teacher/');
      if (path.startsWith('/api/teacher/') && !['/api/teacher/me','/api/teacher/attempts','/api/teacher/logout','/api/teacher/attendance','/api/teacher/roster','/api/teacher/sheets'].includes(path)) throw failure(404, '찾을 수 없습니다.');
      if (path.startsWith('/api/teacher/')) path = path.replace('/api/teacher/', '/api/');
      const cookieName = teacherRequest ? 'kanasori_teacher' : 'kanasori';
      const cookie = new RegExp(`(?:^|;\\s*)${cookieName}=([a-f0-9]{64})(?:;|$)`).exec(req.headers.cookie || '')?.[1];
      const session = cookie && db.prepare('SELECT * FROM sessions WHERE token=? AND expires>? AND role=?').get(digest(cookie), Date.now(), teacherRequest ? 'teacher' : 'student');
      const auth = role => { if (!session) throw failure(401, '로그인이 필요합니다.'); if (role && session.role !== role) throw failure(403, '접근 권한이 없습니다.'); return session; };
      const body = async () => {
        if (Number(req.headers['content-length']) > MAX_BODY) throw failure(413, '요청 내용이 너무 큽니다.');
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw failure(413, '요청 내용이 너무 큽니다.'); chunks.push(chunk); }
        try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
        catch { throw failure(400, '잘못된 요청입니다.'); }
      };
      const text = (value, max) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw failure(400, '입력 내용을 확인하세요.'); return value.trim(); };
      const setSession = (role, owner, classId = null, number = null, name = null) => {
        const token = randomBytes(32).toString('hex');
        db.prepare('DELETE FROM sessions WHERE expires<=? OR token=?').run(Date.now(), cookie ? digest(cookie) : '');
        db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?)').run(digest(token), role, owner, classId, number, name, Date.now() + 8 * 3600000);
        res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure ? '; Secure' : ''}`);
      };
      if (path === '/api/login' && req.method === 'POST') {
        limit(`login:${req.socket.remoteAddress}`, 10);
        const data = await body(); const password = text(data.password, 200);
        const matches = data.id ? [db.prepare('SELECT * FROM teachers WHERE id=?').get(text(data.id,80))].filter(Boolean) : db.prepare('SELECT * FROM teachers').all().filter(t=>verifyPassword(password,t.password));
        const teacher = matches.length === 1 ? matches[0] : null;
        const id = teacher?.id;
        if (!verifyPassword(password, teacher?.password || dummyHash) || !teacher) throw failure(401, '아이디 또는 비밀번호를 확인하세요.');
        setSession('teacher', id, null, null, teacher.name); return send(200, { ok: true });
      }
      if (path === '/api/join' && req.method === 'POST') {
        limit(`join:${req.socket.remoteAddress}`, 120);
        const data = await body();
        const number = text(data.number, 20); const name = text(data.name, 40);
        if (data.consent !== true) throw failure(400, '수집·이용 동의가 필요합니다.');
        const matches = studentClassId ? db.prepare('SELECT * FROM roster WHERE number=? AND name=? AND classId=?').all(number,name,studentClassId) : db.prepare('SELECT * FROM roster WHERE number=? AND name=?').all(number,name);
        if (matches.length !== 1) throw failure(400, '학번과 이름이 일치하지 않습니다. 선생님께 등록된 명단을 확인해 주세요.');
        const group = matches[0].classId;
        const owner = session?.role === 'student' && session.classId === group && session.number === number && session.name === name ? session.owner : randomUUID();
        markAttendance(group, number, 'present');
        setSession('student', owner, group, number, name); return send(200, { ok: true });
      }
      if (path === '/api/logout' && req.method === 'POST') {
        if (cookie) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(cookie));
        res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
        return send(200, { ok: true });
      }
      if (path === '/api/me' && req.method === 'GET') {
        auth(); const classes = session.role === 'teacher' ? db.prepare('SELECT c.id,c.name FROM classes c JOIN permissions p ON p.classId=c.id WHERE p.teacher=?').all(session.owner) : [];
        return send(200, { role: session.role, name: session.name, number: session.number, classId: session.classId, classes, preview });
      }
      if (path === '/api/sheets' && req.method === 'GET') { auth('teacher'); return send(200,sheets.status(session.owner)); }
      if (path === '/api/attendance' || path === '/api/roster') {
        auth('teacher');
        const data = req.method === 'POST' ? await body() : null;
        const classId = text(data?.classId || url.searchParams.get('classId'),80);
        if (!db.prepare('SELECT 1 FROM permissions WHERE teacher=? AND classId=?').get(session.owner,classId)) throw failure(403,'담당 학급만 확인하거나 수정할 수 있습니다.');
        if (path === '/api/roster') {
          if (req.method !== 'POST') throw failure(405,'허용되지 않는 요청입니다.');
          if (!Array.isArray(data.students) || !data.students.length || data.students.length > 100) throw failure(400,'1~100명의 명단을 입력하세요.');
          const students = data.students.map(row => ({ number:text(row?.number,20),name:text(row?.name,40) }));
          if (new Set(students.map(r=>r.number)).size !== students.length) throw failure(400,'명단에 중복 학번이 있습니다.');
          db.exec('BEGIN');
          try {
            for (const row of students) {
              const previous = db.prepare('SELECT name FROM roster WHERE classId=? AND number=?').get(classId,row.number);
              if (previous && previous.name !== row.name) throw failure(400,'이미 등록된 학번의 이름이 다릅니다. 운영 담당자에게 정정을 요청하세요.');
              db.prepare('INSERT INTO roster VALUES (?,?,?) ON CONFLICT(classId,number) DO NOTHING').run(classId,row.number,row.name);
            }
            db.exec('COMMIT');
          } catch(error) { db.exec('ROLLBACK'); throw error; }
          return send(200,{ok:true});
        }
        if (data) {
          const number = text(data.number,20), name = text(data.name,40);
          if (!['present','absent'].includes(data.status)) throw failure(400,'출결 상황을 선택하세요.');
          if (!db.prepare('SELECT 1 FROM roster WHERE classId=? AND number=? AND name=?').get(classId,number,name)) throw failure(400,'학번과 이름이 일치하지 않습니다.');
          markAttendance(classId,number,data.status);
        }
        const day = schoolDay();
        const rows = db.prepare("SELECT r.number,r.name,COALESCE(a.status,'absent') status FROM roster r LEFT JOIN attendance a ON a.classId=r.classId AND a.number=r.number AND a.day=? WHERE r.classId=? ORDER BY r.number").all(day,classId);
        return send(200,{day,rows,total:rows.length,present:rows.filter(r=>r.status==='present').length});
      }
      if (path === '/api/reading' && req.method === 'POST') {
        auth('student'); limit(`reading:${session.owner}`, 40);
        const data = await body();
        const lesson = findLesson(data.lesson);
        if (!lesson || typeof data.heard !== 'string' || data.heard.length > 500) throw failure(400, '잘못된 연습 내용입니다.');
        const reading = await recognizedHiragana(data.heard, lesson);
        if (!reading) throw failure(422, '일본어 발음을 읽어내지 못했어요. 선택한 단어를 다시 읽어 주세요.');
        return send(200, { reading });
      }
      if (path === '/api/attempts' && req.method === 'POST') {
        auth('student'); limit(`submit:${session.owner}`, 20);
        const data = await body(); const id = text(data.id, 80);
        if (!/^[a-f0-9-]{36}$/.test(id)) throw failure(400, '잘못된 기록 ID입니다.');
        const existing = db.prepare('SELECT id,score,passed,heard FROM attempts WHERE id=? AND owner=?').get(id, session.owner);
        if (existing) return send(200, existing);
        const lesson = findLesson(data.lesson);
        if (!lesson || typeof data.heard !== 'string' || data.heard.length > 500) throw failure(400, '잘못된 연습 내용입니다.');
        const heard = await recognizedHiragana(data.heard.trim(), lesson);
        if (heard === null) throw failure(422, '일본어 발음을 읽어내지 못했어요. 다시 읽어 주세요.');
        const score = heard ? assess(lesson.reading, heard, lesson.ruby || '').score : null;
        const passed = score === null ? null : Number(score >= PASS_THRESHOLD);
        db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,session.owner,session.classId,session.number,session.name,lesson.id,lesson.reading,heard,score,passed,new Date().toISOString());
        void sheets.flush();
        return send(201, { id, score, passed, heard });
      }
      const scope = () => { auth(); return session.role === 'teacher' ? { sql: 'classId IN (SELECT classId FROM permissions WHERE teacher=?)', value: session.owner } : { sql: 'owner=?', value: session.owner }; };
      if ((path === '/api/attempts' || path === '/api/export') && req.method === 'GET') {
        const access = scope(); if (path === '/api/export') auth('teacher');
        const conditions = [access.sql]; const args = [access.value];
        for (const key of ['classId', 'number']) if (url.searchParams.get(key)) { conditions.push(`${key}=?`); args.push(url.searchParams.get(key)); }
        const rows = db.prepare(`SELECT id,classId,number,name,lesson,target,heard,score,passed,at FROM attempts WHERE ${conditions.join(' AND ')} ORDER BY at DESC`).all(...args);
        if (path === '/api/export') {
          res.setHeader('Content-Disposition', 'attachment; filename="kanasori-results.csv"');
          const values = [['학급','학번','이름','목표 글자','인식된 말','일치율','판정','기준','일시(UTC)','기록 ID'], ...rows.map(r => [r.classId,r.number,r.name,r.target,r.heard,r.score,r.score === null ? '판정 대기' : r.passed ? '통과' : '재연습',PASS_THRESHOLD,r.at,r.id])];
          return send(200, '\ufeff' + values.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv; charset=utf-8');
        }
        return send(200, { rows, threshold: PASS_THRESHOLD });
      }
      throw failure(404, '찾을 수 없습니다.');
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (!error.status) console.error(error);
      send(error.status || 500, { error: error.status ? error.message : '저장에 실패했습니다. 잠시 후 다시 시도하세요.' });
    }
  });
  server.on('listening',()=>sheets.start());
  server.on('close',()=>sheets.close());
  return { server, db }; 
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === 'production' && !process.env.APP_ORIGIN?.startsWith('https://')) throw new Error('운영 환경에서는 HTTPS APP_ORIGIN이 필요합니다.');
  const { server } = createApp();
  server.listen(Number(process.env.PORT || 5500), process.env.HOST || '127.0.0.1', () => console.log(`かな소리: http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 5500}`));
}
