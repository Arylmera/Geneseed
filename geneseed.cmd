@echo off
rem Geneseed — native Windows front door (cmd.exe). Mirrors the bash `geneseed`
rem launcher but needs no bash: it routes every subcommand to the cross-platform
rem Python CLI (rituals\harness.py).
rem
rem   geneseed                       open the web console (interactive + GUI), else the TUI menu
rem   geneseed menu                  force the interactive TUI menu
rem   geneseed web [start|stop|status]  local browser UI — foreground or daemon
rem   geneseed setup                 guided, dependency-free install wizard
rem   geneseed bootstrap [ref] [theme]  update everything, then run setup
rem   geneseed build [args]          render the bundle
rem   geneseed doctor [args]         validate (themes, parity, authoring, drift)
rem   geneseed upgrade [ref] [theme] self-upgrade from the published source
rem   geneseed update  [ref] [theme] same as upgrade (alias)
rem   geneseed sync-self [ref]       refresh the launchers + update scripts
rem   geneseed link | unlink         put `geneseed` on PATH / remove it
rem   geneseed tui|diff|context|learn|prompt|version|status|uninstall [args]
setlocal
set "HERE=%~dp0"
rem Pick the first interpreter that actually RUNS (mirrors the bash launcher):
rem existence alone is not enough — the Microsoft Store alias stub for python.exe
rem sits on PATH but only prints an install hint and exits non-zero, which is the
rem common state on a locked-down corporate machine without the `py` launcher.
rem %PYTHON% overrides everything, same contract as the bash front door.
set "PY="
if defined PYTHON set "PY=%PYTHON%"
if defined PY goto :pyfound
for %%C in (py python python3) do (
  if not defined PY (
    where %%C >nul 2>&1 && %%C -c "pass" >nul 2>&1 && set "PY=%%C"
  )
)
if not defined PY set "PY=python"
:pyfound
if "%~1"=="" (
  "%PY%" "%HERE%rituals\harness.py" home
  rem bare exit /b propagates the LIVE errorlevel — %ERRORLEVEL% inside a
  rem parenthesized block expands at parse time and would return a stale code.
  exit /b
)
rem Self-update commands must survive a STALE factory: if harness.py predates the
rem subcommand (a partial update left a new launcher over an old rituals\), probe it and,
rem on a miss, self-heal via rituals\_update.py directly. See the bash `geneseed` for why.
if /I "%~1"=="upgrade"   goto :selfheal
if /I "%~1"=="update"    goto :selfheal
if /I "%~1"=="sync-self" goto :selfheal
"%PY%" "%HERE%rituals\harness.py" %*
exit /b

:selfheal
"%PY%" "%HERE%rituals\harness.py" %1 --help >nul 2>&1
if %ERRORLEVEL%==0 (
  "%PY%" "%HERE%rituals\harness.py" %*
  exit /b
)
echo geneseed: installed factory predates '%~1' - self-healing via rituals\_update.py ... 1>&2
"%PY%" "%HERE%rituals\_update.py" %*
exit /b
