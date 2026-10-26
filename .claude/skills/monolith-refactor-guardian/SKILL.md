---
name: monolith-refactor-guardian
description: Monolith HTML Refactoring Guardian - order.html(2,500+줄), index.html(1,000+줄) 단일 파일 수정 시 전역 변수 오염, 이벤트 리스너 누수, DOM ID 충돌을 방지하는 안전 분할·격리 가드레일이다. 대형 HTML/JS 파일 수정, 리팩토링, 기능 추가 시 사용한다.
metadata:
  domain: frontend-refactoring
  target: label-list (order.html 3,592줄, index.html 1,343줄)
---

# 🏗️ Monolith HTML Refactoring Guardian

`order.html`(3,592줄), `index.html`(1,343줄) 같은 단일 파일 모놀리스를 안전하게 고치는 가드레일.
"고치다가 다른 기능을 깨는" 사고를 방지하는 것이 목적.

## 1. 언제 이 스킬을 쓰나

- order.html / index.html에 기능을 추가·수정할 때
- 일부 코드를 파일로 분리(외부 JS)할 때
- 전역 변수/이벤트 관련 버그를 추적할 때

## 2. 위험 지도 (이 저장소 실측)

- 두 파일 모두 `<script>` 인라인이 파일 하단에 몰려 있고 **전역 함수/변수**가 상호 의존한다.
- PWA(sw.js 캐시 `label-list-shell-v1`)라서 **캐시된 옛 JS와 새 HTML이 섞이는 배포 이슈**가 있다.
- Apps Script 백엔드 호출이 분산되어 있다 — 분리 시 URL/응답 규약을 훼손하지 말 것.

## 3. 가드레일 1: 전역 변수 오염 방지

```js
// ❌ 금지: 새 전역 추가
var itemCount = 0;
function recalc() { ... }

// ✅ 기존 전역과의 충돌 없이: 단일 네임스페이스 + 기존 심볼 재사용
window.OrderApp = window.OrderApp || {};
OrderApp.recalc = function () { ... };

// 수정 전 반드시: 동일 이름이 이미 있는지 확인
// grep -n "function recalc\|var recalc\|let recalc\|const recalc" order.html
// 존재하면 새로 만들지 말고 기존 함수를 확장하거나 호출 지점을 수정
```

- 새 전역 생성 전 검색 습관: `grep -n "\b이름\b" order.html index.html` 로 기존 정의 확인.
- IIFE로 감싸진 기존 스코프가 있으면 그 안에서만 작업.
- `let/const`는 `<script>` 단위 스코프라도 **같은 페이지의 다른 스크립트가 window 속성으로 참조**하는 경우가 있으므로, 제거 전 참조 검색 필수.

## 4. 가드레일 2: 이벤트 리스너 누수 방지

```js
// ❌ 금지: 렌더마다 addEventListener → 클릭이 N배로 발화
list.innerHTML = rows.map(r => `<li data-id="${r.id}">${r.name}</li>`).join("");
list.querySelectorAll("li").forEach((li) => li.addEventListener("click", () => select(li.dataset.id)));

// ✅ 위임 패턴: 리스너 1회 등록, 렌더와 무관
if (!OrderApp._delegated) {
  list.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]");
    if (li) select(li.dataset.id);
  });
  OrderApp._delegated = true;  // 1회만
}
```

- 인라인 `onclick="foo()"`이 이미 쓰이는 페이지에서 새 `addEventListener`를 섞으면 실행 순서가 섞인다. 기존 방식 따르거나, 교체 시 **해당 요소의 모든 핸들러 제거를 확인**.
- 동적 요소 재렌더 시 기존 리스너 정리를 확인 — `innerHTML` 교체는 자식 리스너를 GC하지만, 문서 레벨 리스너는 남는다.

## 5. 가드레일 3: DOM ID 충돌 방지

- 새 ID는 반드시 `grep -n 'id="이름"' order.html index.html`로 중복 확인. 모놀리스에서 ID 중복은 `getElementById`가 첫 요소만 잡아 **조용히 잘못 동작**한다.
- ID 네이밍 컨벤션: 기존 접두어를 따른다 (예: `order-`, `label-`). 무작위 신규 접두어 금지.
- `querySelector`로 id를 문자열 조합으로 만들 때(`"#" + prefix + id`) 사용자 입력을 그대로 넣지 않는다 — 셀렉터 인젝션/예외 발생.

## 6. 안전 분할 절차 (파일로 빼낼 때)

1. **한 번에 하나의 기능만** 분리. 한 커밋 = 하나의 분리.
2. 분리할 코드의 전역 참조 목록을 먼저 작성 (읽는 전역 / 쓰는 전역 / 참조 DOM id / 참조 외부 함수).
3. 외부 JS로 빼되, `<script src>`는 **인라인 스크립트보다 앞에** 두거나 의존 순서를 명시 — 순서 바뀌면 전역 미정의 오류.
4. sw.js 캐시 버전 올리기: 외부 JS 추가 시 캐시 목록에 포함 + 캐시명 버전 bump (안 하면 유저가 옛 JS에 갇힘 — `pwa-offline-vault` 연동).
5. 분리 후 전 기능 수동 스모크: 발주 입력 → 저장 → 동기화 → 오프라인 재시작 확인.

## 7. 엣지 케이스 방어책

- [ ] "동작하니까 일단 커밋" 금지 — 수정 대상 외 기능 1개 이상 스모크 확인
- [ ] PWA 캐시로 인한 옛 버전 확인 방지: 배포 후 반드시 캐시 버전 갱신 여부 확인
- [ ] 분리 중 발견한 미사용 코드/주석 블록은 그 커밋에서 제거하지 않는다 (별도 커밋) — 원인 추적 불가 방지
- [ ] `document.write`가 남아 있으면 제거 대상이지만 즉시 제거 대신 로그 기록 후 별도 작업
- [ ] 인라인 스크립트 내 Apps Script URL이 중복 정의되어 있으면 하나로 통합하되 응답 규약 변화 없음을 확인
- [ ] 수정 전 `git stash` 대신 커밋 단위로 작업 — 모놀리스는 롤백 단위가 커밋이어야 안전

## 8. 클로드 코드 체크리스트

1. [ ] 새 전역/ID 추가 전 grep 중복 확인을 했다
2. [ ] 이벤트 등록은 위임 또는 1회 등록 패턴으로 누수가 없다
3. [ ] 스크립트 로드 순서(외부 JS 의존)를 검증했다
4. [ ] sw.js 캐시 목록/버전이 수정 내용과 동기화됐다
5. [ ] 커밋 단위가 하나의 분리/수정이다
6. [ ] 수정 후 관련 기능 스모크 테스트를 실제 브라우저에서 했다
