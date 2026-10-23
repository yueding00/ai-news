@echo off
rem == AI News daily digest - 2026-10-23: all logic lives in run-daily.js (pure node). ==
rem This wrapper exists only so Task Scheduler can launch the pipeline.
rem NOTE: keep CRLF. LF-only .cmd files silently break on Windows.
node D:\ai-news\run-daily.js >> D:\ai-news\run.log 2>&1
exit /b %errorlevel%
