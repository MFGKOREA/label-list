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

assert.equal(compareTrace("002123456789", "0021 2345 6789"), "ok");
assert.equal(compareTrace("L21806200434001", "L21806200434002"), "bad");
assert.equal(compareTrace("002123456789", ""), "bad");
assert.equal(compareTrace("", ""), "empty");
assert.equal(compareTrace("I21806200434001", "L 2180 6200 4340 01"), "ok");

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /src="trace-nos\.js"/);
assert.match(html, /id="trFile"[^>]*capture="environment"/);
assert.match(html, /id="trCuts"/);
for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);
new Function(fs.readFileSync(new URL("../trace-nos.js", import.meta.url), "utf8"));
new Function(fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8"));

const gs = fs.readFileSync(new URL("../apps-script/label/Code.gs", import.meta.url), "utf8");
assert.match(gs, /TRACE_KEEP_DAYS = 30/);
assert.match(gs, /function pruneTraceDaily/);
assert.match(gs, /function installTracePruneTrigger/);
assert.match(gs, /pruneTrace_\(traceCutoff_\(\)\)/);

console.log("trace-nos tests ok");
