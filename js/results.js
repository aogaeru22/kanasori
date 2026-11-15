import { api } from './api.js';
import { renderRecords } from './result-table.js';
const $ = id => document.getElementById(id);
const endedQuery = new URLSearchParams(location.search).get('ended') === '1';

function renderRanking(rows) {
  const list = $('ranking');
  list.replaceChildren();
  rows.forEach(row => {
    const item = document.createElement('li');
    item.className = 'ranking-item';
    if (row.mine) item.classList.add('mine');
    item.innerHTML = `<span class="rank">${row.rank}</span><span class="who">${row.number} ${row.name}</span><strong class="count">${row.count}회</strong>`;
    list.append(item);
  });
  $('rankingEmpty').hidden = rows.length > 0;
  list.hidden = rows.length === 0;
}

async function refresh() {
  $('message').textContent = '';
  $('refresh').disabled = true;
  try {
    const me = await api('/api/me');
    if (me.role !== 'student') { location.replace('/'); return; }
    const ended = Boolean(me.ended || endedQuery);
    $('studentName').textContent = `${me.classId} · ${me.number} ${me.name} 님`;
    $('endedBanner').hidden = !ended;
    $('backPractice').hidden = ended;
    $('rankingCard').hidden = !ended;
    document.title = ended ? '학습 종료 · 나의 결과 · かな소리' : '나의 학습 결과 · かな소리';
    renderRecords($('records'), (await api('/api/attempts')).rows);
    if (ended) {
      const data = await api('/api/ranking');
      const ranking = (data.ranking || []).map(row => ({
        ...row,
        mine: row.number === me.number && row.name === me.name,
      }));
      renderRanking(ranking);
    }
  } catch (error) {
    $('records').replaceChildren();
    $('ranking').replaceChildren();
    $('message').textContent = error.message;
    if (error.status === 401) location.replace('/');
  } finally {
    $('refresh').disabled = false;
  }
}

$('refresh').onclick = refresh;
$('resumeLearning').onclick = async () => {
  $('resumeLearning').disabled = true;
  $('message').textContent = '';
  try {
    await api('/api/resume-class', {});
    location.replace('/kana/play.html');
  } catch (error) {
    $('message').textContent = error.message;
    $('resumeLearning').disabled = false;
    if (error.status === 401) location.replace('/');
  }
};
refresh();
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    $('records').replaceChildren();
    refresh();
  }
});
