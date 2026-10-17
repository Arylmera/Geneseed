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
  const rows = [
    ["npm test", "npm test"], ["npm test 2>&1", "npm test"], ["npm test | tail", "npm test"],
    ["npm test |tail", "npm test"], ["npm test && echo ok | cat", "npm test"],
    ["npm test || exit 1", "npm test"], ["npm test | tail; npm test", "npm test"],
    ["cd web &&  npm   test", "npm test"], ["npm run build", "npm test"], ["a\tnpm test\n| x", "npm test"],
  ]
  for (const [cmd, line] of rows) assert.equal(twin(cmd, line), nodeRunsUnpiped(cmd, line), cmd)
})
