// The OpenCode guard's ownership first-write gate, the twin of js/hosts/ownership-gate.mjs. Written
// out, not recorded. V1 refuses by THROWING `[geneseed-guard] blocked: <reason>` (no
// GENESEED_GUARD=off tail: the next write passes anyway); V2 cannot throw, so the call is renamed
// to that text. Once per (session, repo); a child session (a subagent, ruling D29) never spends
// the block; a `## Ownership` section defers. The reason is the hook's, word for word.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import guardDefault, { GeneseedGuard } from "../../adapters/opencode/plugins/geneseed-guard.js"
import { ownershipBlock as hookBlock } from "../../js/hosts/ownership-gate.mjs"
import { makeSandbox } from "../helpers/sandbox.mjs"

const boxes = []
after(() => boxes.forEach((b) => b.cleanup()))
function app(files = { "package.json": "{}" }) {
  const sb = makeSandbox("gsown-oc-")
  boxes.push(sb)
  fs.mkdirSync(path.join(sb.path, ".git"))
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(sb.path, rel), text)
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

async function v1(hook, sessionID, filePath) {
  try {
    await hook({ tool: "write", sessionID }, { args: { filePath, content: "x" } })
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
  assert.match(first.tool, /^\[geneseed-guard\] blocked: Geneseed \(Ownership\)/)
  assert.deepEqual(first.input, {})
  const second = ev("s1")
  await before(second)
  assert.equal(second.tool, "write")
})
