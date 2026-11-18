// 버튼 로딩바 시험 (11/16 KM): [GW 전송] · [Gross Sales 불러오기] · [메뉴 판매 불러오기]를 실제로 눌러서
//  1) 누른 즉시 그 줄 아래에 진행 막대가 생기고 버튼이 잠기는지 (중복 클릭 방지)
//  2) PC가 시트에 pending → running으로 응답하는 동안 진행이 계속 보이는지
//  3) done · error · 시간 초과에서 막대가 자연스럽게 접히고 결과(✓·⚠)가 남는지
// 를 헤드리스 크롬으로 확인합니다. 가짜 시트(Code.gs) + 가짜 PC만 씁니다 — 실제 시트·PC·MIS에는 아무것도 안 보냅니다.
// 사용: node order-src/test/gw/e2e-loading.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { load } from "../gas/sim.mjs";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const TODAY = kst();
let fails = 0;
const ok = (c, m) => { console.log((c ? "통과 " : "실패 ") + m); if (!c) fails++; };
const b = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined, args: ["--no-sandbox"] });

// 한 번의 시험 세계: 가짜 시트 + 가짜 PC + 앱 화면
async function world(sc = {}) {
  const gas = load(REPO + "/apps-script/order/Code.gs"), posts = [];
  const post = (key, value) => gas.post({ action: "set", key, value });
  post("btnLock", { salt: "s", hash: "h" });
  post("master.order", { rows: [
    { name: "부채살", code: "C1", vendor: "온세물류", unit: "PK" },
    { name: "양상추", code: "C2", vendor: "새싹농산", unit: "PK" }] });
  post("input." + TODAY, { "부채살": { s: 2, o: 3 }, "양상추": { s: 1, o: 2 } });
  const ctx = await b.newContext({ timezoneId: "Asia/Seoul" });
  await ctx.route("https://script.google.com/**", async (r) => {
    const q = r.request(), u = new URL(q.url());
    if (q.method() === "GET") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(gas.get(Object.fromEntries(u.searchParams))) });
    let body = {}; try { body = JSON.parse(q.postData() || "{}"); } catch {}
    posts.push(body);
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(gas.post(body)) });
  });
  await ctx.route("https://app.test/**", (r) => r.fulfill({ status: 404, body: "" })); // 나중에 건 것이 먼저라 아래 order.html이 이김
  await ctx.route("https://app.test/order.html", (r) => r.fulfill({ path: REPO + "/order.html", contentType: "text/html" }));
  await ctx.addInitScript((o) => { window.__spTest = o.sp; }, { sp: sc.spTest || null });
  // 가짜 PC: 확장처럼 pending을 집어 가 running을 적고, 조금 뒤 done·error를 적음
  const P = { on: sc.pcOn !== false, beat: 0 }, seen = {};
  let stop = false;
  const pcLoop = (async () => {
    while (!stop) {
      await sleep(120);
      if (!P.on) continue;
      const now = Date.now();
      if (now - P.beat > 60e3) { P.beat = now; post("misAgent", { at: now, mode: "ondemand", ver: "1.7.3" }); }
      const d = gas.get({ api: "1" }).data || {};
      const mp = d.misPush || {};
      if (/pending|running/.test(mp.status || "")) {
        const j = seen["mis:" + mp.id] || (seen["mis:" + mp.id] = { at: now, st: "pending" });
        if (mp.status === "pending" && j.st === "pending" && now - j.at > (sc.pickup ?? 500)) {
          j.st = "running"; j.at = now;
          post("misPush", { ...mp, status: "running", startAt: now });
          post("misAgent", { at: now, mode: "ondemand", ver: "1.7.3", job: "mis", step: "경영정보 열기", stepAt: now });
        } else if (mp.status === "running" && j.st === "running" && now - j.at > (sc.misRun ?? 1200)) {
          j.st = "done";
          if (sc.misNever) continue; // 끝내 응답을 안 적는 PC (시간 초과 시험)
          if (sc.misError) post("misPush", { ...mp, status: "error", doneAt: now, text: "MIS 로그인 화면이라 멈췄어요" });
          else post("misPush", { ...mp, status: "done", doneAt: now, saved: 2, total: 2 });
        }
      }
      const sp = d.salesPush || {};
      if (/pending|running/.test(sp.status || "")) {
        const k = "sales:" + sp.id, kind = sp.kind || "gross";
        const j = seen[k] || (seen[k] = { at: now, st: "pending", kind });
        if (sp.status === "pending" && j.st === "pending" && now - j.at > (sc.pickup ?? 500)) {
          j.st = "running"; j.at = now;
          post("salesPush", { ...sp, status: "running", startAt: now, cur: kind, prog: kind === "menu" ? "8/28일" : "" });
        } else if (sp.status === "running" && j.st === "running" && now - j.at > (sc.salesRun ?? 5000)) {
          j.st = "done";
          if (sc.salesNever) continue; // PC가 응답을 안 적음 → 앱 화면에서 시간 초과
          if (sc.salesError) post("salesPush", { ...sp, status: "error", doneAt: now, text: "MIS가 응답하지 않아 멈췄어요" });
          else post("salesPush", { ...sp, status: "done", doneAt: now, text: kind === "menu" ? "28일 저장" : "6일 저장" });
        }
      }
    }
  })();
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("dialog", (d) => d.accept().catch(() => {}));
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto("https://app.test/order.html");
  await pg.evaluate(() => localStorage.setItem("order-calc-pin", "h"));
  await pg.reload(); await sleep(900);
  const close = async () => { stop = true; await pcLoop.catch(() => {}); await ctx.close(); };
  return { gas, pg, posts, errs, close };
}

const bar = (pg, sel) => pg.evaluate((s) => {
  const e = document.querySelector(s + " .lbar"); if (!e) return null;
  const f = e.querySelector(".lb-fil"), t = e.querySelector(".lb-txt"), cs = getComputedStyle(e);
  return { live: e.dataset.live, text: (t ? t.textContent : "").trim(), anim: f ? getComputedStyle(f).animationName : "",
    opacity: +cs.opacity, h: Math.round(e.getBoundingClientRect().height), css: e.className, pct: e.getAttribute("aria-valuenow") };
}, sel);
const btn = (pg, id) => pg.evaluate((i) => { const b = document.getElementById(i); return b ? { disabled: b.disabled, label: b.textContent.trim() } : null; }, id);
const status = (pg, sel) => pg.evaluate((s) => (document.querySelector(s + " .mis-s")?.textContent || "").trim(), sel);
const until = async (fn, ms = 4000, step = 100) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(step); } return null; };
// 앱이 시트에 적은 요청(pending)의 id — set은 value, 다른 칸에 덧붙일 때는 merge patch로 갑니다
const pendIds = (w, key) => [...new Set(w.posts.filter((x) => x.key === key).map((x) => Object.assign({}, x.value || x.patch || {})).filter((v) => v.status === "pending").map((v) => v.id))];

// ── 1) GW 전송 ─────────────────────────────────────────────
{
  const w = await world();
  const pg = w.pg;
  await until(async () => (await btn(pg, "misGo")) && !(await btn(pg, "misGo")).disabled);
  const b0 = await btn(pg, "misGo");
  ok(!!b0 && /GW 전송 2/.test(b0.label), "발주 화면에 [GW 전송 2]가 있고 누를 수 있음");
  await pg.evaluate(() => document.getElementById("misGo").click());
  // 11/19: 전송 전 확인 화면(추천과 다른 품목 빨강)이 뜸 → [GW 전송]을 눌러야 보냄
  await until(async () => await pg.evaluate(() => !!document.getElementById("misDlg") && document.getElementById("misDlg").open));
  ok(await pg.evaluate(() => document.querySelectorAll("#misDlg .md-row").length === 2), "전송 전 확인 화면에 발주 2줄");
  await pg.evaluate(() => document.querySelector("#misDlg .md-ok").click());
  await sleep(150);
  const b1 = await bar(pg, "#misBar"), v1 = await btn(pg, "misGo");
  ok(!!b1 && b1.live === "run", "누른 즉시 GW 줄 아래에 진행 막대가 보임 (data-live=" + (b1 && b1.live) + ")");
  // 11/19: GW 전송 막대는 0~100% 진행률(채워지는 막대 + "NN%")
  ok(!!b1 && /pct/.test(b1.css) && +b1.pct > 0 && +b1.pct < 100 && /^\d+%/.test(b1.text) && b1.h > 0 && b1.opacity > 0.9, "막대에 진행률이 보임 (" + (b1 && b1.pct) + "% · " + (b1 && b1.text) + ")");
  ok(!!v1 && v1.disabled, "누른 즉시 버튼이 잠김 (중복 클릭 방지)");
  await pg.evaluate(() => { for (let i = 0; i < 3; i++) document.getElementById("misGo").click(); }); // 잠긴 동안 세 번 더 눌러 봄
  const pick = await until(async () => { const x = await bar(pg, "#misBar"); return x && x.live === "run" && x.text ? x : null; }, 2000);
  ok(!!pick && /넣는 중|열기|여는 중|보내는 중/.test(pick.text), "PC가 받아 도는 동안 진행 글이 막대에 나옴 (" + (pick && pick.text) + ")");
  const pend = pendIds(w, "misPush");
  ok(pend.length === 1, "잠긴 동안 여러 번 눌러도 요청은 1건만 (pending " + pend.length + "건)");
  const okk = await until(async () => { const x = await bar(pg, "#misBar"); return x && x.live === "ok" ? x : null; }, 5000);
  ok(!!okk, "끝나면 막대가 초록으로 채워짐 (" + (okk && okk.text) + ")");
  const gone = await until(async () => !(await bar(pg, "#misBar")), 4000);
  ok(!!gone, "성공 뒤 막대가 자연스럽게 사라짐");
  const s1 = await status(pg, "#misBar"), v2 = await btn(pg, "misGo");
  ok(/^✓/.test(s1) && /저장 완료/.test(s1), "결과가 글자로 남음 (" + s1 + ")");
  ok(!!v2 && !v2.disabled, "끝나면 버튼이 다시 눌림");
  ok(w.errs.length === 0, "화면 오류 없음 " + (w.errs.length ? JSON.stringify(w.errs.slice(0, 2)) : ""));
  await w.close();
}

// ── 2) Gross Sales 불러오기 ─────────────────────────────────
{
  const w = await world(), pg = w.pg;
  await pg.click('#dock [data-dock="forecast"]'); await sleep(400);
  await pg.evaluate(() => document.getElementById("salesGo").click());
  await sleep(120);
  const b1 = await bar(pg, "#salesBar"), v1 = await btn(pg, "salesGo");
  ok(!!b1 && b1.live === "run" && /보내는 중|여는 중|읽는 중/.test(b1.text), "Gross: 누른 즉시 로딩바 (" + (b1 && b1.text) + ")");
  ok(!!v1 && v1.disabled, "Gross: 누른 즉시 버튼 잠김");
  await pg.evaluate(() => document.getElementById("salesGo").click()); // 잠긴 뒤 한 번 더
  const run = await until(async () => { const x = await bar(pg, "#salesBar"); return x && /읽는 중/.test(x.text) ? x : null; }, 5000);
  ok(!!run, "Gross: PC가 읽는 동안 진행 글 (" + (run && run.text) + ")");
  const pend = pendIds(w, "salesPush");
  ok(pend.length === 1, "Gross: 두 번 눌러도 요청 1건 (pending " + pend.length + "건)");
  const okk = await until(async () => { const x = await bar(pg, "#salesBar"); return x && x.live === "ok" ? x : null; }, 6000);
  ok(!!okk && /저장/.test(okk.text), "Gross: 끝나면 초록 막대 (" + (okk && okk.text) + ")");
  ok(!!(await until(async () => !(await bar(pg, "#salesBar")), 4000)), "Gross: 성공 뒤 막대 사라짐");
  const s1 = await status(pg, "#salesBar"), v2 = await btn(pg, "salesGo");
  ok(/^✓/.test(s1), "Gross: 결과 글 남음 (" + s1 + ")");
  ok(!!v2 && !v2.disabled && /불러오기/.test(v2.label), "Gross: 버튼이 [불러오기]로 돌아옴");
  await w.close();
}

// ── 3) 메뉴 판매 불러오기 + 실패(error) ─────────────────────
{
  const w = await world({ salesError: true }), pg = w.pg;
  await pg.click('#dock [data-dock="forecast"]'); await sleep(400);
  await pg.evaluate(() => document.getElementById("menuGo").click());
  await sleep(120);
  const b1 = await bar(pg, "#menuBar"), v1 = await btn(pg, "menuGo");
  ok(!!b1 && b1.live === "run" && v1 && v1.disabled, "메뉴: 누른 즉시 로딩바·잠금 (" + (b1 && b1.text) + ")");
  const run = await until(async () => { const x = await bar(pg, "#menuBar"); return x && /8\/28일/.test(x.text) ? x : null; }, 5000);
  ok(!!run, "메뉴: PC가 읽는 날짜 진행이 막대에 나옴 (" + (run && run.text) + ")");
  const bad = await until(async () => { const x = await bar(pg, "#menuBar"); return x && x.live === "bad" ? x : null; }, 6000);
  ok(!!bad, "메뉴: 실패하면 막대가 빨강으로 채워짐 (" + (bad && bad.text) + ")");
  ok(!!(await until(async () => !(await bar(pg, "#menuBar")), 5000)), "메뉴: 실패 막대도 잠깐 뒤 사라짐");
  const s1 = await status(pg, "#menuBar");
  ok(/^⚠/.test(s1), "메뉴: 실패 결과가 글자로 남음 (" + s1 + ")");
  await w.close();
}

// ── 4) PC가 응답을 안 적을 때 (시간 초과) ────────────────────
{
  const w = await world({ salesNever: true, spTest: { runMax: 2500 } }), pg = w.pg;
  await pg.click('#dock [data-dock="forecast"]'); await sleep(400);
  await pg.evaluate(() => document.getElementById("salesGo").click());
  const bad = await until(async () => { const x = await bar(pg, "#salesBar"); return x && x.live === "bad" ? x : null; }, 9000);
  ok(!!bad, "응답 없음: 시간이 지나면 막대가 빨강으로 바뀜 (" + (bad && bad.text) + ")");
  ok(!!(await until(async () => !(await bar(pg, "#salesBar")), 5000)), "응답 없음: 막대가 접힘");
  const s1 = await status(pg, "#salesBar"), v2 = await btn(pg, "salesGo");
  ok(/^⚠/.test(s1) && /응답 없음/.test(s1), "응답 없음: 결과 글 (" + s1 + ")");
  ok(!!v2 && !v2.disabled, "응답 없음: 다시 누를 수 있게 풀림");
  await w.close();
}

await b.close();
console.log(fails ? `\n실패 ${fails}건` : "\n모두 통과");
process.exit(fails ? 1 : 0);
