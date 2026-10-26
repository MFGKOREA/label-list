---
name: dom-scraper-resilience
description: MIS DOM Scraper Resilience & Frame Guard - 본사 MIS 화면 개편·점검 시 크롬 확장(MIS 자동화)이 깨지지 않도록 동적 iframe 로딩 대기, MutationObserver, CSS/XPath 대체 셀렉터 fallback을 적용한다. mis.js/mis-agent.js/mis-sales.js 수정, MIS 셀렉터 오류 디버깅 시 사용한다.
metadata:
  domain: mis-automation
  target: label-list (mis*.js, Chrome Extension MV3)
---

# 🖥️ MIS DOM Scraper Resilience & Frame Guard

본사 웹 MIS(EasyUI 기반) 화면이 개편되거나 점검 중일 때 크롬 확장 셀렉터가 깨지지 않도록
방어하는 스킬. 저장소의 `mis.js`, `mis-agent.js`, `mis-sales.js`가 대상.

## 1. 언제 이 스킬을 쓰나

- MIS 화면이 개편되어 확장이 값을 못 읽을 때
- iframe 내부 접근이 간헐적으로 실패할 때
- 점검 시간대/세션 만료로 실행이 조용히 실패할 때
- 새 MIS 메뉴를 자동화에 추가할 때 (처음부터 방어적으로 작성)

## 2. MIS 환경의 알려진 특성 (저장소 실측)

- **iframe 다층 구조:** 본문 컨텐츠는 iframe 안에 있고, 좌측 메뉴는 `LeftFrame`. `frames()`로 전체 윈도우를 순회해야 함.
- **EasyUI 위젯:** 날짜 선택은 `data-datebox` input, 그리드는 `datagrid(options)`, 콤보박스는 `data-combobox`. 원생 `<select>`가 아니다.
- **값은 늦게 채워짐:** AJAX 응답 후 그리드에 값이 채워지므로, DOM 존재만으로는 부족하고 **값 도착까지 대기**가 필요.

## 3. 아키텍처: 방어 계층

```
셀렉터 해석 파이프라인
┌────────────────────────────────────────────────────┐
│ 1. 후보 셀렉터 목록 (CSS → XPath → EasyUI API 순)    │
│ 2. 프레임 순회 (frames()) + same-origin 가드          │
│ 3. 대기 전략: 값 도착 폴링 (fixed sleep 금지)          │
│ 4. MutationObserver로 지연 렌더 감지                  │
│ 5. 실패 시: 진단 스냅샷 수집 → 조용히 재시도 금지       │
└────────────────────────────────────────────────────┘
```

## 4. 핵심 코드 패턴

### 4-1. 프레임 순회 + 다층 대기

```js
const frames = () => {
  const out = [];
  const walk = (w) => {
    out.push(w);
    try { [...w.frames].forEach(walk); } catch (e) { /* cross-origin: 무시 */ }
  };
  walk(window.top);
  return out;
};

// 값이 채워질 때까지 대기 (고정 sleep 대신 상태 폴링)
async function waitFor(fn, { timeoutMs = 15000, intervalMs = 300 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const v = fn(); if (v) return v; } catch (e) { /* 프레임 전환 중 transient */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timeout — MIS 응답 지연 또는 셀렉터 만료");
}
```

### 4-2. 다중 셀렉터 fallback (CSS → XPath)

```js
const FINDERS = [
  // 1순위: 개편 전 셀렉터
  (w) => w.document.querySelector("#salesGrid"),
  // 2순위: EasyUI datagrid 옵션으로 그리드 식별 (id 개편에 강함)
  (w) => w.jQuery && [...w.document.querySelectorAll("table[id],div[id]")]
    .find((el) => $(el).data("datagrid") &&
      (($(el).datagrid("options").columns || []).flat().some((c) => /매출/.test(c.title || "")))),
  // 3순위: XPath로 텍스트 기반 탐색 (구조 완전 개편 시)
  (w) => { try {
      return w.document.evaluate("//th[contains(.,'매출')]/ancestor::table[1]",
        w.document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } catch { return null; } },
];

function findGrid() {
  for (const w of frames()) {
    for (const f of FINDERS) {
      try { const el = f(w); if (el) return { w, el }; } catch (e) { /* next */ }
    }
  }
  return null;
}
```

### 4-3. MutationObserver 지연 렌더 감지

```js
function observeOnce(w, selector, cb, timeoutMs = 20000) {
  const obs = new MutationObserver(() => {
    const el = (() => { try { return w.document.querySelector(selector); } catch { return null; } })();
    if (el) { obs.disconnect(); cb(el); }
  });
  obs.observe(w.document.documentElement, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), timeoutMs); // 누수 방지
}
```

### 4-4. 실패 시 진단 스냅샷 (조용히 재시도 금지)

셀렉터가 모두 실패하면 **화면이 바뀌었을 가능성**이므로 상태를 수집한다
(`mis-diag.js`의 패턴 재사용): input/select 현황, 버튼 텍스트, datagrid 컬럼, `.tree-title` 메뉴 트리, 각 프레임 URL. 이 스냅샷이 있으면 개편된 화면에서 새 셀렉터를 찾는 데 몇 분이면 충분하다.

## 5. 엣지 케이스 방어책

- [ ] cross-origin iframe 접근 예외는 삼키고 다음 프레임 진행 (try/catch 필수)
- [ ] 고정 `setTimeout` 대기 금지 — 네트워크 지연 시 오판, 화면 개편 시 무의미
- [ ] 점검 시간대(본사 공지)에는 실행을 아예 스킵하고 "점검 시간대"로 보고 — 실패로 기록하지 않는다
- [ ] 세션 만료 감지(로그인 페이지 리다이렉트) → 재시도 3회 금지, 사용자 알림 1회
- [ ] 동일 셀렉터 3회 연속 실패 → 진단 스냅샷 수집 후 중단 (무한 재시도 금지)
- [ ] 개편 후 첫 성공 시 셀렉터 후보 순서를 성공 순서로 기록해 다음 실행이 빨라지게 한다
- [ ] 확장(MV3) 컨텍스트: content script는 `document_idle` 유지, 백그라운드에서 tab 재주입 시 `world` 확인

## 6. 클로드 코드 체크리스트

1. [ ] 새 셀렉터는 후보 배열(FINDERS)에 CSS → EasyUI → XPath 순으로 추가했다
2. [ ] 모든 대기가 값 도착 폴링 기반이고 고정 sleep이 없다
3. [ ] MutationObserver는 반드시 disconnect(타임아웃 포함)한다
4. [ ] 실패 시 진단 스냅샷을 남기고 무한 재시도를 하지 않는다
5. [ ] 프레임 접근 예외 처리(cross-origin)가 빠져 있지 않다
6. [ ] 수정 후 `mis-diag.js`로 실제 MIS 화면에서 검증했다 (로컬 추정만으로 커밋하지 않음)
