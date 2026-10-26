---
name: barcode-ocr-tuner
description: Dot-font & Crinkled Film OCR Tuner - 구겨진 비닐 포장과 잉크 번진 도트 폰트 소비기한 인식률을 높이는 Canvas 이진화·대비 증폭·노이즈 필터링과 한국식 날짜 정규식 튜너. 냉동/냉장 진공포장 육류의 축산물이력제 12자리 이력번호 인식과 mtrace.go.kr 연동도 지원한다. 라벨 OCR 정확도 문제, 소비기한/이력번호 인식 실패 시 사용한다.
metadata:
  domain: label-ocr
  target: label-list (한글표시사항 라벨/소비기한 OCR, 축산물이력제)
---

# 🔍 Dot-font & Crinkled Film OCR Tuner

구겨진 비닐 포장, 잉크 번진 도트 폰트, 성에 낀 냉동 진공포장에서 소비기한·날짜·
**축산물이력제 12자리 이력번호**를 최대 인식률로 뽑아내는 이미지 전처리/후처리 스킬.

## 1. 언제 이 스킬을 쓰나

- 라벨/포장 사진에서 소비기한 OCR이 반복 실패할 때
- 구겨진 비닐·번진 도트 폰트·성에 낀 진공포장 이미지를 다룰 때
- 육류 포장의 축산물이력제(개체식별번호) 12자리를 읽어 이력을 조회해야 할 때
- OCR 후보 중 진짜 날짜/이력번호를 골라내는 규칙을 튜닝할 때

## 2. 아키텍처

```
사진 입력 (휴대폰 촬영)
   │
   ▼
[전처리 파이프라인]  이 스킬의 본체
   1) 그레이스케일 변환
   2) 대비 증폭 (CLAHE 유사 히스토그램 스트레칭)
   3) 적응형 임계처리 (국소 평균 — 구김 그림자에 강함)
   4) 모폴로지 연산 (닫힘: 도트 폰트 끊김 연결 / 열림: 성에·반사 스펙클 제거)
   5) 기울기 보정 (진공포장 라벨 기울어짐)
   │
   ▼
OCR (Tesseract.js 등) → 원시 후보 텍스트
   │
   ▼
[후처리 튜너]  한국식 날짜 정규식 + 이력번호 정규식 + 검증합
   │
   ├─ 소비기한 후보 → hygiene-audit-check 라벨 검증 연동
   └─ 이력번호 12자리 → mtrace.go.kr / 매장 마스터 바인딩
```

## 3. 전처리: Canvas 파이프라인

### 3-1. 그레이스케일 + 대비 증폭

```js
function toGrayscale(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const g = 0.299 * p[i] + 0.587 * p[i+1] + 0.114 * p[i+2];
    p[i] = p[i+1] = p[i+2] = g;
  }
  ctx.putImageData(d, 0, 0);
}

function contrastStretch(ctx, w, h, clipLow = 0.02, clipHigh = 0.98) {
  const d = ctx.getImageData(0, 0, w, h), hist = new Uint32Array(256);
  for (let i = 0; i < d.data.length; i += 4) hist[d.data[i]]++;
  const total = w * h; let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * clipLow) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * (1 - clipHigh)) { hi = v; break; } }
  const scale = hi > lo ? 255 / (hi - lo) : 1;
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.max(0, Math.min(255, (d.data[i] - lo) * scale));
    d.data[i] = d.data[i+1] = d.data[i+2] = v;
  }
  ctx.putImageData(d, 0, 0);
}
```

### 3-2. 적응형 임계처리 (구김 그림자 방어)

전역 임계값은 구겨진 비닐의 그림자에서 글자를 통째로 지운다. **국소 평균 기반 적응형**이 필수.

```js
// 블록 평균 기반 적응형 임계처리 (단순화된 integral image 방식)
function adaptiveThreshold(ctx, w, h, blockSize = 25, bias = 8) {
  // integral image로 각 픽셀의 (blockSize/2) 반경 평균을 구하고,
  // 픽셀값 < 평균 - bias → 글자(검정), 아니면 배경(흰색)
  const src = ctx.getImageData(0, 0, w, h).data;
  const out = ctx.createImageData(w, h);
  const half = blockSize >> 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dy = -half; dy <= half; dy += 2)      // 샘플 스텝 2로 속도 확보
        for (let dx = -half; dx <= half; dx += 2) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
          sum += src[(yy * w + xx) * 4]; n++;
        }
      const thr = sum / n - bias;
      const v = src[(y * w + x) * 4] < thr ? 0 : 255;
      const o = (y * w + x) * 4;
      out.data[o] = out.data[o+1] = out.data[o+2] = v; out.data[o+3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}
```

### 3-3. 모폴로지 연산 (도트 폰트 끊김 연결 / 성에 스펙클 제거)

```js
// 이진화된 이미지에 적용. close(팽창→침식)로 도트 폰트 끊긴 획을 이어붙인다.
// open(침식→팽胀)으로 성에·핏물 반사의 작은 흰 반점을 지운다.
function morphology(ctx, w, h, op /* "close" | "open" */, r = 1) {
  const src = ctx.getImageData(0, 0, w, h).data;
  const pass = (data, mode /* "dilate" | "erode" */) => {
    const out = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let hit = mode === "dilate" ? false : true;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy)), xx = Math.min(w - 1, Math.max(0, x + dx));
        const dark = data[(yy * w + xx) * 4] === 0;
        if (mode === "dilate" && dark) hit = true;
        if (mode === "erode" && !dark) hit = false;
      }
      const v = hit ? 0 : 255, o = (y * w + x) * 4;
      out.data[o] = out.data[o+1] = out.data[o+2] = v; out.data[o+3] = 255;
    }
    return out;
  };
  const seq = op === "close" ? ["dilate", "erode"] : ["erode", "dilate"];
  ctx.putImageData(pass(src, seq[0]), 0, 0);
  ctx.putImageData(pass(pass(ctx.getImageData(0, 0, w, h).data, seq[1]), seq[1]), 0, 0);
}
```

### 3-4. 성에/핏물 반사 대응 추가 팁

- 냉동 진공포장은 **촬영 후 5~10초 대기해 성에를 약간 녹인 뒤 촬영**하면 인식률이 눈에 띄게 오른다 (운영 지침에 포함).
- 반사 스펙클은 `open` 모폴로지 전에 **밝은 픽셀 클리핑**(상위 1%를 255로 평탄화)을 선행하면 더 잘 지워진다.
- 비닐 굴곡 반사 하이라이트는 그레이스케일 단계에서 국소 최대값 제거(중간값 필터)로 완화.

## 4. 후처리 튜너: 한국식 날짜 + 축산물이력제 이력번호

### 4-1. 날짜 정규식 (한국 라벨 관행 전수 대응)

```js
const DATE_PATTERNS = [
  /\b(20\d{2})[.\-\/년\s]*(\d{1,2})[.\-\/월\s]*(\d{1,2})[일]?\b/,        // 2026.10.30 / 2026-10-30 / 2026년10월30일
  /\b(20\d{2})(\d{2})(\d{2})\b/,                                          // 20261030 (도트폰트에서 구분자 소실)
  /\b(\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\b/,                          // 26.10.30 (YY.MM.DD — 연도 기준점 확인)
  /\b(20\d{2})\s*[년]\s*(\d{1,2})\s*[월]\s*(\d{1,2})\s*[일]\s*까지/,      // "2026년 10월 30일까지"
];

function extractExpiry(text, { yearCutoff = 79 } = {}) { // YY 26→2026: 두 자리 연도 컷오프
  const hits = [];
  for (const re of DATE_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, "g"))) {
      let [ , y, mo, d ] = m;
      if (String(y).length === 2) y = Number(y) <= yearCutoff ? 2000 + +y : 1900 + +y;
      const dt = new Date(+y, mo - 1, d);
      if (dt.getFullYear() === +y && dt.getMonth() === mo - 1 && dt.getDate() === +d) {
        hits.push({ iso: dt.toISOString().slice(0, 10), at: m.index, raw: m[0] });
      }
    }
  }
  // 정렬 우선순위: 정확도 높은 패턴 → 최근성. 키워드("까지", "소비기한") 근접 가점
  return hits;
}
```

- 두 자리 연도는 컷오프 규칙을 명시하고, `20261030`처럼 구분자 소실 형식은 **문맥(라벨 위치) 검증** 후 채택.
- "제조", "유통기한", "소비기한" 키워드로 후보 분류 — 소비기한 vs 제조일자 혼동은 `hygiene-audit-check` 오류로 직결.

### 4-2. 축산물이력제 12자리 이력번호/개체식별번호 (핵심)

```js
// 축산물이력제: 소 12자리 개체식별번호, 돼지 등 이력번호 12자리
// 인쇄 형식: "1234-567890-12" 또는 "1234 567890 12" 등 구분자 다양 → 구분자 유연 수용
const TRACE_PATTERNS = [
  /\b(\d{4})[-\s]?(\d{4})[-\s]?(\d{4})\b/,               // 1234-5678-9012 / 123456789012 연속
  /\b(\d{3})[-\s]?(\d{4})[-\s]?(\d{5})\b/,               // 123-4567-89012 변형
];

function extractTraceNumber(text) {
  const cands = [];
  for (const re of TRACE_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, "g"))) {
      const digits = m.slice(1).join("");
      if (digits.length !== 12) continue;
      cands.push({ raw: m[0], digits, at: m.index });
    }
  }
  // 소비기한 후보(YYYYMMDD=8자리)와 겹치는 오탐 제거: 날짜 후보 위치와 겹치면 제외
  return cands;
}
```

**바코드 심볼로지 지원 (포장지 바코드에서 직접 읽기):**

| 심볼로지 | 축산물 이력 활용 | 특성 |
|---|---|---|
| Code 128 | 이력번호·개체식별번호 인쇄 | 숫자만이면 C코드셋, 밀도 높음 — 구김에 민감 |
| GS1-128 | AI(01) GTIN·(10) 로트·(17) 유통기한 구조 | 시작문자 FNC1, AI 파싱 필요 — `(01)880...` 형태 |
| ITF-14/ITF-2 | 외장 박스 코드 | 가드바 필요, 진공포장에 잘 안 씀 — 박스에서 주로 발견 |

바코드 인식은 픽셀 기반 디코딩(예: ZXing-js) 사용. 이때도 전처리 파이프라인을 공유하되,
**바코드는 이진화 역방향(바=검정) 임계 방향 확인**이 필요 — 적응형 임계처리 후 배경/전경이 뒤집히면 디코딩 실패.
GS1-128의 AI(17)=유통기한(YYMMDD)은 소비기한 후보로도 활용 가능 — 이 경우 라벨 인쇄 날짜보다 신뢰도 높음.

## 5. 이력번호 → 이력정보 바인딩 아키텍처

```
OCR 성공: 12자리 digits
   │
   ├─ (A) 축산물이력제 공공 API (mtrace.go.kr — 농림축산검역본부 축산물이력제
   │      육류표식정보 제공 서비스, data.go.kr OpenAPI, 일일 호출한도 있음)
   │      조회 → 도축일자, 등급(1+/1/2등), 부위명, 유통기한, 업소명
   │
   ├─ (B) 매장 마스터 우선 정책:
   │      1) 매장 마스터(시트/로컬 캐시)에 이력번호 캐시 있으면 → API 호출 없이 즉시
   │      2) 없으면 (A) 조회 → 결과를 마스터에 저장(캐시, 도축일자+부위 키)
   │      3) API 오류/한도 초과 → 부위명 라벨 텍스트로 임시 매칭, "미확정" 표기
   │
   └─ 결과 바인딩:
      { trace_no, 도축일자, 등급, 부위명, 유통기한, source: "api|cache|label",
        verified_at }
             │
             ▼
      미트카운트 실사 기록 / meat-thaw-scheduler 리드타임 판단 / 소비기한 관리대장
```

```js
async function bindTraceInfo(digits, { masterCache, apiClient }) {
  const cached = masterCache.get(digits);
  if (cached && isFresh(cached)) return { ...cached, source: "cache" };
  try {
    const info = await apiClient.traceLookup(digits); // mtrace.go.kr OpenAPI 래퍼
    if (!info || info.errorCode) throw new Error(`API 응답 오류: ${info?.errorMsg || "empty"}`);
    const bound = { trace_no: digits, 도축일자: info.butcherDate, 등급: info.grade,
                    부위명: info.partName, 유통기한: info.expiry, source: "api",
                    verified_at: new Date().toISOString() };
    masterCache.set(digits, bound);
    return bound;
  } catch (e) {
    return { trace_no: digits, source: "pending", error: String(e), // 재시도 큐로
             note: "API 조회 실패 — 부위명 라벨 텍스트로 임시 매칭, 미확정 표기" };
  }
}
```

- API 호출은 **하루 호출한도**가 있으므로 반드시 캐시 우선. 같은 이력번호 재조회 금지.
- 조회 결과가 사람이 읽은 라벨(부위명)과 어긋나면 **API 결과 우선이되 불일치 기록** (라벨 오인쇄 가능성).
- 이력번호로 도축일자를 확보하면 `meat-thaw-scheduler`의 신선도 판단과 `hygiene-audit-check`의
  소비기한 검증(유통기한 ≤ 소비기한)에 그대로 연결된다.

## 6. 엣지 케이스 방어책

- [ ] 전처리는 원본 이미지를 절대 파괴하지 않는다 — 복사본 캔버스에서만 연산
- [ ] OCR 후보 다수/충돌 시 하나만 고르지 말고 후보 리스트 + 신뢰도를 함께 반환
- [ ] 날짜 후보가 이력번호 후보와 겹치면(숫자 열 재해석) 이력번호 우선 검증 후 날짜 재탐색
- [ ] 12자리 후보가 `20261030xxxx`처럼 날짜+연속 숫자로 오매칭될 수 있음 — 날짜 정규식 먼저 소거
- [ ] API 실패는 실패로 기록하고 라벨 텍스트 매칭은 "미확정"으로 명시 — 조용히 확정 처리 금지
- [ ] 개인정보/영업 비밀: 이력 조회 결과는 매장 운영 기록 용도로만, 외부 공유 금지

## 7. 클로드 코드 체크리스트

1. [ ] 전처리 순서(그레이스케일→대비→적응형 임계→모폴로지→기울기)를 유지했다
2. [ ] 원본 이미지를 보존하고 복사본에서만 전처리했다
3. [ ] 날짜 정규식에 한국 라벨 관행 형식과 두 자리 연도 컷오프가 있다
4. [ ] 12자리 이력번호 정규식과 날짜 오탐 소거 로직이 있다
5. [ ] API 조회는 캐시 우선이고, 실패 시 "미확정" 표기와 재시도 큐가 있다
6. [ ] 바코드 심볼로지(GS1-128 AI 포함) 후처리가 별도 경로로 존재한다
7. [ ] 실제 구겨진/성에 낀 샘플 사진으로 검증 결과(전/후)를 남겼다
