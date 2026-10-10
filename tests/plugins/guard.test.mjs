// Tests for the OpenCode guard plugin's cross-platform safety matching — in particular
// that Windows-style (backslash) secret paths and Windows/PowerShell catastrophic
// commands are caught, not just their POSIX equivalents — and for the protected-wiki
// enforcement (AGENT.md §8) driven by a geneseed-wiki.jsonc manifest.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import { GeneseedGuard } from "../../adapters/opencode/plugins/geneseed-guard.js"
import { makeSandbox } from "../helpers/sandbox.mjs";

// The wiki manifest must be in place before the FIRST hook call — the guard caches
// the protected prefixes on a TTL, so a hook call without $GENESEED_WIKI set would
// cache an empty list for the whole run.
const tmp = makeSandbox("gsguard-").path
const vault = path.join(tmp, "Brain")
await fs.mkdir(path.join(vault, "Codex"), { recursive: true })
// Written as JSONC on purpose — the seeded stub ships commented, so the guard must
// tolerate comments and trailing commas (and leave // inside strings alone).
await fs.writeFile(path.join(tmp, "geneseed-wiki.jsonc"), `// machine wikis
{
  /* one vault */
  "wikis": [{
    "name": "Brain",
    "path": ${JSON.stringify(vault)},
    "description": "see https://example.com — not a comment",
    "protected": ["Codex/"],
  }],
}
`)
process.env.GENESEED_WIKI = path.join(tmp, "geneseed-wiki.jsonc")

after(async () => {
  delete process.env.GENESEED_WIKI
  await fs.rm(tmp, { recursive: true, force: true })
})

const hook = (await GeneseedGuard())["tool.execute.before"]

// Returns true if the guard blocked (threw); false if it allowed the call.
async function blocked(tool, args) {
  try {
    await hook({ tool, args }, {})
    return false
  } catch (err) {
    if (String(err?.message || "").startsWith("[geneseed-guard]")) return true
    throw err
  }
}

test("blocks a write to a Windows-style .ssh private key path", async () => {
  assert.equal(await blocked("write", { filePath: "C:\\Users\\me\\.ssh\\id_rsa" }), true)
})

test("blocks a write to a Windows-style .aws credentials path", async () => {
  assert.equal(await blocked("edit", { path: "C:\\Users\\me\\.aws\\credentials" }), true)
})

test("still blocks the POSIX .ssh path (no regression)", async () => {
  assert.equal(await blocked("write", { filePath: "/home/me/.ssh/id_ed25519" }), true)
})

test("does NOT block an ordinary Windows source-file write", async () => {
  assert.equal(await blocked("write", { filePath: "C:\\repo\\src\\main.py" }), false)
})

test("only warns (does not block) a Windows .env edit", async () => {
  assert.equal(await blocked("write", { filePath: "C:\\repo\\.env" }), false)
})

test("blocks a Windows recursive drive wipe (rd /s /q C:\\)", async () => {
  assert.equal(await blocked("bash", { command: "rd /s /q C:\\" }), true)
})

test("blocks a PowerShell Remove-Item -Recurse -Force", async () => {
  assert.equal(await blocked("shell", { command: "Remove-Item -Recurse -Force C:\\data" }), true)
})

test("blocks a Windows drive format", async () => {
  assert.equal(await blocked("exec", { command: "format C:" }), true)
})

test("still blocks rm -rf / (no regression)", async () => {
  assert.equal(await blocked("bash", { command: "rm -rf /" }), true)
})

// A recursive rm whose target is the filesystem root or the home dir — bare, globbed, or
// after a `--` / split flags — is blocked. Bare `rm -rf /` GNU rm refuses on its own; the
// globbed and `~` forms it does not. Any narrower target is ordinary work and passes.
for (const [command, want] of [
  ["rm -rf /*", true],
  ["rm -rf ~/*", true],
  ["rm -rf ~", true],
  ["rm -rf ~/", true],
  ["rm -rf -- /", true],
  ["rm -r -f /", true],
  ["rm -f -r /*", true],
  ["rm --recursive --force /", true],
  ["rm -Rf /", true],
  ["rm -rf --no-preserve-root /", true],
  ["cd x && rm -rf /* ", true],
  ["rm -rf ./build", false],
  ["rm -rf /tmp/x", false],
  ["rm -rf ~/projects/old", false],
  ["rm -rf build/*", false],
  ["rm -f /", false],            // not recursive: rm refuses a directory without -r
]) {
  test(`rm root/home guard: ${JSON.stringify(command)} -> ${want ? "blocked" : "allowed"}`, async () => {
    assert.equal(await blocked("bash", { command }), want)
  })
}

// ---- protected wiki folders (AGENT.md §8) --------------------------------------

test("blocks a write under a protected wiki folder", async () => {
  assert.equal(await blocked("write", { filePath: path.join(vault, "Codex", "law.md") }), true)
})

test("blocks a delete-class mutation under a protected wiki folder", async () => {
  assert.equal(await blocked("delete_file", { path: path.join(vault, "Codex", "law.md") }), true)
})

test("protected match is slash- and case-insensitive", async () => {
  const winStyle = path.join(vault, "Codex", "law.md").replace(/\//g, "\\").toUpperCase()
  assert.equal(await blocked("edit", { filePath: winStyle }), true)
})

test("does NOT block a write elsewhere in the wiki", async () => {
  assert.equal(await blocked("write", { filePath: path.join(vault, "Notes", "idea.md") }), false)
})

test("does NOT block a write outside any wiki", async () => {
  assert.equal(await blocked("write", { filePath: path.join(tmp, "elsewhere.md") }), false)
})

test("a non-mutating tool ignores protected paths", async () => {
  assert.equal(await blocked("read", { filePath: path.join(vault, "Codex", "law.md") }), false)
})

// ---- the gate ledger ------------------------------------------------------------------
// One JSON line per BLOCK into `<harness>/notebook/gates.jsonl`, the rule and never the
// content — the same file and vocabulary the Claude-family hook writes, so `geneseed status`
// counts one thing across hosts. An allowed call writes nothing; without a notebook/ dir
// nothing is written and nothing is created (this test file imports the plugin from the
// checkout, whose parent has no notebook/ — that silence is what keeps the repo clean).

test("a block is ledgered under the rule it tripped; an allow writes nothing", async () => {
  const harness = path.join(tmp, "harness")
  await fs.mkdir(path.join(harness, "notebook"), { recursive: true })
  const saved = process.env.GENESEED_HARNESS
  process.env.GENESEED_HARNESS = harness
  try {
    const ledger = path.join(harness, "notebook", "gates.jsonl")
    assert.equal(await blocked("write", { filePath: "src/ok.js" }), false)
    assert.equal(await isFileAt(ledger), false, "an allow must not touch the ledger")
    assert.equal(await blocked("write", { filePath: "/home/me/.ssh/id_rsa" }), true)
    assert.equal(await blocked("bash", { command: "rm -rf /" }), true)
    assert.equal(await blocked("write", { filePath: path.join(vault, "Codex", "x.md") }), true)
    const lines = (await fs.readFile(ledger, "utf8")).trim().split("\n").map((l) => JSON.parse(l))
    assert.deepEqual(lines.map((l) => [l.verb, l.rule]),
      [["guard", "law-1"], ["guard", "law-4"], ["guard", "wiki"]])
    for (const l of lines) {
      assert.match(l.ts, /^\d{4}-\d{2}-\d{2}T/)
      assert.ok(!("command" in l) && !("path" in l), JSON.stringify(l))
    }
  } finally {
    if (saved === undefined) delete process.env.GENESEED_HARNESS
    else process.env.GENESEED_HARNESS = saved
  }
})

test("no notebook/ dir means no ledger and no mkdir", async () => {
  const harness = path.join(tmp, "bare")
  await fs.mkdir(harness, { recursive: true })
  const saved = process.env.GENESEED_HARNESS
  process.env.GENESEED_HARNESS = harness
  try {
    assert.equal(await blocked("bash", { command: "rm -rf /" }), true)
    assert.equal(await isFileAt(path.join(harness, "notebook", "gates.jsonl")), false)
  } finally {
    if (saved === undefined) delete process.env.GENESEED_HARNESS
    else process.env.GENESEED_HARNESS = saved
  }
})

async function isFileAt(p) { try { return (await fs.stat(p)).isFile() } catch { return false } }

// ---- SHELL_WARN_RE: Deletion Is Deliberate, the WARN tier --------------------------
// Mirrors js/hosts/hooks.mjs's DESTRUCTIVE_GIT_RE (law-4) — `tool.execute.before` has no ask
// tier, so these warn (console.error, logged but allowed) rather than block. Captures stderr
// around the call rather than reusing `blocked()`, since a warn never throws.
async function warned(command) {
  const calls = []
  const orig = console.error
  console.error = (msg) => calls.push(String(msg))
  try {
    await hook({ tool: "bash", args: { command } }, {})
  } finally {
    console.error = orig
  }
  return calls.some((m) => m.includes("WARN: irreversible op"))
}

// B5 (claude-code.md / claude-verdict.md), confirmed live, all inside Law IV's "deletion of
// what version control cannot restore": the long/modern spellings alongside the two acts this
// list already had (force push, reset --hard).
for (const cmd of [
  "git push --force origin feature",
  "git reset --hard HEAD~1",
  "git clean --force",
  "git branch --delete --force x",
  "git branch --force --delete x",
  "git restore .",
  "git restore src/file.js",
  // `--staged --worktree` together restores the working tree too, discarding exactly like
  // plain `restore` — unlike `--staged` alone (see the negative below).
  "git restore --staged --worktree x",
  "git push origin :main",
  "git push --delete origin x",
  "git checkout -f",
  "git checkout --force",
  "git switch -f other",
  // `git switch -h` lists `-f, --force` and `--discard-changes` as two separate options.
  "git switch --force",
  "git switch --discard-changes",
  "git stash drop",
  "git stash clear",
  "git worktree remove --force ../wt",
  "git reflog expire --expire=now",
  "git gc --prune=now",
]) {
  test(`SHELL_WARN_RE: ${JSON.stringify(cmd)} warns, never blocks`, async () => {
    assert.equal(await blocked("bash", { command: cmd }), false, "a warn must never throw")
    assert.equal(await warned(cmd), true, "expected a Deletion Is Deliberate warning")
  })
}

// Negatives, same rule as the Node gate: `--staged` ALONE only unstages, and an un-forced
// `branch --delete` refuses on an unmerged branch exactly like `-d`, so neither warns. And
// because `restore`/`stash drop`/`stash clear` have no required flag or use ordinary English
// words, they are anchored to VERB POSITION — a command whose MESSAGE or FILENAME merely
// contains the word must never warn.
for (const cmd of [
  "git restore --staged x",
  "git restore --staged .",
  "git branch --delete merged",
  "git add src/restore.js",
  "git checkout restore-ui-fix",
  'git commit -m "restore working behavior"',
  'git stash push -m "clear old state"',
  'git commit -m "drop the old flag"',
]) {
  test(`SHELL_WARN_RE: ${JSON.stringify(cmd)} does not warn`, async () => {
    assert.equal(await warned(cmd), false)
  })
}

// ---- content secret scan (Sealed Secrets, the twin of js/hosts/hooks.mjs's ruleDecide) -----
// The path check above only ever saw the FILENAME; this is the body that would land on disk.

test("blocks a write whose content carries a credential-shaped string", async () => {
  assert.equal(await blocked("write", { filePath: "src/config.js", content: "const k = 'AKIAABCDEFGHIJKLMNOP'" }), true)
})

test("blocks an edit whose newString carries a credential-shaped string", async () => {
  assert.equal(await blocked("edit", { filePath: "src/config.js", oldString: "x", newString: "ghp_" + "a".repeat(36) }), true)
})

test("blocks an apply_patch whose + line carries a credential-shaped string", async () => {
  const dest = path.join(tmp, "patched", "src", "config.js").replace(/\\/g, "/")
  const text = patch(`*** Add File: ${dest}`, "+const k = '" + "sk-ant-" + "a".repeat(24) + "'")
  assert.equal(await blocked("apply_patch", { patchText: text }), true)
})

test("does NOT block an apply_patch when the credential-shaped string is only on a - line", async () => {
  const dest = path.join(tmp, "patched", "src", "config2.js").replace(/\\/g, "/")
  const text = patch(`*** Update File: ${dest}`, "@@", "-const k = '" + "sk-ant-" + "a".repeat(24) + "'", "+const k = loadFromEnv()")
  assert.equal(await blocked("apply_patch", { patchText: text }), false)
})

test("an ordinary write passes the content scan", async () => {
  assert.equal(await blocked("write", { filePath: "src/plain.js", content: "console.log('hello')" }), false)
})

test("a credential-shaped string written to a .env file only warns, not blocked", async () => {
  assert.equal(await blocked("write", { filePath: ".env", content: "AKIA_KEY=AKIAABCDEFGHIJKLMNOP" }), false)
})

test("SECRET_CONTENT_RE stays in parity with the Node hook's SECRET_RE (Law I twin)", async () => {
  const guardSrc = await fs.readFile(
    path.join(process.cwd(), "adapters/opencode/plugins/geneseed-guard.js"), "utf8")
  const hookSrc = await fs.readFile(path.join(process.cwd(), "js/hosts/hooks.mjs"), "utf8")
  const guardRe = guardSrc.match(/const SECRET_CONTENT_RE =\s*\r?\n\s*(\/.*\/)\s*\r?\n/)
  const hookRe = hookSrc.match(/const SECRET_RE =\s*\r?\n\s*(\/.*\/);/)
  assert.ok(guardRe, "SECRET_CONTENT_RE not found in geneseed-guard.js")
  assert.ok(hookRe, "SECRET_RE not found in js/hosts/hooks.mjs")
  assert.equal(guardRe[1], hookRe[1],
    "the guard's content-secret pattern drifted from js/hosts/hooks.mjs's SECRET_RE — keep the two byte-identical")
})

// ---- permission.ask: not registered (OpenCode verdict I-2) --------------------------
// Upstream declares a `permission.ask` hook in its plugin types but never triggers it:
// `Permission.ask` (packages/opencode/src/permission/index.ts) evaluates the rules and
// publishes the `permission.asked` bus event with no plugin hook in between. A hook
// registered there is dead code that a test could only exercise by calling it directly,
// so the guard registers none — loops on OpenCode get the static commit/push ask.

test("permission.ask: the guard registers no dead permission hook", async () => {
  const hooks = await GeneseedGuard({ directory: tmp })
  assert.equal(hooks["permission.ask"], undefined)
  assert.deepEqual(Object.keys(hooks), ["tool.execute.before"])
})

// ---- protected checks (External Gate) ------------------------------------------
// Same list as the Claude/Bob rule-gate reads: `.geneseed/protected-checks.txt` in the repo.
// OpenCode has no ask tier, so a write there is refused outright; GENESEED_GUARD=off allows it.

test("blocks a write under a protected check path, not beside it", async () => {
  const repo = path.join(tmp, "sensed")
  await fs.mkdir(path.join(repo, ".git"), { recursive: true })
  await fs.mkdir(path.join(repo, ".geneseed"), { recursive: true })
  await fs.writeFile(path.join(repo, ".geneseed", "protected-checks.txt"), "# sensors\ntests/\n")
  assert.equal(await blocked("write", { filePath: path.join(repo, "tests", "a.test.js") }), true)
  assert.equal(await blocked("edit", { filePath: path.join(repo, ".geneseed", "protected-checks.txt") }), true)
  assert.equal(await blocked("write", { filePath: path.join(repo, "testsuite", "a.js") }), false)
  assert.equal(await blocked("write", { filePath: path.join(repo, "src", "a.js") }), false)
})

// The manifest was `wiki.jsonc` before the `geneseed-` prefix; an install not yet re-emitted still
// has only that name, and its protected folders must stay protected. A fresh module instance (the
// query string) so the main instance's cached prefixes do not answer; $GENESEED_WIKI unset so the
// lookup walks $GENESEED_HARNESS: a write under the legacy manifest's protected folder is blocked.
test("a legacy wiki.jsonc under $GENESEED_HARNESS still protects its folders", async () => {
  const harness = path.join(tmp, "legacy-harness")
  const old = path.join(tmp, "OldVault")
  await fs.mkdir(path.join(old, "Locked"), { recursive: true })
  await fs.mkdir(harness, { recursive: true })
  await fs.writeFile(path.join(harness, "wiki.jsonc"),
    JSON.stringify({ wikis: [{ name: "Old", path: old, protected: ["Locked/"] }] }))
  const prevWiki = process.env.GENESEED_WIKI, prevHarness = process.env.GENESEED_HARNESS
  delete process.env.GENESEED_WIKI
  process.env.GENESEED_HARNESS = harness
  try {
    const fresh = await import("../../adapters/opencode/plugins/geneseed-guard.js?legacy-wiki")
    const h = (await fresh.GeneseedGuard())["tool.execute.before"]
    await assert.rejects(h({ tool: "write", args: { filePath: path.join(old, "Locked", "x.md") } }, {}),
      /\[geneseed-guard\]/)
  } finally {
    process.env.GENESEED_WIKI = prevWiki
    if (prevHarness === undefined) delete process.env.GENESEED_HARNESS
    else process.env.GENESEED_HARNESS = prevHarness
  }
})

// ---- apply_patch (OpenCode verdict I-1) ----------------------------------------
// gpt-5* models get ONLY `apply_patch` (no `edit`/`write`) — every path lives inside
// `patchText` as a `*** Add File:`/`*** Update File:`/`*** Delete File:`/`*** Move to:`
// marker line (upstream `packages/opencode/src/patch/index.ts` `parsePatchHeader`), never
// in `filePath`/`path`/etc. Markers carry an absolute path here so the assertion is not
// also exercising cwd resolution against `ctx.directory` (covered separately below).

function patch(...lines) {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n")
}

test("apply_patch: a patch adding a secret file is blocked", async () => {
  const dest = path.join(tmp, "patched", ".ssh", "id_rsa").replace(/\\/g, "/")
  const text = patch(`*** Add File: ${dest}`, "+ -----BEGIN OPENSSH PRIVATE KEY-----")
  assert.equal(await blocked("apply_patch", { patchText: text }), true)
})

test("apply_patch: a patch touching a protected test file is blocked", async () => {
  const repo = path.join(tmp, "sensed-patch")
  await fs.mkdir(path.join(repo, ".git"), { recursive: true })
  await fs.mkdir(path.join(repo, ".geneseed"), { recursive: true })
  await fs.writeFile(path.join(repo, ".geneseed", "protected-checks.txt"), "tests/\n")
  const target = path.join(repo, "tests", "a.test.js").replace(/\\/g, "/")
  const text = patch("*** Update File: " + target, "@@", "-old", "+new")
  assert.equal(await blocked("apply_patch", { patchText: text }), true)
})

test("apply_patch: a benign patch passes", async () => {
  const dest = path.join(tmp, "patched", "src", "main.py").replace(/\\/g, "/")
  const text = patch(`*** Add File: ${dest}`, "+print('hi')")
  assert.equal(await blocked("apply_patch", { patchText: text }), false)
})

test("apply_patch: an Update File with a Move to resolves BOTH the old and new path", async () => {
  const repo = path.join(tmp, "sensed-move")
  await fs.mkdir(path.join(repo, ".git"), { recursive: true })
  await fs.mkdir(path.join(repo, ".geneseed"), { recursive: true })
  await fs.writeFile(path.join(repo, ".geneseed", "protected-checks.txt"), "tests/\n")
  const from = path.join(repo, "src", "a.js").replace(/\\/g, "/")
  const to = path.join(repo, "tests", "a.js").replace(/\\/g, "/")
  const text = patch(`*** Update File: ${from}`, `*** Move to: ${to}`, "@@", "-old", "+new")
  assert.equal(await blocked("apply_patch", { patchText: text }), true)
})

test("apply_patch: a relative marker path resolves against ctx.directory", async () => {
  const repo = path.join(tmp, "patch-cwd")
  await fs.mkdir(repo, { recursive: true })
  const fresh = await import("../../adapters/opencode/plugins/geneseed-guard.js?patch-cwd")
  const h = (await fresh.GeneseedGuard({ directory: repo }))["tool.execute.before"]
  const text = patch("*** Add File: .ssh/id_rsa", "+ secret")
  await assert.rejects(h({ tool: "apply_patch", args: { patchText: text } }, {}),
    /\[geneseed-guard\]/)
})

// Upstream's own `apply_patch` tool resolves every marker path against `instance.directory`
// (`apply_patch.ts:72`), not against a wider worktree root. `ctx.worktree` is a DIFFERENT,
// wider root used elsewhere in this file for the git-branch checks — if patch-path
// resolution preferred `ctx.worktree` over `ctx.directory` the way `root()` does, a session
// started in a worktree subdirectory would check the wrong file and miss a real hit one
// directory up from where the write actually lands.
test("apply_patch: resolves against ctx.directory, not the wider ctx.worktree", async () => {
  const repo = path.join(tmp, "patch-subdir")
  const sub = path.join(repo, "sub")
  await fs.mkdir(path.join(repo, ".git"), { recursive: true })
  await fs.mkdir(path.join(repo, ".geneseed"), { recursive: true })
  await fs.mkdir(sub, { recursive: true })
  await fs.writeFile(path.join(repo, ".geneseed", "protected-checks.txt"), "sub/tests/\n")
  const fresh = await import("../../adapters/opencode/plugins/geneseed-guard.js?patch-subdir")
  const h = (await fresh.GeneseedGuard({ worktree: repo, directory: sub }))["tool.execute.before"]
  // `instance.directory` (here `sub`) + "tests/a.js" = repo/sub/tests/a.js, which the
  // protected list covers via "sub/tests/".
  const text = patch("*** Update File: tests/a.js", "@@", "-old", "+new")
  await assert.rejects(h({ tool: "apply_patch", args: { patchText: text } }, {}),
    /\[geneseed-guard\]/)
})
