#!/usr/bin/env pwsh
# Geneseed — native Windows front door (PowerShell). Mirrors the bash `geneseed`
# launcher but needs no bash: it routes every subcommand to the cross-platform Python
# CLI (rituals\harness.py). Usage matches geneseed.cmd / the bash launcher.
#
#   .\geneseed.ps1                       getting-started hint
#   .\geneseed.ps1 setup                 guided install wizard
#   .\geneseed.ps1 build [args]          render the bundle
#   .\geneseed.ps1 upgrade [ref] [theme] self-upgrade from the published source
#   .\geneseed.ps1 sync-self [ref]       refresh the launchers + update scripts
#   .\geneseed.ps1 link | unlink         put `geneseed` on PATH / remove it
#   .\geneseed.ps1 doctor|diff|context|learn|prompt|version|status|uninstall [args]
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$harness = Join-Path $here 'rituals/harness.py'
# Prefer the Windows `py` launcher, fall back to python / python3 on PATH.
$py = if (Get-Command py -ErrorAction SilentlyContinue) { 'py' }
      elseif (Get-Command python -ErrorAction SilentlyContinue) { 'python' }
      else { 'python3' }
if ($args.Count -eq 0) {
  & $py $harness menu
} else {
  & $py $harness @args
}
exit $LASTEXITCODE
