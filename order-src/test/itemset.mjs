// 발주 품목 설정: 숨김은 발주 계산에서 빠지고, side가 없으면 지금과 같다. 시트에 안 씀.
// 사용: PW_CHROME=... PW_MODULE=... node order-src/test/itemset.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { openApp } from "./bt/asof.mjs";

const kv = path.join(os.tmpdir(), "itemset-kv.json");
fs.writeFileSync(kv, JSON.stringify({
  "master.order": { at: "2026-11-23", cols: ["name", "code", "vendor", "unit"], rows: [
    { name: "양파", code: "100001", vendor: "온세물류", unit: "EA" },
    { name: "소모품장갑", code: "100002", vendor: "한성물산", unit: "EA" },
    { name: "평판수세미", code: "340000447", vendor: "소모품", unit: "EA" },
    { name: "날짜", code: "한성물산(월 발주)", vendor: "소모품", unit: "" },
  ] },
  "master.foh": { rows: [{ name: "콜라", code: "200001", vendor: "롯데칠성", unit: "EA" }] },
  hide: ["업체:소모품"],
  itemCfg: { "소모품장갑": { hide: 1 }, "양파": { side: "foh", loc: "bar", ro: 1 } },
}));

const { page, errs, close } = await openApp({ kvPath: kv, html: path.resolve("order.html") });
const r = await page.evaluate(() => {
  const C = window.__orderCalc, M = C.model();
  const by = (n) => M.items.find((i) => i.name === n);
  const onion = by("양파"), glove = by("소모품장갑"), coke = by("콜라");
  const win = C.orderWindowFor(glove, C.TODAY);
  return {
    onion: onion && { foh: !!onion.foh, hidden: !!onion.hidden },
    glove: glove && { foh: !!glove.foh, hidden: !!glove.hidden, calc: C.calc(glove, win, 0, 0) },
    coke: coke && { foh: !!coke.foh, hidden: !!coke.hidden },
    sponge: (() => { const it = by("평판수세미"); return it && { foh: !!it.foh, hidden: !!it.hidden, sheetHide: !!it.sheetHide }; })(),
    junk: !!by("날짜"),
    title: document.querySelector("#v-loc h2") && document.querySelector("#v-loc h2").textContent,
    entry: document.querySelector(".locentry b") && document.querySelector(".locentry b").textContent,
  };
});
let pass = 0, fail = 0;
const bad = [];
const ok = (n, c, d) => { if (c) pass++; else { fail++; bad.push(n + (d ? " · " + d : "")); } };
ok("설정 없으면 FOH 시트 품목은 FOH", r.coke && r.coke.foh && !r.coke.hidden, JSON.stringify(r.coke));
ok("side foh 면 발주 시트 품목도 FOH", r.onion && r.onion.foh && !r.onion.hidden, JSON.stringify(r.onion));
ok("hide 면 계산을 안 함", r.glove && r.glove.hidden && r.glove.calc && r.glove.calc.hidden && r.glove.calc.none, JSON.stringify(r.glove && r.glove.calc));
ok("화면 이름이 발주 품목 설정", r.title === "발주 품목 설정" && r.entry === "발주 품목 설정", r.title + "/" + r.entry);
ok("업체:소모품 숨김이어도 평판수세미는 설정에 있음", r.sponge && r.sponge.sheetHide && r.sponge.hidden && !r.sponge.foh, JSON.stringify(r.sponge));
ok("소모품 머리글 줄은 품목이 아님", r.junk === false);
ok("콘솔 오류 없음", errs.length === 0, errs.join(" | "));
await page.evaluate(() => {
  document.querySelector("#tileFiles").click();
  document.querySelector('#v-files button[data-cat="order"]').click();
  document.querySelector('[data-go="loc"]').click();
  document.querySelector('#locScope button[data-s="foh"]').click();
  document.querySelector('#locTabs button[data-t="bar"]').click();
});
await page.waitForSelector("#locList .lrow");
const ui = await page.evaluate(() => {
  const row = [...document.querySelectorAll("#locList .lrow")].find((el) => el.querySelector(".lnm") && el.querySelector(".lnm").textContent.includes("양파"));
  if (!row) return { missing: true };
  row.querySelector("[data-hide]").click();
  return { clicked: true };
});
await page.waitForTimeout(50);
const after = await page.evaluate(() => {
  const C = window.__orderCalc, it = C.model().items.find((i) => i.name === "양파");
  const win = C.orderWindowFor(it, C.TODAY);
  return { hidden: !!it.hidden, calc: C.calc(it, win, 1, 0), cfg: (C.db().itemCfg || {})["양파"] };
});
ok("숨김을 누르면 itemCfg.hide", ui.clicked && after.hidden && after.cfg && after.cfg.hide === 1 && after.calc.hidden, JSON.stringify(after.cfg));
ok("숨긴 뒤에도 side 는 남음", after.cfg && after.cfg.side === "foh");
ok("숨김 칸에 시각이 있음", after.cfg && after.cfg._at && after.cfg._at.hide > 0);
const found = await page.evaluate(() => {
  const q = document.querySelector("#locQ");
  q.value = "ㅇㅍ"; q.dispatchEvent(new Event("input", { bubbles: true }));
  const cho = [...document.querySelectorAll("#locList .lrow .lnm")].map((n) => n.childNodes[0].textContent);
  q.value = "콜"; q.dispatchEvent(new Event("input", { bubbles: true }));
  const part = [...document.querySelectorAll("#locList .lrow .lnm")].map((n) => n.childNodes[0].textContent);
  return { cho, part };
});
ok("초성 ㅇㅍ 은 양파", found.cho.length === 1 && found.cho[0] === "양파", JSON.stringify(found.cho));
ok("콜 은 콜라", found.part.length === 1 && found.part[0] === "콜라", JSON.stringify(found.part));
const sup = await page.evaluate(() => {
  document.querySelector('#locScope button[data-s="boh"]').click();
  const q = document.querySelector("#locQ"); q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector('#locTabs button[data-t="sup"]').click();
  return [...document.querySelectorAll("#locList .lrow .lnm")].map((n) => n.childNodes[0].textContent);
});
ok("BOH 소모품 설정에 평판수세미", sup.includes("평판수세미"), JSON.stringify(sup));
console.log(`품목 설정 시험 통과 ${pass} · 실패 ${fail}`);
if (bad.length) console.log(bad.join("\n"));
await close();
process.exit(fail ? 1 : 0);
