# [Task] Google Apps Script Code.gs 업데이트 및 배포

## 작업 개요
- 목표: Google Apps Script 웹 편집기(`script.google.com`)에 최신 백엔드 코드를 반영하고 새 버전으로 배포합니다.
- 소스 파일: `apps-script/label/Code.gs` (최신 라벨 사진 학습 로그 적재 로직 포함)

## 단계별 실행 가이드
1. 브라우저에서 `https://script.google.com`에 접속합니다.
2. '한글표시사항' 프로젝트를 클릭해 엽니다.
3. 좌측 파일 목록에서 `Code.gs`를 열고, 본문 전체를 로컬의 `apps-script/label/Code.gs` 최신 내용으로 덮어씁니다.
4. `Ctrl + S` (저장)를 누릅니다.
5. 우측 상단 **[배포]** -> **[배포 관리]** -> 연필 아이콘(수정) -> 버전 드롭다운에서 **[새 버전]** 선택 -> **[배포]** 버튼을 누릅니다.
6. 완료 후 `docs/aside/reports/report-apps-script-deployed.md` 파일을 생성하여 완료 내용을 기록하고 GitHub에 push합니다.
