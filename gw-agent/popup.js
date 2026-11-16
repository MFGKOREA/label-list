const $ = (id) => document.getElementById(id);
const hm = (t) => new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
async function load() {
  const c = await chrome.storage.local.get(["id", "pw", "on", "logs", "auto", "autoSt", "hrId", "hrPw", "hron", "hrSt"]);
  $("id").value = c.id || ""; $("on").checked = !!c.on; $("auto").checked = c.auto !== false;
  $("hrid").value = c.hrId || ""; $("hron").checked = c.hron !== false; $("hrpw").placeholder = c.hrPw ? "저장됨 (바꿀 때만 입력)" : "비밀번호";
  const as = c.autoSt || {}, autoLine = c.auto === false ? "\n상시 수집 꺼짐" : !c.on ? "" : `\n상시 수집: ${as.msg || "곧 첫 확인"}${as.at ? ` · ${hm(as.at)} 확인` : ""}${as.next && as.next > Date.now() ? ` · 다음 ${hm(as.next)}` : ""}`; $("pw").placeholder = c.pw ? "저장됨 (바꿀 때만 입력)" : "비밀번호";
  const hs = c.hrSt || {}, hrLine = c.hron === false ? "\n플젝 HR 덤프 꺼짐" : `\n플젝 HR: ${hs.msg || "곧 첫 확인"}${hs.okAt ? ` · 마지막 ${hm(hs.okAt)}` : ""}`;
  $("log").textContent = (c.logs || []).slice(0, 12).join("\n");
  try {
    const v = await (await fetch(API + "?api=1&status=1&t=" + Date.now())).json(), d = (v && (v.status || v.data)) || {};
    const a = d.misAgent || {}, p = d.misPush || {};
    const fresh = a.at && Date.now() - a.at < (a.mode === "ondemand" ? 20 * 60e3 : 180000);
    $("st").textContent = (!fresh ? `대기 꺼짐${a.at ? ` · 마지막 ${hm(a.at)}` : ""} (자동입력 켜기 확인)` : a.mode === "ondemand" ? `✓ 대기 중 · ${hm(a.at)} 확인 · 폰 전송 때만 창이 열려요` : `✓ MIS 입력 창 열림 · ${hm(a.at)} 확인${a.grid ? "" : " · 주문등록 화면 아님"}`) +
      (p.date ? `\n마지막 전송 ${p.date.slice(5)} ${p.status === "done" ? "저장 완료" : p.status === "error" ? "확인 필요" : p.status}` : "") + autoLine + hrLine;
  } catch (e) { $("st").textContent = "시트에 연결 못 함 (인터넷 확인)" + autoLine + hrLine; }
}
$("save").addEventListener("click", async () => {
  const v = { id: $("id").value.trim(), on: $("on").checked, auto: $("auto").checked, hrId: $("hrid").value.trim(), hron: $("hron").checked, tries: [] };
  if (v.auto) { const { autoSt = {} } = await chrome.storage.local.get("autoSt"); v.autoSt = { ...autoSt, next: Date.now() + 20e3 }; } // 켜면 20초 뒤 첫 확인
  if ($("pw").value) v.pw = $("pw").value;
  if ($("hrpw").value) v.hrPw = $("hrpw").value;
  // 가게 키는 안 씀 (10/31 KM) → 예전에 저장된 것도 지움 · HR 로그인 실패 횟수는 새 계정으로 다시 셈
  await chrome.storage.local.set(v); await chrome.storage.local.remove(["appKey", "hrTries"]); $("pw").value = ""; $("hrpw").value = "";
  await chrome.runtime.sendMessage({ q: "ensure" });
  $("st").textContent = v.on ? "저장했어요 · MIS 자동 탭을 열어요" : "저장했어요 · 자동입력 꺼짐";
  setTimeout(load, 1500);
});
$("hrnow").addEventListener("click", async () => { const r = await chrome.runtime.sendMessage({ q: "hrNow" }).catch(() => null); $("st").textContent = r && r.busy ? "발주·매출 자동 창이 도는 중이라 잠깐 뒤에 해요" : "플젝 HR을 지금 읽어요 (창 뒤에서 조용히)"; setTimeout(load, 2500); });
$("open").addEventListener("click", async () => { await chrome.storage.local.set({ on: true }); $("on").checked = true; await chrome.runtime.sendMessage({ q: "show" }); });
load();
