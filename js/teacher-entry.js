import { api } from './api.js';
const link = document.querySelector('a[href="teacher.html"]');
const dialog = document.createElement('dialog');
dialog.className = 'teacher-auth';
dialog.innerHTML = '<form id="teacherLogin"><div class="auth-top"><span class="section-label">TEACHER ACCESS</span><button type="button" class="auth-close" aria-label="닫기">×</button></div><div class="auth-icon" aria-hidden="true">✦</div><h2>반갑습니다, 선생님.</h2><p class="muted">교사 인증 후 오늘의 출석부를 열어보세요.</p><label>비밀번호<input type="password" name="password" autocomplete="current-password" placeholder="교사 비밀번호를 입력하세요" required maxlength="200"></label><p role="status" class="auth-status"></p><button class="primary" type="submit">인증하고 출석부 열기 →</button></form><details class="password-change"><summary>비밀번호 변경</summary><p class="muted">현재 비밀번호를 알고 있으면 여기서 바꿉니다. 12자 이상으로 정하세요.</p><form id="teacherPassword"><label>현재 비밀번호<input type="password" name="current" autocomplete="current-password" required maxlength="200"></label><label>새 비밀번호<input type="password" name="next" autocomplete="new-password" required minlength="12" maxlength="200"></label><label>새 비밀번호 확인<input type="password" name="confirm" autocomplete="new-password" required minlength="12" maxlength="200"></label><p role="status" class="auth-status"></p><button class="primary" type="submit">비밀번호 변경</button></form></details><details class="password-change"><summary>비밀번호를 잊었어요</summary><p class="muted">등록한 이메일로 인증 번호를 보냅니다. 번호는 10분 동안만 쓸 수 있습니다.</p><form id="teacherEmail"><label>현재 비밀번호<input type="password" name="current" autocomplete="current-password" required maxlength="200"></label><label>복구 이메일<input type="email" name="email" autocomplete="email" placeholder="teacher@example.com" required maxlength="120"></label><p role="status" class="auth-status"></p><button class="primary" type="submit">이메일 등록</button></form><form id="teacherCode"><button class="primary" type="submit">인증 번호 보내기</button><p role="status" class="auth-status"></p></form><form id="teacherRecover"><label>인증 번호<input name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="20"></label><label>새 비밀번호<input type="password" name="next" autocomplete="new-password" required minlength="12" maxlength="200"></label><label>새 비밀번호 확인<input type="password" name="confirm" autocomplete="new-password" required minlength="12" maxlength="200"></label><p role="status" class="auth-status"></p><button class="primary" type="submit">인증하고 비밀번호 정하기</button></form></details>';
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
    dialog.querySelector('#teacherLogin').reset();
    dialog.querySelector('#teacherPassword').reset();
    dialog.querySelector('#teacherRecover').reset();
    dialog.querySelector('#teacherEmail').reset();
    dialog.querySelector('#teacherLogin .auth-status').textContent = error.status === 401 ? '' : error.message;
    dialog.showModal();
    dialog.querySelector('input[name="password"]').focus();
  } finally {
    checking = false;
    link.removeAttribute('aria-busy');
  }
});
dialog.querySelector('.auth-close').onclick=()=>dialog.close();
dialog.querySelector('#teacherLogin').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;const form=new FormData(e.target);try{await api('/api/login',{password:form.get('password')});location.href='/attendance.html';}catch(error){dialog.querySelector('#teacherLogin .auth-status').textContent=error.message;}finally{button.disabled=false;}};
async function savePassword(event, path){event.preventDefault();const button=event.submitter;button.disabled=true;const status=event.target.querySelector('.auth-status');status.textContent='';const form=new FormData(event.target);const next=String(form.get('next')||'');const confirm=String(form.get('confirm')||'');if(next!==confirm){status.textContent='새 비밀번호가 서로 다릅니다.';button.disabled=false;return;}try{await api(path,{current:form.get('current'),next,confirm});event.target.reset();status.textContent='비밀번호를 변경했습니다. 새 비밀번호로 로그인하세요.';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}}
dialog.querySelector('#teacherPassword').onsubmit=e=>savePassword(e,'/api/password');
dialog.querySelector('#teacherEmail').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;const status=e.target.querySelector('.auth-status');status.textContent='';const form=new FormData(e.target);try{const result=await api('/api/password/email',{current:form.get('current'),email:form.get('email')});status.textContent=`복구 이메일을 ${result.to}로 등록했습니다.`;}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
dialog.querySelector('#teacherCode').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;const status=e.target.querySelector('.auth-status');status.textContent='';try{const result=await api('/api/password/code',{});status.textContent=`인증 번호를 ${result.to}로 보냈습니다.`;}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
dialog.querySelector('#teacherRecover').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;const status=e.target.querySelector('.auth-status');status.textContent='';const form=new FormData(e.target);const next=String(form.get('next')||'');const confirm=String(form.get('confirm')||'');if(next!==confirm){status.textContent='새 비밀번호가 서로 다릅니다.';button.disabled=false;return;}try{await api('/api/password/recover',{code:form.get('code'),next,confirm});e.target.reset();status.textContent='비밀번호를 변경했습니다. 새 비밀번호로 로그인하세요.';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
