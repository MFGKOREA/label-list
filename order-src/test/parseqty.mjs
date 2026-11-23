// 한글 수량 단위가 문자열 끝에서도 읽히는지. 시트에 안 씀.
// 사용: PW_CHROME=... PW_MODULE=... node order-src/test/parseqty.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { openApp } from "./bt/asof.mjs";
const kvPath = path.join(os.tmpdir(), "order-parseqty-kv.json");
fs.writeFileSync(kvPath, JSON.stringify({ ok: true, data: { "master.order": { cols: ["code"], rows: [{ name: "시험", code: "100001", vendor: "시험", unit: "EA", min: 0 }] } } }));
const { page, close, errs } = await openApp({ kvPath });
const r = await page.evaluate(() => {
  const q = window.__orderCalc.parseQty;
  return {
    ea: q("", "3 ea"),
    ko: q("", "3개"),
    jang: q("", "2장"),
    port: q("", "1포션"),
    pack: q("", "3개입"),
    pk: q("", "4 pk"),
  };
});
await close();
const bad = [];
if (errs.length) bad.push("화면 오류 " + errs.join(" | "));
if (!r.ea || r.ea.ea !== 3) bad.push("3 ea");
if (!r.ko || r.ko.ea !== 3) bad.push("3개 " + JSON.stringify(r.ko));
if (!r.jang || r.jang.ea !== 2) bad.push("2장");
if (!r.port || r.port.ea !== 1) bad.push("1포션");
if (r.pack) bad.push("3개입은 수량이 아님");
if (!r.pk || r.pk.ea !== 4) bad.push("4 pk");
console.log(bad.length ? bad.join("\n") : "parseQty 통과 6");
process.exit(bad.length ? 1 : 0);
