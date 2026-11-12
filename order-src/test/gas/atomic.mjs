// Code.gs 쓰기 안전성 시험 (11/12): 새 행을 먼저 쓰고 옛 행을 지움, 중간에 멈춰도 새 값이 읽힘, 덧붙이기 150건이 안 줄어듦
// 사용: node order-src/test/gas/atomic.mjs [Code.gs 경로]
import { load } from "./sim.mjs";
const code = process.argv[2] || new URL("../../../apps-script/order/Code.gs", import.meta.url).pathname;
const g = load(code), ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) process.exitCode = 1; };
const kv = () => g.ss.sheets.kv;
// 1) 덧붙이기 150건
for (let i = 0; i < 150; i++) g.post({ action: "append", key: "onhand", item: { t: "2026-11-12 10:" + String(i % 60).padStart(2, "0"), k: "품목" + i, s: i, pad: "x".repeat(700) } });
let all = g.get({ api: "1" }).data;
ok(all.onhand.length === 150, "덧붙이기 150건 모두 남음 (조각 여러 개: " + kv().rows.filter((r) => r[0] === "onhand").length + "행)");
// 2) 큰 값(2조각 이상) → 작은 값(1조각): 옛 행을 지우다 멈춘 경우에도 새 값이 읽힘
g.post({ action: "set", key: "big", value: { t: "가".repeat(100000) } });
const sh = kv(), del = sh.deleteRow.bind(sh); let boom = true;
sh.deleteRow = (i) => { if (boom) { boom = false; throw new Error("삭제 중 멈춤(시험)"); } return del(i); };
const r = g.post({ action: "set", key: "big", value: { t: "작음" } });
ok(r.ok === true, "옛 행 삭제 중 오류 → 새 값은 썼으니 성공으로 응답");
ok(kv().rows.filter((x) => x[0] === "big").length > 1, "옛 행과 새 행이 같이 남음");
all = g.get({ api: "1" }).data;
ok(all.big && all.big.t === "작음", "그래도 읽으면 새 값 (아래쪽 묶음)");
const a2 = g.post({ action: "append", key: "onhand", item: { t: "2026-11-12 11:00", k: "뒤", s: 1 } });
ok(a2.ok && a2.data.onhand.length === 151, "다른 키 덧붙이기는 정상");
g.post({ action: "set", key: "big", value: { t: "다시" } });
ok(kv().rows.filter((x) => x[0] === "big").length === 1 && g.get({ api: "1" }).data.big.t === "다시", "다음 저장 때 옛 행이 모두 정리됨");
// 3) 쓰기 중(새 행 쓰기) 오류: 옛 값이 그대로 남음
const sv = sh.getRange.bind(sh); let boom2 = true;
sh.getRange = (...a) => { const rg = sv(...a); const set = rg.setValues; rg.setValues = (v) => { if (boom2 && v[0] && v[0][0] === "onhand") { boom2 = false; throw new Error("쓰기 중 멈춤(시험)"); } return set.call(rg, v); }; return rg; };
const a3 = g.post({ action: "append", key: "onhand", item: { t: "2026-11-12 11:01", k: "실패", s: 1 } });
ok(a3.ok === false, "새 행 쓰기 오류 → 실패 응답");
const a4 = g.post({ action: "append", key: "onhand", item: { t: "2026-11-12 11:02", k: "다음", s: 1 } });
ok(a4.ok && a4.data.onhand.length === 152, "실패 뒤 다음 덧붙이기: 옛 기록 151건 + 1 (빈 목록에서 시작하지 않음)");
// 4) 키 이름 constructor 거부, 깨진 값 위 merge 거부
ok(g.post({ action: "set", key: "constructor", value: 1 }).ok === false, "키 이름 constructor 거부");
ok(g.post({ action: "append", key: "onhand", item: { t: "z", k: "c", s: 1 } }).ok, "그 뒤에도 덧붙이기 정상");
// 5) 조각 경계 글자 '=' 피함
g.post({ action: "set", key: "eq", value: { t: "a".repeat(44990) + "=".repeat(30) + "b".repeat(100) } });
ok(kv().rows.filter((x) => x[0] === "eq").every((x) => !/^[=+\-@']/.test(String(x[2]))), "조각이 = 로 시작하지 않음");
ok(g.get({ api: "1" }).data.eq.t.length === 45120, "조각 나눠도 값 그대로");
