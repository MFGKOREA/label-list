# 발주 GW 자동연동 설치 (매장 PC에서 install.bat 더블클릭 한 번)
#  1) PC 켜면 크롬이 창 없이 켜짐 (시작프로그램 바로 가기)
#  2) 지킴이: 누가 크롬을 꺼도 5초 안에 다시 켬 (시작프로그램 + 지금 바로 실행)
#  3) 절전 안 함 (전원 연결 시)
#  4) 크롬 "닫혀도 백그라운드 앱 계속 실행" 켜기 (관리자 확인 창에서 [예])
$ErrorActionPreference = "Continue"
$dir = $PSScriptRoot
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$startup = [Environment]::GetFolderPath("Startup")
$sh = New-Object -ComObject WScript.Shell
function Ok($m) { Write-Host ("  [OK] " + $m) -ForegroundColor Green }
function Bad($m) { Write-Host ("  [!!] " + $m) -ForegroundColor Yellow }
Write-Host ""
Write-Host "발주 GW 자동연동 설치" -ForegroundColor Cyan
Write-Host ""
if (-not $chrome) { Bad "크롬을 못 찾았어요. 크롬을 먼저 설치해 주세요."; Read-Host "엔터를 누르면 닫혀요"; exit }

# 1) 크롬 자동 실행
$l = $sh.CreateShortcut((Join-Path $startup "발주 자동입력.lnk")); $l.TargetPath = $chrome; $l.Arguments = "--no-startup-window"; $l.Save()
Ok "PC 켜면 크롬 자동 실행"

# 2) 지킴이
$l = $sh.CreateShortcut((Join-Path $startup "발주 지킴이.lnk")); $l.TargetPath = "wscript.exe"; $l.Arguments = '"' + (Join-Path $dir "gw-watch.vbs") + '"'; $l.WorkingDirectory = $dir; $l.Save()
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*gw-watch.ps1*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Process "wscript.exe" -ArgumentList ('"' + (Join-Path $dir "gw-watch.vbs") + '"')
Ok "지킴이 켬 (누가 크롬을 꺼도 다시 켜요) · 기록: gw-watch.log"

# 3) 절전 안 함
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
Ok "절전 안 함 (화면 꺼짐은 그대로)"

# 4) 크롬 백그라운드 계속 실행 (정책, 관리자 권한 필요)
try {
  $cmd = "New-Item -Path 'HKLM:\SOFTWARE\Policies\Google\Chrome' -Force | Out-Null; Set-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Google\Chrome' -Name BackgroundModeEnabled -Value 1 -Type DWord"
  $p = Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @("-NoProfile", "-Command", $cmd)
  if ($p.ExitCode -eq 0) { Ok "크롬이 닫혀도 백그라운드 계속 실행 (시계 옆 크롬 아이콘)" } else { throw "x" }
} catch { Bad "관리자 확인을 안 눌렀어요 → 크롬 설정 → 시스템 → 'Chrome이 닫혀도 백그라운드 앱 계속 실행'을 직접 켜 주세요" }

Write-Host ""
Write-Host "끝! 크롬을 한 번 완전히 닫았다가(시계 옆 크롬 아이콘 → 종료) 5~20초 기다리면 다시 켜져요." -ForegroundColor Cyan
Write-Host "확인: 폰 발주앱에서 Gross 불러오기 → PC가 10초 안에 반응하면 성공"
Write-Host ""
Read-Host "엔터를 누르면 닫혀요"
