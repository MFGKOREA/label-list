# 발주 GW 자동연동 지킴이 (윈도우, 창 없이 돎)
#  크롬이 완전히 꺼져 있어도 폰 발주앱에서 [GW 전송]·[Gross 불러오기]를 누르면 크롬을 창 없이 켬
#  → 크롬이 켜지면 확장(발주 GW 자동연동)이 GW·MIS를 열어 처리. 크롬이 켜져 있을 땐 아무것도 안 함
#  시트는 읽기만 함. 5초마다 확인 (크롬이 꺼져 있을 때만 시트를 읽음)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12  # 구글은 TLS 1.2 필요 (옛 윈도우 파워셸 기본값 대비)
$API = "https://script.google.com/macros/s/AKfycbw56Q_Q3m0ZyZSHlAlRru2MZZ4-Lqj4tvfXFOfhH_YLi4HOiLn9Cj2yEbARK9LTk00t5Q/exec"
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$log = Join-Path $PSScriptRoot "gw-watch.log"
function Note($m) { "$(Get-Date -Format 'MM-dd HH:mm:ss') $m" | Out-File -FilePath $log -Append -Encoding utf8 }
Note "지킴이 시작 · 크롬: $chrome"
while ($true) {
  try {
    if (-not (Get-Process chrome -ErrorAction SilentlyContinue)) {
      # 시트 전체를 JSON으로 풀면 대소문자만 다른 키 때문에 실패할 수 있어서, 필요한 두 칸만 글자로 잘라 읽음
      $raw = (Invoke-WebRequest -Uri ($API + "?api=1&status=1&t=" + [DateTimeOffset]::Now.ToUnixTimeMilliseconds()) -UseBasicParsing -TimeoutSec 20).Content  # 새 시트면 전송 상태만(키 필요 없음), 옛 시트면 전체
      $pick = { param($k) $m = [regex]::Match($raw, '"' + $k + '":(\{[^{}]*\})'); if ($m.Success) { $m.Groups[1].Value | ConvertFrom-Json } else { $null } }
      $today = (Get-Date).ToString("yyyy-MM-dd")
      $now = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
      $p = & $pick "misPush"; $s = & $pick "salesPush"
      $order = $p -and $p.date -eq $today -and $p.status -eq "pending"
      $sales = $s -and $s.status -eq "pending" -and ($now - [int64]$s.at) -lt 1800000
      if (($order -or $sales) -and $chrome) {
        Start-Process -FilePath $chrome -ArgumentList "--no-startup-window"
        Note ("크롬 켬 · " + $(if ($order) { "GW 전송" } else { "Gross 불러오기" }))
        Start-Sleep -Seconds 30
      }
    }
  } catch { }
  Start-Sleep -Seconds 5
}
