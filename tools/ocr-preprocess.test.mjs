import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// 캔버스 없이 계산 부분만 시험한다 (셸·CI 에는 document 가 없다). 휴대폰에서 도는 코드는 같은 함수를 쓴다.
const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL("../ocr-preprocess.js", import.meta.url), "utf8"), sandbox);
const P = sandbox.OcrPreprocess;

assert.equal(P.version, 1);
assert.equal(typeof P.preprocessDataUrl, "function");
assert.equal(typeof P.preprocessCanvas, "function");
assert.equal(P.supported(), false); // document 가 없는 곳
assert.equal(await P.preprocessDataUrl("data:image/png;base64,AAAA"), ""); // 실패하면 빈 문자열(1차 결과 유지)
assert.equal(P.lastStats(), null);

// ① 회색조: 휘도(0.299R + 0.587G + 0.114B)
assert.equal(P.toGrayscale(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1)[0], 76);
assert.equal(P.toGrayscale(new Uint8ClampedArray([0, 255, 0, 255]), 1, 1)[0], 149);
assert.equal(P.toGrayscale(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1)[0], 255);
assert.equal(P.toGrayscale(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1)[0], 0);

// ② 대비 증폭: 좁은 밴드(100~110)를 0~255로 편다
const narrow = Uint8Array.from([100, 102, 104, 106, 108, 110]);
P.contrastStretch(narrow);
assert.equal(narrow[0], 0);
assert.equal(narrow[5], 255);
assert.ok(narrow[2] > 60 && narrow[2] < 200);
// 한 값뿐인 사진은 건드리지 않는다
const flat = Uint8Array.from([128, 128, 128, 128]);
P.contrastStretch(flat);
assert.deepEqual(Array.from(flat), [128, 128, 128, 128]);

// ③ 적응형 임계처리: 왼쪽(그늘) 40 → 오른쪽(반사) 220 그라데이션 위에 같은 세로 획 두 개
const W = 80, H = 40;
const shaded = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) shaded[y * W + x] = 60 + Math.round(130 * (x / (W - 1)));
}
for (let y = 12; y < 28; y++) for (const x of [10, 11, 60, 61]) shaded[y * W + x] = 15;
const bin = P.adaptiveThreshold(shaded, W, H, 31, 8);
assert.equal(bin[20 * W + 10], 0, "그늘 쪽 획");
assert.equal(bin[20 * W + 60], 0, "반사 쪽 획 — 전역 임계값이면 놓치는 자리");
assert.equal(bin[20 * W + 35], 255, "가운데 배경");
assert.equal(bin[30 * W + 74], 255, "반사 배경");
for (let i = 0; i < bin.length; i++) assert.ok(bin[i] === 0 || bin[i] === 255, "이진 결과만 나와야 함");

// ④ 모폴로지: close 는 1픽셀 끊긴 획을 잇는다
const W2 = 24, H2 = 12;
const gap = new Uint8Array(W2 * H2).fill(255);
gap[5 * W2 + 5] = 0;
gap[5 * W2 + 7] = 0;
const closed = P.morphology(gap, W2, H2, "close", 1);
assert.equal(closed[5 * W2 + 5], 0);
assert.equal(closed[5 * W2 + 6], 0, "끊긴 1픽셀 연결");
assert.equal(closed[5 * W2 + 7], 0);
assert.equal(closed[1 * W2 + 1], 255);

// open 은 성에·반사 반점(한 픽셀)을 지우고 획 덩어리는 남긴다
const speck = new Uint8Array(W2 * H2).fill(255);
speck[2 * W2 + 2] = 0;
for (let y = 5; y < 8; y++) for (let x = 5; x < 8; x++) speck[y * W2 + x] = 0;
const opened = P.morphology(speck, W2, H2, "open", 1);
assert.equal(opened[2 * W2 + 2], 255, "반점 제거");
assert.equal(opened[6 * W2 + 6], 0, "글자 덩어리 유지");

// 파이프라인 전체: 민무늬 사진은 모두 배경(255)
const plain = new Uint8Array(64 * 64).fill(200);
const plainOut = P.processGray(plain, 64, 64, { blockSize: 15, morph: "close" });
for (let i = 0; i < plainOut.length; i++) assert.equal(plainOut[i], 255);

// 빠르기: 1200×1600(휴대폰 라벨 사진 크기)에서 적응형 임계 + 모폴로지가 몇 ms 에 끝나는지 남긴다
const bigW = 1200, bigH = 1600;
const big = new Uint8Array(bigW * bigH);
for (let y = 0; y < bigH; y++) {
  for (let x = 0; x < bigW; x++) {
    const carcass = 30 + ((x * 7 + y * 3) % 60); // 구김 그림자 흉내
    big[y * bigW + x] = carcass > 80 ? 220 : carcass;
  }
}
for (let y = 400; y < 460; y++) for (let x = 200; x < 800; x++) if (x % 9 < 4) big[y * bigW + x] = 20;

const t0 = Date.now();
const bigBin = P.processGray(big.slice(), bigW, bigH, { blockSize: 31, morph: "close", morphRadius: 1 });
const ms = Date.now() - t0;
assert.equal(bigBin.length, bigW * bigH);
assert.ok(ms < 3000, "1200×1600 전처리가 3초를 넘음: " + ms + "ms");
console.log("ocr-preprocess tests ok (1200×1600 전처리 " + ms + "ms, 이 기기 기준)");
