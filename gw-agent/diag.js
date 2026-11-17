// 스스로 진단 (1.17.0 시즌2 13번 — 11/17 KM 승인)
//  막히는 원인을 다섯 가지로만 나누고, 원인마다 "다음에 무엇을 하면 되는지" 한 줄을 만든다.
//  화면·저장소·네트워크를 건드리지 않는 순수 함수 → 확장(bg.js)과 시험(node)이 같은 코드를 씀
//  적는 곳은 시트 kv 의 gwDiag = { at, code, diagMsg, fixedBy, why, ver } — 사람 이름·숫자는 담지 않는다
(function (G) {
  // 원인 코드와 복구 한 줄. 문구는 100% 쉬운 말로, 화면 이름·누를 곳을 그대로 적는다
  const RECOVER = {
    ver: "새 gw-agent.zip을 받아 폴더에 덮어쓰고 chrome://extensions 에서 [새로고침]",
    gwlogin: "확장 설정(GW Agent)에 GW 아이디·비밀번호를 넣고 [저장]",
    mislogin: "매장 PC 크롬에서 MIS에 한 번 로그인(비어 있으면 GW의 '경영정보'를 다시 눌러 열기)",
    vpn: "SSLVPN을 다시 연결한 뒤 확장의 [MIS 직접 열어 보기]로 화면이 뜨는지 확인",
    sheet: "매장 인터넷(랜선·공유기) 확인 — 5분 뒤 스스로 다시 해 보고, 계속되면 시트 잠금(가게 키) 확인",
  };

  // "1.17.0" 처럼 점으로 나뉜 버전 비교: a<b는 -1, 같으면 0, a>b는 1
  function gwCmpVer(a, b) {
    const x = String(a == null ? "0" : a).split(".").map((n) => parseInt(n, 10) || 0);
    const y = String(b == null ? "0" : b).split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  // 막힌 까닭(사람이 읽는 글) → 원인 코드. 못 고르면 ""(진단하지 않음)
  function gwDiagCause(why) {
    const w = String(why == null ? "" : why);
    // 순서가 중요: 좁은 원인부터 본다 (예: "GW 로그인 … 로그인 화면"은 GW 로그인 문제이지 MIS 세션 문제가 아님)
    if (/버전|모르는 종류|사라진 종류|확장이 낮/.test(w)) return "ver";
    if (/시트|sheet/i.test(w)) return "sheet";
    if (/GW 로그인|GW 아이디|비밀번호가 저장|자동입력 못 켬/.test(w)) return "gwlogin";
    if (/MIS[^\n]{0,20}로그인|MIS 세션/.test(w)) return "mislogin";
    if (/연결 안 됨|연결 오류|VPN|errpage|응답 없음/.test(w)) return "vpn";
    return "";
  }

  // 원인 + 그때 본 글 → 화면에 그대로 쓰는 한 줄 (원인을 모르면 빈 글)
  function gwDiagText(code, why) {
    if (!code || !RECOVER[code]) return "";
    const w = String(why == null ? "" : why).trim().slice(0, 120);
    return w ? `${w} · ${RECOVER[code]}` : RECOVER[code];
  }

  // 확장 버전이 필요한 버전보다 낮은가 → { low, msg }
  function gwVerState(ver, minVer) {
    if (!minVer) return { low: false, msg: "" };
    const low = gwCmpVer(ver, minVer) < 0;
    return { low, msg: low ? `확장이 낮아요(지금 ${ver} · 필요 ${minVer}) · ${RECOVER.ver}` : "" };
  }

  G.GW_RECOVER = RECOVER;
  G.gwCmpVer = gwCmpVer;
  G.gwDiagCause = gwDiagCause;
  G.gwDiagText = gwDiagText;
  G.gwVerState = gwVerState;
})(typeof self !== "undefined" ? self : globalThis);
