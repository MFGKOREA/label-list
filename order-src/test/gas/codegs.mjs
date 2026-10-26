// Code.gs(발주앱 시트 서버) 시험: 가짜 Apps Script에서 저장·읽기·캐시·가게 키를 확인
// 사용: node order-src/test/gas/codegs.mjs [Code.gs 경로]
import { load } from "./sim.mjs";
const code = process.argv[2] || new URL("../../../apps-script/order/Code.gs", import.meta.url).pathname;
const g = load(code), ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) process.exitCode = 1; };
// 큰 값 (청크 나눔 확인)
const big = "가".repeat(120000);
ok(g.post({ action: "set", key: "master.recipe", value: { t: big } }).ok, "큰 값 저장");
let r = g.post({ action: "set", key: "misPush", value: { date: "2026-10-26", id: 1, status: "pending", n: 3 } });
ok(r.ok && Object.keys(r.data).join() === "misPush" && r.data.misPush.status === "pending", "set 응답은 그 키만");
r = g.post({ action: "merge", key: "input.2026-10-26", patch: { a: { s: 1 } } });
r = g.post({ action: "merge", key: "input.2026-10-26", patch: { b: { s: 2 }, a: { o: 3 } } });
ok(JSON.stringify(r.data["input.2026-10-26"]) === JSON.stringify({ a: { s: 1, o: 3 }, b: { s: 2 } }), "merge 응답 = 합친 값");
g.post({ action: "append", key: "onhand", item: { x: 1 } }); r = g.post({ action: "append", key: "onhand", item: { x: 2 } });
ok(r.data.onhand.length === 2, "append 응답 = 늘어난 배열");
const n0 = g.stats.readAll;
let full = g.get({ api: "1" });
ok(full.ok && full.data["master.recipe"].t === big && full.data.misPush.id === 1 && full.data.onhand.length === 2 && full.ver === g.props.VER, "전체 읽기 정확");
const n1 = g.stats.readAll; const full2 = g.get({ api: "1" });
ok(g.stats.readAll === n1 && JSON.stringify(full2) === JSON.stringify(full), "두 번째 전체 읽기는 캐시 (시트 안 읽음)");
g.post({ action: "set", key: "misPush", value: { date: "2026-10-26", id: 1, status: "done" } });
const full3 = g.get({ api: "1" });
ok(full3.data.misPush.status === "done" && full3.ver !== full.ver, "저장 뒤엔 새 버전·새 값 (캐시 안 묵음)");
ok(g.get({ api: "1", status: "1" }).status.misPush.status === "done", "status 정상");
ok(g.get({ api: "1", ver: "1" }).ver === full3.ver, "ver 정상");
g.post({ action: "set", key: "gone", value: 1 }); g.post({ action: "set", key: "gone", value: null });
ok(!("gone" in g.get({ api: "1" }).data), "null 저장 = 지움");
// 키 잠금
g.props.APP_KEY = "K"; ok(g.get({ api: "1" }).auth === true && g.get({ api: "1", k: "K" }).ok && g.post({ action: "set", key: "x", value: 1 }).auth, "가게 키 잠금 그대로");
console.log("readAll calls:", g.stats.readAll - n0);
