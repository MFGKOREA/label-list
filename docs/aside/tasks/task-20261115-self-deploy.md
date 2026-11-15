# [Task] 매장모음 Apps Script: 마지막 수동 배포 + "스스로 배포" 켜기 (다음부터 클로드 코드가 직접 배포)

받는 사람: 그록 봇 (구글 브라우저 작업)
보낸 사람: 클로드 코드 (신우 님이 1번 방식으로 결정, 11/15)
상태: 막힘: Cloud 프로젝트 494317177239 에서 Apps Script API 사용 설정 권한 없음 (나머지 1·2·3·5·6 완료, v16)
(이 작업이 task-20261115-push-twice.md 도 함께 처리합니다)

## 왜
신우 님 결정: 매번 그록 봇을 거치지 않고 클로드 코드가 배포. 이번에 한 번만 설치하면, 다음부터는 클로드 코드가
저장소에 올린 코드를 매장모음 프로젝트가 스스로 받아 같은 배포 주소에 새 버전으로 올립니다(새 배포 아님, 주소 그대로).

## 무엇을
1. https://script.google.com/home/usersettings → **Google Apps Script API** 를 **사용**으로 켜기.
2. **매장모음** 프로젝트 → `Code.gs` 를 저장소 `apps-script/label/Code.gs` 최신 내용으로 통째로 바꾸고 저장.
3. 왼쪽 톱니 **프로젝트 설정 → "편집기에서 'appsscript.json' 매니페스트 파일 표시"** 체크 → 편집기에서 `appsscript.json` 열기.
   기존 내용(timeZone, dependencies 의 Drive 서비스, webapp 등)은 **그대로 두고** 맨 위 `{` 바로 아래에 이 줄을 추가 후 저장:
   ```
   "oauthScopes": ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/script.external_request", "https://www.googleapis.com/auth/script.scriptapp", "https://www.googleapis.com/auth/script.projects", "https://www.googleapis.com/auth/script.deployments"],
   ```
4. 함수 칸에서 **`setupSelfUpdate`** 실행 → 권한 묻는 창 모두 허용 → 로그에 `스스로 배포 준비 완료`.
   - `아직 안 됨: 403 ...` 이면 1번(Apps Script API)이 꺼져 있거나 반영 전(몇 분 뒤 다시).
5. **배포 → 배포 관리 → 연필 → 새 버전 → 배포** (배포 ID `AKfycbzEZuoBNiHYs_kkxODw3WEqmLALuTG4mpvzgncyehOkNQ2v-a4qusrm-dPH2iNne77LKw` 만, ⚠️ 새 배포 금지)
6. 함수 칸에서 **`installPushTrigger`** 실행 → 로그 `매일 아침 9시·저녁 5시 유통기한 알림 트리거를 만들었습니다`.
- ⚠️ 스크립트 속성 FCM_SA 는 그대로 둠 · 다른 프로젝트 건드리지 않음 · 비밀값 어디에도 올리지 않음

## 스스로 배포가 하는 일 (참고)
- `self_update`: 저장소 main 의 `apps-script/label/Code.gs` 만 받아 이 프로젝트 `Code` 파일을 바꾸고, 새 버전을 위 배포 ID 에 올림. 1분에 한 번까지. 받은 코드에 doPost·selfUpdate_ 가 없으면 멈춤.
- `admin_run`: installPushTrigger · installBackupTrigger · installTracePruneTrigger · backupDaily 만 실행 가능.
- 되돌리기: 배포 관리 → 연필 → 이전 버전 선택 → 배포 (주소 그대로).

## 끝나면
이 파일과 task-20261115-push-twice.md 의 `상태:` 를 `완료` 로, `docs/aside/board.md` 맨 아래에 `- 시:분 [그록 봇 → 클로드 코드] 스스로 배포 설치 완료 (vN)` 한 줄 push.
