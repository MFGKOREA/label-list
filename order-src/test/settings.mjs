// 품목 설정 · 알림 설정 화면 시험 (11/28 KM 시안 3·5번 + 라인체크 알림 조건·기능): 실제 시트 자료로(쓰기는 막음)
// 사용: node order-src/test/settings.mjs <kv.json>   (kv.json은 매장 자료라 저장소에 넣지 마세요)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, "../../order.html");
if (!process.argv[2]) { console.log("사용: node settings.mjs <kv.json>"); process.exit(2); }
const kv = fs.readFileSync(process.argv[2], "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "통과 " : "실패 ") + m); if (c) pass++; else fail++; };
const b = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined });
const p = await (await b.newContext({ timezoneId: "Asia/Seoul", viewport: { width: 390, height: 844 } })).newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
const posts = [];
await p.route("https://script.google.com/**", (r) => {
  if (r.request().method() !== "GET") posts.push(JSON.parse(r.request().postData() || "{}"));
  const last = posts[posts.length - 1] || {};
  r.fulfill({ status: 200, contentType: "application/json", body: r.request().method() === "GET" ? kv : last.action === "push_notice" ? '{"ok":true,"sent":3}' : last.key === "salesPush" ? JSON.stringify({ ok: true, data: { salesPush: last.value } }) : '{"ok":true,"data":{}}' });
});
await p.addInitScript(() => { try { localStorage.clear(); } catch {} });
await p.goto("file://" + html);
await p.waitForFunction(() => window.__orderCalc && window.__orderCalc.model().items.length, null, { timeout: 60000 });
await p.evaluate((h) => h && localStorage.setItem("order-calc-pin", h), (JSON.parse(kv).data?.btnLock || {}).hash || "");
const NAME = "샐러드믹스베이스(해성)";
const ssOf = () => p.evaluate((n) => { const C = window.__orderCalc, it = C.model().items.find((i) => i.name === n); const r = C.calc(it, C.orderWindowFor(it, C.TODAY), 0, 0); return { ss: r.ss, use: r.use, need: r.need, hidden: !!it.hidden, lv: it.ssLv, cap: it.ssCap }; }, NAME);
const postOf = (key) => posts.filter((x) => x.key === key).pop();

// 0) 설정 화면 (11/28 KM "Forecast·리포트·데이터 파일을 하나로 합치고 설정 · 깔끔하고 직관적으로")
const vis = () => p.evaluate(() => document.querySelector(".view:not([hidden])").id);
const dockNow = () => p.evaluate(() => (document.querySelector("#dock [aria-current]") || { dataset: {} }).dataset.dock);
ok((await p.$$eval("#dock [data-dock]", (a) => a.map((x) => x.dataset.dock).join(","))) === "order,foh,prep,inv,set" && (await p.$$eval("#dock button", (a) => Math.min(...a.map((x) => x.getBoundingClientRect().width)))) >= 60, "하단 메뉴 5개: 발주 · FOH 발주 · 프랩 · 인벤토리 · 설정 (칸 폭 60px 이상)");
await p.click("#dock [data-dock=set]"); await p.waitForTimeout(700);
const rows = await p.$$eval("#v-set .st-row[data-go]", (a) => a.map((x) => x.dataset.go));
ok((await vis()) === "v-set" && rows.join(",") === "forecast,files:month,files:recipe,loc,log,veg,alerts,report:hlth,report:acc,report:learn,report:req,files:conn,help", "설정: 5묶음 13줄 — " + rows.join(" · "));
ok((await p.$$eval("#v-set .st-row", (a) => Math.min(...a.map((x) => x.getBoundingClientRect().height)))) >= 56 && (await p.$$eval("#v-set .st-row[data-go] small", (a) => a.filter((x) => !x.textContent.trim()).length)) === 0, "줄마다 누름 높이 56px 이상 · 지금 상태 한 줄이 비어 있지 않음");
console.log("   상태:", (await p.$$eval("#v-set .st-row[data-go]", (a) => a.map((x) => x.querySelector("b").textContent + " = " + x.querySelector("small").textContent + (x.querySelector(".st-badge:not([hidden])") ? " [" + x.querySelector(".st-badge").textContent + "]" : "")))).join("\n         "));
const need = await p.$$eval("#setNeed button", (a) => a.map((x) => x.textContent.trim()));
ok(!(await p.$eval("#setNeed", (x) => x.hidden)) && need.some((t) => /자동 수집/.test(t)) && !need.some((t) => /데이터 요청|레시피 재료/.test(t)), "'확인할 것' 카드: 급한 것만(매장 PC 자동 수집 꺼짐), 개수뿐인 것은 안 올림 — " + need.join(" / "));
ok((await p.inputValue("#wkIn")) !== "" && (await p.$eval("#wkIn", (i) => i.closest("#v-set") !== null)), "주말 여유분은 설정 화면에서 바로 고침: " + (await p.inputValue("#wkIn")) + "%");
// 줄 → 화면 → 뒤로가기: 제목 · 하단 메뉴 '설정' 표시 · 설정으로 돌아옴
const want = { forecast: "Forecast", "files:month": "월별 자료", "files:recipe": "레시피 · 품목 연결", "files:conn": "구글 시트 연결 · 백업", "report:hlth": "GW 상황판", "report:acc": "발주 정확도", "report:learn": "학습 상태", "report:req": "데이터 요청", loc: "발주 품목 설정", log: "수원컨벤션점 발주시트", veg: "야채 입고일", alerts: "알림 · 자동 실행", help: "사용방법" };
let navBad = [];
for (const g of rows) {
  await p.click(`#v-set .st-row[data-go="${g}"]`); await p.waitForTimeout(350);
  const st = await p.evaluate(() => { const v = document.querySelector(".view:not([hidden])"), bk = v.querySelector(".back"), r = bk && bk.getBoundingClientRect(); return { id: v.id, h2: (v.querySelector("h2") || {}).textContent, back: r ? Math.min(r.width, r.height) : 0, panes: v.querySelectorAll(".catpane:not([hidden])").length, allPanes: v.querySelectorAll(".catpane").length, grid: v.querySelectorAll(".catgrid").length }; });
  if (st.id !== "v-" + g.split(":")[0] || st.h2 !== want[g] || st.back < 44 || (await dockNow()) !== "set" || (st.allPanes && st.panes !== 1) || st.grid) navBad.push(g + ":" + JSON.stringify(st));
  await p.click(".view:not([hidden]) .back"); await p.waitForTimeout(250);
  if ((await vis()) !== "v-set") navBad.push(g + " 뒤로가기 → " + (await vis()));
}
ok(!navBad.length, "13줄 모두: 맞는 화면·제목 · 묶음 하나만 보임(분류 카드 없음) · 뒤로가기 44px · 하단 메뉴는 '설정' · 뒤로가면 설정 " + navBad.join(" | "));
ok((await p.textContent("#learnState")).length > 20 && (await p.$eval("#learnState", (x) => x.closest('#v-report .catpane[data-cat="learn"]') !== null)), "자료별 학습 상태는 리포트의 '학습 상태' 한 곳에");
// 발주 화면의 Forecast 타일로 들어가면 뒤로가기는 발주로
await p.click("#dock [data-dock=order]"); await p.waitForTimeout(300);
await p.click('#v-main .tile[data-go="forecast"]'); await p.waitForTimeout(350);
const d1 = await dockNow();
await p.click("#v-forecast .back"); await p.waitForTimeout(300);
ok(d1 === "set" && (await vis()) === "v-main" && (await dockNow()) === "order", "발주 화면 Forecast 타일 → 뒤로가기는 온 길(발주)로 · 하단 메뉴 표시도 따라감");

// 1) 설정 › 발주 품목 설정 → [설정] → 품목 설정 화면
await p.click("#dock [data-dock=set]"); await p.waitForTimeout(400);
await p.click('#v-set .st-row[data-go="loc"]'); await p.waitForTimeout(400);
await p.fill("#locQ", "샐러드믹스"); await p.waitForTimeout(400);
ok((await p.locator("#locList .lrow [data-item]").count()) >= 1, "발주 품목 설정 목록에 [설정] 단추");
await p.click("#locList .lrow [data-item]"); await p.waitForTimeout(400);
ok(!(await p.$eval("#v-item", (v) => v.hidden)) && (await p.textContent("#itemTitle")) === NAME, "[설정] → 품목 설정 화면: " + (await p.textContent("#itemTitle")));
ok((await p.locator("#itemBody .sw").count()) === 3 && (await p.locator("#ssRange").count()) === 1 && (await p.locator("#itemLoc").count()) === 1 && (await p.locator("#itemBody details.adv").count()) === 1, "스위치 3 · 여유분 슬라이더 · 보관 위치 · 고급 설정");

// 2) 여유분 슬라이더: 없음(ssCap 0) → 보통 → 넉넉히(1.5배) → 조금(절반)
const s0 = await ssOf();
ok(s0.cap === 0 && s0.ss === 0 && (await p.inputValue("#ssRange")) === "0", "샐러드는 지금 '없음'(11/26 KM 여유분 제외): 여유 0");
const setLv = async (v) => { await p.evaluate((v) => { const r = document.getElementById("ssRange"); r.value = String(v); r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); }, v); await p.waitForTimeout(250); };
await setLv(2); const s2 = await ssOf();
await setLv(3); const s3 = await ssOf();
await setLv(1); const s1 = await ssOf();
ok(s2.ss > 0 && Math.abs(s3.ss / s2.ss - 1.5) < 1e-6 && Math.abs(s1.ss / s2.ss - 0.5) < 1e-6 && Math.abs(s2.use - s0.use) < 1e-9, `여유분: 보통 ${s2.ss.toFixed(2)} · 넉넉히 ×1.5 = ${s3.ss.toFixed(2)} · 조금 ×0.5 = ${s1.ss.toFixed(2)} (사용량 ${s0.use.toFixed(1)} 그대로)`);
ok(/여유/.test(await p.textContent("#ssLine")) && /조금/.test(await p.textContent("#ssNow")), "화면에 사용 + 여유 = 필요 한 줄 · 고른 단계 이름");
await setLv(0); const s0b = await ssOf();
await p.waitForTimeout(900);
const ic = postOf("itemCfg");
ok(s0b.ss === 0 && ic && JSON.stringify(ic).includes(NAME), "다시 '없음' → 여유 0 · 시트 itemCfg에 저장");

// 3) 보이기 스위치: 끄면 숨김(추천에서 빠짐), 켜면 다시
await p.click('#itemBody [data-sw="show"]'); await p.waitForTimeout(250);
const h1 = (await ssOf().catch(() => ({ hidden: true }))).hidden;
await p.click('#itemBody [data-sw="show"]'); await p.waitForTimeout(250);
const h2 = (await ssOf()).hidden;
ok(h1 === true && h2 === false, "발주 목록에 보이기 스위치: 끔 → 숨김, 켬 → 다시 보임");

// 4) 고급 설정: 사용량 배수
await p.click("#itemBody details.adv > summary"); await p.waitForTimeout(150);
await p.fill('#itemBody [data-num="useK"]', "1.2"); await p.dispatchEvent('#itemBody [data-num="useK"]', "change"); await p.waitForTimeout(250);
const sk = await ssOf();
ok(Math.abs(sk.use / s0.use - 1.2) < 1e-6 && (await p.$eval("#itemBody details.adv", (d) => d.open)), `사용량 배수 1.2 → 사용 ${s0.use.toFixed(1)} → ${sk.use.toFixed(1)} · 고급 설정은 펼친 채로`);
await p.fill('#itemBody [data-num="useK"]', ""); await p.dispatchEvent('#itemBody [data-num="useK"]', "change"); await p.waitForTimeout(250);
ok(Math.abs((await ssOf()).use - s0.use) < 1e-9, "배수를 지우면 원래대로");
await p.click('#itemBody .inv-cta'); await p.waitForTimeout(300);
ok(!(await p.$eval("#v-loc", (v) => v.hidden)), "[완료] → 발주 품목 설정으로");

// 5) 알림 · 자동 실행 (11/28 라인체크 조건·기능 추가)
await p.click("#v-loc .back"); await p.waitForTimeout(300);
ok((await vis()) === "v-set", "품목 설정 [완료] → 발주 품목 설정 → 뒤로가기 → 설정 (돌아오는 길이 꼬이지 않음)");
await p.click('#v-set .st-row[data-go="alerts"]'); await p.waitForTimeout(300);
const A = "#alertsBody", cfgPost = () => (postOf("lineCheckCfg") || {}).value || (postOf("lineCheckCfg") || {}).patch || {};
ok(!(await p.$eval("#v-alerts", (v) => v.hidden)) && (await p.inputValue("#lcTime")) === "20:00" && (await p.inputValue("#lcLunch")) === "" && (await p.isChecked('[data-sec="FOH"]')) && (await p.isChecked('[data-sec="BOH2"]')) && !(await p.isChecked('[data-sec="BOH"]')), "기본값: 켬 · 마지막 확인 20:00 · 런치 먼저 확인 안 함 · FOH·BOH2");
ok((await p.isChecked('[data-kind="x"]')) && (await p.isChecked('[data-kind="chk"]')) && (await p.isChecked('[data-kind="inp"]')) && (await p.isChecked('[data-kind="pic"]')), "알릴 것 기본: X · 체크 · 온도·입력 · 사진 모두");
await p.click(A + " details.lc-adv > summary"); await p.waitForTimeout(150);
ok((await p.inputValue("#lcMin")) === "1" && (await p.inputValue("#lcNames")) === "3" && (await p.inputValue("#lcSkip")) === "BRUNCH, 사워도우" && !(await p.isChecked("#lcQp")) && !(await p.isChecked("#lcOk")) && !(await p.isChecked("#lcSun")), "세부 조건 기본: 1개부터 · 3개 보임 · 제외 BRUNCH, 사워도우 · 일요일 쉬기 끔(일요일도 영업)");
await p.fill("#lcTime", "15:30"); await p.dispatchEvent("#lcTime", "change"); await p.waitForTimeout(300);
ok(/16:00/.test(await p.textContent(A + " label.set-row .set-t")) && cfgPost().time === "15:30", "마지막 확인 15:30 → 'PC가 도는 16:00에 확인' · 시트 lineCheckCfg 저장");
ok((await p.$$eval("#lcLunch option", (o) => o.map((x) => x.value).join("|"))) === "|12:00", "런치 먼저 확인은 마지막 확인보다 앞선 PC 시각만 고름 (16시면 12:00)");
await p.fill("#lcTime", "21:30"); await p.dispatchEvent("#lcTime", "change"); await p.waitForTimeout(300);
ok(/확인 못 해요/.test(await p.textContent(A)), "20시 뒤 시각은 경고");
await p.fill("#lcTime", "20:00"); await p.dispatchEvent("#lcTime", "change"); await p.waitForTimeout(300);
await p.selectOption("#lcLunch", "12:00"); await p.waitForTimeout(300);
ok(cfgPost().lunch === "12:00" && /런치 칸만/.test(await p.textContent(A)) && (await p.$eval(A + " details.lc-adv", (d) => d.open)), "런치 먼저 확인 12:00 저장 · 세부 조건은 펼친 채로");
await p.fill("#lcTime", "11:00"); await p.dispatchEvent("#lcTime", "change"); await p.waitForTimeout(300);
ok(cfgPost().lunch === "" , "마지막 확인을 12시로 당기면 런치 먼저 확인은 저절로 꺼짐");
await p.fill("#lcTime", "20:00"); await p.dispatchEvent("#lcTime", "change"); await p.waitForTimeout(300);
await p.check('[data-sec="BOH"]'); await p.waitForTimeout(250);
ok(cfgPost().secs.BOH === 1, "구역 체크(BOH) → 저장");
await p.uncheck('[data-sec="BOH"]'); await p.waitForTimeout(250);
await p.uncheck('[data-kind="pic"]'); await p.waitForTimeout(250); await p.uncheck('[data-kind="x"]'); await p.waitForTimeout(250);
ok(cfgPost().kinds.pic === 0 && cfgPost().kinds.chk === 1 && cfgPost().x === 0, "알릴 것: 사진 빠짐 · X 끔 → kinds.pic 0 · x 0");
await p.check('[data-kind="pic"]'); await p.waitForTimeout(250); await p.check('[data-kind="x"]'); await p.waitForTimeout(250);
await p.selectOption("#lcMin", "3"); await p.waitForTimeout(250); await p.selectOption("#lcNames", "0"); await p.waitForTimeout(250);
await p.fill("#lcSkip", " BRUNCH ,사워도우,, Sweet Garlic "); await p.dispatchEvent("#lcSkip", "change"); await p.waitForTimeout(250);
await p.check("#lcQp"); await p.waitForTimeout(250); await p.check("#lcOk"); await p.waitForTimeout(250); await p.check("#lcSun"); await p.waitForTimeout(250);
let cp = cfgPost();
ok(cp.min === 3 && cp.names === 0 && cp.skip === "BRUNCH, 사워도우, Sweet Garlic" && cp.qp === 1 && cp.okNote === 1 && cp.skipSun === 1, "세부 조건 저장: 3개부터 · 전부 보임 · 제외 낱말 다듬어 저장 · Quality Page · 이상 없음 알림 · 일요일 쉬기");
await p.selectOption("#lcMin", "1"); await p.waitForTimeout(200); await p.selectOption("#lcNames", "3"); await p.waitForTimeout(200); await p.uncheck("#lcQp"); await p.waitForTimeout(200); await p.uncheck("#lcOk"); await p.waitForTimeout(200); await p.uncheck("#lcSun"); await p.waitForTimeout(200);
await p.fill("#lcSkip", "BRUNCH, 사워도우"); await p.dispatchEvent("#lcSkip", "change"); await p.waitForTimeout(250);
// 알림 끄기: 조건 칸이 잠김
await p.click(A + ' [data-lc="on"]'); await p.waitForTimeout(300);
ok(cfgPost().on === 0 && (await p.isDisabled("#lcTime")) && (await p.isDisabled('[data-sec="FOH"]')) && (await p.getAttribute(A + ' [data-lc="on"]', "aria-checked")) === "false", "알림 스위치 끔 → on 0 · 조건 칸 잠김");
await p.click(A + ' [data-lc="on"]'); await p.waitForTimeout(300);
ok(cfgPost().on === 1 && !(await p.isDisabled("#lcTime")), "다시 켬");
// 최근 기록 · 자주 빠짐 (실제 시트 기록)
await p.click("#lcHist > summary"); await p.waitForTimeout(200);
const nDay = await p.locator("#lcHist .lc-day").count(), histTxt = await p.textContent("#lcHist");
ok(nDay >= 1 && /빠짐 \d+/.test(histTxt), `최근 기록 ${nDay}일: ` + (await p.textContent("#lcHist .lc-day summary")).replace(/\s+/g, " "));
await p.click("#lcHist .lc-day summary"); await p.waitForTimeout(150);
ok((await p.locator("#lcHist .lc-day[open] li").count()) >= 2 && /보낸 알림|알림 없음|알림 안 보냄/.test(await p.textContent("#lcHist .lc-day[open]")), "날짜를 누르면 빠진 항목 · 보낸 알림");
ok(/마지막 확인 \d\d\/\d\d/.test(await p.textContent("#lcState")), "마지막 확인 한 줄: " + (await p.textContent("#lcState")));
// [지금 확인] → 시트 salesPush(kind linecheck · 오늘)
posts.length = 0;
await p.click(A + ' [data-act="lcNow"]'); await p.waitForTimeout(1500);
const sp = (postOf("salesPush") || {}).value || {};
ok(sp.kind === "linecheck" && sp.status === "pending" && /^\d{4}-\d\d-\d\d$/.test(sp.to || "") && !sp.from, "[지금 확인] → 매장 PC에 오늘 라인체크 조회 요청(salesPush kind linecheck): " + JSON.stringify({ kind: sp.kind, to: sp.to, status: sp.status }));
// [시험 알림] → 물어본 뒤 수원 앱으로 정해진 글 하나
let asked = ""; p.once("dialog", (d) => { asked = d.message(); d.accept(); });
posts.length = 0;
await p.click(A + ' [data-act="lcTest"]'); await p.waitForTimeout(1200);
const tp = posts.find((x) => x.action === "push_notice") || {};
ok(/시험 알림을 보낼까요/.test(asked) && tp.store === "suwon" && /^라인체크 알림 시험/.test(tp.text || "") && posts.filter((x) => x.action === "push_notice").length === 1, "[시험 알림] → 물어본 뒤 store suwon으로 한 번: " + (tp.text || ""));
p.once("dialog", (d) => d.dismiss()); posts.length = 0;
await p.click(A + ' [data-act="lcTest"]'); await p.waitForTimeout(600);
ok(!posts.some((x) => x.action === "push_notice"), "[시험 알림]에서 취소하면 안 보냄");
await p.check('input[name="misMode"][value="fill"]'); await p.waitForTimeout(300);
ok(JSON.stringify(postOf("invCfg") || {}).includes('"misMode":"fill"') && /아직 만들지 않았어요/.test(await p.textContent(A)), "MIS 방식 고름 → 적어 두고 '준비 중' 안내");
await p.check('input[name="misMode"][value="copy"]'); await p.waitForTimeout(300);
ok(/매장 PC 자동 수집/.test(await p.textContent(A)) && (await p.locator(A + " .set-state").count()) === 1, "매장 PC 자동 수집 상태 표시: " + (await p.textContent(A + " .set-state")));
ok(!errs.length, "화면 오류 없음 " + errs.join(" / "));
console.log(`설정 화면 시험 통과 ${pass} · 실패 ${fail}`);
await b.close();
process.exit(fail ? 1 : 0);
