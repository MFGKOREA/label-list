// 포장 바코드 읽기. 라벨·박스 사진 한 장에서 code_128·itf·ean_13·code_39·qr 을 읽어
// GS1-128((01) GTIN / (10) 로트 / (17) 유통기한)과 12자리 이력번호를 뽑는다.
//
// 1순위: 브라우저 내장 BarcodeDetector (안드로이드 크롬·사파리 최신). 외부 파일 없음.
// 2순위: 없는 기기(구형 iOS 사파리 등)에서만 ZXing 을 그때 한 번 내려받는다 (약 340KB).
// 읽은 문자열 해석은 trace-nos.js 의 parseGs1Barcode / normTrace 를 그대로 쓴다.
//
// 계산은 복사본 캔버스에서만 하고 원본 사진은 건드리지 않는다.
// index.html 과 테스트(tools/barcode-decoder.test.mjs)가 같이 씀.
(function (g) {
  "use strict";
  const VERSION = 1;
  const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
  // 매장 라벨·박스에 실제로 찍히는 형식만 (많이 넣으면 느려지고 엉뚱한 값을 물어 옴)
  const FORMATS = ["code_128", "itf", "ean_13", "code_39", "qr_code"];
  let zxLoad = null;
  let lastRun = null; // 마지막으로 어느 엔진이 몇 ms 에 읽었는지 (현장 확인용)

  // 읽은 문자열 → { raw, gs1, traceNo, via }
  // GS1 이 아니어도 12자리 이력번호만 들어 있는 바코드(축산물 박스)가 흔해서 둘 다 본다.
  function interpret(raw) {
    const text = String(raw == null ? "" : raw).trim();
    const T = g.TraceNos;
    const out = { raw: text, gs1: null, traceNo: "", via: "" };
    if (!text || !T) return out;
    const gs1 = T.parseGs1Barcode(text);
    // 숫자만 있는 바코드(축산물 박스의 이력번호)는 GS1 로 읽으면 (00) SSCC 로 잘못 잡힌다.
    // GTIN·로트·유통기한처럼 실제로 쓸 수 있는 칸이 하나라도 있을 때만 GS1 로 본다.
    out.gs1 = gs1 && gs1.ok && (gs1.gtin || gs1.lot || gs1.expiry || gs1.serial) ? gs1 : null;
    out.traceNo = T.normTrace(text) || (out.gs1 && out.gs1.lot ? T.normTrace(out.gs1.lot) : "");
    return out;
  }

  function supported() {
    try { return typeof document !== "undefined" && typeof document.createElement === "function"; }
    catch (e) { return false; }
  }

  function hasNative() { return typeof g.BarcodeDetector === "function"; }

  // 지원 형식은 기기마다 다름. 없는 형식을 넣으면 생성자가 던지므로 먼저 걸러 낸다.
  async function nativeDecode(source) {
    const D = g.BarcodeDetector;
    if (typeof D !== "function") return "";
    let fmts = FORMATS;
    if (typeof D.getSupportedFormats === "function") {
      try {
        const ok = await D.getSupportedFormats();
        fmts = FORMATS.filter((f) => ok.indexOf(f) >= 0);
      } catch (e) { /* 목록을 못 물으면 그대로 시도 */ }
    }
    if (!fmts.length) return "";
    try {
      const hits = await new D({ formats: fmts }).detect(source);
      return hits && hits.length ? String(hits[0].rawValue || "") : "";
    } catch (e) { return ""; } // 못 읽는 사진은 예외로 떨어짐 — 조용히 넘김
  }

  function loadZxing() {
    return zxLoad || (zxLoad = new Promise((ok, fail) => {
      if (g.ZXing) { ok(g.ZXing); return; }
      const sc = document.createElement("script");
      sc.src = ZXING_URL;
      sc.onload = () => (g.ZXing ? ok(g.ZXing) : fail(new Error("엔진 없음")));
      sc.onerror = () => { zxLoad = null; fail(new Error("엔진을 내려받지 못함")); };
      document.head.append(sc);
    }));
  }

  function zxingReader(Z) {
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.ITF, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.CODE_39]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    return new Z.BrowserMultiFormatReader(hints);
  }

  // 주소(data: 또는 blob:)에서 읽는다. ZXing 은 캔버스를 못 받아 주소로 넘긴다.
  async function zxingDecode(url) {
    const Z = await loadZxing();
    const r = await zxingReader(Z).decodeFromImage(undefined, url);
    return r ? String(r.getText() || "") : "";
  }

  function loadImage(src) {
    return new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => fail(new Error("사진을 열 수 없습니다"));
      img.src = src;
    });
  }

  // 흑백 반전: 은색·비닐 포장에서 바가 거꾸로(밝은 바탕에 흰 바) 찍힌 사진용
  function invert(canvas) {
    try {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < d.data.length; i += 4) {
        d.data[i] = 255 - d.data[i];
        d.data[i + 1] = 255 - d.data[i + 1];
        d.data[i + 2] = 255 - d.data[i + 2];
      }
      ctx.putImageData(d, 0, 0);
    } catch (e) {}
    return canvas;
  }

  // 사진(dataUrl) → { raw, gs1, traceNo, via } 또는 null(못 읽음)
  async function decode(src) {
    if (!supported()) return null;
    const url = typeof src === "string" ? src : (src && src.toDataURL ? src.toDataURL("image/png") : "");
    if (!url) return null;
    const t0 = g.performance && g.performance.now ? g.performance.now() : Date.now();
    let raw = "", via = "";
    let img = null;
    try { img = await loadImage(url); } catch (e) { return null; }

    raw = await nativeDecode(img);
    if (raw) via = "native";
    if (!raw) {
      try { raw = await zxingDecode(url); if (raw) via = "zxing"; } catch (e) {}
    }
    // 원본에서 못 읽으면: 그림자·구김을 편 사본 → 그 사본을 반전한 것 순으로 한 번씩 더
    if (!raw && g.OcrPreprocess && typeof g.OcrPreprocess.preprocessCanvas === "function") {
      for (let tryInvert = 0; tryInvert < 2 && !raw; tryInvert++) {
        try {
          const cv = await g.OcrPreprocess.preprocessCanvas(url);
          if (!cv) break;
          if (tryInvert) invert(cv);
          const alt = cv.toDataURL("image/png");
          raw = await nativeDecode(cv);
          if (!raw) { try { raw = await zxingDecode(alt); } catch (e) {} }
          if (raw) via = tryInvert ? "preprocess-invert" : "preprocess";
        } catch (e) {}
      }
    }
    const t1 = g.performance && g.performance.now ? g.performance.now() : Date.now();
    lastRun = { via: via, ms: Math.round(t1 - t0), ok: !!raw };
    if (!raw) return null;
    const out = interpret(raw);
    out.via = via;
    return out;
  }

  function lastStats() { return lastRun ? { via: lastRun.via, ms: lastRun.ms, ok: lastRun.ok } : null; }

  g.BarcodeScan = {
    version: VERSION,
    formats: FORMATS,
    supported: supported,
    hasNative: hasNative,
    interpret: interpret,
    decode: decode,
    lastStats: lastStats,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
