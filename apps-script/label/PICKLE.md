# 피클 작업 지시서: 구글 Apps Script 반영

한글표시사항 리스트 앱의 구글 코드(백엔드)를 바꿀 때 이 문서대로 해 주세요.
코드의 기준(원본)은 이 저장소의 `apps-script/label/Code.gs` 입니다. 구글 쪽 코드를 이 파일과 똑같이 맞추면 됩니다.

## 대상 프로젝트

| 이름 | 웹 앱 주소(배포 ID) | 이번에 바꿀지 |
|---|---|---|
| 한글표시사항 **매장모음** | `AKfycbzEZuoBNiHYs_kkxODw3WEqmLALuTG4mpvzgncyehOkNQ2v-a4qusrm-dPH2iNne77LKw` | **바꿈** |
| 수원(컨벤션) | `AKfycbyPJbVBORKgT-X7ZzyROdnLtK1zRMxPhNPBEqo_UNX2usdGy6YavPyWAduqwdNsaFo` | 따로 요청할 때만 |
| 월드타워 | `AKfycbzxRVdyf02wbFZVRRif34GJXUZl70hoebw8__46aoyfr_lvZQT-1N_76H6prSpHdgnH` | 따로 요청할 때만 |
| 용산 | `AKfycbzs4LFJo3Tau13KojH6dUZpyRvdRJXM2BEJWndv8Kc0u8fihga-F3iQSGofaWgut-oWrg` | 따로 요청할 때만 |

## 순서

1. 매장모음 프로젝트의 `Code.gs` 내용을 저장소의 `apps-script/label/Code.gs` 로 통째로 바꿉니다.
   - 다른 파일(`Index.html`, `appsscript.json`)은 건드리지 않습니다.
   - 고급 서비스 **Drive API** 는 이미 추가돼 있습니다. 다시 추가하지 마세요(중복 오류가 납니다).
2. **기존 배포를 새 버전으로 갱신**합니다. (배포 관리 → 위 배포 ID → 새 버전)
   - **새 배포를 만들면 안 됩니다.** 주소가 바뀌어 39개 매장 앱이 끊깁니다.
   - 실행 사용자: 나(소유자), 액세스: 모든 사용자 — 그대로 둡니다.
3. 새 권한이 필요하다는 안내가 나오면 `setup` 함수를 한 번 실행해 승인합니다.

## 확인 (반영 후)

웹 앱 주소: `https://script.google.com/macros/s/<배포 ID>/exec`

| 확인 | 요청 | 정상 응답 |
|---|---|---|
| 기본 동작 | `GET ?api=1&stats=1` | `{"counts":{...},"online":{...}}` |
| 사진 목록 | `GET ?api=1&photos=suwon` | `{...}` (빈 객체도 정상) |
| 품목 이름 목록 | `GET ?api=1&catalog=1` | `{...}` |
| 학습 기록 | `POST {"action":"learn","store":"zztest","id":"t1","name":"시험","text":"피클 시험 문구"}` (Content-Type `text/plain`) | `{"ok":true}` |

학습 확인으로 넣은 시험 줄은 매장모음 시트 `학습` 탭에서 지워 주세요(store 가 `zztest` 인 줄).

## 이번 변경 내용 (2026-10-26)

- 라벨 사진 글자 + 대표 색으로 품목 추천(`suggest_`), 저장할 때 학습 기록 쌓기(`learn_`, `학습` 탭)
- 학습 기록을 캐시에 나눠 담아 빠르게(`CHUNK`)
- 흔한 글자(기록의 30% 넘게 나오는 글자)만 겹치면 추천 안 함
- 반영됐는지는 코드 안에 `const CHUNK` 가 있는지로 알 수 있습니다.
