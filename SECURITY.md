# Security policy

## Reporting a vulnerability

Report it privately: open the repository's **Security** tab and choose **Report a vulnerability**.
Please do not open a public issue for a security problem. A report is answered within a week.

Only the latest published version is supported; fixes ship as a new release, not as a backport.

## Where the security-critical code lives

Geneseed writes into files its user co-owns and runs on every tool call of every session, so a
defect in these paths is a security defect, not just a bug. `.github/CODEOWNERS` names the same
paths.

| Path | Why it is critical |
|---|---|
| `bin/geneseed-hook.mjs`, `js/hosts/hooks*.mjs` | The hook gates. A verdict travels as JSON on stdout and every arm exits 0, so one stray printed byte turns a blocking gate silently permissive |
| `js/hosts/settings.mjs`, `js/hosts/native.mjs` | Merges into the user's own `settings.json` / `opencode.json` and writes their skills and agents; a pruning slip deletes user content |
| `js/hosts/shim.mjs`, `js/hosts/link.mjs` | The machine-wide hook shim, and the one Windows USER-Path registry edit |
| `js/maintain/` | Uninstall and upgrade — they delete files, and only manifest-owned paths may go |
| `src/skills/<vendored>/` | Third-party skills (`VENDORED_SKILL_DIRS`), pinned to an upstream commit in each `VENDOR.md`, and shipped into every install |
| `.github/workflows/` | CI and the npm publish workflow (trusted publisher) |
