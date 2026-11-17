// 스스로 진단(gw-agent/diag.js) 시험: 확장과 같은 코드를 불러 원인 고르기·복구 한 줄·버전 비교를 확인
// 사용: node order-src/test/gw/diag.test.mjs
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
vm.runInThisContext(fs.readFileSync(REPO + "/gw-agent/diag.js", "utf8"));
const VER = JSON.parse(fs.readFileSync(REPO + "/gw-ver.json", "utf8"));
const MAN = JSON.parse(fs.readFileSync(REPO + "/gw-agent/manifest.json", "utf8"));
let pass = 0, n = 0;
const t = (name, r, check) => { n++; let ok = false; try { ok = !!check(r); } catch (e) { ok = false; } if (ok) pass++; console.log((ok ? "통과  " : "실패  ") + name + (ok ? "" : "\n   " + JSON.stringify(r).slice(0, 400))); };

// ---- 버전 비교 ----
t("A 1.17.0 > 1.16.0 / 같음 / 낮음", [gwCmpVer("1.17.0", "1.16.0"), gwCmpVer("1.17.0", "1.17.0"), gwCmpVer("1.16.9", "1.17.0")], (r) => r.join() === "1,0,-1");
t("B 1.9.0 < 1.10.0 (글자 비교가 아니라 숫자 비교)", gwCmpVer("1.9.0", "1.10.0"), (r) => r === -1);
t("C 없는 조각은 0으로 봄 (1.17 = 1.17.0)", [gwCmpVer("1.17", "1.17.0"), gwCmpVer("1.17.1", "1.17")], (r) => r.join() === "0,1");
t("D 빈 값·이상한 값도 안 터짐", [gwCmpVer("", "1.0.0"), gwCmpVer(null, undefined)], (r) => r.join() === "-1,0");

// ---- 원인 고르기 ----
const cases = [
  ["E 확장 버전이 낮다는 글 → ver", "확장이 낮아요(지금 1.16.0 · 필요 1.17.0)", "ver"],
  ["F 모르는 종류 → ver", "모르는 종류라 하지 않음: menuToday", "ver"],
  ["G GW·MIS 연결 오류 → vpn", "MIS에 연결 안 됨 (매장 인터넷·VPN 확인 · 2번 다시 불러옴)", "vpn"],
  ["H 화면 응답 없음 → vpn", "GW 화면이 응답 없음 (알림창이 떠 있을 수 있음)", "vpn"],
  ["I MIS 로그인 화면 → mislogin", "MIS가 로그인 화면으로 나옴", "mislogin"],
  ["J GW 로그인 실패 → gwlogin", "GW 로그인이 안 됨 (30초째 로그인 화면 · 아이디·비밀번호 확인)", "gwlogin"],
  ["K 시트를 못 읽음 → sheet", "시트를 못 읽음 (인터넷 확인)", "sheet"],
  ["L 모르는 까닭 → 진단 안 함", "GW 탭이 닫힘", ""],
];
for (const [name, why, want] of cases) t(name, gwDiagCause(why), (r) => r === want);

// ---- 복구 한 줄 ----
t("M 원인마다 복구 한 줄이 있고, 그때 본 글이 앞에 붙음", gwDiagText("vpn", "MIS에 연결 안 됨"), (r) => /MIS에 연결 안 됨 · SSLVPN/.test(r));
t("N 원인 글 없이도 복구 한 줄만 나옴", gwDiagText("mislogin", ""), (r) => /MIS에 한 번 로그인/.test(r) && !r.startsWith(" ·"));
t("O 모르는 원인 코드면 빈 글(엉뚱한 안내를 지어내지 않음)", [gwDiagText("", "x"), gwDiagText("nope", "x")], (r) => r.join() === ",");
t("P 복구 문구는 다섯 가지 모두 있음", Object.keys(GW_RECOVER).sort(), (r) => r.join() === "gwlogin,mislogin,sheet,ver,vpn");
t("Q 복구 문구에 비밀번호·숫자 같은 개인정보가 없음", Object.values(GW_RECOVER).join(" "), (r) => !/\d{4,}|@|비밀번호\s*[:=]/.test(r));

// ---- 버전 상태 ----
t("R 필요한 버전보다 낮으면 low + 새 zip 안내", gwVerState("1.16.0", "1.17.0"), (r) => r.low && /새 gw-agent.zip/.test(r.msg));
t("S 같거나 높으면 low 아님", [gwVerState("1.17.0", "1.17.0"), gwVerState("1.18.0", "1.17.0")], (r) => !r[0].low && !r[1].low && r[0].msg === "");
t("T 필요한 버전 정보가 없으면 조용히 넘어감", gwVerState("1.16.0", ""), (r) => !r.low && r.msg === "");

// ---- 저장소 안의 파일끼리 맞는가 ----
t("U 저장소 manifest 버전 ≥ gw-ver.json minVer (지금 배포본이 요구치를 채움)", { ver: MAN.version, min: VER.minVer }, (r) => gwCmpVer(r.ver, r.min) >= 0);
t("V gw-ver.json 은 minVer 만 있는 작은 파일", Object.keys(VER).sort(), (r) => r.join() === "at,minVer,note");
console.log(`${pass}/${n} 통과`);
process.exit(pass === n ? 0 : 1);
