// 사내이송 표(KM이 붙여 넣은 것) → 앱 품목·재고단위로 바꿔 보기 (시트는 읽기만). 쓰기는 따로.
//  입력 TSV: 보낸매장코드 \t 품목코드 \t 수량 \t 날짜 \t 받은매장코드
import fs from "fs"; import os from "os"; import path from "path";
import { openApp } from "../test/bt/asof.mjs";
const ME = "1345090"; // MG수원컨벤션센터점
const [tsv] = process.argv.slice(2);
const kvPath = path.join(os.tmpdir(), "order-auto", "kv-pos.json");
const rows = fs.readFileSync(tsv, "utf8").trim().split("\n").map((l) => { const [from, code, q, d, to] = l.split("\t"); return { from, code, q: +q, d, to }; });
const { page, close } = await openApp({ kvPath });
const out = await page.evaluate((rows) => {
  const C = window.__orderCalc, M = C.model(), db = C.db();
  const items = M.items || M.list || [];
  return rows.map((r) => {
    const it = items.find((x) => (x.codes || []).map(String).includes(r.code));
    const recv = ((db["misRecv." + r.d] || {}).rows || []).filter((x) => String(x.code) === r.code);
    return { ...r, key: it ? it.key : null, stock: it ? C.ordToStock(it, r.q) : null, unit: it ? it.unit || it.stockUnit || "" : "", inRecv: recv.map((x) => x.qty) };
  });
}, rows);
console.log(JSON.stringify(out));
await close();
