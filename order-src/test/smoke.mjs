// 스모크 테스트: 실제 시트 데이터를 읽어서(쓰기는 막음) order.html의 모든 화면을 열어 보고 오류·주요 숫자를 출력합니다.
// 사용: node order-src/test/smoke.mjs [kv.json]   (kv.json을 주면 그 파일을 데이터로 씀)
// 필요: Playwright (Chromium은 /opt/pw-browsers/chromium)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, "../../order.html");
const api = /DEFAULT_API = "([^"]+)"/.exec(fs.readFileSync(html, "utf8"))[1];
const kv = process.argv[2] ? fs.readFileSync(process.argv[2], "utf8") : await (await fetch(api + "?api=1")).text();
const exe = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
// GET은 실제 데이터, POST(저장)는 가짜 응답 → 테스트가 시트를 바꾸지 않음
await p.route("https://script.google.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: r.request().method() === "GET" ? kv : '{"ok":true,"data":{}}' }));
await p.addInitScript(() => { try { localStorage.clear(); } catch {} });
await p.goto("file://" + html);
await p.waitForFunction(() => window.__orderCalc && window.__orderCalc.model().items.length, null, { timeout: 60000 });
await p.waitForTimeout(800);
// 버튼 비밀번호가 걸려 있으면 이 기기는 확인된 걸로 (데이터 파일 화면 열기)
await p.evaluate((h) => h && localStorage.setItem("order-calc-pin", h), (JSON.parse(kv).data?.btnLock || {}).hash || "");
const out = await p.evaluate(() => {
  const C = window.__orderCalc, M = C.model(), w = C.orderWindow(C.TODAY);
  const both = M.items.filter((i) => i.rateA != null && i.rateB != null);
  const big = both.filter((i) => Math.max(i.rateA, i.rateB) / Math.min(i.rateA, i.rateB) > 2).map((i) => `${i.name} A ${i.rateA.toFixed(3)} B ${i.rateB.toFixed(3)}`);
  return { today: C.TODAY, items: M.items.length, preps: M.prep.length, months: M.monthRows.map((r) => r.m), window: `${w.today}~${w.end} (${w.days}일, Gross ${Math.round(w.gross).toLocaleString()})`, withAB: both.length, abOver2x: big };
});
console.log(JSON.stringify(out, null, 1));
fs.mkdirSync(path.join(here, "shots"), { recursive: true });
await p.screenshot({ path: path.join(here, "shots", "main.png") });
await p.click("#tabPrep"); await p.waitForTimeout(300); await p.screenshot({ path: path.join(here, "shots", "prep.png") });
await p.click("#tabOrder");
for (const v of ["forecast", "files", "report", "help"]) {
  await p.click(`[data-go=${v}]`); await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(here, "shots", v + ".png") });
  await p.click(`#v-${v} [data-go=main]`).catch(() => {}); await p.waitForTimeout(200);
}
console.log(errs.length ? "오류:\n" + errs.join("\n") : "오류 없음");
await b.close();
process.exit(errs.length ? 1 : 0);
