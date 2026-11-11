// Tests for the context plugin's two self-orientation extras: command discovery
// (Makefile / package.json / justfile / Taskfile targets) and the best-effort model
// line (read from the transcript, else $GENESEED_MODEL). Run from the Geneseed root:
//   node --test tests/plugins/context_extras.test.mjs
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import { makeSandbox } from "../helpers/sandbox.mjs";

const PLUGIN = new URL("../../adapters/opencode/plugins/geneseed-context.js", import.meta.url).href

let tmp, repo

before(async () => {
  tmp = makeSandbox("gsextra-").path
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
  await fs.writeFile(path.join(tmp, "geneseed-wiki.jsonc"), `{ "wikis": [] }`)
  process.env.GENESEED_WIKI = path.join(tmp, "geneseed-wiki.jsonc")
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
    return await mod.default.server({ directory: repo, client: stubClient() })
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

test("session files: the harness dir's changed files are injected, an untouched seed is not", async () => {
  // The harness dir is where the installed AGENT.md sits, and the session files live there —
  // before 2026-10 the plugin read user-rules.md/PROFILE.md only when they happened to sit at
  // the repo root, and the Memory/Notebook indexes never. $GENESEED_HARNESS pins it here.
  const { PROFILE_STUB } = await import("../../js/build/stubs.mjs")
  const h = path.join(tmp, "harness")
  await fs.mkdir(path.join(h, "memory"), { recursive: true })
  await fs.writeFile(path.join(h, "AGENT.md"), "# harness\n")
  await fs.writeFile(path.join(h, "user-rules.md"), "# User rules\n- R1 keep the plan visible\n")
  await fs.writeFile(path.join(h, "PROFILE.md"), PROFILE_STUB)
  await fs.writeFile(path.join(h, "memory", "MEMORY.md"), "# Memory Index\n")
  const plugin = await load({}, "session")
  const output = { messages: [userMsg("s1")] }
  const prev = process.env.GENESEED_HARNESS
  process.env.GENESEED_HARNESS = h          // read live when the block is built
  try {
    await plugin["experimental.chat.messages.transform"]({}, output)
  } finally {
    if (prev === undefined) delete process.env.GENESEED_HARNESS
    else process.env.GENESEED_HARNESS = prev
  }
  const text = output.messages[0].parts[0].text
  assert.match(text, /=== SESSION FILES/)
  assert.match(text, /----- user-rules\.md -----\n# User rules\n- R1 keep the plan visible/)
  assert.doesNotMatch(text, /----- PROFILE\.md -----/)
  assert.doesNotMatch(text, /----- memory\/MEMORY\.md -----/)
})

// The shared tier through the plugin (C6): a harness dir whose .geneseed-emit names a -global emit
// reads the machine tier first, then its own layer. Each row: the shared and host files, relative to
// their dir -> the heads and bodies that must and must not appear. The labels appear only when the
// tier has a say in that file; PROFILE.md is whole; the notebook has no shared layer.
const TIER_ROWS = [
  { name: "rules in both layers, shared first", shared: { "user-rules.md": "shared rule" }, host: { "user-rules.md": "host rule" },
    has: "----- user-rules.md (shared) -----\nshared rule\n\n----- user-rules.md (host: opencode) -----\nhost rule\n" },
  { name: "a memory map in the tier alone", shared: { "memory/MEMORY.md": "shared map" },
    has: "----- memory/MEMORY.md (shared) -----\nshared map\n" },
  { name: "a host profile replaces the shared one", shared: { "PROFILE.md": "shared me" }, host: { "PROFILE.md": "host me" },
    has: "----- PROFILE.md (host: opencode) -----\nhost me\n", hasNot: "shared me" },
  { name: "the notebook has no shared layer", shared: { "notebook/NOTEBOOK.md": "never read" }, host: { "notebook/NOTEBOOK.md": "host note" },
    has: "----- notebook/NOTEBOOK.md -----\nhost note\n", hasNot: "never read" },
  { name: "a project install reads no tier", emit: "opencode", shared: { "user-rules.md": "shared rule" }, host: { "user-rules.md": "host rule" },
    has: "----- user-rules.md -----\nhost rule\n", hasNot: "shared rule" },
]

/** The block a harness dir renders, with the tier moved to `xdg` and the emit marker set. */
async function tierBlock(name, { emit = "opencode-global", shared = {}, host = {} }) {
  const h = path.join(tmp, `tier-${name}`, "harness")
  const xdg = path.join(tmp, `tier-${name}`, "xdg")
  const put = async (file, text) => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, text)
  }
  await put(path.join(h, "AGENT.md"), "# harness\n")
  await put(path.join(h, ".geneseed-emit"), `${emit}\n`)
  for (const [f, t] of Object.entries(shared)) await put(path.join(xdg, "geneseed", f), t)
  for (const [f, t] of Object.entries(host)) await put(path.join(h, f), t)
  const plugin = await load({}, `tier-${name}`)
  const output = { messages: [userMsg("s1")] }
  const prev = ["GENESEED_HARNESS", "XDG_CONFIG_HOME", "GENESEED_WIKI"].map((v) => [v, process.env[v]])
  process.env.GENESEED_HARNESS = h          // read live when the block is built
  process.env.XDG_CONFIG_HOME = xdg
  delete process.env.GENESEED_WIKI
  try {
    await plugin["experimental.chat.messages.transform"]({}, output)
  } finally {
    for (const [v, val] of prev) {
      if (val === undefined) delete process.env[v]
      else process.env[v] = val
    }
  }
  return output.messages[0].parts[0].text
}

for (const [i, row] of TIER_ROWS.entries()) {
  test(`session files, shared tier: ${row.name}`, async () => {
    const text = await tierBlock(`row${i}`, row)
    assert.ok(text.includes(row.has), text)
    if (row.hasNot) assert.ok(!text.includes(row.hasNot), text)
  })
}

test("session files, shared tier: an empty tier prints no label", async () => {
  const text = await tierBlock("empty", { host: { "user-rules.md": "host rule" } })
  assert.ok(text.includes("----- user-rules.md -----\nhost rule\n"), text)
})

// Host parity with the Claude hook: the user-rules seed explanation above the first rule is for the
// file's owner, so it is not injected; prose the owner wrote there stays. The rule is the hook's
// own code, carried as the `rules preamble` twin (node tests/twins.mjs).
test("session files: the rules seed explanation above the first rule is skipped, owner prose stays", async () => {
  const { SESSION_SEEDS } = await import("../../js/build/stubs.mjs")
  const rules = "## R1 — Plan first\nWrite a plan.\n"
  const seeded = await tierBlock("preamble-seed", { emit: "opencode", host: { "user-rules.md": `${SESSION_SEEDS["user-rules.md"]}\n${rules}` } })
  assert.ok(seeded.includes(`----- user-rules.md -----\n${rules}`), seeded)
  assert.ok(!seeded.includes("Geneseed seeded this file once"), seeded)
  const own = await tierBlock("preamble-own", { emit: "opencode", host: { "user-rules.md": `# Mine\nRead me.\n\n${rules}` } })
  assert.ok(own.includes(`----- user-rules.md -----\n# Mine\nRead me.\n\n${rules}`), own)
})

test("the rules preamble twin block is byte-identical to js/hosts/hooks-context.mjs", async () => {
  const cut = (s) => {
    const b = s.indexOf("// ---- rules preamble twin: BEGIN"), e = s.indexOf("// ---- rules preamble twin: END")
    assert.ok(b >= 0 && e > b, "twin markers missing")
    return s.slice(b, e).replace(/^export /gm, "")
  }
  const hook = await fs.readFile(new URL("../../js/hosts/hooks-context.mjs", import.meta.url), "utf8")
  const plugin = await fs.readFile(new URL(PLUGIN), "utf8")
  assert.equal(cut(plugin), cut(hook), "the plugin's rules preamble block drifted from js/hosts/hooks-context.mjs")
})

test("the wiki: the tier's manifest stands behind a host seed, and a host manifest replaces it", async () => {
  // Whole file, as the hook has it. The manifests name the plugin's own tmp as their root.
  const { SESSION_SEEDS } = await import("../../js/build/stubs.mjs")
  const manifest = (name) => JSON.stringify({ wikis: [{ name, path: tmp }] })
  const shared = { "geneseed-wiki.jsonc": manifest("SharedWiki") }
  const seeded = await tierBlock("wiki-seed", { shared, host: { "geneseed-wiki.jsonc": SESSION_SEEDS["geneseed-wiki.jsonc"] } })
  assert.ok(seeded.includes("--- wiki: SharedWiki "), seeded)
  const absent = await tierBlock("wiki-absent", { shared })
  assert.ok(absent.includes("--- wiki: SharedWiki "), absent)
  const own = await tierBlock("wiki-own", { shared, host: { "geneseed-wiki.jsonc": manifest("HostWiki") } })
  assert.ok(own.includes("--- wiki: HostWiki ") && !own.includes("SharedWiki"), own)
  const project = await tierBlock("wiki-project", { emit: "opencode", shared })
  assert.ok(!project.includes("SharedWiki"), project)
})

// B5: the hook and this plugin read the same names; the rename's oldest is covered here.
test("the wiki: a legacy wiki.json in the harness dir is still read", async () => {
  const text = await tierBlock("wiki-json", { host: { "wiki.json": JSON.stringify({ wikis: [{ name: "Oldest", path: tmp }] }) } })
  assert.ok(text.includes("--- wiki: Oldest "), text)
})

test("session files: a memory map with a misc topic carries the curation nudge", async () => {
  // The plugin's copy of the hook's rule (tests/unit/claude.test.mjs pins the text): a `misc`
  // topic, or a topic over 40 facts, appends one line asking for the memory-curator.
  const h = path.join(tmp, "harness-nudge")
  await fs.mkdir(path.join(h, "memory"), { recursive: true })
  await fs.writeFile(path.join(h, "AGENT.md"), "# harness\n")
  await fs.writeFile(path.join(h, "memory", "MEMORY.md"),
    "# Memory Index\n\n- [misc](topics/misc.md) — 2 facts\n")
  const plugin = await load({}, "nudge")
  const output = { messages: [userMsg("s1")] }
  const prev = process.env.GENESEED_HARNESS
  process.env.GENESEED_HARNESS = h
  try {
    await plugin["experimental.chat.messages.transform"]({}, output)
  } finally {
    if (prev === undefined) delete process.env.GENESEED_HARNESS
    else process.env.GENESEED_HARNESS = prev
  }
  assert.match(output.messages[0].parts[0].text,
    /— 2 facts\n\[memory\] A topic holds over 40 facts, or facts sit in misc: .*memory-curator agent/)
})
