# 발주 GW 자동연동 지킴이 (윈도우, 창 없이 돎)
#  1) 크롬이 꺼져 있으면 창 없이 다시 켬 → 시계 옆(트레이)에 크롬이 남아 확장이 계속 돎 (10/31 KM: 누가 꺼도 다시 켜지게)
#  2) 폰에서 [GW 전송]·[Gross 불러오기]를 누르면 크롬이 꺼져 있을 때 바로(5초 안) 켬 (10/31 KM: 버튼 누르면 켜지게)
#     창 없는 크롬이 바로 닫히는 PC(백그라운드 설정 꺼짐)도 있어서, 버튼으로 켤 땐 최소화된 창으로 켬 → 확장이 처리
#  창 없이 켰는데 바로 닫히면 5분 동안은 1)을 쉬지만 2)는 계속 봄
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12  # 구글은 TLS 1.2 필요 (옛 윈도우 파워셸 기본값 대비)
$API = "https://script.google.com/macros/s/AKfycbw56Q_Q3m0ZyZSHlAlRru2MZZ4-Lqj4tvfXFOfhH_YLi4HOiLn9Cj2yEbARK9LTk00t5Q/exec"
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$log = Join-Path $PSScriptRoot "gw-watch.log"
function Note($m) { "$(Get-Date -Format 'MM-dd HH:mm:ss') $m" | Out-File -FilePath $log -Append -Encoding utf8 }
function Alive { [bool](Get-Process chrome -ErrorAction SilentlyContinue) }
Note "지킴이 시작 · 크롬: $chrome"
if (-not $chrome) { Note "크롬을 못 찾음 → 지킴이 끝"; exit }
$restUntil = [DateTime]::MinValue; $fails = 0; $handled = ""
while ($true) {
  try {
    if (-not (Alive)) {
      # 2) 폰 버튼: 시트에서 전송 상태만 읽음 (필요한 두 칸만 글자로 잘라 읽음)
      $raw = (Invoke-WebRequest -Uri ($API + "?api=1&status=1&t=" + [DateTimeOffset]::Now.ToUnixTimeMilliseconds()) -UseBasicParsing -TimeoutSec 20).Content
      $pick = { param($k) $m = [regex]::Match($raw, '"' + $k + '":(\{[^{}]*\})'); if ($m.Success) { $m.Groups[1].Value | ConvertFrom-Json } else { $null } }
      $today = (Get-Date).ToString("yyyy-MM-dd")
      $now = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
      $p = & $pick "misPush"; $s = & $pick "salesPush"
      $order = $p -and $p.date -eq $today -and $p.status -eq "pending"
      $sales = $s -and $s.status -eq "pending" -and ($now - [int64]$s.at) -lt 1800000
      $id = if ($order) { "o" + $p.id } elseif ($sales) { "s" + $s.id } else { "" }
      if ($id -and $id -ne $handled) {
        Start-Process -FilePath $chrome -ArgumentList "about:blank" -WindowStyle Minimized
        $handled = $id
        Note ("폰 버튼 → 크롬 켬 · " + $(if ($order) { "GW 전송" } else { "Gross 불러오기" }))
        Start-Sleep -Seconds 30
      } elseif ((Get-Date) -gt $restUntil) {
        # 1) 항상 켜 두기 (쉬는 중이 아니면)
        Start-Process -FilePath $chrome -ArgumentList "--no-startup-window"
        Start-Sleep -Seconds 20
        if (Alive) { Note "크롬 꺼짐 → 다시 켬"; $fails = 0 }
        else {
          $fails++; $restUntil = (Get-Date).AddMinutes(5)
          Note "크롬을 켰는데 바로 닫힘 ($fails번째) · 크롬 설정 → 시스템 → 'Chrome이 닫혀도 백그라운드 앱 계속 실행'을 켜 주세요 (그동안 폰 버튼으론 켜져요)"
        }
      }
    }
  } catch { }
  Start-Sleep -Seconds 5
}
