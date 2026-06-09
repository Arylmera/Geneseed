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
// Quiet by default; GENESEED_DEBUG=1 logs to stderr. GENESEED_WORKFLOWS_DIR overrides
// where saved workflows are loaded from.

import { promises as fs } from "node:fs"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const DEBUG = !!process.env.GENESEED_DEBUG
function dlog(m) { if (DEBUG) console.error(`[geneseed-workflow] ${m}`) }

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
  const mod = await import(pathToFileURL(file).href)
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

function safeJson(v) {
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

function summarize(name, result, stats, tracePath) {
  const head = `workflow "${name}" complete — ${stats.agentCount} agent run(s)` +
    (stats.spent ? `, ~${stats.spent} output tokens` : "") +
    (stats.phases.length ? `, phases: ${stats.phases.join(" → ")}` : "")
  let body = safeJson(result)
  if (body.length > 2000) body = body.slice(0, 2000) + `\n… (truncated — full result in ${tracePath})`
  return `${head}\n\nResult:\n${body}\n\nTrace: ${tracePath}`
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

export const GeneseedWorkflow = async (ctx) => {
  const { client, directory, worktree } = ctx
  const rootDir = worktree || directory
  let toolHelper
  try { ({ tool: toolHelper } = await import("@opencode-ai/plugin")) }
  catch { dlog("@opencode-ai/plugin tool helper unavailable — registering a raw tool def") }

  // One-line load banner (always on) so a restart visibly confirms the plugin loaded
  // and the `workflow` tool is registered — and WARNS if this OpenCode build lacks the
  // custom-tool helper (the silent "tool never appears" failure).
  try {
    const names = await listWorkflows()
    const warn = toolHelper ? ""
      : " — WARN: @opencode-ai/plugin 'tool' helper missing; the workflow tool may NOT register on this OpenCode version"
    console.error(`[geneseed-workflow] loaded — tool 'workflow' registered, ${names.length} workflow(s) [${names.join(", ") || "none"}] from ${WORKFLOWS_DIR}${warn}`)
  } catch (e) { console.error(`[geneseed-workflow] loaded but could not list workflows: ${e?.message || e}`) }

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
    try { ({ createRuntime } = await import(pathToFileURL(path.join(WORKFLOWS_DIR, "_runtime.js")).href)) }
    catch (e) { return `Workflow runtime unavailable: ${e?.message || e}` }

    const rt = createRuntime({ client, directory, worktree, args: argv?.args ?? {}, log: sink })
    let result, failed = null
    try { result = await wf.run(rt) }
    catch (e) { failed = e; sink(`✗ workflow error: ${e?.stack || e?.message || e}`) }

    const stats = rt._stats()
    sink(`\n# done — ${stats.agentCount} agent run(s), ~${stats.spent} output tokens`)
    if (!failed) sink(`# result:\n${safeJson(result)}`)
    const tracePath = await writeTrace(rootDir, runId, lines)

    if (failed) return `Workflow "${name}" failed: ${failed?.message || failed}\nTrace: ${tracePath}`
    return summarize(name, result, stats, tracePath)
  }

  const def = {
    description:
      "Run a saved, code-driven Geneseed workflow that orchestrates subagents " +
      "deterministically (parallel fan-out, find→verify pipeline, phased handoff). " +
      "Call with no name to list available workflows.",
    args: toolHelper
      ? {
          name: toolHelper.schema.string().optional().describe("saved workflow name; omit to list available"),
          args: toolHelper.schema.any().optional().describe("inputs passed to the workflow script as `args`"),
        }
      : {
          name: { type: "string", description: "saved workflow name; omit to list available" },
          args: { type: "object", description: "inputs passed to the workflow script as `args`" },
        },
    async execute(argv) { return execute(argv) },
  }

  return { tool: { workflow: toolHelper ? toolHelper(def) : def } }
}

export default GeneseedWorkflow
