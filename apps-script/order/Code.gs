/**
 * 발주량·프랩량 계산기 저장소 (Google Apps Script 웹앱)
 *
 * 시트 "kv" 한 장에 키별 JSON 값을 저장합니다. 셀 하나에 5만 자까지만 들어가므로
 * 긴 값(레시피 등)은 여러 줄로 나눠 저장하고, 읽을 때 다시 합칩니다.
 *
 *   GET  ?api=1                      → { key: value, ... } 전체 (버전별로 캐시해서 두 번째부터 시트를 안 읽음)
 *   POST {action:"set", key, value}  → 해당 키 저장 (value가 null이면 삭제)
 *   POST {action:"append", key, item} → 배열 값 끝에 item 추가 (재고 입력 기록용)
 *   POST {action:"merge", key, patch} → 객체 값에 바뀐 칸만 합침 (null = 지움). 두 기기가 같은 날 입력해도 서로 안 지움
 *   GET  ?api=1&backups=1            → 백업 날짜 목록
 *   GET  ?api=1&ver=1                → 마지막 저장 시각만 (앱이 10초마다 가볍게 확인하고, 바뀌었을 때만 전체를 받음)
 *   POST {action:"restore", date}    → 그 날짜 백업으로 되돌림 (되돌리기 전 상태는 "kv_되돌리기전" 탭에 남김)
 *
 * 백업: 하루 첫 저장 때 "kv" 탭을 "kv_YYYY-MM-DD" 탭으로 복사 (전날 마감 상태). 최근 14일치만 남김.
 *
 * 응답은 항상 { ok: true, data: {...} } 또는 { ok: false, error: "..." } 입니다.
 * 저장(POST) 응답의 data에는 바꾼 키 하나만 담음 (되돌리기만 전체).
 *
 * 가게 키 (잠금): 이 주소는 공개 저장소에 있어서 누구나 부를 수 있음 → 스크립트 속성 APP_KEY를 넣으면
 *   읽기·쓰기 모두 k=가게 키가 맞아야 함 (앱·PC 확장은 처음 한 번 키를 물어보고 그 기기에 저장).
 *   APP_KEY가 없으면 예전처럼 열려 있음 (교체 → 기기마다 키 넣기 → APP_KEY 넣기 순서로 끊김 없이 잠금).
 *   키 없이 되는 것: GET ?api=1&status=1 → 전송 상태만 (misPush·salesPush·misAgent의 시각·상태, 품목·수량 없음)
 *   틀린 키는 1초 늦게 답해 마구 넣어 보기를 늦춤. 오류 글에 내부 정보는 안 담음.
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

// 전체 읽기(JSON 글자)를 버전별로 캐시: 저장(bump_)하면 버전이 바뀌어 자동으로 새로 읽음. 캐시 한 칸 100KB 제한 → 3만 자씩 나눠 담음
function readAllJson_() {
  const v = ver_(), c = CacheService.getScriptCache(), n = Number(c.get("all_n_" + v)) || 0;
  if (n) {
    const names = []; for (let i = 0; i < n; i++) names.push("all_" + v + "_" + i);
    const got = c.getAll(names), parts = names.map((k) => got[k]);
    if (parts.every((x) => x != null)) return parts.join("");
  }
  const json = JSON.stringify(readAll_());
  try {
    const put = {}; let i = 0;
    for (let at = 0; at < json.length; at += 30000, i++) put["all_" + v + "_" + i] = json.slice(at, at + 30000);
    put["all_n_" + v] = String(i);
    if (i <= 40) c.putAll(put, 21600);
  } catch (err) { /* 캐시 실패해도 읽기는 됨 */ }
  return json;
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

// 시트 전체가 아니라 지정한 키의 행만 읽음 (status 폴링을 가볍게 하려고: 전송 상태 몇 개만 필요할 때 씀)
function readKeys_(keys) {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return {};
  const at = {};
  keys.forEach((k) => { at[k] = []; });
  sh.getRange(2, 1, last - 1, 1).getValues().forEach(([key], i) => { if (key && at[key]) at[key].push(i + 2); });
  const out = {};
  Object.keys(at).forEach((key) => {
    const rows = at[key];
    if (!rows.length) return;
    const first = rows[0], span = rows[rows.length - 1] - first + 1;
    const vals = sh.getRange(first, 2, span, 2).getValues(); // [part, value] (키 행은 붙어 있음)
    const parts = [];
    rows.forEach((r) => { parts[Number(vals[r - first][0]) || 0] = String(vals[r - first][1]); });
    try { out[key] = JSON.parse(parts.join("")); } catch (e) { /* 깨진 값은 건너뜀 */ }
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

// 저장할 때마다 바뀌는 버전 (시트를 읽지 않고 바로 답할 수 있게 스크립트 속성에)
function ver_() { return PropertiesService.getScriptProperties().getProperty("VER") || "0"; }
// 같은 ms에 두 번 저장돼도 버전은 꼭 바뀌게 (전체 읽기 캐시가 버전별이라)
function bump_() { const p = PropertiesService.getScriptProperties(), v = String(Math.max(Date.now(), (Number(p.getProperty("VER")) || 0) + 1)); p.setProperty("VER", v); return v; }

// ---------- 가게 키 ----------
function appKey_() { return PropertiesService.getScriptProperties().getProperty("APP_KEY") || ""; }
function authOk_(k) { const key = appKey_(); return !key || String(k || "") === key; }
function denied_() { Utilities.sleep(1000); return json_({ ok: false, auth: true, error: "가게 키가 필요해요" }); }
// 키 없이 보여 주는 전송 상태: 시각·상태·날짜만 (내용 없음). 시트 전체를 읽지 않고 상태 키 3개만 읽어 답이 빠름
function status_() {
  const all = readKeys_(["misPush", "salesPush", "misAgent"]), pick = (o, ks) => { const out = {}; if (o) ks.forEach((k) => { if (o[k] != null) out[k] = o[k]; }); return out; };
  return { misPush: pick(all.misPush, ["date", "id", "at", "status", "startAt", "doneAt", "by"]), salesPush: pick(all.salesPush, ["id", "at", "status", "startAt", "doneAt"]), misAgent: pick(all.misAgent, ["at", "mode", "grid"]) };
}
const ACTIONS_ = { set: 1, append: 1, merge: 1, restore: 1 };
const KEY_RE_ = /^[\w.\-|:가-힣 ]{1,120}$/; // 시트 키 이름: 글자·숫자·._-|: 공백만, 120자까지

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (!e || !e.parameter || !e.parameter.api) return json_({ ok: true, data: {}, locked: !!appKey_() });
  try {
    if (e.parameter.status) return json_({ ok: true, status: status_(), ver: ver_(), locked: !!appKey_() });
    if (e.parameter.ver) return json_({ ok: true, ver: ver_() });
    if (!authOk_(e.parameter.k)) return denied_();
    if (e.parameter.backups) return json_({ ok: true, data: { backups: backupList_() } });
    const v = ver_(), body = readAllJson_();
    return ContentService.createTextOutput('{"ok":true,"data":' + body + ',"ver":' + JSON.stringify(v) + "}").setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: "읽는 중 오류가 났어요" });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (!authOk_(body.k)) return denied_();
    // 입력 검사: 정해진 요청만, 키 이름 모양, 값 크기(시트 셀 나눠 담기 감안 1.5MB까지)
    if (!ACTIONS_[body.action]) return json_({ ok: false, error: "알 수 없는 요청: " + String(body.action).slice(0, 20) });
    if (body.action !== "restore" && !KEY_RE_.test(String(body.key || ""))) return json_({ ok: false, error: "키 이름이 이상해요" });
    if (JSON.stringify(body.value === undefined ? (body.patch || body.item || null) : body.value).length > 1500000) return json_({ ok: false, error: "값이 너무 커요" });
    try { backupDaily_(); } catch (err) { /* 백업 실패해도 저장은 계속 */ }
    // 저장 뒤에는 바꾼 키만 돌려줌 (예전엔 시트 전체 ~370KB를 돌려줘서 저장마다 느렸음). 되돌리기만 전체
    let out;
    if (body.action === "set") {
      write_(body.key, body.value);
      out = { [body.key]: body.value === undefined ? null : body.value };
    } else if (body.action === "append") {
      const cur = readKeys_([body.key])[body.key];
      const list = Array.isArray(cur) ? cur : [];
      list.push(body.item);
      write_(body.key, list);
      out = { [body.key]: list };
    } else if (body.action === "merge") {
      const merged = merge_(readKeys_([body.key])[body.key], body.patch || {});
      write_(body.key, merged);
      out = { [body.key]: merged };
    } else if (body.action === "restore") {
      restore_(String(body.date || ""));
      const ver = bump_();
      return json_({ ok: true, data: readAll_(), ver: ver });
    } else {
      return json_({ ok: false, error: "알 수 없는 요청: " + body.action });
    }
    return json_({ ok: true, data: out, ver: bump_() });
  } catch (err) {
    console.error(err); // 자세한 내용은 Apps Script 실행 기록에만
    return json_({ ok: false, error: "저장 중 오류가 났어요" });
  } finally {
    lock.releaseLock();
  }
}
