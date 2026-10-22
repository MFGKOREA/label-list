// 한글표시사항 리스트 — Google Apps Script 백엔드
// 데이터는 스프레드시트의 "목록" 시트에 저장됩니다.
// 시트에서 연 스크립트면 그 시트를, script.google.com에서 바로 만든 스크립트면
// 처음 실행할 때 내 드라이브에 "한글표시사항 리스트" 시트를 새로 만들어 씁니다.

const SHEET_NAME = '목록';
const HEAD = ['id', 'name', 'memo', 'mode', 'expiry', 'mfg', 'num', 'unit', 'updatedAt'];
const DEFAULT_STORE = 'suwon'; // 기존 "목록" 탭을 쓰는 매장. 다른 매장은 "목록_매장코드" 탭에 저장

// 매장 코드는 영문 소문자·숫자만 받습니다.
function store_(s) {
  s = String(s || DEFAULT_STORE);
  if (!/^[a-z0-9]{1,20}$/.test(s)) throw new Error('매장 코드가 올바르지 않습니다');
  return s;
}

// ?api=1 이면 목록을 JSON으로, 아니면 기존 화면(Index.html)을 보여 줍니다.
function doGet(e) {
  if (e && e.parameter && e.parameter.api) {
    try {
      const store = store_(e.parameter.store);
      // sid가 오면: 접속 중 인원을 세고, 바뀐 게 없으면 목록 없이 짧게 답함
      if (e.parameter.sid) {
        const online = ping_(store, String(e.parameter.sid).slice(0, 40));
        const ver = ver_(store);
        if (e.parameter.v && e.parameter.v === ver) return json_({ same: true, ver: ver, online: online });
        return json_({ items: listItems(store), ver: ver, online: online });
      }
      return json_(listItems(store));
    }
    catch (err) { return json_({ error: String(err) }); }
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('한글표시사항 리스트')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// GitHub Pages 화면에서 보내는 저장·삭제 요청
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const store = store_(body.store);
    if (body.action === 'save') return json_(saveItem(clean_(body.item), store));
    if (body.action === 'delete') return json_(deleteItem(String(body.id).slice(0, 40), store));
    if (body.action === 'clear') return json_(clearItems(store));
    return json_(listItems(store));
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// 정해진 칸만, 적당한 길이로 받아 저장합니다.
function clean_(it) {
  const out = {};
  HEAD.forEach((h) => { out[h] = it && it[h] !== undefined ? String(it[h]).slice(0, 200) : ''; });
  if (!out.id) throw new Error('id 없음');
  return out;
}

function spreadsheet_() {
  const active = SpreadsheetApp.getActive();
  if (active) return active;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create('한글표시사항 리스트');
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function sheet_(store) {
  const ss = spreadsheet_();
  const name = !store || store === DEFAULT_STORE ? SHEET_NAME : SHEET_NAME + '_' + store;
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange('A:I').setNumberFormat('@'); // 날짜가 자동 변환되지 않게 텍스트로 저장
    sh.appendRow(HEAD);
    sh.setFrozenRows(1);
  }
  return sh;
}

function cell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}

function listItems(store) {
  const values = sheet_(store).getDataRange().getValues();
  values.shift();
  return values.filter((r) => r[0]).map((r) => {
    const it = {};
    HEAD.forEach((h, i) => { it[h] = cell_(r[i]); });
    it.num = Number(it.num) || 0;
    it.updatedAt = Number(it.updatedAt) || 0;
    return it;
  });
}

function saveItem(it, store) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_(store);
    const row = HEAD.map((h) => cell_(it[h]));
    const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map((r) => String(r[0]));
    const at = ids.indexOf(String(it.id));
    if (at > 0) sh.getRange(at + 1, 1, 1, HEAD.length).setValues([row]);
    else sh.appendRow(row);
    bump_(store);
  } finally {
    lock.releaseLock();
  }
  return listItems(store);
}

function deleteItem(id, store) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_(store);
    const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map((r) => String(r[0]));
    const at = ids.indexOf(String(id));
    if (at > 0) sh.deleteRow(at + 1);
    bump_(store);
  } finally {
    lock.releaseLock();
  }
  return listItems(store);
}

// 매장 품목 전체 초기화: 머리글(1행)만 남기고 내용을 지웁니다.
function clearItems(store) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_(store);
    const last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
    bump_(store);
  } finally {
    lock.releaseLock();
  }
  return listItems(store);
}

// ---- 접속 중 인원 · 변경 버전 (시트를 읽지 않고 캐시로 빠르게) ----
const ONLINE_SEC = 15; // 마지막 확인 후 15초 안이면 접속 중으로 셈

function ping_(store, sid) {
  const cache = CacheService.getScriptCache();
  const key = 'on_' + store;
  let map = {};
  try { map = JSON.parse(cache.get(key) || '{}'); } catch (err) { map = {}; }
  const now = Date.now();
  map[sid] = now;
  Object.keys(map).forEach((k) => { if (now - map[k] > ONLINE_SEC * 1000) delete map[k]; });
  cache.put(key, JSON.stringify(map), 120);
  return Object.keys(map).length;
}

function ver_(store) {
  const cache = CacheService.getScriptCache();
  let v = cache.get('ver_' + store);
  if (!v) { v = newVer_(); cache.put('ver_' + store, v, 21600); }
  return v;
}

function bump_(store) {
  CacheService.getScriptCache().put('ver_' + (store || DEFAULT_STORE), newVer_(), 21600);
}

// 같은 순간에 두 번 바뀌어도 겹치지 않게 시각 + 무작위
function newVer_() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
