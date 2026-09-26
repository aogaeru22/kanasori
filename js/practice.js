import { api } from './api.js';
import { assess } from './score.js';
import { expandLongVowels } from './kana.js';
import { PASS_THRESHOLD } from './lessons.js';
import { createFeedbackVoice } from './feedback-voice.js';

// Only recognition text and an assessment are submitted; no audio playback is created.
export function setupPractice(getRow, { singleWord = false } = {}) {
  const $ = id => document.getElementById(id);
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let busy = false;
  let pending = null;
  let utteranceTimer = 0;
  let activeRun = null;
  let ready = false;
  let selectionVersion = 0;
  let scoreFrame = 0;
  let paintedScore = null;
  const feedbackVoice = createFeedbackVoice();
  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const scrollTo = element => element?.scrollIntoView?.({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  const saveStatus = message => { if ($('saveStatus')) $('saveStatus').textContent = message; };
  const setScore = score => {
    $('scoreNum').textContent = `${score}%`;
    $('scoreRing').style.setProperty('--p', String(score));
  };
  const animateScore = score => {
    window.cancelAnimationFrame?.(scoreFrame);
    if (!window.requestAnimationFrame || reducedMotion()) { setScore(score); return; }
    setScore(0);
    let started;
    const tick = now => {
      started ??= now;
      const progress = Math.min((now - started) / 750, 1);
      setScore(Math.round(score * (1 - (1 - progress) ** 3)));
      if (progress < 1) scoreFrame = window.requestAnimationFrame(tick);
    };
    scoreFrame = window.requestAnimationFrame(tick);
  };
  const hint = message => { $('micHint').textContent = message; };
  const lock = value => {
    busy = value;
    document.querySelectorAll('.row-tab, #lessons button, #sections button, #pages button').forEach(button => { button.disabled = value; });
    $('retryBtn').disabled = value;
  };
  const clear = () => {
    window.cancelAnimationFrame?.(scoreFrame);
    paintedScore = null;
    clearTimeout(utteranceTimer);
    feedbackVoice.stop();
    window.speechSynthesis?.cancel();
    if ($('heardText')) $('heardText').textContent = '';
    if ($('heardBox')) $('heardBox').hidden = true;
    saveStatus('');
    setScore(0);
    $('scoreResult').classList.remove('show'); document.body.classList.remove('scored');
    hint('버튼을 누르고 가나를 읽어 보세요.');
  };
  const paint = (row, heard, result, saved) => {
    const firstPaint = paintedScore === null;
    if ($('heardText')) $('heardText').textContent = heard;
    if ($('heardBox')) $('heardBox').hidden = false;
    if (paintedScore !== result.score) animateScore(result.score);
    paintedScore = result.score;
    $('scoreRing').setAttribute('aria-label', `인식률 ${result.score}%`);
    const pass = result.score >= PASS_THRESHOLD;
    $('scoreRing').style.setProperty('--ring', pass ? 'var(--pass)' : '#d3542c');
    $('scoreVerdict').textContent = pass ? '✓ 통과!' : '✕ 다시 연습';
    $('scoreVerdict').className = `verdict ${pass ? 'pass' : 'fail'}`;
    $('verdictSub').textContent = `인식률 ${result.score}% · ${result.score === 100 ? '단어가 정확히 인식됐어요. 훌륭합니다!' : pass ? '잘했어요! 표시된 글자를 한 번 더 연습해 보세요.' : `${PASS_THRESHOLD}% 이상이 필요해요. 표시된 글자를 다시 발음해 보세요.`}`;
    $('diffLine').replaceChildren();
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = '목표:'; $('diffLine').append(tag);
    for (const mark of assess(row.reading, heard, row.ruby || '').marks) { const span = document.createElement('span'); span.className = mark.kind === 'ok' ? 'ok' : 'bad'; span.textContent = mark.ch; $('diffLine').append(span); }
    $('scoreResult').classList.add('show'); document.body.classList.add('scored');
    hint('다시 하려면 버튼을 누르세요.');
    if (firstPaint) scrollTo($('scoreResult'));
  };
  async function save() {
    if (!pending) return;
    const attempt = pending;
    $('saveRetry').hidden = true; $('micBtn').disabled = true;
    saveStatus('결과를 저장하고 있어요…');
    try {
      const result = await api('/api/attempts', attempt.data);
      paint(attempt.row, attempt.data.heard, result, true);
      pending = null; lock(false); $('micBtn').disabled = false;
      saveStatus('저장 완료 · 나의 결과에서 확인할 수 있어요');
      utteranceTimer = setTimeout(() => feedbackVoice.play(result.score), 280);
    } catch (error) {
      saveStatus(`${error.message} 결과 저장을 다시 시도해 주세요.`);
      $('saveRetry').hidden = false;
    }
  }
  async function start() {
    if (!ready || busy || pending) return;
    if (!Recognition) { hint('이 브라우저는 음성 인식을 지원하지 않아요. Chrome에서 같은 주소를 열어 주세요.'); return; }
    if (!getRow()) { hint('먼저 연습할 단어를 선택해 주세요.'); return; }
    clear(); lock(true);
    hint('마이크를 연결하고 있어요. 권한 요청이 나오면 허용해 주세요.');
    
    const row = { ...getRow() };
    const version = selectionVersion;
    const run = { row, heard: '', interim: '', error: '', finished: false, timer: 0, forceTimer: 0, silenceTimer: 0, stopMonitoring: null, stopping: false };
    run.release = () => { run.stopMonitoring?.(); };
    activeRun = run;
    recognition = new Recognition();
    recognition.lang = 'ja-JP'; recognition.interimResults = true;
    recognition.continuous = true; recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      if (run.finished || run.stopping) return;
      clearTimeout(run.timer);
      $('micBtn').classList.add('recording'); $('micBtn').setAttribute('aria-label','인식 중지');
      hint('듣고 있어요… 또박또박 말해보세요.');
      run.timer = setTimeout(() => run.stop(), 120000);
      // SpeechRecognition owns microphone capture. Opening a second microphone
      // stream here can interrupt the recognizer on mobile/headset devices.
    };
    recognition.onspeechstart = () => clearTimeout(run.silenceTimer);
    recognition.onspeechend = () => {
      // Short syllables can end before the service returns any text. Do not
      // cut off capture merely because its voice-activity detector went quiet.
      if (run.finished || run.stopping || run.stopMonitoring || !(run.heard || run.interim)) return;
      clearTimeout(run.silenceTimer);
      run.silenceTimer = setTimeout(stop, 2500);
    };
    const finish = async () => {
      if (run.finished) return;
      run.finished = true; clearTimeout(run.timer); clearTimeout(run.forceTimer); clearTimeout(run.silenceTimer);
      run.release();
      activeRun = null; recognition = null;
      $('micBtn').classList.remove('recording'); $('micBtn').setAttribute('aria-label','소리 내어 읽기');
      run.heard = (run.heard + run.interim).slice(0,500);
      if (run.heard) {
        hint('발음을 확인하고 있어요…');
        try {
          const { reading } = await api('/api/reading', { lesson: row.id, heard: run.heard });
          if (version !== selectionVersion) return;
          if (!reading || !/^[ぁ-ゖ]+$/u.test(reading)) throw new Error('일본어 발음을 읽어내지 못했어요. 다시 읽어 주세요.');
          pending = { row, data: { id: crypto.randomUUID(), lesson: row.id, heard: reading } };
          paint(row, reading, assess(row.reading, reading, row.ruby || ''),false);
          void save();
        } catch (error) { if (version !== selectionVersion) return; lock(false); $('micBtn').disabled = false; hint(error.message); }
      } else { lock(false); $('micBtn').disabled = false; hint(run.error || '인식되지 않았어요. 다시 눌러 보세요.'); }
    };
    const stop = () => {
      if (run.stopping || run.finished) return;
      run.stopping = true;
      $('micBtn').classList.remove('recording');
      hint('발음을 확인하고 있어요…');
      clearTimeout(run.silenceTimer);
      run.stopMonitoring?.();
      try { recognition?.stop(); } catch { /* already stopped */ }
      clearTimeout(run.forceTimer);
      run.forceTimer = setTimeout(() => { try { recognition?.abort(); } catch {} finish(); }, 4000);
    };
    run.stop = stop;
    recognition.onresult = event => {
      if (run.finished) return;
      const finals = [], interim = [];
      for (const result of Array.from(event.results)) {
        // Use the recognizer's first choice, never the alternative closest to
        // the expected answer (which artificially increases assessment scores).
        const heard = (result[0]?.transcript || '').trim().slice(0,500);
        if (result.isFinal === false) interim.push(heard);
        else finals.push(heard);
      }
      const finalText = finals.join('').slice(0,500);
      const interimText = interim.join('').slice(0,500);
      // Some engines retract a short interim result with an empty event just
      // before ending. Keep the last nonempty text; a real final replaces it.
      if (finalText || interimText) {
        run.heard = finalText;
        run.interim = interimText;
      }
      // Do not briefly expose kanji from the recognizer. Wait for the reading
      // endpoint for kanji; kana-only interim results can be displayed locally.
      const preview = expandLongVowels(run.heard + run.interim, row.reading).replace(/[\s、。，．,.!！?？]/g,'');
      const kanaOnly = /^[ぁ-ゖ]+$/u.test(preview);
      if ($('heardText')) $('heardText').textContent = kanaOnly ? preview : '';
      if ($('heardBox')) $('heardBox').hidden = !kanaOnly;
      if (singleWord && run.heard && !run.interim) stop();
      else if (singleWord && run.interim && !run.stopping) {
        clearTimeout(run.silenceTimer);
        run.silenceTimer = setTimeout(stop, 2500);
      }
    };
    recognition.onerror = event => {
      if (run.finished) return;
      const messages = { 'not-allowed':'마이크 사용을 허용해 주세요.', 'service-not-allowed':'이 브라우저의 음성 인식을 사용할 수 없어요. Chrome에서 같은 주소를 열고 학번과 이름으로 들어와 주세요.', 'no-speech':'소리가 들리지 않았어요. 다시 읽어 주세요.', network:'음성 인식 서비스에 연결하지 못했어요. 앱 안의 미리보기에서는 지원되지 않을 수 있어요. 인터넷에 연결된 Chrome에서 같은 주소를 열고 다시 시도해 주세요.', 'audio-capture':'마이크를 찾지 못했어요. 연결 상태를 확인해 주세요.' };
      if (event.error !== 'no-speech') { run.heard = ''; run.interim = ''; }
      run.error = messages[event.error] || '음성 인식을 마치지 못했어요. 다시 시도해 주세요.';
      finish();
    };
    recognition.onend = finish;
    try {
      run.timer = setTimeout(() => {
        run.error = '음성 인식이 시작되지 않았어요. Chrome에서 마이크 권한을 허용한 뒤 다시 시도해 주세요.';
        const stalled = recognition;
        finish();
        try { stalled?.abort(); } catch {}
      }, 15000);
      recognition.start();
    } catch { run.error = '마이크를 시작하지 못했어요. 다시 시도해 주세요.'; finish(); }
  }
  $('micBtn').onclick = () => { if (activeRun) activeRun.stop(); else start(); };
  $('retryBtn').onclick = () => {
    if (busy || pending) return;
    clear();
    hint('버튼을 누르고 다시 읽어보세요.');
    $('micBtn').focus?.({ preventScroll: true });
    scrollTo($('speakingCard'));
  };
  $('saveRetry').onclick = save;
  $('endSession').onclick = async () => {
    if (busy) { hint('진행 중인 연습과 저장을 마친 뒤 종료해 주세요.'); return; }
    try { await api('/api/logout',{}); location.replace('/'); }
    catch (error) { hint(error.message); }
  };
  window.addEventListener('beforeunload', event => { if (busy || pending) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => feedbackVoice.stop());
  window.addEventListener('pagehide', () => { window.cancelAnimationFrame?.(scoreFrame); clearTimeout(utteranceTimer); window.speechSynthesis?.cancel(); if (activeRun) { activeRun.finished = true; clearTimeout(activeRun.silenceTimer); activeRun.release(); clearTimeout(activeRun.timer); clearTimeout(activeRun.forceTimer); try { recognition?.abort(); } catch {} } });
  $('micBtn').setAttribute('aria-label', '소리 내어 읽기');
  $('micBtn').disabled = true;
  $('retryBtn').disabled = true;
  api('/api/me').then(me => {
    if (me.role !== 'student') { location.replace('/'); return; }
    $('learner').textContent = `${me.number} ${me.name}`;
    ready = true;
    $('micBtn').disabled = false; $('retryBtn').disabled = false;
  }).catch(error => {
    if (error.status === 401) location.replace('/');
    else hint(error.message);
  });
  const changeSelection = () => {
    if (pending) {
      hint('결과 저장을 마친 뒤 단어를 바꿀 수 있어요. 저장 실패 시 결과 저장 재시도를 눌러 주세요.');
      return false;
    }
    selectionVersion++;
    if (activeRun) {
      activeRun.finished = true;
      clearTimeout(activeRun.timer); clearTimeout(activeRun.forceTimer); clearTimeout(activeRun.silenceTimer);
      activeRun.release();
      const previous = recognition;
      activeRun = null; recognition = null;
      try { previous?.abort(); } catch {}
    }
    $('micBtn').classList.remove('recording');
    $('micBtn').setAttribute('aria-label', '소리 내어 읽기');
    $('micBtn').disabled = !ready;
    lock(false); clear();
    return true;
  };
  return { clear, changeSelection, get busy() { return busy; } };
}
