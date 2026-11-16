// HR 주간스케쥴 전송 — 순수 부분 시험 (gw-agent/hrsend-core.js). 이름·사번은 지어낸 것
// 사용: node order-src/test/gw/hrsend.test.mjs   (엑셀 읽기 확인에 python3 openpyxl이 있으면 씀)
import fs from "fs"; import os from "os"; import path from "path"; import vm from "vm"; import { execFileSync } from "child_process"; import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), SRC = fs.readFileSync(path.resolve(HERE, "../../../gw-agent/hrsend-core.js"), "utf8");
const G = { TextEncoder, Uint8Array, Uint32Array, Date, Map, Set, String, Math, Array, Buffer }; G.globalThis = G; vm.createContext(G); vm.runInContext(SRC, G);
let n = 0, fails = 0; const ok = (c, m, x) => { n++; console.log((c ? "통과 " : "실패 ") + m + (c || x == null ? "" : "\n   " + JSON.stringify(x).slice(0, 400))); if (!c) fails++; };
const W = "2026-11-23", dates = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(W + "T00:00:00Z") + i * 864e5).toISOString().slice(0, 10));
const emp = (no, name, kinds, t) => ({ empNo: no, name, days: dates.map((d, i) => { const k = kinds[i]; return { date: d, kind: k, in: k === "출근" ? (t || ["09:00"])[0] : "", out: k === "출근" ? (t || [, "18:00"])[1] || "18:00" : "", brk: k === "출근" ? "01:00" : "" }; }) });
const K5 = ["출근", "출근", "주휴일", "출근", "출근", "출근", "휴무"];
const base = () => ({ type: "MFG_HR_SEND", requestId: "t1", dept: "BOH", weekStart: W, weekEnd: "2026-11-29", mode: "full", employees: [emp("90000001", "시험일", K5), emp("90000002", "시험이", K5)] });
let r = G.hrsCheck(base());
ok(r.ok && r.plan.emps.length === 2 && r.plan.emps[0].min === 5 * 8 * 60, "정상 요청 통과 (주 40시간)", r.errors);
let q = base(); q.employees[0].days[1].kind = "연차"; r = G.hrsCheck(q);
ok(!r.ok && /연차/.test(r.errors[0].msg) && r.errors[0].empNo === "90000001", "HR에 없는 근태유형(연차) → 그 직원 에러", r.errors);
q = base(); q.employees[0].days[6].kind = "주휴일"; r = G.hrsCheck(q);
ok(!r.ok && /주휴일이 주에 정확히 1일/.test(r.errors[0].msg), "주휴일 2일 → 에러", r.errors);
q = base(); q.employees[1].days[2].kind = "휴무"; r = G.hrsCheck(q);
ok(!r.ok && /0일/.test(r.errors[0].msg), "주휴일 0일 → 에러", r.errors);
q = base(); q.employees[0] = emp("90000001", "시험일", ["출근", "출근", "주휴일", "출근", "출근", "출근", "출근"], ["08:00", "19:00"]); r = G.hrsCheck(q);
ok(!r.ok && /52시간/.test(r.errors[0].msg), "주 60시간 → 52시간 넘음 에러", r.errors);
q = base(); q.employees[0].days[0].brk = ""; r = G.hrsCheck(q);
ok(r.ok && r.plan.emps[0].days[0].brk === "00:00", "출근인데 휴게 빈칸 → 00:00");
q = base(); q.employees[0].days[0].in = "9:00"; q.employees[0].days[0].out = "0100"; r = G.hrsCheck(q);
ok(r.ok && r.plan.emps[0].days[0].in === "09:00" && r.plan.emps[0].days[0].out === "01:00" && r.plan.emps[0].min === 4 * 8 * 60 + 15 * 60, "9:00 → 09:00, 자정 넘는 퇴근(01:00)은 다음 날로 계산");
q = base(); q.employees[0].days[0].out = ""; r = G.hrsCheck(q);
ok(!r.ok && /퇴근 시각이 비었/.test(r.errors[0].msg), "출근인데 퇴근 빈칸 → 에러");
q = base(); q.employees[0].days[6].in = "10:00"; r = G.hrsCheck(q);
ok(r.ok && r.plan.emps[0].days[6].in === "" && r.warns.length === 1, "휴무에 시간이 있으면 비워서 보냄(경고)");
q = base(); q.employees[0].days[6] = { date: dates[6], kind: "공휴일", in: "10:00", out: "", brk: "" }; r = G.hrsCheck(q);
ok(!r.ok && /공휴일/.test(r.errors[0].msg), "공휴일 시간 일부만 → 에러");
q = base(); q.weekStart = "2026-11-24"; r = G.hrsCheck(q);
ok(!r.ok && /월요일/.test(r.errors[0].msg), "주 시작이 월요일 아님 → 에러");
q = base(); q.dept = "BAR"; r = G.hrsCheck(q);
ok(!r.ok, "부서 BOH·FOH 아님 → 에러");
q = base(); q.employees[1].empNo = "90000001"; r = G.hrsCheck(q);
ok(!r.ok && /두 번/.test(r.errors[0].msg), "같은 사번 두 번 → 에러");
q = base(); q.employees[0].days.pop(); r = G.hrsCheck(q);
ok(!r.ok && /7일/.test(r.errors[0].msg), "6일만 → 에러");
q = base(); q.mode = "test"; q.employees[0].days[6].kind = "주휴일"; r = G.hrsCheck(q);
ok(r.ok && r.warns.some((w) => /주휴일/.test(w.msg)), "test 모드: 주휴일 2일은 경고만");
q = base(); q.mode = "saveOnly"; r = G.hrsCheck(q); ok(r.ok && G.hrsFiles(r.plan).length === 7, "saveOnly: 7일 파일");
q = base(); q.mode = "save"; r = G.hrsCheck(q); ok(!r.ok, "모르는 mode → 에러");
// 파일
r = G.hrsCheck(base()); let fl = G.hrsFiles(r.plan);
ok(fl.length === 7 && fl[0].name === "BOH_2026-11-23_MON.xlsx" && fl[6].name === "BOH_2026-11-29_SUN.xlsx", "full: 요일별 파일 7개, 이름 BOH_날짜_요일.xlsx");
q = base(); q.mode = "test"; fl = G.hrsFiles(G.hrsCheck(q).plan);
ok(fl.length === 1 && fl[0].dow === "MON", "test: 월요일 파일 1개");
fl = G.hrsFiles(r.plan);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hrs-")); fs.writeFileSync(tmp + "/mon.xlsx", Buffer.from(fl[0].bytes)); fs.writeFileSync(tmp + "/wed.xlsx", Buffer.from(fl[2].bytes));
try {
  const out = execFileSync("python3", ["-I", "-c", `
import openpyxl,json,sys
res={}
for f in sys.argv[1:]:
  wb=openpyxl.load_workbook(f); ws=wb.active
  res[f.split('/')[-1]]={"sheet":ws.title,"rows":[[c.value for c in r] for r in ws.iter_rows()],"fmt":[c.number_format for c in ws[2]],"types":[c.data_type for c in ws[2]]}
print(json.dumps(res,ensure_ascii=False))`, tmp + "/mon.xlsx", tmp + "/wed.xlsx"]).toString();
  const x = JSON.parse(out), m = x["mon.xlsx"], w = x["wed.xlsx"];
  ok(m.sheet === "Sheet1" && JSON.stringify(m.rows[0]) === JSON.stringify(["..", "사원코드", "이름", "근태유형", "출근시각", "퇴근시각", "휴게시간"]), "엑셀: 시트 Sheet1, 머리글 7칸 그대로", m.rows[0]);
  ok(JSON.stringify(m.rows[1]) === JSON.stringify(["", "90000001", "시험일", "출근", "09:00", "18:00", "01:00"]) && m.types.every((t) => t === "s") && m.fmt.every((f) => f === "@"), "엑셀: 모든 칸이 공유 문자열(t=s)·텍스트(@), A열은 \"\"", m);
  ok(JSON.stringify(w.rows[1]) === JSON.stringify(["", "90000001", "시험일", "주휴일", "", "", ""]) && w.rows.length === 3, "엑셀: 주휴일은 시간 빈칸, 직원 2명", w.rows);
} catch (e) { ok(false, "엑셀 열어 보기 (openpyxl)", String(e.message || e)); }
console.log(fails ? `실패 ${fails}개 / ${n}` : `모두 통과 (${n}개)`); process.exit(fails ? 1 : 0);
