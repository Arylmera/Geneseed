// The OpenCode guard's ownership first-write gate, the twin of js/hosts/ownership-gate.mjs. Written
// out, not recorded. V1 refuses by THROWING `[geneseed-guard] blocked: <reason>` (no guard
// switch named: no refusal names one); V2 cannot throw, so the call is renamed
// to that text. Once per (session, repo); a session with no user to ask (a subagent, ruling D29,
// or a headless `geneseed-*` session) is never refused; a `## Ownership` section defers. The
// reason is the hook's, word for word, and so is the marker that makes "once" outlive a restart.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { pathToFileURL, fileURLToPath } from "node:url"
import guardDefault, { GeneseedGuard } from "../../adapters/opencode/plugins/geneseed-guard.js"
import { GeneseedContext } from "../../adapters/opencode/plugins/geneseed-context.js"
import { ownershipBlock as hookBlock, ownershipLine as hookLine } from "../../js/hosts/ownership-gate.mjs"
import { normcase } from "../../js/lib/paths.mjs"
import { makeSandbox } from "../helpers/sandbox.mjs"

const boxes = []
after(() => boxes.forEach((b) => b.cleanup()))
// The guard writes the hook's session marker under the OS temp dir, read at each call from the
// variables `os.tmpdir()` honours. The whole file points them at a sandbox, so no run leaves a
// marker in the real one.
const TMP_VARS = ["TMP", "TEMP", "TMPDIR"]
const realTmp = TMP_VARS.map((k) => process.env[k])
const setTmp = (values) => TMP_VARS.forEach((k, i) => { if (values[i] === undefined) delete process.env[k]; else process.env[k] = values[i] })
const markers = makeSandbox("gsown-oc-markers-")
boxes.push(markers)
setTmp(TMP_VARS.map(() => markers.path))
after(() => setTmp(realTmp))
function app(files = { "package.json": "{}" }) {
  const sb = makeSandbox("gsown-oc-")
  boxes.push(sb)
  fs.mkdirSync(path.join(sb.path, ".git"))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(sb.path, rel)), { recursive: true })
    fs.writeFileSync(path.join(sb.path, rel), text)
  }
  return sb.path
}

// The hook-side reason for the same repo, computed in process with its marker in a sandbox.
function hookReason(file) {
  const tmp = makeSandbox("gsown-oc-tmp-")
  boxes.push(tmp)
  const saved = [process.env.TMP, process.env.TEMP, process.env.TMPDIR]
  process.env.TMP = process.env.TEMP = process.env.TMPDIR = tmp.path
  try {
    return hookBlock(file, { session_id: randomUUID(), tool_name: "Write" }, "x")
  } finally {
    [process.env.TMP, process.env.TEMP, process.env.TMPDIR] = saved
    for (const [k, v] of [["TMP", saved[0]], ["TEMP", saved[1]], ["TMPDIR", saved[2]]]) if (v === undefined) delete process.env[k]
  }
}

async function v1(hook, sessionID, filePath, tool = "write", args = { filePath, content: "x" }) {
  try {
    await hook({ tool, sessionID }, { args })
    return null
  } catch (err) {
    if (String(err?.message || "").startsWith("[geneseed-guard]")) return String(err.message)
    throw err
  }
}

test("V1: the first write of a session throws the hook's reason, once; a new session again", async () => {
  const repo = app()
  const hook = (await GeneseedGuard({ directory: repo }))["tool.execute.before"]
  const file = path.join(repo, "src.js")
  const sid = randomUUID()
  const msg = await v1(hook, sid, file)
  assert.equal(msg, `[geneseed-guard] blocked: ${hookReason(file)}`, "the twin's reason drifted from the hook's")
  assert.doesNotMatch(msg, /GENESEED_GUARD=off/)
  assert.equal(await v1(hook, sid, path.join(repo, "other.js")), null, "the second write passes")
  assert.match(await v1(hook, randomUUID(), file), /^\[geneseed-guard\] blocked: Geneseed \(Ownership\)/)
})

test("V1: a section on or off, the setup's own files, no session, no manifest: no block", async () => {
  const hook = (await GeneseedGuard({}))["tool.execute.before"]
  const off = app({ "package.json": "{}", "AGENTS.md": "# x\r\n\r\n## Ownership\r\n\r\nmode: off\r\n" })
  assert.equal(await v1(hook, randomUUID(), path.join(off, "a.js")), null, "mode: off (CRLF)")
  const bare = app()
  assert.equal(await v1(hook, randomUUID(), path.join(bare, "AGENTS.md")), null, "AGENTS.md")
  assert.equal(await v1(hook, randomUUID(), path.join(bare, ".geneseed", "ownership.md")), null, ".geneseed/")
  assert.equal(await v1(hook, undefined, path.join(bare, "a.js")), null, "no sessionID")
  assert.equal(await v1(hook, randomUUID(), path.join(app({ "README.md": "" }), "a.js")), null, "no manifest")
  const block = app({ "package.json": "{}", "AGENTS.md": "<!-- BEGIN GENESEED -->\n## Ownership\n<!-- END GENESEED -->\n" })
  assert.match(await v1(hook, randomUUID(), path.join(block, "a.js")), /Geneseed \(Ownership\)/, "managed block only")
})

test("V1: a child session (a subagent) never spends the block", async () => {
  const repo = app()
  const client = { session: { get: async ({ path: p }) => ({ data: p.id === "child" ? { parentID: "root" } : {} }) } }
  const hook = (await GeneseedGuard({ directory: repo, client }))["tool.execute.before"]
  assert.equal(await v1(hook, "child", path.join(repo, "a.js")), null)
  assert.match(await v1(hook, "root", path.join(repo, "a.js")), /Geneseed \(Ownership\)/)
})

// A session with no user to ask is never refused: a child (a parent id), and a headless session
// Geneseed started itself, which has NO parent and a title that starts `geneseed-` (a workflow's
// agents are created as `geneseed-wf:<label>`). The rule is the context plugin's
// `isSkippedSession`. Any other title is a user's session: refused once.
test("a headless geneseed-* session is not asked; a user's session is, once", async () => {
  const repo = app()
  const titles = { wf: "geneseed-wf:x", mine: "my work" }
  const hook = (await GeneseedGuard({ directory: repo, sessionMeta: async (sid) => ({ title: titles[sid] }) }))["tool.execute.before"]
  assert.equal(await v1(hook, "wf", path.join(repo, "a.js")), null, "a workflow agent's first write")
  assert.equal(await v1(hook, "wf", path.join(repo, "b.js")), null)
  assert.match(await v1(hook, "mine", path.join(repo, "a.js")), /Geneseed \(Ownership\)/)
  assert.equal(await v1(hook, "mine", path.join(repo, "b.js")), null, "once")
})

// "Once" is the hook's marker file, in the hook's scheme, not only this module's memory:
// `<tmpdir>/geneseed-ownership-<user>/<session id>`, one case-folded root per line. So a resumed
// session is not refused again after OpenCode restarts (a fresh import of the plugin stands in for
// the restart: its in-memory record is empty), and the hook defers for a session and repo the
// guard has already asked about. A marker that cannot be written defers, as in the hook: the
// alternative is a refusal on every write of the session.
test("the session marker is the hook's file: it survives a restart, and a failed write defers", async () => {
  const repo = app()
  const file = path.join(repo, "a.js")
  const sid = randomUUID()
  const hook = (await GeneseedGuard({ directory: repo }))["tool.execute.before"]
  assert.match(await v1(hook, sid, file), /Geneseed \(Ownership\)/)
  const dirs = fs.readdirSync(markers.path).filter((n) => n.startsWith("geneseed-ownership-"))
  assert.equal(dirs.length, 1, "one per-user marker folder")
  assert.ok(fs.readFileSync(path.join(markers.path, dirs[0], sid), "utf8").split("\n").includes(normcase(repo)))
  const plugin = pathToFileURL(fileURLToPath(new URL("../../adapters/opencode/plugins/geneseed-guard.js", import.meta.url)))
  const restarted = await import(`${plugin.href}?restarted`)
  assert.notEqual(restarted.GeneseedGuard, GeneseedGuard, "a fresh module, with an empty in-memory record")
  const again = (await restarted.GeneseedGuard({ directory: repo }))["tool.execute.before"]
  assert.equal(await v1(again, sid, file), null, "refused again after a restart")
  assert.equal(hookBlock(file, { session_id: sid, tool_name: "Write" }, "x"), null, "the hook reads the same marker")
  assert.match(await v1(again, randomUUID(), file), /Geneseed \(Ownership\)/, "another session is still asked")

  // A temp dir that is a file: the marker folder cannot be made.
  const blocker = path.join(markers.path, "not-a-dir")
  fs.writeFileSync(blocker, "")
  setTmp(TMP_VARS.map(() => blocker))
  try {
    assert.equal(await v1(hook, randomUUID(), file), null, "no marker, no refusal")
  } finally { setTmp(TMP_VARS.map(() => markers.path)) }
})

// The gate reads the hook's tool class (`WRITE_NAME_RE`), not only the guard's write class: a
// move, a rename, a copy or a delete is a first write to the repo too. A read is not.
test("a move, copy or delete tool spends the block like a write; a read does not", async () => {
  for (const tool of ["mcp_move_file", "fs_rename", "copy_file", "delete_file", "mcp_trash", "apply_diff"]) {
    const repo = app()
    const hook = (await GeneseedGuard({ directory: repo }))["tool.execute.before"]
    const args = { source: path.join(repo, "a.js"), destination: path.join(repo, "b.js") }
    assert.match(String(await v1(hook, randomUUID(), null, tool, args)), /Geneseed \(Ownership\)/, tool)
  }
  const repo = app()
  const hook = (await GeneseedGuard({ directory: repo }))["tool.execute.before"]
  assert.equal(await v1(hook, randomUUID(), null, "read_file", { path: path.join(repo, "a.js") }), null)
})

test("V2: the refused call is renamed to the reason and emptied; the next one is untouched", async () => {
  const repo = app()
  let before = null
  const ctx = {
    location: { directory: repo, project: { directory: repo } },
    tool: { hook: async (name, fn) => { if (name === "execute.before") before = fn } },
    session: { get: async ({ sessionID }) => (sessionID === "kid" ? { parentID: "p" } : { title: "work" }) },
  }
  await guardDefault.setup(ctx)
  const ev = (sessionID) => ({ tool: "write", sessionID, input: { filePath: path.join(repo, "a.js"), content: "x" } })
  const kid = ev("kid")
  await before(kid)
  assert.equal(kid.tool, "write", "a child session is not refused")
  const first = ev("s1")
  await before(first)
  assert.match(first.tool, /^BLOCKED, not a missing tool: \[geneseed-guard\] blocked: Geneseed \(Ownership\)/)
  assert.deepEqual(first.input, {})
  const second = ev("s1")
  await before(second)
  assert.equal(second.tool, "write")
})

// D2/D4: the developer's personal decline, three ways on one table — the hook gate, this guard,
// and the reminder line (the hook's `ownershipLine` and the context plugin's twin). The gate
// defers exactly where the line prints; a section in AGENTS.md outranks the decline (no block,
// no line); a malformed line is no decline (block, no line).
//
// The decline is read from the MAIN worktree (user ruling 2026-10-29: a fresh linked worktree per
// session must not lose it). In a linked worktree, a decline in the main checkout counts and one
// in the worktree itself does not; a `.git` file that names no gitdir falls back to the current
// root, as before the ruling.
const DECLINE = { ".geneseed/ownership.md": "Setup: declined 2026-10-29\n" }
// A linked worktree, laid out by hand as `git worktree add` does: its `.git` FILE names
// `<main>/.git/worktrees/w`, whose `commondir` (`../..`) names the main `.git`.
function linked(mainFiles, wtFiles = {}, dotgit = null) {
  const main = app({ "package.json": "{}", ...mainFiles })
  const gitdir = path.join(main, ".git", "worktrees", "w")
  fs.mkdirSync(gitdir, { recursive: true })
  fs.writeFileSync(path.join(gitdir, "commondir"), "../..\n")
  const wt = app({ "package.json": "{}", ...wtFiles })
  fs.rmSync(path.join(wt, ".git"), { recursive: true })   // app() made it a directory
  const text = typeof dotgit === "function" ? dotgit(wt, gitdir) : dotgit
  fs.writeFileSync(path.join(wt, ".git"), text ?? `gitdir: ${gitdir}\n`)
  return wt
}
test("the decline line: hook gate, guard and context reminder agree, row by row", async () => {
  const LINE = 'Ownership: setup declined since 2026-10-29 — not set up; say "set up ownership" to run it'
  const plain = (files) => () => app({ "package.json": "{}", ...files })
  const rows = [
    // [label, repo builder, blocked, line]
    ["no decline", plain({}), true, null],
    ["decline only", plain(DECLINE), false, LINE],
    ["decline, CRLF", plain({ ".geneseed/ownership.md": "Granularity: team\r\nSetup: declined 2026-10-29\r\n" }), false, LINE],
    // An editor's leading BOM must not hide a first-line decline from the `^` anchor.
    ["decline after a BOM", plain({ ".geneseed/ownership.md": "\uFEFFSetup: declined 2026-10-29\n" }), false, LINE],
    ["decline and a section", plain({ ...DECLINE, "AGENTS.md": "## Ownership\nmode: on\n" }), false, null],
    ["malformed date", plain({ ".geneseed/ownership.md": "Setup: declined 29/10/2026\n" }), true, null],
    ["linked worktree, decline in the main", () => linked(DECLINE), false, LINE],
    // `git worktree add --relative-paths` writes the gitdir relative to the worktree.
    ["linked worktree, RELATIVE gitdir, decline in the main",
      () => linked(DECLINE, {}, (wt, gitdir) => `gitdir: ${path.relative(wt, gitdir).replace(/\\/g, "/")}\n`), false, LINE],
    ["linked worktree, no decline anywhere", () => linked({}), true, null],
    ["linked worktree, decline only in itself", () => linked({}, DECLINE), true, null],
    ["malformed .git file, decline in the main", () => linked(DECLINE, {}, "not a link\n"), true, null],
    ["malformed .git file, decline in itself", () => linked({}, DECLINE, "not a link\n"), false, LINE],
  ]
  const savedWiki = process.env.GENESEED_WIKI
  const wiki = makeSandbox("gsown-oc-wiki-")
  boxes.push(wiki)
  fs.writeFileSync(path.join(wiki.path, "w.jsonc"), '{ "wikis": [] }')
  process.env.GENESEED_WIKI = path.join(wiki.path, "w.jsonc")
  const client = { session: { get: async () => ({ data: { title: "user session" } }), messages: async () => [] } }
  try {
    for (const [label, build, blocked, line] of rows) {
      const repo = build()
      const file = path.join(repo, "a.js")
      const hook = (await GeneseedGuard({ directory: repo }))["tool.execute.before"]
      const guard = await v1(hook, randomUUID(), file)
      const reason = hookReason(file)
      assert.equal(reason !== null, blocked, `hook gate: ${label}`)
      assert.equal(guard, reason === null ? null : `[geneseed-guard] blocked: ${reason}`, `guard: ${label}`)
      assert.equal(hookLine(repo), line, `hook line: ${label}`)
      const ctx = await GeneseedContext({ client, directory: repo, worktree: repo })
      const output = { messages: [{ info: { id: "u1", role: "user", sessionID: "s1" }, parts: [{ type: "text", text: "go" }] }] }
      await ctx["experimental.chat.messages.transform"]({}, output)
      const own = output.messages.flatMap((m) => (m.parts ?? []).flatMap((p) => String(p.text ?? "").split("\n")))
        .filter((l) => l.startsWith("Ownership:"))
      assert.deepEqual(own, line ? [line] : [], `context plugin: ${label}`)
    }
  } finally {
    if (savedWiki === undefined) delete process.env.GENESEED_WIKI; else process.env.GENESEED_WIKI = savedWiki
  }
})
