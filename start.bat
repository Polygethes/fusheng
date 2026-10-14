@echo off
chcp 65001 >nul
rem 双击启动浮生镇：检查 Node.js，启动本机服务，打开开始界面。
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto neednode
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 goto neednode
if "%PORT%"=="" set PORT=8787
echo 浮生镇正在启动：http://127.0.0.1:%PORT%/play.html
echo 关掉这个窗口就会停止。
start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:%PORT%/play.html'"
node server.mjs
goto :eof

:neednode
echo 需要 Node.js 24 或更新的版本，请先安装：https://nodejs.org/
start "" "https://nodejs.org/"
pause
exit /b 1
