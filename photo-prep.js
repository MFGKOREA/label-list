// 라벨·이력 사진을 올리기 전에 휴대폰에서 줄이고 방향을 맞춘다.
// 삼성 갤럭시(안드로이드 크롬·삼성 인터넷)에서 자주 깨지는 지점을 여기서 막는다.
//  - 1200만 화소 원본을 그대로 디코드하면 메모리가 부족해 탭이 죽는다. 긴 변을 먼저 줄여 디코드한다.
//  - 카메라 JPEG 의 EXIF 방향을 직접 적용한다. imageOrientation:"none" 으로 받아 두 번 돌리지 않는다.
//  - HEIC·빈 파일·영상·캔버스 실패는 한글 메시지로 돌려준다.
// index.html 과 tools/photo-prep.test.mjs 가 같이 쓴다.
(function (g) {
  "use strict";
  const VERSION = 1;
  const MSG = {
    empty: "사진이 비어 있어요. 다시 찍어 주세요.",
    video: "사진이 아니라 영상이 들어왔어요. 다시 찍어 주세요.",
    heic: "이 사진은 HEIC라서 이 브라우저에서 열 수 없어요. 카메라 설정에서 형식을 JPEG로 바꾼 뒤 다시 찍어 주세요.",
    open: "사진을 열 수 없어요. 다시 찍거나, 갤러리에서 JPEG 사진을 골라 주세요.",
    big: "사진이 너무 커서 열 수 없어요. 다시 찍거나, 갤러리에서 더 작은 JPEG를 골라 주세요.",
  };

  function photoError(msg) {
    const e = new Error(msg);
    e.photo = true;
    return e;
  }

  function u16(u, o, le) { return le ? u[o] | (u[o + 1] << 8) : (u[o] << 8) | u[o + 1]; }
  function u32(u, o, le) {
    return le
      ? (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0
      : ((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0;
  }

  // JPEG APP1 의 Orientation (1~8). 없으면 1.
  function exifOrientation(u, tiff) {
    if (tiff + 8 > u.length) return 1;
    const le = u[tiff] === 0x49 && u[tiff + 1] === 0x49;
    const be = u[tiff] === 0x4d && u[tiff + 1] === 0x4d;
    if (!le && !be) return 1;
    if (u16(u, tiff + 2, le) !== 42) return 1;
    let ifd = tiff + u32(u, tiff + 4, le);
    for (let guard = 0; guard < 4 && ifd + 2 <= u.length; guard++) {
      const n = u16(u, ifd, le);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 12 > u.length) return 1;
        if (u16(u, e, le) === 0x0112) {
          const v = u16(u, e + 8, le);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      const next = u32(u, ifd + 2 + n * 12, le);
      if (!next) break;
      ifd = tiff + next;
    }
    return 1;
  }

  // 압축 바이트에서 저장된 가로·세로(회전 전)와 EXIF 방향, HEIC 여부를 읽는다.
  function inspect(buf) {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u.length >= 12 && u[4] === 0x66 && u[5] === 0x74 && u[6] === 0x79 && u[7] === 0x70) {
      const brand = String.fromCharCode(u[8], u[9], u[10], u[11]).toLowerCase();
      if (brand === "heic" || brand === "heix" || brand === "hevc" || brand === "mif1" || brand === "msf1") return { heic: true, width: 0, height: 0, orientation: 1 };
    }
    if (u.length >= 24 && u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) {
      return { heic: false, width: u32(u, 16, false), height: u32(u, 20, false), orientation: 1 };
    }
    let orientation = 1, width = 0, height = 0;
    if (u[0] !== 0xff || u[1] !== 0xd8) return { heic: false, width: 0, height: 0, orientation: 1 };
    let i = 2;
    while (i + 8 < u.length) {
      if (u[i] !== 0xff) { i++; continue; }
      const marker = u[i + 1];
      if (marker === 0xd8) { i += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) break;
      const len = (u[i + 2] << 8) | u[i + 3];
      if (len < 2) break;
      if (marker === 0xe1 && len > 14) {
        const s = i + 4;
        if (u[s] === 0x45 && u[s + 1] === 0x78 && u[s + 2] === 0x69 && u[s + 3] === 0x66 && u[s + 4] === 0 && u[s + 5] === 0) {
          orientation = exifOrientation(u, s + 6);
        }
      }
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        height = (u[i + 5] << 8) | u[i + 6];
        width = (u[i + 7] << 8) | u[i + 8];
      }
      i += 2 + len;
    }
    return { heic: false, width: width, height: height, orientation: orientation };
  }

  function applyOrient(ctx, o, w, h) {
    switch (o) {
      case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
      case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
      case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
      case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
      case 7: ctx.transform(0, -1, -1, 0, h, w); break;
      case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
      default: break;
    }
  }

  function mainColor(canvas) {
    try {
      const c = document.createElement("canvas"); c.width = c.height = 24;
      const g = c.getContext("2d"); if (!g) return "";
      g.drawImage(canvas, 0, 0, 24, 24);
      const px = g.getImageData(0, 0, 24, 24).data, box = {};
      for (let i = 0; i < px.length; i += 4) {
        const k = (px[i] >> 5) + "," + (px[i + 1] >> 5) + "," + (px[i + 2] >> 5);
        const b = (box[k] = box[k] || [0, 0, 0, 0]);
        b[0] += px[i]; b[1] += px[i + 1]; b[2] += px[i + 2]; b[3]++;
      }
      const top = Object.values(box).sort((a, b) => b[3] - a[3])[0];
      if (!top || !top[3]) return "";
      return top.slice(0, 3).map((v) => Math.round(v / top[3])).join(",");
    } catch { return ""; }
  }

  // 서버(매장모음)는 data:image/jpeg|png|webp;base64 만 받는다.
  // 삼성 인터넷은 FileReader 결과에 줄바꿈을 넣거나 image/jpg, application/octet-stream 으로 준다.
  // 미리보기는 그때도 뜨지만, 글자 읽기 요청은 거절되고 화면에는 이유가 안 남는다.
  function normalizeDataUrl(data) {
    const s = String(data || "").replace(/\s+/g, "");
    const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)$/i.exec(s);
    if (!m) return "";
    let mime = String(m[1] || "").toLowerCase();
    const b64 = m[2];
    if (mime === "image/jpg" || mime === "image/pjpeg" || mime === "image/jfif") mime = "image/jpeg";
    if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
      let head = "";
      try { head = atob(b64.slice(0, 24)); } catch { head = ""; }
      const c0 = head.charCodeAt(0), c1 = head.charCodeAt(1);
      if (c0 === 0xff && c1 === 0xd8) mime = "image/jpeg";
      else if (head.slice(0, 4) === "\x89PNG") mime = "image/png";
      else if (head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WEBP") mime = "image/webp";
      else return "";
    }
    return "data:" + mime + ";base64," + b64;
  }

  function canvasJpeg(canvas, q) {
    return new Promise((ok, fail) => {
      let done = false;
      const finish = (data) => { if (done) return; done = true; ok(normalizeDataUrl(data)); };
      const viaData = () => {
        try { finish(canvas.toDataURL("image/jpeg", q)); }
        catch (e) { if (!done) { done = true; fail(e); } }
      };
      const timer = setTimeout(viaData, 2500);
      if (!canvas.toBlob) { clearTimeout(timer); viaData(); return; }
      try {
        canvas.toBlob((blob) => {
          clearTimeout(timer);
          if (done) return;
          if (!blob) { viaData(); return; }
          if (typeof FileReader === "undefined") { viaData(); return; }
          const fr = new FileReader();
          fr.onload = () => finish(String(fr.result || ""));
          fr.onerror = viaData;
          fr.readAsDataURL(blob);
        }, "image/jpeg", q);
      } catch { clearTimeout(timer); viaData(); }
    });
  }

  function decodeElement(blob) {
    return new Promise((ok, fail) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); ok(img); };
      img.onerror = () => { URL.revokeObjectURL(url); fail(photoError(MSG.open)); };
      img.src = url;
    });
  }

  async function decodeBitmap(blob, rw, rh, orientation) {
    const attempts = [];
    if (typeof createImageBitmap === "function") {
      // 브라우저가 방향을 세우고 긴 변을 줄여 디코드한다. 원본 1200만 화소를 메모리에 올리지 않는다.
      if (rw && rh) {
        const swap = orientation >= 5;
        attempts.push({ manual: false, opts: { imageOrientation: "from-image", resizeWidth: swap ? rh : rw, resizeHeight: swap ? rw : rh, resizeQuality: "high" } });
        attempts.push({ manual: true, opts: { imageOrientation: "none", resizeWidth: rw, resizeHeight: rh, resizeQuality: "high" } });
      }
      attempts.push({ manual: true, opts: { imageOrientation: "none" } });
      attempts.push({ manual: false, opts: null });
    }
    let last = null;
    for (const a of attempts) {
      try {
        const bmp = a.opts ? await createImageBitmap(blob, a.opts) : await createImageBitmap(blob);
        if (bmp && bmp.width > 0 && bmp.height > 0) return { bmp: bmp, manual: a.manual && !(a.opts == null) };
      } catch (e) { last = e; }
    }
    try { return { bmp: await decodeElement(blob), manual: false }; }
    catch (e) { throw last || e; }
  }

  // 삼성 GPU 는 한 변이 4096을 넘는 사진을 drawImage 하면 빈 캔버스가 된다. 2048 칸으로 나눠 줄인다.
  async function fitSource(bmp, edge) {
    let cur = bmp;
    let guard = 0;
    while (cur && Math.max(cur.width, cur.height) > 2048 && guard < 6) {
      guard++;
      const sw = cur.width, sh = cur.height;
      const k = Math.min(0.5, 2048 / Math.max(sw, sh));
      const dw = Math.max(1, Math.round(sw * k)), dh = Math.max(1, Math.round(sh * k));
      let next = null;
      try { next = await createImageBitmap(cur, { resizeWidth: dw, resizeHeight: dh, resizeQuality: "high" }); }
      catch { next = null; }
      if (!next || Math.max(next.width, next.height) >= Math.max(sw, sh)) {
        if (next && next.close) { try { next.close(); } catch {} }
        next = await tileDownscale(cur, dw, dh);
      }
      if (cur !== bmp && cur.close) { try { cur.close(); } catch {} }
      cur = next;
      if (!cur || Math.max(cur.width, cur.height) >= Math.max(sw, sh)) break;
    }
    if (cur && Math.max(cur.width, cur.height) > 4096) throw photoError(MSG.big);
    if (cur && Math.max(cur.width, cur.height) > edge) {
      const k = edge / Math.max(cur.width, cur.height);
      const dw = Math.max(1, Math.round(cur.width * k)), dh = Math.max(1, Math.round(cur.height * k));
      try {
        const next = await createImageBitmap(cur, { resizeWidth: dw, resizeHeight: dh, resizeQuality: "high" });
        if (cur !== bmp && cur.close) { try { cur.close(); } catch {} }
        cur = next;
      } catch { /* paint 가 한 번 더 줄인다 */ }
    }
    return cur;
  }
  async function tileDownscale(bmp, dw, dh) {
    const sw = bmp.width, sh = bmp.height;
    const c = document.createElement("canvas");
    c.width = dw; c.height = dh;
    const ctx = c.getContext("2d", { alpha: false }) || c.getContext("2d");
    if (!ctx) throw photoError(MSG.big);
    const step = 2048;
    for (let sy = 0; sy < sh; sy += step) {
      for (let sx = 0; sx < sw; sx += step) {
        const cw = Math.min(step, sw - sx), ch = Math.min(step, sh - sy);
        const tile = await createImageBitmap(bmp, sx, sy, cw, ch);
        try { ctx.drawImage(tile, Math.round(sx * dw / sw), Math.round(sy * dh / sh), Math.max(1, Math.round(cw * dw / sw)), Math.max(1, Math.round(ch * dh / sh))); }
        finally { if (tile.close) { try { tile.close(); } catch {} } }
      }
    }
    return c;
  }

  function paint(bmp, orientation, edge) {
    const sw = bmp.width || bmp.naturalWidth || 0;
    const sh = bmp.height || bmp.naturalHeight || 0;
    if (!sw || !sh) throw photoError(MSG.open);
    const k = Math.min(1, edge / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * k));
    const dh = Math.max(1, Math.round(sh * k));
    const o = orientation >= 1 && orientation <= 8 ? orientation : 1;
    const swap = o >= 5;
    const c = document.createElement("canvas");
    c.width = swap ? dh : dw;
    c.height = swap ? dw : dh;
    if (c.width > 4096 || c.height > 4096 || c.width * c.height > 4096 * 4096) throw photoError(MSG.big);
    const ctx = c.getContext("2d", { alpha: false }) || c.getContext("2d");
    if (!ctx) throw photoError(MSG.open);
    applyOrient(ctx, o, dw, dh);
    ctx.drawImage(bmp, 0, 0, dw, dh);
    return c;
  }

  // file → { data: dataURL, color: "r,g,b" }. 긴 변은 maxEdge(기본 1400). 결과 JPEG 가 크면 화질을 낮춘다.
  async function shrink(file, maxEdge, quality) {
    if (!file || !(file.size > 0)) throw photoError(MSG.empty);
    const type = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    if (type.indexOf("video/") === 0) throw photoError(MSG.video);
    const edge = maxEdge > 0 ? maxEdge : 1400;
    let q = quality > 0 && quality <= 1 ? quality : 0.72;
    let buf;
    try { buf = await file.arrayBuffer(); }
    catch { throw photoError(MSG.open); }
    if (!buf || !buf.byteLength) throw photoError(MSG.empty);
    const info = inspect(buf);
    const heic = info.heic || type === "image/heic" || type === "image/heif" || /\.hei[cf]$/.test(name);
    const mime = type && type.indexOf("image/") === 0 ? type : "image/jpeg";
    const blob = new Blob([buf], { type: mime });
    let rw = 0, rh = 0;
    if (info.width > 0 && info.height > 0) {
      const s = Math.min(1, edge / Math.max(info.width, info.height));
      rw = Math.max(1, Math.round(info.width * s));
      rh = Math.max(1, Math.round(info.height * s));
    }
    let decoded;
    try { decoded = await decodeBitmap(blob, rw, rh, info.orientation || 1); }
    catch { throw photoError(heic ? MSG.heic : (file.size > 8 * 1024 * 1024 ? MSG.big : MSG.open)); }
    const bmp = decoded.bmp;
    let orientation = decoded.manual ? (info.orientation || 1) : 1;
    if (decoded.manual && rw > 0 && rh > 0 && Math.abs(rw - rh) > 1) {
      // none 을 무시하고 이미 세운 비트맵이면 한 번 더 돌리지 않는다
      if (Math.abs(bmp.width - rh) <= 1 && Math.abs(bmp.height - rw) <= 1) orientation = 1;
    } else if (!decoded.manual && (info.orientation || 1) >= 5 && info.width > 0 && bmp.width === info.width && bmp.height === info.height) {
      orientation = info.orientation; // 폴백 디코드가 방향을 안 돌렸으면 직접 세운다
    }
    let fitted = bmp;
    try { fitted = await fitSource(bmp, edge); }
    catch { throw photoError(MSG.big); }
    let canvas;
    try { canvas = paint(fitted, orientation, edge); }
    finally {
      if (fitted !== bmp && fitted.close) { try { fitted.close(); } catch {} }
      if (bmp.close) { try { bmp.close(); } catch {} }
    }
    let data = "";
    for (let n = 0; n < 4; n++) {
      try { data = await canvasJpeg(canvas, q); }
      catch { throw photoError(MSG.open); }
      if (data && data.indexOf("data:image/") === 0 && data.length < 1800000) break;
      q = Math.max(0.5, q - 0.12);
      if (n === 2 && Math.max(canvas.width, canvas.height) > 900) {
        canvas = paint(canvas, 1, Math.round(edge * 0.75));
      }
    }
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data) || data.length < 32) throw photoError(MSG.open);
    return { data: data, color: mainColor(canvas), width: canvas.width, height: canvas.height };
  }

  g.PhotoPrep = { version: VERSION, inspect: inspect, shrink: shrink, normalizeDataUrl: normalizeDataUrl, MSG: MSG };
})(typeof globalThis !== "undefined" ? globalThis : this);
