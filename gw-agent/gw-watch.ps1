# 발주 GW 자동연동 지킴이 (윈도우, 창 없이 돎)
#  크롬이 꺼져 있으면 창 없이 다시 켬 → 시계 옆(트레이)에 크롬이 떠 있고 확장(발주 GW 자동연동)이 계속 돎 (10/31 KM: 누가 꺼도 다시 켜지게)
#  크롬 설정 "Chrome이 닫혀도 백그라운드 앱 계속 실행"이 꺼져 있으면 창 없는 크롬이 바로 닫히므로, 켜도 안 남으면 5분 쉬었다 다시 (무한 반복 방지)
#  시트는 안 읽음. 5초마다 크롬이 있는지만 봄
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$log = Join-Path $PSScriptRoot "gw-watch.log"
function Note($m) { "$(Get-Date -Format 'MM-dd HH:mm:ss') $m" | Out-File -FilePath $log -Append -Encoding utf8 }
Note "지킴이 시작 · 크롬: $chrome"
if (-not $chrome) { Note "크롬을 못 찾음 → 지킴이 끝"; exit }
$fails = 0
while ($true) {
  try {
    if (-not (Get-Process chrome -ErrorAction SilentlyContinue)) {
      Start-Process -FilePath $chrome -ArgumentList "--no-startup-window"
      Start-Sleep -Seconds 20
      if (Get-Process chrome -ErrorAction SilentlyContinue) { Note "크롬 꺼짐 → 다시 켬"; $fails = 0 }
      else {
        $fails++
        Note "크롬을 켰는데 바로 닫힘 ($fails번째) · 크롬 설정 → 시스템 → 'Chrome이 닫혀도 백그라운드 앱 계속 실행'을 켜 주세요"
        Start-Sleep -Seconds 300
      }
    }
  } catch { }
  Start-Sleep -Seconds 5
}
