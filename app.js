import { api } from './js/api.js';
const $ = id => document.getElementById(id);
async function currentStudent() {
  try { return await api('/api/me'); }
  catch (error) { if (error.status === 401) return null; throw error; }
}
async function enter(destination, button) {
  button.disabled = true;
  $('joinStatus').textContent = '';
  try {
    const number = $('studentId').value.trim(), name = $('studentName').value.trim();
    if (!$('studentForm').reportValidity()) {
      $('joinStatus').textContent = '학번과 이름을 입력하고 개인정보 수집·이용 동의를 확인해 주세요.';
      return;
    }
    $('joinStatus').textContent = '학습자 정보를 확인하고 있어요…';
    await api('/api/join', {number, name, consent:$('consent').checked});
    location.href = destination;
  } catch (error) { $('joinStatus').textContent = error.message; }
  finally { button.disabled = false; }
}
$('studentForm').addEventListener('submit', event => {
  event.preventDefault(); enter('/kana/play.html',event.submitter);
});
$('privacyOpen').onclick = () => $('privacy').showModal();
document.querySelectorAll('dialog .close').forEach(button => { button.onclick = () => button.closest('dialog').close(); });
currentStudent().then(student => {
  if (!student || $('studentId').value || $('studentName').value) return;
  $('studentId').value = student.number;
  $('studentName').value = student.name;
}).catch(error => { $('joinStatus').textContent = error.message; });

import './js/teacher-entry.js';
