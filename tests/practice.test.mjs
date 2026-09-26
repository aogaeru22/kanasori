import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPractice, perfectPraise } from '../js/practice.js';
import { wordTarget } from '../js/word-targets.js';
import { assess } from '../js/score.js';
import { recognizedHiragana } from '../server/hiragana.mjs';

test('recognition captures its lesson, retries one result, and never sends audio', async t => {
  const previous = { window:globalThis.window, document:globalThis.document, fetch:globalThis.fetch };
  t.after(() => Object.assign(globalThis,previous));
  const makeElement = () => ({ parentElement:{append(){}}, pause(){}, removeAttribute(){}, disabled:false, hidden:true, textContent:'', className:'', classList:{ add(){},remove(){} }, style:{setProperty(){}}, setAttribute(){}, append(){}, replaceChildren(){} });
  const elements = new Map(); const tabs = [makeElement(),makeElement()];
  globalThis.document = { getElementById(id) { if (!elements.has(id)) elements.set(id,makeElement()); return elements.get(id); }, querySelectorAll(){return tabs;}, createElement:makeElement, body:makeElement() };
  const el = id => document.getElementById(id);
  let instance;
  class Recognition {
    constructor(){instance=this;}
    start(){this.started=true;}
    stop(){queueMicrotask(()=>this.onend());}
    abort(){this.onend();}
  }
  globalThis.window = { SpeechRecognition:Recognition, addEventListener(){} };
  const requests = []; let fail = true;
  globalThis.fetch = async (path, options) => {
    if (path === '/api/me') return Response.json({role:'student',number:'1',name:'테스트'});
    if (path === '/api/reading') return Response.json({reading:JSON.parse(options.body).heard});
    const data = JSON.parse(options.body); requests.push(data);
    if (fail) return Response.json({error:'연결 실패'},{status:503});
    return Response.json({score:100,passed:1,id:data.id});
  };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  let row = {id:'a',reading:'あいうえお'};
  const practice = setupPractice(()=>row);
  await flush();
  assert.equal(el('micBtn').disabled,false);
  practice.clear();
  assert.equal(el('micHint').textContent, '버튼을 누르고 가나를 읽어 보세요.');
  el('micBtn').onclick();
  assert.equal(practice.busy,true); assert.ok(tabs.every(tab => tab.disabled));
  row = {id:'ka',reading:'かきくけこ'}; // Even if another UI changes, the attempt retains its starting target.
  instance.onresult({results:[[{transcript:'あいうえお'},{transcript:'あ'}]]});
  assert.equal(requests.length,0); // Recognition results alone must not stop a recording.
  el('micBtn').onclick();
  await flush(); await flush();
  assert.equal(requests.length,1); assert.equal(requests[0].lesson,'a');
  assert.deepEqual(Object.keys(requests[0]).sort(),['heard','id','lesson']);
  assert.equal(el('saveRetry').hidden,false); assert.equal(practice.busy,true);
  fail = false; await el('saveRetry').onclick();
  assert.equal(requests.length,2); assert.equal(requests[0].id,requests[1].id);
  assert.equal(practice.busy,false); assert.match(el('saveStatus').textContent,/저장 완료/);
  assert.match(el('micHint').textContent,/다시 하려면/);
  assert.ok(tabs.every(tab => !tab.disabled));
  el('micBtn').onclick(); instance.onerror({error:'no-speech'}); await flush();
  assert.equal(requests.length,2); assert.equal(practice.busy,false); assert.match(el('micHint').textContent,/소리가/);
  window.navigator = {mediaDevices:{async getUserMedia(){throw Object.assign(new Error(),{name:'NotAllowedError'});}}};
  el('micBtn').onclick();
  assert.equal(instance.started,true); // Must start synchronously in the button gesture.
  instance.onerror({error:'not-allowed'});
  assert.equal(practice.busy,false); assert.match(el('micHint').textContent,/허용/);
  let released = false;
  window.AudioContext = class {
    async resume() {} async close() {}
    createMediaStreamSource(){return {connect(){},disconnect(){}};}
    createAnalyser(){return {fftSize:2048,getFloatTimeDomainData(samples){samples.fill(0);},disconnect(){}};}
  };
  window.navigator.mediaDevices.getUserMedia = async () => ({getTracks:()=>[{stop(){released=true;}}]});
  el('micBtn').onclick(); await flush();
  assert.equal(released,false); assert.match(el('micHint').textContent,/연결하고/);
  instance.onstart();
  await flush();
  assert.match(el('micHint').textContent,/듣고 있어요/);
  instance.onerror({error:'no-speech'});
  assert.equal(released,false); assert.equal(practice.busy,false); // No competing microphone stream is opened.
});

test('selected words immediately show feedback and mismatches without audio playback', async t => {
  const previous = {window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};
  t.after(()=>Object.assign(globalThis,previous));
  const makeElement = () => ({children:[],disabled:false,hidden:true,textContent:'',className:'',classList:{add(){},remove(){}},style:{setProperty(){}},setAttribute(){},append(child){this.children.push(child);},replaceChildren(){this.children=[];}});
  const elements = new Map();
  const created = [];
  globalThis.document = {getElementById(id){if(!elements.has(id))elements.set(id,makeElement());return elements.get(id);},querySelectorAll(){return [];},createElement(tag){created.push(tag);return makeElement();},body:makeElement()};
  const el=id=>document.getElementById(id);
  let instance;
  class Recognition {constructor(){instance=this;}start(){}stop(){queueMicrotask(()=>this.onend());}}
  globalThis.window={SpeechRecognition:Recognition,addEventListener(){}};
  let target=wordTarget('ta',1);
  const requests=[];
  globalThis.fetch=async(path,options)=>{
    if(path==='/api/me')return Response.json({role:'student',number:'test',name:'가상 테스트'});
    if(path==='/api/reading')return Response.json({reading:await recognizedHiragana(JSON.parse(options.body).heard,wordTarget('ta',1))});
    const data=JSON.parse(options.body);requests.push(data);
    const word=wordTarget('ta',1);
    const result=assess(word.reading,data.heard,word.ruby);
    return Response.json({...result,passed:result.score>=70});
  };
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  const practice=setupPractice(()=>target,{singleWord:true});await flush();
  for(const [heard,score,badCount] of [['地下鉄',100,0],['ああああ',0,4],['ちかてす',89,1]]){
    target=wordTarget('ta',1);
    el('micBtn').onclick();
    target=wordTarget('na',0); // Evaluation must retain the word selected at start.
    instance.onresult({results:[[{transcript:heard}]]});
    await flush();await flush();
    assert.equal(practice.busy,false);
    assert.equal(requests.at(-1).lesson,'ta-word-1');
    assert.equal(el('scoreNum').textContent,`${score}%`);
    assert.match(el('heardText').textContent,/^[ぁ-ゖ]+$/);
    if(heard==='地下鉄')assert.equal(el('heardText').textContent,'ちかてつ');
    if (score === 100) assert.ok(perfectPraise.some(line => el('verdictSub').textContent.endsWith(line)));
    else assert.match(el('verdictSub').textContent, score === 0 ? /70% 이상/ : /잘했어요/);
    assert.equal(el('diffLine').children.filter(child=>child.className==='bad').length,badCount);
    assert.equal(el('diffLine').children.slice(1).map(child=>child.textContent).join(''),'ちかてつ');
    const previousInstance=instance;
    el('retryBtn').onclick();
    assert.equal(instance,previousInstance);
    assert.equal(el('heardBox').hidden,true);
    assert.equal(el('heardText').textContent,'');
    assert.match(el('micHint').textContent,/버튼을 누르고 다시/);
  }
  assert.ok(!created.includes('audio'));
});
