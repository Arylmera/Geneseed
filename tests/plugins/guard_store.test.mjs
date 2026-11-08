// What a rule write LANDS on, on every family. The rows come from the security review's lab:
// each is a spelling, a decoy or a detour that once reached the store with no prompt. Memory is written
// freely (owner decision, 2026-11-08): the spelling rows that once aimed at a memory file now aim at
// user-rules.md in the same folder, and the "memory is free" rows hold that a memory write passes. Expected verdicts
// are written out. `ask` means the guard stands aside for the host's own prompt, `refused` that it stops
// the call, and `pass` that the call is ordinary work. A global install and a project install each get a
// real copy of the plugin, because the stores are found from where the plugin sits.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { opencodeEditAsks } from "../../js/hosts/settings.mjs"
import { spawnHook } from "../helpers/hook_run.mjs"
import { homeOverrides, makeSandbox } from "../helpers/sandbox.mjs"

const WIN = process.platform === "win32"
const sb = makeSandbox("gs-store-")
const home = sb.path
const saved = Object.fromEntries(["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "GENESEED_HARNESS", "GENESEED_MEMORY", "GENESEED_GUARD"]
  .map((k) => [k, process.env[k]]))
Object.assign(process.env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, ".config") })
for (const k of ["GENESEED_HARNESS", "GENESEED_MEMORY", "GENESEED_GUARD"]) delete process.env[k]
after(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  sb.cleanup()
})

const posix = (p) => p.replace(/\\/g, "/")
const cfg = path.join(home, ".config", "opencode")
const tier = path.join(home, ".config", "geneseed", "memory")
const proj = path.join(home, "proj")
const pcfg = path.join(proj, ".opencode")
for (const d of [path.join(cfg, "plugins"), path.join(cfg, "memory"), path.join(cfg, "notebook"), tier,
  path.join(pcfg, "plugins"), path.join(proj, "Harness", "memory"), path.join(proj, "docs")]) fs.mkdirSync(d, { recursive: true })
const SRC = path.resolve("adapters/opencode/plugins/geneseed-guard.js")
fs.copyFileSync(SRC, path.join(cfg, "plugins", "geneseed-guard.js"))
fs.copyFileSync(SRC, path.join(pcfg, "plugins", "geneseed-guard.js"))
const globalMod = await import(pathToFileURL(path.join(cfg, "plugins", "geneseed-guard.js")).href)
const projectMod = await import(pathToFileURL(path.join(pcfg, "plugins", "geneseed-guard.js")).href)

const keysOf = (dir, global, agentRel) => Object.fromEntries(opencodeEditAsks(dir, global, agentRel).map((k) => [k, "ask"]))
const client = (edit, agents = async () => ({ data: [] })) => ({ config: { get: async () => ({ data: { permission: { edit } } }) }, ...(agents ? { app: { agents } } : {}) })
const v1 = (mod, edit, dir = proj, agents = undefined) => mod.GeneseedGuard({ worktree: dir, directory: dir, client: client(edit, agents) })
const hookOf = await v1(globalMod, keysOf(cfg, true))
const noKeys = await v1(globalMod, {})
const always = await v1(globalMod, keysOf(cfg, true))
await always.event({ event: { type: "permission.asked", properties: { id: "p", permission: "edit" } } })
await always.event({ event: { type: "permission.replied", properties: { requestID: "p", reply: "always" } } })

async function verdict(h, tool, args) {
  try { await h["tool.execute.before"]({ tool, sessionID: "s" }, { args }); return "pass" } catch (e) {
    if (String(e?.message).startsWith("[geneseed-guard]")) return "refused"
    throw e
  }
}
const mem = posix(path.join(cfg, "memory"))
const P = "*** Begin Patch\n"
const E = "\n*** End Patch"
const rules = path.join(proj, "user-rules.md")
const cfgRules = `${posix(cfg)}/user-rules.md`
const free = (why, h, tool, args) => [`memory is free: ${why}`, h, tool, args, "pass"]
// This machine's admin share and the device-path prefix, for a drive path.
const share = (p) => `\\\\localhost\\${p[0].toLowerCase()}$\\${p.slice(3)}`
const device = (p) => `\\\\?\\${p}`
// A repository with a protected check (External Gate).
const checked = path.join(home, "checked")
fs.mkdirSync(path.join(checked, ".git"), { recursive: true })
fs.mkdirSync(path.join(checked, ".geneseed"), { recursive: true })
fs.writeFileSync(path.join(checked, ".geneseed", "protected-checks.txt"), "ci.yml\n")

const WRITE_ROWS = [
  ["no prompt wired", noKeys, "write", { filePath: cfgRules, content: "a" }, "refused"],
  ["the host asks", hookOf, "write", { filePath: cfgRules, content: "a" }, "pass"],
  ["after an always", always, "write", { filePath: cfgRules, content: "a" }, "refused"],
  ["a .. spelling", always, "write", { filePath: `${posix(path.join(cfg, "notebook"))}/../user-rules.md`, content: "a" }, "refused"],
  ["a // spelling", always, "write", { filePath: `${posix(cfg)}//user-rules.md`, content: "a" }, "refused"],
  ["a /./ spelling, the tier", always, "write", { filePath: `${posix(path.dirname(tier))}/./user-rules.draft.md`, content: "a" }, "refused"],
  free("a fact, no prompt wired", noKeys, "write", { filePath: `${mem}/x.md`, content: "a" }),
  free("a fact after an always", always, "write", { filePath: `${mem}/x.md`, content: "a" }),
  free("the tier", noKeys, "write", { filePath: path.join(tier, "x.md"), content: "a" }),
  free("the index, by patch", always, "apply_patch", { patchText: `${P}*** Delete File: MEMORY.md${E}` }),
  free("an MCP append", hookOf, "mcp_fs_append_file", { path: "MEMORY.md", content: "a" }),
  ["a decoy empty patchText", always, "write", { filePath: rules, content: "a", patchText: "" }, "refused"],
  ["a decoy patch over a store", noKeys, "edit", { filePath: cfgRules, oldString: "a", newString: "b", patchText: `${P}*** End Patch` }, "refused"],
  ["a decoy patch over a secret", hookOf, "write", { filePath: "C:/u/.ssh/id_rsa", content: "a", patchText: "" }, "refused"],
  ["a decoy path beside the target", noKeys, "write", { path: "notes.txt", filePath: rules, content: "a" }, "refused"],
  ["a credential beside a decoy patch", hookOf, "write", { filePath: path.join(proj, "a.js"), patchText: "", content: "AKIAIOSFODNN7EXAMPLE" }, "refused"],
  ["an MCP write, file_path", noKeys, "fs_write_file", { file_path: rules, content: "a" }, "refused"],
  ["an MCP write, wired or not", hookOf, "fs_write_file", { path: rules, content: "a" }, "refused"],
  ["an MCP move, destination", hookOf, "fs_move_file", { source: "a", destination: rules }, "refused"],
  ["an MCP copy, dest", hookOf, "fs_copy_file", { source: "a", dest: rules }, "refused"],
  ["an MCP write, an unknown key", hookOf, "fs_write_file", { outputs: [{ where: rules }] }, "refused"],
  ["an MCP move, ordinary", hookOf, "fs_move_file", { source: "a", destination: "b.txt" }, "pass"],
  ["text that mentions the store", hookOf, "fs_write_file", { path: "a.md", content: "see user-rules.md" }, "pass"],
  ["multiedit is no native tool", hookOf, "multiedit", { filePath: rules, edits: [] }, "refused"],
  ["apply_patch, the host asks", hookOf, "apply_patch", { patchText: `${P}*** Add File: user-rules.md\n+x${E}` }, "pass"],
  ["apply_patch, no prompt", noKeys, "apply_patch", { patchText: `${P}*** Add File: user-rules.md\n+x${E}` }, "refused"],
  ["a patch move onto a coined name", noKeys, "patch", { patchText: `${P}*** Update File: a.md\n*** Move to: user-rules.md\n@@\n-a\n+b${E}` }, "refused"],
  ["a patch delete after an always", always, "apply_patch", { patchText: `${P}*** Delete File: user-rules.draft.md${E}` }, "refused"],
  ["the guard itself after an always", always, "write", { filePath: path.join(cfg, "plugins", "geneseed-guard.js"), content: "a" }, "refused"],
  ["opencode.json after an always", always, "edit", { filePath: path.join(proj, "opencode.json"), oldString: "a", newString: "b" }, "refused"],
  ["opencode.json with the prompt alive", hookOf, "edit", { filePath: path.join(proj, "opencode.json"), oldString: "a", newString: "b" }, "pass"],
  ["a repo's own memory folder", hookOf, "write", { filePath: path.join(proj, "src", "memory", "notes.md"), content: "a" }, "pass"],
  ["ordinary markdown", noKeys, "write", { filePath: path.join(proj, "docs", "notes.md"), content: "a" }, "pass"],
  // Exact case outside a store, on Windows too: this is another file and must not be trapped.
  ["a differently cased name", noKeys, "write", { filePath: path.join(proj, "docs", "concepts", "memory.md"), content: "a" }, "pass"],
  free("any case inside a store", noKeys, "write", { filePath: `${mem}/Notes.MD`, content: "a" }),
  // A named read set, and every other tool walked: the names here are the ones that once passed.
  ["an MCP append", hookOf, "mcp_fs_append_file", { path: "user-rules.md", content: "a" }, "refused"],
  ["an MCP put", hookOf, "mcp_s3_put", { file_path: "user-rules.md", body: "a" }, "refused"],
  ["an MCP download", hookOf, "mcp_http_download", { url: "http://x/y", dest: "user-rules.md" }, "refused"],
  ["an MCP truncate", hookOf, "mcp_fs_truncate", { path: "user-rules.md" }, "refused"],
  ["a tool whose name holds 'run'", hookOf, "mcp_prune_write", { path: "user-rules.md" }, "refused"],
  ["a nested path", hookOf, "mcp_write_doc", { data: { path: "Harness/nothing/../../user-rules.md" } }, "refused"],
  ["a long padded path", hookOf, "mcp_write_doc", { out: `${"./".repeat(600)}user-rules.md` }, "refused"],
  ["a file URL", hookOf, "mcp_write_doc", { uri: pathToFileURL(rules).href }, "refused"],
  ["a from/to pair", hookOf, "fs_move", { from: "a", to: "user-rules.md" }, "refused"],
  ["a title is text", hookOf, "mcp_notion_create_page", { title: "MEMORY.md" }, "pass"],
  ["a title is text, separator or not", hookOf, "mcp_notion_create_page", { title: "docs/MEMORY.md" }, "pass"],
  ["a free-text comment with a slash", hookOf, "mcp_linear_create_comment", { comment: "see docs/MEMORY.md" }, "pass"],
  ["a free-text path key still reads", hookOf, "mcp_fs_write", { output_path: "docs and more/user-rules.md" }, "refused"],
  ["an update verb beside a read word", hookOf, "mcp_get_or_update_file", { path: "user-rules.md" }, "refused"],
  ["a sync verb", hookOf, "mcp_list_and_sync", { path: "user-rules.md" }, "refused"],
  ["arguments nested past the bound", hookOf, "mcp_write_doc", Array.from({ length: 40 }).reduce((a) => ({ a }), { path: "notes.txt" }), "refused"],
  ["arguments nested within the bound", hookOf, "mcp_write_doc", Array.from({ length: 5 }).reduce((a) => ({ a }), { path: "notes.txt" }), "pass"],
  ["a read tool", hookOf, "mcp_x_search", { path: "MEMORY.md" }, "pass"],
  ["a host read", hookOf, "read", { filePath: "MEMORY.md" }, "pass"],
  ["a host grep", hookOf, "grep", { pattern: "x", path: `${mem}` }, "pass"],
  ["another scheme's URL", hookOf, "mcp_http_download", { url: "http://x/MEMORY.md", dest: "a.txt" }, "pass"],
  ...(WIN ? [["an admin share", noKeys, "write", { filePath: `\\\\localhost\\${mem[0].toLowerCase()}$\\${mem.slice(3).replaceAll("/", "\\")}\\..\\user-rules.md`, content: "a" }, "refused"],
    ["a device path", noKeys, "write", { filePath: `\\\\?\\${mem.replaceAll("/", "\\")}\\..\\user-rules.md`, content: "a" }, "refused"],
    // The same two spellings aimed at a gate's own file and at a protected check, which the guard
    // judges through `nativeAskFile` and `protectedCheck`.
    ["an admin share, opencode.json", always, "write", { filePath: share(path.join(proj, "opencode.json")), content: "a" }, "refused"],
    ["a device path, opencode.json", always, "write", { filePath: device(path.join(proj, "opencode.json")), content: "a" }, "refused"],
    ["an admin share, a protected check", noKeys, "write", { filePath: share(path.join(checked, "ci.yml")), content: "a" }, "refused"],
    ["a device path, a protected check", noKeys, "write", { filePath: device(path.join(checked, "ci.yml")), content: "a" }, "refused"]] : []),
]
for (const [why, h, tool, args, want] of WRITE_ROWS) {
  test(`write: ${why}`, async () => assert.equal(await verdict(h, tool, args), want))
}

test("NTFS: a stream, trailing dots and spaces land on the file itself", { skip: !WIN }, async () => {
  for (const f of ["user-rules.md::$DATA", "MEMORY.md::$DATA", "user-rules.md:s", "user-rules.md.", "user-rules.md ", "user-rules.md. ."]) {
    assert.equal(await verdict(always, "write", { filePath: path.join(proj, f), content: "a" }), "refused", f)
    assert.equal(await verdict(noKeys, "edit", { filePath: path.join(proj, f), oldString: "a", newString: "b" }), "refused", f)
  }
  assert.equal(await verdict(hookOf, "write", { filePath: path.join(proj, "a.txt:hidden"), content: "a" }), "refused", "any stream")
})

test("links: a file link into a rule store lands in it; a memory file linked there is a rule write", async (t) => {
  const file = path.join(proj, "notes.md")
  const dir = path.join(proj, "m")
  const linked = path.join(cfg, "memory", "linked.md")
  fs.writeFileSync(path.join(cfg, "user-rules.md"), "x")
  try {
    fs.symlinkSync(path.join(cfg, "user-rules.md"), file, "file")
    fs.symlinkSync(path.join(cfg, "memory"), dir, "junction")
    fs.symlinkSync(path.join(cfg, "user-rules.md"), linked, "file")
  } catch (e) { t.skip(`no link rights: ${e.code}`); return }
  assert.equal(await verdict(always, "write", { filePath: file, content: "a" }), "refused")
  assert.equal(await verdict(noKeys, "write", { filePath: linked, content: "a" }), "refused", "a memory file linked to user-rules.md")
  assert.equal(await verdict(noKeys, "write", { filePath: path.join(dir, "x.md"), content: "a" }), "pass", "memory through a folder link is still memory")
  fs.rmSync(linked)
  assert.equal(await verdict(hookOf, "write", { filePath: file, content: "a" }), "refused", "a link has no key: V1 cannot prompt for it")
  assert.equal(await verdict(hookOf, "bash", { command: `echo x > "${posix(file)}"`, workdir: proj }), "refused")
  fs.rmSync(file); fs.rmSync(dir, { recursive: true })
  // Dangling: nothing to resolve, and the write would create the rule file.
  fs.symlinkSync(path.join(proj, "no-such", "user-rules.md"), file, "file")
  assert.equal(await verdict(always, "write", { filePath: file, content: "a" }), "refused", "a dangling link")
  fs.rmSync(file)
  // Two hops, and a hop through a folder link, both dangling at the end.
  const hop = path.join(proj, "hop.md"); const two = path.join(proj, "two.txt"); const g = path.join(proj, "g")
  fs.symlinkSync(path.dirname(tier), g, "junction")
  fs.symlinkSync(path.join(path.dirname(tier), "user-rules.draft.md"), hop, "file")
  fs.symlinkSync("hop.md", two, "file")
  assert.equal(await verdict(noKeys, "write", { filePath: two, content: "a" }), "refused", "two hops")
  fs.rmSync(two); fs.rmSync(hop)
  fs.symlinkSync("g/user-rules.draft.md", hop, "file")
  assert.equal(await verdict(noKeys, "write", { filePath: hop, content: "a" }), "refused", "through a folder link")
  fs.rmSync(hop); fs.rmSync(g, { recursive: true })
})

test("project install: memory beside the carrier is written freely; its rule store is not", async () => {
  const fact = path.join(proj, "Harness", "memory", "fact.md")
  assert.equal(await verdict(await v1(projectMod, {}), "write", { filePath: fact, content: "a" }), "pass")
  assert.equal(await verdict(await v1(projectMod, {}), "bash", { command: `echo x > ${posix(fact)}`, workdir: proj }), "pass")
  assert.equal(await verdict(await v1(projectMod, {}), "write", { filePath: path.join(proj, "Harness", "user-rules.md"), content: "a" }), "refused")
  assert.equal(await verdict(await v1(projectMod, {}), "write", { filePath: path.join(proj, "memory", "x.md"), content: "a" }), "pass", "no AGENT.md at the root: a repo's own folder")
})

test("the stores the variables point at hold memory, written freely", async () => {
  const pinned = path.join(home, "pinned")
  const base = path.join(home, "base")
  process.env.GENESEED_MEMORY = pinned
  process.env.GENESEED_HARNESS = base
  try {
    assert.equal(await verdict(noKeys, "write", { filePath: path.join(pinned, "x.md"), content: "a" }), "pass")
    assert.equal(await verdict(noKeys, "write", { filePath: path.join(base, "memory", "x.md"), content: "a" }), "pass")
  } finally { delete process.env.GENESEED_MEMORY; delete process.env.GENESEED_HARNESS }
})

test("a relative path: memory passes and a rule name is refused, from any session directory", async () => {
  const session = await globalMod.GeneseedGuard({ worktree: path.dirname(cfg), directory: cfg, client: client({}) })
  assert.equal(await verdict(session, "write", { filePath: "memory/x.md", content: "a" }), "pass")
  assert.equal(await verdict(session, "write", { filePath: "user-rules.md", content: "a" }), "refused")
  assert.equal(await verdict(await v1(globalMod, {}, proj), "write", { filePath: "user-rules.md", content: "a" }), "refused")
})

test("under serve, a relative path reaches every gate from the session's directory", async () => {
  const repo = path.join(home, "served")
  fs.mkdirSync(path.join(repo, ".geneseed"), { recursive: true })
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true })
  fs.writeFileSync(path.join(repo, ".geneseed", "protected-checks.txt"), "tests/gate.test.mjs\n")
  const h = await globalMod.GeneseedGuard({ worktree: repo, directory: repo, client: client(keysOf(cfg, true)) })
  for (const filePath of [".geneseed/protected-checks.txt", ".geneseed/done-checks.txt", "tests/gate.test.mjs"]) {
    assert.equal(await verdict(h, "write", { filePath, content: "a" }), "refused", filePath)
  }
  assert.equal(await verdict(h, "write", { filePath: "tests/other.test.mjs", content: "a" }), "pass")
})

test("V1: no way to read the agents proves no prompt", async () => {
  const blind = await globalMod.GeneseedGuard({ worktree: proj, directory: proj, client: { config: { get: async () => ({ data: { permission: { edit: keysOf(cfg, true) } } }) } } })
  assert.equal(await verdict(blind, "write", { filePath: cfgRules, content: "a" }), "refused")
})

test("V1: every agent's own ruleset must leave the prompt in place", async () => {
  const edit = keysOf(cfg, true)
  const rel = "../.config/opencode/user-rules.md"
  const rule = (permission, pattern, action) => ({ permission, pattern, action })
  const asked = [rule("*", "*", "allow"), rule("edit", "*/user-rules.md", "ask")]
  const rows = [
    ["all ask", [{ permission: asked }, { permission: [...asked, rule("edit", "*", "deny")] }], "pass"],
    ["one agent allows it", [{ permission: asked }, { permission: [...asked, rule("edit", "*", "allow")] }], "refused"],
    ["one agent allows everything", [{ permission: [...asked, rule("*", "*", "allow")] }], "refused"],
  ]
  for (const [why, list, want] of rows) {
    const h = await v1(globalMod, edit, proj, async () => ({ data: list }))
    assert.equal(await verdict(h, "write", { filePath: path.resolve(proj, rel), content: "a" }), want, why)
  }
  const down = await v1(globalMod, edit, proj, async () => { throw new Error("down") })
  assert.equal(await verdict(down, "write", { filePath: path.resolve(proj, rel), content: "a" }), "refused", "a failed read proves no prompt")
})

// Shell is not a boundary. Only the parsed forms are read: a redirect, `tee`, `cp`, `mv`, `rm`, `sed -i`.
// V1 cannot ask, so a parsed form that lands in a rule store is refused; one that lands in memory passes. Everything else is the host's
// command permission's business, and these rows hold that the guard stays out of it.
const SHELL_PARSED = ["echo x > user-rules.md", "echo x >> user-rules.draft.md", "tee -a user-rules.md < a", "cp a user-rules.md", "mv a user-rules.draft.md",
  "sed -i s/a/b/ user-rules.md", "rm user-rules.md", "echo x > %M/user-rules.md", "cd %M && echo x > user-rules.md",
  // The live miss (OpenCode 2.2.5). The tier row names no coined file, so only the home expansion can reach it.
  "Add-Content -Path \"$HOME\\.config\\geneseed\\user-rules.md\" -Value \"test gate\"", "Add-Content -Path \"$HOME\\.config\\geneseed\\user-rules.draft.md\" -Value x",
  "x | Out-File %M/user-rules.md", "Remove-Item user-rules.md", "Move-Item a user-rules.draft.md", "ren a.md user-rules.md", "New-Item -Path %M -Name user-rules.md",
  // Bash reads `@'` as a plain quote, so this `rm` is real.
  "echo @'\n'; rm user-rules.md; echo '\n'@"]
const SHELL_PASS = ["git commit -m 'note MEMORY.md'", "sort MEMORY.md", "echo 'see MEMORY.md' > notes.txt", "cat MEMORY.md", "git add MEMORY.md",
  "grep x MEMORY.md > out.txt", "gh pr create --body MEMORY.md", "npm test", "bash -c 'echo x > MEMORY.md'", "node -e \"require('fs').writeFileSync('MEMORY.md','x')\"",
  "Get-Content MEMORY.md", "Set-Content notes.txt 'see MEMORY.md'", "pwsh -c 'Add-Content MEMORY.md x'",
  "Set-Content notes.txt @'\nDon't lose it.\nMove MEMORY.md away\n'@"]
// Memory is written freely: each of these parses to a memory write, and passes.
const SHELL_MEMORY = ["echo x >> MEMORY.md", "mv a MEMORY.md", "echo x > %M/x.md", "cd %M && echo x > f.md", "x | Out-File %M/x.md",
  "Add-Content -Path \"$HOME\\.config\\geneseed\\memory\\x.md\" -Value x", "New-Item -Path %M -Name x.md"]
const HERE_STRING = "echo @'\nDon't lose it.\nMove user-rules.md away\n'@"
test("shell, V1: a parsed form landing in a store is refused", async () => {
  for (const c of SHELL_PARSED) assert.equal(await verdict(hookOf, "bash", { command: c.replaceAll("%M", posix(cfg)), workdir: proj }), "refused", c)
})
test("shell, V1: a parsed form landing in memory passes", async () => {
  for (const c of SHELL_MEMORY) assert.equal(await verdict(hookOf, "bash", { command: c.replaceAll("%M", mem), workdir: proj }), "pass", c)
})
test("shell: a command is judged by what it parses to, never by the names it mentions", async () => {
  for (const c of SHELL_PASS) assert.equal(await verdict(hookOf, "bash", { command: c, workdir: proj }), "pass", c)
})
test("shell: a tool named PowerShell is the cue for a here-string; a bash tool has none", async () => {
  assert.equal(await verdict(hookOf, "powershell", { command: HERE_STRING, workdir: proj }), "pass")
  assert.equal(await verdict(hookOf, "bash", { command: HERE_STRING, workdir: proj }), "refused")
})
test("shell: the files the host asks about are refused by key", async () => {
  for (const f of [path.join(cfg, "agents", "x.md"), path.join(cfg, "agents", "sub", "a.md"), path.join(cfg, "agent", "x.md"), path.join(cfg, "mode", "x.md"),
    path.join(cfg, "modes", "x.md"), path.join(cfg, "plugins", "x.js"), path.join(cfg, "plugin", "x.js"), path.join(cfg, "tool", "x.js"), path.join(cfg, "tools", "x.js")]) {
    assert.equal(await verdict(hookOf, "bash", { command: `echo x > "${posix(f)}"`, workdir: proj }), "refused", f)
  }
})

// ---- the hook hosts: the same landing rule through ruleGateTarget --------------------------------
const hookEnv = { ...process.env, ...homeOverrides(home), XDG_CONFIG_HOME: path.join(home, ".config") }
const root = cfg
function gate(host, tool, input, cwd = proj) {
  const r = spawnHook(["tool-gate", "--root", root, ...(host ? ["--host", host] : [])],
    JSON.stringify(host === "bob" ? { event: "PreToolUse", session_id: "s", cwd, tool, input } : { hook_event_name: "PreToolUse", session_id: "s", cwd, tool_name: tool, tool_input: input }),
    { env: hookEnv, cwd: proj })
  if (host === "bob") return r.status === 2 ? "block" : r.status === 0 ? "pass" : `exit ${r.status}: ${r.stderr}`
  return /"permissionDecision": "ask"/.test(r.stdout) ? "ask" : "pass"
}
const HOOK_ROWS = [
  ["the install's rule store", cfgRules],
  ["the tier's rule draft", path.join(path.dirname(tier), "user-rules.draft.md")],
  ["a coined name anywhere", rules],
  ["a .. spelling", `${posix(path.join(cfg, "notebook"))}/../user-rules.md`],
  ["a // spelling", `${posix(cfg)}//user-rules.md`],
  ["a relative path, from the session", "user-rules.draft.md"],
  ...(WIN ? [["a stream", `${rules}::$DATA`], ["a trailing dot", `${rules}.`], ["a trailing space", `${rules} `],
    ["a Git Bash path", `/${mem[0].toLowerCase()}${mem.slice(2)}/../user-rules.md`]] : []),
]
const HOOK_FREE = [["a fact", `${mem}/x.md`], ["the tier", path.join(tier, "x.md")], ["the index", `${mem}/MEMORY.md`]]
test("hook hosts: memory is written freely on Claude and Bob", () => {
  for (const [why, p] of HOOK_FREE) {
    assert.equal(gate(null, "Write", { file_path: p, content: "a" }), "pass", `claude: ${why}`)
    assert.equal(gate("bob", "write_to_file", { path: p, content: "a" }), "pass", `bob: ${why}`)
  }
})
test("hook hosts: Claude asks and Bob blocks a write to a store, however it is spelled", () => {
  for (const [why, p] of HOOK_ROWS) {
    assert.equal(gate(null, "Write", { file_path: p, content: "a" }), "ask", `claude: ${why}`)
    assert.equal(gate("bob", "write_to_file", { path: p, content: "a" }), "block", `bob: ${why}`)
  }
})
test("hook hosts: a parsed shell write to a store asks on Claude and only warns on Bob", () => {
  assert.equal(gate(null, "Bash", { command: `echo x > ${cfgRules}` }), "ask")
  assert.equal(gate(null, "Bash", { command: `echo x > ${mem}/x.md` }), "pass", "memory is written freely")
  assert.equal(gate("bob", "execute_command", { command: "echo x >> MEMORY.md" }), "pass")
  assert.equal(gate(null, "Bash", { command: "git commit -m 'note MEMORY.md'" }), "ask", "the commit ask, nothing about the store")
  assert.equal(gate("bob", "execute_command", { command: "sort MEMORY.md" }), "pass")
  const cmdlet = "Add-Content -Path \"$HOME\\.config\\geneseed\\user-rules.md\" -Value x"
  const memCmdlet = "Add-Content -Path \"$HOME\\.config\\geneseed\\memory\\x.md\" -Value x"
  assert.equal(gate(null, "PowerShell", { command: memCmdlet }), "pass", "memory is written freely")
  assert.equal(gate(null, "PowerShell", { command: cmdlet }), "ask")
  assert.equal(gate("openclaude", "PowerShell", { command: cmdlet }), "ask")
  const bobRun = (command) => spawnHook(["tool-gate", "--root", root, "--host", "bob"],
    JSON.stringify({ event: "PreToolUse", session_id: "s", cwd: proj, tool: "execute_command", input: { command } }), { env: hookEnv, cwd: proj })
  const warned = bobRun(cmdlet)
  assert.equal(warned.status, 0, "a warning, never a block")
  assert.match(warned.stderr, /Persist Insight/)
  assert.doesNotMatch(bobRun("Get-Content MEMORY.md").stderr, /Persist Insight/)
  assert.doesNotMatch(bobRun(memCmdlet).stderr, /Persist Insight/, "no warning for memory")
  assert.equal(gate(null, "PowerShell", { command: "Get-Content MEMORY.md" }), "pass")
  assert.equal(gate(null, "PowerShell", { command: HERE_STRING }), "pass", "the tool is the cue")
  assert.equal(gate(null, "Bash", { command: HERE_STRING }), "ask", "no cue: the lines are bash's")
})
test("hook hosts: Bob reads every path key, and counts a move and a delete as writes", () => {
  assert.equal(gate("bob", "write_to_file", { path: "notes.txt", file_path: rules, content: "a" }), "block", "a decoy path")
  assert.equal(gate("bob", "move_file", { path: "a.txt", destination: rules }), "block")
  assert.equal(gate("bob", "delete_file", { path: rules }), "block")
  for (const key of ["target", "file", "filename", "source", "from", "new_name", "old_path"]) {
    assert.equal(gate("bob", "rename_file", { [key]: rules }), "block", key)
  }
  assert.equal(gate("bob", "write_to_file", { path: path.join(proj, "docs", "concepts", "memory.md"), content: "a" }), "pass", "exact case outside a store")
})
test("hook hosts: Bob's refusal never speaks of re-issuing", () => {
  const r = spawnHook(["tool-gate", "--root", root, "--host", "bob"],
    JSON.stringify({ event: "PreToolUse", session_id: "s", cwd: proj, tool: "write_to_file", input: { path: rules, content: "a" } }), { env: hookEnv, cwd: proj })
  assert.equal(r.status, 2)
  assert.doesNotMatch(r.stderr, /re-?issue/i, r.stderr)
  assert.match(r.stderr, /Bob has no approval step/)
})
test("hook hosts: a read and ordinary work stay free", () => {
  assert.equal(gate("bob", "read_file", { path: rules }), "pass", "Bob routes reads here too")
  assert.equal(gate("bob", "write_to_file", { path: path.join(proj, "docs", "notes.md"), content: "a" }), "pass")
  assert.equal(gate(null, "Write", { file_path: path.join(proj, "docs", "notes.md"), content: "a" }), "pass")
})
test("hook hosts: a relative path: memory passes and a rule name blocks, from any session directory", () => {
  assert.equal(gate("bob", "write_to_file", { path: "memory/x.md", content: "a" }, cfg), "pass")
  assert.equal(gate("bob", "write_to_file", { path: "user-rules.md", content: "a" }, cfg), "block")
  assert.equal(gate("bob", "write_to_file", { path: "user-rules.md", content: "a" }, proj), "block")
})
test("hook hosts: a link into a rule store lands in it, from a memory file too", (t) => {
  const link = path.join(proj, "hook-link.md")
  const linked = path.join(cfg, "memory", "hook-linked.md")
  try {
    fs.symlinkSync(rules, link, "file")
    fs.symlinkSync(rules, linked, "file")
  } catch (e) { t.skip(`no link rights: ${e.code}`); return }
  assert.equal(gate("bob", "write_to_file", { path: link, content: "a" }), "block", "dangling")
  assert.equal(gate("bob", "write_to_file", { path: linked, content: "a" }), "block", "a memory file linked to user-rules.md")
  assert.equal(gate(null, "Write", { file_path: linked, content: "a" }), "ask", "the same on Claude")
  fs.rmSync(link); fs.rmSync(linked)
})
