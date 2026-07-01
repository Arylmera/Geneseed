# Git-pull self-update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Geneseed's bespoke HTTP download/zip self-update with an in-place `git pull --ff-only` + rebuild, sourced from the install's own `.git` origin, with a friendly precondition popup in the web UI.

**Architecture:** `rituals/_update.py` gains a small git seam (`_git`), a two-phase preflight (`_preflight` local + `_measure_upstream` networked), `_pull_and_validate` (ff-only → doctor-gate → rollback), and `_origin_display` (About link). `upgrade()` becomes preflight → pull → **always rebuild**; `sync_self`/`update` alias it. The entire download/zip stack (network transports, archive URLs, `--zip`, offline-zip web route) is deleted. The web `update` action gates on Phase-A preflight and returns HTTP 422 `{kind:'info',message}` for a friendly toast.

**Tech Stack:** Python 3 stdlib (`subprocess`, `shutil`, `urllib.parse`, `namedtuple`, `re`); React (Vite) web UI; `unittest`-style tests in `tests/`.

**Spec:** `docs/superpowers/specs/2026-07-01-origin-derived-update-source-design.md`

**Conventions:**
- Run Python tests with `python -m pytest tests/test_update.py -q` (fallback: `python -m unittest tests.test_update -v`).
- All new git calls go through the monkeypatchable `_update._git` seam so tests stay subprocess-free.
- `ROOT` and `_NO_WINDOW` already exist in `_update.py` (lines 44 and 65–68). `DOCTOR_LEGEND` (line 111) is kept.

---

## File Structure

**Python (`rituals/`)**
- `_update.py` — add `_git`, `_redact_url_creds`, `_parse_origin`, `_origin_display`, `_preflight`, `_measure_upstream`, `_pull_and_validate`; rewrite `upgrade`/`sync_self`/`main`; **delete** the whole network/zip stack. Modify `_run_doctor` (add `--no-bundle` + timeout).
- `harness.py` — drop the `--zip` arg from the `upgrade` subparser.
- `_harness_lifecycle.py` — `cmd_upgrade` stops forwarding `zip_arg`; collapse the two-step bootstrap to one step; `_update_step_cmd` drops `ref`; `_run_steps`/`_bootstrap_plain` treat exit `3` as "skipped", not "failed".
- `_web_jobs.py` — `"update"` table entry → single `upgrade`.
- `_web_server.py` — add an `update` preflight branch (422 on precondition); remove the `/api/offline-zip` GET route.
- `_web_graph.py` — delete `offline_zip_bytes()` + `OFFLINE_ZIP_SKIP`.
- `_web_docs.py` — `_about()` `repo` = resolved origin url; add `repo_is_github`.

**Web (`web/src/`)**
- `api/http.js` — `fail()` attaches the parsed body to the Error.
- `App.jsx` — `onError` honors an incoming `kind`/`message` from `e.body`.
- `styles.css` — add `.toast.info`.
- `pages/Settings/index.jsx` — remove the "Offline package" card; add an "Update" button.
- `pages/Docs/About.jsx` — gate the github-shaped deep links on `page.repo_is_github`.
- `pages/About.jsx` — fetch the about payload; use resolved repo + gate deep links; fall back to the `Arylmera` constant.
- `web/dist/**` — rebuilt + committed.

**Tests / docs / config**
- `tests/test_update.py`, `tests/test_web.py` — delete download/zip/sync-self suites; add the new ones.
- `.gitattributes` (new), `README.md`, `SETUP.md`, `CHANGELOG.md`, `DESIGN.md`.

---

## Phase 1 — Python core (TDD)

### Task 1: `_redact_url_creds()` — strip credentials from URLs/log text

**Files:**
- Modify: `rituals/_update.py`
- Test: `tests/test_update.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_update.py`:

```python
class RedactCredsTests(unittest.TestCase):
    def test_strips_userinfo_from_https(self):
        self.assertEqual(
            _update._redact_url_creds("clone https://user:tok@github.com/o/r.git failed"),
            "clone https://github.com/o/r.git failed")

    def test_leaves_plain_url_untouched(self):
        self.assertEqual(
            _update._redact_url_creds("https://github.com/o/r.git"),
            "https://github.com/o/r.git")

    def test_handles_empty(self):
        self.assertEqual(_update._redact_url_creds(""), "")
        self.assertEqual(_update._redact_url_creds(None), "")
```

Ensure the test module imports the module object: `import _update` (add near the top of the file if not present; the file already puts `rituals/` on `sys.path`).

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_update.py::RedactCredsTests -q`
Expected: FAIL — `AttributeError: module '_update' has no attribute '_redact_url_creds'`.

- [ ] **Step 3: Write minimal implementation**

Add near the top of `rituals/_update.py` (after the imports, alongside the other module constants), and add `import re` to the import block:

```python
_CREDS_RE = re.compile(r"(://)[^/@\s]+@")


def _redact_url_creds(text: str) -> str:
    """Strip a `user[:token]@` userinfo from any URL in `text` so a tokened
    remote never reaches a log line or an HTTP response."""
    return _CREDS_RE.sub(r"\1", text or "")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_update.py::RedactCredsTests -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add rituals/_update.py tests/test_update.py
git commit -m "feat(update): add _redact_url_creds credential scrubber"
```

---

### Task 2: `_git()` seam + `_parse_origin()` + `_origin_display()`

**Files:**
- Modify: `rituals/_update.py`
- Test: `tests/test_update.py`

- [ ] **Step 1: Write the failing test**

```python
class ParseOriginTests(unittest.TestCase):
    def _slug(self, url):
        return _update._parse_origin(url).github_slug

    def test_https_with_dotgit(self):
        od = _update._parse_origin("https://github.com/Own/Repo.git")
        self.assertEqual(od.url, "https://github.com/Own/Repo")
        self.assertEqual(od.github_slug, "Own/Repo")

    def test_https_bare(self):
        self.assertEqual(self._slug("https://github.com/Own/Repo"), "Own/Repo")

    def test_scp_form(self):
        od = _update._parse_origin("git@github.com:Own/Repo.git")
        self.assertEqual(od.url, "https://github.com/Own/Repo")
        self.assertEqual(od.github_slug, "Own/Repo")

    def test_ssh_scheme(self):
        self.assertEqual(self._slug("ssh://git@github.com/Own/Repo.git"), "Own/Repo")

    def test_ghe_has_no_slug_but_browser_url(self):
        od = _update._parse_origin("https://ghe.corp.com/team/Repo.git")
        self.assertIsNone(od.github_slug)
        self.assertEqual(od.url, "https://ghe.corp.com/team/Repo")

    def test_gitlab_nested_subgroup(self):
        od = _update._parse_origin("https://gitlab.corp.com/team/sub/Repo.git")
        self.assertIsNone(od.github_slug)
        self.assertEqual(od.url, "https://gitlab.corp.com/team/sub/Repo")

    def test_azure_git_path(self):
        od = _update._parse_origin("https://dev.azure.com/org/proj/_git/Repo")
        self.assertIsNone(od.github_slug)
        self.assertEqual(od.url, "https://dev.azure.com/org/proj/_git/Repo")

    def test_embedded_creds_stripped_from_url_kept_in_slug(self):
        od = _update._parse_origin("https://user:tok@github.com/Own/Repo.git")
        self.assertEqual(od.url, "https://github.com/Own/Repo")
        self.assertEqual(od.github_slug, "Own/Repo")


class OriginDisplayTests(unittest.TestCase):
    def test_no_origin_falls_back_to_default(self):
        with mock.patch.object(_update, "_git", return_value=(128, "", "no origin")):
            self.assertEqual(_update._origin_display(), _update.DEFAULT_ORIGIN)

    def test_reads_origin(self):
        with mock.patch.object(_update, "_git",
                               return_value=(0, "https://github.com/Own/Repo.git", "")):
            self.assertEqual(_update._origin_display().github_slug, "Own/Repo")
```

Add `from unittest import mock` to the test file's imports if not present.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_update.py::ParseOriginTests tests/test_update.py::OriginDisplayTests -q`
Expected: FAIL — `_parse_origin` / `DEFAULT_ORIGIN` / `_git` not defined.

- [ ] **Step 3: Write minimal implementation**

Add to `rituals/_update.py` (add `import shutil` and `from collections import namedtuple` if not already imported — `shutil` is already imported; add `namedtuple` and `from urllib.parse import urlsplit`):

```python
OriginDisplay = namedtuple("OriginDisplay", ["url", "github_slug"])
DEFAULT_ORIGIN = OriginDisplay("https://github.com/Arylmera/Geneseed", "Arylmera/Geneseed")


def _git(*args, timeout: int = 10, network: bool = False):
    """Run `git -C ROOT <args>` per the shared contract: which-guarded, no-window,
    stripped + credential-redacted output, never raises. Returns (rc, out, err);
    rc is None when git is absent or the spawn failed. THE monkeypatch seam for tests."""
    exe = shutil.which("git")
    if not exe:
        return (None, "", "")
    cmd = [exe, "-C", str(ROOT)]
    env = None
    if network:
        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
        cmd += ["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=15"]
    cmd += [str(a) for a in args]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True,
                           timeout=timeout, env=env, **_NO_WINDOW)
    except Exception:                       # spawn/timeout/OS error → treated as failure
        return (None, "", "")
    return (p.returncode,
            _redact_url_creds((p.stdout or "").strip()),
            _redact_url_creds((p.stderr or "").strip()))


def _parse_origin(origin: str) -> OriginDisplay:
    """(browser url, github_slug) from a git remote URL of any scheme. Userinfo and
    port dropped from the url; slug set only for a two-segment github.com path."""
    o = (origin or "").strip()
    host = path = ""
    if "://" not in o and "@" in o and ":" in o.split("@", 1)[1]:
        hostpart, path = o.split("@", 1)[1].split(":", 1)      # scp-form git@host:owner/repo
        host = hostpart
    else:
        u = urlsplit(o)
        host, path = (u.hostname or ""), u.path
    host = host.lower()
    path = path.strip("/")
    if path.lower().endswith(".git"):
        path = path[:-4]
    if not (host and path):
        return DEFAULT_ORIGIN
    url = f"https://{host}/{path}"
    slug = None
    if host == "github.com":
        segs = [s for s in path.split("/") if s]
        if len(segs) == 2:
            slug = "/".join(segs)
    return OriginDisplay(url, slug)


def _origin_display() -> OriginDisplay:
    """The install's origin as a display record, or DEFAULT_ORIGIN when absent."""
    rc, out, _ = _git("remote", "get-url", "origin")
    if rc != 0 or not out:
        return DEFAULT_ORIGIN
    return _parse_origin(out)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_update.py::ParseOriginTests tests/test_update.py::OriginDisplayTests -q`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add rituals/_update.py tests/test_update.py
git commit -m "feat(update): add _git seam and origin URL parsing"
```

---

### Task 3: `_preflight()` — Phase A (local, no network)

**Files:**
- Modify: `rituals/_update.py`
- Test: `tests/test_update.py`

- [ ] **Step 1: Write the failing test**

```python
class PreflightTests(unittest.TestCase):
    def _run(self, seam):
        with mock.patch.object(_update, "_git", side_effect=seam):
            return _update._preflight()

    def test_no_git(self):
        # first _git call returns rc=None (git absent)
        p = self._run(lambda *a, **k: (None, "", ""))
        self.assertFalse(p.ok); self.assertEqual(p.code, "no_git_exe"); self.assertEqual(p.kind, "info")

    def test_not_a_repo(self):
        p = self._run(lambda *a, **k: (128, "", "not a work tree"))
        self.assertEqual(p.code, "not_git")

    def test_detached_head(self):
        def seam(*a, **k):
            if a[0] == "rev-parse" and a[1] == "--is-inside-work-tree": return (0, "true", "")
            if a[0] == "symbolic-ref": return (1, "", "")          # detached
            return (0, "", "")
        self.assertEqual(self._run(seam).code, "detached")

    def test_no_upstream(self):
        def seam(*a, **k):
            if a[0] == "rev-parse" and a[1] == "--is-inside-work-tree": return (0, "true", "")
            if a[0] == "symbolic-ref": return (0, "refs/heads/main", "")
            if a[0] == "rev-parse" and "@{u}" in a: return (128, "", "no upstream")
            return (0, "", "")
        self.assertEqual(self._run(seam).code, "no_upstream")

    def test_dirty_tracked_change(self):
        def seam(*a, **k):
            if a[0] == "rev-parse" and a[1] == "--is-inside-work-tree": return (0, "true", "")
            if a[0] == "symbolic-ref": return (0, "refs/heads/main", "")
            if a[0] == "rev-parse" and "@{u}" in a: return (0, "origin/main", "")
            if "status" in a: return (0, " M rituals/build.py", "")
            return (0, "", "")
        p = self._run(seam)
        self.assertFalse(p.ok); self.assertEqual(p.code, "dirty")

    def test_ready_when_clean(self):
        def seam(*a, **k):
            if a[0] == "rev-parse" and a[1] == "--is-inside-work-tree": return (0, "true", "")
            if a[0] == "symbolic-ref": return (0, "refs/heads/main", "")
            if a[0] == "rev-parse" and "@{u}" in a: return (0, "origin/main", "")
            if "status" in a: return (0, "", "")                  # clean (untracked ignored by flags)
            return (0, "", "")
        p = self._run(seam)
        self.assertTrue(p.ok); self.assertEqual(p.code, "ready")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_update.py::PreflightTests -q`
Expected: FAIL — `_preflight` / `Preflight` not defined.

- [ ] **Step 3: Write minimal implementation**

Add to `rituals/_update.py`:

```python
Preflight = namedtuple("Preflight", ["ok", "code", "kind", "message"])

_PRE_MSG = {
    "no_git_exe": ("info", "git is not installed or not on PATH — install git to enable updates."),
    "not_git":    ("info", "This Geneseed install isn't a git checkout — re-clone it with git to enable updates."),
    "detached":   ("info", "HEAD is detached (a tag/commit is checked out). Run `git checkout <branch>` to re-enable updates."),
    "no_upstream": ("info", "Your branch has no upstream — set one with `git branch --set-upstream-to`."),
    "dirty":      ("info", "You have local changes in the Geneseed folder. Commit or stash them, then update."),
    "ready":      ("info", ""),
}


def _pre(code: str) -> "Preflight":
    kind, msg = _PRE_MSG[code]
    return Preflight(code == "ready", code, kind, msg)


def _preflight() -> "Preflight":
    """Phase A — local only, no network. Never raises."""
    rc, out, _ = _git("rev-parse", "--is-inside-work-tree")
    if rc is None:
        return _pre("no_git_exe")
    if rc != 0 or out != "true":
        return _pre("not_git")
    rc, out, _ = _git("symbolic-ref", "-q", "HEAD")
    if rc != 0 or not out:
        return _pre("detached")
    rc, _, _ = _git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    if rc != 0:
        return _pre("no_upstream")
    rc, out, _ = _git("-c", "core.fileMode=false", "-c", "core.autocrlf=false",
                      "status", "--porcelain", "--untracked-files=no")
    if rc != 0:
        return _pre("not_git")
    if out:
        return _pre("dirty")
    return _pre("ready")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_update.py::PreflightTests -q`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add rituals/_update.py tests/test_update.py
git commit -m "feat(update): add Phase-A preflight gate"
```

---

### Task 4: `_measure_upstream()` — Phase B (fetch + divergence)

**Files:**
- Modify: `rituals/_update.py`
- Test: `tests/test_update.py`

- [ ] **Step 1: Write the failing test**

```python
class MeasureUpstreamTests(unittest.TestCase):
    def _run(self, seam):
        with mock.patch.object(_update, "_git", side_effect=seam):
            return _update._measure_upstream()

    def test_fetch_failure(self):
        code, behind, _ = self._run(lambda *a, **k: (128, "", "could not resolve host"))
        self.assertEqual(code, "fetch_failed")

    def test_up_to_date(self):
        def seam(*a, **k):
            if a[0] == "fetch": return (0, "", "")
            if a[0] == "rev-list": return (0, "0", "")
            return (0, "", "")
        self.assertEqual(self._run(seam)[0], "uptodate")

    def test_behind_is_ready(self):
        def seam(*a, **k):
            if a[0] == "fetch": return (0, "", "")
            if a[0] == "rev-list" and a[2] == "@{u}..HEAD": return (0, "0", "")   # ahead
            if a[0] == "rev-list" and a[2] == "HEAD..@{u}": return (0, "3", "")   # behind
            return (0, "", "")
        code, behind, _ = self._run(seam)
        self.assertEqual(code, "ready"); self.assertEqual(behind, 3)

    def test_diverged_with_common_ancestor(self):
        def seam(*a, **k):
            if a[0] == "fetch": return (0, "", "")
            if a[0] == "rev-list" and a[2] == "@{u}..HEAD": return (0, "2", "")
            if a[0] == "rev-list" and a[2] == "HEAD..@{u}": return (0, "1", "")
            if a[0] == "merge-base": return (0, "abc123", "")
            return (0, "", "")
        self.assertEqual(self._run(seam)[0], "diverged")

    def test_unrelated_history(self):
        def seam(*a, **k):
            if a[0] == "fetch": return (0, "", "")
            if a[0] == "rev-list" and a[2] == "@{u}..HEAD": return (0, "1", "")
            if a[0] == "rev-list" and a[2] == "HEAD..@{u}": return (0, "1", "")
            if a[0] == "merge-base": return (1, "", "")
            return (0, "", "")
        self.assertEqual(self._run(seam)[0], "unrelated")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_update.py::MeasureUpstreamTests -q`
Expected: FAIL — `_measure_upstream` not defined.

- [ ] **Step 3: Write minimal implementation**

```python
def _fetch_timeout() -> int:
    try:
        return max(30, int(os.environ.get("GENESEED_NET_TIMEOUT", "120")))
    except ValueError:
        return 120


def _count(s: str) -> int:
    s = (s or "").strip()
    return int(s) if s.isdigit() else 0


def _measure_upstream():
    """Phase B — fetch, then classify. Returns (code, behind, err) where
    code ∈ {ready, fetch_failed, unrelated, diverged, uptodate}."""
    rc, _, err = _git("fetch", "--quiet", timeout=_fetch_timeout(), network=True)
    if rc != 0:
        return ("fetch_failed", 0, err)
    _, ahead, _ = _git("rev-list", "--count", "@{u}..HEAD")
    _, behind, _ = _git("rev-list", "--count", "HEAD..@{u}")
    ahead, behind = _count(ahead), _count(behind)
    if ahead > 0:
        mrc, _, _ = _git("merge-base", "HEAD", "@{u}")
        return (("diverged" if mrc == 0 else "unrelated"), 0, "")
    if behind == 0:
        return ("uptodate", 0, "")
    return ("ready", behind, "")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_update.py::MeasureUpstreamTests -q`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add rituals/_update.py tests/test_update.py
git commit -m "feat(update): add Phase-B upstream divergence measure"
```

---

### Task 5: `_run_doctor` gate (`--no-bundle` + timeout) and `_pull_and_validate()`

**Files:**
- Modify: `rituals/_update.py` (`_run_doctor` at ~line 409)
- Test: `tests/test_update.py`

- [ ] **Step 1: Write the failing test**

```python
class PullAndValidateTests(unittest.TestCase):
    def test_ff_success_then_doctor_pass(self):
        calls = []
        def seam(*a, **k):
            calls.append(a)
            if a[0] == "rev-parse" and a[1] == "HEAD": return (0, "oldsha", "")
            if a[0] == "merge": return (0, "", "")
            return (0, "", "")
        with mock.patch.object(_update, "_git", side_effect=seam), \
             mock.patch.object(_update, "_run_doctor", return_value=(True, "ok")):
            ok, code, _ = _update._pull_and_validate(lambda *_: None)
        self.assertTrue(ok)
        self.assertNotIn(("reset", "--hard", "oldsha"),
                         [c[:3] for c in calls])  # no rollback on success

    def test_doctor_fail_rolls_back(self):
        resets = []
        def seam(*a, **k):
            if a[0] == "rev-parse" and a[1] == "HEAD": return (0, "oldsha", "")
            if a[0] == "merge": return (0, "", "")
            if a[0] == "reset": resets.append(a); return (0, "", "")
            return (0, "", "")
        with mock.patch.object(_update, "_git", side_effect=seam), \
             mock.patch.object(_update, "_run_doctor", return_value=(False, "bad")):
            ok, code, _ = _update._pull_and_validate(lambda *_: None)
        self.assertFalse(ok); self.assertEqual(code, "doctor_fail")
        self.assertEqual(resets[0][:3], ("reset", "--hard", "oldsha"))

    def test_ff_collision_returns_collision(self):
        def seam(*a, **k):
            if a[0] == "rev-parse" and a[1] == "HEAD": return (0, "oldsha", "")
            if a[0] == "merge": return (1, "", "untracked working tree files would be overwritten")
            return (0, "", "")
        with mock.patch.object(_update, "_git", side_effect=seam):
            ok, code, _ = _update._pull_and_validate(lambda *_: None)
        self.assertFalse(ok); self.assertEqual(code, "collision")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_update.py::PullAndValidateTests -q`
Expected: FAIL — `_pull_and_validate` not defined.

- [ ] **Step 3: Write minimal implementation**

First modify the existing `_run_doctor` (~line 409) to add `--no-bundle` and a timeout, fail-closed:

```python
def _run_doctor(cand: Path) -> tuple[bool, str]:
    """Validate a source tree with its OWN `doctor --all --no-bundle` (the bundle is
    rebuilt right after, so its drift is expected). Fail-closed: any nonzero exit,
    timeout, or spawn error is a failure."""
    try:
        proc = subprocess.run(
            [sys.executable, str(cand / "rituals" / "harness.py"),
             "doctor", "--all", "--no-bundle"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            timeout=300, **_NO_WINDOW)
    except Exception as e:                          # noqa: BLE001 — crash/timeout ⇒ fail
        return (False, f"[geneseed] doctor gate could not run: {e}")
    return (proc.returncode == 0, proc.stdout or "")
```

Then add `_pull_and_validate`:

```python
def _pull_and_validate(log) -> tuple[bool, str, str]:
    """Fast-forward to @{u}, then doctor-gate with exact rollback. Assumes preflight
    ok and _measure_upstream == ('ready', behind>0). Returns (ok, code, message)."""
    rc, old, _ = _git("rev-parse", "HEAD")
    if rc != 0 or not old:
        return (False, "not_git", "could not read HEAD")
    rc, _, err = _git("merge", "--ff-only", "@{u}", timeout=60)
    if rc != 0:
        return (False, "collision",
                "Update blocked — a new upstream file collides with a local untracked "
                "file. Move or remove it, then update.\n" + err)
    passed, output = _run_doctor(ROOT)
    log(output.rstrip("\n"))
    if not passed:
        _git("reset", "--hard", old, timeout=60)
        for line in DOCTOR_LEGEND:
            log(line)
        return (False, "doctor_fail",
                "the pulled source FAILS validation — rolled back to the previous commit. "
                "Fix the problems listed above.")
    return (True, "ready", "")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_update.py::PullAndValidateTests -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add rituals/_update.py tests/test_update.py
git commit -m "feat(update): add _pull_and_validate with doctor-gate rollback"
```

---

### Task 6: Rewrite `upgrade()` — preflight → pull → always rebuild

**Files:**
- Modify: `rituals/_update.py` (`upgrade`, ~lines 548–629)
- Test: `tests/test_update.py`

Note: this task rewrites the body of `upgrade()` but reuses its existing rebuild tail verbatim (theme/emit precedence, `_migrate_stray_bundle`, the `build.py` subprocess, and the web-daemon bounce at lines ~580–626). Keep that tail; only the acquisition half changes.

- [ ] **Step 1: Write the failing test**

```python
class UpgradeFlowTests(unittest.TestCase):
    def _patch_rebuild(self):
        # neutralize the rebuild tail so the test targets the acquisition logic
        return mock.patch.object(_update, "_rebuild_bundle", return_value=0, create=True)

    def test_precondition_info_returns_3_no_rebuild(self):
        pf = _update.Preflight(False, "dirty", "info", "msg")
        with mock.patch.object(_update, "_preflight", return_value=pf), \
             self._patch_rebuild() as rb:
            self.assertEqual(_update.upgrade(), 3)
        rb.assert_not_called()

    def test_up_to_date_still_rebuilds_returns_0(self):
        pf = _update.Preflight(True, "ready", "info", "")
        with mock.patch.object(_update, "_preflight", return_value=pf), \
             mock.patch.object(_update, "_measure_upstream", return_value=("uptodate", 0, "")), \
             self._patch_rebuild() as rb:
            self.assertEqual(_update.upgrade(), 0)
        rb.assert_called_once()

    def test_ready_pulls_then_rebuilds(self):
        pf = _update.Preflight(True, "ready", "info", "")
        with mock.patch.object(_update, "_preflight", return_value=pf), \
             mock.patch.object(_update, "_measure_upstream", return_value=("ready", 2, "")), \
             mock.patch.object(_update, "_pull_and_validate", return_value=(True, "ready", "")) as pv, \
             self._patch_rebuild() as rb:
            self.assertEqual(_update.upgrade(), 0)
        pv.assert_called_once(); rb.assert_called_once()

    def test_doctor_fail_returns_1_no_rebuild(self):
        pf = _update.Preflight(True, "ready", "info", "")
        with mock.patch.object(_update, "_preflight", return_value=pf), \
             mock.patch.object(_update, "_measure_upstream", return_value=("ready", 2, "")), \
             mock.patch.object(_update, "_pull_and_validate", return_value=(False, "doctor_fail", "x")), \
             self._patch_rebuild() as rb:
            self.assertEqual(_update.upgrade(), 1)
        rb.assert_not_called()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_update.py::UpgradeFlowTests -q`
Expected: FAIL — `upgrade` still takes the old download path / `_rebuild_bundle` missing.

- [ ] **Step 3: Write minimal implementation**

Refactor `upgrade()`. Extract the existing rebuild tail into a helper `_rebuild_bundle(here, out, theme, emit, root_dir, log)` (move the current code from "build_args = [...]" through the web-daemon `restart_daemon` block into it, returning the build subprocess returncode). Then:

```python
def upgrade(ref=None, theme_arg=None, zip_arg=None):
    """Update from the install's own git origin (fast-forward only), doctor-gate,
    and rebuild the bundle. `ref`/`zip_arg` are accepted for back-compat but IGNORED
    (git follows the current branch; the offline path was removed). Exit code:
    0 ok/up-to-date, 3 info precondition, 1 error."""
    log = _Log()
    here = ROOT
    out = Path(os.environ.get("GENESEED_OUT") or (here.parent / "Harness"))
    root_dir = Path(os.environ.get("GENESEED_ROOT") or out.parent)
    cfg = _opencode_config_dir()
    emit = _resolve_emit(cfg, out)
    # Capture the LOCAL theme before the pull overwrites harness.config.json.
    config_theme = _config_theme(here)

    pre = _preflight()
    if not pre.ok:
        log(f"[geneseed] {pre.message}")
        return 3 if pre.kind == "info" else 1

    code, behind, err = _measure_upstream()
    if code == "fetch_failed":
        log(f"[geneseed] could not reach the remote: {err}")
        return 1
    if code == "unrelated":
        log("[geneseed] Upstream history was rewritten; back up local work, then re-clone "
            "or `git reset --hard @{u}`.")
        return 3
    if code == "diverged":
        log("[geneseed] Your branch has local commits and can't fast-forward — push/rebase "
            "or reset first.")
        return 3
    if code == "ready":
        ok, fcode, msg = _pull_and_validate(log)
        if not ok:
            log(f"[geneseed] {msg}")
            return 3 if fcode == "collision" else 1
    else:  # uptodate
        log("[geneseed] already up to date.")

    theme = theme_arg or _marker_theme(cfg, out) or config_theme
    _migrate_stray_bundle(here, out, log)
    rc = _rebuild_bundle(here, out, theme, emit, root_dir, log)
    if rc != 0:
        log(f"[geneseed][E-BUILD] ✗ the bundle build FAILED (theme: {theme or 'default'}, emit: {emit}).")
        return 1
    log("[geneseed] ✓ upgrade complete." + (f" (full log: {log.path})" if log.path else ""))
    return 0
```

Move the daemon-bounce block into `_rebuild_bundle` after the build subprocess (unchanged behavior). `_rebuild_bundle` returns the build returncode.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_update.py::UpgradeFlowTests -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add rituals/_update.py tests/test_update.py
git commit -m "feat(update): rewrite upgrade() as preflight -> git pull -> rebuild"
```

---

### Task 7: `sync_self`/`update` alias `upgrade`; `main()` drops `--zip`

**Files:**
- Modify: `rituals/_update.py` (`sync_self` ~line 671, `main` ~line 724)
- Test: `tests/test_update.py`

- [ ] **Step 1: Write the failing test**

```python
class AliasTests(unittest.TestCase):
    def test_sync_self_calls_upgrade(self):
        with mock.patch.object(_update, "upgrade", return_value=0) as up:
            self.assertEqual(_update.sync_self(), 0)
        up.assert_called_once()

    def test_main_update_calls_upgrade(self):
        with mock.patch.object(_update, "upgrade", return_value=0) as up:
            self.assertEqual(_update.main(["update"]), 0)
        up.assert_called_once()

    def test_main_rejects_unknown(self):
        self.assertEqual(_update.main(["frobnicate"]), 2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_update.py::AliasTests -q`
Expected: FAIL — `sync_self` still runs the old script-copy path; `main` still has `--zip`.

- [ ] **Step 3: Write minimal implementation**

Replace `sync_self` body:

```python
def sync_self(ref=None) -> int:
    """A single `git pull` now refreshes launchers AND factory together, so sync-self
    is an alias of upgrade (kept for the stable subcommand contract)."""
    return upgrade()
```

Replace `main()` with the download-free version (keep the UTF-8 reconfigure preamble; drop the `--zip` parsing block):

```python
def main(argv=None) -> int:
    """Standalone self-heal entry: `python rituals/_update.py {upgrade|sync-self|update}`.
    STABLE CONTRACT. A stray positional ref is accepted and ignored (git pulls the
    current branch)."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8")
            except (ValueError, OSError):
                pass
    argv = list(sys.argv[1:] if argv is None else argv)
    cmd = argv[0] if argv else ""
    if cmd in ("upgrade", "update", "sync-self", "sync_self"):
        return upgrade()
    sys.stderr.write("geneseed self-heal: usage: python rituals/_update.py "
                     "{upgrade|sync-self|update}\n")
    return 2
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_update.py::AliasTests -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add rituals/_update.py tests/test_update.py
git commit -m "feat(update): sync-self/update alias upgrade; drop --zip from main"
```

---

## Phase 2 — Delete the download/zip stack

### Task 8: Remove the network + zip machinery from `_update.py`

**Files:**
- Modify: `rituals/_update.py`
- Test: `tests/test_update.py` (delete stale suites)

- [ ] **Step 1: Delete the dead code**

Remove these definitions entirely from `rituals/_update.py`: `_net_timeout`, `_urlopen`, `_curl_get`, `_human`, `_progress`, `_curl_failure_reason`, `_exc_reason`, `_resolve_sha`, `_curl_download`, `_urllib_download`, `_download`, `_git_clone_source`, `_fetch_source`, `_doctor_signature` (only if unused after — it is used by `_fetch_and_validate`; see below), `_fetch_and_validate`, `_extract_local_zip`, `_local_zip_source`. Remove the constants `REPO`, `SYNC`, `SCRIPTS`, `ATTEMPTS`, and the `_refresh_item` function. Remove now-unused imports (`zipfile`, `urllib.request`) and the `_UpgradeError` class if no longer referenced.

Keep: `_Log`, `DOCTOR_LEGEND`, `_run_doctor`, `_opencode_config_dir`, `_resolve_emit`, `_marker_theme`, `_migrate_stray_bundle`, `_config_theme`, and all Phase-1 additions.

Note on `_doctor_signature`: it existed only to compare retry fingerprints in `_fetch_and_validate`. With no retry loop it is dead — delete it and its test `DoctorSignatureTests` unless another caller remains (grep first: `git grep _doctor_signature`).

- [ ] **Step 2: Delete the stale test suites**

In `tests/test_update.py` delete: `UrlopenTests`, `CurlDownloadTests`, `UrllibDownloadTests`, `LocalZipTests`, `GitCloneSourceTests`, `RefreshItemTests`, and `DoctorSignatureTests` (per the grep above). Delete `test_fetch_source_prefers_clone`. Keep `ThemeTests`, `StrayBundleTests`, and all Phase-1 suites.

- [ ] **Step 3: Run the full update test file**

Run: `python -m pytest tests/test_update.py -q`
Expected: PASS — no import errors, no references to deleted names.

- [ ] **Step 4: Grep for stranded references**

Run: `git grep -nE "_git_clone_source|_fetch_source|_local_zip_source|GENESEED_SRC|_resolve_sha|_download\b|REPO =" rituals/ tests/`
Expected: no matches in `rituals/_update.py` (matches elsewhere are addressed in later tasks).

- [ ] **Step 5: Commit**

```bash
git add rituals/_update.py tests/test_update.py
git commit -m "refactor(update): delete the HTTP download and offline-zip stack"
```

---

## Phase 3 — harness + lifecycle rewire

### Task 9: `harness.py` drops `--zip`; `cmd_upgrade` drops `zip_arg`

**Files:**
- Modify: `rituals/harness.py` (upgrade subparser, lines 224–226)
- Modify: `rituals/_harness_lifecycle.py` (`cmd_upgrade`, line 299)

- [ ] **Step 1: Remove the `--zip` argument**

In `rituals/harness.py`, delete lines 224–226 (the `up.add_argument("--zip", ...)` block). Leave the `ref`/`theme` positionals (harmless; `upgrade` ignores `ref`).

- [ ] **Step 2: Stop forwarding `zip_arg`**

In `rituals/_harness_lifecycle.py:299`, change:

```python
    return _update.upgrade(args.ref, args.theme, zip_arg=getattr(args, "zip", None))
```
to:
```python
    return _update.upgrade(args.ref, args.theme)
```

- [ ] **Step 3: Verify the CLI still parses**

Run: `python rituals/harness.py upgrade --help`
Expected: help text with **no** `--zip` option, exit 0.

- [ ] **Step 4: Commit**

```bash
git add rituals/harness.py rituals/_harness_lifecycle.py
git commit -m "refactor(harness): drop --zip from upgrade"
```

---

### Task 10: Collapse the two-step bootstrap; treat exit 3 as "skipped"

**Files:**
- Modify: `rituals/_harness_lifecycle.py` (`_update_step_cmd` L139, `_run_steps` L220, `_bootstrap_progress` L237, `_bootstrap_plain` L258)

- [ ] **Step 1: Drop `ref` from `_update_step_cmd`**

Change `_update_step_cmd(here, sub, ref)` (L139) to take no `ref` and stop appending it:

```python
def _update_step_cmd(here: Path, sub: str) -> list:
    """The command for one update step, self-healing a STALE factory. Prefer the
    in-tree `harness.py <sub>`; fall back to `rituals/_update.py <sub>` when harness.py
    predates the subcommand."""
    hp = str(here / "rituals" / "harness.py")
    if _harness_supports(hp, sub):
        return [sys.executable, hp, sub]
    return [sys.executable, str(here / "rituals" / "_update.py"), sub]
```

- [ ] **Step 2: Collapse both bootstrap drivers to a single step**

In `_bootstrap_progress` (L237–238) replace the two-step list with:

```python
    steps = [("Update & rebuild", _update_step_cmd(here, "upgrade"))]
```

In `_bootstrap_plain` (L258–259) replace with:

```python
    steps = [("Update & rebuild", _update_step_cmd(here, "upgrade"))]
```

(Remove the now-unused `ref`/`r` plumbing in those two functions where it only fed `_update_step_cmd`; the interactive `ref` prompt in `_bootstrap_progress` can be dropped since `ref` is ignored.)

- [ ] **Step 3: Treat exit 3 (info precondition) as "skipped", not "failed"**

In `_run_steps` (L220), change the status mapping so an info-precondition exit is not a red failure:

```python
        status[i] = "done" if rc in (0, 3) else "failed"
```

In `_bootstrap_plain` (L264), change `if rc != 0:` to `if rc not in (0, 3):` so an info precondition (dirty tree, etc.) doesn't print a failure diagnosis.

- [ ] **Step 4: Verify**

Run: `python -c "import sys; sys.path.insert(0,'rituals'); import _harness_lifecycle as L; print(L._update_step_cmd(__import__('pathlib').Path('.'), 'upgrade'))"`
Expected: a 3-element argv ending in `upgrade` (no trailing ref).

- [ ] **Step 5: Commit**

```bash
git add rituals/_harness_lifecycle.py
git commit -m "refactor(lifecycle): single-step bootstrap; exit 3 = skipped"
```

---

## Phase 4 — web back-end

### Task 11: `update` preflight branch (422) + remove `/api/offline-zip`

**Files:**
- Modify: `rituals/_web_server.py` (actions handler ~L163, offline route L69–73)
- Test: `tests/test_web.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_web.py` (follow the file's existing harness for exercising the server/handler; if it tests via `action_commands`/a request helper, mirror that). Minimal intent:

```python
def test_update_precondition_returns_422_and_no_job(self):
    import _update
    pf = _update.Preflight(False, "dirty", "info", "local changes")
    with mock.patch.object(_update, "_preflight", return_value=pf):
        status, body = self.post_action("update")   # helper that POSTs /api/actions/update
    self.assertEqual(status, 422)
    self.assertEqual(body["kind"], "info")
    self.assertEqual(body["precondition"], "dirty")
```

If `tests/test_web.py` has no request helper, assert at the handler-branch level instead (call the branch function directly). Match the file's existing style.

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_web.py -q -k update_precondition`
Expected: FAIL — no update branch; falls through to the generic job spawn.

- [ ] **Step 3: Implement the handler branch**

In `rituals/_web_server.py`, inside the `if path.startswith("/api/actions/"):` block (after the `deploy` branch, before the generic `if action == "build":` at L198), add:

```python
                if action == "update":
                    import _update
                    pre = _update._preflight()
                    if not pre.ok:
                        return self._send_json(
                            {"precondition": pre.code, "kind": pre.kind,
                             "message": pre.message}, 422)
                    jid = jm.start("update", *action_commands("update"), on_done=state.refresh)
                    if jid is None:
                        return self._send_json({"error": "busy"}, 409)
                    return self._send_json({"job_id": jid}, 202)
```

Remove the `/api/offline-zip` GET route (L69–73). If `offline_zip_bytes` was imported by name at the top of `_web_server.py`, remove that import too (grep: `git grep -n offline_zip_bytes rituals/_web_server.py`).

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/test_web.py -q -k update_precondition`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rituals/_web_server.py tests/test_web.py
git commit -m "feat(web): update action gates on preflight (422); drop offline-zip route"
```

---

### Task 12: `_web_jobs.py` — `update` → single `upgrade`

**Files:**
- Modify: `rituals/_web_jobs.py` (L162)
- Test: `tests/test_web.py` (L237)

- [ ] **Step 1: Update the failing assertion**

In `tests/test_web.py:237`, change the assertion that expects `sync-self` in `cmds[0]` to expect a single `upgrade` step:

```python
        cmds = action_commands("update")
        self.assertEqual(len(cmds), 1)
        self.assertIn("upgrade", cmds[0])
        self.assertNotIn("sync-self", " ".join(str(c) for c in cmds[0]))
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_web.py -q -k update`
Expected: FAIL — table still returns two steps.

- [ ] **Step 3: Implement**

In `rituals/_web_jobs.py:162`, change:

```python
        "update": [[py, h, "sync-self"], [py, h, "upgrade"]],
```
to:
```python
        "update": [[py, h, "upgrade"]],
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/test_web.py -q -k update`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rituals/_web_jobs.py tests/test_web.py
git commit -m "refactor(web): update action runs a single upgrade step"
```

---

### Task 13: Delete `offline_zip_bytes` + `OFFLINE_ZIP_SKIP`

**Files:**
- Modify: `rituals/_web_graph.py` (L94–118)
- Test: `tests/test_web.py` (L893 suite)

- [ ] **Step 1: Delete the offline-zip test**

Remove `test_offline_zip_holds_the_source_tree` (and any helper it uses) from `tests/test_web.py`.

- [ ] **Step 2: Delete the code**

Remove `OFFLINE_ZIP_SKIP` (L94) and `offline_zip_bytes()` (L97–118) from `rituals/_web_graph.py`. If `io`/`zipfile` become unused in that module, leave them (they come from the `_web_core import *` shared surface; removing is optional).

- [ ] **Step 3: Grep for stranded references**

Run: `git grep -n "offline_zip_bytes\|OFFLINE_ZIP_SKIP\|/api/offline-zip"`
Expected: only matches left are the Settings card (Task 16) and docs (Task 20) — none in `rituals/`.

- [ ] **Step 4: Run the web tests**

Run: `python -m pytest tests/test_web.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rituals/_web_graph.py tests/test_web.py
git commit -m "refactor(web): remove offline-zip package generator"
```

---

### Task 14: `_about()` reflects the origin

**Files:**
- Modify: `rituals/_web_docs.py` (`_about`, L274–287)
- Test: `tests/test_web.py`

- [ ] **Step 1: Write the failing test**

```python
def test_about_repo_reflects_origin(self):
    import _update
    od = _update.OriginDisplay("https://gitlab.corp/team/gs", None)
    with mock.patch.object(_update, "_origin_display", return_value=od):
        payload = _web_docs._about(self.state)   # match the file's state fixture
    self.assertEqual(payload["repo"], "https://gitlab.corp/team/gs")
    self.assertFalse(payload["repo_is_github"])
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_web.py -q -k about_repo`
Expected: FAIL — `repo` is still the hardcoded Arylmera URL; no `repo_is_github`.

- [ ] **Step 3: Implement**

In `rituals/_web_docs.py:_about()`, replace the hardcoded `repo` line (L285) with a lazy origin lookup:

```python
def _about(state: WebState) -> dict:
    """About-page payload: version line, deployed install summary, links."""
    import _update  # lazy: avoids pulling build + its sys.path side effect at web import time
    od = _update._origin_display()
    sd = harness._status_data()
    return {
        "version": sd.get("version") or {},
        "theme": state.theme,
        "emit": state.emit,
        "deployed": _deployed(state),
        "target": str(state.target),
        "root": str(ROOT),
        "python": sys.version.split()[0],
        "repo": od.url,
        "repo_is_github": bool(od.github_slug),
        "license": "MIT",
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/test_web.py -q -k about_repo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rituals/_web_docs.py tests/test_web.py
git commit -m "feat(web): About payload reflects the install origin"
```

---

## Phase 5 — web front-end

### Task 15: Surface the precondition body as an info toast

**Files:**
- Modify: `web/src/api/http.js` (`fail`, L12–17)
- Modify: `web/src/App.jsx` (`onError`, L50)
- Modify: `web/src/styles.css` (after L774)

- [ ] **Step 1: Attach the response body to the Error**

In `web/src/api/http.js`, change `fail`:

```javascript
async function fail(r) {
  const body = await r.json().catch(() => ({}))
  const err = new Error(body.error || body.message || r.statusText)
  err.status = r.status
  err.body = body
  return err
}
```

- [ ] **Step 2: Make `onError` honor an info body**

In `web/src/App.jsx:50`, change:

```javascript
  const onError = (e) => setToast({ kind: 'err', msg: e.message })
```
to:
```javascript
  const onError = (e) =>
    setToast({ kind: e?.body?.kind || 'err', msg: e?.body?.message || e.message })
```

- [ ] **Step 3: Add the info toast style**

In `web/src/styles.css`, after the `.toast.err` rule (L774) add:

```css
.toast.info { border-color: color-mix(in srgb, var(--accent) 45%, var(--line-2)); }
```

- [ ] **Step 4: Verify the build compiles**

Run: `cd web && npm run build`
Expected: build succeeds (no eslint/vite errors).

- [ ] **Step 5: Commit**

```bash
git add web/src/api/http.js web/src/App.jsx web/src/styles.css
git commit -m "feat(web): route precondition body to an info toast"
```

---

### Task 16: Settings — remove offline card, add Update button

**Files:**
- Modify: `web/src/pages/Settings/index.jsx` (maintenance row L195–217; offline card L220–233)

- [ ] **Step 1: Remove the offline-package card**

Delete the entire `{/* Offline package card */}` block (L220–233).

- [ ] **Step 2: Add an "Update" button to the maintenance row**

In the maintenance `<div className="row wrap gap-10">` (starts L195), add as the first button:

```jsx
          <button className="btn ghost" onClick={() => onAction('update')}>
            <Icon name="download" />
            Update (git pull + rebuild)
          </button>
```

(`onAction` is the same prop already used by the Add-to-PATH / Uninstall buttons in this component; confirm it is `runAction` threaded from `App.jsx`.)

- [ ] **Step 3: Verify the build compiles**

Run: `cd web && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Settings/index.jsx
git commit -m "feat(web): add Update button; remove offline-package card"
```

---

### Task 17: Gate the About deep links on `repo_is_github`

**Files:**
- Modify: `web/src/pages/Docs/About.jsx` (links L34–52)
- Modify: `web/src/pages/About.jsx` (standalone route)

- [ ] **Step 1: Gate the Docs/About deep links**

In `web/src/pages/Docs/About.jsx`, replace the links block (L34–52) so the `/issues` and `/blob/main/LICENSE` deep links render only for a github origin:

```jsx
      <div className="row wrap gap-10" style={{ marginTop: 18 }}>
        <a className="btn ghost" href={page.repo} target="_blank" rel="noreferrer">
          <Icon name="external" />
          {page.repo_is_github ? 'GitHub repo' : 'Source repo'}
        </a>
        {page.repo_is_github && (
          <>
            <a className="btn ghost" href={`${page.repo}/issues`} target="_blank" rel="noreferrer">
              <Icon name="external" />
              File an issue
            </a>
            <a className="btn ghost" href={`${page.repo}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
              <Icon name="external" />
              License
            </a>
          </>
        )}
      </div>
```

- [ ] **Step 2: Make the standalone About reflect the origin**

Rewrite `web/src/pages/About.jsx` to fetch the about payload and use the resolved repo, falling back to the `Arylmera` constant. Replace the two hardcoded link `<a>`s that use `REPO_URL` with origin-aware ones; keep the creator link hardcoded. Concretely, add state + fetch at the top of the component:

```jsx
import React, { useEffect, useState } from 'react'
import { Icon } from '../components/Icon.jsx'
import { api } from '../api/index.js'

const FALLBACK_REPO = 'https://github.com/Arylmera/Geneseed'
const CREATOR_URL = 'https://github.com/Arylmera'

export default function About() {
  const [repo, setRepo] = useState(FALLBACK_REPO)
  const [isGithub, setIsGithub] = useState(true)
  useEffect(() => {
    api.docsPage('about')
      .then((p) => { if (p?.repo) { setRepo(p.repo); setIsGithub(!!p.repo_is_github) } })
      .catch(() => {})
  }, [])
  // ...existing markup, but replace REPO_URL usages with `repo`, and render the
  // /issues + /blob/main/LICENSE deep links only when `isGithub` (same pattern as
  // Docs/About.jsx Step 1). The "Source on GitHub" label becomes
  // `${isGithub ? 'Source on GitHub' : 'Source repo'}`.
}
```

Ensure `api.docsPage` is exported through `web/src/api/index.js` (it is defined in `api/docs.js`; confirm the barrel re-exports the docs module).

- [ ] **Step 3: Verify the build compiles**

Run: `cd web && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Docs/About.jsx web/src/pages/About.jsx
git commit -m "feat(web): About links reflect origin; gate github deep links"
```

---

### Task 18: Rebuild and commit `web/dist`

**Files:**
- Modify: `web/dist/**` (generated)

- [ ] **Step 1: Rebuild the tracked bundle**

Run: `cd web && npm run build`
Expected: `web/dist/**` regenerated (new hashed asset filenames).

- [ ] **Step 2: Verify no `Arylmera` hardcode remains in the shipped bundle for the update path**

Run: `git grep -n "offline-zip" web/dist/ || echo "clean"`
Expected: `clean` (the removed offline route is no longer referenced by the built JS).

- [ ] **Step 3: Commit**

```bash
git add web/dist
git commit -m "build(web): rebuild dist for the git-pull update UI"
```

---

## Phase 6 — docs, config, final sweep

### Task 19: `.gitattributes` + doc rewrites

**Files:**
- Create: `.gitattributes`
- Modify: `README.md`, `SETUP.md`, `CHANGELOG.md`, `DESIGN.md`, `bootstrap`, `geneseed`

- [ ] **Step 1: Add `.gitattributes`**

Create `.gitattributes` at the repo root:

```gitattributes
* text=auto eol=lf
```

- [ ] **Step 2: Rewrite the update docs**

- `README.md`: change the `geneseed upgrade` description from "downloads + validates the published source" to "**git-pulls** the install's origin (fast-forward only), validates via `doctor`, then rebuilds the bundle." Remove any `--zip`/offline-download mention. Leave the public clone URL as `Arylmera`.
- `SETUP.md`: same rewrite; delete the `--zip` offline paragraph.
- `CHANGELOG.md`: add an entry noting the pivot to git-based self-update; drop "SHA-pinned archive" wording where it described the old mechanism.
- `DESIGN.md`: add a one-line "self-update = git pull + rebuild; source = install origin" note.

- [ ] **Step 3: Rewrite the launcher cure text**

In `bootstrap` (around L60–63) and `geneseed` (around L90–91), replace the `curl … /archive/refs/heads/main.zip` manual-cure echo with a git-based cure, e.g.:

```
echo "  cd <geneseed-folder> && git pull --ff-only && ./geneseed upgrade" >&2
```

- [ ] **Step 4: Grep for any remaining stranded references**

Run: `git grep -nE "offline-zip|--zip|GENESEED_SRC|codeload|/archive/refs" -- . ':!docs/superpowers/specs' ':!web/dist'`
Expected: no functional matches (only historical CHANGELOG lines, if any, are acceptable).

- [ ] **Step 5: Commit**

```bash
git add .gitattributes README.md SETUP.md CHANGELOG.md DESIGN.md bootstrap geneseed
git commit -m "docs(update): git-pull self-update; add .gitattributes; fix cure text"
```

---

### Task 20: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `python -m pytest tests/ -q`
Expected: all pass. (Fallback: `python -m unittest discover -s tests -v`.)

- [ ] **Step 2: Doctor the tree**

Run: `python rituals/harness.py doctor --all --no-bundle`
Expected: exit 0, no problems.

- [ ] **Step 3: Smoke-test the CLI on this very checkout (clean tree required)**

Run: `python rituals/harness.py upgrade`
Expected: either "already up to date." + a rebuild, or an info line if the tree is dirty — never a traceback. Exit 0 (up to date) or 3 (info).

- [ ] **Step 4: Final grep sweep**

Run: `git grep -nE "_git_clone_source|_fetch_source|_local_zip_source|offline_zip_bytes|zip_arg" -- rituals/ web/src/ tests/`
Expected: no matches.

- [ ] **Step 5: Commit any residual fixes, then finish the branch**

If steps surfaced fixes, commit them. Then use the `superpowers:finishing-a-development-branch` skill to decide merge/PR.

---

## Self-Review

**Spec coverage:**
- §0 shared git contract → Task 2 (`_git`), Task 5 (doctor timeout), Task 4 (`network` fetch guards). ✓
- §1 two-phase preflight → Tasks 3 (A) + 4 (B). ✓
- §2 `_pull_and_validate` + rollback + `--no-bundle` → Task 5. ✓
- §3 upgrade always rebuilds; sync-self/update alias; exit codes; main; harness/lifecycle rewire; bootstrap collapse → Tasks 6, 7, 9, 10. ✓
- §4 deletions incl. offline-zip web surface → Tasks 8, 11, 13. ✓
- §5 web popup (422, http.js body, info toast, Update button) → Tasks 11, 15, 16. ✓
- §6 origin display + gated deep links → Tasks 2, 14, 17. ✓
- §7 tests → each task's tests + Task 8/19 deletions. ✓
- §8 docs + `.gitattributes` + pivot note → Task 19. ✓

**Placeholder scan:** No "TBD"/"handle edge cases" steps; every code step shows real code. The only prose-guided step is Task 17 Step 2 (standalone About rewrite), which shows the new imports/state/fetch and points to the identical link-gating pattern established in Step 1 — acceptable because the exact pattern is given.

**Type consistency:** `Preflight(ok, code, kind, message)`, `OriginDisplay(url, github_slug)`, `_git(...) -> (rc, out, err)`, `_measure_upstream() -> (code, behind, err)`, `_pull_and_validate(log) -> (ok, code, message)`, `upgrade() -> int (0/1/3)` used consistently across Tasks 2–7 and the web handler (Task 11 reads `pre.code`/`pre.kind`/`pre.message`; Task 14 reads `od.url`/`od.github_slug`). ✓
