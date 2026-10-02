@echo off
rem Geneseed - one-step install for a git clone on Windows (cmd.exe, or double-click).
rem
rem   install.cmd      check what the machine is missing, then run the setup wizard
rem
rem It installs NOTHING itself. On a managed PC a silent Node or Git install is exactly
rem what IT forbids, and winget is often blocked too - so a missing prerequisite is
rem named, with where to get it, and the script stops. Re-run it once that is fixed.
rem No PowerShell anywhere: .ps1 is blocked by policy on the machines this is for.
rem
rem ASCII only, on purpose. cmd.exe reads a .cmd in the console's OEM codepage, so an
rem em dash or an accent here prints as mojibake on a stock corporate console.
rem
rem %GENESEED_NODE% overrides the interpreter, as in geneseed.cmd - the knob for a
rem portable Node unpacked somewhere that is not on PATH.
setlocal
set "HERE=%~dp0"
set "NODE=node"
if defined GENESEED_NODE set "NODE=%GENESEED_NODE%"

echo.
echo Geneseed install - checking prerequisites
echo.

"%NODE%" --version >nul 2>nul
if errorlevel 1 goto :nonode
rem engines.node in package.json is >=22.3.0; below that the CLI fails on syntax, not with a hint.
"%NODE%" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=3)?0:1)"
if errorlevel 1 goto :oldnode
"%NODE%" -e "console.log('  ok  Node '+process.version)"

git --version >nul 2>nul
if errorlevel 1 goto :nogit
echo   ok  Git
goto :gitdone
:nogit
rem Not fatal: setup runs without it. Updates do not - `geneseed upgrade` is a git pull.
echo   !!  Git not found. Setup will work, but updates are a `git pull` and need it.
echo       Install Git for Windows: https://git-scm.com/download/win
echo       On a managed PC, ask IT or look for "Git" in Software Center / Company Portal.
:gitdone
if not exist "%HERE%.git" echo   !!  This folder is not a git clone, so it cannot update itself. Prefer: git clone https://github.com/Arylmera/Geneseed.git

echo.
"%NODE%" "%HERE%bin\geneseed-cli.mjs" setup
if errorlevel 1 goto :failed

echo.
choice /c YN /m "Open the Geneseed web console now"
if errorlevel 2 goto :done
"%NODE%" "%HERE%bin\geneseed-cli.mjs" home
goto :done

:nonode
echo   xx  Node.js not found.
goto :nodehelp
:oldnode
"%NODE%" -e "console.log('  xx  Node '+process.version+' is too old - Geneseed needs 22.3 or newer.')"
:nodehelp
echo       Install the current Node.js LTS: https://nodejs.org/
echo       On a managed PC, ask IT or look for "Node.js LTS" in Software Center / Company Portal.
echo       Then open a NEW terminal and run install.cmd again.
goto :failed

:failed
echo.
echo Install did not finish - see the lines above.
pause
exit /b 1

:done
echo.
echo Done. Next time, run geneseed.cmd from this folder (or `geneseed.cmd link` to put it on PATH).
pause
exit /b 0
