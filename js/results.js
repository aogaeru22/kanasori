import { api } from './api.js';
import { renderRecords } from './result-table.js';
const $ = id => document.getElementById(id);
async function refresh() {
  $('message').textContent = ''; $('refresh').disabled = true;
  try {
    const me = await api('/api/me');
    if (me.role !== 'student') { location.replace('/'); return; }
    $('studentName').textContent = `${me.classId} · ${me.number} ${me.name} 님`;
    renderRecords($('records'), (await api('/api/attempts')).rows);
  } catch (error) { $('records').replaceChildren(); $('message').textContent = error.message; if (error.status === 401) location.replace('/'); }
  finally { $('refresh').disabled = false; }
}
$('refresh').onclick = refresh;
$('logout').onclick = async () => { try { await api('/api/logout',{}); location.replace('/'); } catch (error) { $('message').textContent = error.message; } };
refresh();
window.addEventListener('pageshow', event => { if (event.persisted) { $('records').replaceChildren(); refresh(); } });
