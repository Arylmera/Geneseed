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
import { groupPasses as nodeGroupPasses, runsUnpiped as nodeRunsUnpiped } from "../../js/hosts/hooks-done.mjs"
import { doneLine as nodeDoneLine, inferDoneChecks as nodeInfer } from "../../js/hosts/done-checks.mjs"
import { gitRootOf as nodeGitRootOf } from "../../js/hosts/gitref.mjs"
import contextPlugin, { GeneseedContext } from "../../adapters/opencode/plugins/geneseed-context.js"

let tmp, repo
const MARK = "Geneseed (Verify Before Asserting)"

before(async () => {
  tmp = makeSandbox("gsdone-").path
  repo = path.join(tmp, "repo")
  await fs.mkdir(path.join(repo, ".geneseed"), { recursive: true })
  // A git root: the gate judges the repo `gitRootOf` finds, on both hosts.
  await fs.mkdir(path.join(repo, ".git"), { recursive: true })
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
    ["npm test || exit 1", "npm test", false], ["npm test | tail; npm test", "npm test", true],
    ["npm test || true", "npm test", false], ["npm test; true", "npm test", false],
    ["npm test; exit 0", "npm test", false], ["npm test && echo ok", "npm test", true],
    ["npm test; npm run lint", "npm test", true],
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

// Inference (user decision 2026-10-29): with no done list, the root manifests imply the checks.
// The plugin carries its own copy of js/hosts/done-checks.mjs, so both copies run over the same
// fixtures, each against the line written out here. Explicit lists differ on one word only:
// the Node hook BLOCKS, the plugin can only remind.
async function gitRepo(name, files) {
  const dir = path.join(tmp, name)
  await fs.mkdir(path.join(dir, ".git"), { recursive: true })
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
    await fs.writeFile(path.join(dir, rel), text)
  }
  return dir
}
async function injected(dir, messages = [user("u1")]) {
  const hooks = await GeneseedContext({ client, directory: dir, worktree: dir })
  const output = { messages: [...messages] }
  await hooks["experimental.chat.messages.transform"]({}, output)
  return output.messages.flatMap((m) => (m.parts ?? []).map((p) => String(p.text ?? ""))).join("\n")
}
const scripts = (s) => JSON.stringify({ scripts: s })

test("the done gate line: both copies of the inference agree, row by row", async () => {
  const rows = [
    ["npm", { "package.json": scripts({ test: "node --test", lint: "eslint ." }) },
      "Done gate: inferred from package.json — npm test, npm run lint (advisory)"],
    ["npm-default", { "package.json": scripts({ test: 'echo "Error: no test specified" && exit 1' }) },
      "Done gate: no checks could be inferred"],
    ["pnpm", { "package.json": scripts({ typecheck: "tsc" }), "pnpm-lock.yaml": "" },
      "Done gate: inferred from package.json — pnpm typecheck (advisory)"],
    ["bun", { "package.json": scripts({ test: "x" }), "bun.lockb": "" },
      "Done gate: inferred from package.json — bun run test (advisory)"],
    ["jvm", { "pom.xml": "", "build.gradle.kts": "" },
      "Done gate: inferred from pom.xml, build.gradle.kts — mvn test, gradle test (advisory)"],
    // A bare pyproject.toml implies no pytest: a unittest-only repo could never clear it.
    ["poly", { "pyproject.toml": "", "Cargo.toml": "", "go.mod": "" },
      "Done gate: inferred from Cargo.toml, go.mod — cargo test, go test (advisory)"],
    ["pytest-section", { "pyproject.toml": "[tool.pytest.ini_options]\n" },
      "Done gate: inferred from pyproject.toml — pytest (advisory)"],
    ["pytest-conftest", { "pyproject.toml": "", "conftest.py": "" },
      "Done gate: inferred from pyproject.toml — pytest (advisory)"],
    ["pytest-tests-dir", { "pyproject.toml": "", "tests/test_a.py": "" },
      "Done gate: inferred from pyproject.toml — pytest (advisory)"],
    ["none", { "README.md": "# x\n" }, "Done gate: no checks could be inferred"],
  ]
  for (const [name, files, line] of rows) {
    const dir = await gitRepo(`infer-${name}`, files)
    assert.equal(nodeDoneLine(dir), line, `node: ${name}`)
    assert.ok((await injected(dir)).split("\n").includes(line), `plugin: ${name}`)
  }
  // OpenCode started in a SUBDIRECTORY: both sides judge the git root above it (the Node
  // `context` hook calls `gitRootOf` before `doneLine`).
  const mono = await gitRepo("infer-sub", { "package.json": scripts({ lint: "eslint" }), "packages/a/index.js": "" })
  const sub = path.join(mono, "packages", "a")
  const subLine = "Done gate: inferred from package.json — npm run lint (advisory)"
  assert.equal(nodeDoneLine(nodeGitRootOf(sub)), subLine, "node: subdirectory")
  assert.ok((await injected(sub)).split("\n").includes(subLine), "plugin: subdirectory")
  const listed = await gitRepo("infer-listed", { "package.json": scripts({ test: "x" }), ".geneseed/done-checks.txt": "make check\n" })
  assert.equal(nodeDoneLine(listed), "Done gate: from .geneseed/done-checks.txt — make check (blocking)")
  assert.ok((await injected(listed)).includes("Done gate: from .geneseed/done-checks.txt — make check (reminder)"))
})

// OpenCode 2 never judges a turn (no reminder there), so its done line claims no verdict.
test("the done gate line on OpenCode 2: named, and not judged", async () => {
  const v2Line = async (dir) => {
    const hooks = {}
    const ctx = {
      location: { directory: dir, project: { directory: dir } },
      session: { hook: async (name, cb) => { hooks[name] = cb }, get: async () => ({ title: "work" }) },
    }
    const err = console.error
    console.error = () => {}                 // the listed gate's one-time "not judged" notice
    try { await contextPlugin.setup(ctx) } finally { console.error = err }
    const ev = { sessionID: "s1", system: [], messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }
    await hooks.context(ev)
    return ev.messages[0].content[0].text.split("\n").find((l) => l.startsWith("Done gate:"))
  }
  const inferred = await gitRepo("v2-inferred", { "package.json": scripts({ test: "x" }) })
  assert.equal(await v2Line(inferred), "Done gate: inferred from package.json — npm test (not judged on this host)")
  const listed = await gitRepo("v2-listed", { ".geneseed/done-checks.txt": "make check\n" })
  assert.equal(await v2Line(listed), "Done gate: from .geneseed/done-checks.txt — make check (not judged on this host)")
})

test("inferred checks: the V1 reminder says advisory, and any accepted form clears it", async () => {
  const dir = await gitRepo("infer-remind", { "package.json": scripts({ test: "node --test" }) })
  const edit = tool("edit", { filePath: path.join(dir, "a.js") })
  const owed = await injected(dir, [user("u1"), edit, user("u2")])
  assert.match(owed, /Geneseed \(Verify Before Asserting\) — files were edited, and these checks \(advisory\) inferred from package\.json have not passed since the last edit: npm test\./)
  for (const command of ["npm test", "npm run test", "npm t -- --watch=false"]) {
    const ran = await injected(dir, [user("u1"), edit, tool("bash", { command }, "completed", { exit: 0 }), user("u2")])
    assert.equal(ran.includes(MARK), false, command)
  }
})

test("groupPasses stays in parity with js/hosts/hooks-done.mjs (twin), refusals included", async () => {
  const src = await fs.readFile(path.join(process.cwd(), "adapters/opencode/plugins/geneseed-context.js"), "utf8")
  const fn = (name) => src.match(new RegExp(`function ${name}\\(command, (?:line|g)\\) \\{[\\s\\S]*?\\n\\}\\n`))?.[0]
  assert.ok(fn("runsUnpiped") && fn("groupPasses"), "runsUnpiped or groupPasses not found in geneseed-context.js")
  const twin = new Function(`${fn("runsUnpiped")}${fn("groupPasses")}; return groupPasses`)()
  const dir = await gitRepo("infer-refuse", { "pom.xml": "", "build.gradle": "", "Cargo.toml": "" })
  const [mvn, gradle, cargo] = nodeInfer(dir).checks
  const rows = [
    [mvn, "mvn clean install", true], [mvn, "mvn clean install -DskipTests", false],
    [mvn, "./mvnw verify -Dmaven.test.skip=true", false], [mvn, "mvn install -DskipTests; mvn test", true],
    [gradle, "./gradlew build", true], [gradle, "./gradlew build -x test", false], [gradle, "gradle check -x=test", false],
    [cargo, "cargo test", true], [cargo, "cargo test --no-run", false],
  ]
  for (const [g, command, want] of rows) {
    assert.equal(nodeGroupPasses(command, g), want, `node: ${command}`)
    assert.equal(twin(command, g), want, `twin: ${command}`)
  }
  // And through the real transform: a skipped-tests run leaves the reminder standing.
  const edit = tool("edit", { filePath: path.join(dir, "a.java") })
  const skipped = await injected(dir, [user("u1"), edit, tool("bash", { command: "mvn install -DskipTests" }, "completed", { exit: 0 }), user("u2")])
  assert.match(skipped, /have not passed since the last edit: mvn test; gradle test; cargo test\./)
})
