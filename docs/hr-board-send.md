# MFG HR Board [HR 전송] ↔ GW Agent 1.12.0 — 보드 쪽 수정안

GW Agent 1.12.0부터 보드 [전송] 버튼을 확장이 받아, 플젝 HR 주간스케쥴(시간)에 요일별 엑셀로 올리고 **저장 → 공지 → 확정**까지 처리한다.
확장 코드: `gw-agent/hrsend-core.js`(검사·엑셀), `hrsend-steps.js`(HR 화면 조작), `hrsend-bg.js`(순서·잠금), `hrsend-board.js`(보드 화면 다리).
시험: `node order-src/test/gw/hrsend.test.mjs`(19개), `node order-src/test/gw/e2e-hrsend.mjs`(가짜 HR·보드, 17개).

## 1. 조건
- 보드를 **확장이 깔린 크롬**(매장 PC 또는 KM PC)에서 열어야 한다. 폰에서 누르면 확장이 없어서 안 간다.
- 그 크롬에서 HR(hr.pljec.cloud)에 로그인돼 있고 회사망(SSL VPN)이 붙어 있어야 한다. 확장은 자동 로그인을 하지 않는다.
- 확장은 `https://hr-board-teal.vercel.app` 화면에서 온 메시지만 받는다. 보드 주소가 바뀌면 `manifest.json`과 `hrsend-bg.js`의 `HRS.board`를 같이 바꾼다.
- 보드에 로그인이 없다면, 그 주소를 아는 사람이 확장이 깔린 PC에서 [전송]을 누를 수 있다는 뜻이다. 보드에 로그인이 있는지 확인할 것.

## 2. 메시지
보드 → 확장 (`window.postMessage(msg, location.origin)`):
```json
{ "type": "MFG_HR_SEND", "requestId": "uuid", "dept": "BOH", "weekStart": "2026-11-23", "weekEnd": "2026-11-29",
  "mode": "full", "employees": [ { "empNo": "10260850", "name": "…", "days": [ { "date": "2026-11-23", "kind": "출근", "in": "09:00", "out": "18:00", "brk": "01:00" } ] } ] }
```
- `mode`: `"test"` = 월요일 1일만 업로드·팝업 저장(공지·확정 안 함), `"full"` = 7일 + 저장·공지·확정.
- `kind`는 HR의 4개(출근·휴무·주휴일·공휴일)만. 그 밖의 값은 확장이 그 직원을 에러로 돌려준다.
- 기타: `MFG_HR_PING` → `MFG_HR_AGENT_READY` 대답, `MFG_HR_SEND_STATUS {requestId}` → `MFG_HR_SEND_STATUS_RESULT {run, result}`(보드를 새로고침했을 때 결과 다시 받기).

확장 → 보드:
| type | 언제 | 내용 |
|---|---|---|
| `MFG_HR_AGENT_READY` | 보드가 열릴 때 | `ver` |
| `MFG_HR_SEND_ACK` | 받자마자 | `ok`, `error` |
| `MFG_HR_SEND_PROGRESS` | 단계마다 | `item: {t, stage, day, msg}` |
| `MFG_HR_SEND_RESULT` | 끝 | `ok, stage, day, message, savedEmpNos, confirmed, mode, test?, code?, errors?, notInFile?, notInHr?, log` |

- `stage`: `validate`(보내기 전 검사) · `open`(HR 접속·화면·주차) · `upload` · `save` · `notice` · `confirm`
- `code`: `login`(HR 로그인 풀림) · `network`(VPN 끊김) · `confirmed`(이미 확정된 주)
- 같은 `requestId`를 다시 보내면 다시 실행하지 않고 지난 결과를 돌려준다. 다른 전송이 도는 중이면 `busy: true`.

## 3. 보드 코드 (React, 그대로 붙여 쓸 수 있는 모양)
```tsx
// hooks/useHrAgent.ts
import { useCallback, useEffect, useRef, useState } from "react";
type Day = { date: string; kind: string; in: string; out: string; brk: string };
type Emp = { empNo: string; name: string; days: Day[] };
export type HrResult = { requestId: string; ok: boolean; stage: string; day?: string | null; message: string; savedEmpNos: string[];
  confirmed: boolean; mode: "full" | "test"; test?: boolean; code?: string; errors?: { empNo?: string; msg: string }[]; notInFile?: string[]; log: { t: string; stage: string; day: string | null; msg: string }[] };

export function useHrAgent() {
  const [ver, setVer] = useState<string | null>(null);
  const [progress, setProgress] = useState<HrResult["log"]>([]);
  const wait = useRef(new Map<string, (r: HrResult) => void>());
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== location.origin) return;
      const d = e.data || {};
      if (d.type === "MFG_HR_AGENT_READY") setVer(d.ver);
      if (d.type === "MFG_HR_SEND_PROGRESS") setProgress((p) => [...p, d.item]);
      if (d.type === "MFG_HR_SEND_ACK" && !d.ok) wait.current.get(d.requestId)?.({ requestId: d.requestId, ok: false, stage: "validate", message: d.error || "확장이 안 받음", savedEmpNos: [], confirmed: false, mode: "full", log: [] });
      if (d.type === "MFG_HR_SEND_RESULT") { wait.current.get(d.requestId)?.(d); wait.current.delete(d.requestId); }
    };
    window.addEventListener("message", on);
    window.postMessage({ type: "MFG_HR_PING" }, location.origin);
    return () => window.removeEventListener("message", on);
  }, []);
  const send = useCallback((p: { dept: "BOH" | "FOH"; weekStart: string; weekEnd: string; mode: "full" | "test"; employees: Emp[] }) =>
    new Promise<HrResult>((resolve) => {
      const requestId = crypto.randomUUID();
      setProgress([]);
      wait.current.set(requestId, resolve);
      window.postMessage({ type: "MFG_HR_SEND", requestId, ...p }, location.origin);
    }), []);
  return { ver, ready: !!ver, progress, send };
}
```

직원·근태유형 만들기 (지금 HR전송 탭이 만드는 `days`를 그대로 쓰고, 4개 밖의 값만 바꿈):
```ts
const HR_KINDS = ["출근", "휴무", "주휴일", "공휴일"];
// 보드 설정에서 정하는 바꿈표 (예: 연차·D/O → 휴무, 교육 → 출근). 정해지지 않은 값은 그대로 보내면 확장이 그 직원을 에러로 돌려줌
const KIND_MAP: Record<string, string> = settings.hrKindMap ?? {};
const toHr = (d: Day): Day => {
  const kind = HR_KINDS.includes(d.kind) ? d.kind : KIND_MAP[d.kind] ?? d.kind;
  return kind === "출근" ? { ...d, kind, brk: d.brk || "00:00" } : kind === "공휴일" ? { ...d, kind } : { ...d, kind, in: "", out: "", brk: "" };
};
// HR 업로드는 그날 그 부서 전체를 덮어쓰므로: 그 부서·그 주의 재직 직원 전원을 보냄 (미전송·수정 필요만 보내지 않음)
const employees = roster.filter((r) => r.active && r.dept === dept).map((r) => ({ empNo: String(r.empNo), name: r.name, days: hrDays(r).map(toHr) }));
```

[전송] 버튼과 결과 반영 (`week.hr[empId] = { state, hash, at }`):
```ts
const hashOf = (days: Day[]) => days.map((d) => `${d.kind}|${d.in}|${d.out}|${d.brk}`).join(";");
async function onSend(mode: "full" | "test") {
  if (!agent.ready) return alert("이 크롬에 GW Agent 1.12.0이 없어요. 매장 PC 크롬에서 열어 주세요.");
  const sent = employees.map((e) => ({ id: idOf(e.empNo), empNo: e.empNo, hash: hashOf(e.days) })); // 보낸 시점의 hash
  const r = await agent.send({ dept, weekStart, weekEnd, mode, employees });
  if (r.mode === "test" || r.test) return showResult(r); // 시험은 상태를 바꾸지 않음
  const at = Date.now(), saved = new Set(r.savedEmpNos);
  const next = { ...week.hr };
  for (const s of sent) {
    if (r.ok && r.confirmed) next[s.id] = { state: "confirmed", hash: s.hash, at };
    else if (saved.has(s.empNo)) next[s.id] = { state: "saved", hash: s.hash, at }; // 저장까지만 됨 (공지·확정 실패)
    // 업로드·저장 실패: 그대로
  }
  await saveWeek({ ...week, hr: next });
  showResult(r); // r.stage · r.day · r.message · r.errors(직원별) · r.notInFile · r.log를 그대로 보여 줌
}
```

지금의 전송 모달("HR 사이트에 직접 입력" 안내 + [전송 완료])은 위 `onSend`로 바꾼다. 모달에 넣을 것:
- 확장 연결 표시: `agent.ready ? "GW Agent " + agent.ver : "확장 없음"`
- [시험 (월요일만)] · [전송 (저장·공지·확정)] 두 단추. 처음 한 번은 시험부터.
- 진행: `agent.progress`를 시각·단계·요일·문구로 한 줄씩.
- 결과: 실패면 `stage`와 `message` 그대로. `errors`가 있으면 직원별 목록, `notInFile`이면 "HR에만 있는 사번" 목록.

## 4. 시험 순서 (KM)
1. 매장 PC(또는 KM PC) 크롬에 GW Agent 1.12.0 덮어쓰기 → chrome://extensions에서 새로고침 → 버전 1.12.0 확인
2. 그 크롬에서 HR 로그인, 회사망 연결
3. 보드에서 48주(11/23~11/29) BOH → [시험 (월요일만)] → HR 주간스케쥴(시간) 월요일에 들어갔는지 눈으로 확인 (공지·확정은 안 됨)
4. 맞으면 [전송] (7일 + 저장·공지·확정)

처음 실제 화면에서는 가짜 화면과 다른 곳이 있을 수 있다(소속구분 드롭다운 모양, 토스트 모양, 표에서 사번 읽기). 멈추면 결과의 `stage`·`message`·`log`를 그대로 보내 주면 고친다.
