// 자정 넘김 autoSt 시험 (#26): 거꾸로 된 날에 낸 요청이 자정을 넘겨 끝나도 요청 번호(reqId)가 남는지
//  gw-agent/bg.js의 autoCheck를 그 파일 그대로 떼어 내 가짜 저장소로 돌림 (시트·크롬에 닿지 않음)
// 사용: node order-src/test/gw/autost.test.mjs
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = fs.readFileSync(REPO + "/gw-agent/bg.js", "utf8");

// autoCheck 함수 하나만 떼어 냄 (중괄호 세기). 없어지거나 이름이 바뀌면 여기서 멈춤
function cutAutoCheck() {
  const start = SRC.indexOf("async function autoCheck(");
  if (start < 0) throw new Error("bg.js에서 autoCheck를 찾지 못함 — 시험을 고쳐 주세요");
  let depth = 0, end = -1;
  for (let i = SRC.indexOf("{", start); i < SRC.length; i++) {
    const c = SRC[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) { end = i + 1; break; }
  }
  const fn = SRC.slice(start, end > 0 ? end : undefined);
  if (end < 0 || !fn.includes("const day = ymd(")) throw new Error("autoCheck를 떼어 내지 못함 — 시험을 고쳐 주세요");
  return fn;
}
const FN = cutAutoCheck();

const pad = (n) => String(n).padStart(2, "0");
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const at = (y, m, d, h, mi) => new Date(y, m - 1, d, h, mi).getTime(); // 이 PC의 지역 시각 그대로 (자정 넘김을 지역 시각으로 만듦)

// autoCheck가 쓰는 것만 흉내: 저장소(get·put), 시트 읽기(netGet은 실패시켜 catch 길로), AUTO·API·PLAN_URL
async function run(autoSt, now, L = { autoAnyTime: true }) {
  const store = { autoSt: JSON.parse(JSON.stringify(autoSt)) }, puts = [];
  const ctx = {
    AUTO: { every: 30 * 60e3, idle: 3 * 3600e3, retry: 5 * 60e3, max: 4 },
    API: "https://example.invalid/api", PLAN_URL: "https://example.invalid/plan.json",
    get: async (k) => { const keys = typeof k === "string" ? [k] : Array.isArray(k) ? k : Object.keys(k || {}); const o = {}; keys.forEach((x) => { if (x in store) o[x] = store[x]; }); return o; },
    put: async (o) => { puts.push(JSON.parse(JSON.stringify(o))); Object.assign(store, JSON.parse(JSON.stringify(o))); },
    netGet: async () => { throw new Error("시험: 인터넷 없음"); }, // 시트를 못 읽은 길로 → 저장된 autoSt를 그대로 확인
    ymd: (d = new Date()) => dayOf(d.getTime()),
    autoPlan: () => ({ act: "none", why: "시험" }), hrStart: () => {}, postOk: async () => true,
    log: async () => {}, fast: () => {}, tick: () => {}, setTimeout: () => 0,
  };
  vm.createContext(ctx);
  vm.runInContext(FN, ctx);
  await ctx.autoCheck(now, L);
  return { st: store.autoSt, puts };
}

let pass = 0, n = 0;
const t = (name, ok, detail) => { n++; if (ok) pass++; console.log((ok ? "통과  " : "실패  ") + name + (ok ? "" : "\n   " + JSON.stringify(detail).slice(0, 500))); };

const NIGHT = at(2026, 11, 16, 23, 40), MIDNIGHT = at(2026, 11, 17, 0, 5);
const REQ = at(2026, 11, 16, 22, 40); // 밤에 낸 요청 (18시간 기다림 창 안)
const running = { day: "2026-11-16", n: 3, reqId: REQ, reqAt: REQ, msg: "스스로 받는 중: 매출 11/16~11/16", at: NIGHT, next: NIGHT - 5 * 60e3, okAt: NIGHT - 3600e3 };

// 1. 자정을 넘기면: 요청 번호·시각은 남고, 하루 횟수만 0
const a = await run(running, MIDNIGHT);
t("1 자정 넘김 — reqId가 남아 tickOnce가 결과를 찾을 수 있음", a.st.reqId === REQ && "s" + a.st.reqId === "s" + REQ, a.st);
t("2 자정 넘김 — reqAt·msg도 남음", a.st.reqAt === REQ && typeof a.st.msg === "string" && a.st.msg.length > 0, a.st);
t("3 자정 넘김 — 날짜는 오늘, 하루 횟수(n)는 0", a.st.day === dayOf(MIDNIGHT) && a.st.n === 0, a.st);

// 2. 같은 날이면 예전 그대로 (횟수 유지·요청 번호 유지)
const b = await run(running, NIGHT);
t("4 같은 날 — n을 그대로 둠", b.st.n === 3 && b.st.day === "2026-11-16", b.st);

// 3. 어제 낸 요청이 없으면 없는 채로 (없는 번호를 만들지 않음)
const c = await run({ day: "2026-11-16", n: 4, msg: "다 받아 둠", okAt: NIGHT }, MIDNIGHT);
t("5 어제 요청 없음 — reqId를 만들지 않고 n만 0", !("reqId" in c.st) && c.st.n === 0, c.st);

// 4. 하루 상한은 날이 바뀌면 새로 (어제 4번 채웠어도 오늘은 다시 셈)
t("6 날이 바뀌면 하루 상한(4번)도 새로", c.st.n === 0 && c.st.day === dayOf(MIDNIGHT), c.st);

// 5. 자정을 넘겨도 tickOnce가 보는 모양 그대로 ("s"+autoSt.reqId === job.id)
const jobId = "s" + REQ;
t("7 job.id와 autoSt.reqId가 자정 뒤에도 맞음", "s" + a.st.reqId === jobId, { jobId, reqId: a.st.reqId });

// 6. 저장은 autoSt 칸만 건드림 (다른 칸을 지우지 않음)
const keys = Object.keys(a.puts[a.puts.length - 1] || {});
t("8 저장은 autoSt 칸만", keys.length === 1 && keys[0] === "autoSt", keys);

console.log(`${pass}/${n} 통과`);
process.exit(pass === n ? 0 : 1);
