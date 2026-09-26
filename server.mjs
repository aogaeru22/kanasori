import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
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
function maskEmail(email) {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
}
async function deliverRecoveryCode(sendMail, message) {
  if (sendMail) return sendMail(message);
  const host = process.env.MAIL_HOST;
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASSWORD;
  if (!host || !user || !pass) throw Object.assign(new Error('인증 메일을 보내려면 서버의 메일 설정이 필요합니다.'), { status: 503 });
  const { createTransport } = await import('nodemailer');
  const port = Number(process.env.MAIL_PORT || 587);
  const transport = createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM || user,
      to: message.to,
      subject: '가나소리 교사 인증 번호',
      text: `교사 비밀번호를 다시 정하는 인증 번호는 ${message.code} 입니다.\n10분 안에 로그인 창에 입력하세요.`,
    });
  } catch {
    throw Object.assign(new Error('인증 메일을 보내지 못했습니다. 메일 설정을 확인해 주세요.'), { status: 502 });
  }
}
const digest = value => createHash('sha256').update(value).digest('hex');
const failure = (status, message) => Object.assign(new Error(message), { status });
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
function findLesson(id) {
  const match = /^(a|ka|sa|ta|na|ha|ma|ya|ra|wa)-word-([0-4])$/.exec(id);
  return match ? wordTarget(match[1], Number(match[2])) : LESSONS.find(item => item.id === id);
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function createApp({ db = openStore(resolve(process.env.DATA_DIR || 'data', 'kanasori.sqlite')), origin = process.env.APP_ORIGIN, secure = process.env.NODE_ENV === 'production', preview = false, studentClassId = process.env.STUDENT_CLASS_ID, sendMail } = {}) {
  const sheets = createSheetsSync(db,{url:process.env.SHEETS_WEB_APP_URL,token:process.env.SHEETS_SYNC_TOKEN,preview});
  const rates = new Map();
  const schoolDay = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const markAttendance = async (classId, number, status) => { await db.prepare('INSERT INTO attendance VALUES (?,?,?,?,?) ON CONFLICT(classId,number,day) DO UPDATE SET status=excluded.status,updated=excluded.updated').run(classId,number,schoolDay(),status,new Date().toISOString()); };
  function limit(key, max) {
    const now = Date.now();
    if (rates.size > 10000) for (const [k, v] of rates) if (v.until < now) rates.delete(k);
    const entry = rates.get(key);
    if (!entry || entry.until < now) { rates.set(key, { count: 1, until: now + 60000 }); return; }
    if (++entry.count > max) throw failure(429, '요청이 많습니다. 1분 뒤 다시 시도하세요.');
  }
  const handle = async (req, res) => {
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
      if (path.startsWith('/api/')) {
        if (db.ready) await db.ready;
        if (db.readyError) throw failure(500, '기록 저장소에 연결하지 못했습니다. 연결 주소를 확인하세요.');
      }
      if (!path.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) throw failure(405, '허용되지 않는 요청입니다.');
        const relative = path === '/' ? 'index.html' : path.slice(1);
        // Explicit public allowlist: never serve the database, server code, or config secrets.
        const allowed = /^(attendance\.html|index\.html|student-app\.js|style\.css|teacher\.html|results\.html|js\/[a-z-]+\.js|css\/[a-z-]+\.css)$/.test(relative)
          || /^kana\/(play\.html|catalog\.json|pronunciation-button\.png|[^.][^\\]*\.(swf|hwp))$/.test(relative)
          || /^fonts\/kyotai-w[234]\.woff2$/.test(relative)
          || /^audio\/feedback\/(?:[0-9]|[1-9][0-9]|100)\.wav$/.test(relative);
        const file = resolve(ROOT, relative);
        if (!allowed || !file.startsWith(ROOT + (ROOT.endsWith(sep) ? '' : sep)) || relative.split('/').some(p => p.startsWith('.')) || relative.includes('\\')) throw failure(404, '찾을 수 없습니다.');
        try {
          const info = await stat(file);
          if (!info.isFile()) throw new Error();
          const types = { '.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.swf': 'application/x-shockwave-flash', '.hwp': 'application/octet-stream' };
          res.writeHead(200, { 'Content-Type': extname(file) === '.wav' ? 'audio/wav' : types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
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
      if (path.startsWith('/api/teacher/') && !['/api/teacher/me','/api/teacher/attempts','/api/teacher/logout','/api/teacher/attendance','/api/teacher/roster','/api/teacher/roster/delete','/api/teacher/sheets'].includes(path)) throw failure(404, '찾을 수 없습니다.');
      if (path.startsWith('/api/teacher/')) path = path.replace('/api/teacher/', '/api/');
      const cookieName = teacherRequest ? 'kanasori_teacher' : 'kanasori';
      const cookie = new RegExp(`(?:^|;\\s*)${cookieName}=([a-f0-9]{64})(?:;|$)`).exec(req.headers.cookie || '')?.[1];
      const session = cookie && await db.prepare('SELECT * FROM sessions WHERE token=? AND expires>? AND role=?').get(digest(cookie), Date.now(), teacherRequest ? 'teacher' : 'student');
      const auth = role => { if (!session) throw failure(401, '로그인이 필요합니다.'); if (role && session.role !== role) throw failure(403, '접근 권한이 없습니다.'); return session; };
      const body = async () => {
        if (Number(req.headers['content-length']) > MAX_BODY) throw failure(413, '요청 내용이 너무 큽니다.');
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw failure(413, '요청 내용이 너무 큽니다.'); chunks.push(chunk); }
        try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
        catch { throw failure(400, '잘못된 요청입니다.'); }
      };
      const text = (value, max) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw failure(400, '입력 내용을 확인하세요.'); return value.trim(); };
      const setSession = async (role, owner, classId = null, number = null, name = null) => {
        const token = randomBytes(32).toString('hex');
        await db.prepare('DELETE FROM sessions WHERE expires<=? OR token=?').run(Date.now(), cookie ? digest(cookie) : '');
        await db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?)').run(digest(token), role, owner, classId, number, name, Date.now() + 8 * 3600000);
        res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure ? '; Secure' : ''}`);
      };
      if (path === '/api/login' && req.method === 'POST') {
        limit(`login:${clientIp(req)}`, 10);
        const data = await body(); const password = text(data.password, 200);
        const matches = data.id ? [await db.prepare('SELECT * FROM teachers WHERE id=?').get(text(data.id,80))].filter(Boolean) : (await db.prepare('SELECT * FROM teachers').all()).filter(t=>verifyPassword(password,t.password));
        const teacher = matches.length === 1 ? matches[0] : null;
        const id = teacher?.id;
        if (!verifyPassword(password, teacher?.password || dummyHash) || !teacher) throw failure(401, '아이디 또는 비밀번호를 확인하세요.');
        await setSession('teacher', id, null, null, teacher.name); return send(200, { ok: true });
      }
      if (path === '/api/password' && req.method === 'POST') {
        limit(`password:${clientIp(req)}`, 8);
        const data = await body();
        const current = text(data.current, 200);
        const next = text(data.next, 200);
        const confirm = text(data.confirm, 200);
        if (next.length < 12) throw failure(400, '새 비밀번호는 12자 이상으로 정하세요.');
        if (next !== confirm) throw failure(400, '새 비밀번호가 서로 다릅니다.');
        if (next === current) throw failure(400, '현재 비밀번호와 다른 비밀번호로 정하세요.');
        const named = data.id ? [await db.prepare('SELECT * FROM teachers WHERE id=?').get(text(data.id, 80))].filter(Boolean) : await db.prepare('SELECT * FROM teachers').all();
        const matches = named.filter(teacher => verifyPassword(current, teacher.password));
        if (matches.length !== 1) {
          verifyPassword(current, dummyHash);
          throw failure(401, '현재 비밀번호를 확인하세요.');
        }
        const teacher = matches[0];
        if ((await db.prepare('SELECT * FROM teachers WHERE id<>?').all(teacher.id)).some(other => verifyPassword(next, other.password))) throw failure(400, '다른 교사와 같은 비밀번호는 사용할 수 없습니다.');
        await db.prepare('UPDATE teachers SET password=? WHERE id=?').run(hashPassword(next), teacher.id);
        await db.prepare('DELETE FROM sessions WHERE role=? AND owner=?').run('teacher', teacher.id);
        return send(200, { ok: true });
      }
      if (path === '/api/password/email' && req.method === 'POST') {
        limit(`password-email:${clientIp(req)}`, 8);
        const data = await body();
        const current = text(data.current, 200);
        const email = text(data.email, 120);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw failure(400, '이메일 주소를 확인하세요.');
        const named = data.id ? [await db.prepare('SELECT * FROM teachers WHERE id=?').get(text(data.id, 80))].filter(Boolean) : await db.prepare('SELECT * FROM teachers').all();
        const matches = named.filter(teacher => verifyPassword(current, teacher.password));
        if (matches.length !== 1) {
          verifyPassword(current, dummyHash);
          throw failure(401, '현재 비밀번호를 확인하세요.');
        }
        await db.prepare('INSERT INTO recovery_emails VALUES (?,?) ON CONFLICT(teacher) DO UPDATE SET email=excluded.email').run(matches[0].id, email);
        return send(200, { ok: true, to: maskEmail(email) });
      }
      if (path === '/api/password/code' && req.method === 'POST') {
        limit(`password-code:${clientIp(req)}`, 3);
        await body();
        const saved = await db.prepare('SELECT teacher, email FROM recovery_emails').all();
        if (saved.length !== 1) throw failure(400, '복구 이메일이 등록되어 있지 않습니다. 현재 비밀번호로 먼저 등록하세요.');
        const code = String(randomInt(0, 1000000)).padStart(6, '0');
        await deliverRecoveryCode(sendMail, { to: saved[0].email, code });
        await db.prepare('INSERT INTO recovery_codes VALUES (?,?,?,?) ON CONFLICT(teacher) DO UPDATE SET hash=excluded.hash, expires=excluded.expires, tries=0').run(saved[0].teacher, createHash('sha256').update(code).digest('hex'), Date.now() + 10 * 60 * 1000, 0);
        return send(200, { ok: true, to: maskEmail(saved[0].email) });
      }
      if (path === '/api/password/recover' && req.method === 'POST') {
        limit(`recover:${clientIp(req)}`, 8);
        const data = await body();
        const code = text(data.code, 20);
        const next = text(data.next, 200);
        const confirm = text(data.confirm, 200);
        if (next.length < 12) throw failure(400, '새 비밀번호는 12자 이상으로 정하세요.');
        if (next !== confirm) throw failure(400, '새 비밀번호가 서로 다릅니다.');
        const pending = await db.prepare('SELECT * FROM recovery_codes WHERE expires>?').all(Date.now());
        if (!pending.length) throw failure(401, '인증 번호가 만료되었습니다. 다시 요청하세요.');
        const digestCode = value => createHash('sha256').update(value).digest();
        const match = pending.find(row => {
          const expected = Buffer.from(row.hash, 'hex');
          const actual = digestCode(code);
          return expected.length === actual.length && timingSafeEqual(actual, expected);
        });
        if (!match) {
          for (const row of pending) {
            if (row.tries + 1 >= 5) await db.prepare('DELETE FROM recovery_codes WHERE teacher=?').run(row.teacher);
            else await db.prepare('UPDATE recovery_codes SET tries=? WHERE teacher=?').run(row.tries + 1, row.teacher);
          }
          throw failure(401, '인증 번호가 맞지 않습니다.');
        }
        const teacher = await db.prepare('SELECT * FROM teachers WHERE id=?').get(match.teacher);
        if (!teacher || verifyPassword(next, teacher.password)) throw failure(400, '현재 비밀번호와 다른 비밀번호로 정하세요.');
        if ((await db.prepare('SELECT * FROM teachers WHERE id<>?').all(teacher.id)).some(other => verifyPassword(next, other.password))) throw failure(400, '다른 교사와 같은 비밀번호는 사용할 수 없습니다.');
        await db.prepare('UPDATE teachers SET password=? WHERE id=?').run(hashPassword(next), teacher.id);
        await db.prepare('DELETE FROM recovery_codes WHERE teacher=?').run(teacher.id);
        await db.prepare('DELETE FROM sessions WHERE role=? AND owner=?').run('teacher', teacher.id);
        return send(200, { ok: true });
      }
      if (path === '/api/join' && req.method === 'POST') {
        limit(`join:${clientIp(req)}`, 120);
        const data = await body();
        const number = text(data.number, 20); const name = text(data.name, 40);
        if (data.consent !== true) throw failure(400, '수집·이용 동의가 필요합니다.');
        const matches = studentClassId ? await db.prepare('SELECT * FROM roster WHERE number=? AND name=? AND classId=?').all(number,name,studentClassId) : await db.prepare('SELECT * FROM roster WHERE number=? AND name=?').all(number,name);
        if (matches.length !== 1) throw failure(400, '학번과 이름이 일치하지 않습니다. 선생님께 등록된 명단을 확인해 주세요.');
        const group = matches[0].classId;
        const owner = session?.role === 'student' && session.classId === group && session.number === number && session.name === name ? session.owner : randomUUID();
        await markAttendance(group, number, 'present');
        await setSession('student', owner, group, number, name); return send(200, { ok: true });
      }
      if (path === '/api/logout' && req.method === 'POST') {
        if (cookie) await db.prepare('DELETE FROM sessions WHERE token=?').run(digest(cookie));
        res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
        return send(200, { ok: true });
      }
      if (path === '/api/me' && req.method === 'GET') {
        auth(); const classes = session.role === 'teacher' ? await db.prepare('SELECT c.id,c.name FROM classes c JOIN permissions p ON p.classId=c.id WHERE p.teacher=?').all(session.owner) : [];
        return send(200, { role: session.role, name: session.name, number: session.number, classId: session.classId, classes, preview });
      }
      if (path === '/api/sheets' && req.method === 'GET') { auth('teacher'); return send(200, await sheets.status(session.owner)); }
      if (path === '/api/attendance' || path === '/api/roster' || path === '/api/roster/delete') {
        auth('teacher');
        const data = req.method === 'POST' ? await body() : null;
        const classId = text(data?.classId || url.searchParams.get('classId'),80);
        if (!await db.prepare('SELECT 1 FROM permissions WHERE teacher=? AND classId=?').get(session.owner,classId)) throw failure(403,'담당 학급만 확인하거나 수정할 수 있습니다.');
        if (path === '/api/roster') {
          if (req.method !== 'POST') throw failure(405,'허용되지 않는 요청입니다.');
          if (!Array.isArray(data.students) || !data.students.length || data.students.length > 400) throw failure(400,'1~400명의 명단을 입력하세요.');
          const students = data.students.map(row => ({ number:text(row?.number,20),name:text(row?.name,40) }));
          // Same names are allowed. A student number identifies one person, so the same number with a different name is refused.
          const byNumber = new Map();
          for (const row of students) {
            const names = byNumber.get(row.number) || new Set();
            names.add(row.name);
            byNumber.set(row.number, names);
          }
          const pastedConflicts = [...byNumber].filter(([, names]) => names.size > 1);
          if (pastedConflicts.length) throw failure(400, pastedConflicts.map(([number, names]) => `${number} 학번에 서로 다른 이름 ${names.size}명이 있습니다. 등록할 수 없습니다.`).join('\n'));
          const unique = [...byNumber].map(([number, names]) => ({ number, name: [...names][0] }));
          const asParticle = value => {
            const code = value.charCodeAt(value.length - 1);
            const batchim = code >= 0xAC00 && code <= 0xD7A3 ? (code - 0xAC00) % 28 : 1;
            return batchim ? '으로' : '로';
          };
          const storedConflicts = [];
          for (const row of unique) {
            const previous = await db.prepare('SELECT name FROM roster WHERE classId=? AND number=?').get(classId, row.number);
            if (previous && previous.name !== row.name) storedConflicts.push(`${row.number}는 이미 '${previous.name}'${asParticle(previous.name)} 등록되어 있습니다. '${row.name}'${asParticle(row.name)}는 등록할 수 없습니다.`);
          }
          if (storedConflicts.length) throw failure(400, storedConflicts.join('\n'));
          await db.transaction(async tx => {
            const save = tx.prepare('INSERT INTO roster VALUES (?,?,?) ON CONFLICT(classId,number) DO NOTHING');
            for (const row of unique) await save.run(classId, row.number, row.name);
          });
          return send(200,{ok:true});
        }
        if (path === '/api/roster/delete') {
          if (req.method !== 'POST') throw failure(405,'허용되지 않는 요청입니다.');
          if (!Array.isArray(data.students) || !data.students.length || data.students.length > 400) throw failure(400,'1~400명의 학번을 입력하세요.');
          const rows = data.students.map(row => {
            const number = text(row?.number,20);
            const name = typeof row?.name === 'string' ? row.name.trim() : '';
            if (name.length > 40) throw failure(400,'입력 내용을 확인하세요.');
            return { number, name };
          });
          const byNumber = new Map();
          for (const row of rows) {
            const names = byNumber.get(row.number) || new Set();
            if (row.name) names.add(row.name);
            byNumber.set(row.number, names);
          }
          const pastedConflicts = [...byNumber].filter(([, names]) => names.size > 1);
          if (pastedConflicts.length) throw failure(400, pastedConflicts.map(([number, names]) => `${number} 학번에 서로 다른 이름 ${names.size}명이 있습니다. 삭제할 수 없습니다.`).join('\n'));
          const asParticle = value => {
            const code = value.charCodeAt(value.length - 1);
            const batchim = code >= 0xAC00 && code <= 0xD7A3 ? (code - 0xAC00) % 28 : 1;
            return batchim ? '으로' : '로';
          };
          const mismatches = [];
          const missing = [];
          const targets = [];
          for (const [number, names] of byNumber) {
            const previous = await db.prepare('SELECT name FROM roster WHERE classId=? AND number=?').get(classId, number);
            const name = [...names][0] || '';
            if (!previous) missing.push(number);
            else if (name && name !== previous.name) mismatches.push(`${number}는 이미 '${previous.name}'${asParticle(previous.name)} 등록되어 있습니다. '${name}'${asParticle(name)}는 삭제할 수 없습니다.`);
            else targets.push(number);
          }
          if (mismatches.length) throw failure(400, mismatches.join('\n'));
          if (missing.length) throw failure(400, `명단에 없는 학번입니다: ${missing.join(', ')}. 삭제할 수 없습니다.`);
          await db.transaction(async tx => {
            const dropAttendance = tx.prepare('DELETE FROM attendance WHERE classId=? AND number=?');
            const dropRoster = tx.prepare('DELETE FROM roster WHERE classId=? AND number=?');
            for (const number of targets) { await dropAttendance.run(classId, number); await dropRoster.run(classId, number); }
          });
          return send(200,{ok:true,removed:targets.length});
        }
        if (data) {
          const number = text(data.number,20), name = text(data.name,40);
          if (!['present','absent'].includes(data.status)) throw failure(400,'출결 상황을 선택하세요.');
          if (!await db.prepare('SELECT 1 FROM roster WHERE classId=? AND number=? AND name=?').get(classId,number,name)) throw failure(400,'학번과 이름이 일치하지 않습니다.');
          await markAttendance(classId,number,data.status);
        }
        const day = schoolDay();
        const rows = await db.prepare("SELECT r.number,r.name,COALESCE(a.status,'absent') status FROM roster r LEFT JOIN attendance a ON a.classId=r.classId AND a.number=r.number AND a.day=? WHERE r.classId=? ORDER BY r.number").all(day,classId);
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
        const existing = await db.prepare('SELECT id,score,passed,heard FROM attempts WHERE id=? AND owner=?').get(id, session.owner);
        if (existing) return send(200, existing);
        const lesson = findLesson(data.lesson);
        if (!lesson || typeof data.heard !== 'string' || data.heard.length > 500) throw failure(400, '잘못된 연습 내용입니다.');
        const heard = await recognizedHiragana(data.heard.trim(), lesson);
        if (heard === null) throw failure(422, '일본어 발음을 읽어내지 못했어요. 다시 읽어 주세요.');
        const score = heard ? assess(lesson.reading, heard, lesson.ruby || '').score : null;
        const passed = score === null ? null : Number(score >= PASS_THRESHOLD);
        await db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,session.owner,session.classId,session.number,session.name,lesson.id,lesson.reading,heard,score,passed,new Date().toISOString());
        void sheets.flush();
        return send(201, { id, score, passed, heard });
      }
      const scope = () => { auth(); return session.role === 'teacher' ? { sql: 'classId IN (SELECT classId FROM permissions WHERE teacher=?)', value: session.owner } : { sql: 'owner=?', value: session.owner }; };
      if ((path === '/api/attempts' || path === '/api/export') && req.method === 'GET') {
        const access = scope(); if (path === '/api/export') auth('teacher');
        const conditions = [access.sql]; const args = [access.value];
        for (const key of ['classId', 'number']) if (url.searchParams.get(key)) { conditions.push(`${key}=?`); args.push(url.searchParams.get(key)); }
        const rows = await db.prepare(`SELECT id,classId,number,name,lesson,target,heard,score,passed,at FROM attempts WHERE ${conditions.join(' AND ')} ORDER BY at DESC`).all(...args);
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
  };
  const server = createServer(handle);
  server.on('listening',()=>sheets.start());
  server.on('close',()=>sheets.close());
  return { server, db, handle, sheets }; 
}
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const portFromPlatform = process.env.PORT;
if ((isDirectRun || portFromPlatform) && !process.env.NODE_TEST_CONTEXT) {
  const port = Number(portFromPlatform || 5500);
  const host = portFromPlatform ? '0.0.0.0' : (process.env.HOST || '127.0.0.1');
  let server;
  try {
    if (portFromPlatform && process.env.NODE_ENV === 'production' && !process.env.APP_ORIGIN?.startsWith('https://')) throw new Error('운영 환경에서는 HTTPS APP_ORIGIN이 필요합니다.');
    server = createApp().server;
  } catch (error) {
    console.error(error);
    server = createServer((req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('앱을 시작하지 못했습니다. 연결 주소를 확인하세요.');
    });
  }
  server.listen(port, host, () => console.log(`かな소리: http://${host}:${port}`));
}
