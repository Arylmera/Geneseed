- **A settings file with a UTF-8 BOM is read, not refused.** Windows PowerShell 5 `Set-Content
  -Encoding UTF8` puts a BOM at the start of `settings.json` or `opencode.json`. The emit called
  that valid JSON "not valid JSON" and skipped wiring the hooks. The BOM is now ignored on read,
  and the rewrite writes the file back without it.
