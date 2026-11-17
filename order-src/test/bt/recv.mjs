// 입고현황(misRecv) 쓰기 시험 — 시트에 안 씀. 매장 자료(kv.json)는 저장소에 넣지 않음
// 사용: node order-src/test/bt/recv.mjs <kv.json> [--make 켠.html]
//  1) 가짜 입고현황: 앱 발주로 잡힌 입고(arrivalsOrd)를 그대로 "받은 것"으로 만들어 넣으면, 입고현황을 켠 앱의 두 재고 사이 입고(arrBetween)가 끈 앱과 똑같아야 함
//  2) 한 품목·한 날 받은 양을 반으로 줄이면 그 날이 낀 구간의 입고만 그만큼 줄어야 함
//  3) 시트에 진짜 입고현황(misRecv.날짜)이 있으면 스스로 확인(recvTrust) 결과를 보여 줌. --make: 입고현황을 켠 html을 만들어 est.mjs로 비교할 수 있게
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { openApp } from "./asof.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../../..");
const [KV] = process.argv.slice(2), mk = process.argv.indexOf("--make"), MAKE = mk > 0 ? process.argv[mk + 1] : null;
if (!KV) { console.log("사용: node order-src/test/bt/recv.mjs <kv.json> [--make 켠.html]"); process.exit(1); }
const src = fs.readFileSync(REPO + "/order.html", "utf8");
if (!src.includes("const RECV_USE = false;") && !src.includes("const RECV_USE = true;")) { console.log("order.html에 RECV_USE가 없음"); process.exit(1); }
const ON = path.join(os.tmpdir(), "order_recv_on.html"), OFF = path.join(os.tmpdir(), "order_recv_off.html");
fs.writeFileSync(ON, src.replace("const RECV_USE = false;", "const RECV_USE = true;")); fs.writeFileSync(OFF, src.replace("const RECV_USE = true;", "const RECV_USE = false;"));
if (MAKE) { fs.copyFileSync(ON, MAKE); console.log("입고현황 켠 html:", MAKE); }
let fails = 0; const ok = (c, m) => { console.log((c ? "통과 " : "실패 ") + m); if (!c) fails++; };
const raw = JSON.parse(fs.readFileSync(KV, "utf8")), data = raw.data || raw;
const real = Object.keys(data).filter((k) => /^misRecv\.\d{4}-\d\d-\d\d$/.test(k)).sort();
// 1) 끈 앱으로 발주 입고를 읽어 가짜 입고현황을 만듦 (센 날이 있는 기간)
const days = Object.keys(data).filter((k) => /^input\.\d{4}-\d\d-\d\d$/.test(k)).map((k) => k.slice(6)).sort();
const FROM = days.filter((d) => d >= "2026-10-20")[0], TO = days[days.length - 1];
let app = await openApp({ kvPath: KV, html: OFF, mutate: (d) => { real.forEach((k) => delete d[k]); return d; } });
const synth = await app.page.evaluate(([FROM, TO]) => {
  const C = window.__orderCalc, M = C.model(), out = {};
  for (let y = FROM; y <= TO; y = C.addDays(y, 1)) out["misRecv." + y] = { at: 1, rows: [] };
  M.items.forEach((it) => { if (!(it.codes || []).length) return; const per = it.pk.sameUnit === false ? it.pk.mult || 1 : 1;
    for (let x = C.addDays(FROM, -10); x <= TO; x = C.addDays(x, 1)) C.arrivalsOrd(it, x).forEach((a) => { if (a.d >= FROM && a.d <= TO) out["misRecv." + a.d].rows.push({ code: String(it.codes[0]), name: it.key, qty: a.q / per }); }); });
  return out;
}, [FROM, TO]);
await app.close();
const winsOf = async (html, extra) => { const a = await openApp({ kvPath: KV, html, mutate: (d) => { real.forEach((k) => delete d[k]); Object.assign(d, extra); return d; } });
  const r = await a.page.evaluate(() => { const C = window.__orderCalc, M = C.model(), db = C.db(), out = {}, trust = C.recvTrust ? C.recvTrust() : null;
    const ds = Object.keys(db).filter((k) => /^input\.\d{4}-\d\d-\d\d$/.test(k)).map((k) => k.slice(6)).sort();
    M.items.forEach((it) => { if (it.ledgerOnly || !(it.codes || []).length) return; let x = null;
      ds.forEach((d) => { if (!C.counted((db["input." + d] || {})[it.key])) return; if (x && d > x) out[it.key + "|" + x + "|" + d] = C.arrBetween(it, x, C.meatOn(it, x), d, false); x = d; }); });
    return { out, trust }; });
  await a.close(); return r; };
const off = await winsOf(OFF, {}), on = await winsOf(ON, synth);
const ks = Object.keys(off.out), diff = ks.filter((k) => Math.abs(off.out[k] - (on.out[k] ?? NaN)) > 1e-6);
console.log(`가짜 입고현황 ${FROM}~${TO} · 품목코드 있는 품목의 센 구간 ${ks.length}개 · 스스로 확인`, JSON.stringify(on.trust));
ok(on.trust && on.trust.on, "가짜(발주와 같은) 입고현황은 믿을 만하다고 봄");
ok(ks.length > 100 && diff.length === 0, `발주와 같은 입고현황을 켜도 구간 입고가 그대로 (다른 구간 ${diff.length}개${diff.length ? ": " + diff.slice(0, 3).join(", ") : ""})`);
// 2) 받은 양 반으로: 입고가 가장 많은 날의 한 줄
let best = null; Object.entries(synth).forEach(([k, v]) => v.rows.forEach((r, i) => { if (!best || r.qty > best.r.qty) best = { k, i, r }; }));
const half = JSON.parse(JSON.stringify(synth)); half[best.k].rows[best.i].qty = best.r.qty / 2;
const on2 = await winsOf(ON, half), day = best.k.slice(8), key = best.r.name;
const ch = Object.keys(on2.out).filter((k) => Math.abs(on2.out[k] - on.out[k]) > 1e-6);
const okOnly = ch.length > 0 && ch.every((k) => { const [kk, x, d] = k.split("|"); return kk === key && x <= day && day <= d; });
ok(okOnly, `${key.slice(0, 16)} ${day} 받은 양을 반으로 → 그 날이 낀 그 품목 구간만 바뀜 (${ch.length}개)`);
// 3) 진짜 입고현황
if (real.length) { const t = await winsOf(ON, Object.fromEntries(real.map((k) => [k, data[k]]))); console.log(`진짜 입고현황 ${real[0].slice(8)}~${real[real.length - 1].slice(8)} ${real.length}일 · 스스로 확인`, JSON.stringify(t.trust)); }
else console.log("진짜 입고현황(misRecv)은 아직 시트에 없음");
console.log(`합계: 실패 ${fails}`); process.exitCode = fails ? 1 : 0;
