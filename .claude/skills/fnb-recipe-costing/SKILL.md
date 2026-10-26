---
name: fnb-recipe-costing
description: F&B Recipe Costing & Margin Calculator - 식자재 입고 단가와 레시피 투입량을 매핑해 메뉴별 원가율(Cost%)·마진율을 계산하고, 원가 급등/변동 이상치를 감지한다. 메뉴 원가 분석, 판매가 조정, 발주 단가 변동 검토, 원가율 리포트 작성 시 사용한다.
metadata:
  domain: fnb-costing
  target: label-list (Mad for Garlic 수원컨벤션센터점)
---

# 🧾 F&B Recipe Costing & Margin Calculator

외식업 매장의 식자재 단가 → 레시피 → 메뉴 원가율 계산과 원가 이상 감지를 담당하는 스킬.
저장소의 발주/재고 데이터(`order.html`, Apps Script 백엔드)와 함께 동작하도록 설계했다.

## 1. 언제 이 스킬을 쓰나

- 새 메뉴 판매가를 정하거나 기존 판매가를 검토할 때
- 입고 단가가 올라 원가율이 깨졌는지 확인할 때
- 원가율 리포트를 만들어 점주 보고 자료로 쓸 때
- 발주 단위(원/kg, 원/팩, 원/박스)가 섞여 있어 계산이 헷갈릴 때

## 2. 아키텍처

```
입고 단가 원장 (items)          레시피 매핑 (recipes)           산출
┌────────────────────┐      ┌──────────────────────┐      ┌──────────────────┐
│ item_id            │      │ menu_id              │      │ menu_cost        │
│ name               │      │ item_id              │      │ cost%  = 원가/판가 │
│ unit: kg|pack|box  │      │ qty_per_batch (g/ml) │      │ margin% = 1-cost% │
│ unit_price         │      │ waste_pct (로스)      │      │ contribution     │
│ vat_incl: bool     │      │ yield_pct (수율)      │      └──────────────────┘
│ received_at        │      └──────────────────────┘
└────────────────────┘                  │
        ▲                               ▼
   입고 전표 입력                 단가 이상 감지기
   (전표 OCR/수기)              (급등·급락 플래그)
```

## 3. 단가 환산: 모든 것을 `원/g`로 통일

단가 단위가 섞이면 계산이 반드시 깨진다. **입고 단위 → 1g 단가** 환산을 항상 먼저 한다.

```js
// unit_price를 1g(또는 1ml) 단가로 정규화
const UNIT_GRAMS = {
  kg: 1000,
  g: 1,
  pack: null,   // pack/box는 master에 실중량(그램)이 별도 필수
  box: null,
};

function toPricePerGram(item) {
  const base = UNIT_GRAMS[item.unit];
  if (base) return item.unit_price / base;
  if (!item.net_weight_g) throw new Error(`${item.name}: pack/box 단가인데 net_weight_g 없음 → 계산 불가, 실중량 확인 필요`);
  return item.unit_price / item.net_weight_g;
}

// 레시피 1회 투입 원가 = 1g 단가 × 투입량(g) × 로스 보정
function lineCost(item, recipe) {
  const ppg = toPricePerGram(item);
  const usable = 1 - (recipe.waste_pct || 0) / 100;      // 손질 로스
  return ppg * recipe.qty_per_batch * (usable > 0 ? 1 / usable : 1);
}

function menuCost(items, recipeLines) {
  return recipeLines.reduce((sum, r) => sum + lineCost(items[r.item_id], r), 0);
}

function margins(menuCost, sellPrice, vatIncluded = true) {
  const net = vatIncluded ? sellPrice / 1.1 : sellPrice;   // 부가세 제외 기준
  return { cost_pct: menuCost / net, margin_pct: 1 - menuCost / net };
}
```

**F&B 원가율 기준선(가이드):** 식자재 원가율 30~35%, 인건비 25~30%, 합계 FL 비율 60% 이하.
`cost_pct > 0.38` 이면 즉시 플래그를 띄운다.

## 4. 원가 이상 감지 (급등/급락)

```js
// 최근 입고 단가 변동 감지: 30일 이동평균 대비 편차
function detectAnomalies(priceHistory, { madK = 3, pctAlert = 0.15 } = {}) {
  const alerts = [];
  for (const [itemId, rows] of Object.entries(priceHistory)) {
    const sorted = rows.slice().sort((a, b) => a.received_at - b.received_at);
    const prices = sorted.map((r) => r.unit_price);
    const win = prices.slice(-8);
    const mean = win.reduce((a, b) => a + b, 0) / win.length;
    // MAD(중위절대편차) 기반 — 원가 데이터는 소표본이므로 표준편차보다 견고
    const median = [...win].sort((a, b) => a - b)[Math.floor(win.length / 2)];
    const mad = [...win].map((p) => Math.abs(p - median)).sort((a, b) => a - b)[Math.floor(win.length / 2)];
    const latest = prices[prices.length - 1];
    const z = mad > 0 ? Math.abs(latest - median) / (1.4826 * mad) : Infinity;
    const jump = (latest - mean) / mean;
    if (z > madK || Math.abs(jump) > pctAlert) {
      alerts.push({ itemId, latest, mean, jump_pct: jump, z, type: jump > 0 ? "급등" : "급락" });
    }
  }
  return alerts;
}
```

- **급락도 이상이다.** 전표 오입력(자릿수, 타 매장 단가 복사) 가능성이 있으므로 감지되면 입력 원본을 확인할 것.
- 동일 품목이라도 **규격이 바뀐 경우**(예: 1kg → 1.2kg 팩) 단위 환산 없이 비교하면 가짜 급등이 나온다. 비교 전 `net_weight_g` 정규화 필수.

## 5. 출력 리포트 규격

메뉴별 표는 반드시 아래 컬럼 순서로 (점주 보고용):

| 메뉴 | 판매가(부가세포함) | 원가 | Cost% | Margin% | 최근 단가 변동 | 조치 |
|---|---|---|---|---|---|---|
| 스테이크 샐러드 | 24,000 | 8,150 | 37.5% | 62.5% | 부채살 +9% (10/24) | 판가 검토 or 로스 재측정 |

## 6. 엣지 케이스 방어책

- [ ] pack/box 단가인데 실중량(net_weight_g)이 없는 품목 → 계산 중단하고 확인 요청 (추정치로 채우지 않는다)
- [ ] 부가세 포함/별도가 섞인 전표 → `vat_incl` 필드로 통일, 계산 전 정규화
- [ ] 소분/손질 로스(waste)가 레시피에 없는 항목 → 0으로 두지 말고 "미측정" 표기. 미트카운트 실사 데이터로 보정
- [ ] 동일 품목명에 규격이 다른 레코드 여러 개 → item_id로만 매핑, 이름 매칭 금지
- [ ] 계산 결과가 음수/무한대(usable <= 0) → 레시피 오류로 처리, 자동 절사하지 않는다
- [ ] 판매가는 저장소 데이터를 신뢰하고, MIS 매출과 대조가 필요하면 `sales-gross-reconciler` 스킬로 교차 검증

## 7. 클로드 코드 체크리스트

1. [ ] 원본 단가 데이터를 임의 보정하지 않았다 (의심 항목은 플래그만)
2. [ ] 모든 단가를 1g 기준으로 환산했고 pack/box는 실중량 확인을 통과했다
3. [ ] Cost%/Margin%는 부가세 제외 판매가 기준으로 계산했다
4. [ ] 이상 감지 결과에 근거(평균, 편차, 날짜)를 표기했다
5. [ ] 리포트에 "기준일"과 "단가 데이터 범위"를 명시했다
6. [ ] 코드를 추가했다면 기존 `order.html`의 전역 오염 가드(`monolith-refactor-guardian`)를 따랐다
