/** @OnlyCurrentDoc */
function setup() {
 var p=PropertiesService.getScriptProperties();
 if(!p.getProperty("SYNC_TOKEN")) p.setProperty("SYNC_TOKEN",Utilities.getUuid()+Utilities.getUuid());
 SpreadsheetApp.getActiveSpreadsheet().getSheetByName("학습기록").setFrozenRows(1);
}
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var data = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('SYNC_TOKEN');
    if (!secret || data.token !== secret) return json_({ok:false,error:'unauthorized'});
    var r = data.record;
    if (!r || !/^[a-f0-9-]{36}$/.test(r.id) || typeof r.number !== 'string' || typeof r.name !== 'string' || typeof r.target !== 'string' || typeof r.heard !== 'string' || (r.score !== null && (!Number.isFinite(r.score) || r.score<0 || r.score>100))) return json_({ok:false,error:'invalid record'});
    lock.waitLock(20000);
    var book = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = book.getSheetByName('학습기록') || book.insertSheet('학습기록');
    if (!sheet.getLastRow()) {
      sheet.appendRow(['기록 ID','학급 ID','학급','학번','이름','연습 ID','목표 글자','인식된 발음','인식률 (%)','판정','통과 기준 (%)','학습 시각 (UTC)']);
      sheet.setFrozenRows(1);
    }
    if (sheet.getLastRow()>1 && sheet.getRange(2,1,sheet.getLastRow()-1,1).createTextFinder(r.id).matchEntireCell(true).findNext()) return json_({ok:true,id:r.id});
    var safe = function(v) { var text=String(v == null ? '' : v); return /^[\s]*[=+\-@]/.test(text) ? "'"+text : text; };
    var values = [r.id,r.classId,r.className,r.number,r.name,r.lesson,r.target,r.heard].map(safe);
    values.push(r.score === null ? '' : r.score, r.score === null ? '판정 대기' : r.score>=70 ? '통과' : '재연습',70,safe(r.at));
    var target=sheet.getRange(sheet.getLastRow()+1,1,1,12);
    target.setNumberFormat('@'); target.setValues([values]);
    sheet.getRange(target.getRow(),9).setNumberFormat('0');
    sheet.getRange(target.getRow(),11).setNumberFormat('0');
    SpreadsheetApp.flush();
    return json_({ok:true,id:r.id});
  } catch (error) { return json_({ok:false,error:'sync failed'}); }
  finally { if (lock.hasLock()) lock.releaseLock(); }
}

function doGet(e) {
  var action = e && e.parameter ? e.parameter.action : "";
  if (action !== "sentences") {
    return json_({ ok: true });
  }

  var sheet = SpreadsheetApp.getActive().getSheetByName("문장");
  if (!sheet || sheet.getLastRow() < 2) return json_([]);

  var rows = sheet.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < rows.length; i += 1) {
    var tag = String(rows[i][0] || "").trim();
    var kor = String(rows[i][1] || "").trim();
    var ruby = String(rows[i][2] || "").trim();
    if (!ruby) continue;
    items.push({ tag: tag || "연습", kor: kor, ruby: ruby });
  }
  return json_(items);
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
