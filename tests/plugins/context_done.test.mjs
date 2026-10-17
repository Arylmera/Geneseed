// The done gate's OpenCode twin (#289): the context plugin's V1 transform reminds, on the next
// request, that a turn edited files without the project's declared checks passing. Asserted in
// both directions through the real transform, plus a parity run of the hand-mirrored
// `runsUnpiped` against the Node hook's on one table. Run from the Geneseed root:
//   node --test tests/plugins/context_done.test.mjs
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import { makeSandbox } from "../helpers/sandbox.mjs"
import { runsUnpiped as nodeRunsUnpiped } from "../../js/hosts/hooks-done.mjs"
import { GeneseedContext } from "../../adapters/opencode/plugins/geneseed-context.js"

let tmp, repo
const MARK = "Geneseed (Verify Before Asserting)"

before(async () => {
  tmp = makeSandbox("gsdone-").path
  repo = path.join(tmp, "repo")
  await fs.mkdir(path.join(repo, ".geneseed"), { recursive: true })
  await fs.writeFile(path.join(repo, ".geneseed", "done-checks.txt"), "# proof\nnpm run lint\n")
  await fs.writeFile(path.join(tmp, "geneseed-wiki.jsonc"), `{ "wikis": [] }`)
  process.env.GENESEED_WIKI = path.join(tmp, "geneseed-wiki.jsonc")
})

after(async () => {
  delete process.env.GENESEED_WIKI
  await fs.rm(tmp, { recursive: true, force: true })
})

const client = { session: { get: async () => ({ data: { title: "user session" } }), messages: async () => [] } }
const user = (id) => ({ info: { id, role: "user", sessionID: "s1" }, parts: [{ type: "text", text: "go" }] })
const tool = (name, input, status = "completed", metadata = {}) =>
  ({ info: { id: `a${Math.random()}`, role: "assistant", sessionID: "s1" },
    parts: [{ type: "tool", tool: name, state: { status, input, metadata } }] })

async function reminded(messages) {
  const hooks = await GeneseedContext({ client, directory: repo, worktree: repo })
  const output = { messages: [...messages] }
  await hooks["experimental.chat.messages.transform"]({}, output)
  return output.messages.some((m) => (m.parts ?? []).some((p) => String(p.text ?? "").includes(MARK)))
}

test("the V1 transform reminds after an unproven edit, and only then", async () => {
  const edit = tool("edit", { filePath: path.join(repo, "a.js") })
  const rows = [
    ["an edit, then a new prompt, no proof", [user("u1"), edit, user("u2")], true],
    ["the proof passed after the edit", [user("u1"), edit, tool("bash", { command: "npm run lint" }, "completed", { exit: 0 }), user("u2")], false],
    ["the proof exited non-zero", [user("u1"), edit, tool("bash", { command: "npm run lint" }, "completed", { exit: 1 }), user("u2")], true],
    ["the proof was piped", [user("u1"), edit, tool("bash", { command: "npm run lint | tail" }), user("u2")], true],
    ["no edit at all", [user("u1"), tool("bash", { command: "ls" }), user("u2")], false],
    ["a failed edit changed nothing", [user("u1"), tool("edit", { filePath: path.join(repo, "a.js") }, "error"), user("u2")], false],
    ["an edit outside the project", [user("u1"), tool("write", { filePath: path.join(tmp, "x.js") }), user("u2")], false],
    ["the edit is two turns old: the reminder lasts one turn", [user("u0"), edit, user("u1"), user("u2")], false],
    // `..cache` is a name inside the root, not a step out of it: the Node hook's `within()` rule.
    ["an edit of <root>/..cache/x.js is inside the project", [user("u1"), tool("edit", { filePath: path.join(repo, "..cache", "x.js") }), user("u2")], true],
    ["a relative edit climbing out of the root", [user("u1"), tool("edit", { filePath: "../x.js" }), user("u2")], false],
    // apply_patch carries only `patchText`: its marker paths (root-relative) decide.
    ["an apply_patch entirely outside the project", [user("u1"), tool("apply_patch", { patchText: "*** Begin Patch\n*** Add File: ../out.js\n+x\n*** Update File: ../a.js\n*** Move to: ../b.js\n*** End Patch" }), user("u2")], false],
    ["an apply_patch touching one project file", [user("u1"), tool("apply_patch", { patchText: "*** Begin Patch\n*** Add File: ../out.js\n+x\n*** Delete File: a.js\n*** End Patch" }), user("u2")], true],
    ["an apply_patch moving a file into the project", [user("u1"), tool("apply_patch", { patchText: "*** Begin Patch\n*** Update File: ../a.js\n*** Move to: a.js\n*** End Patch" }), user("u2")], true],
    // No path derivable: counted, because a missed reminder is the worse error (fail-open gate).
    ["an edit whose target cannot be derived", [user("u1"), tool("patch", { patchText: "garbage" }), user("u2")], true],
  ]
  for (const [what, messages, want] of rows) assert.equal(await reminded(messages), want, what)
})

test("no done list: the transform adds nothing for the done gate", async () => {
  const bare = path.join(tmp, "bare")
  await fs.mkdir(bare, { recursive: true })
  const hooks = await GeneseedContext({ client, directory: bare, worktree: bare })
  const output = { messages: [user("u1"), tool("edit", { filePath: path.join(bare, "a.js") }), user("u2")] }
  await hooks["experimental.chat.messages.transform"]({}, output)
  assert.equal(output.messages.some((m) => (m.parts ?? []).some((p) => String(p.text ?? "").includes(MARK))), false)
})

test("runsUnpiped stays in parity with js/hosts/hooks-done.mjs (twin)", async () => {
  const src = await fs.readFile(path.join(process.cwd(), "adapters/opencode/plugins/geneseed-context.js"), "utf8")
  const m = src.match(/function runsUnpiped\(command, line\) \{[\s\S]*?\n\}\n/)
  assert.ok(m, "runsUnpiped not found in geneseed-context.js")
  const twin = new Function(`${m[0]}; return runsUnpiped`)()
  // Written out, so the twins are held to the rule and not merely to each other.
  const rows = [
    ["npm test", "npm test", true], ["npm test 2>&1", "npm test", true], ["npm test | tail", "npm test", false],
    ["npm test |tail", "npm test", false], ["npm test && echo ok | cat", "npm test", true],
    ["npm test || exit 1", "npm test", true], ["npm test | tail; npm test", "npm test", true],
    ["cd web &&  npm   test", "npm test", true], ["npm run build", "npm test", false],
    ["a\tnpm test\n| x", "npm test", false], // `a npm test`: an argument of `a`, not a command
    ["npm run lint:fix", "npm run lint", false], ['git commit -m "ran npm test"', "npm test", false],
    ['git commit -m "x; npm test"', "npm test", false], ["echo npm test", "npm test", false],
    ["npm test -- --watch=false", "npm test", true], ["cd x && npm test", "npm test", true],
  ]
  for (const [cmd, line, want] of rows) {
    assert.equal(nodeRunsUnpiped(cmd, line), want, `node: ${cmd}`)
    assert.equal(twin(cmd, line), want, `twin: ${cmd}`)
  }
})
