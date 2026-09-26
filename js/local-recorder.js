// Temporary in-memory playback only. Never uploads or persists audio.
import { monitorSilence } from './silence-monitor.js';
export function createLocalRecorder({ button, hint, container, lock, recordingOnly = false }) {
  let recorder, stream, timer, url, cancelled = false, stopMonitoring;
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.hidden = true;
  audio.setAttribute('aria-label', '내 발음 다시 듣기');
  audio.style.cssText = 'max-width:100%;margin:10px auto';
  container.append(audio);
  const release = () => { stopMonitoring?.(); stopMonitoring = null; stream?.getTracks().forEach(track => track.stop()); stream = null; };
  const clear = () => {
    audio.pause(); audio.removeAttribute('src'); audio.hidden = true;
    if (url) URL.revokeObjectURL(url);
    url = null;
  };
  const stop = () => { if (recorder?.state === 'recording') recorder.stop(); };
  async function start() {
    clear(); cancelled = false; lock(true);
    hint('마이크 권한을 확인하고 있어요…');
    try {
      if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelled) { release(); return; }
      recorder = new window.MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        clearTimeout(timer); release(); lock(false);
        button.classList.remove('recording'); button.setAttribute('aria-label', '소리 내어 읽기');
        if (cancelled) return;
        if (chunks.length) {
          url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
          audio.src = url; audio.hidden = false;
          hint(recordingOnly ? '녹음 완료 · 내 발음을 들어 보세요. 돌아가기를 누르면 글자 연습 화면으로 이동해요.' : '녹음 완료 · 아래에서 내 발음을 들어 보세요. 음성 인식 연결 오류로 자동 평가 결과는 저장되지 않았어요.');
        } else hint('녹음된 소리가 없어요. 마이크를 확인하고 다시 시도해 주세요.');
      };
      recorder.onerror = () => { stop(); release(); lock(false); hint('녹음 중 오류가 발생했어요. 다시 시도해 주세요.'); };
      stopMonitoring = await monitorSilence(stream, stop, { silenceMs: 800 });
      if (cancelled) { release(); return; }
      recorder.start();
      button.classList.add('recording'); button.setAttribute('aria-label', '녹음 중지');
      hint('녹음 중 · 선택한 단어를 읽어 주세요. 말을 마치면 자동으로 끝나요.');
      timer = setTimeout(stop, 120000);
    } catch (error) {
      release(); lock(false);
      hint(error.name === 'NotAllowedError' ? '마이크 권한이 차단됐어요. 사이트 설정에서 마이크를 허용해 주세요.' : '이 브라우저에서 마이크 녹음을 시작할 수 없어요. Chrome에서 열어 주세요.');
    }
  }
  return { start, stop, clear, dispose() { cancelled = true; clearTimeout(timer); stop(); release(); clear(); } };
}
