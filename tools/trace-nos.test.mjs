import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL("../trace-nos.js", import.meta.url), "utf8"), sandbox);
const { normTrace, traceNos, compareTrace } = sandbox.TraceNos;
const KINDS = ["비프립", "립아이", "안심", "채끝", "등심", "부채살", "살치살", "갈비", "티본", "척아이롤", "목살", "삼겹", "항정", "차돌", "우삼겹", "스테이크"];

const nos = (text) => Array.from(traceNos(text, KINDS), (x) => String(x.no + (x.kind ? ":" + x.kind : "")));

assert.equal(normTrace("002123456789"), "002123456789");
assert.equal(normTrace("0021-2345-6789"), "002123456789");
assert.equal(normTrace("0021 2345 6789"), "002123456789");
assert.equal(normTrace("L21806200434001"), "L21806200434001");
assert.equal(normTrace("L 2180 6200 4340 01"), "L21806200434001");
assert.equal(normTrace("l-2180-6200-4340-01"), "L21806200434001");
assert.equal(normTrace("I21806200434001"), "L21806200434001");
assert.equal(normTrace("|21806200434001"), "L21806200434001");
assert.equal(normTrace("A1234567890123"), "A1234567890123");
assert.equal(normTrace("B 1234 5678 9012 3456"), "B1234567890123456");
assert.equal(normTrace("010-1234-5678"), "");
assert.equal(normTrace("123-45-67890"), "");
assert.equal(normTrace("1234567890123"), "");
assert.equal(normTrace("20261103"), "");
assert.equal(normTrace("202611031234"), "");

assert.deepEqual(nos("이력번호 0021 2345 6789"), ["002123456789"]);
assert.deepEqual(nos("2026.11.03\n등심 002123456789"), ["002123456789:등심"]);
assert.deepEqual(nos("채끝 L21806200434001"), ["L21806200434001:채끝"]);
assert.deepEqual(nos("묶음번호: L 2180 6200 4340 01"), ["L21806200434001"]);
assert.deepEqual(
  nos("등심 0021-2345-6789\n채끝 A1234 5678 9012 34"),
  ["002123456789:등심", "A12345678901234:채끝"]
);
assert.deepEqual(nos("002123456789 111122223333"), ["002123456789", "111122223333"]);
assert.deepEqual(nos("채끝등심 002123456789"), ["002123456789"]);
assert.deepEqual(nos("2026년 11월 3일 입고\n010-1234-5678\n123-45-67890"), []);
assert.deepEqual(nos("안심\n410012345678"), ["410012345678:안심"]);
// 실제 명세서(유통식별번호 확인 명세서): 수량 10 과 번호가 한 줄에 붙어 있음
assert.deepEqual(nos("품코드 품목 발주수량 유통식별번호 원산지\n002108 냉동_채끝270g_10개단위 발주 10 801001506378 호주산"), ["801001506378:채끝"]);
assert.deepEqual(nos("002108 냉동_등심 10 801001506378 호주산\n002109 냉동_채끝270g 5 801001506999 미국산"), ["801001506378:등심", "801001506999:채끝"]);
assert.deepEqual(nos("수량 10 0021 2345 6789"), ["002123456789"]);
assert.deepEqual(nos("\n유통식별번호 확인 명세서\n87호\n2026년 11월 4일 수요일\n등록번호\n105-86-40937\nMG수원컨벤션센터점\n상\n호\n한국로지스풀(주)\n성명\n서병륜\n귀하\n사업장소재지\n•서울특별시 마포구 마포대로 63-8(도화동,삼창프라자 6층)\n아래와 같이 계산합니다.\n업\n태\n도소매, 도매\n종목\n축산물, 무역\n블코드\n품목\n발주수량\n유통식별번호\n원산지\n002108\n냉동_채끝270g_10개단위 발주\n10\n801001506378\n호주산\n원산지 표시 의무 이행통보\n매입한 물품은 최종 판매 단계까지 한글 원산지 표시를 이행하도록 하여야 하며, 특히 제 3자 양도시는 동 사항을 서면으로 통보 해야 함.\n인수자\n인\n공급자\n인\n담당사원\n※유통식별번호 확인용으로만 사용하는 명세서 입니다.\n매장에 꼭 전달해주세요."), ["801001506378:채끝"]); // 실제 서버가 읽은 명세서 글자 (11.05)
// 표를 칸 단위로 읽은 경우: 품목과 번호가 다른 줄
assert.deepEqual(nos("품목\n냉동_채끝270g_10개단위 발주\n발주수량\n10\n유통식별번호\n801001506378\n원산지\n호주산"), ["801001506378:채끝"]);
assert.deepEqual(nos("품목\n냉동_등심\n냉동_채끝\n유통식별번호\n801001506378\n801001506999"), ["801001506378:등심", "801001506999:채끝"]);

assert.equal(compareTrace("002123456789", "0021 2345 6789"), "ok");
assert.equal(compareTrace("L21806200434001", "L21806200434002"), "bad");
assert.equal(compareTrace("002123456789", ""), "bad");
assert.equal(compareTrace("", ""), "empty");
assert.equal(compareTrace("I21806200434001", "L 2180 6200 4340 01"), "ok");

const { nextTraceShot, traceVerdict } = sandbox.TraceNos;
assert.equal(nextTraceShot("doc"), "등심");
assert.equal(nextTraceShot("등심"), "채끝");
assert.equal(nextTraceShot("채끝"), "");
assert.equal(traceVerdict({
  등심: { docNo: "002123456789", boxNo: "0021 2345 6789" },
  채끝: { docNo: "L21806200434001", boxNo: "L21806200434001" },
}), "save");
assert.equal(traceVerdict({
  등심: { docNo: "002123456789", boxNo: "002123456780" },
  채끝: { docNo: "L21806200434001", boxNo: "L21806200434001" },
}), "fix");
assert.equal(traceVerdict({
  등심: { docNo: "002123456789", boxNo: "" },
  채끝: { docNo: "", boxNo: "" },
}), "wait");
assert.equal(traceVerdict({
  등심: { docNo: "", boxNo: "" },
  채끝: { docNo: "", boxNo: "" },
}), "wait");

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /src="trace-nos\.js"/);
assert.match(html, /id="trFile"[^>]*capture="environment"/);
assert.match(html, /오늘 입고 찍기/);
assert.match(html, /trace:\s*true/);
assert.match(html, /id="trCuts"/);
for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);
new Function(fs.readFileSync(new URL("../trace-nos.js", import.meta.url), "utf8"));
new Function(fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8"));

const gs = fs.readFileSync(new URL("../apps-script/label/Code.gs", import.meta.url), "utf8");
assert.match(gs, /TRACE_KEEP_DAYS = 30/);
assert.match(gs, /function pruneTraceDaily/);
assert.match(gs, /function installTracePruneTrigger/);
assert.match(gs, /pruneTrace_\(traceCutoff_\(\)\)/);
assert.match(gs, /function ocrFile_/);
assert.match(gs, /!!body\.trace/);
// v2 드라이브는 ocr 옵션에 문서 형식을 같이 주면 거절함 ("OCR is not supported for ... google-apps.document")
assert.doesNotMatch(gs, /title: 'ocr_tmp', mimeType: 'application\/vnd\.google-apps\.document' \}, [^)]*ocr: true/);

console.log("trace-nos tests ok");
