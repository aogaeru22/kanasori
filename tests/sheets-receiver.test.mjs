import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('Google receiver authenticates, deduplicates retries and escapes formulas',()=>{
 const rows=[['headers']];let held=false;
 const sheet={getLastRow:()=>rows.length,getRange:(row,col)=>({
  createTextFinder:id=>({matchEntireCell(){return this;},findNext:()=>rows.slice(1).find(r=>r[0]===id)}),
  setNumberFormat(){return this;},setValues(values){rows[row-1]=values[0];},getRow:()=>row
 })};
 const context={PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'secret'})},
 LockService:{getScriptLock:()=>({waitLock(){held=true;},hasLock:()=>held,releaseLock(){held=false;}})},
 SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:()=>sheet}),flush(){}},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:value=>({setMimeType:()=>value})}};
 vm.createContext(context);vm.runInContext(readFileSync('gas/Code.gs','utf8'),context);
 const record={id:'12345678-1234-1234-1234-123456789abc',classId:'class-301',className:'3학년 1반',number:'30101',name:'=1+1',lesson:'a',target:'あ',heard:'あ',score:70,at:'2026-09-26T00:00:00Z'};
 const send=token=>JSON.parse(context.doPost({postData:{contents:JSON.stringify({token,record})}}));
 assert.equal(send('wrong').ok,false);assert.equal(rows.length,1);
 assert.equal(send('secret').ok,true);assert.equal(rows.length,2);assert.equal(rows[1][4],"'=1+1");assert.equal(rows[1][9],'통과');
 assert.equal(send('secret').ok,true);assert.equal(rows.length,2);assert.equal(held,false);
});
