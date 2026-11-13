// 상시 수집 판단(gw-agent/auto.js) 시험: 확장과 같은 코드를 그대로 불러 상황별 결정을 확인 (시트·GW에 닿지 않음)
// 사용: node order-src/test/gw/auto.test.mjs      · 같은 상황을 order-src/auto/test_collect.py(클라우드 쪽)도 봄
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
vm.runInThisContext(fs.readFileSync(REPO + "/gw-agent/auto.js", "utf8"));
// 판단 시험은 고정 계획으로 (실제 gw-plan.json이 늘어도 시험이 흔들리지 않게). 실제 파일은 아래에서 따로 검사
const PLAN = [{ id: "scout-1", kind: "scout", key: "gwScout", label: "MIS 메뉴 살펴보기" }];
const SHIPPED = JSON.parse(fs.readFileSync(REPO + "/gw-plan.json", "utf8"));
const ms = (s) => Date.parse(s + ":00+09:00"), addDay = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
function base(now, { missG = [], missM = [], pcAgo = 60, scout = true, ...over } = {}) {
  const T = new Date(now + 9 * 3600e3).toISOString().slice(0, 10), d = { "master.order": { rows: Array.from({ length: 120 }, (_, i) => [i]) }, forecast: {} };
  for (let i = 1; i < 60; i++) { const x = addDay(T, -i); d.forecast[x] = { fc: "100", act: missG.includes(x) ? "" : "90" }; if (i <= 40 && !missM.includes(x)) d["menuDay." + x] = { at: 1, rows: [{ m: "a", q: 1 }] }; }
  for (let i = 0; i < 30; i++) d["pad" + i] = 1;
  d.misAgent = { at: now - pcAgo * 1000, mode: "ondemand", ver: "1.7.0" }; d.misPush = { date: T, status: "done", at: now - 3600e3 };
  if (scout) d.gwScout = { at: 1, menus: [] };
  return Object.assign(d, over);
}
let pass = 0, n = 0;
const t = (name, r, check) => { n++; let ok = false; try { ok = !!check(r, r.make ? r.make() : null); } catch (e) { ok = false; } if (ok) pass++; console.log((ok ? "통과  " : "실패  ") + name + (ok ? "" : "\n   " + JSON.stringify({ act: r.act, why: r.why, req: r.make ? r.make() : null }).slice(0, 500))); };
const N = ms("2026-11-13T10:23"), Y = "2026-11-12", N_T = "2026-11-13"; // 금요일. 어제 = 11/12(목), 그 주 월요일 = 11/9
const doneToday = (o) => ({ salesPush: Object.assign({ id: 1, at: ms("2026-11-13T09:00"), status: "done", from: "2026-11-09", to: Y, doneAt: ms("2026-11-13T09:01") }, o) });
const P = (d, now = N, o = {}, plan = PLAN) => autoPlan(d, now, plan, o);
t("A 받을 것 없음", P(base(N)), (r) => r.act === "none");
t("B 어제 매출·메뉴 없음 → 한 요청에 둘 다", P(base(N, { missG: [Y], missM: [Y] })), (r, q) => r.act === "request" && q.from === "2026-11-09" && q.to === Y && q.status === "pending" && q.also.menu.from === Y && !("kind" in q) && q.src === "auto");
t("C PC 꺼짐(클라우드) → 요청 안 함", P(base(N, { missG: [Y], pcAgo: 3600 })), (r) => r.act === "skip");
t("C2 PC에서 부르면 신호가 오래돼도 요청", P(base(N, { missG: [Y], pcAgo: 3600 }), N, { pc: true }), (r, q) => r.act === "request" && q.src === "pc");
t("D 시트가 빔 → 아무것도 안 씀", P(base(N, { missG: [Y], forecast: {} })), (r) => r.act === "bad");
t("G 오늘 받아 봤는데 그날이 빔(휴무) → 다시 안 함", P(base(N, Object.assign({ missG: ["2026-11-10"] }, doneToday({ parts: { gross: { status: "done", doneAt: ms("2026-11-13T09:01") } } })))), (r) => r.act === "none");
t("G2 매출·메뉴를 같이 받아 봤고(also 없음) 메뉴 하루가 빔 → 다시 안 함", P(base(N, Object.assign({ missM: ["2026-11-10"] }, doneToday({ parts: { gross: { status: "done", doneAt: ms("2026-11-13T09:01") }, menu: { status: "done", doneAt: ms("2026-11-13T09:02") } } })))), (r) => r.act === "none");
t("G3 어젯밤 기록(05시 전)은 오늘 받은 걸로 안 침", P(base(N, { missG: [Y], salesPush: { id: 1, at: ms("2026-11-12T22:00"), status: "done", from: "2026-11-09", to: "2026-11-11", doneAt: ms("2026-11-12T22:01"), parts: { gross: { status: "done", doneAt: ms("2026-11-12T22:01") } } } })), (r) => r.act === "request");
t("H 발주 시간대(13:00) → 미룸", P(base(ms("2026-11-13T13:00"), { missG: [Y] }), ms("2026-11-13T13:00")), (r) => r.act === "skip");
t("H2 14:40도 미룸", P(base(ms("2026-11-13T14:40"), { missG: [Y] }), ms("2026-11-13T14:40")), (r) => r.act === "skip");
t("H3 15:23은 요청", P(base(ms("2026-11-13T15:23"), { missG: [Y] }), ms("2026-11-13T15:23")), (r) => r.act === "request");
t("H4 PC는 새벽 3시에 쉼", P(base(ms("2026-11-13T03:00"), { missG: [Y] }), ms("2026-11-13T03:00"), { pc: true }), (r) => r.act === "skip");
t("I 다른 매출 요청이 도는 중 → 덮지 않음", P(base(N, { missG: [Y], salesPush: { id: 5, at: N - 60e3, status: "running", startAt: N - 50e3 } })), (r) => r.act === "skip");
t("J 발주 전송 중 → 미룸", P(base(N, { missG: [Y], misPush: { date: "2026-11-13", status: "pending", at: N - 30e3 } })), (r) => r.act === "skip");
t("L 메뉴만 빔 → 메뉴 요청만", P(base(N, { missM: ["2026-11-11", Y] })), (r, q) => q.kind === "menu" && q.from === "2026-11-11" && !q.also);
t("M 지난주 일요일 매출이 빔 → 그날부터", P(base(N, { missG: ["2026-11-08", Y] })), (r, q) => q.from === "2026-11-08");
t("O 오늘 받은 다른 버튼의 ✓는 들고 감", P(base(N, Object.assign({ missM: [Y] }, doneToday({ parts: { gross: { status: "done", doneAt: ms("2026-11-13T09:01"), text: "g" } } })))), (r, q) => q.parts.gross.text === "g" && q.kind === "menu");
t("S1 계획: 메뉴 살펴보기가 아직 없음 → 그것만 요청", P(base(N, { scout: false })), (r, q) => r.act === "request" && q.kind === "scout" && !q.from && !q.also);
t("S2 계획 + 어제 매출 → 매출이 먼저, 살펴보기는 덧붙임", P(base(N, { scout: false, missG: [Y] })), (r, q) => !q.kind && q.from === "2026-11-09" && q.also.scout && !q.also.menu);
t("S3 살펴보기를 오늘 해 봤는데 실패 → 오늘은 다시 안 함", P(base(N, Object.assign({ scout: false }, doneToday({ parts: { scout: { status: "error", doneAt: ms("2026-11-13T09:05") } } })))), (r) => r.act === "none");
t("S4 계획에 이상한 종류(대문자·gross)는 무시", P(base(N, { scout: false }), N, {}, [{ kind: "Evil", key: "x" }, { kind: "gross", key: "y" }, { kind: "scout" }]), (r) => r.act === "none");
t("S5 계획이 배열이 아니어도 멈추지 않음", P(base(N, { missG: [Y] }), N, {}, { bad: 1 }), (r) => r.act === "request");
t("R 다시 보내기(re)와 새 번호", P(base(N, { missG: [Y] })), (r) => { const a = r.make(N), b = r.make(N + 5000, 1); return b.re === 1 && b.id !== a.id && !a.re; });
// freshDays: 키가 오래되면 다시, 최신이면 안 함
const HPLAN = [{ id: "h", kind: "hour", key: "hourShare", freshDays: 7 }];
t("F1 hourShare 없음 → 시간대 요청", P(base(N, { scout: true }), N, {}, HPLAN), (r, q) => r.act === "request" && q.kind === "hour");
t("F2 hourShare 최신(어제) → 안 함", P(base(N, { scout: true, hourShare: { to: addDay(N_T, -1), wd: {} } }), N, {}, HPLAN), (r) => r.act === "none");
t("F3 hourShare 8일 전 → 다시", P(base(N, { scout: true, hourShare: { to: addDay(N_T, -8), wd: {} } }), N, {}, HPLAN), (r, q) => r.act === "request" && q.kind === "hour");
const OPLAN = [{ id: "o", kind: "orders", key: "misOrderScan", freshDays: 2 }];
t("F4 주문현황 어제까지 읽음 → 안 함", P(base(N, { scout: true, misOrderScan: { at: 1, to: Y } }), N, {}, OPLAN), (r) => r.act === "none");
t("F5 주문현황 그제까지만 → 오늘 다시 (어제 날짜 없이 보내면 PC가 어제로)", P(base(N, { scout: true, misOrderScan: { at: 1, to: addDay(Y, -1) } }), N, {}, OPLAN), (r, q) => r.act === "request" && q.kind === "orders" && !q.to);
// 실제 gw-plan.json 검사: 배열이고, 각 항목이 알려진 kind·key를 가짐 (mis-sales.js RUN에 있는 종류만)
t("Z 실제 gw-plan.json 모양", { act: Array.isArray(SHIPPED) && SHIPPED.every((j) => j && /^(scout|hour|orders|daily|pl|catalog)$/.test(j.kind) && j.key) ? "none" : "bad", why: "" }, (r) => r.act === "none");
console.log(`${pass}/${n} 통과`); process.exit(pass === n ? 0 : 1);
