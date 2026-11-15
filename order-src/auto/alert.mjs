// 폰 알림 거리 (11/15 KM "먼저 할 4가지 바로 진행"): 3번 영업 중 86.
//  12번 해동 알림은 KM이 두 번 "제외"(11/15 첫 알림 뒤 "해동은 앞으로 제외", 채팅 "12. 해동알림은 제외") → 해동 계산을 지움(되살리려면 커밋 9d709bc)
//  - 시트 자료로 앱을 "지금"으로 열어 앱과 같은 계산(risk1·calc)으로 알릴 것만 한두 줄로 찍음. 읽기만 함(시트에 쓰지 않음)
//  - 예약 작업이 이 줄을 마지막 답으로 내면 KM 폰에 알림이 감(예약 작업의 푸시). 알릴 게 없으면 "알림 없음"
//  - 화면에 찍는 숫자는 매장 자료이므로 저장소·커밋에 옮기지 않음
//  + GW 상황판(11/15 "2주안 기획들 실행해", 14번): 오전(12시 전) 차례엔 상황판의 빨강 줄(이틀 넘게 끊긴 자료·하루 넘게 없는 PC 신호·합계 다름·자동 수집)을, 오후 차례엔 자동 수집 빨강(로그인 풀림 등)만 한 줄 붙임
//    = 앱 리포트 탭 상황판과 같은 함수(gwHealth). 노랑·초록은 알리지 않음(이상 있을 때만)
// 사용: node order-src/auto/alert.mjs [--kv 파일] [--at 2026-11-14T16:05]   (예약 작업이 주는 --kind 86은 받기만 함)
//   지금부터 내일 문 닫을 때까지 바닥날 품목(86 위험)
//   --at: 그 시각으로 열어 봄(시험). 그날 뒤 자료는 잘라냄(asof.mjs)
// 끝 코드: 10 알릴 것 있음 · 0 없음 · 3 시트 비정상(아무것도 안 함)
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { openApp } from "../test/bt/asof.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.ORDER_API_TEST || /DEFAULT_API = "([^"]+)"/.exec(fs.readFileSync(path.join(HERE, "../app.js"), "utf8"))[1];
const val = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const get = async () => { let last; for (let i = 0; i < 3; i++) { try { const j = await (await fetch(API + "?api=1&t=" + Date.now())).json(); if (j && j.ok) return j; last = j && j.error; } catch (e) { last = e.message; } await new Promise((r) => setTimeout(r, 2000 + 3000 * i)); } throw new Error("시트를 못 읽음: " + last); };
let kvPath = val("--kv");
if (!kvPath) { const dir = path.join(os.tmpdir(), "order-auto"); fs.mkdirSync(dir, { recursive: true }); kvPath = path.join(dir, "kv-alert.json"); fs.writeFileSync(kvPath, JSON.stringify(await get())); }
const raw = JSON.parse(fs.readFileSync(kvPath, "utf8")), D = raw.data || raw;
const nRows = (((D["master.order"] || {}).rows) || []).length, nFc = Object.keys(D.forecast || {}).length;
if (nRows < 50 || nFc < 30 || Object.keys(D).length < 30) { console.log(`시트 비정상: 품목 ${nRows} · Forecast ${nFc}일 → 알림 안 함`); process.exit(3); }
const at = val("--at"); // "2026-11-14T16:05"
const nowK = at ? new Date(at + ":00+09:00") : new Date();
const hourK = +new Date(nowK.getTime() + 9 * 3600e3).toISOString().slice(11, 13) + +new Date(nowK.getTime() + 9 * 3600e3).toISOString().slice(14, 16) / 60;
const { page, close, errs } = await openApp(at ? { kvPath, asOf: at.slice(0, 10), hour: hourK, today: "all" } : { kvPath });
const r = await page.evaluate(({ hourK }) => {
  const C = window.__orderCalc, M = C.model(), db = C.db(), T = C.TODAY, inp = db["input." + T] || {};
  // 알림엔 짧은 이름: 앞의 "냉동_", 괄호(업체), 첫 "_" 뒤(묶음 단위·원산지)를 뺌. 냉동_채끝270g_10개단위 발주 → 채끝270g
  const short = (n) => String(n).replace(/^냉동[_\s]*/, "").replace(/\(.*?\)/g, "").replace(/_.*$/, "").trim();
  const items = M.items.filter((i) => !i.ledgerOnly);
  // 86: 앱의 86 위험과 같은 계산(센 값, 안 센 품목은 최근 3일 센 값 → 예상 재고). 지금부터 내일 문 닫을 때(at < 2) 안에 바닥날 것만
  //  (내일 점심까지만 보면 11/14 토 버터라이스 "일 디너 19:00"이 빠졌음 — 실제로는 일요일 점심에 바닥)
  const r86 = items.map((it) => { const k = C.risk1(it, inp[it.key]); return k ? { name: short(it.name), est: !!k.est, when: k.when, at: k.at, have: k.have, lack: k.shortS != null ? k.shortS : Math.max(0.1, k.use - k.have), unit: it.pk.stock || "", thaw: !!k.thaw } : null; }).filter(Boolean).sort((a, b) => a.at - b.at);
  const soon = r86.filter((x) => x.at > hourK / 24 && x.at < 2), later = r86.length - soon.length;
  // 오전(12시 전) 차례: 상황판 빨강 전부. 오후(12~18시) 차례: 자동 수집 빨강만(로그인 풀림 등 그날 손봐야 하는 것, 11/15 기획안 7번). 저녁: 없음
  const bad = C.gwHealth ? C.gwHealth().filter((h) => h.s === "bad" && (hourK < 12 || (hourK < 18 && h.k === "auto"))).map((h) => `${h.t} ${h.v}`) : [];
  return { T, soon, later, bad };
}, { hourK });
await close();
const lines = [];
const fmt86 = (x) => `${x.name} ${x.when}(${x.est ? "예상 " : ""}${q1(x.have)}${x.unit}·${q1(x.lack)} 부족${x.thaw ? "·입고당일 해동" : ""})`;
function q1(x) { return String(Math.round(x * 10) / 10); }
if (r.soon.length) lines.push(`86 위험 ${r.soon.length}개 · ` + r.soon.slice(0, 8).map(fmt86).join(" · ") + (r.soon.length > 8 ? ` 외 ${r.soon.length - 8}개` : "") + (r.later ? ` (그 뒤 ${r.later}개는 앱에서)` : ""));
if (r.bad.length) lines.push(`GW 확인 필요 ${r.bad.length} · ` + r.bad.join(" · ") + " (앱 리포트 탭 GW 상황판)");
if (errs.length) lines.push(`(앱 화면 오류 ${errs.length}개: ${errs[0].slice(0, 80)})`);
console.log(lines.length ? lines.join("\n") : "알림 없음");
process.exit(lines.length ? 10 : 0);
