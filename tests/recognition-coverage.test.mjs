import test from 'node:test';
import assert from 'node:assert/strict';
import {setupPractice} from '../js/practice.js';
import {LESSONS,PASS_THRESHOLD} from '../js/lessons.js';
import {WORD_TARGETS,wordTarget} from '../js/word-targets.js';
import {assess} from '../js/score.js';
import {expandLongVowels} from '../js/kana.js';

test('all 10 rows and 46 words capture final/interim speech, retry, and use 70 percent',async t=>{
 const previous={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};
 t.after(()=>Object.assign(globalThis,previous));
 const element=()=>({disabled:false,hidden:true,textContent:'',className:'',classList:{add(){},remove(){}},style:{setProperty(){}},setAttribute(){},append(){},replaceChildren(){}});
 const els=new Map();
 globalThis.document={getElementById(id){if(!els.has(id))els.set(id,element());return els.get(id);},querySelectorAll(){return [];},createElement:element,body:element()};
 const el=id=>document.getElementById(id);
 let instance,captures=0,selected;
 class Recognition{constructor(){instance=this;}start(){this.onstart();}stop(){queueMicrotask(()=>this.onend());}abort(){this.onend();}}
 globalThis.window={SpeechRecognition:Recognition,addEventListener(){},navigator:{mediaDevices:{getUserMedia(){captures++;throw new Error('Do not open a second input');}}}};
 const saved=[];
 globalThis.fetch=async(path,options)=>{
   if(path==='/api/me')return Response.json({role:'student',number:'test',name:'테스트'});
   const data=JSON.parse(options.body);
   if(path==='/api/reading')return Response.json({reading:expandLongVowels(data.heard,selected.reading)});
   saved.push(data);const result=assess(selected.reading,data.heard);
   return Response.json({...result,passed:Number(result.score>=PASS_THRESHOLD)});
 };
 const flush=async()=>{await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));};
 assert.equal(PASS_THRESHOLD,70);
 t.mock.timers.enable({apis:['setTimeout']});
 for(const singleWord of [false,true]){
   const targets=singleWord?Object.entries(WORD_TARGETS).flatMap(([id,words])=>words.map((_,i)=>wordTarget(id,i))):LESSONS;
   assert.equal(targets.length,singleWord?46:10);
   const practice=setupPractice(()=>selected,{singleWord});await flush();
   for(const target of targets){
     selected=target;el('micBtn').onclick();
     assert.equal(instance.continuous,true);assert.equal(instance.interimResults,true);assert.equal(instance.maxAlternatives,1);
     const interim=Object.assign([{transcript:target.reading}],{isFinal:false});
     const count=saved.length;instance.onresult({results:[interim]});
     assert.equal(saved.length,count);assert.equal(practice.busy,true);
     instance.onresult({results:[Object.assign([{transcript:target.reading}],{isFinal:true})]});
     if(!singleWord)el('micBtn').onclick();await flush();
     assert.equal(saved.length,count+1);assert.equal(saved.at(-1).lesson,target.id);
     assert.equal(el('scoreNum').textContent,'100%');assert.equal(practice.busy,false);
     if(singleWord){
       // Speech-end without a transcript must not stop a short word before
       // the recognition service has delivered its delayed result.
       el('micBtn').onclick();instance.onspeechend();t.mock.timers.tick(2600);await flush();
       assert.equal(practice.busy,true,target.reading+' ended before text arrived');
       const before=saved.length;
       instance.onresult({results:[Object.assign([{transcript:target.reading,confidence:0.2}],{isFinal:false})]});
       instance.onresult({results:[]}); // Engine retracts its interim on silence.
       t.mock.timers.tick(2500);await flush();
       assert.equal(saved.length,before+1,target.reading+' interim result was lost');
       assert.equal(saved.at(-1).heard,target.reading);
       assert.equal(el('scoreNum').textContent,'100%');assert.equal(practice.busy,false);
     }
   }
   practice.clear();
 }
 const practice=setupPractice(()=>selected,{singleWord:true});await flush();selected=wordTarget('a',2);
 assert.equal(selected.reading,'え');el('micBtn').onclick();
 instance.onresult({results:[Object.assign([{transcript:'え'}],{isFinal:false})]});
 instance.onend();await flush();assert.equal(saved.at(-1).heard,'え');assert.equal(practice.busy,false);
 // A later final result replaces the interim rather than being duplicated.
 el('micBtn').onclick();instance.onresult({results:[Object.assign([{transcript:'え'}],{isFinal:false})]});
 instance.onresult({results:[Object.assign([{transcript:'ひ'},{transcript:'え'}],{isFinal:true})]});
 await flush();assert.equal(saved.at(-1).heard,'ひ');assert.equal(el('scoreNum').textContent,'0%');
 const count=saved.length;el('micBtn').onclick();instance.onerror({error:'no-speech'});await flush();assert.equal(saved.length,count);assert.equal(practice.busy,false);
 el('micBtn').onclick();instance.onerror({error:'not-allowed'});await flush();assert.match(el('micHint').textContent,/허용/);assert.equal(practice.busy,false);
 for(const [heard,score,pass] of [['あいうえおかきさささ',70,true],['あいうえおかささささ',60,false]]){
   selected={id:'boundary',reading:'あいうえおかきくけこ'};el('micBtn').onclick();instance.onresult({results:[Object.assign([{transcript:heard}],{isFinal:true})]});await flush();
   assert.equal(el('scoreNum').textContent,score+'%');assert.equal(el('scoreVerdict').textContent,pass?'✓ 통과!':'✕ 다시 연습');
 }
 // Changing words cancels the old recorder and ignores its late events.
 selected=wordTarget('a',2);el('micBtn').onclick();const previousRecognition=instance;
 instance.onresult({results:[Object.assign([{transcript:'絵'}],{isFinal:false})]});
 assert.equal(el('heardText').textContent,'');assert.equal(el('heardBox').hidden,true);
 const savedBeforeSwitch=saved.length;
 assert.equal(practice.changeSelection(),true);selected=wordTarget('a',1);
 assert.equal(practice.busy,false);assert.equal(el('micBtn').disabled,false);
 previousRecognition.onresult({results:[Object.assign([{transcript:'え'}],{isFinal:true})]});
 previousRecognition.onend();await flush();assert.equal(saved.length,savedBeforeSwitch);
 el('micBtn').onclick();
 instance.onresult({results:[Object.assign([{transcript:'オーイ'}],{isFinal:false})]});
 assert.equal(el('heardText').textContent,'おおい');
 instance.onresult({results:[Object.assign([{transcript:'おーい'}],{isFinal:true})]});
 await flush();assert.equal(el('scoreNum').textContent,'100%');
 assert.equal(captures,0);practice.clear();
});
