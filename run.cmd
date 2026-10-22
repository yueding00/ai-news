@echo off
rem == AI News daily digest - headless Claude Code run, TWO STAGES (ASCII only) ==
rem Stage 1: collect sources, write the full markdown digest only.
rem Stage 2: write push version + HTML version from stage 1 output, then self-check.
rem Split keeps each headless context small (2026-08-31 autocompact thrash).
rem 2026-09-30 (P0-1/P2-2): artifact-based success checks, explicit FAILED markers,
rem alert hook, PowerShell timestamps (no more GBK %DATE%), real exit codes.
rem 2026-09-30 (P1-2): check.ps1 quality audit after successful push (audit only,
rem never blocks delivery; failure = FAILED marker + alert, gate still sees pushed).
rem 2026-10-08 (P0-5): empty-digest sentinel D:\ai-news\empty-<date>.txt on stage 1/2
rem failure (line 'emptydigest stage=N <timestamp>'); cleared on every path that has
rem artifacts (pushfail, fail3, runok) so a leftover sentinel never misleads the gate.
rem 2026-10-09 (P1-5): stages now script-driven for speed & smaller headless context:
rem stage1 = node fetch-all.js (parallel fetch -> compact candidate list) + LLM selection;
rem stage2 = node md2html.js (md -> html + index) + LLM writes push version; Bash allowed.
rem 2026-10-15 (P1-6): skip-if-already-pushed dedupe guard + battery limits lifted +
rem extra triggers (10:30/13:30) after two missed 08:00 runs while machine was asleep.
rem 2026-10-19 (P1-7): headless claude calls now go through run-claude.ps1 wrapper with a
rem hard timeout (stage1 30min, stage2 20min). Root cause of 10-16 & 10-19 hangs: claude -p
rem stalled mid-run with zero output; wrapper kills the process tree on timeout (exit 124)
rem so the next trigger (10:30/13:30) retries cleanly.
rem 2026-10-21 (P1-8): claude CLI fully removed from the pipeline. Stage1 = fetch-all.js +
rem generate.js (direct API, 3 segments); stage2 = generate-push.js + md2html.js. Pure node
rem scripts with per-call timeouts -- no CLI sessions, no MCP bootstrap, no hang risk.
setlocal EnableExtensions
set "LOG=D:\ai-news\run.log"
set "SKILL=C:\Users\huangyicheng\.claude\skills\ai-news"
call :getstamp
set "TODAY=%SDATE%"
echo ===== %STAMP% run start ===== >> "%LOG%"
cd /d "%USERPROFILE%"

rem ---- 2026-10-15 (P1-6): dedupe guard for multi-trigger. If today already ----
rem ---- pushed (push.log has "push ok" for today), skip the whole run. ----
if not exist "D:\ai-news\push.log" goto :nodedupe
findstr /c:"%TODAY%" "D:\ai-news\push.log" | findstr /c:"push ok" >nul 2>&1
if not errorlevel 1 (
  echo ===== %STAMP% run skip (already pushed today) ===== >> "%LOG%"
  exit /b 0
)
:nodedupe

rem ---- STAGE 1: collect candidates + generate digest (pure node, no claude CLI) ----
node D:\ai-news\fetch-all.js >> "%LOG%" 2>&1
if errorlevel 1 goto :fail1
node D:\ai-news\generate.js >> "%LOG%" 2>&1
if errorlevel 1 goto :fail1
if not exist "D:\ai-news\%TODAY%.md" goto :fail1
call :checkfile "D:\ai-news\%TODAY%.md"
if errorlevel 1 goto :fail1
goto :stage1ok

:fail1
call :getstamp
echo ===== %STAMP% run FAILED (stage 1: no digest artifact) ===== >> "%LOG%"
echo emptydigest stage=1 %STAMP% > "D:\ai-news\empty-%TODAY%.txt"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SKILL%\alert.ps1" -Reason "stage 1 produced no full digest md" >> "%LOG%" 2>&1
exit /b 1

:stage1ok
rem ---- STAGE 2: push version + HTML version (pure node) ----
node D:\ai-news\generate-push.js >> "%LOG%" 2>&1
if errorlevel 1 goto :fail2
node D:\ai-news\md2html.js >> "%LOG%" 2>&1
if errorlevel 1 goto :fail2
call :checkfile "D:\ai-news\%TODAY%.push.md"
if errorlevel 1 goto :fail2
call :checkfile "D:\ai-news\html\%TODAY%.html"
if errorlevel 1 goto :fail2
goto :stage2ok

:fail2
call :getstamp
echo ===== %STAMP% run FAILED (stage 2: missing push.md or html artifact) ===== >> "%LOG%"
echo emptydigest stage=2 %STAMP% > "D:\ai-news\empty-%TODAY%.txt"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SKILL%\alert.ps1" -Reason "stage 2 produced no push.md or html" >> "%LOG%" 2>&1
exit /b 1

:stage2ok
rem ---- Insight block: internal AI gateway inserts "insight" line under the title (ASCII only) ----
powershell -NoProfile -ExecutionPolicy Bypass -File "%SKILL%\insight.ps1" >> "%LOG%" 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%SKILL%\push.ps1" >> "%LOG%" 2>&1
set "PUSHEXIT=%ERRORLEVEL%"
if not "%PUSHEXIT%"=="0" goto :pushfail
rem ---- P1-2 quality audit: runs AFTER a successful push, so a marginal-quality ----
rem ---- digest never blocks delivery. On FAIL: FAILED marker + alert; gate.ps1 ----
rem ---- ranks push.log "push ok" above run.log FAILED, so no duplicate re-push. ----
powershell -NoProfile -ExecutionPolicy Bypass -File "%SKILL%\check.ps1" -Date %TODAY% >> "%LOG%" 2>&1
if errorlevel 1 goto :fail3
goto :runok

:pushfail
call :getstamp
echo ===== %STAMP% run FAILED - push exit %PUSHEXIT% ===== >> "%LOG%"
if exist "D:\ai-news\empty-%TODAY%.txt" del "D:\ai-news\empty-%TODAY%.txt"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SKILL%\alert.ps1" -Reason "push.ps1 failed with exit %PUSHEXIT%" >> "%LOG%" 2>&1
exit /b 1

:fail3
call :getstamp
echo ===== %STAMP% run FAILED (quality check) ===== >> "%LOG%"
if exist "D:\ai-news\empty-%TODAY%.txt" del "D:\ai-news\empty-%TODAY%.txt"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SKILL%\alert.ps1" -Reason "quality check failed on stage 2 artifacts" >> "%LOG%" 2>&1
exit /b 1

:runok
call :getstamp
echo ===== %STAMP% run end (exit 0) ===== >> "%LOG%"
if exist "D:\ai-news\empty-%TODAY%.txt" del "D:\ai-news\empty-%TODAY%.txt"
exit /b 0

rem ---- subroutines ----
:getstamp
rem locale-safe timestamps via PowerShell (cmd %DATE% leaks GBK weekday chars)
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "SDATE=%%i"
for /f %%j in ('powershell -NoProfile -Command "Get-Date -Format HH:mm:ss"') do set "STIME=%%j"
set "STAMP=%SDATE% %STIME%"
exit /b 0

:checkfile
rem %~1 = path; errorlevel 1 when missing or <= 1024 bytes
if not exist "%~1" exit /b 1
for %%A in ("%~1") do if %%~zA LEQ 1024 exit /b 1
exit /b 0
