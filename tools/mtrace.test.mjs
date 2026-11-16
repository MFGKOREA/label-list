import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Apps Script 없이 Code.gs 의 이력 조회(캐시·미확정) 부분만 시험한다.
// 구글 객체(시트·속성·UrlFetch·잠금·유틸)를 가짜로 만들어 두고 같은 코드를 돌린다.

function makeSheet(name) {
  const sh = {
    name: name,
    rows: [],
    getDataRange() { return { getValues: () => sh.rows.map((r) => r.slice()) }; },
    getLastRow() { return sh.rows.length; },
    setFrozenRows() {},
    appendRow(r) { sh.rows.push(r.slice()); },
    deleteRow() {},
    getRange(a, b, nr, nc) {
      if (typeof a === "string") return { setNumberFormat() {} }; // 'A:G' 같은 칸 범위
      const row0 = a - 1, col0 = b - 1, n = nr || 1, m = nc || 1;
      return {
        setNumberFormat() {},
        getValues() {
          const out = [];
          for (let i = 0; i < n; i++) {
            const line = sh.rows[row0 + i] || [];
            const one = [];
            for (let j = 0; j < m; j++) one.push(line[col0 + j] === undefined ? "" : line[col0 + j]);
            out.push(one);
          }
          return out;
        },
        setValues(vals) {
          for (let i = 0; i < vals.length; i++) {
            const line = sh.rows[row0 + i] || (sh.rows[row0 + i] = []);
            for (let j = 0; j < vals[i].length; j++) line[col0 + j] = vals[i][j];
          }
        },
      };
    },
  };
  return sh;
}

function makeSandbox(opts) {
  const o = opts || {};
  const sheets = new Map();
  const ss = {
    getSheetByName(n) { return sheets.get(n) || null; },
    insertSheet(n) { const s = makeSheet(n); sheets.set(n, s); return s; },
  };
  const props = Object.assign({}, o.props || {});
  const calls = { fetch: [] };
  const sandbox = {
    console: console,
    Date: Date,
    JSON: JSON,
    Number: Number,
    String: String,
    RegExp: RegExp,
    Map: Map,
    Math: Math,
    encodeURIComponent: encodeURIComponent,
    SpreadsheetApp: { getActive: () => ss, openById: () => ss, create: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: () => "2026-11-16 09:40" },
    Session: { getScriptTimeZone: () => "Asia/Seoul" },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (t) => { const out = { getContent: () => t, getMimeType: () => "application/json" }; out.setMimeType = () => out; return out; },
    },
    UrlFetchApp: {
      fetch(url, params) {
        calls.fetch.push({ url: url, params: params });
        if (o.fetchError) throw new Error("연결 실패");
        return { getResponseCode: () => (o.status || 200), getContentText: () => o.body || "" };
      },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL("../apps-script/label/Code.gs", import.meta.url), "utf8"), sandbox);
  return { sandbox, sheets, props, calls, run: (code) => vm.runInContext(code, sandbox) };
}

// 실제 응답 모양 (sirloin-bondaero/mtrace-api-client 의 MockAnimalTraceResponse.xml 과 같은 구조)
const OK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<response>
  <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
  <body><items>
    <item><birthYmd>20200212</birthYmd><cattleNo>410002147460101</cattleNo><infoType>1</infoType><lsTypeNm>한우</lsTypeNm><sexNm>거세</sexNm></item>
    <item><farmAddr>인천광역시 강화군 송해면</farmAddr><infoType>2</infoType><regYmd>20220523</regYmd></item>
    <item><butcheryPlaceNm>농협 부천축산물공판장</butcheryPlaceNm><butcheryYmd>20220523</butcheryYmd><gradeNm>2</gradeNm><infoType>3</infoType></item>
  </items></body>
</response>`;
const ERR_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response><header><resultCode>99</resultCode><resultMsg>등록되지 않은 서비스키</resultMsg></header></response>`;
const NO_BUTCHERY_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
<body><items><item><cattleNo>410002147460101</cattleNo><infoType>1</infoType><lsTypeNm>한우</lsTypeNm></item></items></body></response>`;

// ① 키 미설정: 확정하지 않고 pending. 구글 API 를 부르지도 않는다.
{
  const t = makeSandbox();
  const r = JSON.parse(t.run('JSON.stringify(traceLookup_("0021-4746-0101"))'));
  assert.equal(r.ok, false);
  assert.equal(r.pending, true);
  assert.equal(r.source, "pending");
  assert.equal(r.traceNo, "002147460101");
  assert.match(r.note, /미확정/);
  assert.match(r.note, /API 키 미설정/);
  assert.equal(t.calls.fetch.length, 0);
  assert.ok(t.sheets.get("이력캐시"), "이력캐시 탭을 만든다");
  assert.deepEqual(Array.from(t.sheets.get("이력캐시").rows[0]), ["traceNo", "butcherDate", "grade", "partName", "expiry", "source", "verifiedAt"]);
}

// ② 번호 형식이 아니면 조회하지 않는다
{
  const t = makeSandbox({ props: { MTRACE_API_KEY: "k" } });
  const r = JSON.parse(t.run('JSON.stringify(traceLookup_("12345"))'));
  assert.equal(r.pending, true);
  assert.match(r.note, /형식/);
  assert.equal(t.calls.fetch.length, 0);
}

// ③ 키 + 정상 응답: 도축일자·등급을 뽑아 캐시에 담고 source: 'api'
{
  const t = makeSandbox({ props: { MTRACE_API_KEY: "k" }, body: OK_XML });
  const r = JSON.parse(t.run('JSON.stringify(traceLookup_("002147460101"))'));
  assert.equal(r.ok, true);
  assert.equal(r.source, "api");
  assert.equal(r.butcherDate, "2022-05-23");
  assert.equal(r.grade, "2");
  assert.equal(r.partName, ""); // API 에 없는 값은 비워 둔다 (지어내지 않음)
  assert.equal(r.expiry, "");
  assert.equal(r.traceNo, "002147460101");
  assert.equal(t.calls.fetch.length, 1);
  assert.match(t.calls.fetch[0].url, /animalTrace\/traceNoSearch\?serviceKey=k&traceNo=002147460101$/);
  assert.equal(t.calls.fetch[0].params.muteHttpExceptions, true);
  const row = t.sheets.get("이력캐시").rows[1];
  assert.deepEqual(Array.from(row), ["002147460101", "2022-05-23", "2", "", "", "api", "2026-11-16 09:40"]);

  // ④ 같은 번호를 다시: API 를 부르지 않고 캐시에서 (source: 'cache')
  t.sandbox.__body = ERR_XML; // API 가 죽어 있어도
  const r2 = JSON.parse(t.run('JSON.stringify(traceLookup_("002147460101"))'));
  assert.equal(r2.ok, true);
  assert.equal(r2.source, "cache");
  assert.equal(r2.butcherDate, "2022-05-23");
  assert.equal(t.calls.fetch.length, 1);
}

// ⑤ 키 + 오류 응답(resultCode 99): pending
{
  const t = makeSandbox({ props: { MTRACE_API_KEY: "k" }, body: ERR_XML });
  const r = JSON.parse(t.run('JSON.stringify(traceLookup_("002147460101"))'));
  assert.equal(r.ok, false);
  assert.equal(r.pending, true);
  assert.match(r.note, /미확정/);
  assert.equal(t.sheets.get("이력캐시").rows.length, 1, "실패는 캐시에 넣지 않는다");
}

// ⑥ 키 + 네트워크 예외: pending
{
  const t = makeSandbox({ props: { MTRACE_API_KEY: "k" }, fetchError: true });
  const r = JSON.parse(t.run('JSON.stringify(traceLookup_("002147460101"))'));
  assert.equal(r.pending, true);
  assert.match(r.note, /미확정/);
}

// ⑦ 키 + HTTP 500: pending
{
  const t = makeSandbox({ props: { MTRACE_API_KEY: "k" }, status: 500, body: "oops" });
  const r = JSON.parse(t.run('JSON.stringify(traceLookup_("002147460101"))'));
  assert.equal(r.pending, true);
  assert.match(r.note, /500/);
}

// ⑧ 도축 전(등급 정보 없음): 확정하지 않는다
{
  const t = makeSandbox({ props: { MTRACE_API_KEY: "k" }, body: NO_BUTCHERY_XML });
  const r = JSON.parse(t.run('JSON.stringify(traceLookup_("002147460101"))'));
  assert.equal(r.pending, true);
  assert.match(r.note, /도축·등급 정보 없음/);
}

// ⑨ 앱이 부르는 두 길: GET ?api=1&traceLookup=… / POST action: 'trace_lookup'
{
  const t = makeSandbox({ props: { MTRACE_API_KEY: "k" }, body: OK_XML });
  const get = JSON.parse(t.run('doGet({ parameter: { api: "1", traceLookup: "002147460101" } }).getContent()'));
  assert.equal(get.ok, true);
  assert.equal(get.butcherDate, "2022-05-23");

  const post = JSON.parse(t.run('doPost({ postData: { contents: JSON.stringify({ action: "trace_lookup", traceNo: "002147460101" }) } }).getContent()'));
  assert.equal(post.source, "cache"); // 이미 ⑨의 GET 이 캐시에 담았다
}

// ⑩ XML 파서 단독: 여덟 자리 날짜가 아니면 빈 값
{
  const t = makeSandbox();
  const p = JSON.parse(t.run('JSON.stringify(traceParse_("<response><header><resultCode>00</resultCode></header><body><items><item><infoType>3</infoType><butcheryYmd>2022</butcheryYmd><gradeNm>1++</gradeNm><partNm>등심</partNm></item></items></body></response>"))'));
  assert.equal(p.ok, true);
  assert.equal(p.butcherDate, "");
  assert.equal(p.grade, "1++");
  assert.equal(p.partName, "등심");
}

console.log("mtrace tests ok (캐시 우선 · API 파싱 · 미확정 방어)");
