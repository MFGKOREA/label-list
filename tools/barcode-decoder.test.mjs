import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// 셸·CI 에는 document·BarcodeDetector 가 없다. 해석 부분과 "기기가 없을 때" 동작만 시험한다.
// 휴대폰에서 도는 읽기 코드(decode)는 같은 함수를 쓴다.
const sandbox = {};
sandbox.globalThis = sandbox;
sandbox.console = console;
sandbox.performance = { now: () => 0 };
sandbox.setTimeout = setTimeout;
vm.createContext(sandbox);
const open = (p) => vm.runInContext(fs.readFileSync(new URL(p, import.meta.url), "utf8"), sandbox);
open("../trace-nos.js");

// document 가 없으면 decode 는 엔진을 부르지 않고 null (사진 화면은 1차 결과 그대로)
open("../barcode-decoder.js");
const B = sandbox.BarcodeScan;

assert.equal(B.version, 1);
assert.deepEqual(Array.from(B.formats), ["code_128", "itf", "ean_13", "code_39", "qr_code"]);
assert.equal(B.supported(), false);
assert.equal(B.hasNative(), false);
assert.equal(await B.decode("data:image/png;base64,AAAA"), null);
assert.equal(B.lastStats(), null);

// GS1-128 무괄호 연속 문자열: (01) GTIN · (17) 유통기한 · (10) 로트
{
  const r = B.interpret("01000123456000121726103010ABC");
  assert.equal(r.raw, "01000123456000121726103010ABC");
  assert.ok(r.gs1);
  assert.equal(r.gs1.gtin, "00012345600012");
  assert.equal(r.gs1.gtinValid, true);
  assert.equal(r.gs1.expiry, "2026-10-30");
  assert.equal(r.gs1.lot, "ABC");
  assert.equal(r.traceNo, "");
}

// 괄호 표기 + FNC1 로 끊은 로트에 12자리 이력번호가 든 포장
{
  const r = B.interpret("(01)00012345600012(17)261115(10)002147460101");
  assert.equal(r.gs1.expiry, "2026-11-15");
  assert.equal(r.traceNo, "002147460101", "로트에서 이력번호를 꺼낸다");
}

// 리더기가 붙이는 심볼로지 식별자 ]C1 · FNC1 앞머리
{
  const r = B.interpret("]C1010001234560001217261112\u001d10L21806200434001");
  assert.ok(r.gs1);
  assert.equal(r.gs1.expiry, "2026-11-12");
  assert.equal(r.traceNo, "L21806200434001");
}

// 숫자만 12자리 (축산물 박스): GS1 SSCC 로 오독하지 않고 이력번호만
{
  const r = B.interpret("002147460101");
  assert.equal(r.raw, "002147460101");
  assert.equal(r.gs1, null);
  assert.equal(r.traceNo, "002147460101");

  const r2 = B.interpret("0021 4746 0101");
  assert.equal(r2.traceNo, "002147460101");
  assert.equal(r2.gs1, null);
}

// 수입 묶음번호(영문+숫자)와 오독 보정(| → I → L)
{
  assert.equal(B.interpret("L21806200434001").traceNo, "L21806200434001");
  assert.equal(B.interpret("|21806200434001").traceNo, "L21806200434001");
}

// 읽을 값이 없는 문자열·빈 값: 예외 없이 조용히 빈 결과
{
  assert.equal(JSON.stringify(B.interpret("")), JSON.stringify({ raw: "", gs1: null, traceNo: "", via: "" }));
  assert.equal(B.interpret(null).traceNo, "");
  assert.equal(B.interpret("HELLO").traceNo, "");
  assert.equal(B.interpret("12345").gs1, null);
}

console.log("barcode-decoder tests ok (GS1-128 · 이력번호 판별 · 기기 없을 때)");
