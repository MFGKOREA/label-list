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
      if (e.parameter.traceLookup) return json_(traceLookup_(e.parameter.traceLookup)); // 이력번호 하나 조회 (캐시 먼저)
      if (e.parameter.pushstat) return json_(pushStat_()); // 알림 점검: 매장별 등록 폰 수·마지막 오류 (토큰은 안 보여줌)
      if (e.parameter.backups) return json_({ backups: backupList_() }); // 복구용 백업 목록 (최근 15일)
      if (e.parameter.backup) return json_(backupGet_(String(e.parameter.backup), e.parameter.store ? store_(e.parameter.store) : '')); // 그날 백업 (매장 하나 또는 전체)
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
    if (body.action === 'ocr') return json_(ocrOnly_(String(body.data || ''), String(body.color || '').slice(0, 20), !!body.trace));
    if (body.action === 'photo') return json_(savePhoto_(store, String(body.id || '').slice(0, 40), String(body.data || ''), !!body.ocr, String(body.color || '').slice(0, 20), !!body.trace));
    if (body.action === 'trace_save') return json_({ trace: traceSave_(store, body) });
    if (body.action === 'trace_delete') return json_({ trace: traceDelete_(store, String(body.id || '').slice(0, 40)) });
    if (body.action === 'trace_lookup') return json_(traceLookup_(String(body.traceNo || '').slice(0, 20)));
    if (body.action === 'learn') return json_(learn_(store, String(body.id || '').slice(0, 40), String(body.name || '').slice(0, 80), String(body.text || '').slice(0, 3000), String(body.color || '').slice(0, 20)));
    if (body.action === 'self_update') return json_(selfUpdate_());
    if (body.action === 'admin_run') return json_(adminRun_(String(body.fn || '')));
    if (body.action === 'push_sub') return json_(pushSub_(store, String(body.token || '').slice(0, 400), String(body.old || '').slice(0, 400)));
    if (body.action === 'push_notice') return json_(pushNotice_(store, String(body.text || '').slice(0, 200), String(body.token || '').slice(0, 400)));
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
    try { backupBeforeClear_(store); } catch (err) {} // 초기화 직전 목록을 따로 남김 (실수로 지워도 되살리게)
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

// 글자 읽기만 (사진 저장과 동시에 따로 부름 → 기다리는 시간이 줄어듦). 사진은 저장하지 않는다.
function ocrOnly_(data, color, trace) {
  const t0 = Date.now(), t = {};
  const m = data.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!m) throw new Error('사진 형식이 올바르지 않습니다');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 4 * 1024 * 1024) throw new Error('사진이 너무 큽니다');
  const blob = Utilities.newBlob(bytes, 'image/' + m[1], 'ocr.jpg');
  let text = '', ocrError = '';
  try { text = ocr_(blob); } catch (err) { ocrError = String(err); }
  t.ocr = Date.now() - t0;
  let suggest = [];
  if (text && !trace) { try { suggest = suggest_(text, color); } catch (err) {} }
  t.all = Date.now() - t0;
  return { text: text, ocrError: ocrError, suggest: suggest, t: t };
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
  // 드라이브 v3 export 는 alt=media 를 같이 줘야 내용을 줌. 안 되면 문서를 직접 열어 읽음(10.26 동작 확인한 방식)
  if (Drive.Files.export) {
    try {
      const out = Drive.Files.export(fileId, 'text/plain', { alt: 'media' });
      if (out && out.getDataAsString) return out.getDataAsString();
      if (typeof out === 'string' && out) return out;
    } catch (err) {}
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

// ---- 이력번호 조회 (mtrace) + 시트 캐시 ----
// 박스 바코드·라벨에서 읽은 12자리 이력번호로 도축일자·등급을 한 번만 물어보고 '이력캐시' 탭에 담아 둡니다.
// 다음부터는 같은 번호를 구글 API 에 다시 묻지 않고 바로 돌려줍니다 (source: 'cache').
// 공공 API 모양은 실제로 돌아가는 오픈소스에서 확인했습니다:
//   sirloin-bondaero/mtrace-api-client (AnimalTraceImpl.java), 07z0/kyj-cow (server.py)
//   GET http://data.ekape.or.kr/openapi-data/service/user/animalTrace/traceNoSearch?serviceKey=…&traceNo=002147460101
//   → <response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
//     <body><items><item><infoType>3</infoType><butcheryYmd>20220523</butcheryYmd><gradeNm>2</gradeNm>…</item></items></body></response>
//   정보 종류(infoType): 1 소 개체 · 2 농장 · 3 도축·등급 · 4 가공장 · 5 백신 · 6 검사
//   optionNo 를 붙이면 그 종류만 옵니다 — 도축일자·등급이 필요하므로 붙이지 않습니다.
//   부위명·유통기한은 이 API 에 없습니다: 칸은 두되 비워 두고, 포장 바코드의 (17) 유통기한을 앱이 채웁니다.
// 키는 스크립트 속성 MTRACE_API_KEY 에만 넣습니다 (코드·시트·채팅에 적지 않음).
// 키가 없거나 API 가 실패하면 '확정'으로 넘기지 않고 pending(미확정)으로 돌려줍니다.
const TRACE_CACHE_SHEET = '이력캐시';
const TRACE_CACHE_HEAD = ['traceNo', 'butcherDate', 'grade', 'partName', 'expiry', 'source', 'verifiedAt'];
const MTRACE_URL = 'http://data.ekape.or.kr/openapi-data/service/user/animalTrace/traceNoSearch';

function traceCacheSheet_() {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(TRACE_CACHE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TRACE_CACHE_SHEET);
    sh.getRange('A:G').setNumberFormat('@');
    sh.appendRow(TRACE_CACHE_HEAD);
    sh.setFrozenRows(1);
  }
  return sh;
}

function traceCacheRow_(no) {
  const sh = traceCacheSheet_();
  const last = sh.getLastRow();
  if (last < 2) return null;
  const at = sh.getRange(2, 1, last - 1, 1).getValues().findIndex((r) => cell_(r[0]) === no);
  if (at < 0) return null;
  const v = sh.getRange(at + 2, 1, 1, TRACE_CACHE_HEAD.length).getValues()[0].map((x) => cell_(x));
  const out = {};
  TRACE_CACHE_HEAD.forEach((h, i) => { out[h] = v[i]; });
  return out;
}

function traceCachePut_(row) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = traceCacheSheet_();
    const last = sh.getLastRow();
    const at = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().findIndex((r) => cell_(r[0]) === row.traceNo) : -1;
    const line = TRACE_CACHE_HEAD.map((h) => cell_(row[h]));
    if (at >= 0) sh.getRange(at + 2, 1, 1, line.length).setValues([line]);
    else sh.appendRow(line);
  } finally {
    lock.releaseLock();
  }
}

function tracePending_(no, note) {
  return { ok: false, pending: true, source: 'pending', traceNo: no, note: note + ' (미확정)' };
}

// 이력번호 하나 → { ok, source: 'cache'|'api', traceNo, butcherDate, grade, partName, expiry, verifiedAt } 또는 pending
function traceLookup_(traceNo) {
  const no = String(traceNo || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 17);
  if (!/^(\d{12}|[A-Z]\d{12,16})$/.test(no)) return tracePending_(no, '번호 형식이 아님');
  const hit = traceCacheRow_(no);
  if (hit && hit.butcherDate) return { ok: true, source: 'cache', traceNo: no, butcherDate: hit.butcherDate, grade: hit.grade, partName: hit.partName, expiry: hit.expiry, verifiedAt: hit.verifiedAt };
  const key = PropertiesService.getScriptProperties().getProperty('MTRACE_API_KEY');
  if (!key) return tracePending_(no, 'API 키 미설정');
  let xml = '';
  try {
    const res = UrlFetchApp.fetch(MTRACE_URL + '?serviceKey=' + encodeURIComponent(key) + '&traceNo=' + encodeURIComponent(no), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return tracePending_(no, 'API 응답 ' + res.getResponseCode());
    xml = res.getContentText();
  } catch (err) {
    return tracePending_(no, 'API 조회 실패');
  }
  const got = traceParse_(xml);
  if (!got.ok) return tracePending_(no, got.note || '조회 결과 없음');
  const row = {
    traceNo: no, butcherDate: got.butcherDate, grade: got.grade, partName: got.partName, expiry: '',
    source: 'api', verifiedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
  };
  traceCachePut_(row);
  return { ok: true, source: 'api', traceNo: no, butcherDate: row.butcherDate, grade: row.grade, partName: row.partName, expiry: row.expiry, verifiedAt: row.verifiedAt };
}

// 응답 XML 에서 한 칸 값. 값에 < > 가 들어가는 칸은 없으므로 태그 사이 글자만 꺼낸다.
function traceTag_(block, tag) {
  const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(String(block || ''));
  return m ? m[1].trim() : '';
}

// 20220523 → 2022-05-23. 여덟 자리가 아니면 빈 값 (날짜를 지어내지 않음)
function traceYmd_(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 8 ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6) : '';
}

// 통합이력 XML → { ok, butcherDate, grade, partName } (도축·등급이 없으면 ok: false)
function traceParse_(xml) {
  const s = String(xml || '');
  const code = traceTag_(s, 'resultCode');
  const msg = traceTag_(s, 'resultMsg');
  if (code && code !== '00') return { ok: false, note: msg || ('API 오류 ' + code) };
  const items = s.match(/<item>[\s\S]*?<\/item>/g) || [];
  if (!items.length) return { ok: false, note: msg || '조회 결과 없음' };
  const out = { ok: true, butcherDate: '', grade: '', partName: '' };
  items.forEach((it) => {
    if (traceTag_(it, 'infoType') !== '3') return;
    if (!out.butcherDate) out.butcherDate = traceYmd_(traceTag_(it, 'butcheryYmd'));
    if (!out.grade) out.grade = traceTag_(it, 'gradeNm');
    if (!out.partName) out.partName = traceTag_(it, 'partNm') || traceTag_(it, 'partName');
  });
  if (!out.butcherDate && !out.grade) return { ok: false, note: '도축·등급 정보 없음' }; // 아직 도축 전이거나 번호가 틀림
  return out;
}



// ---- 복구용 백업 (매장모음 프로젝트에서만 씀) ----
// 매일 새벽 모든 매장 목록(매장모음 탭 + 수원·월드타워·용산 전용 프로젝트)과 이력제 기록을
// 내 드라이브 "한글표시사항 백업" 폴더에 날짜별 파일(backup-YYYY-MM-DD.json)로 저장하고, 15일 지난 파일은 지웁니다.
// 처음 한 번 편집기에서 installBackupTrigger 를 실행하면 매일 새벽 3시에 돌고, 바로 한 번 백업합니다.
const BACKUP_FOLDER = '한글표시사항 백업';
const BACKUP_DAYS = 15;
const EXTERNAL_STORES = { // 매장모음이 아닌 전용 프로젝트 매장 (앱 index.html 의 STORES 와 같게)
  suwon: 'https://script.google.com/macros/s/AKfycbyPJbVBORKgT-X7ZzyROdnLtK1zRMxPhNPBEqo_UNX2usdGy6YavPyWAduqwdNsaFo/exec',
  lwt: 'https://script.google.com/macros/s/AKfycbzxRVdyf02wbFZVRRif34GJXUZl70hoebw8__46aoyfr_lvZQT-1N_76H6prSpHdgnH/exec',
  ys: 'https://script.google.com/macros/s/AKfycbzs4LFJo3Tau13KojH6dUZpyRvdRJXM2BEJWndv8Kc0u8fihga-F3iQSGofaWgut-oWrg/exec',
};

function backupFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('BACKUP_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (err) {} }
  const folder = DriveApp.createFolder(BACKUP_FOLDER);
  props.setProperty('BACKUP_FOLDER_ID', folder.getId());
  return folder;
}
function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

// 매장모음 시트의 모든 목록 탭 + 전용 프로젝트 매장 목록
function snapshot_() {
  const stores = {};
  spreadsheet_().getSheets().forEach((sh) => {
    const name = sh.getName();
    if (name.indexOf(SHEET_NAME + '_') !== 0) return; // 기본 '목록' 탭은 수원 전용 프로젝트가 따로 있어 뺌
    const store = name.slice(SHEET_NAME.length + 1);
    if (/^[a-z0-9]{1,20}$/.test(store)) stores[store] = listItems(store);
  });
  Object.keys(EXTERNAL_STORES).forEach((code) => {
    try {
      const res = UrlFetchApp.fetch(EXTERNAL_STORES[code] + '?api=1&store=' + code + '&t=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
      const d = JSON.parse(res.getContentText());
      stores[code] = Array.isArray(d) ? d : (d && d.items) || { error: (d && d.error) || '응답 오류' };
    } catch (err) { stores[code] = { error: String(err) }; }
  });
  let trace = [];
  try { trace = traceRows_(); } catch (err) {}
  return { at: new Date().toISOString(), stores: stores, trace: trace };
}

function backupDaily() {
  const folder = backupFolder_();
  const name = 'backup-' + today_() + '.json';
  const text = JSON.stringify(snapshot_());
  const old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true); // 같은 날 다시 돌리면 새 것으로
  folder.createFile(name, text, 'application/json');
  pruneBackups_(folder);
  Logger.log('백업 저장: ' + name + ' (' + Math.round(text.length / 1024) + 'KB)');
}

// 15일 지난 백업(초기화 직전 백업 포함)은 휴지통으로
function pruneBackups_(folder) {
  const cut = new Date(Date.now() - BACKUP_DAYS * 86400000);
  const cutIso = Utilities.formatDate(cut, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next(), m = f.getName().match(/(\d{4}-\d{2}-\d{2})/);
    if (m && m[1] < cutIso) f.setTrashed(true);
  }
}

// [초기화] 직전 그 매장 목록만 따로 저장: clear-매장-YYYY-MM-DD-HHmmss.json
function backupBeforeClear_(store) {
  const items = listItems(store);
  if (!items.length) return;
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd-HHmmss');
  backupFolder_().createFile('clear-' + store + '-' + stamp + '.json', JSON.stringify({ at: new Date().toISOString(), stores: { [store]: items } }), 'application/json');
}

// 백업 목록: [{ name, date, kind: 'daily'|'clear', size }]
function backupList_() {
  const out = [], files = backupFolder_().getFiles();
  while (files.hasNext()) {
    const f = files.next(), n = f.getName(), m = n.match(/(\d{4}-\d{2}-\d{2})/);
    if (!m || !/\.json$/.test(n)) continue;
    out.push({ name: n, date: m[1], kind: n.indexOf('clear-') === 0 ? 'clear' : 'daily', size: f.getSize() });
  }
  return out.sort((a, b) => (b.name > a.name ? 1 : -1));
}

// 그날 백업 내용: date 는 'YYYY-MM-DD'(매일 백업) 또는 백업 파일 이름 그대로
function backupGet_(date, store) {
  const name = /^\d{4}-\d{2}-\d{2}$/.test(date) ? 'backup-' + date + '.json' : date;
  if (!/^[a-z0-9\-]+\.json$/i.test(name)) throw new Error('백업 이름이 올바르지 않습니다');
  const files = backupFolder_().getFilesByName(name);
  if (!files.hasNext()) throw new Error('그날 백업이 없습니다');
  const d = JSON.parse(files.next().getBlob().getDataAsString());
  if (store) return { at: d.at, store: store, items: (d.stores || {})[store] || [] };
  const counts = {};
  Object.keys(d.stores || {}).forEach((k) => { counts[k] = Array.isArray(d.stores[k]) ? d.stores[k].length : -1; });
  return { at: d.at, counts: counts };
}

// 편집기에서 한 번 실행: 매일 새벽 3시 백업 트리거 + 지금 바로 한 번 백업
function installBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupDaily') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupDaily').timeBased().everyDays(1).atHour(3).create();
  backupDaily();
  Logger.log('매일 새벽 3시 백업 트리거를 만들었습니다 (15일 보관)');
}

// 편집기에서 실행하는 되살리기 (매장모음 탭 매장만): restoreStore('dogok', '2026-11-09')
function restoreStore(store, date) {
  store = store_(store);
  if (EXTERNAL_STORES[store]) throw new Error(store + ' 는 전용 프로젝트 매장이라 여기서 되살릴 수 없습니다');
  const b = backupGet_(date, store);
  if (!Array.isArray(b.items)) throw new Error('백업에 이 매장 목록이 없습니다');
  try { backupBeforeClear_(store); } catch (err) {}
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_(store), last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
    if (b.items.length) sh.getRange(2, 1, b.items.length, HEAD.length).setValues(b.items.map((it) => HEAD.map((h) => cell_(it[h]))));
    bump_(store);
  } finally { lock.releaseLock(); }
  Logger.log(store + ' 를 ' + date + ' 백업(' + b.items.length + '개)으로 되살렸습니다');
}


// ---- 휴대폰 알림 (매장모음 프로젝트에서만 씀) ----
// 각 휴대폰이 앱에서 [알림 받기]를 누르면 Firebase 알림 주소(토큰)를 매장과 함께 '알림' 탭에 저장.
// 매일 아침 9시·저녁 5시: 매장마다 7일도 안 남은 품목(지난 것 포함)을 그 매장 폰들에 / 전달사항이 바뀌면: 같은 매장 다른 폰들에.
// 스크립트 속성 FCM_SA 에 Firebase 서비스 계정 JSON(비공개 키 파일 내용 전체)을 넣어야 보냅니다.
const PUSH_SHEET = '알림';
const APP_URL = 'https://mfgkorea.github.io/label-list/';

function pushSheet_() {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(PUSH_SHEET);
  if (!sh) { sh = ss.insertSheet(PUSH_SHEET); sh.appendRow(['token', 'store', 'at']); sh.setFrozenRows(1); }
  return sh;
}
function pushRows_() {
  const v = pushSheet_().getDataRange().getValues(); v.shift();
  return v.filter((r) => r[0]).map((r) => ({ token: String(r[0]), store: String(r[1]) }));
}
function pushSub_(store, token, old) {
  if (!token) throw new Error('토큰 없음');
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = pushSheet_(), v = sh.getDataRange().getValues();
    for (let i = v.length - 1; i >= 1; i--) if (String(v[i][0]) === token || (old && String(v[i][0]) === old)) sh.deleteRow(i + 1);
    sh.appendRow([token, store, new Date().toISOString()]);
  } finally { lock.releaseLock(); }
  return { ok: true };
}
function pushDrop_(token) {
  const sh = pushSheet_(), v = sh.getDataRange().getValues();
  for (let i = v.length - 1; i >= 1; i--) if (String(v[i][0]) === token) sh.deleteRow(i + 1);
}

// Firebase 서비스 계정으로 접근 토큰 (50분 캐시)
function fcmAuth_() {
  const raw = PropertiesService.getScriptProperties().getProperty('FCM_SA');
  if (!raw) throw new Error('FCM_SA 스크립트 속성이 없습니다');
  const sa = JSON.parse(raw), cache = CacheService.getScriptCache(), hit = cache.get('fcm_at');
  if (hit) return { at: hit, project: sa.project_id };
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, '');
  const head = enc({ alg: 'RS256', typ: 'JWT' });
  const claim = enc({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(head + '.' + claim, sa.private_key)).replace(/=+$/, '');
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', { method: 'post', payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig }, muteHttpExceptions: true });
  const at = JSON.parse(res.getContentText()).access_token;
  if (!at) throw new Error('Firebase 인증 실패: ' + res.getContentText().slice(0, 200));
  cache.put('fcm_at', at, 3000);
  return { at: at, project: sa.project_id };
}
// 매장 폰들에 보내기 (skip 토큰 제외). 없어진 토큰은 지움
function pushSend_(store, title, body, tag, skip) {
  const rows = pushRows_().filter((r) => r.store === store && r.token !== skip);
  if (!rows.length) return 0;
  const auth = fcmAuth_(), url = 'https://fcm.googleapis.com/v1/projects/' + auth.project + '/messages:send';
  const link = APP_URL + '?store=' + store;
  const reqs = rows.map((r) => ({ url: url, method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + auth.at },
    payload: JSON.stringify({ message: { token: r.token, data: { title: title, body: body, tag: tag, url: link }, webpush: { headers: { Urgency: 'high', TTL: '43200' }, notification: { title: title, body: body, tag: tag }, fcm_options: { link: link } } } }) }));
  let sent = 0;
  UrlFetchApp.fetchAll(reqs).forEach((res, i) => {
    const code = res.getResponseCode();
    if (code === 200) sent++;
    else {
      CacheService.getScriptCache().put('push_err', new Date().toISOString() + ' ' + code + ' ' + res.getContentText().slice(0, 300), 21600);
      if (code === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(res.getContentText())) pushDrop_(rows[i].token);
    }
  });
  return sent;
}

// 전달사항 알림: 같은 매장 다른 폰들에 바로 (매장마다 30초에 한 번까지)
function pushNotice_(store, text, from) {
  if (!text) return { sent: 0 };
  const cache = CacheService.getScriptCache(), k = 'pn_' + store;
  if (cache.get(k)) return { sent: 0, wait: true };
  cache.put(k, '1', 30); // 같은 매장 30초에 한 번까지 (바로 보내되 연달아 여러 번은 막음)
  return { sent: pushSend_(store, (STORE_NAMES[store] || store) + ' · 전달사항', text, 'notice-' + store, from) };
}

// 매장 이름 (알림 제목용) — 앱 index.html 의 STORES 와 같게. 없으면 코드로
const STORE_NAMES = {
  yeouido: 'MG여의도점',
  mokdong: 'MG목동점',
  sadang: 'MG사당점',
  gnsamsung: 'MG강남삼성타운점',
  ydptimes: 'MG영등포타임스퀘어점',
  sac: 'MG예술의전당점',
  dogok: 'MG도곡점',
  sangammbc: 'MG상암MBC점',
  lsw: 'MG롯데시네마수원역점',
  djdunsan: 'MG대전둔산점',
  lwt: 'MG롯데시네마월드타워점',
  gjgwangcheon: 'MG광주광천점',
  kdstarcity: 'MG건대스타시티점',
  pangyo: 'MG판교라스트리트점',
  ssgcheonan: 'MG신세계백화점천안아산점',
  dongtan: 'MG타임테라스동탄점',
  ys: 'MG용산아이파크몰점',
  hdgasan: 'MG현대아울렛가산점',
  ulsanhd: 'MG울산현대백화점',
  centerone: 'MG센터원점',
  ssgujb: 'MG신세계백화점의정부점',
  hdmia: 'MG현대미아점',
  bongeunsa: 'MG봉은사아이파크타워점',
  anseongsf: 'MG안성스타필드점',
  djssgart: 'MG대전신세계Art&Science점',
  ldongbusan: 'MG롯데프리미엄아울렛동부산점',
  lbusan: 'MG롯데백화점부산본점',
  lnowon: 'MG롯데노원점',
  lcastle: 'MG롯데캐슬잠실점',
  lpyeongchon: 'MG롯데평촌점',
  lworld: 'MG롯데월드점',
  lsuji: 'MG롯데몰수지점',
  onegrove: 'MG원그로브점',
  lincheon: 'MG롯데백화점인천점',
  galleria: 'MG갤러리아센터시티점',
  cheongju: 'MG청주커넥트점',
  unjeong: 'MG스타필드빌리지운정점',
  suwon: 'MG수원컨벤션센터점',
  hdsongdo: 'MG현대프리미엄아울렛송도점',
  cpgrand: 'CP그랑서울점',
  sfgunsan: 'MG스타필드마켓군산점',
};

// 매일 아침: 지난 것·7일 이내가 있는 매장만
function pushDaily() {
  const stores = [...new Set(pushRows_().map((r) => r.store))];
  const tz = Session.getScriptTimeZone(), todayIso = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const t0 = new Date(todayIso + 'T00:00:00');
  stores.forEach((store) => {
    let items = [];
    try {
      if (EXTERNAL_STORES[store]) { const d = JSON.parse(UrlFetchApp.fetch(EXTERNAL_STORES[store] + '?api=1&store=' + store + '&t=' + Date.now(), { muteHttpExceptions: true }).getContentText()); items = Array.isArray(d) ? d : (d.items || []); }
      else items = listItems(store);
    } catch (err) { return; }
    const rows = items.filter((it) => it.mode !== 'note' && it.mode !== 'pack' && it.id !== '__notice__').map((it) => {
      const exp = it.mode === 'period' ? addPeriod_(it.mfg, Number(it.num) || 0, it.unit) : it.expiry;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(exp || '')) return null;
      return { name: it.name, exp: exp, n: Math.round((new Date(exp + 'T00:00:00') - t0) / 86400000) };
    }).filter((r) => r && r.n < 7).sort((a, b) => a.n - b.n); // 7일도 안 남은 품목 (지난 것 포함)
    if (!rows.length) return;
    const gone = rows.filter((r) => r.n < 0).length, soon = rows.length - gone;
    const head = gone ? '지난 것 ' + gone + '개 포함 ' + rows.length + '개' : rows.length + '개';
    const when = Number(Utilities.formatDate(new Date(), tz, 'H')) >= 12 ? '저녁 확인' : '아침 확인';
    // 날짜로: 수란 11/17까지 · 지난 건 샐러드믹스 11/12 지남
    const md = (iso) => Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10));
    const list = rows.slice(0, 5).map((r) => r.name.replace(/\(.*?\)|_.*$/g, '') + ' ' + md(r.exp) + (r.n < 0 ? ' 지남' : '까지')).join(', ');
    try { pushSend_(store, (STORE_NAMES[store] || store) + ' · 유통기한 ' + when, head + ' · ' + list + (rows.length > 5 ? ' 외' : ''), 'expiry-' + store, ''); } catch (err) { Logger.log(store + ' 알림 실패: ' + err); }
  });
}
function addPeriod_(mfg, num, unit) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mfg || '')) return '';
  const p = mfg.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]);
  if (unit === 'd') d.setDate(d.getDate() + num);
  else { const m = unit === 'y' ? num * 12 : num; const t = new Date(d.getFullYear(), d.getMonth() + m, 1); const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); t.setDate(Math.min(d.getDate(), last)); return Utilities.formatDate(t, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
// 편집기에서 한 번 실행: 매일 아침 9시·저녁 5시 유통기한 알림
function installPushTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'pushDaily') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('pushDaily').timeBased().everyDays(1).atHour(9).create();
  ScriptApp.newTrigger('pushDaily').timeBased().everyDays(1).atHour(17).create();
  pushSheet_();
  Logger.log('매일 아침 9시·저녁 5시 유통기한 알림 트리거를 만들었습니다');
}


// ---- 스스로 배포 (매장모음 프로젝트에서만 씀) ----
// 저장소 main 의 apps-script/label/Code.gs 를 받아 이 프로젝트 코드를 바꾸고, 새 버전을 만들어 기존 배포(같은 주소)에 올립니다.
// 저장소에 올라간 코드만 배포하므로 누가 불러도 main 그대로일 뿐입니다 (1분에 한 번까지).
// 처음 한 번: script.google.com/home/usersettings 에서 'Google Apps Script API' 켜기 + appsscript.json 에 oauthScopes 추가 + 편집기에서 setupSelfUpdate 실행(권한 허용).
const SELF_DEPLOY_ID = 'AKfycbzEZuoBNiHYs_kkxODw3WEqmLALuTG4mpvzgncyehOkNQ2v-a4qusrm-dPH2iNne77LKw';
const SELF_SRC = 'https://raw.githubusercontent.com/MFGKOREA/label-list/main/apps-script/label/Code.gs';

function selfUpdate_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('self_update')) return { error: '1분 뒤에 다시' };
  cache.put('self_update', '1', 60);
  const src = UrlFetchApp.fetch(SELF_SRC + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (src.getResponseCode() !== 200) return { error: '저장소 코드를 못 받음 ' + src.getResponseCode() };
  const code = src.getContentText();
  if (code.indexOf('function doPost') < 0 || code.indexOf('function selfUpdate_') < 0) return { error: '받은 코드가 이상함 (doPost/selfUpdate_ 없음)' };
  const api = 'https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId();
  const H = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  const call = (path, method, body) => {
    const res = UrlFetchApp.fetch(api + path, { method: method || 'get', headers: H, contentType: 'application/json', payload: body ? JSON.stringify(body) : undefined, muteHttpExceptions: true });
    const d = JSON.parse(res.getContentText() || '{}');
    if (res.getResponseCode() >= 300) throw new Error(path + ' ' + res.getResponseCode() + ' ' + JSON.stringify(d).slice(0, 300));
    return d;
  };
  try {
    const cur = call('/content');
    const files = cur.files.map((f) => (f.type === 'SERVER_JS' && f.name === 'Code' ? { name: f.name, type: f.type, source: code } : { name: f.name, type: f.type, source: f.source }));
    if (!files.some((f) => f.name === 'Code')) throw new Error('Code 파일을 못 찾음');
    call('/content', 'put', { files: files });
    const ver = call('/versions', 'post', { description: '자동 배포 ' + new Date().toISOString() });
    call('/deployments/' + SELF_DEPLOY_ID, 'put', { deploymentConfig: { versionNumber: ver.versionNumber, manifestFileName: 'appsscript', description: '자동 배포 v' + ver.versionNumber } });
    return { ok: true, version: ver.versionNumber };
  } catch (err) { return { error: String(err.message || err) }; }
}

// 배포 뒤에 다시 돌려야 하는 설치 함수만 (정해진 것만)
function adminRun_(fn) {
  const ok = { installPushTrigger: installPushTrigger, installBackupTrigger: installBackupTrigger, installTracePruneTrigger: installTracePruneTrigger, backupDaily: backupDaily };
  if (!ok[fn]) return { error: '허용되지 않은 함수' };
  const cache = CacheService.getScriptCache();
  if (cache.get('admin_' + fn)) return { error: '1분 뒤에 다시' };
  cache.put('admin_' + fn, '1', 60);
  try { ok[fn](); return { ok: true, fn: fn }; } catch (err) { return { error: String(err.message || err) }; }
}

// 편집기에서 한 번 실행: 권한 확인 (Apps Script API 를 켰는지, 배포를 볼 수 있는지)
function setupSelfUpdate() {
  const res = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId() + '/deployments/' + SELF_DEPLOY_ID, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  Logger.log(res.getResponseCode() === 200 ? '스스로 배포 준비 완료' : '아직 안 됨: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
}

function pushStat_() {
  const counts = {};
  pushRows_().forEach((r) => { counts[r.store] = (counts[r.store] || 0) + 1; });
  let auth = '';
  try { fcmAuth_(); auth = 'ok'; } catch (err) { auth = String(err.message || err).slice(0, 200); }
  let sa = '', project = '';
  try { const j = JSON.parse(PropertiesService.getScriptProperties().getProperty('FCM_SA') || '{}'); sa = j.client_email || ''; project = j.project_id || ''; } catch (err) {}
  return { counts: counts, lastError: CacheService.getScriptCache().get('push_err') || '', fcmAuth: auth, serviceAccount: sa, saProject: project };
}
