---
name: domain-ssl-sentry
description: Gabia Domain & SSL Health Sentry - sinoowebsite.com 도메인 만기일, DNS 레코드(CNAME·A), GitHub Pages 연동 헬스체크와 HTTPS 인증서 자동 갱신 상태를 진단한다. 도메인 만기 확인, 사이트 접속 오류 원인 파악, DNS/배포 문제 디버깅 시 사용한다.
metadata:
  domain: domain-infra
  target: label-list (sinoowebsite.com, GitHub Pages 배포)
---

# 🌐 Gabia Domain & SSL Health Sentry

sinoowebsite.com(Gabia 등록)의 도메인 만기일, DNS 레코드, GitHub Pages 연동,
HTTPS 인증서 상태를 주기적으로 점검하는 스킬.

## 1. 언제 이 스킬을 쓰나

- 사이트 접속 오류/인증서 경고 보고가 들어올 때
- 도메인 만기가 얼마 남지 않았는지 확인해야 할 때
- GitHub Pages 배포 후 커스텀 도메인이 안 붙을 때
- 정기 건강 점검(만기·DNS·HTTPS) 리포트가 필요할 때

## 2. 점검 아키텍처

```
[1] WHOIS/등록정보 ── 만기일 D-60/30/7 경고
[2] DNS 레코드 ──────── A(185.199.108-111.153), CNAME(www→user.github.io), GitHub Pages 검증 TXT
[3] GitHub Pages ────── CNAME 파일, Pages 빌드 상태, 커스텀 도메인 등록 여부
[4] HTTPS 인증서 ────── Let's Encrypt 자동 갱신 상태, 만기일, 인증서 체인
[5] 실접속 체크 ─────── https://sinoowebsite.com 200 응답, 최종 URL, 리다이렉트 경로
```

## 3. 점검 방법 (환경 명령어 기반)

```bash
# [1] 등록/만기 (Gabia 도메인은 WHOIS에서 만기일 확인)
whois sinoowebsite.com | grep -iE "expir|registrar:"

# [2] DNS 레코드
dig +short sinoowebsite.com A           # GitHub Pages: 185.199.108.153 / .109 / .110 / .111
dig +short www.sinoowebsite.com CNAME   # sinu6(또는 소유계정).github.io 형태
dig +short _github-pages-challenge-sinu6.sinoowebsite.com TXT   # 도메인 검증 TXT

# [3] HTTPS 인증서 상태
echo | openssl s_client -servername sinoowebsite.com -connect sinoowebsite.com:443 2>/dev/null \
  | openssl x509 -noout -issuer -dates
# issuer가 "DigiCert... (Let's Encrypt)" 계열 + notAfter 90일 이내 = GitHub Pages 자동갱신 정상

# [4] 실접속
curl -sS -o /dev/null -w "%{http_code} %{url_effective}\n" -L https://sinoowebsite.com
```

## 4. 판정 기준

| 항목 | 정상 | 경고 | 즉시 조치 |
|---|---|---|---|
| 도메인 만기 | D-30 이상 | D-30 미만 | D-7 미만 — 갱신 요청 (Gabia는 등록자 본인만 결제 가능 → 사용자 안내) |
| A 레코드 | 185.199.108~111.153 4개 | 일부 누락 | 전부 다름 — DNS 설정 화면 확인 필요 |
| www CNAME | `<계정>.github.io` | 없음 | www 접속 실패로 이어짐 |
| 인증서 notAfter | 30일 이상 | 30일 미만 | 갱신 실패 가능성 — Pages 설정 재확인 |
| 실접속 | 200 | 301/302 경로 확인 | 5xx/경고 — 원인 추적 |

## 5. GitHub Pages 연동 체크

- 저장소 `Settings → Pages`에 커스텀 도메인 등록 + DNS 검증(verify TXT) 완료 상태.
- 저장소 루트의 `CNAME` 파일 내용이 커스텀 도메인과 일치하는지 (이 저장소 배포 대상이면 확인).
- 배포 브랜치(main) 최신 커밋이 반영됐는지 — Pages 빌드는 수 분 지연 가능.
- **인증서는 GitHub Pages가 Let's Encrypt로 자동 발급/갱신**한다. 수동 갱신 불필요하나,
  DNS가 옮겨지거나 CNAME 파일이 사라지면 갱신 실패 → 재발급까지 수 시간 소요.

## 6. 장애 원인 추적 순서

1. 실접속 실패 → `dig`로 DNS 먼저 (DNS 만료/보류(pendingDelete) 여부)
2. DNS 정상 → 인증서 확인 (만료·도메인 불일치)
3. 인증서 정상 → Pages 빌드 상태/최근 배포 확인
4. 전부 정상 → 앱 쪽 캐시 문제 가능성 (`pwa-offline-vault`의 SW 캐시 정책 점검)

## 7. 엣지 케이스 방어책

- [ ] 도메인 갱신·결제는 사용자만 할 수 있음 — 이 스킬은 확인/알림까지만, 갱신 요청을 사용자에게 명확히 전달
- [ ] WHOIS 개인정보 보호 서비스로 만기일이 가려지면 Gabia 로그인 필요 → 사용자 안내
- [ ] DNS TTL(최대 수 시간)로 변경 반영 지연을 장애로 오인하지 않는다 — 변경 후 최소 TTL만큼 대기 후 재점검
- [ ] `dig`가 실패하면 공개 DNS(8.8.8.8, 1.1.1.1)로 재시도 — 로컬 캐시 오염 배제
- [ ] 인증서 경고 스크린샷 보고는 실제 오류 문구를 그대로 수록 (해석으로 대체하지 않음)
- [ ] 정기 점검 결과는 날짜와 함께 기록해 추세(점점 임박해지는 만기)를 볼 수 있게 한다

## 8. 클로드 코드 체크리스트

1. [ ] 만기일을 실제 WHOIS/등록 정보로 확인했다 (추정 금지)
2. [ ] DNS 레코드를 dig로 실측했다
3. [ ] 인증서 issuer/notAfter를 실측했다
4. [ ] 실접속 HTTP 상태와 최종 URL을 확인했다
5. [ ] 사용자가 직접 해야 할 일(갱신 결제, Gabia 로그인)은 명확히 구분해 안내했다
6. [ ] 점검 일시를 리포트에 명시했다
