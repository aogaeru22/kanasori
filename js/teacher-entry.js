import { api } from './api.js';
const link = document.querySelector('a[href="teacher.html"]');
const dialog = document.createElement('dialog');
dialog.className = 'teacher-auth';
dialog.innerHTML = '<form><div class="auth-top"><span class="section-label">TEACHER ACCESS</span><button type="button" class="auth-close" aria-label="닫기">×</button></div><div class="auth-icon" aria-hidden="true">✦</div><h2>반갑습니다, 선생님.</h2><p class="muted">교사 인증 후 오늘의 출석부를 열어보세요.</p><label>비밀번호<input type="password" name="password" autocomplete="current-password" placeholder="교사 비밀번호를 입력하세요" required maxlength="200"></label><p role="status" class="auth-status"></p><button class="primary" type="submit">인증하고 출석부 열기 →</button></form>';
document.body.append(dialog);
const style=document.createElement('link');style.rel='stylesheet';style.href='/css/attendance.css';document.head.append(style);
let checking = false;
link?.addEventListener('click', async event => {
  event.preventDefault();
  if (checking) return;
  checking = true;
  link.setAttribute('aria-busy', 'true');
  try {
    const teacher = await api('/api/teacher/me');
    if (teacher.role === 'teacher') {
      location.href = '/attendance.html';
      return;
    }
    dialog.showModal();
  } catch (error) {
    dialog.querySelector('form').reset();
    dialog.querySelector('.auth-status').textContent = error.status === 401 ? '' : error.message;
    dialog.showModal();
    dialog.querySelector('input[name="password"]').focus();
  } finally {
    checking = false;
    link.removeAttribute('aria-busy');
  }
});
dialog.querySelector('.auth-close').onclick=()=>dialog.close();
dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;const form=new FormData(e.target);try{await api('/api/login',{password:form.get('password')});location.href='/attendance.html';}catch(error){dialog.querySelector('.auth-status').textContent=error.message;}finally{button.disabled=false;}};
