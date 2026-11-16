// 보드 코드를 바꾸기 전에 GW Agent 1.12.0 HR 전송을 시험하는 방법 (KM PC 크롬)
//  1) https://hr-board-teal.vercel.app/ 를 연다 → F12 → Console 탭에 이 파일 내용을 붙여 넣고 Enter
//  2) 아래 STAFF에 BOH 재직 직원 전원의 사번·이름을 HR에 등록된 그대로 적는다 (한 명이라도 빠지면 '파일에 없는 직원'으로 멈춤 = 정상 동작)
//  3) 맨 아래 hrTest() 줄이 시험(test) 모드로 48주 월요일만 보낸다. 결과는 콘솔에 표로 나온다
//  * 모든 직원 월요일 휴무·수요일 주휴일·나머지 휴무로 보냄 (지금 HR 48주 값과 같음). test라 월요일 1일만 저장, 공지·확정 안 함
const STAFF = [
  // ["사번", "이름"],
  // ["12345678", "홍길동"],  ← 이런 모양으로 한 줄에 한 명
];
function hrTest(mode = "test", weekStart = "2026-11-23", dept = "BOH") {
  const dates = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(weekStart + "T00:00:00Z") + i * 864e5).toISOString().slice(0, 10));
  const employees = STAFF.map(([empNo, name]) => ({ empNo, name, days: dates.map((date, i) => ({ date, kind: i === 2 ? "주휴일" : "휴무", in: "", out: "", brk: "" })) }));
  const requestId = crypto.randomUUID();
  const on = (e) => {
    const d = e.data || {};
    if (e.source !== window || d.requestId !== requestId) return;
    if (d.type === "MFG_HR_SEND_ACK") console.log(d.ok ? "확장이 받음" : "확장이 안 받음: " + d.error);
    if (d.type === "MFG_HR_SEND_PROGRESS") console.log(`${d.item.t} [${d.item.stage}${d.item.day ? "/" + d.item.day : ""}] ${d.item.msg}${d.item.ajax ? " (" + d.item.ajax + ")" : ""}`);
    if (d.type === "MFG_HR_SEND_RESULT") { removeEventListener("message", on); console.log(d.ok ? "✅ 성공" : "❌ 멈춤 (" + d.stage + (d.day ? "/" + d.day : "") + ")", d.message); if (d.rowErrors.length) console.table(d.rowErrors); if (d.missing && d.missing.length) console.log("HR에만 있는 사번:", d.missing); window.__hrLast = d; }
  };
  addEventListener("message", on);
  postMessage({ type: "MFG_HR_SEND", requestId, dept, weekStart, weekEnd: dates[6], mode, employees }, location.origin);
  console.log(`보냄: ${dept} ${weekStart} ${mode} ${employees.length}명 — 끝나면 결과가 여기 나와요 (전체는 __hrLast)`);
}
addEventListener("message", function r(e) { if (e.source === window && (e.data || {}).type === "MFG_HR_AGENT_READY") { console.log("GW Agent 연결됨:", e.data.ver); removeEventListener("message", r); } });
postMessage({ type: "MFG_HR_PING" }, location.origin);
// hrTest();            // ← STAFF를 채운 뒤 이 줄의 // 를 지우고 실행 (시험: 월요일만)
// hrTest("saveOnly");  // 7일 저장까지 (공지·확정 안 함)
