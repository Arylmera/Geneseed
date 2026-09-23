// Unit tests for the workflow runtime core — orchestration logic only, against a mock
// SDK client (no live OpenCode). Run from the Geneseed root:
//   node --test tests/workflow_runtime.test.mjs
//
// ⚠ THIS FILE STAYS AT tests/ TOP LEVEL, ALONE AMONG THE PLUGIN SUITES, AND THE REASON IS A
// CONSTRAINT RATHER THAN AN OVERSIGHT. Its subject, adapters/opencode/workflows/_runtime.js,
// names this path in a comment — and that file is EMITTED into every bundle, so its bytes are
// hashed into the recorded emit corpus. The 2.0 re-layout moved this suite to tests/plugins/
// and updated the pointer to match; the emit corpus went red on a +8-byte change (`plugins/`),
// and the corpus is frozen — every program that could re-record it is deleted. So the pointer
// cannot follow the file, and a stale path inside something we SHIP is worse than one suite
// sitting outside a directory shape. The file came back instead.
//
// If a future change ever legitimately re-records the emit corpus, this suite can move to
// tests/plugins/ and the pointer can move with it. Until then, moving it breaks a shipped
// comment silently — nothing fails, the comment just stops being true. See docs/limits.md.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  createRuntime, createLimiter, validateSchema, extractJson, overlaps,
} from "../adapters/opencode/workflows/_runtime.js"
import { makeSandbox } from "./helpers/sandbox.mjs"

// A mock plugin `client`: each prompt records itself, tracks live concurrency, and
// replies via the supplied responder. `reply(text, callIndex)` returns the reply text.
function mockClient(responder) {
  let nextId = 1, active = 0, maxActive = 0
  const calls = []
  const delay = responder.delay || (() => 2)
  return {
    stats: () => ({ maxActive, calls }),
    session: {
      create: async () => ({ id: `s${nextId++}` }),
      prompt: async ({ body }) => {
        active++; maxActive = Math.max(maxActive, active)
        const text = body.parts[0].text
        calls.push(text)
        await new Promise((r) => setTimeout(r, delay(text)))
        active--
        return { parts: [{ type: "text", text: responder.reply(text, calls.length) }] }
      },
      messages: async () => [],
      delete: async () => {},
    },
  }
}

test("concurrency cap bounds in-flight child sessions", async () => {
  const client = mockClient({ delay: () => 10, reply: () => "ok" })
  const rt = createRuntime({ client, concurrency: 2 })
  const out = await rt.parallel(Array.from({ length: 6 }, (_, i) => () => rt.agent(`p${i}`)))
  assert.equal(out.length, 6)
  assert.ok(out.every((x) => x === "ok"))
  assert.ok(client.stats().maxActive <= 2, `maxActive was ${client.stats().maxActive}`)
})

test("schema validation retries then returns the parsed object", async () => {
  const client = mockClient({ reply: (_t, n) => (n === 1 ? "not json at all" : '{"ok":true}') })
  const rt = createRuntime({ client })
  const res = await rt.agent("do it", { schema: (v) => v?.ok === true || "need ok=true" })
  assert.deepEqual(res, { ok: true })
  assert.equal(client.stats().calls.length, 2) // one bad + one good
})

test("schema unmet after all retries returns null (3 attempts)", async () => {
  const client = mockClient({ reply: () => "never valid" })
  const rt = createRuntime({ client })
  const res = await rt.agent("do it", { schema: (v) => v?.ok === true || "need ok" })
  assert.equal(res, null)
  assert.equal(client.stats().calls.length, 3) // initial + 2 retries
})

test("pipeline drops a throwing item's stage to null, keeps others", async () => {
  const client = mockClient({ reply: () => "ok" })
  const rt = createRuntime({ client })
  const out = await rt.pipeline(
    [1, 2, 3],
    (x) => { if (x === 2) throw new Error("boom"); return x * 10 },
    (x) => x + 1,
  )
  assert.deepEqual(out, [11, null, 31])
})

test("pipeline has no barrier between stages (fast item finishes first)", async () => {
  const client = mockClient({ reply: () => "ok" })
  const rt = createRuntime({ client })
  const done = []
  const wait = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms))
  await rt.pipeline(
    ["slow", "fast"],
    (x) => wait(x === "slow" ? 40 : 1, x), // stage 1: slow item lags
    (x) => wait(1, x),                      // stage 2
    (x) => { done.push(x); return x },      // stage 3: record completion order
  )
  assert.deepEqual(done, ["fast", "slow"]) // fast cleared all 3 stages before slow's stage 1
})

test("parallel and pipeline item caps are each enforced", async () => {
  const client = mockClient({ reply: () => "ok" })
  const rt = createRuntime({ client })
  // Anchored regexes: /item cap/ alone would let one function's cap silently
  // regress while the other's still matches.
  await assert.rejects(() => rt.parallel(new Array(4097).fill(() => 0)), /parallel\(\) item cap/)
  await assert.rejects(() => rt.pipeline(new Array(4097).fill(0), (x) => x), /pipeline\(\) item cap/)
})

test("budget exhaustion throws on the next agent call", async () => {
  const client = mockClient({ reply: () => "x".repeat(10) })
  // mock returns no token usage, so simulate spend via a 0 budget → first call allowed,
  // but a 0 total blocks immediately.
  const rt = createRuntime({ client, budget: 0 })
  await assert.rejects(() => rt.agent("p"), /token budget/)
})

test("agent returns null when the child session cannot be created", async () => {
  // This is the null the saved workflows must guard against before interpolating
  // a phase result into the next prompt (see research-plan-implement.js).
  const client = { session: {
    create: async () => { throw new Error("server down") },
    prompt: async () => ({}),
  } }
  const rt = createRuntime({ client })
  assert.equal(await rt.agent("p1"), null)
  // A later call returns null too — no retry state leaks between calls. (Saved
  // workflows must guard that null before interpolating a phase result into the
  // next prompt, or it reads as the literal string "null" — see
  // research-plan-implement.js.)
  assert.equal(await rt.agent("p2"), null)
})

test("extractJson pulls JSON from a fenced reply", () => {
  assert.deepEqual(extractJson('here:\n```json\n{"a":1}\n```\nthanks'), { a: 1 })
  assert.deepEqual(extractJson('prefix {"b":[1,2]} suffix'), { b: [1, 2] })
  assert.equal(extractJson("no json here"), undefined)
})

test("validateSchema supports predicate, descriptor, and zod-like", () => {
  assert.equal(validateSchema((v) => v > 0 || "pos", 5).ok, true)
  assert.equal(validateSchema((v) => v > 0 || "pos", -1).ok, false)
  assert.equal(validateSchema({ type: "object", required: ["x"] }, { x: 1 }).ok, true)
  assert.equal(validateSchema({ type: "object", required: ["x"] }, {}).ok, false)
  assert.equal(validateSchema({ safeParse: (v) => ({ success: true, data: v }) }, 1).ok, true)
})

test("createLimiter never exceeds its max", async () => {
  const limit = createLimiter(3)
  let active = 0, max = 0
  const task = () => limit(async () => {
    active++; max = Math.max(max, active)
    await new Promise((r) => setTimeout(r, 5))
    active--
  })
  await Promise.all(Array.from({ length: 12 }, task))
  assert.ok(max <= 3, `max was ${max}`)
})

// ---- worktree isolation ---------------------------------------------------------
// Against a REAL git repository in the OS temp root: what isolation promises is a git
// fact (a branch exists, a directory is gone), and a mocked git would only restate the
// code. The SDK stays mocked — a child "edits" by writing into whatever directory its
// session was created in, which is exactly the routing `query.directory` must get right.
const gitSync = (argv, cwd) => execFileSync("git", argv, { cwd, encoding: "utf8" })
const git = async (argv, cwd) => gitSync(argv, cwd)

function tempRepo() {
  const sb = makeSandbox("gs-wf-repo-")
  const dir = sb.path
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.email", "t@t"], ["config", "user.name", "t"],
    ["config", "commit.gpgsign", "false"]]) gitSync(a, dir)
  fs.writeFileSync(path.join(dir, "shared.txt"), "base\n")
  gitSync(["add", "."], dir); gitSync(["commit", "-q", "-m", "base"], dir)
  return { dir, cleanup: sb.cleanup }
}

// edits: label-in-prompt -> [[file, content]]. Records the directory each session ran in.
function editingClient(edits, reply = () => "done") {
  let next = 1
  const dirOf = new Map(), ran = []
  return {
    ran,
    session: {
      create: async ({ query } = {}) => { const id = `s${next++}`; dirOf.set(id, query?.directory); return { id } },
      prompt: async ({ path: { id }, body }) => {
        const text = body.parts[0].text, dir = dirOf.get(id)
        ran.push({ text, dir })
        for (const [key, files] of Object.entries(edits)) {
          if (!text.startsWith(key)) continue
          for (const [f, c] of files) fs.writeFileSync(path.join(dir, f), c)
        }
        return { parts: [{ type: "text", text: reply(text, ran.length) }] }
      },
      messages: async () => [],
      delete: async () => {},
    },
  }
}

test("isolated agents run in their own worktrees, and a file two of them changed is reported", async () => {
  const { dir: repo, cleanup } = tempRepo()
  const client = editingClient({
    a: [["shared.txt", "from a\n"], ["a.txt", "a\n"]],
    b: [["shared.txt", "from b\n"]],
  })
  const rt = createRuntime({ client, directory: repo, git, runId: "t1" })
  await rt.parallel(["a", "b", "c"].map((k) => () => rt.agent(`${k} task`, { label: k, isolation: "worktree" })))

  // Every child ran somewhere other than the shared tree, and the shared tree is untouched.
  assert.equal(client.ran.length, 3)
  assert.ok(client.ran.every((r) => r.dir && path.resolve(r.dir) !== path.resolve(repo)))
  assert.equal(fs.readFileSync(path.join(repo, "shared.txt"), "utf8"), "base\n")
  assert.equal(gitSync(["status", "--porcelain"], repo), "")

  // a and b changed files, so both are kept with what they touched; c changed nothing.
  const kept = rt.worktrees().sort((x, y) => (x.label < y.label ? -1 : 1))
  assert.deepEqual(kept.map((w) => [w.label, w.files]), [["a", ["a.txt", "shared.txt"]], ["b", ["shared.txt"]]])
  assert.ok(kept.every((w) => fs.existsSync(w.dir)))
  assert.deepEqual(rt.overlaps().map((o) => [o.file, [...o.labels].sort()]), [["shared.txt", ["a", "b"]]])

  // c's worktree and branch are gone; a's and b's branches remain for the parent to merge.
  const cDir = client.ran.find((r) => r.text.startsWith("c")).dir
  assert.equal(fs.existsSync(cDir), false, "the unchanged worktree was not released")
  const branches = gitSync(["branch", "--list", "geneseed-wf/*", "--format=%(refname:short)"], repo).trim().split("\n").sort()
  assert.deepEqual(branches, ["geneseed-wf/t1-1-a", "geneseed-wf/t1-2-b"])

  for (const w of kept) gitSync(["worktree", "remove", "--force", w.dir], repo)
  cleanup()
})

test("isolation without a git executor fails the agent and never runs it in the shared tree", async () => {
  const client = editingClient({})
  const rt = createRuntime({ client, directory: os.tmpdir() })
  assert.equal(await rt.agent("x", { isolation: "worktree" }), null)
  assert.equal(client.ran.length, 0, "a child ran although its isolation could not be set up")
})

test("a schema retry of an isolated agent runs in the same worktree", async () => {
  const { dir: repo, cleanup } = tempRepo()
  const client = editingClient({}, (_t, n) => (n === 1 ? "not json" : '{"ok":true}'))
  const rt = createRuntime({ client, directory: repo, git, runId: "t2" })
  assert.deepEqual(await rt.agent("do it", { isolation: "worktree", schema: { type: "object", required: ["ok"] } }), { ok: true })
  assert.equal(client.ran.length, 2)
  assert.equal(client.ran[0].dir, client.ran[1].dir)
  assert.notEqual(path.resolve(client.ran[0].dir), path.resolve(repo))
  cleanup()
})

test("overlaps names only files more than one agent changed, sorted", () => {
  assert.deepEqual(overlaps([
    { label: "x", files: ["b", "a", "z"] },
    { label: "y", files: ["a", "c"] },
    { label: "w", files: ["z"] },
  ]), [{ file: "a", labels: ["x", "y"] }, { file: "z", labels: ["x", "w"] }])
  assert.deepEqual(overlaps([]), [])
})
