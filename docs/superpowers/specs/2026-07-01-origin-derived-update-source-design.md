# Git-pull self-update — design

**Date:** 2026-07-01
**Status:** Approved shape, hardened (2 adversarial passes); pending final review
**Area:** `rituals/_update.py`, `harness.py` + `_harness_lifecycle.py`, web update action + About + offline-zip removal, launchers, tests, docs

## Problem

`geneseed upgrade` / `update` / `sync-self` fetch the latest code from a **hardcoded** upstream
repo (`rituals/_update.py:48`, `REPO = "Arylmera/Geneseed"`) via a bespoke HTTP download stack
(clone-to-temp → SHA-resolve → archive-zip fallback → copy factory files over ROOT). The user
maintains a **duplicated Geneseed repo in a company git host** and deploys it by `git clone`. They
want updates to come from **wherever the install was cloned from**, with the simplest mechanism.

## Goal

The deployment is always a real `git clone`, so **updating = `git pull` (fast-forward only) in the
install folder + rebuild the bundle**. The install's own `.git` origin *is* the source — zero
config, host-agnostic. The entire custom download/zip stack is deleted.

### Decisions (confirmed with user)

- **Q1 — remove the offline `--zip` path entirely** (and the web offline-zip download). git pull is
  the clean way; offline transfer is a manual operator exercise.
- **Q2 — refuse a dirty/blocked tree with a friendly message.** CLI prints it; the web UI shows an
  **info popup** (existing `Toast`, `kind:'info'`). Never auto-stash, never discard local edits.
- **Q3 — always pull the current branch's latest.** No ref-pinning in the tool (`git checkout <ref>`
  is a manual operator step). `theme` selection is still honored on rebuild.

### Non-goals

- No new config knob (no `GENESEED_REPO`).
- No rewrite of static public docs to a company URL (upstream clone lines stay `Arylmera`).
- No `git reset` on the happy path; `reset --hard` is used **only** to undo a pull that then fails
  validation.

## Deployment assumptions (confirmed)

- The install (`ROOT = Path(__file__).resolve().parent.parent`) is a real `git clone` (including
  `--depth 1 --single-branch` — verified: fetch auto-deepens, `@{u}`/rev-list/`merge --ff-only` all
  behave) with an `origin` and a branch tracking it; `git` on PATH.
- Host state (`context.json`, `memory/`) lives in the sibling `Harness/` bundle (`out =
  ROOT.parent/Harness`); all markers (`.geneseed-theme/-emit/-manifest`) live in the bundle or the
  config dir — **never in ROOT**. So `git pull` on ROOT touches only tracked factory files.
- The repo has no `.gitmodules` today; submodule handling is out of scope (noted as a future
  constraint in §2).

## Design

### §0 Shared git-subprocess contract

Mirror existing conventions (`_NO_WINDOW` `_update.py:65–68`; `.strip()` `_resolve_sha:224`):
`shutil.which("git")` guard → `subprocess.run([exe,"-C",str(ROOT),...], capture_output=True,
text=True, timeout=<short>, **_NO_WINDOW)` in try/except → **`.strip()` all stdout** → **never
special-case return codes** (any nonzero / `TimeoutExpired` / exception = failure). Network calls
(`fetch`) additionally set `GIT_TERMINAL_PROMPT=0` (fail fast, no prompt) and git low-speed guards
`-c http.lowSpeedLimit=1000 -c http.lowSpeedTime=15`; their timeout is the larger `GENESEED_NET_TIMEOUT`
(default ~120s). A shared `_redact_url_creds(text)` (`(://)[^/@\s]+@` → `\1`) scrubs **captured git
output** before it reaches `_Log` or any web response (git errors can echo a tokened remote URL).

### §1 Preflight — two phases

The gate is split so the web popup is instant and the network work happens off the request thread.

**Phase A — local only, no network, fast (safe to run synchronously in the HTTP handler):**
returns `Preflight = { ok, code, kind, message }` (never raises). Ordered so the cheapest reject
wins and no network is spent on an unusable state:

1. `no_git_exe` — `shutil.which("git")` missing → kind info: "git is not installed / not on PATH."
2. `not_git` — `git rev-parse --is-inside-work-tree` false → kind info: "This install isn't a git
   checkout — re-clone it with git to enable updates."
3. `detached` — `git symbolic-ref -q HEAD` empty → kind info: "HEAD is detached (a tag/commit is
   checked out). `git checkout <branch>` to re-enable updates." *(checked before upstream so a
   detached head isn't mis-reported as `no_upstream`.)*
4. `no_upstream` — `git rev-parse --abbrev-ref --symbolic-full-name @{u}` fails → kind info: "Your
   branch has no upstream — set one with `git branch --set-upstream-to`."
5. `dirty` — `git -c core.fileMode=false status --porcelain --untracked-files=no` non-empty → kind
   info: "You have local changes in <ROOT>. Commit or stash them, then update." *(`core.fileMode=false`
   avoids Windows exec-bit false positives; a shipped `.gitattributes` `* text=auto eol=lf` — see §8 —
   plus running the check with `-c core.autocrlf=false` prevents CRLF-renormalization false dirt.
   Untracked files are ignored so runtime scratch never blocks.)*
6. `ready` — otherwise.

**Phase B — network + mutation (inside the spawned job / CLI-inline, streams to the Console):**
7. `git fetch --quiet` (§0 network guards). Failure → `fetch_failed` (kind error, redacted git text).
8. Divergence: `ahead = rev-list --count @{u}..HEAD`, `behind = rev-list --count HEAD..@{u}`.
   - `ahead > 0` **and** `git merge-base HEAD @{u}` empty → `unrelated` (kind info): "Upstream history
     was rewritten; back up local work and re-clone or `git reset --hard @{u}`."
   - `ahead > 0` (common ancestor exists) → `diverged` (kind info): "Your branch has local commits and
     can't fast-forward — push/rebase or reset first."
   - `ahead == 0, behind == 0` → up to date (no pull; still rebuilds, see §3).
   - `ahead == 0, behind > 0` → proceed to §2.

**Invariant:** `behind`/`ahead` are meaningful only for the ready path; every non-ready `code`
carries no numeric promise. Phase-B failures are **not** preflight-popup codes (§5) — they surface
via the Console stream and the CLI exit.

### §2 Update core — `_pull_and_validate()` (rewire of `_fetch_and_validate`)

For a ready, behind>0 state:
1. `old = git rev-parse HEAD` (rollback anchor).
2. `git merge --ff-only @{u}` (fetch already done in Phase B; ff-only cannot merge-commit or
   conflict). If it still fails — e.g. an incoming tracked file collides with a local **untracked**
   file — map to `collision` (kind info): "Update blocked — a new upstream file collides with a local
   untracked file (<name>). Move/remove it, then update." Nothing was changed.
3. **Doctor-gate, fail-closed:** `doctor --all --no-bundle` on ROOT (bundle drift is expected — it's
   rebuilt next; `--no-bundle` exists at `harness.py:141`), wrapped in `timeout`/try-except. Nonzero,
   `TimeoutExpired`, **or** any exception ⇒ `git reset --hard <old>`, print `DOCTOR_LEGEND` + problems,
   return error. (§0's "never special-case" extended to the doctor spawn.)
4. Success → caller rebuilds.

> **Atomicity:** ROOT and the sibling bundle are not updated atomically — a kill between the merge
> and the rebuild leaves source ahead of bundle. Mitigations: the rebuild writes a temp bundle and
> `os.replace`s it into place (atomic swap); the next `geneseed upgrade` is idempotent (behind==0 →
> rebuild-only, §3) and re-syncs. Documented in Edge cases.
> **Self-overwrite is safe:** the pull rewrites `_update.py`/launchers on disk; Python already holds
> the module in memory and the rebuild runs `build.py` in a fresh subprocess (same pattern current
> `sync_self` relies on). **Rollback scope:** `reset --hard <old>` restores tracked ordinary files
> exactly; it never removes untracked files and (if submodules are ever added) would not restore
> nested submodule trees — future constraint only (no `.gitmodules` today).

### §3 Entry points & orchestration

- **`upgrade(ref=None, theme_arg=None)`** (drop `zip_arg` and all download/copy internals; **accept
  but ignore a positional `ref`** for back-compat with callers that still pass one — git always pulls
  the current branch; keep `theme_arg` wired — `_update.py:587` theme precedence + §7 ThemeTests depend
  on it): run Phase-A preflight; if `not ok` → print `message`, return the code's exit int (§ below).
  Else run Phase B; on `ready`+behind>0 → `_pull_and_validate()`. **Always rebuild** the bundle
  afterward (idempotent and cheap) — including the behind==0 "already up to date" path — then bounce
  the web daemon. Rebuild keeps the unchanged theme/emit precedence.
- **`sync_self` and `update` both alias `upgrade`.** One `git pull` refreshes launchers *and* factory
  together, so the historical two-step ordering is obsolete. Keep the subcommand names for
  back-compat; all three do preflight → pull → rebuild. (Removes the "sync-self leaves a stale bundle"
  footgun.)
- **CLI exit codes** (CLI-only; the web gates on Phase-A directly and never reads these): `0`
  success/up-to-date; `3` for any kind:'info' precondition (not_git/detached/no_upstream/dirty/
  diverged/unrelated/collision/no_git_exe); `1` for kind:'error' (fetch_failed/doctor_fail/build_fail).
  Update `_harness_lifecycle.py`'s step runner so exit `3` from an update step reads as "skipped /
  nothing to do", not FAILED.
- **`main()`** (self-heal contract): keep `{upgrade|sync-self|update}` working (all → the new pull
  path), delete the `--zip` branch, ignore a stray positional ref.
- **`harness.py` / `_harness_lifecycle.py`:** drop the `--zip` arg + `zip_arg` forwarding; collapse
  the two-step bootstrap driver at `_harness_lifecycle.py:237-238` **and** `:258-259` (`_bootstrap_progress`
  + `_bootstrap_plain`) to a single ("Update & rebuild", upgrade) step; `_update_step_cmd` stops
  passing `ref`.
- **`bootstrap` (fresh clone):** it just cloned latest → behind==0 → upgrade rebuilds only (no
  pointless pull). Fine to route through `upgrade`.

### §4 Deletions (Law XVI — every reference reconciled)

`rituals/_update.py`: `_urlopen`, `_curl_get`, `_curl_download`, `_urllib_download`, `_download`,
`_resolve_sha`, `_git_clone_source`, `_fetch_source`, `_extract_local_zip`, `_local_zip_source`, the
`/archive/*.zip` URLs, `REPO`, `SYNC` + `_refresh_item`, `SCRIPTS`-copy in `sync_self`, `ATTEMPTS`
download loop, `GENESEED_SRC`, all `--zip`/`zip_arg` plumbing.
**Offline-zip web surface (must also go):** `rituals/_web_graph.py` — `offline_zip_bytes()` (`:97`)
+ `OFFLINE_ZIP_SKIP` (`:94`); `rituals/_web_server.py` — the `/api/offline-zip` route (`:69-73`) +
its import; `web/src/pages/Settings/index.jsx` — the "Offline package" card (`:220-233`, the
`/api/offline-zip` download button at `:229`).
**Launcher cure text:** rewrite the archive-zip manual-cure echoes in `bootstrap:61` and `geneseed:90`
(and their surrounding blocks) to a `git pull` / `git clone` cure — the "launchers unchanged" claim
excludes these embedded download strings.
**Keep:** `_migrate_stray_bundle`, `DOCTOR_LEGEND`, the bundle rebuild + daemon bounce, theme/emit
precedence, the `.geneseed-*` markers.

### §5 Web update action + info popup

- **Handler (`_web_server.py`, the `/api/actions` path ~`:205`):** add an explicit `update` branch
  (like install/deploy) that runs **Phase-A preflight** synchronously. On `not ok` → return **HTTP
  422** with `{ "precondition": code, "kind": kind, "message": message }` and **do not** spawn a job.
  On ok → `jm.start('upgrade')` (single command). *(422, not 409 — `web/src/api/jobs.js` collapses all
  409s to "An action is already running"; 422 keeps the two distinct.)* Also collapse
  `_web_jobs.py:162` `"update"` to `[[py,h,"upgrade"]]` so table and handler agree.
- **Frontend plumbing (three concrete edits):**
  1. `web/src/api/http.js` `fail()` (`:12-17`) currently discards the body — **attach it**:
     `err.status = r.status; err.body = body;` so callers can read `err.body.kind/message`.
  2. `web/src/hooks/useJobs.js` `runAction` catch — if `e.body?.kind`, route to an **info** toast
     (`setToast({ kind: e.body.kind, msg: e.body.message })`) instead of the generic error path; and
     `web/src/App.jsx:50` `onError` must honor an incoming `kind` rather than hardcoding `'err'`.
  3. `web/src/styles.css` — add a `.toast.info` rule (none exists today).
- **Surface it:** add a modest **"Update"** button to the Settings maintenance row so the flow +
  popup are reachable (the offline-package card removed in §4 frees the spot).
- Spawned-job output still streams to the `Console` drawer (fetch/pull/doctor/rebuild logs).

### §6 About repo display

`_origin_display()` in `_update.py` (display-only, no transport role) → a namedtuple
`OriginDisplay(url: str, github_slug: str | None)`: `git remote get-url origin` (§0) → `.strip()` →
`_redact_url_creds` → normalize (`urlsplit`/scp-form → `https://<host>/<path w/o .git>`, userinfo+port
dropped); `github_slug` set only when host is `github.com`. Fallback
`OriginDisplay("https://github.com/Arylmera/Geneseed", "Arylmera/Geneseed")` when no origin/git.

- `_web_docs.py:_about()` (lazy `import _update`): `repo = od.url`, **and** add `repo_is_github =
  bool(od.github_slug)` to the payload so the frontend can gate deep links.
- `web/src/pages/Docs/About.jsx` already reads `page.repo` → auto-reflects (also read
  `page.repo_is_github` for gating). `web/src/pages/About.jsx` (standalone `#/about`, `App.jsx:198`)
  → fetch `api.docsPage('about')`, use `repo` (fallback to the `Arylmera` constant), and render the
  github-shaped deep links (`/issues`, `/blob/…/LICENSE`) **only when `repo_is_github`** — else just
  the repo-root link (they 404 on non-github hosts / non-`main` forks). Creator link stays `Arylmera`.
- Rebuild + commit `web/dist`.

### §7 Tests

- **Delete** network/zip suites in `tests/test_update.py` (`UrlopenTests`, `CurlDownloadTests`,
  `UrllibDownloadTests`, `LocalZipTests`, download/SHA/archive parts of `GitCloneSourceTests` /
  `test_fetch_source_prefers_clone`, and `RefreshItemTests` since `_refresh_item` is gone).
  In `tests/test_web.py`: drop `test_offline_zip_holds_the_source_tree` (`:893`) and fix the update-
  action assertion `assertIn("sync-self", cmds[0])` (`:237`) to assert a single `upgrade`.
- **Keep** `DoctorSignatureTests`, `ThemeTests` (both), `StrayBundleTests`.
- **New/rewired** (all via a **monkeypatchable git seam** → subprocess-free):
  - `_preflight` Phase A: `no_git_exe`, `not_git`, `detached`, `no_upstream`, `dirty` (tracked change),
    mode-only delta ⇒ **not** dirty, untracked-only ⇒ **not** dirty, `ready`.
  - Phase B: `fetch_failed`, `unrelated` (no merge-base), `diverged` (ahead>0 + ancestor), behind==0
    (up to date), behind>0 ⇒ proceed.
  - `_pull_and_validate`: ff success → rebuild reached; `collision` mapping; doctor-fail/timeout/crash
    ⇒ `reset --hard <old>` invoked + error + no rebuild.
  - `_origin_display` matrix (https/scp/ssh/git; GHE/GitLab/Azure ⇒ `github_slug None`; embedded creds
    stripped; no-origin ⇒ default). Credential redaction of a captured git error.
  - Web: `/api/actions/update` returns 422 + `{kind:'info'}` on Phase-A failure and does **not** spawn
    a job (mock preflight).

### §8 Docs & config

- Ship **`.gitattributes`** (`* text=auto eol=lf`) so line endings are deterministic regardless of
  `core.autocrlf` (also stabilizes launcher shebangs) — supports the §1 clean check.
- **README / SETUP** — rewrite the `upgrade` description from "downloads + validates the published
  source" to "**git-pulls** the install's origin (fast-forward only), validates via `doctor`,
  rebuilds"; delete `--zip`/offline-download mentions. Public clone URL stays `Arylmera`.
- **CHANGELOG** — note the pivot to git-based self-update; drop "SHA-pinned archive" language.
- **DESIGN.md** — short "self-update = git pull + rebuild; source = install origin" note.
- **Pivot crossing:** the FIRST update off a pre-pivot checkout still runs the old download `main()`
  (via a stale `harness.py`/`_update.py`); on hosts where the archive zip is blocked the operator must
  `git pull` manually once to land the new code. Document this one-time step.

## Data flow

```
CLI: geneseed upgrade
  └─ upgrade(): A = preflightA()                 # local, instant
        not ok → print(A.message); exit(3|1)
        fetch + divergence (Phase B)             # fetch_failed/diverged/unrelated → message
        behind>0 → _pull_and_validate():
            old=HEAD; merge --ff-only @{u}        # collision → info
            doctor --all --no-bundle (fail-closed)→ reset --hard old; exit 1
        ALWAYS rebuild bundle (temp+os.replace) + bounce daemon    # incl. behind==0

Web: [Update] ─POST /api/actions/update─▶ handler: A = preflightA()
        not ok → 422 { precondition, kind, message } ─▶ http.js err.body ─▶ runAction ─▶ info Toast
        ok     → jm.start('upgrade') ─▶ Console streams Phase B + doctor + rebuild

About(#/about) ─▶ api.docsPage('about') ─▶ _about(){ repo: od.url, repo_is_github } (deep-links gated)
```

## Edge cases

- dirty(tracked)/detached/no_upstream/diverged/unrelated/collision → respective info popup, no
  mutation. mode-only or untracked-only churn → proceeds.
- doctor fail/timeout/crash → exact `reset --hard <old>`; untracked files never removed.
- kill mid-op → source ahead of bundle; next upgrade (behind==0 → rebuild-only) re-syncs; bundle swap
  itself is atomic (`os.replace`).
- credential in origin → redacted everywhere; git uses it silently.
- fresh clone (bootstrap) → behind==0 → rebuild only.
- `GENESEED_OUT/ROOT`, emit-mode, theme precedence, `_migrate_stray_bundle` → unchanged.

## Files touched

- `rituals/_update.py` — delete §4 symbols; add `_preflight` (A+B), `_pull_and_validate`,
  `_origin_display`, `_redact_url_creds`; rewire `upgrade`/`sync_self`/`update`/`main`.
- `rituals/harness.py`, `rituals/_harness_lifecycle.py` — drop `--zip`/`zip_arg`; collapse the
  two-step bootstrap (`:237-238`, `:258-259`); `_update_step_cmd` drops `ref`; exit-3 = skipped.
- `rituals/_web_jobs.py` — `"update"` → single `upgrade`.
- `rituals/_web_server.py` — `update` preflight branch + 422 body; remove `/api/offline-zip` route.
- `rituals/_web_graph.py` — remove `offline_zip_bytes` + `OFFLINE_ZIP_SKIP`.
- `rituals/_web_docs.py` — `_about().repo` = `_origin_display().url` + `repo_is_github` (lazy import).
- `web/src/api/http.js` — `fail()` attaches `err.body`.
- `web/src/hooks/useJobs.js`, `web/src/App.jsx` — route `{kind}` to info toast; `onError` honors kind.
- `web/src/api/jobs.js` — (only if using the precondition-field variant; 422 avoids touching it).
- `web/src/styles.css` — `.toast.info` rule.
- `web/src/pages/Settings/index.jsx` — remove offline-package card; add "Update" button.
- `web/src/pages/About.jsx` — fetch repo + fallback + `repo_is_github`-gated deep links. `Docs/About.jsx` — read the gate field.
- `web/dist/**` — rebuilt + committed.
- `tests/test_update.py`, `tests/test_web.py` — §7.
- `bootstrap`, `geneseed` — git-pull cure text (not archive zip).
- `.gitattributes` (new), `README.md`, `SETUP.md`, `CHANGELOG.md`, `DESIGN.md` — §8.

## Out of scope / preserved

- README/CHANGELOG/badge public links stay `Arylmera`.
- Bundle rebuild, theme/emit precedence, `_migrate_stray_bundle`, daemon bounce — unchanged.
- No new config field; no offline path; no ref-pinning; submodules (none today).
