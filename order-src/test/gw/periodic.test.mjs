// 당일 되풀이 수집 판단(gw-agent/periodic.js) 시험: 확장과 같은 코드를 불러 상황별 결정을 확인 (시트·GW에 닿지 않음)
// 사용: node order-src/test/gw/periodic.test.mjs
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
vm.runInThisContext(fs.readFileSync(REPO + "/gw-agent/periodic.js", "utf8"));
const SHIPPED = JSON.parse(fs.readFileSync(REPO + "/gw-plan.json", "utf8"));
const ms = (s) => Date.parse(s + ":00+09:00");
let pass = 0, n = 0;
const t = (name, r, check) => { n++; let ok = false; try { ok = !!check(r); } catch (e) { ok = false; } if (ok) pass++; console.log((ok ? "통과  " : "실패  ") + name + (ok ? "" : "\n   " + JSON.stringify(r).slice(0, 400))); };
const SHIP_JOBS = periodJobs(SHIPPED); // 실제 gw-plan.json의 되풀이 항목(now·setsToday·menuToday, 11/18부터 2시간·:40)
const JOBS = SHIP_JOBS.map((j) => ({ ...j, everyMin: 60, at: 40, from: 8 * 60 + 30, to: 23 * 60 })); // 시간대 규칙 시험은 1시간 주기·08:30~23:00으로 (실제 계획 4시간·11~21시는 A·E2에서)
const due = (s, st, jobs, o) => periodDue(ms(s), st || {}, jobs || JOBS, o || {});
const T = "2026-11-16", Y = "2026-11-15"; // 월요일

t("A 실제 계획 → 되풀이 항목 셋(당일 Gross·Set판매현황·메뉴 판매), 4시간·:00·12~21시 (11/20 KM '자주 띄우지 말자' · 11/26 KM 라인체크 '20:00으로')", { jobs: SHIP_JOBS }, (r) => r.jobs.length === 3 && r.jobs.every((j) => j.everyMin === 240 && j.at === 0 && j.from === 12 * 60 && j.to === 21 * 60));
t("B 09:39는 아직(:40 전) → 안 함", due(`${T}T09:39`), (r) => !r.go && /40분 뒤/.test(r.why));
t("C 09:40 → 셋 다 할 차례", due(`${T}T09:40`), (r) => r.go && r.jobs.length === 3 && /당일 Gross/.test(r.why));
t("D 09:55에 이번 시간 이미 함 → 안 함", due(`${T}T09:55`, { day: T, jobAt: { now: ms(`${T}T09:40`), setsToday: ms(`${T}T09:40`), menuToday: ms(`${T}T09:40`) } }), (r) => !r.go && /이미 함/.test(r.why));
{ const at = (h) => ({ now: ms(`${T}T${h}`), setsToday: ms(`${T}T${h}`), menuToday: ms(`${T}T${h}`) }), D = (s, st) => periodDue(ms(`${T}T${s}`), st, SHIP_JOBS);
  t("E2 실제 계획(4시간·:00·12~21시): 11:40 아직(12시 전) · 12:00 함 · 13:00~15:00 쉼 · 16:00 다시 · 20:00 다시(라인체크 창) · 21:00 끝", { a: D("11:40", {}), b: D("12:00", {}), c: [D("13:00", { day: T, n: 1, jobAt: at("12:00") }), D("15:00", { day: T, n: 1, jobAt: at("12:00") })], d: D("16:00", { day: T, n: 1, jobAt: at("12:00") }), f: D("20:00", { day: T, n: 2, jobAt: at("16:00") }), e: D("21:00", { day: T, n: 3, jobAt: at("20:00") }) },
    (r) => !r.a.go && r.b.go && r.b.jobs.length === 3 && r.c.every((x) => !x.go) && r.d.go && r.f.go && !r.e.go); }
t("E 10:40 → 다음 시간이므로 다시", due(`${T}T10:40`, { day: T, n: 1, jobAt: { now: ms(`${T}T09:40`), setsToday: ms(`${T}T09:40`), menuToday: ms(`${T}T09:40`) } }), (r) => r.go && r.jobs.length === 3);
t("F 한쪽만 했으면 안 한 쪽만", due(`${T}T10:43`, { day: T, jobAt: { now: ms(`${T}T10:40`), setsToday: ms(`${T}T10:40`) } }), (r) => r.go && r.jobs.length === 1 && r.jobs[0].kind === "menuToday");
t("F3 발주 시간대를 건너뛰어 14:46에 했어도 다음은 15:40 (시각에 다시 맞춤)", due(`${T}T15:40`, { day: T, jobAt: { now: ms(`${T}T14:46`), setsToday: ms(`${T}T14:46`), menuToday: ms(`${T}T14:46`) } }), (r) => r.go && r.jobs.length === 3);
t("F4 같은 시간대 15:55에는 셋 다 이미 함 → 안 함", due(`${T}T15:55`, { day: T, jobAt: { now: ms(`${T}T15:40`), setsToday: ms(`${T}T15:40`), menuToday: ms(`${T}T15:40`) } }), (r) => !r.go && r.jobs.length === 0);
t("G 발주 시간대 12:40 → 창을 안 띄움", due(`${T}T12:40`), (r) => !r.go && /발주 시간대/.test(r.why));
t("H 14:40도 발주 시간대 → 미룸", due(`${T}T14:40`), (r) => !r.go && /발주 시간대/.test(r.why));
t("I 14:46 → 발주 시간대 끝, 할 차례", due(`${T}T14:46`), (r) => r.go);
t("J 08:00 영업 전 → 안 함", due(`${T}T08:00`), (r) => !r.go && /영업 시간 밖/.test(r.why));
t("K 23:00 영업 끝 → 안 함", due(`${T}T23:00`), (r) => !r.go && /영업 시간 밖/.test(r.why));
t("L 22:40 마감 뒤 한 번 더(하루 합계) → 할 차례", due(`${T}T22:40`), (r) => r.go);
t("M 하루 상한(20번)이면 미룸", due(`${T}T15:40`, { day: T, n: 20 }), (r) => !r.go && /상한/.test(r.why));
t("N 날이 바뀌면 상한·이미 함이 풀림", due(`${T}T09:40`, { day: Y, n: 20, jobAt: { now: ms(`${Y}T09:40`) } }), (r) => r.go && r.jobs.length === 3);
t("O 요청 모양: 창 하나로 now + also.sets(오늘·force)", due(`${T}T09:40`), (r) => { const q = periodBundle(ms(`${T}T09:40`), r.jobs); return q.kind === "now" && q.from === T && q.to === T && q.status === "pending" && q.src === "pc-hour" && typeof q.id === "number" && q.also.sets.from === T && q.also.sets.to === T && q.also.sets.force === 1 && q.also.sets.today === 1 && !q.force; });
t("P Set만 할 차례면 sets 본체(today·force)", { jobs: periodJobs([{ kind: "setsToday" }]) }, (r) => { const q = periodBundle(ms(`${T}T09:40`), r.jobs); return q.kind === "sets" && q.today === 1 && q.force === 1 && q.from === T && q.to === T && r.jobs.length === 1; });
t("Q Gross만 할 차례면 also 없음", { jobs: periodJobs([{ kind: "now" }]) }, (r) => { const q = periodBundle(ms(`${T}T09:40`), r.jobs); return q.kind === "now" && !q.also && r.jobs.length === 1; });
t("R 계획에 되풀이 항목이 없으면 기본 둘 다(계획을 못 받아도 멈추지 않음)", { jobs: periodJobs([{ kind: "scout", key: "gwScout" }]) }, (r) => r.jobs.length === 2 && r.jobs[0].kind === "now");
t("S 계획이 배열이 아니어도 기본 둘 다", { jobs: periodJobs({ bad: 1 }) }, (r) => r.jobs.length === 2);
t("S2 모르는 종류는 무시(대문자·다른 kind)", { jobs: periodJobs([{ kind: "Now" }, { kind: "gross" }, { kind: "now" }]) }, (r) => r.jobs.length === 1 && r.jobs[0].kind === "now");
t("S3 같은 종류가 둘이면 하나만", { jobs: periodJobs([{ kind: "now" }, { kind: "now", at: 10 }]) }, (r) => r.jobs.length === 1 && r.jobs[0].at === 40);
const TWO_H = periodJobs([{ kind: "now", everyMin: 120 }]);
t("T 2시간 주기: 10:40엔 아직(09:40에 했음)", due(`${T}T10:40`, { day: T, jobAt: { now: ms(`${T}T09:40`) } }, TWO_H), (r) => !r.go && /120분 주기/.test(r.why));
t("T2 2시간 주기: 11:40엔 할 차례", due(`${T}T11:40`, { day: T, jobAt: { now: ms(`${T}T09:40`) } }, TWO_H), (r) => r.go);
const AT30 = periodJobs([{ kind: "now", at: 30 }]);
t("U 계획의 at을 따름: 09:29 안 함 / 09:30 함", { a: due(`${T}T09:29`, {}, AT30), b: due(`${T}T09:30`, {}, AT30) }, (r) => !r.a.go && r.b.go);
const WIN = periodJobs([{ kind: "now", from: "09:00", to: "18:00" }]);
t("V 계획의 from/to를 따름: 08:40 안 함 / 18:00 안 함 / 17:40 함", { a: due(`${T}T08:40`, {}, WIN), b: due(`${T}T18:00`, {}, WIN), c: due(`${T}T17:40`, {}, WIN) }, (r) => !r.a.go && !r.b.go && r.c.go);
const NOW = ms(`${T}T10:40`);
t("W 다른 매출 요청(폰) 도는 중 → 양보", periodBlocked({ salesPush: { id: 9, at: NOW - 60e3, status: "pending" } }, NOW, "s8"), (r) => r === "다른 매출 요청이 도는 중");
t("W2 내가 낸 요청이 아직 pending → 재요청 안 함", periodBlocked({ salesPush: { id: 8, at: NOW - 60e3, status: "pending" } }, NOW, "s8"), (r) => /앞서 낸 요청/.test(r));
t("W3 내가 낸 요청이 20분 넘게 pending → 새로 내도 됨", periodBlocked({ salesPush: { id: 8, at: NOW - 25 * 60e3, status: "pending" } }, NOW, "s8"), (r) => r === null);
t("W4 매출 창이 입력 중(running 2분) → 양보", periodBlocked({ salesPush: { id: 9, at: NOW - 3 * 60e3, startAt: NOW - 2 * 60e3, status: "running" } }, NOW, ""), (r) => r === "다른 매출 요청이 도는 중");
t("W5 발주 전송 중 → 양보", periodBlocked({ misPush: { date: T, status: "pending", at: NOW - 5 * 60e3 } }, NOW, ""), (r) => r === "발주 전송 중");
t("W6 발주 전송이 오래된 기록(30분 전) → 통과", periodBlocked({ misPush: { date: T, status: "pending", at: NOW - 30 * 60e3 } }, NOW, ""), (r) => r === null);
t("W7 아무 요청 없음 → 통과", periodBlocked({}, NOW, ""), (r) => r === null);
t("X 실제 gw-plan.json 되풀이 항목 모양", { p: SHIPPED.filter((j) => /^(now|setsToday|menuToday)$/.test(String(j.kind || ""))) }, (r) => r.p.length === 3 && r.p.every((j) => j.key && typeof j.everyMin === "number" && typeof j.at === "number" && /^\d{2}:\d{2}$/.test(j.from) && /^\d{2}:\d{2}$/.test(j.to) && j.note));

// ---- 1.17.0 (11/17 KM 1·13번): 당일 메뉴 판매를 같은 창에 + 실패하면 지수로 다시 + 마감 스냅샷 ----
const ALL3 = periodJobs([{ kind: "now" }, { kind: "setsToday" }, { kind: "menuToday" }]);
t("Y1 오늘 메뉴 판매도 한 요청에: now 본체 + also.sets·also.menu(둘 다 today·force)", { q: periodBundle(ms(`${T}T09:40`), ALL3) }, (r) => r.q.kind === "now" && r.q.also.sets.today === 1 && r.q.also.menu.from === T && r.q.also.menu.to === T && r.q.also.menu.force === 1 && r.q.also.menu.today === 1 && !("force" in r.q));
t("Y2 메뉴만 할 차례면 menu 본체(today·force) · also 없음", { q: periodBundle(ms(`${T}T09:40`), periodJobs([{ kind: "menuToday" }])) }, (r) => r.q.kind === "menu" && r.q.from === T && r.q.to === T && r.q.today === 1 && r.q.force === 1 && !r.q.also);
t("Y3 Gross + 메뉴만 → also.menu 하나", { q: periodBundle(ms(`${T}T09:40`), periodJobs([{ kind: "now" }, { kind: "menuToday" }])) }, (r) => r.q.kind === "now" && r.q.also.menu && !r.q.also.sets);
t("Y4 메뉴 항목이 계획에 없으면 요청에도 없음", { q: periodBundle(ms(`${T}T09:40`), periodJobs([{ kind: "now" }])) }, (r) => !r.q.also);
const fail1 = { day: T, failN: 1, jobAt: { now: ms(`${T}T09:40`), setsToday: ms(`${T}T09:40`), menuToday: ms(`${T}T09:40`) } };
t("Y5 실패 1번: 5분 전(09:44)엔 아직 / 5분 뒤(09:45)에 다시", { a: due(`${T}T09:44`, fail1), b: due(`${T}T09:45`, fail1) }, (r) => !r.a.go && r.b.go && r.b.jobs.length === 3);
const fail2 = { day: T, failN: 2, jobAt: { now: ms(`${T}T09:40`), setsToday: ms(`${T}T09:40`), menuToday: ms(`${T}T09:40`) } };
t("Y6 실패 2번: 15분(09:55)에 다시 (5분이 아님)", { a: due(`${T}T09:50`, fail2), b: due(`${T}T09:55`, fail2) }, (r) => !r.a.go && r.b.go);
t("Y7 실패 4번(상한 넘음): 다시 안 하고 다음 시간대", due(`${T}T10:20`, { day: T, failN: 4, jobAt: { now: ms(`${T}T10:00`) } }), (r) => !r.go && /이미 함/.test(r.why));
t("Y8 실패 뒤라도 5분이 안 지났으면 기다림", due(`${T}T10:42`, { day: T, failN: 1, jobAt: { now: ms(`${T}T10:40`), setsToday: ms(`${T}T10:40`), menuToday: ms(`${T}T10:40`) } }), (r) => !r.go && /이미 함/.test(r.why));
t("Y9 백오프 값: 5·15·45분, 60분에서 멈춤", [1, 2, 3, 4].map((k) => periodBackoff(k) / 60000), (r) => r.join() === "5,15,45,60");
t("Z1 마감 스냅샷: 21:19 아직 / 21:20 함", { a: snapDue(ms(`${T}T21:19`), {}), b: snapDue(ms(`${T}T21:20`), {}) }, (r) => !r.a.go && r.b.go && r.b.late === 0 && r.b.day === T);
t("Z2 마감 스냅샷: 21:45에 켜지면 늦게(late) 한 번", snapDue(ms(`${T}T21:45`), {}), (r) => r.go && r.late === 1);
t("Z3 오늘 이미 했으면 안 함 / 자정 넘으면 어제 것은 안 함", { a: snapDue(ms(`${T}T22:10`), { day: T, okAt: ms(`${T}T21:20`) }), b: snapDue(ms(`${T}T23:59`), {}), c: snapDue(ms(`2026-11-17T00:10`), { day: T, okAt: 1 }) }, (r) => !r.a.go && r.b.go && !r.c.go);
console.log(`${pass}/${n} 통과`); process.exit(pass === n ? 0 : 1);
