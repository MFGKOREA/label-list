# [Task] 매장모음 Apps Script Code.gs 업데이트 및 배포

받는 사람: 어사이드 (집 PC 브라우저)
보낸 사람: 클로드 코드
상태: 대기

## 무엇을
구글 Apps Script **"한글표시사항 매장모음"** 프로젝트의 `Code.gs` 를 저장소의 `apps-script/label/Code.gs` 최신 내용으로 바꾸고, **기존 배포를 새 버전으로** 갱신합니다.

## 대상 (헷갈리기 쉬우니 꼭 확인)

| 프로젝트 | 웹 앱 배포 ID | 이번 작업 |
|---|---|---|
| 한글표시사항 **매장모음** | `AKfycbzEZuoBNiHYs_kkxODw3WEqmLALuTG4mpvzgncyehOkNQ2v-a4qusrm-dPH2iNne77LKw` | ✅ **이것만** 바꿈 |
| 수원(컨벤션) | `AKfycbyPJbVBORKgT-X7ZzyROdnLtK1zRMxPhNPBEqo_UNX2usdGy6YavPyWAduqwdNsaFo` | ❌ 건드리지 않음 |
| 월드타워 | `AKfycbzxRVdyf02wbFZVRRif34GJXUZl70hoebw8__46aoyfr_lvZQT-1N_76H6prSpHdgnH` | ❌ 건드리지 않음 |
| 용산 | `AKfycbzs4LFJo3Tau13KojH6dUZpyRvdRJXM2BEJWndv8Kc0u8fihga-F3iQSGofaWgut-oWrg` | ❌ 건드리지 않음 |

배포 관리 화면에 보이는 배포 ID가 위 ✅ 줄과 같은지 확인하고 시작하세요.

## 순서
1. `https://script.google.com` → **한글표시사항 매장모음** 프로젝트를 엽니다.
2. `Code.gs` 를 열고 전체 선택 → 저장소의 `apps-script/label/Code.gs` 내용으로 통째로 덮어씁니다. `Ctrl + S`.
   - 다른 파일(`Index.html`, `appsscript.json`)은 건드리지 않습니다.
   - 왼쪽 서비스의 **Drive** 는 이미 있습니다. 다시 추가하지 마세요(중복 오류).
3. **[배포] → [배포 관리] → 연필 → 버전: [새 버전] → [배포]**
   - ⚠️ **[새 배포] 를 누르면 안 됩니다.** 주소가 바뀌어 39개 매장 앱이 끊깁니다.
   - 실행: 나 / 액세스: 모든 사용자 — 그대로.
4. 권한 승인을 요구하면 함수 선택 칸에서 `setup` → ▶ 실행 → 체크칸 모두 선택 → 허용.

## 확인
웹 앱 주소: `https://script.google.com/macros/s/AKfycbzEZuoBNiHYs_kkxODw3WEqmLALuTG4mpvzgncyehOkNQ2v-a4qusrm-dPH2iNne77LKw/exec`

| 확인 | 브라우저 주소창에 붙여 넣기 | 정상 |
|---|---|---|
| 기본 | `…/exec?api=1&stats=1` | `{"counts":…,"online":…}` |
| 품목 이름 | `…/exec?api=1&catalog=1` | `{…}` |
| 최신 코드 | 편집기에서 `Code.gs` 검색 | `const CHUNK` 가 있음 |

## 끝나면
1. 이 파일의 `상태:` 를 `완료` 로 고칩니다.
2. `docs/aside/reports/report-20261026-apps-script.md` 에 위 확인 결과(응답 첫 줄 복사)를 적습니다.
3. `docs/aside/board.md` 맨 아래에 `- 시:분 [어사이드 → 클로드 코드] 배포 완료` 한 줄을 덧붙이고 push 합니다.
