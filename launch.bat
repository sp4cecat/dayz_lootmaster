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

REM --- Production: if already running, offer restart / update instead of a second launch ---
if /I "%APP_ENV%"=="production" (
    call :is_running
    if defined RUNNING goto production_running
)

echo.
echo Launching Lootmaster [%APP_ENV%]...
echo   Server -^> http://localhost:4317
echo   Client -^> http://localhost:4173  (vite preview)
echo.

call :launch_full

echo Both windows launched. Close them to stop the servers.
echo.
goto end

:production_running
echo.
echo ========================================
echo   Production is already running (port 4317).
echo ========================================
echo   1. Restart (relaunch with current build)
echo   2. Git pull, install, build ^& restart
echo   3. Cancel
echo ========================================
echo.

set "ACTION="
set /p "ACTION=Select action [1-3]: "

if "%ACTION%"=="1" goto do_restart
if "%ACTION%"=="2" goto do_update
if "%ACTION%"=="3" (
    echo.
    echo Cancelled. Production left running.
    echo.
    goto end
)

echo.
echo Invalid choice "%ACTION%". Please run again and pick 1, 2 or 3.
echo.
pause
exit /b 1

:do_restart
echo.
echo Restarting Lootmaster [%APP_ENV%] with the current build...
echo.
call :stop_all
call :wait_for_free
call :launch_prebuilt
echo Restart complete. Server -^> http://localhost:4317  Client -^> http://localhost:4173
echo.
goto end

:do_update
echo.
echo Pulling latest changes...
git pull
if errorlevel 1 (
    echo.
    echo git pull failed. Production left running untouched.
    echo.
    pause
    exit /b 1
)

echo.
echo Installing dependencies...
call npm install
if errorlevel 1 (
    echo.
    echo npm install failed. Production left running untouched.
    echo.
    pause
    exit /b 1
)

echo.
echo Building client...
call npm run build
if errorlevel 1 (
    echo.
    echo Build failed. Production left running untouched.
    echo.
    pause
    exit /b 1
)

echo.
echo Build succeeded. Restarting Lootmaster [%APP_ENV%]...
echo.
call :stop_all
call :wait_for_free
call :launch_prebuilt
echo Update complete. Server -^> http://localhost:4317  Client -^> http://localhost:4173
echo.
goto end

REM ============================================================
REM  Subroutines
REM ============================================================

:is_running
set "RUNNING="
netstat -ano | findstr /C:":4317 " | findstr /I "LISTENING" >nul 2>&1 && set "RUNNING=1"
exit /b

:stop_all
REM Close our own windows (best-effort; the client title may not match after npm/vite run)
taskkill /F /T /FI "WINDOWTITLE eq Lootmaster Server [%APP_ENV%]*" >nul 2>&1
taskkill /F /T /FI "WINDOWTITLE eq Lootmaster Client [%APP_ENV%]*" >nul 2>&1
REM Guarantee the ports are freed regardless of window title
call :kill_port 4317
call :kill_port 4173
exit /b

REM Kill whatever process is LISTENING on the given port (arg 1), plus its child tree
:kill_port
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /C:":%~1 " ^| findstr /I "LISTENING"') do taskkill /F /T /PID %%p >nul 2>&1
exit /b

REM Poll until both 4317 and 4173 are free before relaunching (~15s cap)
:wait_for_free
set /a _tries=0
:wff_loop
set "_busy="
netstat -ano | findstr /C:":4317 " | findstr /I "LISTENING" >nul 2>&1 && set "_busy=1"
netstat -ano | findstr /C:":4173 " | findstr /I "LISTENING" >nul 2>&1 && set "_busy=1"
if not defined _busy exit /b 0
set /a _tries+=1
if %_tries% GEQ 15 (
    echo   Warning: ports still busy after 15s; continuing anyway.
    exit /b 1
)
timeout /t 1 /nobreak >nul
goto wff_loop

REM Fresh launch: client builds then previews (port pinned so it never silently drifts)
:launch_full
start "Lootmaster Server [%APP_ENV%]" cmd /k "set NODE_ENV=%APP_ENV%&& node server/index.js"
start "Lootmaster Client [%APP_ENV%]" cmd /k "set NODE_ENV=%APP_ENV%&& npm run build && npm run preview -- --host --port 4173 --strictPort"
exit /b

REM Restart / post-build relaunch: preview only, no rebuild (port pinned)
:launch_prebuilt
start "Lootmaster Server [%APP_ENV%]" cmd /k "set NODE_ENV=%APP_ENV%&& node server/index.js"
start "Lootmaster Client [%APP_ENV%]" cmd /k "set NODE_ENV=%APP_ENV%&& npm run preview -- --host --port 4173 --strictPort"
exit /b

:end
endlocal
