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
  exit /b %ERRORLEVEL%
)
rem Self-update commands must survive a STALE factory: if harness.py predates the
rem subcommand (a partial update left a new launcher over an old rituals\), probe it and,
rem on a miss, self-heal via rituals\_update.py directly. See the bash `geneseed` for why.
if /I "%~1"=="upgrade"   goto :selfheal
if /I "%~1"=="sync-self" goto :selfheal
"%PY%" "%HERE%rituals\harness.py" %*
exit /b %ERRORLEVEL%

:selfheal
"%PY%" "%HERE%rituals\harness.py" %1 --help >nul 2>&1
if %ERRORLEVEL%==0 (
  "%PY%" "%HERE%rituals\harness.py" %*
  exit /b %ERRORLEVEL%
)
echo geneseed: installed factory predates '%~1' - self-healing via rituals\_update.py ... 1>&2
"%PY%" "%HERE%rituals\_update.py" %*
exit /b %ERRORLEVEL%
