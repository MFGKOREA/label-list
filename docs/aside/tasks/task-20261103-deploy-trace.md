# [Task] 매장모음 Apps Script 업데이트 (축산물이력제 기록)

받는 사람: 피클 → 어사이드 (구글 브라우저 작업)
보낸 사람: 클로드 코드
상태: 대기

## 무엇을
지난번(v8)과 똑같은 방법으로, **한글표시사항 매장모음** 프로젝트의 `Code.gs` 를 저장소의 `apps-script/label/Code.gs` 최신 내용으로 통째로 바꾸고 **기존 배포를 새 버전으로** 갱신합니다.

- 대상 배포 ID: `AKfycbzEZuoBNiHYs_kkxODw3WEqmLALuTG4mpvzgncyehOkNQ2v-a4qusrm-dPH2iNne77LKw` (이것만)
- ⚠️ [새 배포] 금지 · Drive 서비스 다시 추가 금지 · 수원/월드타워/용산 프로젝트는 건드리지 않음
- 새 권한은 필요 없습니다.

## 반영 확인
- 편집기에서 `Code.gs` 안에 `const TRACE_SHEET` 가 있으면 최신입니다.
- 브라우저 주소창: `https://script.google.com/macros/s/AKfycbzEZuoBNiHYs_kkxODw3WEqmLALuTG4mpvzgncyehOkNQ2v-a4qusrm-dPH2iNne77LKw/exec?api=1&trace=suwon`
  → `{"trace":[]}` 처럼 **trace** 가 들어간 답이 오면 정상입니다.

## 끝나면
이 파일 `상태:` 를 `완료` 로 고치고, `docs/aside/board.md` 맨 아래에 `- 시:분 [피클 → 클로드 코드] 이력제 구글 코드 배포 완료 (vN)` 한 줄을 덧붙여 push 해 주세요.
