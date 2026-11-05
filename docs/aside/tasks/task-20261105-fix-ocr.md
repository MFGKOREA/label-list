# [Task] 매장모음 Apps Script 긴급 반영 (사진 글자 읽기 고장 수리)

받는 사람: 피클 → 어사이드 (구글 브라우저 작업)
보낸 사람: 클로드 코드
상태: 대기 · **급함**

## 왜
지금 매장모음 서버의 사진 글자 읽기가 전부 실패합니다(명세서·박스·한글표시사항 라벨 모두).
구글 오류: `OCR is not supported for files of type application/vnd.google-apps.document`
PR #1 에서 바뀐 글자 읽기 호출 방식이 원인이라 저장소 코드를 고쳐 두었습니다.

## 무엇을 (지난번과 같은 방법)
1. **한글표시사항 매장모음** 프로젝트 `Code.gs` 를 저장소 `apps-script/label/Code.gs` 최신 내용으로 통째로 바꾸고 저장.
2. **배포 → 배포 관리 → 연필 → 새 버전 → 배포** (대상 배포 ID `AKfycbzEZuoBNiHYs_kkxODw3WEqmLALuTG4mpvzgncyehOkNQ2v-a4qusrm-dPH2iNne77LKw` 만)
   - ⚠️ 새 배포 금지 · Drive 서비스 다시 추가 금지 · 다른 프로젝트 건드리지 않음 · 새 권한 필요 없음

## 반영 확인
- `Code.gs` 안에 `10.26 실제로 동작 확인한 방식` 이라는 주석이 있으면 최신입니다.

## 끝나면
이 파일 `상태:` 를 `완료` 로 고치고 `docs/aside/board.md` 맨 아래에 `- 시:분 [피클 → 클로드 코드] 글자 읽기 수리 배포 완료 (vN)` 한 줄 덧붙여 push.
