/**
 * 발주량·프랩량 계산기 저장소 (Google Apps Script 웹앱)
 *
 * 시트 "kv" 한 장에 키별 JSON 값을 저장합니다. 셀 하나에 5만 자까지만 들어가므로
 * 긴 값(레시피 등)은 여러 줄로 나눠 저장하고, 읽을 때 다시 합칩니다.
 *
 *   GET  ?api=1                      → { key: value, ... } 전체
 *   POST {action:"set", key, value}  → 해당 키 저장 (value가 null이면 삭제)
 *   POST {action:"append", key, item} → 배열 값 끝에 item 추가 (재고 입력 기록용)
 *
 * 응답은 항상 { ok: true, data: {...} } 또는 { ok: false, error: "..." } 입니다.
 */

const SHEET = "kv";
const CHUNK = 45000;

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.getRange(1, 1, 1, 4).setValues([["key", "part", "value", "updated"]]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readAll_() {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return {};
  const rows = sh.getRange(2, 1, last - 1, 3).getValues();
  const parts = {};
  rows.forEach(([key, part, value]) => {
    if (!key) return;
    (parts[key] = parts[key] || [])[Number(part) || 0] = String(value);
  });
  const out = {};
  Object.keys(parts).forEach((key) => {
    try { out[key] = JSON.parse(parts[key].join("")); } catch (e) { /* 깨진 값은 건너뜀 */ }
  });
  return out;
}

function write_(key, value) {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last >= 2) {
    const keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = keys.length - 1; i >= 0; i--) if (keys[i][0] === key) sh.deleteRow(i + 2);
  }
  if (value === null || value === undefined) return;
  const json = JSON.stringify(value);
  const now = new Date();
  const rows = [];
  for (let i = 0, p = 0; i < json.length || p === 0; i += CHUNK, p++) rows.push([key, p, json.slice(i, i + CHUNK), now]);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (!e || !e.parameter || !e.parameter.api) return json_({ ok: true, data: {} });
  return json_({ ok: true, data: readAll_() });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === "set") {
      write_(body.key, body.value);
    } else if (body.action === "append") {
      const all = readAll_();
      const list = Array.isArray(all[body.key]) ? all[body.key] : [];
      list.push(body.item);
      write_(body.key, list);
    } else {
      return json_({ ok: false, error: "알 수 없는 요청: " + body.action });
    }
    return json_({ ok: true, data: readAll_() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
