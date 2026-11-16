# Firebase 공개 설정 (mg-label)

확인일: 2026-11-15

웹 앱에 넣는 공개값입니다. `vapidKey`는 화면에서 읽은 값입니다. 푸시 등록이 실패하면 Firebase 콘솔 > Cloud Messaging 에서 다시 확인하세요.

```
apiKey: AIzaSyAplFZ92jTVwwgfYsOQapwStvKydxsYyQU
authDomain: mg-label.firebaseapp.com
projectId: mg-label
storageBucket: mg-label.firebasestorage.app
messagingSenderId: 121073203096
appId: 1:121073203096:web:85e2b86000e3ec1cf61ded
vapidKey: BAMhKgkSeozEpXF8uEQikje7fQvG1ATVNSdtdh-kYuJEF9Cyiue7_VxVzVK9nvk_knCmX57Vy3z9Ujqju_pTcic
```

## 배포·트리거

- MG 전체매장(매장모음) 배포를 버전 14로 갱신했다. 배포 ID는 그대로다.
- `installBackupTrigger` 로그: `백업 저장: backup-2026-11-15.json (96KB)`, `매일 새벽 3시 백업 트리거를 만들었습니다 (15일 보관)`.
- 스크립트 속성 `FCM_SA` 를 저장했다. 값은 적지 않는다.
- `installPushTrigger` 로그: `매일 아침 9시 유통기한 알림 트리거를 만들었습니다`.
- `?api=1&backups=1` 응답에 `backup-2026-11-15.json` 이 있다.
- 축산물이력제 구글 코드는 11/4에 버전 10으로 이미 반영되어 있다.
