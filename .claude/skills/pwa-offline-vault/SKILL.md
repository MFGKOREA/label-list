---
name: pwa-offline-vault
description: PWA Offline Vault & Sync Resolver - 매장 지하 창고 등 와이파이 단절 환경에서 localStorage/IndexedDB 큐로 입력을 보관하고, 온라인 재연결 시 멱등성(Idempotency)이 보장된 백엔드 동기화와 충돌 방지를 처리한다. 오프라인 기능 구현, 동기화 오류 디버깅, PWA 캐시 이슈 시 사용한다.
metadata:
  domain: pwa-offline
  target: label-list (order.html, sw.js, apps-script 백엔드)
---

# 📴 PWA Offline Vault & Sync Resolver

매장 지하 창고처럼 와이파이가 끊기는 환경에서 발주/재고 입력을 잃지 않게 하고,
재연결 시 중복 없이 백엔드(Apps Script Web App)로 동기화하는 스킬.

## 1. 언제 이 스킬을 쓰나

- 창고에서 입력이 저장 안 됐다는 보고가 있을 때
- 오프라인 큐/동기화 기능을 구현·수정할 때
- 같은 항목이 두 번 저장(중복 행)된 원인을 찾을 때
- Service Worker 캐시 문제로 앱이 옛 버전을 보여줄 때

## 2. 아키텍처

```
[지하 창고: 오프라인]
  입력 폼 → IndexedDB outbox 큐 (영속 보관, localStorage 보조)
             각 항목 = { client_id(UUID), type, payload, created_at, retries }
                    │
[왕복: 와이파이 복구]  ← online 이벤트 + 백그라운드 sync 시도
                    ▼
[온라인]  백엔드(Apps Script doPost)
  ① client_id 키로 멱등 처리: 이미 받은 항목은 기존 결과 재반환
  ② 서버 시각 수신 + 충돌 정책 적용
             │
             ▼
  큐에서 제거는 "서버 ack 수신 확인 후"만 — 전송 성공만으로 제거하지 않음
```

## 3. 핵심 코드 패턴

### 3-1. 큐 저장 (localStorage fallback 포함)

```js
const DB = "label-list-outbox", STORE = "queue";
async function enqueue(entry) {
  const item = { client_id: entry.client_id || crypto.randomUUID(),
                 created_at: Date.now(), retries: 0, ...entry };
  const db = await openDB(DB, 1);
  await tx(db, STORE, "readwrite").store.add(item, item.client_id);
  try { // localStorage 보조: IndexedDB 실패 대비 최소 복제
    const k = "outbox-fallback";
    localStorage.setItem(k, JSON.stringify([...JSON.parse(localStorage.getItem(k) || "[]"), item]));
  } catch (e) { /* 용량 초과 시 IndexedDB가 본진이므로 계속 */ }
  if ("serviceWorker" in navigator) navigator.serviceWorker.ready.then((r) => r.sync?.register("outbox-sync")).catch(() => {});
}
```

### 3-2. 멱등 동기화

```js
async function flushQueue() {
  if (!navigator.onLine) return { pending: await countQueue() };
  const items = await listQueue(); // FIFO, created_at 순
  const acked = new Set();
  for (const item of items.slice(0, 20)) { // 배치 20건, 실패 시 중단
    try {
      const res = await fetch(WEB_APP_URL + "?api=1&sync=1", {
        method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ client_id: item.client_id, type: item.type, payload: item.payload }),
      });
      if (!res.ok) break;                        // 서버 오류: 중단, 재시도 큐 유지
      const out = await res.json();
      if (out.status === "ok" || out.status === "duplicate") {
        acked.add(item.client_id);               // duplicate도 성공 — 이미 반영됨
        await removeQueue(item.client_id);
      } else break;
    } catch (e) { break; }                       // 네트워크 오류: 다음 기회에
  }
  return { pending: await countQueue(), flushed: acked.size };
}
```

**Apps Script 측 멱등 키:** `client_id`를 기록용 시트/속성에 저장해 동일 키 재수신 시 `duplicate` 응답.
Apps Script `doPost`는 재시도가 발생하기 쉬우므로(게이트웨이 타임아웃) 멱등키 없이는 중복이 반드시 발생한다.

### 3-3. 충돌 방지 정책

| 충돌 유형 | 정책 |
|---|---|
| 재고 수량(실사 vs 오프라인 입력) | **최신 수정 시각 우선**, 동시각이면 실사(실측) 우선, 양쪽 다 기록 보존 |
| 발주 수량 증감 | 합산 아님 — 서버값+증분을 클라이언트 계산 후 단일 값 전송 |
| 삭제 vs 수정 | 삭제 우선(삭제 이력 기록) |

## 4. Service Worker 캐시 주의 (sw.js)

- 캐시명 `label-list-shell-v1`을 변경하는 배포(예: v2) 시 **옛 캐시 삭제 로직(`caches.delete`)이 activate에 있는지** 확인. 없으면 유저가 옛 버전에 갇힌다.
- 오프라인 폴백: 앱 쉘(index.html)은 캐시 우선, API 요청(`?api=1`)은 **캐시 절대 사용 금지**.
- `skipWaiting` 강제 여부는 사용자 확인 후 결정 — 입력 중 강제 리로드는 입력 유실.

## 5. 엣지 케이스 방어책

- [ ] 전송 성공(HTTP 200)만으로 큐 제거 금지 — 응답 본문의 ack 확인 후 제거
- [ ] `navigator.onLine`이 true여도 실제 요청은 실패할 수 있음 → 온라인 판단을 온라인 이벤트에만 의존하지 않음
- [ ] 큐 항목에 절대 `retries` 무한 증가 방지 — 상한(예: 10회) 후 격리(isolated) 상태로 보고
- [ ] 시각은 `created_at` 클라 시각 + 서버 수신 시각 둘 다 보존 (시계 틀림 대응)
- [ ] IndexedDB 버전업grade 실패(다른 탭 열림) → 에러 노출, 조용히 폴백만 하지 않음
- [ ] 민감 정보(개인정보)는 큐에 평문 저장하지 않도록 payload 최소화

## 6. 클로드 코드 체크리스트

1. [ ] 모든 큐 항목에 UUID 멱등키가 있다
2. [ ] 제거는 서버 ack 확인 후에만 발생한다
3. [ ] 배치 전송에 실패 시 중단·재시도 상한이 있다
4. [ ] 충돌 정책이 명시되어 있고 임의 병합하지 않는다
5. [ ] SW 캐시 버전 정책(구 캐시 삭제)이 유지된다
6. [ ] 오프라인 상태에서 실제 테스트(네트워크 차단)로 검증 후 커밋했다
