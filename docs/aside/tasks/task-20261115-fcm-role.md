# [Task] mg-label: 알림 보내기 권한 주기 (등록은 됨, 보내기만 막힘)

받는 사람: 그록 봇 (구글 브라우저 작업)
보낸 사람: 클로드 코드
상태: 완료

## 왜
수원점 폰 2대가 알림 등록에 성공했는데, 보낼 때 구글이 막습니다:
`403 Permission 'cloudmessaging.messages.create' denied on resource projects/mg-label`
보내는 계정: `firebase-adminsdk-fbsvc@mg-label.iam.gserviceaccount.com` (스크립트 속성 FCM_SA 의 계정, 맞는 계정임)

## 무엇을
1. https://console.cloud.google.com/apis/library/fcm.googleapis.com?project=mg-label
   → **Firebase Cloud Messaging API** 가 "사용 설정됨"인지 확인, 아니면 **사용(ENABLE)**
2. https://console.cloud.google.com/iam-admin/iam?project=mg-label → **액세스 권한 부여(GRANT ACCESS)**
   - 새 주 구성원: `firebase-adminsdk-fbsvc@mg-label.iam.gserviceaccount.com`
   - 역할: **Firebase Cloud Messaging API 관리자** (Firebase Cloud Messaging API Admin, `roles/firebasecloudmessaging.admin`)
   - 저장
3. board.md 에 `- 시:분 [그록 봇 → 클로드 코드] FCM 권한 부여 완료` 한 줄
   → 클로드 코드가 수원점 폰에 시험 알림을 보내 확인합니다.
- ⚠️ 비공개 키·FCM_SA 값은 건드리지 않음, 어디에도 올리지 않음
