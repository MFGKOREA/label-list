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
  - 설정: `map` {menu, ing}(메뉴→레시피, 재료→품목/프랩, "skip"), `hide`(목록에서 숨김), `itemCfg` {품목: {ea, g, as, box, tbG, label, portionG, portionLabel, recipeOnly 레시피로만 계산, thaw 해동 일수(발주 기간·86 위험을 그만큼 늘림)}}, `prepCfg` {프랩: {unit, panG, portionG, step, raw, item, from, rate, split/shortOf, per, label, note, tbG, batch}}, `prepMap`, `customRecipes` (항목에 months: ["2026-09"]면 그 달 계산에만 쓰는 옛 레시피), `shares` [{id, label, item, def}] (옵션 비율: 레시피 재료의 share/inv, 달마다 그 품목 수불로 맞추고 앞으로는 최근 3달 가중평균), `holidays`, `vendorCfg` {업체: {days 발주 요일(0=일), lead 입고까지 영업일, note}}
  - 학습 기록: `learnlog`, `learnsnap`

## 계산 요약
- A 수불현황: Gross 100만원당 사용량, 최근 3달 3:2:1 (3달 이상이면 고정량+비례량).
- B 메뉴별 매출현황 × 레시피: 메뉴별 최근 3달 판매(3:2:1, 새 메뉴는 그 달만)로 레시피를 원재료까지 풂. 로스 계수(실제÷레시피 중앙값). A와 3배 넘게 다르면 B 안 씀.
- C 최종: A·B를 오차(재고 채점·월 채점) 역수로 섞고, 안전재고 1.65σ (σ = 사용량 오차와 Forecast 오차, 일수는 매출이 몰린 만큼 줄인 실제 일수). 발주 기간 = 오늘 ~ 다음 발주분 입고 전날 (발주 후 2영업일 입고, 일요일 입고 없음).
- 입고예정 = 앱에 넣은 발주수량(입고일 전까지).
- 프랩 배치(prepPlan·batchAdj): 소스·드레싱·오일처럼 한 번에 만드는 프랩(원재료가 직접 들어가고 X·g 단위)의 원재료는 평균이 아니라 배치 날에 통째로 나감. 프랩별 Gross 100만원당 X(레시피 확장에서 batchAcc), 배치 = 주기(쉘프 절반, prepCfg.cycle) 동안 쓸 양(0.5X 단위, 최소 1X, prepCfg.batchX 고정 가능), 프랩 탭 기록(prepLog, 단위 같은 것만)부터 14일 시뮬레이션(프랩 탭 기준으로 모자라면 배치). 발주 필요량 = 평균 ± (기간 안 배치 − 평균 배치분), 재고를 모르면 평균 + 배치 하나가 더 들 확률만큼 여유분. 채점도 같은 보정을 쓰고 묶음 기준은 한 배치 양.
- 사전발주 ON: 발주할 날을 고르면 그날 아침 예상 재고(오늘까지 마지막으로 센 재고 + 입고 − 그날까지 영업일 사용량[지난날 실제 Gross, 앞날 Forecast])와 그날 발주 필요량을 보여줌. 켤 때마다 OFF로 시작, 86 위험·학습 제외. 재고 채점은 두 재고 사이 입고를 발주 기록으로 계산, 모르는 날이 끼면 제외. 이어진 구간을 예상 사용량 2단위가 될 때까지 묶어서 채점(시즈닝처럼 가끔 쓰는 품목), 사용 0도 포함하되 2단위 넘게 쓸 만큼 예상인데 그대로면 다시 안 센 값으로 제외(뜯은 건 안 세는 경우가 있어 1단위까지는 허용), 입고 없이 늘어난 날의 전날은 덜 센 재고로 제외, 오차는 ±100%에서 자름, σ는 채점 5번부터이고 통 단위 셈 잡음(1/(6·예상²))을 빼고 계산. 재고는 입력 기록(onhand)과 발주 탭 재고(input.날짜, 10/20부터)를 같이 씀(센 시각 모르면 10시). 그 사이 실제 Gross가 다 있는 구간만 채점, 센 시각만큼 그날 매출을 나눔(저녁에 센 날). 예전 기록(익일 칸)은 익일 입고가 적힌 것만.
- Forecast: 점장 Forecast × 보정(실제÷Forecast 중앙값). 비어 있으면 데이터 예상(같은 요일 최근 6번 가중평균, 중앙값 0.6배 미만만 버림, 공휴일은 같은 요일과 공휴일·일요일 중 큰 쪽, 그 주에 넣은 Forecast 트렌드 절반 반영).
- 프랩: 프랩 사용량(최근 3달과 최근 달 중 큰 쪽) ÷ Gross × 오늘 Forecast. 한 번에 만드는 건 쉘프라이프 절반 기간. 프랩 재고 학습 배수(0.5~2).

## 일하는 방식
- 사용자는 한국어로 짧게 말합니다. 답도 한국어로 짧게.
- 바뀐 건 매번 빌드 → 스모크 테스트 → 브랜치 커밋·푸시 → main 머지·푸시(배포).
- 계산을 바꾸면 회귀 테스트: 고치기 전 `node order-src/test/regress.mjs kv.json --save base.json`, 고친 뒤 `--cmp base.json` (품목별 발주량 전후 비교, 날짜는 DAYS=로). kv·base 파일은 매장 데이터라 저장소에 넣지 않음.
- 숫자를 바꾸는 수정은 바꾸기 전·후 값을 같이 보고합니다.
