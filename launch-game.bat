@echo off
setlocal EnableExtensions

REM Compute a deterministic date-based port:
REM port = 10000 + (yyyyMMdd mod 50000)
for /f %%I in ('powershell -NoProfile -Command "(Get-Date).ToString('yyyyMMdd')"') do set TODAY=%%I
set /a PORT=10000 + (%TODAY% %% 50000)

echo.
echo Launching WorkoutEveryMorning on http://localhost:%PORT%
echo (Date key: %TODAY%, Port: %PORT%)
echo.

REM Open browser first so it is ready once server starts.
start "" "http://localhost:%PORT%"

REM Prefer py launcher, then python.
where py >nul 2>&1
if %ERRORLEVEL%==0 (
    py -m http.server %PORT%
    goto :eof
)

where python >nul 2>&1
if %ERRORLEVEL%==0 (
    python -m http.server %PORT%
    goto :eof
)

echo Python was not found on PATH.
echo Install Python, then run this file again.
pause
