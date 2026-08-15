@echo off
rem Geneseed — native Windows front door (cmd.exe). A thin shim: it hands every
rem argument to the Node CLI, which owns the verbs, the parsing and the refusals.
rem
rem   geneseed                    open the web console, else the TUI menu (`home`)
rem   geneseed <command> [args]   anything bin\geneseed-cli.mjs carries
rem   geneseed --help             the verb list, printed by the CLI itself
rem
rem There is no verb table here — see the bash `geneseed` for why the old one was a
rem liability. There is no PowerShell twin either: pwsh and Windows PowerShell both
rem run a .cmd directly, so `.\geneseed.cmd setup` is the PowerShell spelling too.
rem
rem %GENESEED_NODE% overrides the interpreter — the analogue of the %PYTHON% knob
rem this file carried while the harness was Python. Unset, a bare `node` is used.
rem
rem TWO MECHANICS, both measured rather than assumed:
rem   * `exit /b %ERRORLEVEL%`, not a bare `exit /b`. A bare one propagates a child's
rem     exit code fine, but returns 0 when the command could not be LAUNCHED at all —
rem     which is exactly the %GENESEED_NODE%-is-wrong case, and "the front door
rem     reported success having run nothing" is the worst answer available.
rem   * a `goto`, not a parenthesized `if` block, so each `exit /b` sits on its own
rem     top-level line. %ERRORLEVEL% inside a block expands at parse time and would
rem     return a stale code — which is what forced the bare form in the first place.
setlocal
set "HERE=%~dp0"
set "NODE=node"
if defined GENESEED_NODE set "NODE=%GENESEED_NODE%"
if "%~1"=="" goto :home
"%NODE%" "%HERE%bin\geneseed-cli.mjs" %*
exit /b %ERRORLEVEL%

:home
"%NODE%" "%HERE%bin\geneseed-cli.mjs" home
exit /b %ERRORLEVEL%
