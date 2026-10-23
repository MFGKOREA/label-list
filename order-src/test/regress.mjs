// 회귀 테스트: 같은 데이터·같은 날짜로 품목별 발주량이 코드 변경 전후에 어떻게 바뀌는지 비교합니다.
// 사용:
//   node order-src/test/regress.mjs <kv.json> --save base.json     기준 저장 (코드 고치기 전에)
//   node order-src/test/regress.mjs <kv.json> --cmp base.json      고친 뒤 비교 (바뀐 품목만 출력, 크게 바뀐 게 있으면 exit 1)
// 날짜: 평일(수)·주말 앞(목·금)·토요일·월요일 아침 10시로 고정해서 계산. kv.json과 base.json은 매장 데이터라 저장소에 넣지 마세요.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, "../../order.html");
const [kvPath, mode, basePath] = process.argv.slice(2);
if (!kvPath || !/^--(save|cmp)$/.test(mode || "") || !basePath) { console.log("사용: node regress.mjs <kv.json> --save|--cmp <base.json>"); process.exit(2); }
const kv = fs.readFileSync(kvPath, "utf8");
const DAYS = (process.env.DAYS || "2026-10-21,2026-10-22,2026-10-23,2026-10-24,2026-10-26").split(",");
const exe = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const b = await chromium.launch({ executablePath: exe });
const out = {};
for (const day of DAYS) {
  const ctx = await b.newContext({ timezoneId: "Asia/Seoul" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.route("https://script.google.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: r.request().method() === "GET" ? kv : '{"ok":true,"data":{}}' }));
  await p.clock.setFixedTime(new Date(day + "T10:00:00+09:00"));
  await p.goto("file://" + html);
  await p.waitForFunction(() => window.__orderCalc && window.__orderCalc.model().items.length, null, { timeout: 60000 });
  out[day] = await p.evaluate(() => {
    const C = window.__orderCalc, M = C.model(), T = C.TODAY, db = C.db(), r = {};
    M.items.forEach((it) => {
      const w = C.orderWindowFor(it, T), v = (db["input." + T] || {})[it.key];
      const counted = v && v.s !== "" && v.s != null && isFinite(Number(v.s));
      const e = counted ? null : C.estStock(it, T), s = counted ? Number(v.s) * (it.box || 1) : e ? e.v : 0;
      const c = C.calc(it, w, s, C.incomingOf(it, T));
      if (!c.none) r[it.key] = { q: c.orderQty, use: +c.use.toFixed(3), ss: +c.ss.toFixed(3) };
    });
    return r;
  });
  if (errs.length) { console.log(day, "페이지 오류:", errs.slice(0, 3)); process.exitCode = 1; }
  await ctx.close();
}
await b.close();
if (mode === "--save") { fs.writeFileSync(basePath, JSON.stringify(out)); console.log("기준 저장:", basePath, Object.keys(out).map((d) => `${d} ${Object.keys(out[d]).length}개`).join(" · ")); process.exit(); }
const base = JSON.parse(fs.readFileSync(basePath, "utf8"));
let changed = 0, big = 0;
for (const day of DAYS) {
  const a = base[day] || {}, c = out[day] || {}, keys = new Set([...Object.keys(a), ...Object.keys(c)]), lines = [];
  keys.forEach((k) => {
    const x = a[k], y = c[k];
    if (!x || !y) { lines.push(`  ${k}: ${x ? "계산 안 됨(새로)" : "새로 계산됨"}`); changed++; return; }
    if (x.q !== y.q) {
      changed++;
      const rel = Math.abs(y.use - x.use) / Math.max(x.use, 1e-9);
      if (rel > 0.3 && Math.abs(y.q - x.q) >= 2) big++;
      lines.push(`  ${k}: 발주 ${x.q} → ${y.q} (사용 ${x.use} → ${y.use}, 안전 ${x.ss} → ${y.ss})`);
    }
  });
  console.log(`${day}: 바뀐 품목 ${lines.length}개`); lines.slice(0, 40).forEach((l) => console.log(l));
}
console.log(`합계: 발주량 바뀐 품목 ${changed}개 · 사용량 30% 넘게 바뀐 큰 변화 ${big}개`);
if (big) process.exitCode = 1;
