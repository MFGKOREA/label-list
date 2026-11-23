// 다른 매장 품목 이름이 제품명 자동완성에 들어가는지. 매장모음 catalog 가 배열(구버전)이면 매장마다 목록을 받는다.
import assert from "node:assert/strict";
import fs from "node:fs";

const req = (m) => import(m).catch(() => import(process.env.PW_MODULE || "/tmp/pw/node_modules/playwright/index.mjs"));
const { chromium } = await req("playwright");
const exe = process.env.PW_CHROME || "/usr/bin/google-chrome";
const root = new URL("../index.html", import.meta.url).pathname;

function route(catalogBody) {
  return async (route) => {
    const u = new URL(route.request().url());
    const q = u.searchParams;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (q.get("catalog")) return json(catalogBody);
    if (q.get("stats")) return json({ counts: { dogok: 1, mokdong: 4 }, online: {} });
    if (q.get("store") === "mokdong") return json([{ id: "m1", name: "목동양파", mode: "period", mfg: "2026-01-01", num: 6, unit: "m" }]);
    if (q.get("store")) return json({ items: [{ id: "d1", name: "우리매장빵", mode: "date", expiry: "2026-12-01", num: 0, unit: "" }], ver: "1", online: 0 });
    return json([]);
  };
}
async function openAndWait(page, name) {
  await page.goto("file://" + root + "?store=dogok");
  const close = page.locator("#alertClose");
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.click("#addOpen");
  await page.waitForFunction((name) => [...document.querySelectorAll("#nameList option")].some((o) => o.value === name), name, { timeout: 8000 });
  return page.evaluate(() => [...document.querySelectorAll("#nameList option")].map((o) => o.value));
}

const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.route("https://script.google.com/**", route({ 타매장버터: { name: "타매장 버터", combos: { "12m": 3 } } }));
const got = await openAndWait(page, "타매장 버터");
assert.ok(got.includes("우리매장빵"), got.join(","));
assert.ok(got.includes("타매장 버터"), "catalog 이름 없음: " + got.join(","));
const hint = await page.evaluate(() => { const i = document.getElementById("fName"); i.value = "타매장 버터"; i.dispatchEvent(new Event("input", { bubbles: true })); return document.getElementById("catHint").textContent; });
await page.waitForTimeout(400);
const hint2 = await page.evaluate(() => document.getElementById("catHint").textContent);
assert.match(hint2 || hint, /다른 매장 3곳/);

const page2 = await (await browser.newContext()).newPage();
await page2.route("https://script.google.com/**", route([])); // 구버전: catalog 가 목록 배열
const got2 = await openAndWait(page2, "목동양파");
assert.ok(got2.includes("목동양파"), "매장별 목록 폴백 없음: " + got2.join(","));
const saved = await page2.evaluate(() => localStorage.getItem("label-list-catalog-v3"));
assert.ok(saved && saved.includes("목동양파"));

await browser.close();
console.log("label catalog tests ok");
