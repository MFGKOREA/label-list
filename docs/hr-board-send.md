> **1.14.0부터 엑셀 업로드 방식은 쓰지 않는다 (11/17 KM).** 확장은 메인 표에 카드 입력(행 모델 값 넣기 → workType U → [저장] 한 번)을 하고, 부서 탭 → STORE 탭(관리자) 순서로 저장한다. 아래 "엑셀" 부분은 옛 기록.

# MFG HR Board [HR 전송] ↔ GW Agent 1.12.0

보드 [전송] → 확장(GW Agent) → 플젝 HR 주간스케쥴(시간)에 요일별 엑셀 업로드 → 행별 검증 → 팝업 저장 → (메인 저장) → 공지 → 확정 → 결과를 보드로.
규격은 11/16 KM이 실제 HR 화면에서 확인한 사실(48주 BOH 월요일 업로드·팝업 저장 성공)을 따른다.

| 어디 | 파일 |
|---|---|
| 확장 | `gw-agent/hrsend-core.js`(검사·엑셀) · `hrsend-steps.js`(HR 화면, MAIN world) · `hrsend-bg.js`(순서·잠금·회신) · `hrsend-board.js`(보드 다리) |
| 보드 | `docs/hr-board/hrAgent.ts`(보내기 전 처리·주고받기·결과 반영) · `docs/hr-board/HrSendPanel.tsx`(전송 모달 내용) |
| 시험 | `node order-src/test/gw/hrsend.test.mjs`(22) · `node order-src/test/gw/e2e-hrsend.mjs`(가짜 HR·보드에 확장을 올려 22) |

## 조건
- 보드를 **확장이 깔린 크롬**에서 열 것(매장 PC 또는 KM PC). 그 크롬에서 HR 로그인 + 회사망(SSL VPN). 확장은 자동 로그인을 하지 않는다.
- 확장은 `https://hr-board-teal.vercel.app` 화면에서 온 메시지만 받는다(주소가 바뀌면 `manifest.json`·`hrsend-bg.js HRS.board`도).
- 보드에 로그인이 없으면 주소를 아는 사람이 확장 PC에서 공지·확정까지 누를 수 있다 → 보드 로그인 확인.

## 메시지
보드 → 확장: `{ type: "MFG_HR_SEND", requestId, dept, weekStart, weekEnd, mode: "test"|"saveOnly"|"full", allowInit?: boolean, employees: [{ empNo, name, days: [7 × {date, kind, in, out, brk}] }] }`

확장 → 보드: `MFG_HR_AGENT_READY {ver}` · `MFG_HR_SEND_ACK {ok, error}` · `MFG_HR_SEND_PROGRESS {item:{t, stage, day, msg, ajax}}` ·
`MFG_HR_SEND_RESULT { requestId, ok, stage: precheck|week|upload|save|notice|confirm, day, message, rowErrors:[{empNo,name,day,msg}], savedDays:[], noticed, confirmed, savedEmpNos, mode, test?, code?, missing?, log }`
- `code`: `login` · `network` · `confirmed`(확정된 주) · `noticed`(공지된 주) · `nostatus`(상태 없는 주, full)
- 같은 requestId를 다시 보내면 실행하지 않고 지난 결과를 돌려줌. 다른 전송이 도는 중이면 `busy`.

## 모드
| mode | 하는 일 | 상태 없는 주 |
|---|---|---|
| test | 월요일 1일 업로드·검증·팝업 저장 (주휴일·52시간은 경고만) | 진행 |
| saveOnly | 7일 업로드·검증·팝업 저장 | 진행 |
| full | + 메인 저장(켜져 있을 때만) → 공지 → 확정 | 멈춤. `allowInit: true`면 업로드 전에 [초기화](미래 주차만) 후 진행 |

## 확장이 HR에서 하는 일 (확인된 사실대로)
1. 주간스케쥴(시간) 열기 → 소속구분(BOH/FOH) → 라벨 `48주(11/23~11/29)`가 보드 주와 같아질 때까지 `hrt2325.moveWeek` → [검색]
2. 주차 상태 = `getMasterList_prc` 응답 `data.infoEnc`를 `decParam`으로 푼 `[{schedule_status}]`. CONFIRM·NOTICE면 멈춤
3. 요일마다 (팝업 첫 로딩 한도 60초, 요일 전환 한도 30초. 하루 약 45~50초, 7일 5~6분. 로딩 끝 = 그 요청의 getMasterList_prc 응답 HTTP 200·returnCode 0, 0행도 정상): [일자별 수정] → **요일 label 클릭 → 그날 자료 로딩(getMasterList_prc DETAIL) 대기** → 업로드 전 사번 기억 → 숨은 파일 칸에 엑셀 → "엑셀 데이터가 화면에 반영되었습니다." → **행별 검증** → 팝업 [저장] → "저장되었습니다."
   - 행별 검증(`#hrt2325_pop_list_html` kendo view): `chk_message`가 있으면 오류(예: "사번, 이름 오류.", "소속구분이 다름", "예외 근태유형", "출근인경우 출/퇴, 휴게 시간 필수 입력") · 사번 집합 = 보낸 파일 · `{DAY}_time_item_code_p`(출근 10, 휴무 17, 없으면 null) · 출근·퇴근·휴게 시간
   - 업로드 뒤 표 행 수 = 파일 인원
   - "HR에 있는데 명단에 없는 직원"은 [검색] 메인 표 emp_code 기준으로 업로드 전에 검사 → `missing`(메인 표 0행인 빈 주는 건너뜀)
   - 하나라도 걸리면 **저장하지 않고 팝업을 닫고** 회신. 이미 저장된 요일은 `savedDays`
4. full: 메인 [저장](켜져 있을 때만) → [공지](confirm "공지 하시겠습니까?") → [확정](confirm "확정 하시겠습니까?")
- 팝업(Bootstrap 3 modal)은 isShown false·display none·backdrop 0이 될 때까지 기다린 뒤 다시 엶. backdrop이 남으면 modal('hide') → backdrop·body.modal-open 지움. 어떻게 멈추든 끝에 같은 정리를 함
- confirm은 그 단추에서 예상한 문구에만 "예". 오류 알림은 `#jl_noti_footer_btn1`로 닫고 "오류 신고"는 안 누름
- 문구는 `doClientMsg`(문자열·{message})를 감싸서, 서버 상태는 `jq(document).ajaxComplete`로 엔드포인트별 HTTP·returnCode를 모아 판단(기록에 남김)
- 메인 표는 읽지 않음(직책 칸에 휴대폰 번호). 팝업 표에서 emp_code·emp_name·chk_message·근태·시간만. 확장 기록에는 이름을 남기지 않음
- 누르지 않는 단추: 전주복사·확정취소·공지취소·누락건 추가 (초기화는 allowInit일 때만)

## 엑셀
요일마다 1파일, 시트 `Sheet1`, 머리글 `.. | 사원코드 | 이름 | 근태유형 | 출근시각 | 퇴근시각 | 휴게시간`, 직원 1명 1행.
**모든 칸을 공유 문자열(sharedStrings, t="s")로**, 빈칸도 `""`, 셀 서식 텍스트(@). inlineStr·빈 칸 생략(openpyxl 기본)은 HR 서버가 500으로 거부(KM 확인).
확장은 SheetJS 없이 직접 만든다(`hrsXlsx`). 첫 실제 업로드에서 500이 나면 HR "엑셀양식 다운로드" 파일을 틀로 쓰고 sheet1·sharedStrings만 바꾸는 방식으로 바꾼다.

## 보드
- `hrAgent.ts`
  - `prepare()`: "HR 표기"로 바꾸고, 4개 밖이면 차단(직원·요일 표시). "9:00"은 "09:00"으로. 출근은 휴게가 없으면 00:00, 휴무·주휴일은 시간 "". 주휴일 1일·52시간(test는 경고)
  - `sendToAgent()`: 확장으로 보내고 결과를 기다림
  - `applyResult()`: 확정 → confirmed, 7일 저장까지 → saved, 그 밖은 그대로. hash는 보낸 시점 값
- `HrSendPanel.tsx`: 확장 연결 표시, [시험]·[7일 저장만]·[전송] 단추, 진행 기록, 결과(실패 단계·행 오류·missing). nostatus면 [초기화 후 다시 전송] 단추
- 대상은 그 부서·주의 **재직 직원 전원**. 이름은 HR 등록 이름과 똑같아야 함(다르면 "사번, 이름 오류.")
- 연차 → 휴무 (11/16 KM). `hrKindMap` 기본값에 넣어 둠: 설정의 HR 표기가 아직 "연차"여도 휴무로 보냄. 운영 설정의 HR 표기도 휴무로 바꿔 두면 깔끔함

## 시험 순서 (KM)
1. 확장 1.12.0 덮어쓰기 → chrome://extensions 새로고침 → 버전 확인 → 그 크롬에서 HR 로그인·VPN
2. **test**: 48주 BOH 월요일 → HR에서 월요일 값 눈으로 확인
3. 틀린 자료로 검증 확인: 이름 다르게 · FOH 직원 섞기 · 직원 1명 빼기 → 저장 없이 오류 회신되는지 (연차는 보드에서 막힘)
4. **saveOnly**: 48주 BOH 7일
5. **full**: 상태 EDIT인 주에서 공지 → 확정 (상태 없는 주는 nostatus로 멈추는지)

멈추면 결과의 stage·message·rowErrors·log(엔드포인트 상태 포함)를 그대로 보내 주면 고친다.

## 공지·확정은 매장 전체로 따로 (1.13.0, 11/16 KM)
- 공지·확정은 **매장 전체에 한 번에** 적용된다. 그래서 부서 전송(`MFG_HR_SEND`)은 **입력·저장까지만** 한다(예전 `mode: "full"`도 saveOnly로 받음).
- 공지·확정은 별도 요청 `{ type: "MFG_HR_PUBLISH", requestId, weekStart, weekEnd, action: "both" | "notice" | "confirm", codes? }` → 결과 `MFG_HR_PUBLISH_RESULT { ok, stage: precheck|week|notice|confirm, message, rowErrors:[{empNo,name,dept,day,msg}], noticed, confirmed, log }`
- 확장 순서:
  1. 소속구분 **BOH → FOH → STORE**를 하나씩 [검색]해서 메인 표(`#hrt2325_info_list_html`)를 읽음. 사번·이름·요일별 근태 코드·시간만 읽고, 직책 칸은 안 읽음
  2. 점검: 시간 없는 출근 0개 · 직원마다 주휴일 정확히 1일 · 주 52시간 이하. 하나라도 걸리면 **공지를 누르지 않고** 직원·요일을 회신
  3. 소속구분 **빈칸(전체)**로 [검색] → 상태가 EDIT면 공지 → 확정, NOTICE면 확정만, CONFIRM이면 "이미 확정", 상태 없으면 멈춤
     - HR의 validateConfirm은 화면에 불러온 행만 검사하므로 전체 화면에서 누름. 이 부분은 KM이 코드로 확인했고 실제로 눌러 보지는 않음
- 근태 코드: 출근 10·휴무 17은 확인됨. 주휴일·공휴일 코드는 메인 표 칸에 보이는 이름("주휴일"·"공휴일")으로 알아냄. 모르는 코드가 나오면 점검에서 멈춤(`codes`로 지정 가능)
- 보드:
  - `HrPublishPanel.tsx`: BOH·FOH 재직 직원이 모두 '저장'(또는 '확정')일 때만 [공지·확정]·[공지만]·[확정만] 단추를 켬
  - `applyPublish()`: 확정에 성공하면 두 부서 전원을 '확정'으로
  - `HrSendPanel.tsx`: [시험]·[전송(7일 저장)]만 남김

## 속도: 1회 전송 10초 안쪽 (1.17.6, 11/18 KM)
- 목표: [전송] → 저장 확인까지 **10초 안쪽**. 1.17.5까지는 화면 대기의 고정 대기가 커서 한 번에 10초를 넘겼고, 화면에 작은 로딩 틀이 늘 떠 있으면 90초를 넘기도 했다.
- 바꾼 것 (작동 방식은 그대로 — 카드 입력·`saveData()`·다시 읽어 확인):
  - 화면 대기(`idle`): 15초 한도·150ms 간격 → 30ms 간격·1.2~1.5초 상한. **1px짜리 장식 로딩 요소는 덮개로 안 봄**(면적 400px² 이하 제외) — 이게 15초×여러 번을 잡아먹던 원인
  - 표·주차 기다리기: 200ms씩 자던 자리를 25ms 간격 + **보낸 요청이 다 답을 받았는지**(`settled`)로 판정
  - 메뉴 열기: 1초씩 자던 자리 → 60ms 간격 확인, 이미 주간스케쥴(시간) 화면이면 누르지 않고 바로 진행
  - 주차 라벨: 화면 전체를 훑지 않고 한 번 찾은 칸을 기억해 그 글자만 다시 읽음
  - 저장 직전 300ms 대기 → 한 틱(`requestAnimationFrame` 2번), 저장 확인 400ms 간격 → 30ms 간격
  - 결과를 보드로 **먼저** 보내고 탭 정리·기록은 그 뒤에 (보드가 느리게 느끼던 꼬리 제거)
- 결과에 `ms`(총 걸린 ms)와 `timing`(`tab`·`probe`·`open`·`week`·`save` 각 누적 ms)이 함께 온다. 메시지에도 `· 8.4초`처럼 찍힌다 → 다음 전송에서 실제 초를 바로 확인할 수 있다.
- 모의 HR 화면(지연 4~8ms) 측정: 화면이 이미 열려 있으면 2.16초 → **0.21초**, 메뉴부터 열면 3.42초 → **0.93초**, 작은 로딩 틀이 늘 떠 있는 화면 98.2초 → **0.20초**. 실제 시간은 여기에 HR 서버 응답(검색 0.4~1.5초·저장 0.5~1.2초)과 처음 탭을 열 때의 페이지 로딩(2~5초)이 더해진다.
