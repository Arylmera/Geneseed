// Tests for the OpenCode guard plugin's cross-platform safety matching — in particular
// that Windows-style (backslash) secret paths and Windows/PowerShell catastrophic
// commands are caught, not just their POSIX equivalents — and for the protected-wiki
// enforcement (AGENT.md §8) driven by a wiki.jsonc manifest.
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
await fs.writeFile(path.join(tmp, "wiki.jsonc"), `// machine wikis
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
process.env.GENESEED_WIKI = path.join(tmp, "wiki.jsonc")

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
