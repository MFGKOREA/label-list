const $ = (id) => document.getElementById(id);
const hm = (t) => new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
async function load() {
  const c = await chrome.storage.local.get(["id", "pw", "on", "logs", "appKey"]);
  $("key").placeholder = c.appKey ? "저장됨 (바꿀 때만 입력)" : "가게 키 (없으면 비워 두기)";
  $("id").value = c.id || ""; $("on").checked = !!c.on; $("pw").placeholder = c.pw ? "저장됨 (바꿀 때만 입력)" : "비밀번호";
  $("log").textContent = (c.logs || []).slice(0, 12).join("\n");
  try {
    const v = await (await fetch(API + "?api=1&status=1&t=" + Date.now())).json(), d = (v && (v.status || v.data)) || {};
    const a = d.misAgent || {}, p = d.misPush || {};
    const fresh = a.at && Date.now() - a.at < (a.mode === "ondemand" ? 20 * 60e3 : 180000);
    $("st").textContent = (!fresh ? `대기 꺼짐${a.at ? ` · 마지막 ${hm(a.at)}` : ""} (자동입력 켜기 확인)` : a.mode === "ondemand" ? `✓ 대기 중 · ${hm(a.at)} 확인 · 폰 전송 때만 창이 열려요` : `✓ MIS 입력 창 열림 · ${hm(a.at)} 확인${a.grid ? "" : " · 주문등록 화면 아님"}`) +
      (p.date ? `\n마지막 전송 ${p.date.slice(5)} ${p.status === "done" ? "저장 완료" : p.status === "error" ? "확인 필요" : p.status}` : "");
  } catch (e) { $("st").textContent = "시트에 연결 못 함 (인터넷 확인)"; }
}
$("save").addEventListener("click", async () => {
  const v = { id: $("id").value.trim(), on: $("on").checked, tries: [] };
  if ($("pw").value) v.pw = $("pw").value;
  if ($("key").value) v.appKey = $("key").value.trim();
  $("key").value = "";
  await chrome.storage.local.set(v); $("pw").value = "";
  await chrome.runtime.sendMessage({ q: "ensure" });
  $("st").textContent = v.on ? "저장했어요 · MIS 자동 탭을 열어요" : "저장했어요 · 자동입력 꺼짐";
  setTimeout(load, 1500);
});
$("open").addEventListener("click", async () => { await chrome.storage.local.set({ on: true }); $("on").checked = true; await chrome.runtime.sendMessage({ q: "show" }); });
load();
