#!/usr/bin/env pwsh
# Geneseed — native Windows front door (PowerShell). Mirrors the bash `geneseed`
# launcher but needs no bash: it routes every subcommand to the cross-platform Python
# CLI (rituals\harness.py). Usage matches geneseed.cmd / the bash launcher.
#
#   .\geneseed.ps1                       open the interactive main menu
#   .\geneseed.ps1 setup                 guided install wizard
#   .\geneseed.ps1 build [args]          render the bundle
#   .\geneseed.ps1 upgrade [ref] [theme] self-upgrade from the published source
#   .\geneseed.ps1 sync-self [ref]       refresh the launchers + update scripts
#   .\geneseed.ps1 link | unlink         put `geneseed` on PATH / remove it
#   .\geneseed.ps1 tui|doctor|diff|context|learn|prompt|version|status|uninstall [args]
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$harness = Join-Path $here 'rituals/harness.py'
$update  = Join-Path $here 'rituals/_update.py'
# Prefer the Windows `py` launcher, fall back to python / python3 on PATH.
$py = if (Get-Command py -ErrorAction SilentlyContinue) { 'py' }
      elseif (Get-Command python -ErrorAction SilentlyContinue) { 'python' }
      else { 'python3' }
if ($args.Count -eq 0) {
  & $py $harness home
  exit $LASTEXITCODE
}
# Self-update commands must survive a STALE factory: if harness.py predates the subcommand
# (a partial update left a new launcher over an old rituals/), probe it and, on a miss,
# self-heal via rituals/_update.py directly. See the bash `geneseed` for the full rationale.
if (@('upgrade','sync-self') -contains $args[0]) {
  $cmd = $args[0]
  & $py $harness $cmd --help *> $null
  if ($LASTEXITCODE -eq 0) { & $py $harness @args; exit $LASTEXITCODE }
  [Console]::Error.WriteLine("geneseed: installed factory predates '$cmd' - self-healing via rituals/_update.py ...")
  & $py $update @args
  exit $LASTEXITCODE
}
& $py $harness @args
exit $LASTEXITCODE
