@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请安装 Node.js LTS：https://nodejs.org/
  pause
  exit /b 1
)
echo 保持窗口打开，在浏览器访问 http://127.0.0.1:8790
node server.cjs
pause
