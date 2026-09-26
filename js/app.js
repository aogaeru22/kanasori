import { APP } from "./config.js";
import { PHRASES } from "./phrases.js";
import { assess, parseRuby, rubyPlain, rubyReading } from "./score.js";

const STORAGE_KEY = "tobiishi-records-v1";
const PROFILE_KEY = "tobiishi-profile-v1";
const CIRC = 2 * Math.PI * 68;

const $ = (id) => document.getElementById(id);
const views = ["startView", "practiceView", "recordView", "growthView"];

const state = {
  phrases: PHRASES.slice(),
  category: "",
  phraseIndex: 1,
  custom: false,
  threshold: APP.passDefault,
  number: "",
  name: "",
  recording: false,
  gotResult: false,
};

let recognition = null;
let safetyTimer = 0;
let speakTimer = 0;
let jaVoice = null;

const KANA_ROWS = [
  { kana: "あ", file: "kana/01_hiragana/a_ka_sa/03-02.swf" },
  { kana: "か", file: "kana/01_hiragana/a_ka_sa/03-04.swf" },
  { kana: "さ", file: "kana/01_hiragana/a_ka_sa/03-08.swf" },
  { kana: "た", file: "kana/01_hiragana/ta_na_ha/03-02.swf" },
  { kana: "な", file: "kana/01_hiragana/ta_na_ha/03-04.swf" },
  { kana: "は", file: "kana/01_hiragana/ta_na_ha/03-07.swf" },
  { kana: "ま", file: "kana/01_hiragana/ma_ya_ra_wa/03-01.swf" },
  { kana: "や", file: "kana/01_hiragana/ma_ya_ra_wa/03-03.swf" },
  { kana: "ら", file: "kana/01_hiragana/ma_ya_ra_wa/03-06.swf" },
  { kana: "わ", file: "kana/01_hiragana/ma_ya_ra_wa/03-09.swf" },
];
let kanaFile = KANA_ROWS[0].file;
let kanaReady = false;

function renderKanaTabs() {
  const tabs = $("kanaTabs");
  tabs.replaceChildren();
  KANA_ROWS.forEach((row) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "row-tab";
    button.classList.toggle("active", kanaFile === row.file);
    const kana = document.createElement("span");
    kana.className = "kana";
    kana.textContent = row.kana;
    const suffix = document.createElement("span");
    suffix.className = "suffix";
    suffix.textContent = "행";
    button.append(kana, suffix);
    button.addEventListener("click", () => {
      kanaFile = row.file;
      renderKanaTabs();
      playKana(row.file);
    });
    tabs.append(button);
  });
}

function playKana(file) {
  const stage = $("kanaStage");
  stage.replaceChildren();
  const ruffle = window.RufflePlayer && window.RufflePlayer.newest && window.RufflePlayer.newest();
  if (!ruffle) return;
  const player = ruffle.createPlayer();
  player.style.width = "100%";
  player.style.height = "100%";
  stage.append(player);
  player.load(file);
}

function ensureKana() {
  renderKanaTabs();
  if (kanaReady) return;
  kanaReady = true;
  playKana(kanaFile);
}

function show(id) {
  views.forEach((view) => $(view).classList.toggle("hidden", view !== id));
  document.body.classList.toggle("practicing", id !== "startView");
  document.querySelector("header").classList.toggle("hidden", id !== "startView");
  if (id === "practiceView") ensureKana();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function groupedCategories() {
  const names = [];
  state.phrases.forEach((item) => {
    const tag = item.tag || "연습";
    if (!names.includes(tag)) names.push(tag);
  });
  return names;
}

function phrasesInCategory() {
  return state.phrases
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (item.tag || "연습") === state.category);
}

function currentPhrase() {
  return state.phrases[state.phraseIndex] || state.phrases[0];
}

function targetReading() {
  if (state.custom) return $("customInput").value.trim();
  const phrase = currentPhrase();
  return (phrase.reading || rubyReading(phrase.ruby)).trim();
}

function targetRuby() {
  if (state.custom) return $("customInput").value.trim();
  return currentPhrase().ruby || "";
}

function targetLabel() {
  if (state.custom) return targetReading();
  return rubyPlain(currentPhrase().ruby);
}

function renderRuby(node, source) {
  node.replaceChildren();
  parseRuby(source).forEach((part) => {
    if (!part.r) {
      node.append(document.createTextNode(part.t));
      return;
    }
    const ruby = document.createElement("ruby");
    ruby.append(document.createTextNode(part.t));
    const rt = document.createElement("rt");
    rt.textContent = part.r;
    ruby.append(rt);
    node.append(ruby);
  });
}

function renderPhraseButtons() {
  const tabs = $("phraseTabs");
  tabs.replaceChildren();

  phrasesInCategory().forEach(({ item, index }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = rubyPlain(item.ruby);
    button.classList.toggle("active", !state.custom && index === state.phraseIndex);
    button.addEventListener("click", () => {
      state.phraseIndex = index;
      state.custom = false;
      renderPractice();
      resetResult();
    });
    tabs.append(button);
  });

  const custom = document.createElement("button");
  custom.type = "button";
  custom.textContent = "✎ 직접 입력";
  custom.classList.toggle("active", state.custom);
  custom.addEventListener("click", () => {
    state.custom = true;
    renderPractice();
    resetResult();
    $("customInput").focus();
  });
  tabs.append(custom);
}

function renderCategories() {
  const tabs = $("categoryTabs");
  tabs.replaceChildren();
  groupedCategories().forEach((name) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.classList.toggle("active", !state.custom && name === state.category);
    button.addEventListener("click", () => {
      state.custom = false;
      state.category = name;
      const first = phrasesInCategory()[0];
      state.phraseIndex = first ? first.index : 0;
      renderPractice();
      resetResult();
    });
    tabs.append(button);
  });

  const custom = document.createElement("button");
  custom.type = "button";
  custom.textContent = "직접 입력";
  custom.classList.toggle("active", state.custom);
  custom.addEventListener("click", () => {
    state.custom = true;
    renderPractice();
    resetResult();
    $("customInput").focus();
  });
  tabs.append(custom);
}

function renderPractice() {
  renderCategories();
  renderPhraseButtons();
  const customInput = $("customInput");
  const customHint = $("customHint");
  const targetJp = $("targetJp");
  const targetKor = $("targetKor");

  if (state.custom) {
    targetJp.classList.add("hidden");
    targetKor.classList.add("hidden");
    customInput.classList.remove("hidden");
    customHint.classList.remove("hidden");
    return;
  }

  targetJp.classList.remove("hidden");
  targetKor.classList.remove("hidden");
  customInput.classList.add("hidden");
  customHint.classList.add("hidden");
  const phrase = currentPhrase();
  renderRuby(targetJp, phrase.ruby);
  targetKor.textContent = phrase.kor || "";
}

function resetResult() {
  $("result").classList.remove("show");
  $("heard").classList.remove("show");
}

function pickJapaneseVoice() {
  const voices = (window.speechSynthesis?.getVoices() || [])
    .filter((voice) => voice.lang && voice.lang.toLowerCase().startsWith("ja"));
  const rank = (voice) => {
    const name = (voice.name || "").toLowerCase();
    let score = 0;
    if (/google|neural|natural|premium|enhanced/.test(name)) score += 5;
    if (/nanami|kyoko|o-ren|otoya|sora/.test(name)) score += 3;
    if (voice.default) score += 1;
    return score;
  };
  voices.sort((a, b) => rank(b) - rank(a));
  jaVoice = voices[0] || null;
}

function speak(text, lang) {
  if (!text || !window.speechSynthesis) return;
  const wasBusy = window.speechSynthesis.speaking || window.speechSynthesis.pending;
  window.clearTimeout(speakTimer);
  window.speechSynthesis.cancel();
  const play = () => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = lang.startsWith("ja") ? 0.92 : 1;
    if (lang.startsWith("ja") && jaVoice) utterance.voice = jaVoice;
    if (lang.startsWith("ko")) {
      const korean = (window.speechSynthesis.getVoices() || [])
        .find((voice) => voice.lang && voice.lang.toLowerCase().startsWith("ko"));
      if (korean) utterance.voice = korean;
    }
    window.speechSynthesis.speak(utterance);
  };
  if (wasBusy) speakTimer = window.setTimeout(play, 120);
  else play();
}

function showHeard(text) {
  $("heard").classList.add("show");
  $("heardText").textContent = text;
}

function paintDiff(marks) {
  const diff = $("diff");
  diff.replaceChildren();
  if (!marks.length) return;
  diff.append(document.createTextNode("소리 "));
  marks.forEach((mark) => {
    const span = document.createElement("span");
    span.className = mark.kind;
    span.textContent = mark.ch;
    diff.append(span);
  });
}

function animateGauge(score, pass) {
  const arc = $("gaugeArc");
  arc.style.stroke = pass ? "var(--pass)" : "var(--fail)";
  const started = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - started) / 500);
    const value = Math.round(score * progress);
    $("pctNum").textContent = `${value}%`;
    arc.style.strokeDashoffset = String(CIRC - (CIRC * value) / 100);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function grade(heardText) {
  const reading = targetReading();
  const ruby = state.custom ? "" : currentPhrase().ruby;
  const result = assess(reading, heardText, ruby);
  const pass = result.score >= state.threshold;

  $("result").classList.add("show");
  $("verdict").textContent = pass ? "통과" : "다시 연습";
  $("verdict").className = `verdict ${pass ? "pass" : "fail"}`;
  $("verdictSub").textContent = pass
    ? `인식률 ${result.score}%. 목표 소리와 가깝게 읽었습니다.`
    : `인식률 ${result.score}%. ${state.threshold}% 이상이 필요합니다. 표시된 소리를 다시 읽어 보세요.`;
  paintDiff(result.marks);
  animateGauge(result.score, pass);
  window.setTimeout(() => {
    speak(pass ? `인식률 ${result.score}퍼센트, 통과입니다.` : `인식률 ${result.score}퍼센트, 다시 연습하세요.`, "ko-KR");
  }, 280);

  const record = {
    number: state.number,
    name: state.name,
    phrase: targetLabel(),
    heard: heardText,
    score: result.score,
    pass,
    threshold: state.threshold,
    time: new Date().toISOString(),
  };
  const records = loadRecords();
  records.push(record);
  saveRecords(records);
  sendRecord(record);
  $("result").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function sendRecord(record) {
  if (!APP.collectUrl) return;
  fetch(APP.collectUrl, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(record),
  }).catch(() => {});
}

function stopRecordingUi() {
  state.recording = false;
  window.clearTimeout(safetyTimer);
  $("micBtn").classList.remove("recording");
  if ($("micHint").textContent.startsWith("듣고")) {
    $("micHint").textContent = state.gotResult
      ? "다시 하려면 버튼을 누르세요"
      : "인식되지 않았어요. 다시 눌러 보세요";
  }
}

function startRecording() {
  if (!recognition) return;
  if (!targetReading()) {
    $("micHint").textContent = "먼저 연습할 문장을 입력해 주세요.";
    return;
  }
  resetResult();
  state.gotResult = false;
  $("practiceWarn").classList.remove("show");
  try {
    recognition.start();
    state.recording = true;
    $("micBtn").classList.add("recording");
    $("micHint").textContent = "듣고 있어요. 또박또박 읽어 보세요";
    safetyTimer = window.setTimeout(() => {
      try { recognition.stop(); } catch { /* already stopped */ }
    }, 9000);
  } catch {
    stopRecordingUi();
  }
}

function setupRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const warn = $("practiceWarn");
  if (!SpeechRecognition) {
    warn.classList.add("show");
    warn.innerHTML = "이 브라우저는 음성 인식을 지원하지 않습니다. 아이폰은 Safari, 안드로이드와 PC는 Chrome에서 여세요.";
    $("micBtn").disabled = true;
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 8;
  recognition.onresult = (event) => {
    state.gotResult = true;
    const result = event.results[event.results.length - 1];
    let bestText = "";
    let bestScore = -1;
    const ruby = state.custom ? "" : currentPhrase().ruby;
    for (let i = 0; i < result.length; i += 1) {
      const transcript = (result[i].transcript || "").trim();
      if (!transcript) continue;
      const score = assess(targetReading(), transcript, ruby).score;
      if (score > bestScore) {
        bestScore = score;
        bestText = transcript;
      }
    }
    if (!bestText) bestText = (result[0].transcript || "").trim();
    showHeard(bestText);
    grade(bestText);
  };
  recognition.onerror = (event) => {
    stopRecordingUi();
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      warn.classList.add("show");
      warn.textContent = "마이크 권한이 막혀 있습니다. 브라우저 설정에서 마이크를 허용한 뒤 다시 시도해 주세요.";
    } else if (event.error === "no-speech") {
      $("micHint").textContent = "소리가 들리지 않았어요. 다시 시도해 주세요.";
    } else if (event.error !== "aborted") {
      $("micHint").textContent = "인식을 끝내지 못했습니다. 다시 눌러 보세요.";
    }
  };
  recognition.onend = () => {
    if (state.recording) stopRecordingUi();
  };
}

function formatTime(iso) {
  const date = new Date(iso);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderRecords() {
  const records = loadRecords();
  const summary = $("summary");
  const log = $("log");
  summary.replaceChildren();
  log.replaceChildren();

  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "아직 기록이 없습니다.";
    summary.append(empty);
    log.append(empty.cloneNode(true));
    return;
  }

  const groups = new Map();
  records.forEach((record) => {
    const key = `${record.number}|${record.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });

  groups.forEach((list) => {
    const average = Math.round(list.reduce((sum, record) => sum + record.score, 0) / list.length);
    const passes = list.filter((record) => record.pass).length;
    const row = document.createElement("div");
    row.className = "sum-row";
    const info = document.createElement("div");
    const name = document.createElement("div");
    name.textContent = `${list[0].number} ${list[0].name}`;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `시도 ${list.length}회 · 통과 ${passes}회`;
    info.append(name, meta);
    const avg = document.createElement("div");
    avg.className = `avg ${average >= state.threshold ? "pass-text" : "fail-text"}`;
    avg.textContent = `${average}%`;
    row.append(info, avg);
    summary.append(row);
  });

  records.slice().reverse().forEach((record) => {
    const item = document.createElement("div");
    item.className = "log-item";
    const badge = document.createElement("div");
    badge.className = `badge ${record.pass ? "p" : "f"}`;
    badge.textContent = record.pass ? "✓" : "×";
    const info = document.createElement("div");
    info.className = "info";
    const title = document.createElement("b");
    title.textContent = `${record.number} ${record.name}`;
    info.append(title, document.createTextNode(` · ${record.phrase}`));
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = formatTime(record.time);
    info.append(meta);
    const score = document.createElement("div");
    score.className = `sc ${record.pass ? "pass-text" : "fail-text"}`;
    score.textContent = `${record.score}%`;
    item.append(badge, info, score);
    log.append(item);
  });
}

function renderGrowth() {
  const mine = loadRecords()
    .filter((record) => record.number === state.number && record.name === state.name)
    .sort((a, b) => new Date(a.time) - new Date(b.time));
  $("growthName").textContent = mine.length
    ? `${state.number} ${state.name} · ${mine.length}회`
    : `${state.number} ${state.name}`;

  const chart = $("growthChart");
  const stats = $("growthStats");
  stats.replaceChildren();
  if (!mine.length) {
    chart.innerHTML = '<text x="160" y="96" text-anchor="middle" fill="#6f6458" font-size="13">아직 연습 기록이 없습니다.</text>';
    return;
  }

  const recent = mine.slice(-40);
  const width = 320;
  const height = 180;
  const pad = { l: 32, r: 12, t: 14, b: 22 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const xAt = (index) => (recent.length === 1
    ? pad.l + innerW / 2
    : pad.l + (innerW * index) / (recent.length - 1));
  const yAt = (score) => pad.t + innerH * (1 - score / 100);
  const passLine = recent[recent.length - 1].threshold || state.threshold;

  const parts = [];
  [0, 50, 100].forEach((value) => {
    const y = yAt(value);
    parts.push(`<line x1="${pad.l}" y1="${y}" x2="${width - pad.r}" y2="${y}" stroke="#eadfce"/>`);
    parts.push(`<text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" fill="#8a7d6e" font-size="9">${value}</text>`);
  });
  const passY = yAt(passLine);
  parts.push(`<line x1="${pad.l}" y1="${passY}" x2="${width - pad.r}" y2="${passY}" stroke="#b7c4a4" stroke-dasharray="4 3"/>`);
  if (recent.length > 1) {
    const path = recent.map((record, index) => `${index ? "L" : "M"}${xAt(index).toFixed(1)} ${yAt(record.score).toFixed(1)}`).join(" ");
    parts.push(`<path d="${path}" fill="none" stroke="#c4552a" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);
  }
  recent.forEach((record, index) => {
    const color = record.pass ? "#1d7a46" : "#c44536";
    parts.push(`<circle cx="${xAt(index).toFixed(1)}" cy="${yAt(record.score).toFixed(1)}" r="3.4" fill="${color}" stroke="#fffdf8" stroke-width="1.4"/>`);
  });
  chart.innerHTML = parts.join("");

  const scores = mine.map((record) => record.score);
  const last = scores[scores.length - 1];
  const best = Math.max(...scores);
  const average = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
  let trend = "–";
  let trendClass = "";
  if (scores.length >= 2) {
    const delta = last - scores[scores.length - 2];
    if (delta > 0) {
      trend = `▲ ${delta}`;
      trendClass = "up";
    } else if (delta < 0) {
      trend = `▼ ${Math.abs(delta)}`;
      trendClass = "down";
    }
  }

  [
    [`${last}%`, "최근"],
    [`${best}%`, "최고"],
    [`${average}%`, "평균"],
    [trend, "직전 대비"],
  ].forEach(([value, label], index) => {
    const card = document.createElement("div");
    const strong = document.createElement("b");
    strong.textContent = value;
    if (index === 3 && trendClass) strong.className = trendClass;
    const caption = document.createElement("span");
    caption.textContent = label;
    card.append(strong, caption);
    stats.append(card);
  });
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportCsv() {
  const records = loadRecords();
  if (!records.length) {
    window.alert("내보낼 기록이 없습니다.");
    return;
  }
  const lines = ["\uFEFF학번,이름,문장,인식된 발음,점수,통과,기준,시각"];
  records.forEach((record) => {
    lines.push([
      csvCell(record.number),
      csvCell(record.name),
      csvCell(record.phrase),
      csvCell(record.heard),
      record.score,
      record.pass ? "통과" : "재연습",
      record.threshold,
      csvCell(new Date(record.time).toLocaleString("ko-KR")),
    ].join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "토비이시_발음기록.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function rememberProfile() {
  localStorage.setItem(PROFILE_KEY, JSON.stringify({
    number: state.number,
    name: state.name,
  }));
}

function restoreProfile() {
  try {
    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
    if (profile.number) $("numberInput").value = profile.number;
    if (profile.name) $("nameInput").value = profile.name;
  } catch { /* 저장된 프로필이 없으면 빈 칸 */ }
}

function deviceNote() {
  const ua = navigator.userAgent;
  const note = $("deviceNote");
  const inApp = /KAKAOTALK|Instagram|FBAN|FBAV|Line\//i.test(ua);
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  if (inApp) {
    note.className = "banner err show";
    note.textContent = "앱 안 브라우저에서는 마이크가 막힐 수 있습니다. Safari 또는 Chrome에서 이 주소를 다시 여세요.";
  } else if (ios) {
    note.className = "banner info show";
    note.textContent = "아이폰은 Safari에서 열어야 마이크가 동작합니다.";
  } else if (android) {
    note.className = "banner info show";
    note.textContent = "안드로이드는 Chrome에서 열고 마이크를 허용해 주세요.";
  }
}

function fillIdentity() {
  $("mark").textContent = APP.mark;
  $("appName").textContent = APP.name;
  document.title = `${APP.name} — 일본어 발음 연습`;
  $("officerName").textContent = APP.officer;
  $("officerContact").textContent = APP.contact;
  $("officerOrg").textContent = APP.org;
  $("headThreshold").textContent = String(state.threshold);
  $("threshold").value = String(state.threshold);
  $("thresholdVal").textContent = String(state.threshold);
}

async function loadRemotePhrases() {
  if (!APP.collectUrl) return;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${APP.collectUrl}?action=sentences`, { signal: controller.signal });
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data) || !data.length) return;
    const usable = data.every((item) => item && typeof item.ruby === "string" && item.ruby.trim());
    if (!usable) return;
    state.phrases = data.map((item) => ({
      tag: String(item.tag || "연습").trim(),
      kor: String(item.kor || "").trim(),
      ruby: String(item.ruby).trim(),
    }));
    state.category = groupedCategories()[0] || "연습";
    state.phraseIndex = 0;
    renderPractice();
  } catch {
    /* 시트를 못 읽으면 기본 문장으로 연습합니다. */
  } finally {
    window.clearTimeout(timer);
  }
}

function enterPractice() {
  $("whoName").textContent = `${state.number} ${state.name}`;
  rememberProfile();
  show("practiceView");
}

function bind() {
  $("startForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const number = $("numberInput").value.trim();
    const name = $("nameInput").value.trim();
    const warn = $("startWarn");
    if (!$("consentCheck").checked) {
      warn.textContent = "개인정보 안내에 동의해야 시작할 수 있습니다.";
      return;
    }
    if (!number) {
      warn.textContent = "학번을 입력해 주세요.";
      $("numberInput").focus();
      return;
    }
    if (!name) {
      warn.textContent = "이름을 입력해 주세요.";
      $("nameInput").focus();
      return;
    }
    warn.textContent = "";
    state.number = number;
    state.name = name;
    enterPractice();
  });

  $("editBtn").addEventListener("click", () => {
    $("numberInput").value = state.number;
    $("nameInput").value = state.name;
    $("consentCheck").checked = true;
    show("startView");
  });
  $("recordBtn").addEventListener("click", () => {
    renderRecords();
    show("recordView");
  });
  $("recordBack").addEventListener("click", () => show("practiceView"));
  $("growthBtn").addEventListener("click", () => {
    renderGrowth();
    show("growthView");
  });
  $("growthBack").addEventListener("click", () => show("practiceView"));
  $("retryBtn").addEventListener("click", () => {
    resetResult();
    $("micHint").textContent = "버튼을 누르고 다시 읽어 보세요";
    $("micBtn").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("listenBtn").addEventListener("click", () => {
    const text = rubyReading(targetRuby()) || targetReading();
    speak(text, "ja-JP");
  });
  $("micBtn").addEventListener("click", () => {
    if (!recognition) return;
    if (state.recording) {
      try { recognition.stop(); } catch { /* already stopped */ }
      stopRecordingUi();
      return;
    }
    startRecording();
  });
  $("threshold").addEventListener("input", () => {
    state.threshold = Number($("threshold").value);
    $("thresholdVal").textContent = String(state.threshold);
    $("headThreshold").textContent = String(state.threshold);
  });
  $("clearBtn").addEventListener("click", () => {
    if (!window.confirm("이 브라우저에 저장된 연습 기록을 모두 지울까요?")) return;
    saveRecords([]);
    renderRecords();
  });
  $("exportBtn").addEventListener("click", exportCsv);
}

fillIdentity();
deviceNote();
restoreProfile();
state.category = groupedCategories()[0] || "연습";
renderPractice();
setupRecognition();
bind();
if (window.speechSynthesis) {
  pickJapaneseVoice();
  window.speechSynthesis.addEventListener("voiceschanged", pickJapaneseVoice);
}
loadRemotePhrases();
