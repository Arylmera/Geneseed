// Geneseed — OpenCode workflow plugin.
//
// Registers ONE custom tool, `workflow`, that runs saved, code-driven orchestration
// scripts from the sibling `workflows/` dir (`.opencode/workflows/` in a per-repo
// emit, `<config>/workflows/` global). The model calls `workflow({ name, args })`;
// the named script — not the model — drives the control flow, spawning subagents via
// the runtime (`_runtime.js`). This is the deterministic counterpart to the
// model-driven `council` / `parallel-agents` skills. See
// adapters/opencode/workflows/_runtime.js and
// docs/specs/2026-06-09-opencode-workflow-primitive.md.
//
// Saved workflows ONLY — no model-authored/eval'd scripts (v1). Synchronous: the tool
// blocks until the workflow finishes; a phase-by-phase trace and the full result are
// written to `.geneseed/workflow-runs/<runId>.log`. Every failure is contained and
// reported, never thrown into the session.
//
// Quiet unless GENESEED_DEBUG=1 (which adds a load banner on stderr), except a
// warning that the tool may not register. GENESEED_WORKFLOWS_DIR overrides
// where saved workflows are loaded from.

import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const DEBUG = !!process.env.GENESEED_DEBUG
function dlog(m) { if (DEBUG) say(m, "debug") }
// OpenCode 1.x paints a plugin's stderr over its TUI input box (in red); its own log API
// writes to the log file instead. The V1 entry sets LOG_CLIENT; V2 and tests have no
// client and keep stderr, as does a refused log call, so no line is lost. Never throws:
// a log line must not break a tool call.
let LOG_CLIENT = null
function say(msg, level = "warn") {
  try {
    if (LOG_CLIENT?.app?.log) {
      Promise.resolve(LOG_CLIENT.app.log({ body: { service: "geneseed-workflow", level, message: msg } })).catch(() => console.error(`[geneseed-workflow] ${msg}`))
      return
    }
  } catch { /* fall through to stderr */ }
  console.error(`[geneseed-workflow] ${msg}`)
}

const __dir = path.dirname(fileURLToPath(import.meta.url))
const WORKFLOWS_DIR = process.env.GENESEED_WORKFLOWS_DIR
  ? path.resolve(process.env.GENESEED_WORKFLOWS_DIR)
  : path.resolve(__dir, "..", "workflows")

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i

async function listWorkflows() {
  try {
    const entries = await fs.readdir(WORKFLOWS_DIR)
    return entries
      .filter((f) => f.endsWith(".js") && !f.startsWith("_"))
      .map((f) => f.slice(0, -3))
      .sort()
  } catch { return [] }
}

async function loadWorkflow(name) {
  if (!NAME_RE.test(name)) throw new Error(`invalid workflow name: ${name}`)
  const file = path.join(WORKFLOWS_DIR, `${name}.js`)
  const rel = path.relative(WORKFLOWS_DIR, file)
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("workflow path escapes workflows dir")
  await fs.access(file)
  // Cache-bust: Node's ESM cache holds the first import for the process lifetime,
  // so an edited workflow script would otherwise run stale until OpenCode restarts.
  const mod = await import(pathToFileURL(file).href + "?t=" + Date.now())
  const run = mod.default || mod.run
  if (typeof run !== "function") throw new Error(`workflow "${name}" has no default/run export`)
  return { meta: mod.meta || { name }, run }
}

function nowStamp() {
  // Plugin-side only (NOT inside a workflow script) — a run id needs wall-clock; the
  // runtime itself stays clock-free for reproducibility.
  const d = new Date()
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// The runtime's git executor, for `isolation: "worktree"`. argv only, never a shell string:
// branch and directory names derive from agent labels a script author wrote.
function git(argv, cwd) {
  return new Promise((resolve, reject) => {
    execFile("git", argv, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${argv[0]}: ${String(stderr || err.message).trim()}`))
      else resolve(String(stdout))
    })
  })
}

function safeJson(v) {
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

function summarize(name, result, stats, tracePath) {
  const head = `workflow "${name}" complete — ${stats.agentCount} agent run(s)` +
    (stats.spent ? `, ~${stats.spent} output tokens` : "") +
    (stats.phases.length ? `, phases: ${stats.phases.join(" → ")}` : "")
  let body = safeJson(result)
  if (body.length > 2000) body = body.slice(0, 2000) + `\n… (truncated — full result in ${tracePath})`
  return `${head}\n\nResult:\n${body}${isolationReport(stats)}\n\nTrace: ${tracePath}`
}

// Kept worktrees are work awaiting review, and an overlap is a conflict awaiting ONE
// merger (One Writer Per File) — both are said out loud, never left for the trace to hold.
function isolationReport(stats) {
  const kept = stats.worktrees || []
  if (!kept.length) return ""
  const lines = ["", "", `Worktrees kept (${kept.length}) — review and merge them yourself; nothing was merged:`]
  for (const w of kept) lines.push(`- ${w.label}: ${w.branch} at ${w.dir} — ${w.files.length} file(s)`)
  const over = stats.overlaps || []
  if (over.length) {
    lines.push(`CONFLICTS — ${over.length} file(s) changed by more than one agent; merge these by hand or through one merge agent:`)
    for (const o of over) lines.push(`- ${o.file}: ${o.labels.join(", ")}`)
  }
  return lines.join("\n")
}

async function writeTrace(rootDir, runId, lines) {
  if (!rootDir) return "(no trace file — unknown working dir)"
  try {
    const dir = path.join(rootDir, ".geneseed", "workflow-runs")
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, `${runId}.log`)
    await fs.writeFile(file, lines.join("\n") + "\n", "utf8")
    return file
  } catch (e) { dlog(`trace write failed: ${e?.message || e}`); return "(trace write failed)" }
}

// The `workflow` tool's body, shared by the V1 and V2 registrations: `client` is the V1
// SDK client, or on V2 the facade `v2Client` builds over the plugin context.
function makeExecute({ client, directory, worktree }) {
  const rootDir = worktree || directory
  // Normalize the `args` parameter. OpenCode's tool layer can deliver a structured
  // object param as a JSON STRING (or drop it) when the schema is untyped — so coerce
  // a string back to an object and reject non-object shapes to `{}`. Without this, the
  // workflow script's `args` arrives empty and every `args.foo` read is undefined.
  const normalizeArgs = (raw) => {
    let a = raw ?? {}
    if (typeof a === "string") {
      try { a = JSON.parse(a) } catch { a = {} }
    }
    if (a == null || typeof a !== "object" || Array.isArray(a)) a = {}
    return a
  }

  const execute = async (argv) => {
    const name = (argv?.name || "").trim()
    const available = await listWorkflows()
    if (!name) {
      return `Available workflows: ${available.join(", ") || "(none found in " + WORKFLOWS_DIR + ")"}.\n` +
        `Run one with workflow({ name, args }).`
    }
    if (!available.includes(name)) {
      return `Unknown workflow "${name}". Available: ${available.join(", ") || "(none)"}.`
    }

    let wf
    try { wf = await loadWorkflow(name) }
    catch (e) { return `Failed to load workflow "${name}": ${e?.message || e}` }

    const runId = `${name}-${nowStamp()}`
    const lines = []
    const sink = (line) => lines.push(line)
    sink(`# workflow ${name} — ${wf.meta?.description || ""}`)

    // Lazily import the runtime so a broken runtime never blocks tool registration.
    let createRuntime
    try { ({ createRuntime } = await import(pathToFileURL(path.join(WORKFLOWS_DIR, "_runtime.js")).href + "?t=" + Date.now())) }
    catch (e) { return `Workflow runtime unavailable: ${e?.message || e}` }

    const rt = createRuntime({ client, directory, worktree, git, runId, args: normalizeArgs(argv?.args), log: sink })
    let result, failed = null
    try { result = await wf.run(rt) }
    catch (e) { failed = e; sink(`✗ workflow error: ${e?.stack || e?.message || e}`) }

    const stats = rt._stats()
    sink(`\n# done — ${stats.agentCount} agent run(s), ~${stats.spent} output tokens`)
    if (!failed) sink(`# result:\n${safeJson(result)}`)
    const tracePath = await writeTrace(rootDir, runId, lines)

    if (failed) return `Workflow "${name}" failed: ${failed?.message || failed}${isolationReport(stats)}\nTrace: ${tracePath}`
    return summarize(name, result, stats, tracePath)
  }

  return execute
}

// The `workflow` tool as the model sees it, on both majors.
const TOOL_DESCRIPTION =
  "Run a saved, code-driven Geneseed workflow that orchestrates subagents " +
  "deterministically (parallel fan-out, find→verify pipeline, phased handoff). " +
  "Call with no name to list available workflows."
const NAME_DESCRIPTION = "saved workflow name; omit to list available"
const ARGS_DESCRIPTION = "inputs passed to the workflow script as `args` (object, or a JSON object string)"

// One-line load banner, GENESEED_DEBUG=1 only: OpenCode 1.19 paints it in red over the input
// box like any other stderr line (it does not run before the TUI draws). tests/host_canary.mjs
// sets the flag and reads it as V1's proof of load, so it stays on stderr, not `say`:
// `opencode debug config` never prints a `client.app.log` line. A warning always goes out,
// through `say`, so a tool that may not register is never silent.
async function loadBanner(warn = "") {
  if (warn) say(`tool 'workflow'${warn}`)
  if (!DEBUG) return
  try {
    const names = await listWorkflows()
    console.error(`[geneseed-workflow] loaded — tool 'workflow' registered, ${names.length} workflow(s) [${names.join(", ") || "none"}] from ${WORKFLOWS_DIR}${warn}`)
  } catch (e) { console.error(`[geneseed-workflow] loaded but could not list workflows: ${e?.message || e}`) }
}

export const GeneseedWorkflow = async (ctx) => {
  const { client, directory, worktree } = ctx
  if (client) LOG_CLIENT = client
  let toolHelper
  try { ({ tool: toolHelper } = await import("@opencode-ai/plugin")) }
  catch { dlog("@opencode-ai/plugin tool helper unavailable — registering a raw tool def") }

  // Warn when this OpenCode build lacks the custom-tool helper (the silent "tool never
  // appears" failure).
  await loadBanner(toolHelper ? ""
    : " — WARN: @opencode-ai/plugin 'tool' helper missing; the workflow tool may NOT register on this OpenCode version")

  const execute = makeExecute({ client, directory, worktree })

  const def = {
    description: TOOL_DESCRIPTION,
    args: toolHelper
      ? {
          name: toolHelper.schema.string().optional().describe(NAME_DESCRIPTION),
          // Keep this `any()` — it's the only param shape known to register cleanly on
          // this OpenCode build (record()/object schemas wedged tool registration → every
          // session message stuck "queued"). The provider may still deliver the object as
          // a JSON string or empty; normalizeArgs() in execute() recovers both cases.
          args: toolHelper.schema.any().optional().describe(ARGS_DESCRIPTION),
        }
      : {
          name: { type: "string", description: NAME_DESCRIPTION },
          args: { type: "object", description: "inputs passed to the workflow script as `args`" },
        },
    async execute(argv) { return execute(argv) },
  }

  return { tool: { workflow: toolHelper ? toolHelper(def) : def } }
}

// ---- OpenCode 2 ----------------------------------------------------------------
// `export default { id, server, setup }` serves V1 (>= 1.3.4) and V2 from one file — why, and
// each V1 hook's V2 counterpart: adapters/opencode/HOW-OPENCODE-LOADS.md.
//
// V2 registers tools through `tool.transform` with a plain JSON-schema `input` (no
// `@opencode-ai/plugin` helper — that package is `@opencode/plugin` there, and not
// needed). The runtime (`_runtime.js`) and every saved workflow speak the V1 SDK client,
// so `v2Client` presents that client's few calls over the V2 session domain instead of
// forking the runtime:
//   create  → session.create (a worktree directory becomes the session's location)
//   prompt  → switchAgent/switchModel when asked, then session.prompt — which only
//             admits the input on V2 — then session.wait for the loop to go idle, and the
//             last assistant message read back from session.context
//   messages → session.context, reshaped to V1's `{ info, parts }`
//   delete  → session.remove
function v2Message(m) {
  if (m?.type === "assistant") {
    return {
      info: { role: "assistant", tokens: m.tokens },
      parts: (m.content || []).filter((p) => p?.type === "text").map((p) => ({ type: "text", text: p.text })),
    }
  }
  return { info: { role: m?.type }, parts: typeof m?.text === "string" ? [{ type: "text", text: m.text }] : [] }
}
function v2ModelRef(model) {
  if (typeof model === "string" && model.includes("/")) {
    const [providerID, ...rest] = model.split("/")
    return { providerID, id: rest.join("/") }
  }
  const id = model?.id ?? model?.modelID
  return model?.providerID && id ? { providerID: model.providerID, id } : null
}
function v2Client(ctx) {
  const context = async (sid) => (await ctx.session.context({ sessionID: sid })) || []
  return {
    session: {
      create: async ({ body, query } = {}) => ctx.session.create({
        ...(body?.title ? { title: body.title } : {}),
        ...(query?.directory ? { location: { directory: query.directory } } : {}),
      }),
      prompt: async ({ path: p, body } = {}) => {
        const sessionID = p?.id
        if (body?.agent) await ctx.session.switchAgent({ sessionID, agent: body.agent })
        const model = v2ModelRef(body?.model)
        if (model) await ctx.session.switchModel({ sessionID, model })
        const text = (body?.parts || []).filter((x) => x?.type === "text").map((x) => x.text).join("\n")
        await ctx.session.prompt({ sessionID, text })
        await ctx.session.wait({ sessionID })
        const last = (await context(sessionID)).filter((m) => m?.type === "assistant").pop()
        return last ? v2Message(last) : null
      },
      messages: async ({ path: p } = {}) => (await context(p?.id)).map(v2Message),
      delete: async ({ path: p } = {}) => ctx.session.remove({ sessionID: p?.id }),
    },
  }
}

async function setupV2(ctx) {
  const directory = ctx?.location?.directory
  const worktree = ctx?.location?.project?.directory
  const execute = makeExecute({ client: v2Client(ctx), directory, worktree })
  await loadBanner()
  await ctx.tool.transform((editor) => {
    editor.add({
      name: "workflow",
      description: TOOL_DESCRIPTION,
      input: {
        type: "object",
        properties: {
          name: { type: "string", description: NAME_DESCRIPTION },
          args: { description: ARGS_DESCRIPTION },
        },
      },
      // A rejected promise here is a defect that fails the whole agent step, not the call:
      // every failure comes back as text, as the V1 tool's do.
      execute: async (input) => {
        try { return { content: await execute(input) } }
        catch (e) { return { content: `Workflow failed: ${e?.message || e}` } }
      },
    })
  })
}

export default { id: "geneseed-workflow", server: GeneseedWorkflow, setup: setupV2 }
