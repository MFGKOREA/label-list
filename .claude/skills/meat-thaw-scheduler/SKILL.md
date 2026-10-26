---
name: meat-thaw-scheduler
description: Meat Thaw & Count Cycle Scheduler - 스테이크 육류(부채살·안심·채끝·등심)의 해동 리드타임(D-2/D-3)을 관리하고, 주말 피크 매출 예측과 연동해 해동실 투입량을 역산해 86(품절)을 방지한다. 발주 및 해동 스케줄 수립, 미트카운트 실사 준비 시 사용한다.
metadata:
  domain: meat-ops
  target: label-list (Mad for Garlic 수원컨벤션센터점)
---

# 🥩 Meat Thaw & Count Cycle Scheduler

냉동 육류의 해동 리드타임 관리 + 주말 매출 예측 기반 해동 투입량 역산 스킬.
`order.html`의 발주 예측(주말 계수, 편향 보정)과 미트카운트 실사 데이터를 입력으로 받는다.

## 1. 언제 이 스킬을 쓰나

- 목~금에 주말(금토일) 해동 스케줄을 짤 때
- 해동실 용량이 부족해 어떤 육류를 먼저 뺄지 우선순위를 정할 때
- 미트카운트(육류 재고 실사) 전에 해동/반납 일정을 정리할 때
- 품절(86) 위험이 예상되는 부위를 미리 잡아낼 때

## 2. 부위별 해동 리드타임 (냉장 해동 기준)

| 부위 | 박스/중량 | 냉장 해동 리드타임 | 비고 |
|---|---|---|---|
| 부채살 (Flat Iron) | ~2kg/팩 | **D-2** | 얇고 균일, 해동 빠름 |
| 안심 (Tenderloin) | ~1.8kg/팩 | **D-2** | 두꺼워도 소형, D-2면 충분 |
| 채끝 (Sirloin Strip) | ~4kg/팩 | **D-3** | 대형, 심부까지 72h 필요 |
| 등심 (Ribeye) | ~5kg/팩 | **D-3** | 지방 많아 심부 해동 느림 |

- **절대 규칙:** 금요일 서빙분은 수요일(채끝·등심)/목요일(부채살·안심)에 해동실로 투입.
- 해동 중 온도: 냉장 0~4℃. 표면 7℃ 초과 금지 → 위생점검 감점(`hygiene-audit-check` 연동).
- 해동 완료 후 유효기간: 해동일 기준 냉장 48시간 내 사용. 미사용분 재냉동 금지.

## 3. 투입량 역산 로직

```
주말(금토일) 예상 판매량 = Σ (요일별 예측 판매 부위 수량)
  ← order.html의 주말 계수 + 편향 보정 + 메뉴 판매 팩터 (apps-script v8)
보유량(가용) = 미트카운트 실사 냉장 분 + 이미 해동 완료 분
해동 필요량 = max(0, 예상 판매량 − 보유량) × (1 + 버퍼 5%)
86 위험 = 해동 필요량 > 해동실 동시 수용량 → 우선순위 분할 투입
```

```js
const LEAD_DAYS = { "부채살": 2, "안심": 2, "채끝": 3, "등심": 3 };
const BUFFER = 0.05;

function thawPlan({ forecastByDay, onHand, chamberCap, today }) {
  // forecastByDay: { "금": {부채살: 12, 채끝: 20, ...}, "토": {...}, "일": {...} }
  const need = {}, lines = [];
  for (const [day, cuts] of Object.entries(forecastByDay)) {
    const serveDate = servingDate(today, day);
    for (const [cut, qty] of Object.entries(cuts)) {
      const required = Math.ceil(qty * (1 + BUFFER)) - (onHand[cut] || 0);
      if (required > 0) need[cut] = (need[cut] || 0) + required;
      const thawStart = addDays(serveDate, -LEAD_DAYS[cut]);
      if (thawStart < today) {
        lines.push(`⚠️ ${cut}: 서빙 ${day}(${fmt(serveDate)}) 기준 리드타임 ${LEAD_DAYS[cut]}일 지남 — 해동 시작일 ${fmt(thawStart)} 이미 경과`);
      }
    }
  }
  // 해동실 용량 분할: 총 필요 > 동시 수용이면 리드타임 긴 부위부터
  let total = Object.values(need).reduce((a, b) => a + b, 0);
  const priority = Object.entries(need).sort((a, b) => LEAD_DAYS[b[0]] - LEAD_DAYS[a[0]]);
  const batches = [];
  while (total > chamberCap) {
    let cap = chamberCap;
    const batch = [];
    for (const [cut, qty] of priority) {
      if (qty <= 0) continue;
      const take = Math.min(qty, cap);
      batch.push({ cut, qty: take }); cap -= take; need[cut] -= take; total -= take;
    }
    batches.push(batch);
  }
  return { batches, warnings: lines };
}
```

## 4. 86(품절) 방지 판단 순서

1. 예상 판매량이 보유량+해동 가능량을 초과 → **발주 추가**(리드타임상 배송 불가 시) → **대체 부위 제안**(레시피 매핑 내에서만) → **메뉴 선제 86 공지** 순으로 결정.
2. 대체 부위 제안 시 반드시 원가율 영향을 같이 표기(`fnb-recipe-costing` 스킬 참조). 원가 급등 중인 부위로 갈음하는 것은 점주 승인 필요.
3. 일요일 밤 잔량은 월요일 점심 메뉴로 흡수 가능한지 먼저 검토 — 해동분 폐기 비용이 곧 원가율 악화.

## 5. 미트카운트 연동

- 실사 시점: 해동 스케줄 변경 전 **반드시 최신 실사 수치** 기준으로 계산. 어제 실사 + 오늘 사용 추정 조합은 금지(누적 오차 발생).
- 실사 단위(팩/kg/장)와 발주 단위가 다르면 실중량 환산 후 합산.
- 실사 결과는 `order.html` 재고 필드에 즉시 반영하고, 편차(이전 재고 vs 실사)가 큰 품목은 별도 표기.

## 6. 엣지 케이스 방어책

- [ ] 연휴(명절·추석) 직전은 과거 주말 팩터가 왜곡됨 → 연휴 배수 보정을 명시적으로 적용
- [ ] 해동실 정전/고장 이력이 있으면 리드타임에 +1일 버퍼 적용
- [ ] 신규 부위(리드타임 미등록) → 기본값 D-3을 쓰되 "미검증" 표기 후 실측으로 갱신
- [ ] 예측 편향(항상 부족/과다) 패턴이 관찰되면 버퍼를 고정 5%로 두지 말고 최근 4주 편차로 재보정
- [ ] 해동 시작일이 이미 지난 경고가 나오면 계산을 계속하되 경고를 결과 최상단에 배치 (조용히 덮지 않는다)

## 7. 클로드 코드 체크리스트

1. [ ] 판매 예측치는 저장소의 실제 데이터(주말 계수/편향 보정)에서 왔는지 출처를 표기했다
2. [ ] 모든 부위에 리드타임이 매핑되어 있고 미등록 부위는 "미검증"으로 표기했다
3. [ ] 해동 시작일이 경과한 항목을 경고 최상단에 노출했다
4. [ ] 86 위험 시 발주→대체→선제공지 순서를 지켰고 원가 영향을 표기했다
5. [ ] 실사 수치의 기준 시각을 명시했다
6. [ ] 위생 관련 문구(온도, 재냉동 금지)는 임의 변경하지 않았다 (`hygiene-audit-check`와 일치)
