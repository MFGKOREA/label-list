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
      if (e.parameter.stats) return json_({ counts: stats_(), online: where_() }); // 매장 선택 화면: 매장별 품목 수·접속 중
      if (e.parameter.photos) return json_(photos_(store_(e.parameter.photos))); // 품목별 사진 (id → 드라이브 파일)
      if (e.parameter.catalog) return json_(catalog_()); // 다른 매장의 '제조일로부터' 설정
      if (e.parameter.trace) return json_({ trace: traceList_(store_(e.parameter.trace)) }); // 축산물이력제 기록 (최근 30일)
      const store = store_(e.parameter.store);
      // who(기기 임시 번호)가 오면: 접속 중 인원을 세고, 바뀐 게 없으면 목록 없이 짧게 답함
      // ※ 이름을 'sid'로 하면 구글이 요청을 막으므로 'who'를 씀
      if (e.parameter.who) {
        const online = ping_(store, String(e.parameter.who).slice(0, 40));
        // 전체 합계('all')를 셀 때 어느 매장 화면인지(from)도 같이 적어 둠
        if (store === 'all' && /^[a-z0-9]{1,20}$/.test(String(e.parameter.from || ''))) where_(String(e.parameter.who).slice(0, 40), e.parameter.from);
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
    if (body.action === 'photo') return json_(savePhoto_(store, String(body.id || '').slice(0, 40), String(body.data || ''), !!body.ocr, String(body.color || '').slice(0, 20), !!body.trace));
    if (body.action === 'trace_save') return json_({ trace: traceSave_(store, body) });
    if (body.action === 'trace_delete') return json_({ trace: traceDelete_(store, String(body.id || '').slice(0, 40)) });
    if (body.action === 'learn') return json_(learn_(store, String(body.id || '').slice(0, 40), String(body.name || '').slice(0, 80), String(body.text || '').slice(0, 3000), String(body.color || '').slice(0, 20)));
    if (body.action === 'unphoto') return json_(unPhoto_(store, String(body.id || '').slice(0, 40)));
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

// 매장별 접속 중 인원: who → [시각, 매장]. who 없이 부르면 세기만 함
function where_(who, from) {
  const cache = CacheService.getScriptCache();
  let map = {};
  try { map = JSON.parse(cache.get('where') || '{}'); } catch (err) { map = {}; }
  const now = Date.now();
  if (who) { map[who] = [now, from]; }
  const out = {};
  Object.keys(map).forEach((k) => {
    if (now - map[k][0] > ONLINE_SEC * 1000) delete map[k];
    else out[map[k][1]] = (out[map[k][1]] || 0) + 1;
  });
  if (who) cache.put('where', JSON.stringify(map), 120);
  return out;
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

// 매장별 품목 수 (전달사항 줄 제외). 1분 동안은 캐시에서 바로 답함
function stats_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('stats');
  if (hit) return JSON.parse(hit);
  const counts = {};
  spreadsheet_().getSheets().forEach((sh) => {
    const name = sh.getName();
    if (name !== SHEET_NAME && name.indexOf(SHEET_NAME + '_') !== 0) return;
    const store = name === SHEET_NAME ? DEFAULT_STORE : name.slice(SHEET_NAME.length + 1);
    const last = sh.getLastRow();
    counts[store] = last < 2 ? 0 : sh.getRange(2, 1, last - 1, 1).getValues()
      .filter((r) => r[0] && r[0] !== '__notice__').length;
  });
  cache.put('stats', JSON.stringify(counts), 60);
  return counts;
}

// ---- 라벨 사진 (매장모음 프로젝트에서만 씀) ----
// 사진은 내 드라이브 "한글표시사항 사진" 폴더에, 품목과의 연결은 "사진" 탭에 저장합니다.
// 글자 읽기는 왼쪽 [서비스 +] → Drive API 를 추가해야 동작합니다.
const PHOTO_FOLDER = '한글표시사항 사진';
const PHOTO_SHEET = '사진';

// 처음 한 번 편집기에서 실행해 드라이브·문서 사용을 허락합니다.
function setup() {
  photoFolder_();
  photoSheet_();
  // 글자 읽기에 쓰는 '구글 문서' 권한도 여기서 같이 받음 (빈 문서를 만들었다 바로 휴지통으로)
  const doc = DocumentApp.create('권한 확인용');
  DriveApp.getFileById(doc.getId()).setTrashed(true);
  Logger.log('사진 폴더 준비 완료 / 글자 읽기: ' + (typeof Drive === 'undefined' ? 'Drive API 서비스를 추가하세요' : '사용 가능'));
}

function photoFolder_() {
  // 같은 실행 인스턴스에서는 폴더를 다시 찾지 않는다 (장마다 드라이브 왕복 1번 절약).
  if (photoFolder_.cached) return photoFolder_.cached;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) { try { photoFolder_.cached = DriveApp.getFolderById(id); return photoFolder_.cached; } catch (err) {} }
  const folder = DriveApp.createFolder(PHOTO_FOLDER);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  photoFolder_.cached = folder;
  return folder;
}

function photoSheet_() {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(PHOTO_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PHOTO_SHEET);
    sh.getRange('A:D').setNumberFormat('@');
    sh.appendRow(['store', 'id', 'file', 'at']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// 매장의 사진 목록 { 품목 id: 파일 id }
function photos_(store) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ph_' + store);
  if (hit) return JSON.parse(hit);
  const out = {};
  const sh = photoSheet_();
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).getValues().forEach((r) => { if (r[0] === store && r[1] && r[2]) out[r[1]] = String(r[2]); });
  cache.put('ph_' + store, JSON.stringify(out), 21600);
  return out;
}

function setPhoto_(store, id, file) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let old = '';
  try {
    const sh = photoSheet_();
    const last = sh.getLastRow();
    const rows = last > 1 ? sh.getRange(2, 1, last - 1, 3).getValues() : [];
    const at = rows.findIndex((r) => r[0] === store && r[1] === id);
    if (at >= 0) {
      old = String(rows[at][2]);
      if (file) sh.getRange(at + 2, 3, 1, 2).setValues([[file, String(Date.now())]]);
      else sh.deleteRow(at + 2);
    } else if (file) sh.appendRow([store, id, file, String(Date.now())]);
    CacheService.getScriptCache().remove('ph_' + store);
  } finally {
    lock.releaseLock();
  }
  if (old && old !== file) { try { DriveApp.getFileById(old).setTrashed(true); } catch (err) {} }
}

function savePhoto_(store, id, data, ocr, color, trace) {
  if (!id) throw new Error('id 없음');
  const m = data.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!m) throw new Error('사진 형식이 올바르지 않습니다');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 4 * 1024 * 1024) throw new Error('사진이 너무 큽니다');
  const blob = Utilities.newBlob(bytes, 'image/' + m[1], store + '_' + id + '.jpg');
  // 사진은 한 번만 올린다. 글자 읽기는 그 파일을 문서로 복사하며 하고, 임시 문서는 바로 지운다.
  let file;
  try { file = photoFolder_().createFile(blob); }
  catch (err) { photoFolder_.cached = null; file = photoFolder_().createFile(blob); }
  let text = '', ocrError = '';
  if (ocr) {
    // 드라이브에 올린 파일을 문서로 복사해 읽는다. 글자가 비면 예전 방식(바이트를 다시 올림)으로 한 번 더.
    let err1 = '';
    try { text = ocrFile_(file.getId()); } catch (err) { text = ''; err1 = String(err); }
    if (!String(text || '').trim()) {
      try { text = ocr_(blob); } catch (err2) { ocrError = String(err2) + (err1 ? ' / 복사 방식: ' + err1 : ''); }
    }
  }
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  setPhoto_(store, id, file.getId());
  let suggest = [];
  // 이력제 사진은 품목 추천(학습 시트 검색)을 하지 않는다. 한글표시사항만 추천을 쓴다.
  if (text && !trace) { try { suggest = suggest_(text, color); } catch (err) {} }
  return { photo: file.getId(), text: text, ocrError: ocrError, suggest: suggest };
}

function unPhoto_(store, id) {
  if (id) setPhoto_(store, id, '');
  return { ok: true };
}

// 이미 드라이브에 있는 사진으로 글자 읽기. 바이트를 다시 올리지 않는다.
function ocrFile_(fileId) {
  if (typeof Drive === 'undefined') throw new Error('Drive API 서비스가 추가되지 않았습니다');
  // v3: 문서 형식으로 복사하면 글자를 읽음 / v2: ocr 옵션이 변환까지 하므로 문서 형식을 따로 적으면 안 됨
  // (v2 에 mimeType 문서를 같이 주면 "OCR is not supported for ... google-apps.document" 오류)
  const copied = Drive.Files.create
    ? Drive.Files.copy({ name: 'ocr_tmp', mimeType: 'application/vnd.google-apps.document' }, fileId, { ocrLanguage: 'ko' })
    : Drive.Files.copy({ title: 'ocr_tmp' }, fileId, { ocr: true, ocrLanguage: 'ko' });
  const id = copied && copied.id;
  if (!id) throw new Error('글자 읽기 문서를 만들지 못했습니다');
  try { return ocrPlain_(id); }
  finally { ocrDrop_(id); }
}

function ocrPlain_(fileId) {
  if (Drive.Files.export) {
    const out = Drive.Files.export(fileId, 'text/plain');
    if (out && out.getDataAsString) return out.getDataAsString();
    if (typeof out === 'string') return out;
  }
  return DocumentApp.openById(fileId).getBody().getText();
}

function ocrDrop_(fileId) {
  try {
    if (Drive.Files.remove) Drive.Files.remove(fileId);
    else DriveApp.getFileById(fileId).setTrashed(true);
  } catch (err) {}
}

// 사진 바이트로 바로 글자 읽기 (복사 방식이 안 될 때의 대비, 한글표시사항도 이 경로를 쓸 수 있음)
function ocr_(blob) {
  if (typeof Drive === 'undefined') throw new Error('Drive API 서비스가 추가되지 않았습니다');
  let fileId;
  // 구글이 가끔 '잠시 후 다시'(rate limit)를 돌려줌: 최대 3번까지 쉬었다 다시
  for (let i = 0; ; i++) {
    try {
      if (Drive.Files.create) fileId = Drive.Files.create({ name: 'ocr_tmp', mimeType: 'application/vnd.google-apps.document' }, blob, { ocrLanguage: 'ko' }).id;
      else fileId = Drive.Files.insert({ title: 'ocr_tmp', mimeType: blob.getContentType() }, blob, { ocr: true, ocrLanguage: 'ko' }).id; // v2: 원래 사진 형식 그대로 (10.26 실제로 동작 확인한 방식)
      break;
    } catch (err) {
      if (i >= 2 || !/rate limit/i.test(String(err))) throw err;
      Utilities.sleep(1500 * (i + 1));
    }
  }
  try { return ocrPlain_(fileId); }
  finally { ocrDrop_(fileId); }
}

// 매장들이 '제조일로부터 N' 으로 등록한 품목: { 이름키: { name, combos: { '24m': 매장 수 } } }
function catalog_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('catalog');
  if (hit) return JSON.parse(hit);
  const out = {};
  spreadsheet_().getSheets().forEach((sh) => {
    const name = sh.getName();
    if (name !== SHEET_NAME && name.indexOf(SHEET_NAME + '_') !== 0) return;
    const seen = {};
    sh.getDataRange().getValues().slice(1).forEach((r) => {
      if (!r[1] || r[0] === '__notice__' || r[3] === 'note') return;
      const key = String(r[1]).toLowerCase().replace(/[\s()\[\]·.,_\-\/]/g, '');
      out[key] = out[key] || { name: String(r[1]), combos: {} };
      if (r[3] !== 'period' || !(Number(r[6]) > 0)) return;
      const combo = Number(r[6]) + String(r[7]);
      if (seen[key + combo]) return;
      seen[key + combo] = 1;
      out[key].combos[combo] = (out[key].combos[combo] || 0) + 1;
    });
  });
  const json = JSON.stringify(out);
  if (json.length < 90000) cache.put('catalog', json, 600);
  return out;
}

// ---- 라벨 사진으로 품목 추천 ----
// 직원이 사진을 찍고 품목을 저장할 때마다 "사진 속 글자 + 대표 색 → 품목 이름"을 '학습' 탭에 쌓고,
// 새 사진이 들어오면 글자가 많이 겹치는 품목을 추천합니다. (색은 보조 점수)
const LEARN_SHEET = '학습';
const LEARN_KEEP = 3000; // 최근 3000줄만 유지
const STOP_ = {};
('소비기한 유통기한 품질유지기한 제조일자 제조일 제조년월일 까지 이내 보관 보관방법 냉장 냉동 실온 냉장보관 냉동보관 제품명 '
  + '식품유형 내용량 원재료명 원재료 제조원 수입원 판매원 유통전문판매원 소재지 이하 이상 영하 개봉 개봉후 섭취 반품 교환 '
  + 'the and best before exp lot date use mfg prod net weight store keep').split(' ').forEach((w) => { STOP_[w] = 1; });

function tokens_(text) {
  const t = String(text || '').toLowerCase().replace(/\d{1,4}[.\-\/년]\s*\d{1,2}[.\-\/월]\s*\d{1,4}/g, ' ');
  const out = {};
  (t.match(/[가-힣]{2,}|[a-z][a-z0-9]{2,}/g) || []).forEach((w) => { if (!STOP_[w] && w.length <= 30) out[w] = 1; });
  return Object.keys(out).slice(0, 80);
}

function learnSheet_() {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(LEARN_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LEARN_SHEET);
    sh.getRange('A:G').setNumberFormat('@');
    sh.appendRow(['at', 'store', 'id', 'name', 'key', 'tokens', 'color']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function learn_(store, id, name, text, color) {
  const toks = tokens_(text);
  if (!name || !toks.length) return { ok: true, skipped: true };
  const key = name.toLowerCase().replace(/[\s()\[\]·.,_\-\/]/g, '');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = learnSheet_();
    sh.appendRow([String(Date.now()), store, id, name, key, toks.join(' '), color]);
    const last = sh.getLastRow();
    if (last > LEARN_KEEP + 500) sh.deleteRows(2, last - 1 - LEARN_KEEP);
    CacheService.getScriptCache().remove('learn_n');
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

// 학습 기록을 임시 저장소(캐시)에 90KB씩 나눠 담아 둠: 사진마다 시트를 다시 읽지 않게 (6시간, 새 기록이 들어오면 비움)
const CHUNK = 90000;
function learnRows_() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('learn_n'));
  if (n > 0) {
    const keys = [];
    for (let i = 0; i < n; i++) keys.push('learn_' + i);
    const got = cache.getAll(keys);
    if (keys.every((k) => got[k] !== undefined && got[k] !== null)) return JSON.parse(keys.map((k) => got[k]).join(''));
  }
  const sh = learnSheet_();
  const last = sh.getLastRow();
  const rows = last > 1 ? sh.getRange(2, 4, last - 1, 4).getValues().map((r) => [String(r[0]), String(r[1]), String(r[2]), String(r[3])]) : [];
  const json = JSON.stringify(rows);
  const parts = {};
  let count = 0;
  for (let i = 0; i < json.length; i += CHUNK) parts['learn_' + count++] = json.slice(i, i + CHUNK);
  try { cache.putAll(parts, 21600); cache.put('learn_n', String(count), 21600); } catch (err) {} // 캐시가 꽉 차면 다음에 시트에서 다시 읽음
  return rows;
}

// 반환: [{ name, score(0~100) }] 최대 3개. 확신이 낮으면 빈 배열
function suggest_(text, color) {
  const q = tokens_(text);
  if (!q.length) return [];
  const rows = learnRows_(); // [name, key, tokens, color]
  if (!rows.length) return [];
  const df = {};
  const docs = rows.map((r) => { const set = {}; r[2].split(' ').forEach((w) => { if (w) set[w] = 1; }); Object.keys(set).forEach((w) => { df[w] = (df[w] || 0) + 1; }); return set; });
  const N = rows.length;
  const idf = (w) => Math.log(1 + N / (1 + (df[w] || 0)));
  // 기록의 30% 넘게 나오는 흔한 글자(냉동, 미국산 등)는 품목을 가려 주지 못하니 뺌 (기록이 20줄 이상일 때)
  const q2 = N >= 20 ? q.filter((w) => (df[w] || 0) / N <= 0.3) : q;
  if (!q2.length) return [];
  const qw = q2.reduce((a, w) => a + idf(w), 0);
  const rgb = (c) => { const m = String(c || '').split(',').map(Number); return m.length === 3 && m.every((x) => x >= 0) ? m : null; };
  const qc = rgb(color);
  const best = {};
  rows.forEach((r, i) => {
    let hit = 0;
    q2.forEach((w) => { if (docs[i][w]) hit += idf(w); });
    if (!hit) return;
    let s = hit / qw;
    const rc = rgb(r[3]);
    if (qc && rc) s += 0.1 * (1 - Math.min(1, Math.hypot(qc[0] - rc[0], qc[1] - rc[1], qc[2] - rc[2]) / 255)); // 색은 최대 10점
    if (!best[r[1]] || s > best[r[1]].s) best[r[1]] = { name: r[0], s: s };
  });
  return Object.keys(best).map((k) => best[k]).filter((x) => x.s >= 0.3)
    .sort((a, b) => b.s - a.s).slice(0, 3).map((x) => ({ name: x.name, score: Math.min(99, Math.round(x.s * 100)) }));
}

// ---- 축산물이력제 기록 (매장모음 프로젝트에서만 씀) ----
// '이력제' 탭: 한 줄 = 입고 확인 1번. data 칸에 명세서·박스 번호와 사진 연결(JSON)을 담습니다.
// 30일이 지난 기록은 저장·조회할 때, 그리고 매일 새벽 트리거에서 오래된 것부터 지웁니다.
const TRACE_SHEET = '이력제';
const TRACE_KEEP_DAYS = 30;

function traceCutoff_() {
  return Utilities.formatDate(new Date(Date.now() - TRACE_KEEP_DAYS * 864e5), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function traceSheet_() {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(TRACE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TRACE_SHEET);
    sh.getRange('A:F').setNumberFormat('@');
    sh.appendRow(['store', 'id', 'date', 'who', 'data', 'at']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function traceRows_() {
  const sh = traceSheet_();
  const last = sh.getLastRow();
  return last > 1 ? sh.getRange(2, 1, last - 1, 6).getValues().map((r) => r.map((v) => cell_(v))) : [];
}

function traceList_(store) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('tr_' + store);
  if (hit) return JSON.parse(hit);
  const cut = traceCutoff_();
  const rows = traceRows_();
  if (rows.some((r) => r[2] && r[2] < cut)) pruneTrace_(cut);
  const out = rows.filter((r) => r[0] === store && r[1] && !(r[2] < cut)).map((r) => {
    let data = {};
    try { data = JSON.parse(r[4] || '{}'); } catch (err) {}
    return { id: r[1], date: r[2], who: r[3], data: data, at: Number(r[5]) || 0 };
  });
  const json = JSON.stringify(out);
  if (json.length < 95000) cache.put('tr_' + store, json, 21600);
  return out;
}

function pruneTrace_(cut) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  const gone = [];
  try {
    gone.push.apply(gone, pruneTraceUnlocked_(cut));
  } finally {
    lock.releaseLock();
  }
  // 사진 삭제는 잠금을 푼 뒤에. unPhoto_ 가 같은 잠금을 다시 잡는다.
  gone.forEach((r) => {
    try { (JSON.parse(r[4] || '{}').photos || []).forEach((k) => unPhoto_(r[0], String(k).slice(0, 40))); } catch (err) {}
    CacheService.getScriptCache().remove('tr_' + r[0]);
  });
}

// 호출하는 쪽이 이미 잠금을 잡고 있을 때. 날짜가 오래된 줄부터 고르고, 시트에서는 아래 줄부터 지운다.
function pruneTraceUnlocked_(cut) {
  const sh = traceSheet_();
  const rows = traceRows_();
  const old = [];
  rows.forEach((r, i) => { if (r[2] && r[2] < cut) old.push({ i: i, r: r }); });
  old.sort((a, b) => a.r[2] < b.r[2] ? -1 : a.r[2] > b.r[2] ? 1 : a.i - b.i);
  const gone = old.map((x) => x.r);
  old.sort((a, b) => b.i - a.i).forEach((x) => sh.deleteRow(x.i + 2));
  return gone;
}

// 편집기에서 한 번 실행하면 매일 새벽 4시(스크립트 시간대)에 30일 지난 기록을 지운다.
function installTracePruneTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pruneTraceDaily') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pruneTraceDaily').timeBased().everyDays(1).atHour(4).create();
  Logger.log('이력제 30일 정리 트리거를 만들었습니다');
}

function pruneTraceDaily() {
  pruneTrace_(traceCutoff_());
}

function traceSave_(store, body) {
  const id = String(body.id || '').slice(0, 40);
  const date = String(body.date || '');
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('기록 형식이 올바르지 않습니다');
  const data = JSON.stringify(body.data || {});
  if (data.length > 45000) throw new Error('기록이 너무 깁니다');
  const row = [store, id, date, String(body.who || '').slice(0, 10), data, String(Date.now())];
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let gone = [];
  try {
    const sh = traceSheet_();
    const rows = traceRows_();
    const at = rows.findIndex((r) => r[0] === store && r[1] === id);
    if (at >= 0) sh.getRange(at + 2, 1, 1, 6).setValues([row]);
    else sh.appendRow(row);
    CacheService.getScriptCache().remove('tr_' + store);
    gone = pruneTraceUnlocked_(traceCutoff_());
  } finally {
    lock.releaseLock();
  }
  gone.forEach((r) => {
    try { (JSON.parse(r[4] || '{}').photos || []).forEach((k) => unPhoto_(r[0], String(k).slice(0, 40))); } catch (err) {}
    CacheService.getScriptCache().remove('tr_' + r[0]);
  });
  return traceList_(store);
}

function traceDelete_(store, id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let photos = [];
  try {
    const sh = traceSheet_();
    const rows = traceRows_();
    const at = rows.findIndex((r) => r[0] === store && r[1] === id);
    if (at >= 0) {
      try { photos = JSON.parse(rows[at][4] || '{}').photos || []; } catch (err) {}
      sh.deleteRow(at + 2);
    }
    CacheService.getScriptCache().remove('tr_' + store);
  } finally {
    lock.releaseLock();
  }
  photos.forEach((k) => unPhoto_(store, String(k).slice(0, 40)));
  return traceList_(store);
}

