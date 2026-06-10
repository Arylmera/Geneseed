@echo off
rem Geneseed — native Windows front door (cmd.exe). Mirrors the bash `geneseed`
rem launcher but needs no bash: it routes every subcommand to the cross-platform
rem Python CLI (rituals\harness.py).
rem
rem   geneseed                       show the getting-started hint
rem   geneseed setup                 guided, dependency-free install wizard
rem   geneseed build [args]          render the bundle
rem   geneseed doctor [args]         validate (themes, parity, authoring, drift)
rem   geneseed upgrade [ref] [theme] self-upgrade from the published source
rem   geneseed sync-self [ref]       refresh the launchers + update scripts
rem   geneseed link | unlink         put `geneseed` on PATH / remove it
rem   geneseed diff|context|learn|prompt|version|status|uninstall [args]
setlocal
set "HERE=%~dp0"
rem Prefer the Windows `py` launcher, fall back to `python` on PATH.
where py >nul 2>&1 && (set "PY=py") || (set "PY=python")
if "%~1"=="" (
  "%PY%" "%HERE%rituals\harness.py" menu
) else (
  "%PY%" "%HERE%rituals\harness.py" %*
)
exit /b %ERRORLEVEL%
