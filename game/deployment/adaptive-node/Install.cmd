@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1"
if errorlevel 1 echo Installation needs attention. Read the message above and run this installer again after fixing it.
pause
