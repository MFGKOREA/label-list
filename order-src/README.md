# 발주·프랩 계산 앱 개발 메모

배포 파일은 저장소 루트의 `order.html` 하나입니다(GitHub Pages: https://mfgkorea.github.io/label-list/order.html).
소스는 이 폴더에 나뉘어 있고 `python3 order-src/build.py`로 `order.html`에 합칩니다. **`order.html`을 직접 고치지 말고 여기 소스를 고친 뒤 빌드하세요.**

| 파일 | 내용 |
|---|---|
| `app.js` | 계산·화면 전부 (한 IIFE) |
| `app.css` | KREAM 스타일. 색은 `:root` 토큰, 다크모드 포함 |
| `app-body.html` | `<body>` 안 마크업 |
| `build.py` | 위 세 파일을 order.html에 끼워 넣음 |
| `test/smoke.mjs` | 실제 시트 데이터로 전 화면을 열어 오류·A/B 차이를 출력, `test/shots/`에 스크린샷 (시트에 쓰지 않음) |

## 데이터 (구글 시트 KV, Apps Script)
- 주소: `app.js`의 `DEFAULT_API`. 읽기 `GET ?api=1` → `{key: value}` 전체. 쓰기 `POST {action:"set"|"append", key, value|item}` (Content-Type text/plain).
- **쓰기는 매장 실제 데이터를 바꿉니다.** 사용자(점장·KM)가 요청한 것만, 기존 값을 읽어 합친 뒤 씁니다.
- 주요 키
  - `month.YYYY-MM` {gross, ledger(수불현황), sales(메뉴별 매출현황), line/prep(레시피 PDF 파싱)}
  - `forecast` {날짜: {fc, act}} · `input.날짜` {품목: {s 재고, o 발주수량, r 추천, i 예전 익일}} · `onhand` 재고 기록(채점용)
  - `prepOnhand.날짜`, `prepLog`(프랩 재고 학습) · `master.order`(발주 시트) · `master.prep`(프랩 시트)
  - 설정: `map` {menu, ing}(메뉴→레시피, 재료→품목/프랩, "skip"), `hide`(목록에서 숨김), `itemCfg` {품목: {ea, g, as, box, tbG, label, portionG, portionLabel}}, `prepCfg` {프랩: {unit, panG, portionG, step, raw, item, from, rate, split/shortOf, per, label, note, tbG, batch}}, `prepMap`, `customRecipes`, `holidays`, `vendorCfg` {업체: {days 발주 요일(0=일), lead 입고까지 영업일, note}}
  - 학습 기록: `learnlog`, `learnsnap`

## 계산 요약
- A 수불현황: Gross 100만원당 사용량, 최근 3달 3:2:1 (3달 이상이면 고정량+비례량).
- B 메뉴별 매출현황 × 레시피: 메뉴별 최근 3달 판매(3:2:1, 새 메뉴는 그 달만)로 레시피를 원재료까지 풂. 로스 계수(실제÷레시피 중앙값). A와 3배 넘게 다르면 B 안 씀.
- C 최종: A·B를 오차(재고 채점·월 채점) 역수로 섞고, 안전재고 1.65σ. 발주 기간 = 오늘 ~ 다음 발주분 입고 전날 (발주 후 2영업일 입고, 일요일 입고 없음).
- 입고예정 = 앱에 넣은 발주수량(입고일 전까지). 재고 채점은 두 재고 사이 입고를 발주 기록으로 계산, 모르는 날이 끼면 제외.
- Forecast: 점장 Forecast × 보정(실제÷Forecast 중앙값). 비어 있으면 데이터 예상(같은 요일 최근 6번 가중평균, 공휴일 별도).
- 프랩: 프랩 사용량(최근 3달과 최근 달 중 큰 쪽) ÷ Gross × 오늘 Forecast. 한 번에 만드는 건 쉘프라이프 절반 기간. 프랩 재고 학습 배수(0.5~2).

## 일하는 방식
- 사용자는 한국어로 짧게 말합니다. 답도 한국어로 짧게.
- 바뀐 건 매번 빌드 → 스모크 테스트 → 브랜치 커밋·푸시 → main 머지·푸시(배포).
- 숫자를 바꾸는 수정은 바꾸기 전·후 값을 같이 보고합니다.
