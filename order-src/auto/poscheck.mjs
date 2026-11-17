// POS 바뀜 점검 (11/16 KM "오늘부터 POS 바뀔 예정 — 안맵게·사이드 메뉴 이상한 부분, 세트 포스팅이 개선될 수도"):
//  날짜별 메뉴 판매(menuDay.날짜)의 메뉴 이름이 예전과 얼마나 달라졌는지, 레시피 연결이 얼마나 끊겼는지 봄. 읽기만 함(시트에 안 씀)
//  - 새 이름(그 전 28일에 없던 메뉴) · 사라진 이름 · 연결 안 된 메뉴의 판매 수량 비율 · "안맵게" 같은 요청이 따로 줄로 찍힌 것 · 0원 줄(세트 구성품) 수
//  새 POS는 세트를 "세트 줄 + 구성품 줄(0원 또는 추가금)"로, 맵기 요청은 스페셜오더(줄 없음)로 찍음 → 구성품이 진짜 메뉴 이름으로 오면 레시피 사용량이 더 맞게 됨.
//  반대로 메뉴 이름·코드가 바뀌면 지금 연결(map.menu)이 끊겨 레시피 사용량이 줄어듦 → 연결 안 된 비율이 평소보다 뛰면 KM에게 알리고 연결을 더함
// 사용: node order-src/auto/poscheck.mjs [--kv 파일] [--day 2026-11-16]   (화면에 메뉴 이름·수량이 나옴 — 저장소에 옮기지 않음)
// 끝 코드: 0 평소와 비슷 · 10 달라짐(새 이름이 많거나 연결 안 된 비율이 평소의 1.5배 넘고 5%p 넘게 늚) · 2 그날 자료 없음
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { openApp } from "../test/bt/asof.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.ORDER_API_TEST || /DEFAULT_API = "([^"]+)"/.exec(fs.readFileSync(path.join(HERE, "../app.js"), "utf8"))[1];
const val = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
let kvPath = val("--kv");
if (!kvPath) { const dir = path.join(os.tmpdir(), "order-auto"); fs.mkdirSync(dir, { recursive: true }); kvPath = path.join(dir, "kv-pos.json"); fs.writeFileSync(kvPath, JSON.stringify(await (await fetch(API + "?api=1&t=" + Date.now())).json())); }
const raw = JSON.parse(fs.readFileSync(kvPath, "utf8")), D = raw.data || raw;
const days = Object.keys(D).filter((k) => /^menuDay\.\d{4}-\d\d-\d\d$/.test(k)).map((k) => k.slice(8)).sort();
const day = val("--day") || days[days.length - 1];
if (!D["menuDay." + day]) { console.log(`${day} 메뉴 판매가 아직 없음 (마지막 ${days[days.length - 1] || "없음"})`); process.exit(2); }
const { page, close, errs } = await openApp({ kvPath });
const r = await page.evaluate(({ day }) => {
  const C = window.__orderCalc, M = C.model(), db = C.db();
  const add = (s, n) => { const x = new Date(s + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const one = (d) => { const rows = C.dayRowsOf("menuDay." + d) || []; let q = 0, un = 0, skip = 0, zero = 0; const names = new Map(), unNames = new Map(), cats = new Map();
    rows.forEach((x) => { const n = Number(x.q) || 0; if (!(n > 0)) return; q += n; names.set(x.m, (names.get(x.m) || 0) + n); cats.set(x.c || "", (cats.get(x.c || "") || 0) + n);
      if ("a" in x && !(Number(x.a) > 0)) zero += n;
      const z = M.resolveMenu(x.m, x.c); if (z && z.skip) skip += n; else if (!z || !z.recipe) { un += n; unNames.set(x.m, (unNames.get(x.m) || 0) + n); } });
    return { q, un, skip, zero, names, unNames, cats, hasAmt: rows.some((x) => "a" in x), keys: rows[0] ? Object.keys(rows[0]) : [] }; };
  const cur = one(day), prev = []; for (let k = 1; k <= 28; k++) { const d = add(day, -k); if (db["menuDay." + d]) prev.push(one(d)); }
  const seen = new Set(); prev.forEach((p) => p.names.forEach((_, n) => seen.add(n)));
  const recent = new Set(); prev.slice(0, 7).forEach((p) => p.names.forEach((_, n) => recent.add(n)));
  const fresh = [...cur.names].filter(([n]) => !seen.has(n)).sort((a, b) => b[1] - a[1]);
  const gone = [...recent].filter((n) => !cur.names.has(n));
  const rate = (p) => (p.q ? p.un / p.q : 0), base = prev.length ? prev.map(rate).sort((a, b) => a - b)[Math.floor(prev.length / 2)] : null;
  const spicy = [...cur.names].filter(([n]) => /안\s*맵|덜\s*맵|더\s*맵|맵기/.test(n));
  return { day, n: cur.names.size, q: cur.q, unRate: rate(cur), base, prevDays: prev.length, skip: cur.skip, zero: cur.zero, hasAmt: cur.hasAmt, keys: cur.keys,
    fresh, freshQ: fresh.reduce((t, x) => t + x[1], 0), gone: gone.length, goneEx: gone.slice(0, 8), un: [...cur.unNames].sort((a, b) => b[1] - a[1]).slice(0, 12), spicy, cats: [...cur.cats].sort((a, b) => b[1] - a[1]).slice(0, 12) };
}, { day });
await close();
const pc = (x) => (x == null ? "–" : (x * 100).toFixed(1) + "%");
console.log(`${r.day} 메뉴 판매: 메뉴 ${r.n}종 · ${r.q}개 (줄에 있는 칸: ${r.keys.join(", ")})`);
console.log(`연결 안 된 메뉴의 판매 비율 ${pc(r.unRate)} · 그 전 ${r.prevDays}일 가운데값 ${pc(r.base)} · 계산에서 빼는 줄(쿠폰 등) ${r.skip}개${r.hasAmt ? ` · 0원 줄 ${r.zero}개` : ""}`);
console.log(`새 이름(그 전 28일에 없던 메뉴) ${r.fresh.length}종 · ${r.freshQ}개 (${pc(r.q ? r.freshQ / r.q : 0)})${r.fresh.length ? ": " + r.fresh.slice(0, 15).map(([n, q]) => `${n} ${q}`).join(" · ") : ""}`);
console.log(`사라진 이름(최근 7일엔 있었는데 이날 없음) ${r.gone}종${r.gone ? ": " + r.goneEx.join(" · ") : ""}`);
console.log(`맵기 요청이 따로 줄로 찍힌 것 ${r.spicy.length}종${r.spicy.length ? ": " + r.spicy.map(([n, q]) => `${n} ${q}`).join(" · ") : ""}`);
if (r.un.length) console.log("연결 안 된 메뉴(많은 순): " + r.un.map(([n, q]) => `${n} ${q}`).join(" · "));
console.log("분류(많은 순): " + r.cats.map(([c, q]) => `${c || "(없음)"} ${q}`).join(" · "));
if (errs.length) console.log(`(앱 화면 오류 ${errs.length}개: ${errs[0].slice(0, 80)})`);
const changed = (r.q > 0 && r.freshQ / r.q > 0.2) || (r.base != null && r.unRate > r.base * 1.5 && r.unRate - r.base > 0.05);
console.log(changed ? "→ 달라짐: 메뉴 이름·연결을 확인해야 함" : "→ 평소와 비슷");
process.exit(changed ? 10 : 0);
