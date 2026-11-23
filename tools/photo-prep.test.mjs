import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const sandbox = { console, setTimeout, clearTimeout, atob, btoa };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL("../photo-prep.js", import.meta.url), "utf8"), sandbox);
const P = sandbox.PhotoPrep;

assert.equal(P.version, 2);
assert.equal(typeof P.inspect, "function");
assert.equal(typeof P.shrink, "function");
assert.equal(typeof P.normalizeDataUrl, "function");

{
  const raw = "data:image/jpg;base64," + "abc\n def==";
  assert.equal(P.normalizeDataUrl(raw), "data:image/jpeg;base64,abcdef==");
  const jpeg = btoa("\xff\xd8\xff\x00rest");
  const wrapped = "data:application/octet-stream;base64," + jpeg.slice(0, 20) + "\r\n" + jpeg.slice(20);
  assert.equal(P.normalizeDataUrl(wrapped), "data:image/jpeg;base64," + jpeg);
  assert.equal(P.normalizeDataUrl("data:text/plain;base64,YQ=="), "");
}

function exifApp1(orientation) {
  // II, 42, IFD at 8, one SHORT tag 0x0112, next IFD 0
  const tiff = new Uint8Array(8 + 2 + 12 + 4);
  tiff[0] = 0x49; tiff[1] = 0x49; tiff[2] = 42; tiff[4] = 8;
  tiff[8] = 1; // count
  tiff[10] = 0x12; tiff[11] = 0x01; // tag
  tiff[12] = 3; // short
  tiff[16] = 1; // count
  tiff[18] = orientation;
  const body = new Uint8Array(6 + tiff.length);
  body.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  body.set(tiff, 6);
  const app = new Uint8Array(4 + body.length);
  app[0] = 0xff; app[1] = 0xe1;
  app[2] = (body.length + 2) >> 8; app[3] = (body.length + 2) & 255;
  app.set(body, 4);
  return app;
}
function sof(w, h) {
  const a = new Uint8Array(2 + 2 + 1 + 2 + 2 + 1 + 3);
  a[0] = 0xff; a[1] = 0xc0;
  a[2] = 0; a[3] = 11;
  a[4] = 8;
  a[5] = h >> 8; a[6] = h & 255;
  a[7] = w >> 8; a[8] = w & 255;
  a[9] = 1; a[10] = 1; a[11] = 0x11; a[12] = 0;
  return a;
}
function jpegHeader(w, h, orientation) {
  const ex = exifApp1(orientation);
  const so = sof(w, h);
  const out = new Uint8Array(2 + ex.length + so.length + 2);
  out[0] = 0xff; out[1] = 0xd8;
  out.set(ex, 2);
  out.set(so, 2 + ex.length);
  out[out.length - 2] = 0xff; out[out.length - 1] = 0xd9;
  return out;
}

{
  const info = P.inspect(jpegHeader(4000, 3000, 6));
  assert.equal(info.width, 4000);
  assert.equal(info.height, 3000);
  assert.equal(info.orientation, 6);
  assert.equal(info.heic, false);
}
{
  const u = new Uint8Array(24);
  u.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0);
  assert.equal(P.inspect(u).heic, true);
}
{
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png[16] = 0; png[17] = 0; png[18] = 0x04; png[19] = 0x00; // 1024
  png[20] = 0; png[21] = 0; png[22] = 0x03; png[23] = 0x00; // 768
  const info = P.inspect(png);
  assert.equal(info.width, 1024);
  assert.equal(info.height, 768);
  assert.equal(info.orientation, 1);
}

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /src="photo-prep\.js\?v=2"/);
assert.match(html, /PhotoPrep/);
// 삼성 카메라 대비로 읽은 바이트를 그대로 넘긴다(File 로 다시 감싸면 50MP 에서 두 번 복사)
assert.match(html, /return \{ buffer: buf, type: type, name: name, size: buf\.byteLength \}/);
assert.doesNotMatch(html, /new File\(\[buf\]/);
assert.match(html, /id="ocrFile"[^>]*class="cam"/);
assert.doesNotMatch(html, /id="ocrFile"[^>]*\shidden/);
assert.match(html, /id="trFile"[^>]*capture="environment"/);
assert.match(html, /holdFile/);
assert.doesNotMatch(html, /clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);
new Function(fs.readFileSync(new URL("../photo-prep.js", import.meta.url), "utf8"));

// 서비스워커: 화면·스크립트를 바꿀 때마다 캐시 이름을 올려야 휴대폰이 예전 사본을 열지 않는다
const sw = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
assert.match(sw, /const CACHE = "label-list-shell-v9"/);
assert.match(sw, /BASE \+ "photo-prep\.js"/);

async function browser() {
  const req = (m) => import(m).catch(() => import(process.env.PW_MODULE || ("/opt/node22/lib/node_modules/" + m + "/index.mjs")));
  const { chromium } = await req("playwright");
  const exe = process.env.PW_CHROME || (fs.existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
  const ua = "Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/126.0.0.0 Mobile Safari/537.36";
  const browser = await chromium.launch({ executablePath: exe });
  const page = await (await browser.newContext({ userAgent: ua, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await page.route("https://script.google.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("https://www.gstatic.com/**", (r) => r.abort());
  await page.route("https://cdn.jsdelivr.net/**", (r) => r.abort()); // 시험 중에는 변환 키트를 내려받지 않는다(성공 쪽은 시험이 직접 넣어 준다)
  const cdn = [];
  page.on("request", (r) => { if (r.url().includes("heic2any")) cdn.push(r.url()); });
  const root = new URL("../", import.meta.url).pathname;
  await page.goto("file://" + root + "index.html");
  await page.waitForFunction(() => window.PhotoPrep && window.PhotoPrep.shrink);

  const shot = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 2400; c.height = 1200;
    const g = c.getContext("2d");
    g.fillStyle = "#ff0000"; g.fillRect(0, 0, 1200, 1200);
    g.fillStyle = "#0000ff"; g.fillRect(1200, 0, 1200, 1200);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.92));
    const raw = new Uint8Array(await blob.arrayBuffer());
    // APP1 EXIF orientation 6, 바로 SOI 뒤에 끼운다
    const tiff = new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]);
    const body = new Uint8Array(6 + tiff.length);
    body.set([0x45, 0x78, 0x69, 0x66, 0, 0]); body.set(tiff, 6);
    const app = new Uint8Array(4 + body.length);
    app[0] = 0xff; app[1] = 0xe1; app[2] = (body.length + 2) >> 8; app[3] = (body.length + 2) & 255;
    app.set(body, 4);
    const out = new Uint8Array(raw.length + app.length);
    out[0] = 0xff; out[1] = 0xd8; out.set(app, 2); out.set(raw.subarray(2), 2 + app.length);
    const file = new File([out], "galaxy.jpg", { type: "image/jpeg" });
    const shrunk = await PhotoPrep.shrink(file, 1400, 0.8);
    const img = new Image();
    img.src = shrunk.data;
    await img.decode();
    const d = document.createElement("canvas");
    d.width = img.naturalWidth; d.height = img.naturalHeight;
    const dg = d.getContext("2d");
    dg.drawImage(img, 0, 0);
    const top = dg.getImageData(Math.floor(d.width / 2), 4, 1, 1).data;
    const bot = dg.getImageData(Math.floor(d.width / 2), d.height - 5, 1, 1).data;
    return { w: d.width, h: d.height, top: [top[0], top[1], top[2]], bot: [bot[0], bot[1], bot[2]], bytes: shrunk.data.length, color: shrunk.color };
  });
  assert.ok(shot.h > shot.w, "orientation 6 이면 세로가 더 길어야 함 " + shot.w + "x" + shot.h);
  assert.ok(Math.max(shot.w, shot.h) <= 1400, "긴 변 1400 " + shot.w + "x" + shot.h);
  assert.ok(shot.top[0] > 180 && shot.top[2] < 80, "위쪽은 원래 왼쪽(빨강) " + shot.top);
  assert.ok(shot.bot[2] > 180 && shot.bot[0] < 80, "아래쪽은 원래 오른쪽(파랑) " + shot.bot);
  assert.ok(shot.bytes < 1800000, "데이터 크기 " + shot.bytes);

  const plain = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 2000; c.height = 1000;
    const g = c.getContext("2d");
    g.fillStyle = "#00aa00"; g.fillRect(0, 0, 2000, 1000);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.8));
    const shrunk = await PhotoPrep.shrink(new File([blob], "flat.jpg", { type: "image/jpeg" }), 800, 0.8);
    const img = new Image(); img.src = shrunk.data; await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  });
  assert.ok(plain.w === 800 && plain.h === 400, JSON.stringify(plain));

  const empty = await page.evaluate(async () => {
    try { await PhotoPrep.shrink(new File([], "a.jpg", { type: "image/jpeg" })); return ""; }
    catch (e) { return e.message; }
  });
  assert.match(empty, /비어/);

  const heic = await page.evaluate(async () => {
    const u = new Uint8Array(64);
    u.set([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    try { await PhotoPrep.shrink(new File([u], "IMG.HEIC", { type: "image/heic" })); return ""; }
    catch (e) { return e.message; }
  });
  assert.match(heic, /HEIC/);
  assert.ok(cdn.length >= 1, "HEIC 면 변환기를 한 번 내려받아 본다");

  // HEIC 변환 성공: 갤럭시 '고효율 사진'은 변환기로 JPEG 로 바꿔 다시 연다.
  // holdFile 이 넘긴 바이트를 그대로 쓰는지도 같이 본다(arrayBuffer 를 두 번 읽으면 50MP 에서 메모리 2배).
  const heicOk = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 3000; c.height = 1500;
    const g = c.getContext("2d");
    g.fillStyle = "#00aa00"; g.fillRect(0, 0, 3000, 1500);
    const jpeg = new Uint8Array(await (await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.9))).arrayBuffer());
    const heic = new Uint8Array(64);
    heic.set([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    let asked = 0, toType = "";
    window.heic2any = async (o) => { asked++; toType = String(o.toType || ""); return new Blob([jpeg], { type: "image/jpeg" }); };
    const src = {
      buffer: heic.buffer, type: "image/heic", name: "IMG_20261123_140000.HEIC", size: heic.byteLength,
      arrayBuffer() { throw new Error("바이트를 다시 읽었어요"); },
    };
    const out = await PhotoPrep.shrink(src, 1000, 0.8);
    const img = new Image(); img.src = out.data; await img.decode();
    return { asked: asked, toType: toType, w: img.naturalWidth, h: img.naturalHeight, head: out.data.slice(0, 23) };
  });
  assert.equal(heicOk.asked, 1, "HEIC 는 변환기를 한 번 부른다");
  assert.equal(heicOk.toType, "image/jpeg");
  assert.match(heicOk.head, /^data:image\/jpeg;base64,/);
  assert.ok(Math.max(heicOk.w, heicOk.h) <= 1000, "HEIC 변환 뒤에도 긴 변 1000 " + heicOk.w + "x" + heicOk.h);

  const ui = await page.evaluate(async () => {
    const input = document.getElementById("ocrFile");
    const dt = new DataTransfer();
    dt.items.add(new File([], "empty.jpg", { type: "image/jpeg" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 50));
    const cam = getComputedStyle(input);
    return {
      title: document.getElementById("ocrT").textContent,
      err: document.getElementById("ocrT").classList.contains("err"),
      clip: cam.clip,
      opacity: cam.opacity,
      w: cam.width,
    };
  });
  assert.match(ui.title, /비어/);
  assert.equal(ui.err, true);
  assert.equal(ui.opacity, "0");
  assert.ok(parseFloat(ui.w) >= 40, ui.w);
  assert.ok(!/rect\(0px,\s*0px,\s*0px,\s*0px\)/.test(ui.clip), ui.clip);

  // 사진 버튼(#ocrBtn)은 매장 주소(API)가 있으면 첫 사진 목록 확인 전에도 보여야 한다
  // (예전엔 확인이 실패하면 photoReady 가 계속 false 라 버튼 자체가 숨어 사진을 못 찍었다)
  const noStore = await page.evaluate(async () => {
    document.getElementById("addOpen").click();
    await new Promise((r) => setTimeout(r, 120));
    return { hidden: document.getElementById("ocrBtn").hidden, form: !document.getElementById("form").hidden };
  });
  assert.equal(noStore.form, true, "입력칸은 열린다");
  assert.equal(noStore.hidden, true, "매장 주소가 없으면(매장 선택 전) 사진 버튼은 숨긴다");

  await page.goto("file://" + root + "index.html?store=suwon");
  await page.waitForFunction(() => window.PhotoPrep && window.PhotoPrep.shrink);
  const withStore = await page.evaluate(async () => {
    try { localStorage.removeItem("label-list-photo-ready"); } catch {}
    document.getElementById("addOpen").click();
    await new Promise((r) => setTimeout(r, 120));
    const b = document.getElementById("ocrBtn");
    let ready = "?"; try { ready = localStorage.getItem("label-list-photo-ready"); } catch {}
    return { hidden: b.hidden, text: b.textContent.trim(), form: !document.getElementById("form").hidden, ready: ready };
  });
  assert.equal(withStore.form, true, "입력칸은 열린다");
  assert.notEqual(withStore.ready, "1", "사진 목록을 아직 확인하지 못한 상태여야 한다");
  assert.equal(withStore.hidden, false, "매장 주소가 있으면 사진 목록 확인 전에도 사진 버튼이 보인다");
  assert.match(withStore.text, /사진/);

  // 앱 흐름 그대로 큰 사진(4032x3024) 한 장: holdFile → shrink → 사진 칸 표시
  const flow = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 4032; c.height = 3024;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, 4032, 3024);
    g.fillStyle = "#000000"; g.font = "bold 160px sans-serif"; g.fillText("2026.12.31", 200, 800);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.93));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "galaxy.jpg", { type: "image/jpeg" }));
    const input = document.getElementById("ocrFile");
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (!document.getElementById("ocrRes").hidden && document.getElementById("ocrImg").src.indexOf("data:image/") === 0) break;
    }
    const img = document.getElementById("ocrImg");
    const shown = new Image(); shown.src = img.src; await shown.decode().catch(() => {});
    return {
      hidden: document.getElementById("ocrRes").hidden, head: img.src.slice(0, 23),
      w: shown.naturalWidth, h: shown.naturalHeight, title: document.getElementById("ocrT").textContent,
    };
  });
  assert.equal(flow.hidden, false, "사진을 넣으면 사진칸이 열린다: " + flow.title);
  assert.match(flow.head, /^data:image\/jpeg;base64,/);
  assert.ok(Math.max(flow.w, flow.h) <= 1400, "긴 변 1400 이하 " + flow.w + "x" + flow.h);
  assert.ok(flow.w > 0 && flow.h > 0, JSON.stringify(flow));

  await browser.close();
}

await browser();
console.log("photo-prep tests ok");
