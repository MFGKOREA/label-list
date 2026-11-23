// 다른 매장에 등록된 품목이 목록으로 보이고, 가져오기가 이 매장 저장을 부르는지.
import assert from "node:assert/strict";
import fs from "node:fs";

const req = (m) => import(m).catch(() => import(process.env.PW_MODULE || "/tmp/pw/node_modules/playwright/index.mjs"));
const { chromium } = await req("playwright");
const exe = process.env.PW_CHROME || "/usr/bin/google-chrome";
const root = new URL("../index.html", import.meta.url).pathname;
const mok = { id: "m1", name: "목동양파", memo: "냉장", mode: "date", expiry: "2026-12-01", mfg: "", num: 0, unit: "" };

function install(page, posts, peersBody) {
  return page.route("https://script.google.com/**", async (route) => {
    const u = new URL(route.request().url());
    const q = u.searchParams;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() || "{}");
      posts.push(body);
      return json(body.item ? [body.item] : []);
    }
    if (q.get("peers")) return json(peersBody);
    if (q.get("stats")) return json({ counts: { mokdong: 1 }, online: {} });
    if (q.get("store") === "mokdong") return json([mok]);
    if (q.get("store")) return json({ items: [], ver: "1", online: 0 });
    return json([]);
  });
}

async function openPeers(page) {
  await page.goto("file://" + root + "?store=dogok");
  const close = page.locator("#alertClose");
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.click("#peerOpen");
  await page.waitForFunction(() => document.querySelector("#peerList .peer-tag"), null, { timeout: 8000 });
}

const browser = await chromium.launch({ executablePath: exe });
{
  const posts = [];
  const page = await browser.newPage();
  await install(page, posts, { stores: { mokdong: [mok], suwon: { error: "전용" } } });
  await openPeers(page);
  const row = await page.locator(".peer-li").innerText();
  assert.match(row, /목동양파/);
  assert.match(row, /MG목동점/);
  assert.match(await page.locator("#peerMsg").innerText(), /1곳 · 1개/);
  await page.click(".peer-get");
  await page.waitForFunction(() => document.querySelector(".peer-get").textContent === "가져옴");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].action, "save");
  assert.equal(posts[0].store, "dogok");
  assert.equal(posts[0].item.name, "목동양파");
  assert.equal(posts[0].item.memo, "냉장");
  assert.notEqual(posts[0].item.id, "m1");
  assert.ok(await page.locator("#list .name").filter({ hasText: "목동양파" }).count());
}
{
  const posts = [];
  const page = await browser.newPage();
  await install(page, posts, []); // 구버전: peers 가 없고 매장 목록 배열만 옴
  await openPeers(page);
  assert.match(await page.locator(".peer-li").innerText(), /목동양파/);
  assert.match(await page.locator(".peer-li").innerText(), /MG목동점/);
}
await browser.close();
console.log("label peers tests ok");
