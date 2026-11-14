@echo off
rem Geneseed - one-step install for a git clone on Windows (cmd.exe, or double-click).
rem
rem   install.cmd      check what the machine is missing, then run the setup wizard
rem   install.cmd --profile starter
rem                    the same checks, then install the named profile with no questions:
rem                    setup --profile also puts geneseed on PATH, sets the web console to
rem                    start at login and starts it, so this script skips its own link, its
rem                    console question and its final pause (a scripted run must return).
rem
rem It installs NOTHING itself. On a managed PC a silent Node or Git install is exactly
rem what IT forbids, and winget is often blocked too - so a missing prerequisite is
rem named, with where to get it, and the script stops. Re-run it once that is fixed.
rem No .ps1 anywhere: it is blocked by policy on the machines this is for. The one
rem PowerShell use is `geneseed link`'s inline -Command, and its failure is not fatal.
rem
rem ASCII only, on purpose. cmd.exe reads a .cmd in the console's OEM codepage, so an
rem em dash or an accent here prints as mojibake on a stock corporate console.
rem
rem %GENESEED_NODE% overrides the interpreter, as in geneseed.cmd - the knob for a
rem portable Node unpacked somewhere that is not on PATH.
setlocal
set "HERE=%~dp0"
set "NODE=node"
rem Profile mode when any argument is --profile. `for` splits on `=` too, so --profile=x counts.
set "PROFILE_MODE="
for %%a in (%*) do if /i "%%~a"=="--profile" set "PROFILE_MODE=1"
if defined GENESEED_NODE set "NODE=%GENESEED_NODE%"

echo.
echo Geneseed install - checking prerequisites
echo.

"%NODE%" --version >nul 2>nul
if errorlevel 1 goto :nonode
rem engines.node in package.json is >=22.7.0; below that the CLI fails on syntax, not with a hint.
"%NODE%" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=7)?0:1)"
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
rem The arguments reach setup only in profile mode: without --profile the wizard runs exactly
rem as it always did, whatever else was typed after install.cmd.
if not defined PROFILE_MODE goto :wizard
"%NODE%" "%HERE%bin\geneseed-cli.mjs" setup %*
if errorlevel 1 goto :failed
goto :profiledone
:wizard
"%NODE%" "%HERE%bin\geneseed-cli.mjs" setup
if errorlevel 1 goto :failed

rem Put `geneseed` on PATH unless it already is, as ./install does. Without it a fresh clone
rem had no `geneseed` command until the user found `geneseed.cmd link` (reported 2026-11).
rem `link` writes %LOCALAPPDATA%\Geneseed\bin\geneseed.cmd and adds that dir to the user Path
rem through an inline `powershell -Command` (no .ps1 file). Not fatal: if that is blocked,
rem link prints the dir to add by hand, and geneseed.cmd still works from this folder.
rem `$PATH:` because a bare `where` searches the current folder first, and finds this
rem clone's own geneseed.cmd when install.cmd is run from here.
where $PATH:geneseed >nul 2>nul
if not errorlevel 1 goto :linked
echo.
"%NODE%" "%HERE%bin\geneseed-cli.mjs" link
if errorlevel 1 echo   !!  Could not put geneseed on PATH - geneseed.cmd works from this folder.
:linked

echo.
choice /c YN /m "Open the Geneseed web console now"
if errorlevel 2 goto :done
"%NODE%" "%HERE%bin\geneseed-cli.mjs" home
goto :done

:nonode
echo   xx  Node.js not found.
goto :nodehelp
:oldnode
"%NODE%" -e "console.log('  xx  Node '+process.version+' is too old - Geneseed needs 22.7 or newer.')"
:nodehelp
echo       Install the current Node.js LTS: https://nodejs.org/
echo       On a managed PC, ask IT or look for "Node.js LTS" in Software Center / Company Portal.
echo       Then open a NEW terminal and run install.cmd again.
goto :failed

:failed
echo.
echo Install did not finish - see the lines above.
if not defined PROFILE_MODE pause
exit /b 1

:profiledone
echo.
echo Done. Open a NEW terminal to use geneseed, or run geneseed.cmd from this folder.
exit /b 0

:done
echo.
echo Done. Run geneseed.cmd from this folder, or geneseed from a NEW terminal once it is on your PATH.
pause
exit /b 0
