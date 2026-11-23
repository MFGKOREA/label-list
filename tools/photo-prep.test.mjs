import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const sandbox = { console, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL("../photo-prep.js", import.meta.url), "utf8"), sandbox);
const P = sandbox.PhotoPrep;

assert.equal(P.version, 1);
assert.equal(typeof P.inspect, "function");
assert.equal(typeof P.shrink, "function");

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
assert.match(html, /src="photo-prep\.js\?v=1"/);
assert.match(html, /PhotoPrep/);
assert.match(html, /id="ocrFile"[^>]*class="cam"/);
assert.doesNotMatch(html, /id="ocrFile"[^>]*\shidden/);
assert.match(html, /id="trFile"[^>]*capture="environment"/);
assert.match(html, /holdFile/);
assert.doesNotMatch(html, /clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);
new Function(fs.readFileSync(new URL("../photo-prep.js", import.meta.url), "utf8"));

async function browser() {
  const req = (m) => import(m).catch(() => import(process.env.PW_MODULE || ("/opt/node22/lib/node_modules/" + m + "/index.mjs")));
  const { chromium } = await req("playwright");
  const exe = process.env.PW_CHROME || (fs.existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
  const ua = "Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/126.0.0.0 Mobile Safari/537.36";
  const browser = await chromium.launch({ executablePath: exe });
  const page = await (await browser.newContext({ userAgent: ua, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await page.route("https://script.google.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("https://www.gstatic.com/**", (r) => r.abort());
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

  await browser.close();
}

await browser();
console.log("photo-prep tests ok");
