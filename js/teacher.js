import { api } from './api.js';
import { renderRecords } from './result-table.js';
import { summarizeLearning, studentKey } from './learning-summary.js';
import { classChart, growthChart, distributionChart, lessonChart, sparkline, number, change } from './teacher-charts.js';
const $ = id => document.getElementById(id);
let rows = [], classes = [], classId = '', threshold = 70, summary = summarizeLearning([]);
let sort = { key:'priority', direction:-1 };
const className = id => classes.find(group => group.id === id)?.name || id;
const date = value => new Date(value).toLocaleString('ko-KR', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
function el(tag, text, className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
}
function openStudent(student) {
  $('detailTitle').textContent = `${student.name} · ${student.number}`;
  $('detailSummary').textContent = `${className(student.classId)} · ${student.count}회 연습 · 처음 ${number(student.first)} → 최근 ${number(student.last)}점 · 평균 ${number(student.average)}점`;
  $('detailExport').href = '/api/export?' + new URLSearchParams({classId:student.classId, number:student.number});
  renderRecords($('detailRecords'), [...student.attempts].reverse());
  $('studentDetail').showModal();
  $('chartTooltip').hidden = true;
}
function studentButton(student) { const button = el('button',student.name,'student-name'); button.onclick = () => openStudent(student); return button; }
function classButtons() {
  $('classButtons').replaceChildren();
  for (const group of [{id:'',name:'전체'},...classes]) {
    const button = el('button',group.name); button.setAttribute('aria-pressed',String(group.id === classId));
    button.onclick = () => { classId = group.id; $('studentFilter').value = ''; classButtons(); students(); filter(); };
    $('classButtons').append(button);
  }
}
function students() {
  const previous = $('studentFilter').value;
  $('studentFilter').replaceChildren(new Option('전체 학습자',''));
  const found = new Map();
  for (const row of rows) if (!classId || row.classId === classId) { const key = studentKey(row); if (!found.has(key)) found.set(key, `${className(row.classId)} · ${row.number} ${row.name}`); }
  for (const [key,label] of [...found].sort((a,b) => a[1].localeCompare(b[1]))) $('studentFilter').add(new Option(label,key));
  if (found.has(previous)) $('studentFilter').value = previous;
}
function filter() {
  const selected = $('studentFilter').value;
  const visible = rows.filter(row => (!classId || row.classId === classId) && (!selected || studentKey(row) === selected));
  summary = summarizeLearning(visible,threshold);
  $('studentCount').textContent = `${summary.students.length}명`;
  $('attemptCount').textContent = `모두 ${summary.attempts}번 시도`;
  $('average').textContent = summary.average === null ? '—' : `${number(summary.average)}점`;
  $('growth').textContent = summary.growth === null ? '—' : `${summary.growth > 0 ? '+' : ''}${number(summary.growth)}점`;
  $('growthNote').textContent = `처음 → 최근 · 비교 가능 ${summary.comparableCount}명`;
  $('improved').textContent = `${summary.improved}명`;
  $('declined').textContent = `${summary.declined}명 내려감 · ${summary.unchanged}명 그대로`;
  const selectedStudent = selected ? JSON.parse(selected) : null;
  $('export').href = '/api/export?' + new URLSearchParams({classId:selectedStudent?.[0] || classId, number:selectedStudent?.[1] || ''});
  $('summaryExport').disabled = !summary.students.length;
  $('assessmentNote').textContent = `점수는 인식 문자 일치율이며 ${threshold}점 이상이면 통과입니다. 억양·장단음 등 발음 자체의 정밀 평가는 아닙니다. 음성 파일은 저장하지 않습니다.`;
  classChart($('classChart'),[...summary.classes].sort((a,b)=>className(a.classId).localeCompare(className(b.classId),'ko',{numeric:true})),threshold,className);
  growthChart($('growthChart'),summary.students,threshold,openStudent);
  distributionChart($('distributionChart'),summary.bins,threshold);
  lessonChart($('lessonChart'),summary.lessons,threshold);
  renderAttention(); renderGrowthTable(); renderLessonTable();
  renderRecords($('records'), visible, row => openStudent(summary.students.find(student => student.key === studentKey(row))));
  $('chartTooltip').hidden = true;
}
function renderAttention() {
  $('attention').replaceChildren();
  const attention = summary.students.filter(student => student.reasons.length);
  if (!attention.length) { $('attention').append(el('p',summary.students.length ? '현재 기준에 해당하는 학생이 없습니다. 학생별 성장 표에서 전체 흐름을 확인하세요.' : '아직 저장된 학습 결과가 없습니다. 학생이 연습하면 이곳에 표시됩니다.','empty')); return; }
  for (const student of attention) {
    const card = el('article',undefined,`panel attention-card ${student.priority < 2 ? 'medium' : ''}`);
    const top = el('div',undefined,'attention-top'); top.append(studentButton(student),el('small',`${className(student.classId)} · ${student.number}`),el('span',student.priority >= 2 ? '먼저 확인' : '연습 확인','priority'));
    const reasons = el('ul'); for (const reason of student.reasons) reasons.append(el('li',reason));
    card.append(top,reasons);
    if (student.weakest) { const weak = el('div',undefined,'weakest'); weak.append(el('small','같이 볼 글자'),el('strong',student.weakest.target),el('small',`평균 ${number(student.weakest.average)}점 · ${student.weakest.count}번`)); card.append(weak); }
    const bottom = el('p',`시도 ${student.count}번 · 최고 ${number(student.best)}점\n처음 ${number(student.first)} → 최근 ${number(student.last)}  `,'attention-bottom');
    bottom.append(el('span',change(student.delta),student.delta > 0 ? 'up' : student.delta < 0 ? 'down' : 'neutral')); card.append(bottom); $('attention').append(card);
  }
}
const columns = [['classId','반'],['number','학번'],['name','이름'],['count','시도'],['last','처음 → 최근'],['delta','성장'],['best','최고'],['average','평균'],['scores','자취'],['lastAt','마지막 연습']];
function renderGrowthTable() {
  $('growthTable').replaceChildren();
  if (!summary.students.length) { $('growthTable').append(el('p','표시할 학생이 없습니다.','empty')); return; }
  const table = el('table'); table.setAttribute('aria-label','학생별 성장');
  const head = el('thead'), header = el('tr');
  for (const [key,title] of columns) {
    const th = el('th'); th.scope = 'col';
    if (key === 'scores') th.textContent = title;
    else { const active = sort.key === key; th.setAttribute('aria-sort',active ? sort.direction === 1 ? 'ascending' : 'descending' : 'none');
      const button = el('button',title + (active ? sort.direction === 1 ? ' ↑' : ' ↓' : ' ↕'));
      button.onclick = () => { sort = {key,direction:sort.key === key ? -sort.direction : ['count','delta','best','average','lastAt'].includes(key) ? -1 : 1}; renderGrowthTable(); }; th.append(button);
    }
    header.append(th);
  }
  head.append(header); table.append(head);
  const sorted = [...summary.students];
  if (sort.key !== 'priority') sorted.sort((a,b) => {
    const av = sort.key === 'classId' ? className(a.classId) : a[sort.key], bv = sort.key === 'classId' ? className(b.classId) : b[sort.key];
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    return (typeof av === 'number' ? av-bv : String(av).localeCompare(String(bv),'ko',{numeric:true})) * sort.direction || a.key.localeCompare(b.key);
  });
  const body = el('tbody');
  for (const student of sorted) {
    const tr = el('tr');
    for (const [key] of columns) {
      const td = el('td');
      if (key === 'name') td.append(studentButton(student));
      else if (key === 'scores') td.append(sparkline(student.scores));
      else if (key === 'classId') td.textContent = className(student.classId);
      else if (key === 'last') td.textContent = `${number(student.first)} → ${number(student.last)}`;
      else if (key === 'delta') { td.textContent = change(student.delta); td.className = student.delta > 0 ? 'up' : student.delta < 0 ? 'down' : 'neutral'; }
      else if (key === 'lastAt') td.textContent = date(student.lastAt);
      else td.textContent = typeof student[key] === 'number' || student[key] === null ? number(student[key]) : student[key];
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body); $('growthTable').append(table);
}
function renderLessonTable() {
  $('lessonTable').replaceChildren();
  const table = el('table'); table.setAttribute('aria-label','연습 항목별 수치'); const head = el('thead'), header = el('tr');
  for (const title of ['목표 글자','연습한 학생','시도','평균 점수','통과율']) { const th = el('th',title); th.scope = 'col'; header.append(th); } head.append(header); table.append(head);
  const body = el('tbody');
  for (const lesson of summary.lessons) { const tr = el('tr'); for (const value of [lesson.target,`${lesson.students}명`,`${lesson.count}번`,`${number(lesson.average)}점`,`${number(lesson.passRate)}%`]) tr.append(el('td',value)); body.append(tr); }
  table.append(body);
  $('lessonTable').append(summary.lessons.length ? table : el('p','표시할 평가가 없습니다.','empty'));
}
function clearPrivateView() {
  $('sheetStatus').textContent = '';
  rows = []; classes = []; classId = ''; summary = summarizeLearning([]);
  $('dashboard').hidden = true; $('loginPanel').hidden = false; $('logout').hidden = true;
  $('studentDetail').close(); $('detailRecords').replaceChildren(); $('detailTitle').textContent = ''; $('detailSummary').textContent = '';
  for (const id of ['records','growthTable','attention','classChart','growthChart','distributionChart','lessonChart','lessonTable']) $(id).replaceChildren();
  $('chartTooltip').hidden = true;
}
async function sheetStatus() {
  try { const s=await api('/api/teacher/sheets');
    $('sheetStatus').textContent=s.preview ? '미리보기 데이터 · 서버 재시작 시 초기화됩니다. 구글 시트 전송은 꺼져 있습니다.' : !s.enabled ? '구글 시트 연결 대기 · 학습 기록은 서버에 저장됩니다.' : s.failed ? '구글 시트 전송을 재시도하고 있습니다. 학습 기록은 서버에 보관되어 있습니다.' : '구글 시트 전송 완료 '+s.sent+'건 · 대기 '+s.pending+'건';
  } catch { $('sheetStatus').textContent='구글 시트 연결 상태를 확인할 수 없습니다.'; }
}
async function refresh() {
  if ($('refresh').disabled) return;
  $('refresh').disabled = true; $('message').textContent = '';
  try { const result = await api('/api/teacher/attempts'); rows = result.rows; threshold = result.threshold; students(); filter(); void sheetStatus(); $('asOf').textContent = `${new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'})} 기준`; }
  catch (error) { $('message').textContent = error.message; if ([401,403].includes(error.status)) clearPrivateView(); }
  finally { $('refresh').disabled = false; }
}
async function init() {
  try {
    const me = await api('/api/teacher/me'); if (me.role !== 'teacher') { clearPrivateView(); return; }
    classes = [...me.classes].sort((a,b)=>a.name.localeCompare(b.name,'ko',{numeric:true})); if (!classes.some(group => group.id === classId)) classId = '';
    $('loginPanel').hidden = true; $('dashboard').hidden = false; $('logout').hidden = false;
    classButtons(); await refresh();
  } catch (error) { clearPrivateView(); if (error.status !== 401) $('message').textContent = error.message; }
}
$('loginForm').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; $('message').textContent = '';
  try { await api('/api/login',{id:$('teacherId').value.trim(),password:$('teacherPassword').value}); $('teacherPassword').value = ''; await init(); }
  catch (error) { $('message').textContent = error.message; }
  finally { button.disabled = false; }
};
$('logout').onclick = async () => { try { await api('/api/teacher/logout',{}); clearPrivateView(); } catch (error) { $('message').textContent = error.message; } };
$('studentFilter').onchange = filter; $('refresh').onclick = refresh;
$('closeDetail').onclick = () => $('studentDetail').close();
$('summaryExport').onclick = () => {
  const cell = value => { let text = String(value ?? ''); if (/^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'"+text; return '"'+text.replaceAll('"','""')+'"'; };
  const values = [['학급','학번','이름','시도','처음','최근','성장','최고','평균','마지막 연습(UTC)'],...summary.students.map(s => [className(s.classId),s.number,s.name,s.count,s.first,s.last,s.delta,s.best,s.average === null ? '' : Math.round(s.average*10)/10,s.lastAt])];
  const blob = new Blob(['\ufeff'+values.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = 'kanasori-student-growth.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
};
function showTip(target, x, y) {
  $('chartTooltip').textContent = target.getAttribute('data-tip'); $('chartTooltip').hidden = false;
  const box = $('chartTooltip').getBoundingClientRect();
  $('chartTooltip').style.left = `${Math.max(8,Math.min(x+12,innerWidth-box.width-8))}px`;
  $('chartTooltip').style.top = `${Math.max(8,Math.min(y+12,innerHeight-box.height-8))}px`;
}
document.addEventListener('pointerover',event => { const target = event.target.closest?.('[data-tip]'); if (target) showTip(target,event.clientX,event.clientY); });
document.addEventListener('pointerout',event => { if (event.target.closest?.('[data-tip]')) $('chartTooltip').hidden = true; });
document.addEventListener('focusin',event => { const target = event.target.closest?.('[data-tip]'); if (target) { const box = target.getBoundingClientRect(); showTip(target,box.x,box.y); } else $('chartTooltip').hidden = true; });
window.addEventListener('scroll',()=>{ $('chartTooltip').hidden = true; },true);
// Reuse the authenticated teacher session when entering from attendance.
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    clearPrivateView();
    $('loginPanel').hidden = true;
    init();
  }
});
init();

setInterval(()=>{if(!document.hidden && !$('dashboard').hidden) void refresh();},15000);
