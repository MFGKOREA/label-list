/**
 * 발주량·프랩량 계산기 저장소 (Google Apps Script 웹앱)
 *
 * 시트 "kv" 한 장에 키별 JSON 값을 저장합니다. 셀 하나에 5만 자까지만 들어가므로
 * 긴 값(레시피 등)은 여러 줄로 나눠 저장하고, 읽을 때 다시 합칩니다.
 *
 *   GET  ?api=1                      → { key: value, ... } 전체
 *   POST {action:"set", key, value}  → 해당 키 저장 (value가 null이면 삭제)
 *   POST {action:"append", key, item} → 배열 값 끝에 item 추가 (재고 입력 기록용)
 *   POST {action:"merge", key, patch} → 객체 값에 바뀐 칸만 합침 (null = 지움). 두 기기가 같은 날 입력해도 서로 안 지움
 *   GET  ?api=1&backups=1            → 백업 날짜 목록
 *   POST {action:"restore", date}    → 그 날짜 백업으로 되돌림 (되돌리기 전 상태는 "kv_되돌리기전" 탭에 남김)
 *
 * 백업: 하루 첫 저장 때 "kv" 탭을 "kv_YYYY-MM-DD" 탭으로 복사 (전날 마감 상태). 최근 14일치만 남김.
 *
 * 응답은 항상 { ok: true, data: {...} } 또는 { ok: false, error: "..." } 입니다.
 */

const SHEET = "kv";
const CHUNK = 45000;

// 시트에서 연 스크립트면 그 시트를, script.google.com에서 따로 만든 스크립트면
// 처음 실행할 때 "발주프랩 데이터" 시트를 내 드라이브에 만들어 계속 씁니다.
function spreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("SHEET_ID");
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* 지워졌으면 새로 만듦 */ }
  }
  const ss = SpreadsheetApp.create("발주프랩 데이터");
  props.setProperty("SHEET_ID", ss.getId());
  return ss;
}

function sheet_() {
  const ss = spreadsheet_();
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

// 객체끼리는 칸별로 합치고, null이면 지움. 배열·숫자·글자는 통째로 바꿈
function isObj_(v) { return v && typeof v === "object" && !Array.isArray(v); }
function merge_(cur, patch) {
  const out = isObj_(cur) ? Object.assign({}, cur) : {};
  Object.keys(patch).forEach((k) => {
    const v = patch[k];
    if (v === null) delete out[k];
    else if (isObj_(v) && isObj_(out[k])) out[k] = merge_(out[k], v);
    else out[k] = v;
  });
  return out;
}

// ---------- 백업 ----------
const BACKUP_PREFIX = "kv_", KEEP_DAYS = 14;
const today_ = () => Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
function backupList_() {
  return spreadsheet_().getSheets().map((sh) => sh.getName()).filter((n) => /^kv_\d{4}-\d{2}-\d{2}$/.test(n)).map((n) => n.slice(3)).sort().reverse();
}
function copyKv_(name) {
  const ss = spreadsheet_(), old = ss.getSheetByName(name);
  if (old) ss.deleteSheet(old);
  const copy = sheet_().copyTo(ss).setName(name);
  copy.hideSheet();
  return copy;
}
function backupDaily_() {
  const props = PropertiesService.getScriptProperties(), day = today_();
  if (props.getProperty("LAST_BACKUP") === day) return;
  copyKv_(BACKUP_PREFIX + day);
  props.setProperty("LAST_BACKUP", day);
  const ss = spreadsheet_();
  backupList_().slice(KEEP_DAYS).forEach((d) => { const sh = ss.getSheetByName(BACKUP_PREFIX + d); if (sh) ss.deleteSheet(sh); });
}
function restore_(date) {
  const ss = spreadsheet_(), src = ss.getSheetByName(BACKUP_PREFIX + date);
  if (!src) throw new Error(date + " 백업이 없어요");
  copyKv_("kv_되돌리기전");
  const sh = sheet_(), last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, 4).clearContent();
  const n = src.getLastRow();
  if (sh.getMaxRows() < n) sh.insertRowsAfter(sh.getMaxRows(), n - sh.getMaxRows());
  if (n >= 2) sh.getRange(2, 1, n - 1, 4).setValues(src.getRange(2, 1, n - 1, 4).getValues());
  if (last > n) sh.deleteRows(n + 1, last - n);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (!e || !e.parameter || !e.parameter.api) return json_({ ok: true, data: {}, sheet: spreadsheet_().getUrl() });
  try {
    if (e.parameter.backups) return json_({ ok: true, data: { backups: backupList_() } });
    return json_({ ok: true, data: readAll_() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents);
    try { backupDaily_(); } catch (err) { /* 백업 실패해도 저장은 계속 */ }
    if (body.action === "set") {
      write_(body.key, body.value);
    } else if (body.action === "append") {
      const all = readAll_();
      const list = Array.isArray(all[body.key]) ? all[body.key] : [];
      list.push(body.item);
      write_(body.key, list);
    } else if (body.action === "merge") {
      const all = readAll_();
      write_(body.key, merge_(all[body.key], body.patch || {}));
    } else if (body.action === "restore") {
      restore_(String(body.date || ""));
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
