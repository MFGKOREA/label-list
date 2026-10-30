@echo off
rem Bal-ju GW auto-link setup: runs install.ps1 in this folder
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
