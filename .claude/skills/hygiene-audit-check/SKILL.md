---
name: hygiene-audit-check
description: Hygiene & Food Labeling Audit Checklist - 식약처·본사 위생점검 대비 체크리스트, 한글표시사항 소분 라벨(제품명·소분일자·소비기한·보관방법·담당자) 검증, 냉장/냉동고 온도 점검표 규격 자동 검증을 수행한다. 위생점검 준비, 라벨 출력 전 검증, 온도 기록 확인 시 사용한다.
metadata:
  domain: hygiene-labeling
  target: label-list (Mad for Garlic 수원컨벤션센터점)
---

# 🧼 Hygiene & Food Labeling Audit Checklist

식약처/본사 위생점검 대비, 소분 라벨(한글표시사항) 검증, 온도 점검표 검증을 아우르는 스킬.
저장소의 라벨 앱(`index.html`, Apps Script `apps-script/label/`)과 직접 연동된다.

## 1. 언제 이 스킬을 쓰나

- 위생점검(본사/식약처) 전 자체 점검을 돌릴 때
- 소분 라벨 출력 전 필수 표시사항 누락을 확인할 때
- 냉장/냉동고 온도 기록에 빈 칸/이상치가 없는지 확인할 때
- 소비기한 임박 식자재 리스트를 뽑을 때

## 2. 소분 라벨 필수 표시사항 (한글표시사항)

소분·포장 식품 라벨에 **아래 5항목이 모두** 있어야 한다. 하나라도 누락되면 출력 차단.

| 항목 | 검증 규칙 |
|---|---|
| ① 제품명 | 원 제품명 유지 + 소분 구분 표기 허용 |
| ② 소분일자 | YYYY.MM.DD 또는 YYYY-MM-DD, 당일 이후 날짜 금지 |
| ③ 소비기한 | 소분일자 기준 원 제품 소비기한 이내. `소비기한 <= 소분일자` 즉시 차단 |
| ④ 보관방법 | 냉장/냉동 구분 필수 (품목 마스터의 보관온도와 일치) |
| ⑤ 담당자 | 실명 또는 지정 담당자명 |

```js
function validateLabel(label, itemMaster, today) {
  const errors = [];
  for (const f of ["제품명", "소분일자", "소비기한", "보관방법", "담당자"]) {
    if (!label[f] || !String(label[f]).trim()) errors.push(`${f} 누락`);
  }
  const parse = (d) => new Date(String(d).replace(/[.]/g, "-")).getTime();
  if (label["소분일자"] && label["소비기한"]) {
    if (parse(label["소분일자"]) > today) errors.push("소분일자가 미래 — 날짜 입력 오류");
    if (parse(label["소비기한"]) < today) errors.push("소비기한 경과 — 폐기 대상, 라벨 발행 금지");
    if (itemMaster.expiry && parse(label["소비기한"]) > parse(itemMaster.expiry)) {
      errors.push("소비기한이 원 제품 기한 초과");
    }
  }
  if (itemMaster.storage && label["보관방법"] && !label["보관방법"].includes(itemMaster.storage)) {
    errors.push(`보관방법 불일치 (마스터: ${itemMaster.storage})`);
  }
  return errors;
}
```

- **알레르기/원산지:** 소분 라벨에 표시 의무 항목이 늘어나는 경우(원산지 표시 대상 품목 등) 본사 지침 우선. 이 스킬은 5항목 기본 검증 + 본사 지침 업데이트 시 확장 필드로 대응.
- 라벨 앱 출력물과 이 검증 로직이 어긋나면 **라벨 앱 쪽을 수정 대상**으로 기록 (검증 기준이 원본).

## 3. 냉장/냉동고 온도 점검표 규격 자동 검증

표준 규격(본사 점검 기준, 예시 — 본사 기준 변경 시 이 값을 먼저 확인):

| 구분 | 규격 온도 | 기록 방식 |
|---|---|---|
| 냉장고 | 0~5℃ | 1일 2회(오전/오후) 기록 |
| 냉동고 | -18℃ 이하 | 1일 2회 기록 |
| 해동실 | 0~4℃ | 1일 1회 이상 |

```js
function auditTempLog(entries, { fridgeMax = 5, freezerMax = -18 } = {}) {
  const issues = [];
  for (const e of entries) {
    if (e.temp == null) { issues.push({ ...e, issue: "기록 누락" }); continue; }
    if (e.type === "냉장" && e.temp > fridgeMax) issues.push({ ...e, issue: "냉장 기준 초과" });
    if (e.type === "냉동" && e.temp > freezerMax) issues.push({ ...e, issue: "냉동 기준 초과" });
    if (e.temp < -40) issues.push({ ...e, issue: "측정 오류 의심(비정상 저온)" });
  }
  return issues;
}
```

- 이상치 발견 시: 단발성(문 열림·재고 투입 직후)이면 재측정 기록 확인, **연속 이상**이면 고장 신고 및 해당 식자재 폐기 판단 사유 기록.
- 기록 누락일은 "누락"으로 명시 — 점검 전에 메꿀 기회로 쓴다(소급 작성 유도 금지, 실제 재측정 기록으로 대체).

## 4. 위생점검 자체 점검 체크리스트 (핵심)

- [ ] 조리 종사자 위생 교육 이수 기록 최신
- [ ] 개인 위생용품(위생모·장갑·마스크) 구비 및 착용
- [ ] 식자재 유통기한·소분 라벨 전수 확인 (FIFO 적용)
- [ ] 냉장/냉동고 온도 기록 최근 7일 연속성
- [ ] 세척·소독 주기 준수 기록
- [ ] 쓰레기·폐기물 처리 기록
- [ ] 해동 방법 준수 (냉장 해동, 실온 해동 금지 — `meat-thaw-scheduler` 연동)

## 5. 엣지 케이스 방어책

- [ ] 날짜 파싱은 `YYYY.MM.DD`/`YYYY-MM-DD`/`YYYYMMDD` 모두 수용하되 모호 형식(`1/2/3`)은 차단
- [ ] 라벨 필드에 공백/특수문자만 있는 값도 누락으로 처리
- [ ] 온도 센서 오류(같은 값 반복, 급변) 의심 시 실측 재확인 권고 — 센서 값을 무비판 수용하지 않음
- [ ] 본사 기준이 이 스킬의 상수와 다르면 **본사 기준 우선**이며, 스킬 상수 갱신을 제안으로 기록
- [ ] 검증 결과는 통과/차단 이유를 라벨 단위로 남긴다 (묶어서 "대체로 OK"로 처리하지 않음)

## 6. 클로드 코드 체크리스트

1. [ ] 라벨 5항목 누락 시 출력 차단을 유지했다
2. [ ] 소비기한 ≤ 소분일자, 원 제품 기한 초과를 모두 검사했다
3. [ ] 온도 기록 누락일을 숨기지 않고 명시했다
4. [ ] 본사 기준과 충돌하는 상수를 발견하면 본사 기준 우선으로 처리하고 갱신 제안을 남겼다
5. [ ] 위생 관련 판단(폐기 여부 등)은 플래그까지만 하고 최종 결정은 점주에게 맡겼다
