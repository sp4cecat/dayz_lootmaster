@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ========================================
echo   Lootmaster Launcher
echo ========================================
echo   1. Staging
echo   2. Production
echo ========================================
echo.

set "APP_ENV="
set /p "CHOICE=Select environment [1-2]: "

if "%CHOICE%"=="1" set "APP_ENV=staging"
if "%CHOICE%"=="2" set "APP_ENV=production"

if not defined APP_ENV (
    echo.
    echo Invalid choice "%CHOICE%". Please run again and pick 1 or 2.
    echo.
    pause
    exit /b 1
)

echo.
echo Launching Lootmaster [%APP_ENV%]...
echo   Server -^> http://localhost:4317
echo   Client -^> http://localhost:4173  (vite preview)
echo.

REM --- Backend API server (binds all interfaces on port 4317) ---
start "Lootmaster Server [%APP_ENV%]" cmd /k "set NODE_ENV=%APP_ENV%&& node server/index.js"

REM --- Client: build dist/ then serve via vite preview (--host = reachable on LAN) ---
start "Lootmaster Client [%APP_ENV%]" cmd /k "set NODE_ENV=%APP_ENV%&& npm run build && npm run preview -- --host"

echo Both windows launched. Close them to stop the servers.
echo.
endlocal
