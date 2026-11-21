// Unit tests for the learn plugin's per-agent memory helpers — pure functions only,
// no live OpenCode. Run from the Geneseed root:
//   node --test tests/plugins/learn.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import path from "node:path"
import { GeneseedLearn } from "../../adapters/opencode/plugins/geneseed-learn.js"
const { resolveAgentName, appendAgentLesson } = GeneseedLearn
import { makeSandbox } from "../helpers/sandbox.mjs";
import { buildLearnPrompt, learnPromptHead } from "../../js/hosts/hooks-learn.mjs"

test("resolveAgentName: reads agent from session meta, rejects garbage", () => {
  assert.equal(resolveAgentName({ agent: "reviewer" }), "reviewer")
  assert.equal(resolveAgentName({ agentName: "tester" }), "tester")
  assert.equal(resolveAgentName({ agent: "Reviewer" }), "reviewer") // lowercased
  assert.equal(resolveAgentName({ agent: "../evil" }), null)
  assert.equal(resolveAgentName({ agent: "has space" }), null)
  assert.equal(resolveAgentName({ agent: "" }), null)
  assert.equal(resolveAgentName({}), null)
  assert.equal(resolveAgentName(null), null)
})

test("appendAgentLesson: creates file, appends, caps at 100 bullets", async () => {
  const dir = makeSandbox("gs-learn-").path
  const f = await appendAgentLesson(dir, "reviewer", "cite tests in findings")
  const text1 = await fs.readFile(f, "utf8")
  assert.match(text1, /^# reviewer — lessons\n/)
  assert.match(text1, /- \d{4}-\d{2}-\d{2}: cite tests in findings\n$/)
  for (let i = 0; i < 120; i++) await appendAgentLesson(dir, "reviewer", `lesson ${i}`)
  const text2 = await fs.readFile(f, "utf8")
  const bullets = text2.split("\n").filter((l) => l.startsWith("- "))
  assert.equal(bullets.length, 100)
  assert.match(bullets.at(-1), /lesson 119/)
})

test("appendAgentLesson: collapses whitespace in the lesson", async () => {
  const dir = makeSandbox("gs-learn-").path
  const f = await appendAgentLesson(dir, "tester", "a  lesson\nwith\tbreaks")
  const text = await fs.readFile(f, "utf8")
  assert.match(text, /- \d{4}-\d{2}-\d{2}: a lesson with breaks\n$/)
})

// A memory `name:` is MODEL OUTPUT and becomes a filename, so it is a plain slug or nothing —
// the same rule the harness's own learn hook applies (MEMORY_SLUG_RE in js/hosts/memory-files.mjs).
// Each refused name below would have written outside the memory dir, or to a name no index
// line could link; the accepted ones show the rule is a slug check, not a lowercase one.
test("writeMemories: refuses a name that is not a plain slug, writes one that is", async () => {
  const root = makeSandbox("gs-learn-").path
  const memDir = path.join(root, "memory")
  await fs.mkdir(memDir)
  const chunk = (name) => `---\nname: ${name}\ndescription: d\n---\nbody`
  const refused = ["../escaped", "..", "a/b", "a\b", "C:evil", "-leading-dash", ".hidden", "x".repeat(101)]
  const accepted = ["Plain_Slug-1", "x".repeat(100)]
  const output = [...refused, ...accepted].map(chunk).join("\n---FILE---\n")
  const written = await GeneseedLearn.writeMemories(output, memDir, new Set())
  assert.deepEqual(written.created, accepted)
  assert.deepEqual((await fs.readdir(root)).sort(), ["memory"],
    "a memory was written outside the memory dir")
  assert.deepEqual((await fs.readdir(memDir)).sort(),
    ["MEMORY.md", "topics", ...accepted.map((n) => `${n}.md`)].sort())
})

// The twin of the harness rule (tests/unit/harness.test.mjs): `MEMORY` / `README` in any case
// name the store's own files and are refused, and a stored slug matches case-insensitively —
// on Windows and macOS `User-Prefs.md` and `user-prefs.md` are the same file.
test("writeMemories: refuses reserved stems and case variants of a stored slug", async () => {
  const memDir = makeSandbox("gs-learn-").path
  await fs.writeFile(path.join(memDir, "MEMORY.md"), "# Memory Index\n- [user-prefs](user-prefs.md)\n")
  await fs.writeFile(path.join(memDir, "user-prefs.md"), "original\n")
  const chunk = (name) => `---\nname: ${name}\ndescription: d\n---\nbody`
  const output = ["MEMORY", "memory", "Readme", "User-Prefs", "fresh", "FRESH"].map(chunk).join("\n---FILE---\n")
  const written = await GeneseedLearn.writeMemories(output, memDir, new Set(["user-prefs"]))
  assert.deepEqual(written, { created: ["fresh"], updated: [], archived: [], skipped: [] })
  assert.equal(await fs.readFile(path.join(memDir, "user-prefs.md"), "utf8"), "original\n")
  // The stored fact's flat line moves into its topic file as it was; the new one joins it.
  assert.equal(await fs.readFile(path.join(memDir, "topics", "misc.md"), "utf8"),
    "# misc\n\n- [fresh](../fresh.md) — d\n- [user-prefs](../user-prefs.md)\n")
})

// The plugin's two-level index is a hand-kept twin of js/hosts/memory-files.mjs's, so the same
// reply into the same legacy store must leave the same files behind (CRLF folded: the harness
// writes the platform newline, the plugin LF). The store mixes every grouping rule — `topic:`,
// `type:`, a `type:` nested under `metadata:`, none — plus a hand hook, a dead pointer and a note.
test("writeMemories: the plugin's two-level index matches the harness's", async () => {
  const { writeMemories: harnessWrite } = await import("../../js/hosts/memory-files.mjs")
  const reply = ["---\nname: n1\ndescription: N1\ntopic: Build Tools!\n---\nb",
    "---\nname: n2\ndescription: N2\nmetadata:\n  type: project\n---\nb",
    "---\nname: n3\ndescription: N3\n---\nb"].join("\n---FILE---\n")
  const seedStore = async () => {
    const d = makeSandbox("gs-learn-").path
    await fs.writeFile(path.join(d, "old.md"), "---\nname: old\ndescription: fm\ntype: project\n---\nb\n")
    await fs.writeFile(path.join(d, "MEMORY.md"),
      "# Memory Index\n\n- [Old](old.md) — hand hook\n- [dead](dead.md) — gone\n*a note*\n")
    return d
  }
  const snapshot = async (d) => {
    const out = {}
    for (const f of ["MEMORY.md", ...(await fs.readdir(path.join(d, "topics"))).map((t) => `topics/${t}`)]) {
      out[f] = (await fs.readFile(path.join(d, f), "utf8")).replaceAll("\r\n", "\n")
    }
    return out
  }
  const a = await seedStore()
  const b = await seedStore()
  await GeneseedLearn.writeMemories(reply, a, new Set(["old"]))
  harnessWrite(reply, b, new Set(["old"]))
  const plugin = await snapshot(a)
  assert.deepEqual(plugin, await snapshot(b))
  // Not two empty stores agreeing: the expected layout, written out.
  assert.deepEqual(Object.keys(plugin).sort(),
    ["MEMORY.md", "topics/build-tools.md", "topics/misc.md", "topics/project.md"])
  assert.equal(plugin["topics/project.md"],
    "# project\n\n- [n2](../n2.md) — N2\n- [Old](../old.md) — hand hook\n")
})

// The same parity for the two other actions, on a store whose slugs differ in case: an update
// (merged text replaces the stored file, its index line regenerated), an archive (the fact
// moves into archive/, past an archive already holding its name), a skipped update of a
// missing slug, a skipped archive of a `force: constraint` fact, and a create. Fact order
// inside a topic file is the core's sortPaths order: case-folded on Windows (alpha, Beta,
// locked, mid, Zeta), plain code-unit order elsewhere (Beta, Zeta, alpha, locked, mid). Written out per platform, so a plugin that sorted plainly on Windows fails.
test("writeMemories: the plugin matches the harness on update, archive and mixed-case order", async () => {
  const { writeMemories: harnessWrite } = await import("../../js/hosts/memory-files.mjs")
  const fact = (slug, desc) => `---\nname: ${slug}\ndescription: ${desc}\ntopic: t\n---\nb\n`
  const reply = ["---\nname: zeta\naction: update\ndescription: Z2\ntopic: t\n---\nmerged",
    "---\nname: gone\naction: archive\n---",
    "---\nname: ghost\naction: update\ndescription: x\n---\nb",
    "---\nname: locked\naction: archive\n---",
    fact("mid", "M")].join("\n---FILE---\n")
  const seedStore = async () => {
    const d = makeSandbox("gs-learn-").path
    for (const [s, desc] of [["Zeta", "Z"], ["alpha", "A"], ["Beta", "B"], ["gone", "G"]]) {
      await fs.writeFile(path.join(d, `${s}.md`), fact(s, desc))
    }
    await fs.writeFile(path.join(d, "locked.md"), "---\nname: locked\ndescription: L\ntopic: t\nforce: constraint\n---\nb\n")
    await fs.mkdir(path.join(d, "archive"))
    await fs.writeFile(path.join(d, "archive", "gone.md"), "older\n")
    return d
  }
  const snapshot = async (d) => {
    const out = {}
    const rels = [...(await fs.readdir(d)).filter((f) => f.endsWith(".md")),
      ...(await fs.readdir(path.join(d, "topics"))).map((t) => `topics/${t}`),
      ...(await fs.readdir(path.join(d, "archive"))).map((t) => `archive/${t}`)]
    for (const f of rels.sort()) out[f] = (await fs.readFile(path.join(d, f), "utf8")).replaceAll("\r\n", "\n")
    return out
  }
  const existing = ["Zeta", "alpha", "Beta", "gone", "locked"]
  const a = await seedStore()
  const b = await seedStore()
  const res = await GeneseedLearn.writeMemories(reply, a, new Set(existing))
  assert.deepEqual(res, harnessWrite(reply, b, new Set(existing)))
  assert.deepEqual(res, { created: ["mid"], updated: ["Zeta"], archived: ["gone"], skipped: [] })
  const plugin = await snapshot(a)
  assert.deepEqual(plugin, await snapshot(b))
  assert.equal(plugin["Zeta.md"], "---\nname: zeta\ndescription: Z2\ntopic: t\n---\nmerged\n")
  // The update archived Zeta's previous version first, so its old body survives, unindexed.
  assert.equal(plugin["archive/Zeta.md"], fact("Zeta", "Z"))
  assert.ok(!plugin["topics/t.md"].includes("archive") && !plugin["MEMORY.md"]?.includes("archive"))
  assert.equal(plugin["archive/gone.md"], "older\n")
  assert.equal(plugin["archive/gone-2.md"], fact("gone", "G"))
  assert.ok(!("gone.md" in plugin) && !("ghost.md" in plugin) && "locked.md" in plugin)
  const order = process.platform === "win32" ? ["alpha", "Beta", "locked", "mid", "Zeta"] : ["Beta", "Zeta", "alpha", "locked", "mid"]
  const desc = { alpha: "A", Beta: "B", locked: "L", mid: "M", Zeta: "Z2" }
  assert.equal(plugin["topics/t.md"], `# t\n\n${order.map((s) => `- [${s}](../${s}.md) — ${desc[s]}`).join("\n")}\n`)
})

// ---- spec-feedback capture (twin of js/hosts/spec-feedback.mjs) ----------------------------------
// The pure part is a tool-kept twin (tests/twins.mjs); these hold the hand-kept rest: Law I's
// pattern, the file writes, and the V1 and V2 wiring that runs it for a child session.

test("spec-feedback: the plugin's credential pattern is the hook's SECRET_RE", async () => {
  const { SECRET_RE } = await import("../../js/hosts/hooks-prims.mjs")
  assert.equal(GeneseedLearn.FEEDBACK_SECRET_RE.source, SECRET_RE.source)
  assert.equal(GeneseedLearn.FEEDBACK_SECRET_RE.flags, SECRET_RE.flags)
})

test("spec-feedback: the plugin writes the same notes as the hook for the same report", async () => {
  const { captureSpecFeedback: hookCapture } = await import("../../js/hosts/spec-feedback.mjs")
  const report = "STATUS: OK\nspec-feedback: [agent] name the base — seen: drift\nspec-feedback: general say the runner — seen: a timeout"
  const a = makeSandbox("gs-learn-").path
  const b = makeSandbox("gs-learn-").path
  const got = await GeneseedLearn.captureSpecFeedback("tester", report, path.join(a, "notes"), "2026-11-14")
  hookCapture("tester", report, path.join(b, "notes"), "2026-11-14")
  assert.deepEqual(got.map((f) => path.basename(f)), ["tester.md", "_general.md"])
  for (const f of ["tester.md", "_general.md"]) {
    const mine = await fs.readFile(path.join(a, "notes", "agent-notes", f), "utf8")
    assert.equal(mine, (await fs.readFile(path.join(b, "notes", "agent-notes", f), "utf8")).replaceAll("\r\n", "\n"), f)
  }
  assert.equal(await fs.readFile(path.join(a, "notes", "agent-notes", "_general.md"), "utf8"),
    "- [general] say the runner — seen: a timeout (tester, 2026-11-14)\n")
  assert.deepEqual(await GeneseedLearn.captureSpecFeedback("tester", report, path.join(a, "notes"), "2026-11-15"), [],
    "a second run on the same report adds nothing")
})

test("spec-feedback: finalAssistantText reads the last assistant message, V1 and V2 shapes", () => {
  const { finalAssistantText } = GeneseedLearn
  assert.equal(finalAssistantText([
    { info: { role: "assistant" }, parts: [{ type: "text", text: "early" }] },
    { info: { role: "user" }, parts: [{ type: "text", text: "more" }] },
    { info: { role: "assistant" }, parts: [{ type: "text", text: "final" }, { type: "tool" }] },
  ]), "final")
  assert.equal(finalAssistantText([{ type: "assistant", content: [{ type: "text", text: "v2 final" }] }, { type: "user", text: "q" }]),
    "v2 final")
  assert.equal(finalAssistantText([]), "")
})

/** The plugin copied into a sandbox install `<d>/cfg/plugins/`, freshly imported with debounce 0. */
async function sandboxPlugin() {
  const d = makeSandbox("gs-learn-").path
  const plugins = path.join(d, "cfg", "plugins")
  await fs.mkdir(plugins, { recursive: true })
  await fs.mkdir(path.join(d, "memory"))
  await fs.copyFile(path.join(process.cwd(), "adapters/opencode/plugins/geneseed-learn.js"), path.join(plugins, "geneseed-learn.js"))
  const saved = Object.fromEntries(["GENESEED_LEARN_DEBOUNCE_MS", "GENESEED_MEMORY", "GENESEED_HARNESS", "XDG_CONFIG_HOME", "OPENCODE_CONFIG_DIR"]
    .map((k) => [k, process.env[k]]))
  Object.assign(process.env, { GENESEED_LEARN_DEBOUNCE_MS: "0", GENESEED_MEMORY: path.join(d, "memory"),
    XDG_CONFIG_HOME: path.join(d, "xdg"), OPENCODE_CONFIG_DIR: path.join(d, "elsewhere") })
  delete process.env.GENESEED_HARNESS
  const { pathToFileURL } = await import("node:url")
  const mod = (await import(pathToFileURL(path.join(plugins, "geneseed-learn.js")).href)).default
  const restore = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } }
  // The machine folder, as any emit leaves it: a machine line goes to its notes/, whatever the install.
  await fs.mkdir(path.join(d, "xdg", "geneseed"), { recursive: true })
  const tier = path.join(d, "xdg", "geneseed", "notes")
  return { d, mod, restore, tier, note: path.join(tier, "agent-notes", "tester.md") }
}
const waitFor = async (p) => { for (let i = 0; i < 200; i += 1) { try { return await fs.readFile(p, "utf8") } catch { await new Promise((r) => setTimeout(r, 25)) } } return null }
// The folder once no lock or temp file is left, polled up to 5 s; the listing as it stands after that.
const settled = async (dir) => {
  for (let i = 0; i < 200; i += 1) {
    const names = await fs.readdir(dir)
    if (!names.some((n) => n.endsWith(".lock") || n.endsWith(".tmp"))) return names
    await new Promise((r) => setTimeout(r, 25))
  }
  return fs.readdir(dir)
}
const REPORT = "done\nspec-feedback: [agent] say which runner the brief expects — seen: a refusal"

test("spec-feedback: V1 captures a named child session's report into the machine notes", async () => {
  const { mod, restore, note } = await sandboxPlugin()
  try {
    const client = { session: {
      get: async () => ({ data: { parentID: "p", agent: "tester" } }),
      messages: async () => [{ info: { role: "assistant" }, parts: [{ type: "text", text: REPORT }] }],
    } }
    const hooks = await mod.server({ client, directory: process.cwd() })
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "c1" } } })
    assert.match(await waitFor(note), /^- \[agent\] say which runner the brief expects — seen: a refusal \(tester, \d{4}-\d{2}-\d{2}\)\n$/)
  } finally { restore() }
})

test("spec-feedback: V2 captures a named child session's report, and skips an unnamed one", async () => {
  const { mod, restore, note } = await sandboxPlugin()
  try {
    const queue = []
    let wake = null
    const controller = { aborted: false }
    const ctx = {
      location: { directory: process.cwd() },
      session: {
        get: async ({ sessionID }) => (sessionID === "named" ? { parentID: "p", agent: "tester" } : { parentID: "p" }),
        context: async () => [{ type: "assistant", content: [{ type: "text", text: REPORT }] }],
      },
      generate: { text: async () => ({ text: "NOTHING" }) },
      event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {
        while (!controller.aborted) { if (queue.length) { yield queue.shift(); continue } await new Promise((r) => { wake = r }) }
      } }) },
    }
    const cleanup = await mod.setup(ctx)
    const push = (sessionID) => { queue.push({ type: "session.execution.succeeded", data: { sessionID } }); wake?.() }
    push("unnamed")
    push("named")
    assert.match(await waitFor(note), /^- \[agent\] say which runner the brief expects — seen: a refusal \(tester, \d{4}-\d{2}-\d{2}\)\n$/)
    // The note appears at the atomic rename, INSIDE the lock; the lock goes at release, a few awaits
    // later (up to ~400 ms seen under a 4-way load). So wait for the capture to settle, then require
    // that only the note is left: a lock that outlived its write would still fail here, after 5 s.
    assert.deepEqual(await settled(path.dirname(note)), ["tester.md"])
    controller.aborted = true
    wake?.()
    cleanup()
  } finally { restore() }
})

// The plugin's lock: child sessions end together in one OpenCode process, so 12 captures at once
// on one file must leave 12 bullets (a read-merge-write without the lock keeps fewer).
test("spec-feedback: 12 captures at once keep all 12 bullets", async () => {
  const d = makeSandbox("gs-learn-").path
  const notes = path.join(d, "notes")
  await Promise.all(Array.from({ length: 12 }, (_, i) =>
    GeneseedLearn.captureSpecFeedback("tester", `spec-feedback: [agent] parallel line number ${i} kept`, notes, "2026-11-14")))
  const text = await fs.readFile(path.join(notes, "agent-notes", "tester.md"), "utf8")
  assert.equal(text.split("\n").filter((l) => l.startsWith("- ")).length, 12, text)
  assert.deepEqual((await fs.readdir(path.join(notes, "agent-notes"))).filter((f) => !f.endsWith(".md")), [])
})

// The plugin's stale-lock break, as the hook's: a dead holder's lock (older than 10 s) is renamed
// away and the capture goes on; nothing of it is left behind.
test("spec-feedback: the plugin breaks a stale lock and leaves no trace", async () => {
  const d = makeSandbox("gs-learn-").path
  const dir = path.join(d, "notes", "agent-notes")
  await fs.mkdir(dir, { recursive: true })
  const lock = path.join(dir, "tester.md.lock")
  await fs.writeFile(lock, "dead.hook")
  const old = new Date(Date.now() - 60_000)
  await fs.utimes(lock, old, old)
  const got = await GeneseedLearn.captureSpecFeedback("tester", "spec-feedback: [agent] after a dead holder", path.join(d, "notes"), "2026-11-14")
  assert.deepEqual(got.map((f) => path.basename(f)), ["tester.md"])
  assert.deepEqual(await fs.readdir(dir), ["tester.md"])
})

// F8: a TOP-LEVEL session keeps the old order: with no memory store found, its messages are never
// fetched (the early fetch is for a child's report only).
test("spec-feedback: V1 fetches a top-level session's messages only once a store is known", async () => {
  const { d, mod, restore } = await sandboxPlugin()
  try {
    await fs.rm(path.join(d, "memory"), { recursive: true })
    delete process.env.GENESEED_MEMORY
    const calls = []
    const client = { session: {
      get: async () => { calls.push("get"); return { data: { title: "work" } } },
      messages: async () => { calls.push("messages"); return [] },
    } }
    const hooks = await mod.server({ client, directory: process.cwd() })
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "top" } } })
    for (let i = 0; i < 40 && !calls.includes("get"); i += 1) await new Promise((r) => setTimeout(r, 25))
    await new Promise((r) => setTimeout(r, 100))
    assert.deepEqual(calls, ["get"])
  } finally { restore() }
})

// ---- a skill's feedback line, at every turn's end (twin of the Claude Stop capture) ---------------
// The session's last reply is read at each V1 `session.idle` / V2 `session.execution.succeeded`, not
// after the debounce, and its `[skill:<name>]` lines go to `skill-notes/` for a skill the install ships.
const SKILL_REPLY = "Done.\nspec-feedback: [skill:debug] read the stack trace first — seen: a guess\n"
  + "spec-feedback: [skill:debug:general] say the runner — seen: a wrong one\nspec-feedback: [agent] relayed — seen: y"
const SKILL_NOTE = /^- \[skill\] read the stack trace first — seen: a guess \(debug, \d{4}-\d{2}-\d{2}\)\n$/
const SKILL_GENERAL = /^- \[general\] say the runner — seen: a wrong one \(debug, \d{4}-\d{2}-\d{2}\)\n$/
// The install ships `debug` as a render does: its SKILL.md names its own notes file (`liveSkill`).
async function withSkills(sb, name = "debug", notesOf = name) {
  await fs.mkdir(path.join(sb.d, "cfg", "skills", name), { recursive: true })
  await fs.writeFile(path.join(sb.d, "cfg", "skills", name, "SKILL.md"), `Read \`notebook/skill-notes/${notesOf}.md\` first.\n`)
  return path.join(sb.tier, "skill-notes")
}

// One message per turn, not the session: the newest assistant message `message.updated` named is
// read with `session.message`, and the whole history is read only when no such event was seen.
test("skill feedback: V1 reads only the newest assistant message once message.updated named it", async () => {
  const sb = await sandboxPlugin()
  try {
    const dir = await withSkills(sb)
    const calls = []
    const client = { session: {
      get: async () => ({ data: { title: "work" } }),
      message: async ({ path: p }) => { calls.push(`message ${p.messageID}`); return { data: { info: { role: "assistant" }, parts: [{ type: "text", text: SKILL_REPLY }] } } },
      messages: async () => { calls.push("messages"); return [] },
    } }
    const hooks = await sb.mod.server({ client, directory: process.cwd() })
    await hooks.event({ event: { type: "message.updated", properties: { info: { id: "u1", role: "user", sessionID: "top" } } } })
    await hooks.event({ event: { type: "message.updated", properties: { info: { id: "a2", role: "assistant", sessionID: "top" } } } })
    await hooks.event({ event: { type: "message.updated", properties: { info: { id: "x9", role: "assistant", sessionID: "other" } } } })
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "top" } } })
    assert.match((await waitFor(path.join(dir, "debug.md"))) ?? "", SKILL_NOTE)
    await settled(dir)
    assert.deepEqual(calls.filter((c) => c.startsWith("message ")), ["message a2"])
    assert.equal(calls.filter((c) => c === "messages").length <= 1, true, "the debounced distil may read once; the capture never")
  } finally { sb.restore() }
})

// An alias folder an older build left reads another skill's notes: not live, no note.
test("skill feedback: an alias folder is not a live skill", async () => {
  const sb = await sandboxPlugin()
  try {
    const dir = await withSkills(sb, "debug", "dependencies")
    const fetch = async () => [{ info: { role: "assistant" }, parts: [{ type: "text", text: SKILL_REPLY }] }]
    assert.deepEqual(await sb.mod.server.captureTurn(fetch, process.cwd()), [])
    await assert.rejects(fs.stat(dir))
  } finally { sb.restore() }
})

test("skill feedback: V1 copies a top-level session's last reply at session.idle, before any debounce", async () => {
  const sb = await sandboxPlugin()
  try {
    const dir = await withSkills(sb)
    process.env.GENESEED_LEARN_DEBOUNCE_MS = "600000" // the distil waits; the capture must not
    const client = { session: {
      get: async () => ({ data: { title: "work" } }),
      messages: async () => [{ info: { role: "user" }, parts: [{ type: "text", text: "fix it" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: SKILL_REPLY }] }],
    } }
    const { mod } = sb
    const fresh = (await import(`${(await import("node:url")).pathToFileURL(path.join(sb.d, "cfg", "plugins", "geneseed-learn.js")).href}?slow`)).default
    const hooks = await fresh.server({ client, directory: process.cwd() })
    try {
      await hooks.event({ event: { type: "session.idle", properties: { sessionID: "top" } } })
      assert.match((await waitFor(path.join(dir, "debug.md"))) ?? "", SKILL_NOTE)
      assert.match((await waitFor(path.join(dir, "_general.md"))) ?? "", SKILL_GENERAL)
      assert.deepEqual((await settled(dir)).sort(), ["_general.md", "debug.md"])
      await assert.rejects(fs.stat(path.join(sb.d, "cfg", "notebook", "agent-notes")), "a relayed [agent] line is no note")
    } finally {
      await hooks.event({ event: { type: "session.deleted", properties: { sessionID: "top" } } }) // drops the 10-minute timer
    }
    // A second idle on the same reply adds nothing.
    const once = await fs.readFile(path.join(dir, "debug.md"), "utf8")
    assert.deepEqual(await mod.server.captureTurn(client.session.messages, process.cwd()), [])
    assert.equal(await fs.readFile(path.join(dir, "debug.md"), "utf8"), once)
  } finally { sb.restore() }
})

test("skill feedback: V2 copies the last reply at session.execution.succeeded", async () => {
  const sb = await sandboxPlugin()
  try {
    const dir = await withSkills(sb)
    const queue = []
    let wake = null
    const controller = { aborted: false }
    const ctx = {
      location: { directory: process.cwd() },
      session: {
        get: async () => ({ title: "work" }),
        context: async () => [{ type: "user", text: "fix it" }, { type: "assistant", content: [{ type: "text", text: SKILL_REPLY }] }],
      },
      generate: { text: async () => ({ text: "NOTHING" }) },
      event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {
        while (!controller.aborted) { if (queue.length) { yield queue.shift(); continue } await new Promise((r) => { wake = r }) }
      } }) },
    }
    const cleanup = await sb.mod.setup(ctx)
    queue.push({ type: "session.execution.succeeded", data: { sessionID: "top" } })
    wake?.()
    assert.match((await waitFor(path.join(dir, "debug.md"))) ?? "", SKILL_NOTE)
    assert.match((await waitFor(path.join(dir, "_general.md"))) ?? "", SKILL_GENERAL)
    assert.deepEqual((await settled(dir)).sort(), ["_general.md", "debug.md"])
    controller.aborted = true
    wake?.()
    cleanup()
  } finally { sb.restore() }
})

// Each row reads nothing at all: the session's messages are never fetched.
test("skill feedback: no skills/ folder, or an excluded folder, fetches nothing and writes nothing", async () => {
  const sb = await sandboxPlugin()
  try {
    let fetched = 0
    const fetch = async () => { fetched += 1; return [{ info: { role: "assistant" }, parts: [{ type: "text", text: SKILL_REPLY }] }] }
    assert.deepEqual(await sb.mod.server.captureTurn(fetch, process.cwd()), [], "no skills/ folder")
    const dir = await withSkills(sb)
    const proj = path.join(sb.d, "proj")
    await fs.mkdir(proj)
    await fs.writeFile(path.join(sb.d, "cfg", "excludes.json"), JSON.stringify({ excludes: [proj] }))
    assert.deepEqual(await sb.mod.server.captureTurn(fetch, proj), [], "an excluded folder")
    assert.equal(fetched, 0)
    await assert.rejects(fs.stat(dir))
    // The positive control: the same world outside the excluded folder does write.
    assert.equal((await sb.mod.server.captureTurn(fetch, process.cwd())).length, 2)
    assert.equal(fetched, 1)
  } finally { sb.restore() }
})

// A child session's report: its agent's lines to agent-notes, a skill line it carries to skill-notes.
test("skill feedback: a child session's [skill:…] line goes to skill-notes, not to the agent's notes", async () => {
  const sb = await sandboxPlugin()
  try {
    await withSkills(sb)
    const notes = path.join(sb.d, "cfg", "notebook")
    const got = await sb.mod.server.captureSpecFeedback("tester", SKILL_REPLY, notes, "2026-11-14", path.join(sb.d, "cfg", "skills"))
    assert.deepEqual(got.map((f) => path.relative(notes, f).replaceAll("\\", "/")),
      ["agent-notes/tester.md", "skill-notes/debug.md", "skill-notes/_general.md"])
    assert.equal(await fs.readFile(path.join(notes, "agent-notes", "tester.md"), "utf8"), "- [agent] relayed — seen: y (tester, 2026-11-14)\n")
  } finally { sb.restore() }
})

// ---- the two scopes (twin of js/hosts/hooks-learn.mjs `notesRootsOf`) ----------------------------
// Machine lines to the tier's notes for every install; project lines to `<project>/notebook`, where
// the project is a project install's parent (`<repo>/.opencode/plugins` → `<repo>`) and a global
// install's session root's git root. A notebook the capture creates gets its ignore file.
const SCOPES_REPORT = "STATUS: OK\nspec-feedback: [agent] name the base — seen: drift\n"
  + "spec-feedback: [agent:project] this repo needs --jobs 2 — seen: a timeout\n"
  + "spec-feedback: [skill:debug:project] this repo pins node 20 — seen: a wrong runtime\n"
  + "spec-feedback: [general:project] every agent here runs from app/ — seen: a wrong cwd"
const PROJECT_GENERAL = /^- \[general\] every agent here runs from app\/ — seen: a wrong cwd \(tester, \d{4}-\d{2}-\d{2}\)\n$/
const PROJECT_AGENT = /^- \[agent\] this repo needs --jobs 2 — seen: a timeout \(tester, \d{4}-\d{2}-\d{2}\)\n$/
const PROJECT_SKILL = /^- \[skill\] this repo pins node 20 — seen: a wrong runtime \(debug, \d{4}-\d{2}-\d{2}\)\n$/

/** A copy of the plugin in `pluginsDir`, imported fresh (its PLUGIN_DIR is that folder). */
async function copyAt(pluginsDir, tag) {
  await fs.mkdir(pluginsDir, { recursive: true })
  await fs.copyFile(path.join(process.cwd(), "adapters/opencode/plugins/geneseed-learn.js"), path.join(pluginsDir, "geneseed-learn.js"))
  const { pathToFileURL } = await import("node:url")
  return (await import(`${pathToFileURL(path.join(pluginsDir, "geneseed-learn.js")).href}?${tag}`)).default.server
}

test("two scopes: V1 and V2 child sessions send each line to its scope, for a project and a global install", async () => {
  const sb = await sandboxPlugin()
  try {
    const specSkill = "debug"
    const repo = path.join(sb.d, "repo")
    await fs.mkdir(path.join(repo, ".git"), { recursive: true })
    const project = await copyAt(path.join(repo, ".opencode", "plugins"), "proj")
    const shipped = async (pluginsDir) => {
      await fs.mkdir(path.join(pluginsDir, "..", "skills", specSkill), { recursive: true })
      await fs.writeFile(path.join(pluginsDir, "..", "skills", specSkill, "SKILL.md"), "Read `notebook/skill-notes/debug.md` first.\n")
    }
    await shipped(path.join(repo, ".opencode", "plugins"))
    // V1, a project install: its parent is the project, whatever the session root.
    const v1 = await project({ client: { session: {
      get: async () => ({ data: { parentID: "p", agent: "tester" } }),
      messages: async () => [{ info: { role: "assistant" }, parts: [{ type: "text", text: SCOPES_REPORT }] }],
    } }, directory: repo, worktree: repo })
    await v1.event({ event: { type: "session.idle", properties: { sessionID: "c1" } } })
    assert.match((await waitFor(path.join(repo, "notebook", "agent-notes", "tester.md"))) ?? "", PROJECT_AGENT)
    assert.match((await waitFor(path.join(repo, "notebook", "skill-notes", "debug.md"))) ?? "", PROJECT_SKILL)
    assert.match((await waitFor(path.join(repo, "notebook", "agent-notes", "_general.md"))) ?? "", PROJECT_GENERAL)
    assert.match((await waitFor(sb.note)) ?? "", /^- \[agent\] name the base — seen: drift \(tester, \d{4}-\d{2}-\d{2}\)\n$/)
    // No file goes into the project: the clone's own .git/info/exclude names the notes, once.
    await assert.rejects(fs.stat(path.join(repo, "notebook", ".gitignore")))
    const { excludeWithNotes } = await import("../../js/hosts/spec-feedback.mjs")
    assert.equal(await fs.readFile(path.join(repo, ".git", "info", "exclude"), "utf8"), excludeWithNotes("", "notebook"))
    await assert.rejects(fs.stat(path.join(repo, ".opencode", "notebook")), "a note went to the plugin layer's notebook")

    // V2, a global install (its marker says so): the session root's git root is the project.
    const gcfg = path.join(sb.d, "gcfg")
    const global = await copyAt(path.join(gcfg, "plugins"), "glob")
    await fs.writeFile(path.join(gcfg, ".geneseed-emit"), "opencode-global\n")
    const other = path.join(sb.d, "other")
    await fs.mkdir(path.join(other, ".git"), { recursive: true })
    await fs.mkdir(path.join(other, "src"))
    const roots = await global.notesRootsOf(path.join(gcfg, "plugins"), path.join(other, "src"))
    assert.deepEqual(roots, { machine: sb.tier, project: path.join(other, "notebook") })
    const { gitRootOf } = await import("../../js/hosts/gitref.mjs")
    if (!gitRootOf(sb.d)) {   // a temp folder inside a repo (a home kept under git) has a project after all
      assert.deepEqual(await global.notesRootsOf(path.join(gcfg, "plugins"), sb.d), { machine: sb.tier, project: null },
        "a global session outside any repo has no project")
    }
    const queue = []
    let wake = null
    const controller = { aborted: false }
    const cleanup = await (await import(`${(await import("node:url")).pathToFileURL(path.join(gcfg, "plugins", "geneseed-learn.js")).href}?glob`)).default.setup({
      location: { directory: path.join(other, "src"), project: { directory: other } },
      session: {
        get: async () => ({ parentID: "p", agent: "tester" }),
        context: async () => [{ type: "assistant", content: [{ type: "text", text: SCOPES_REPORT }] }],
      },
      generate: { text: async () => ({ text: "NOTHING" }) },
      event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {
        while (!controller.aborted) { if (queue.length) { yield queue.shift(); continue } await new Promise((r) => { wake = r }) }
      } }) },
    })
    queue.push({ type: "session.execution.succeeded", data: { sessionID: "named" } })
    wake?.()
    assert.match((await waitFor(path.join(other, "notebook", "agent-notes", "tester.md"))) ?? "", PROJECT_AGENT)
    controller.aborted = true
    wake?.()
    cleanup()
  } finally { sb.restore() }
})

// A global and a project copy loaded together both see a child's end and both capture it: each
// bullet lands once, in the one machine file and the one project file (the duplicate check runs
// under the lock).
test("two scopes: a global and a project copy capturing the same report write each bullet once", async () => {
  const sb = await sandboxPlugin()
  try {
    const repo = path.join(sb.d, "repo")
    await fs.mkdir(path.join(repo, ".git"), { recursive: true })
    const project = await copyAt(path.join(repo, ".opencode", "plugins"), "p2")
    const gcfg = path.join(sb.d, "gcfg")
    const global = await copyAt(path.join(gcfg, "plugins"), "g2")
    await fs.writeFile(path.join(gcfg, ".geneseed-emit"), "opencode-global\n")
    const pr = await project.notesRootsOf(path.join(repo, ".opencode", "plugins"), repo)
    const gr = await global.notesRootsOf(path.join(gcfg, "plugins"), repo)
    assert.deepEqual(pr, gr)
    await Promise.all([project.captureSpecFeedback("tester", SCOPES_REPORT, pr, "2026-11-15"),
      global.captureSpecFeedback("tester", SCOPES_REPORT, gr, "2026-11-15")])
    assert.equal(await fs.readFile(path.join(repo, "notebook", "agent-notes", "tester.md"), "utf8"),
      "- [agent] this repo needs --jobs 2 — seen: a timeout (tester, 2026-11-15)\n")
    assert.equal(await fs.readFile(sb.note, "utf8"), "- [agent] name the base — seen: drift (tester, 2026-11-15)\n")
  } finally { sb.restore() }
})

test("buildPrompt stays in parity with js/hosts/hooks-learn.mjs's buildLearnPrompt (twin)", async () => {
  const src = await fs.readFile(path.join(process.cwd(), "adapters/opencode/plugins/geneseed-learn.js"), "utf8")
  const m = src.match(/const MAX_STORED_CHARS = \d+\nfunction buildPrompt\(notes, facts\) \{[\s\S]*?\n\}\n/)
  assert.ok(m, "MAX_STORED_CHARS + buildPrompt not found in geneseed-learn.js")
  // The head is the plugin's own literal either way: learnPromptHead() extracts it from this file.
  // buildPrompt picks its facts with the copied memory-search block (held equal to the original by tests/twins.mjs).
  const search = src.slice(src.indexOf("// ---- memory-search twin: BEGIN"), src.indexOf("// ---- memory-search twin: END"))
  assert.ok(search.length > 100, "memory-search block not found in geneseed-learn.js")
  const twin = new Function("LEARN_PROMPT_HEAD", `${search}\n${m[0]}; return buildPrompt`)(learnPromptHead())
  const fact = (desc, topic) => ({ desc, topic })
  // 200 lines of ~70 chars run well past MAX_STORED_CHARS (8000), so the cap and the
  // "more stored facts not shown" line are both exercised.
  const many = new Map(Array.from({ length: 200 }, (_, i) =>
    [`fact-${i}`, fact(`a stored lesson long enough to count, number ${i} of many`, `t${i % 3}`)]))
  const rows = [
    ["empty store", "some notes", new Map()],
    ["one fact", "notes — with a dash", new Map([["alpha", fact("A thing", "general")]])],
    ["no description", "n", new Map([["bare", fact("", "z")], ["dup", fact("D", "z")]])],
    ["over the cap", "n", many],
  ]
  for (const [label, notes, facts] of rows) assert.equal(twin(notes, facts), buildLearnPrompt(notes, facts), label)
  assert.match(buildLearnPrompt("n", many), /more stored facts not shown/, "the cap row must reach the cap")
})

// ---- O8: each transcript region is distilled once (D4, D6) ----------------------------------------
// Before: every 60 s quiet window re-mined the whole session from turn 1, so 3 turns made 3 distils that each held turn 1.
const turnText = (n) => `turn ${n}: ${String.fromCharCode(96 + n).repeat(120)}`
const asV1 = (texts) => texts.map((text, i) => ({ info: { role: i % 2 ? "assistant" : "user", providerID: "p", modelID: "m" }, parts: [{ type: "text", text }] }))
const asV2 = (texts) => texts.map((text, i) => (i % 2 ? { type: "assistant", content: [{ type: "text", text }], model: { providerID: "p", id: "m" } } : { type: "user", text }))
const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i += 1) await new Promise((r) => setTimeout(r, 25)); return fn() }
/** What a prompt says before and after its NEW TURNS mark: [context part, new part]. */
const windowOf = (prompt) => {
  const notes = prompt.slice(prompt.indexOf("\nNOTES:\n") + 8)
  const at = notes.indexOf("NEW TURNS (distil from these):\n")
  return at < 0 ? ["", notes] : [notes.slice(0, at), notes.slice(at)]
}

test("cursor V1: 3 turns -> each distil holds only the new turns, the 2 messages before them as marked context", async () => {
  const { mod, restore } = await sandboxPlugin()
  try {
    const texts = []
    const prompts = []
    let fail = false
    const client = { session: {
      get: async () => ({ data: {} }),
      messages: async () => asV1(texts),
      create: async () => ({ id: "tmp" }),
      delete: async () => {},
      prompt: async ({ body }) => { if (fail) throw new Error("model down"); prompts.push(body.parts[0].text); return { parts: [{ type: "text", text: "NOTHING" }] } },
    } }
    const hooks = await mod.server({ client, directory: process.cwd() })
    const turn = async (n, want) => {
      texts.push(turnText(n * 2 - 1), turnText(n * 2))
      await hooks.event({ event: { type: "session.idle", properties: { sessionID: "top" } } })
      await until(() => prompts.length >= want || fail)
      await new Promise((r) => setTimeout(r, 100))
    }
    await turn(1, 1)
    await turn(2, 2)
    await turn(3, 3)
    assert.equal(prompts.length, 3, "one distil per turn")
    const [c1, n1] = windowOf(prompts[0])
    assert.equal(c1, "", "the first distil has no context and no marks")
    assert.ok(n1.includes(turnText(1)) && n1.includes(turnText(2)))
    const [c2, n2] = windowOf(prompts[1])
    assert.ok(c2.includes(turnText(1)) && c2.includes(turnText(2)), "context: the 2 messages before the cursor")
    assert.ok(n2.includes(turnText(3)) && n2.includes(turnText(4)) && !n2.includes(turnText(1)), "new: only turns 3-4")
    const [c3, n3] = windowOf(prompts[2])
    assert.ok(c3.includes(turnText(3)) && c3.includes(turnText(4)) && !c3.includes(turnText(1)), "context moved on with the cursor")
    assert.ok(n3.includes(turnText(5)) && !n3.includes(turnText(3)) && !n3.includes(turnText(1)))
    // A distil that fails leaves its region for the next one: the cursor moves only after success.
    fail = true
    await turn(4, 3)
    fail = false
    await turn(5, 4)
    const [, n5] = windowOf(prompts[3])
    assert.ok(n5.includes(turnText(7)) && n5.includes(turnText(9)), "the failed region (turn 4, and 5) is mined by the next distil")
    // New text under MIN_NOTES_CHARS is no distil.
    texts.push("ok", "thanks")
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "top" } } })
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(prompts.length, 4, "a trivial tail runs no model")
  } finally { restore() }
})

test("cursor V2: the same windows through setup() and generate.text", async () => {
  const { mod, restore } = await sandboxPlugin()
  try {
    const texts = []
    const prompts = []
    const queue = []
    let wake = null
    const controller = { aborted: false }
    const ctx = {
      location: { directory: process.cwd() },
      session: { get: async () => ({}), context: async () => asV2(texts) },
      generate: { text: async ({ prompt }) => { prompts.push(prompt); return { text: "NOTHING" } } },
      event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {
        while (!controller.aborted) { if (queue.length) { yield queue.shift(); continue } await new Promise((r) => { wake = r }) }
      } }) },
    }
    const cleanup = await mod.setup(ctx)
    const turn = async (n) => {
      texts.push(turnText(n * 2 - 1), turnText(n * 2))
      queue.push({ type: "session.execution.succeeded", data: { sessionID: "top" } })
      wake?.()
      await until(() => prompts.length >= n)
      await new Promise((r) => setTimeout(r, 100))
    }
    await turn(1)
    await turn(2)
    await turn(3)
    assert.equal(prompts.length, 3)
    const [c2, n2] = windowOf(prompts[1])
    assert.ok(c2.includes(turnText(2)) && n2.includes(turnText(3)) && !n2.includes(turnText(1)))
    const [c3, n3] = windowOf(prompts[2])
    assert.ok(c3.includes(turnText(4)) && !c3.includes(turnText(1)) && n3.includes(turnText(6)) && !n3.includes(turnText(3)))
    controller.aborted = true
    wake?.()
    cleanup()
  } finally { restore() }
})

test("retrieval + guard through the plugin: a just-written fact is listed with 1200 stored, a restated one is skipped", async () => {
  const { mod, d, restore } = await sandboxPlugin()
  try {
    const mem = path.join(d, "memory")
    for (let i = 0; i < 1200; i += 1) {
      const slug = `fact-${String(i).padStart(4, "0")}`
      await fs.writeFile(path.join(mem, `${slug}.md`), `---\nname: ${slug}\ndescription: filler lesson ${i} on subject ${i % 31}\n---\nbody ${i}\n`)
    }
    const old = new Date(Date.now() - 3600_000)
    for (const f of await fs.readdir(mem)) await fs.utimes(path.join(mem, f), old, old)
    const said = "A prompt never rides the command line because cmd.exe reads percent signs inside quotes"
    const reply = `---\nname: zz-stdin\ndescription: ${said}\ntopic: windows\n---\nSend it over stdin.`
    const prompts = []
    let out = reply
    const texts = [turnText(1), turnText(2)]
    const client = { session: {
      get: async () => ({ data: {} }), messages: async () => asV1(texts), create: async () => ({ id: "tmp" }), delete: async () => {},
      prompt: async ({ body }) => { prompts.push(body.parts[0].text); return { parts: [{ type: "text", text: out }] } },
    } }
    const hooks = await mod.server({ client, directory: process.cwd() })
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "top" } } })
    assert.ok(await until(() => prompts.length >= 1))
    await until(() => fsSyncExists(path.join(mem, "topics", "windows.md"))) // the index rebuild is the distil's last write
    await new Promise((r) => setTimeout(r, 300))
    // The next distil, on new turns, must see the fact the first wrote although it sorts last of 1201.
    texts.push(turnText(3), turnText(4))
    out = `---\nname: zz-stdin-again\ndescription: ${said}\ntopic: windows\n---\nSend it over stdin.`
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "top" } } })
    assert.ok(await until(() => prompts.length >= 2))
    assert.ok(prompts[1].includes(`- zz-stdin — ${said}`), "the fact just written is in the next prompt")
    await new Promise((r) => setTimeout(r, 3000))
    assert.ok(!fsSyncExists(path.join(mem, "zz-stdin-again.md")), "a restated fact is skipped by the guard")
  } finally { restore() }
})
import { existsSync as fsSyncExists } from "node:fs"
