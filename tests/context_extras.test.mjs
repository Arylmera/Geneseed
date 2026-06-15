// Tests for the context plugin's two self-orientation extras: command discovery
// (Makefile / package.json / justfile / Taskfile targets) and the best-effort model
// line (read from the transcript, else $GENESEED_MODEL). Run from the Geneseed root:
//   node --test tests/context_extras.test.mjs
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import * as path from "node:path"

const PLUGIN = new URL("../adapters/opencode/plugins/geneseed-context.js", import.meta.url).href

let tmp, repo

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gsextra-"))
  repo = path.join(tmp, "repo")
  await fs.mkdir(repo)
  await fs.writeFile(path.join(repo, "README.md"), "# Extras Repo\nhello\n")
  // A Makefile and a package.json with scripts → two command groups.
  await fs.writeFile(path.join(repo, "Makefile"),
    ".PHONY: build test\nbuild:\n\techo build\ntest: build\n\techo test\n%.o: %.c\n\tcc\n")
  await fs.writeFile(path.join(repo, "package.json"),
    JSON.stringify({ scripts: { dev: "vite", lint: "eslint ." } }))
  await fs.writeFile(path.join(repo, "yarn.lock"), "")   // → "yarn" runner
  // Keep any developer-machine wiki out of the block.
  await fs.writeFile(path.join(tmp, "wiki.jsonc"), `{ "wikis": [] }`)
  process.env.GENESEED_WIKI = path.join(tmp, "wiki.jsonc")
})

after(async () => {
  delete process.env.GENESEED_WIKI
  delete process.env.GENESEED_MODEL
  await fs.rm(tmp, { recursive: true, force: true })
})

function stubClient() {
  return {
    session: {
      get: async () => ({ data: { title: "user session" } }),
      messages: async () => [],
      prompt: async () => {},
    },
  }
}

async function load(env, tag) {
  const saved = {}
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    const mod = await import(`${PLUGIN}?case=${tag}`)
    return await mod.default({ directory: repo, client: stubClient() })
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

const userMsg = (sid) => ({
  info: { id: "u1", role: "user", sessionID: sid, time: { created: 2 } },
  parts: [{ id: "p1", type: "text", text: "hi" }],
})
const assistantMsg = (sid, providerID, modelID) => ({
  info: { id: "a1", role: "assistant", sessionID: sid, providerID, modelID, time: { created: 1 } },
  parts: [{ id: "p0", type: "text", text: "earlier" }],
})

test("command discovery: make targets and the lockfile-correct script runner appear", async () => {
  const plugin = await load({}, "cmds")
  const output = { messages: [userMsg("s1")] }
  await plugin["experimental.chat.messages.transform"]({}, output)
  const text = output.messages[0].parts[0].text
  assert.match(text, /Project commands/)
  assert.match(text, /make — build, test/)        // .PHONY, %.o pattern rule excluded
  assert.doesNotMatch(text, /make —[^\n]*\.o/)
  assert.match(text, /yarn — dev, lint/)           // yarn.lock → "yarn", not "npm run"
})

test("model line: read from a prior assistant message in the transcript", async () => {
  const plugin = await load({}, "model-msg")
  const output = { messages: [assistantMsg("s1", "anthropic", "claude-x"), userMsg("s1")] }
  await plugin["experimental.chat.messages.transform"]({}, output)
  assert.match(output.messages[0].parts[0].text, /current model: anthropic\/claude-x/)
})

test("model line: falls back to $GENESEED_MODEL when the transcript has no model", async () => {
  const plugin = await load({}, "model-env")
  const output = { messages: [userMsg("s1")] }
  process.env.GENESEED_MODEL = "openai/gpt-z"   // read live at transform time
  try {
    await plugin["experimental.chat.messages.transform"]({}, output)
  } finally {
    delete process.env.GENESEED_MODEL
  }
  assert.match(output.messages[0].parts[0].text, /current model: openai\/gpt-z/)
})

test("model line: omitted when the model is unknown", async () => {
  const plugin = await load({ GENESEED_MODEL: undefined }, "model-none")
  const output = { messages: [userMsg("s1")] }
  await plugin["experimental.chat.messages.transform"]({}, output)
  assert.doesNotMatch(output.messages[0].parts[0].text, /current model:/)
})
