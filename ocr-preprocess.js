// 라벨 사진 전처리 (Canvas). 구겨진 비닐 그림자·성에 반사·도트 폰트 끊김 때문에 1차 OCR이 날짜를 놓쳤을 때,
// 사진을 편 사본으로 한 번 더 읽기 위한 모듈. .claude/skills/barcode-ocr-tuner/SKILL.md 3장 파이프라인을
// 휴대폰에서 바로 도는 경량 코드로 옮긴 것: 그레이스케일 → 대비 증폭 → 국소 적응형 임계 → 모폴로지.
//
// 계산은 전부 복사본 캔버스에서만 한다. 원본 사진(dataUrl·파일)은 읽기만 하고 절대 덮어쓰지 않는다.
// index.html 과 테스트(tools/ocr-preprocess.test.mjs)가 같이 씀.
(function (g) {
  "use strict";
  const VERSION = 1;
  let lastRun = null; // 마지막 처리 크기·시간 (현장에서 느릴 때 확인용)

  const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v >>> 0);

  // ① 회색조: 휘도(Rec.601). RGBA(4바이트/픽셀) → Uint8Array(1바이트/픽셀)
  function toGrayscale(rgba, w, h) {
    const n = (w * h) | 0, gray = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8; // 0.299 / 0.587 / 0.114
    }
    return gray;
  }

  // ② 대비 증폭: 히스토그램 2%~98% 클리핑 후 0~255로 펴기 (CLAHE 대신 값싼 스트레칭)
  function contrastStretch(gray, low, high) {
    const loP = low == null ? 0.02 : low, hiP = high == null ? 0.02 : high;
    const total = gray.length;
    if (!total) return gray;
    const hist = new Uint32Array(256);
    for (let i = 0; i < total; i++) hist[gray[i]]++;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * loP) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * hiP) { hi = v; break; } }
    if (hi <= lo) return gray; // 한 값뿐인 사진은 그대로 둔다
    const scale = 255 / (hi - lo), lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) lut[v] = clamp8((v - lo) * scale);
    for (let i = 0; i < total; i++) gray[i] = lut[gray[i]];
    return gray;
  }

  // ③ 국소 적응형 임계처리: 합산 면적표(integral image)로 창 평균을 O(1)에 구한다 → 전체 O(W*H).
  //    전역 임계값은 구김 그림자에서 글자를 통째로 지우므로 반드시 국소 평균을 쓴다.
  //    픽셀이 주변 평균보다 bias 이상 어두우면 글자(0), 아니면 배경(255).
  function adaptiveThreshold(gray, w, h, blockSize, bias) {
    const b = blockSize > 2 ? blockSize | 0 : 31;
    const half = b >> 1;
    const cut = bias == null ? 8 : bias;
    const out = new Uint8Array(w * h);
    const iw = w + 1;
    const sum = new Uint32Array(iw * (h + 1)); // 1600px까지는 255*픽셀 합이 Uint32 범위 안
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      const rowBase = (y + 1) * iw, prevBase = y * iw, srcBase = y * w;
      for (let x = 0; x < w; x++) {
        rowSum += gray[srcBase + x];
        sum[rowBase + x + 1] = sum[prevBase + x + 1] + rowSum;
      }
    }
    for (let y = 0; y < h; y++) {
      const y0 = y - half > 0 ? y - half : 0;
      const y1 = y + half < h - 1 ? y + half : h - 1;
      const r0 = y0 * iw, r1 = (y1 + 1) * iw;
      const lineBase = y * w;
      for (let x = 0; x < w; x++) {
        const x0 = x - half > 0 ? x - half : 0;
        const x1 = x + half < w - 1 ? x + half : w - 1;
        const area = (y1 - y0 + 1) * (x1 - x0 + 1);
        const s = sum[r1 + x1 + 1] - sum[r0 + x1 + 1] - sum[r1 + x0] + sum[r0 + x0];
        out[lineBase + x] = gray[lineBase + x] * area < s - cut * area ? 0 : 255;
      }
    }
    return out;
  }

  // 흑백(0/255) 이진 이미지 위 min/max 필터. 가로·세로로 나눠 돌려 사각형 창과 같은 결과를 싸게 낸다.
  function slide(src, dst, w, h, rad, dilate, horizontal) {
    const len = horizontal ? w : h, lines = horizontal ? h : w;
    for (let l = 0; l < lines; l++) {
      for (let i = 0; i < len; i++) {
        let hit = dilate ? 0 : 1;
        const from = i - rad > 0 ? i - rad : 0, to = i + rad < len - 1 ? i + rad : len - 1;
        for (let j = from; j <= to; j++) {
          const v = horizontal ? src[l * w + j] : src[j * w + l];
          if (dilate) { if (v) { hit = 1; break; } }
          else if (!v) { hit = 0; break; }
        }
        dst[horizontal ? l * w + i : i * w + l] = hit;
      }
    }
  }

  // ④ 모폴로지: close(팽창→침식)는 도트 폰트 끊긴 획을 잇고, open(침식→팽창)은 성에·핏물 반사 반점을 지운다.
  function morphology(gray, w, h, op, r) {
    const rad = r > 0 ? r | 0 : 1;
    const n = w * h;
    const dark = new Uint8Array(n);
    for (let i = 0; i < n; i++) dark[i] = gray[i] < 128 ? 1 : 0;
    const tmp = new Uint8Array(n), out = new Uint8Array(n);
    let cur = dark;
    // 한 연산 = 가로 → 세로 (두 번이면 정사각 창)
    const runPass = (dilate) => {
      slide(cur, tmp, w, h, rad, dilate, true);
      slide(tmp, out, w, h, rad, dilate, false);
      cur = out;
    };
    const dilateFirst = op !== "open";
    runPass(dilateFirst);       // close면 팽창, open이면 침식
    runPass(!dilateFirst);      // 이어서 반대 연산
    for (let i = 0; i < n; i++) out[i] = cur[i] ? 0 : 255;
    return out;
  }

  // 파이프라인 전체: 회색조 배열을 받아 흑백 배열을 돌려준다 (Canvas 없이도 시험 가능)
  function processGray(gray, w, h, opts) {
    const o = opts || {};
    contrastStretch(gray, o.clipLow, o.clipHigh);
    let bin = adaptiveThreshold(gray, w, h, o.blockSize, o.bias);
    if (o.morph !== "none") bin = morphology(bin, w, h, o.morph || "close", o.morphRadius);
    return bin;
  }

  function supported() {
    try { return typeof document !== "undefined" && typeof document.createElement === "function"; }
    catch (e) { return false; }
  }

  function loadImage(src) {
    return new Promise((ok, fail) => {
      if (typeof Image !== "function") { fail(new Error("이미지 기능 없음")); return; }
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => fail(new Error("사진을 열 수 없습니다"));
      img.src = src;
    });
  }

  // 원본은 읽기만 하고, 결과는 새 캔버스(복사본)에 그린다. 긴 변이 maxEdge보다 크면 줄이되 늘리지는 않는다
  // (작은 사진을 늘리면 보간으로 도트 폰트 획이 뭉개짐).
  async function preprocessCanvas(src, opts) {
    const o = opts || {};
    if (!supported()) return null;
    const img = await loadImage(src);
    const nw = img.naturalWidth || img.width || 0, nh = img.naturalHeight || img.height || 0;
    if (!nw || !nh) return null;
    const maxEdge = o.maxEdge > 0 ? o.maxEdge : 1800;
    const k = Math.min(1, maxEdge / Math.max(nw, nh));
    const w = Math.max(8, Math.round(nw * k)), h = Math.max(8, Math.round(nh * k));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !ctx.getImageData) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const t0 = g.performance && g.performance.now ? g.performance.now() : Date.now();
    const bin = processGray(toGrayscale(data.data, w, h), w, h, o);
    const out = ctx.createImageData(w, h);
    for (let i = 0, p = 0; i < bin.length; i++, p += 4) {
      out.data[p] = out.data[p + 1] = out.data[p + 2] = bin[i];
      out.data[p + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    const t1 = g.performance && g.performance.now ? g.performance.now() : Date.now();
    lastRun = { w: w, h: h, ms: Math.round(t1 - t0) };
    return canvas;
  }

  // 사진 dataUrl → 전처리한 사진 dataUrl. 실패하면 빈 문자열(부르는 쪽은 1차 결과 그대로 씀).
  async function preprocessDataUrl(dataUrl, opts) {
    if (!dataUrl) return "";
    try {
      const canvas = await preprocessCanvas(dataUrl, opts);
      if (!canvas) return "";
      return canvas.toDataURL((opts && opts.mime) || "image/png");
    } catch (e) {
      lastRun = null;
      return "";
    }
  }

  function lastStats() { return lastRun ? { w: lastRun.w, h: lastRun.h, ms: lastRun.ms } : null; }

  g.OcrPreprocess = {
    version: VERSION,
    supported: supported,
    preprocessDataUrl: preprocessDataUrl,
    preprocessCanvas: preprocessCanvas,
    processGray: processGray,
    toGrayscale: toGrayscale,
    contrastStretch: contrastStretch,
    adaptiveThreshold: adaptiveThreshold,
    morphology: morphology,
    lastStats: lastStats,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
