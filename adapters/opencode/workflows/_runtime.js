// Geneseed — deterministic workflow runtime (OpenCode).
//
// The API handed to every saved workflow script: agent(), parallel(), pipeline(),
// phase(), log(), budget, args. It is code-driven orchestration — the script, not
// the model, decides the control flow. Child work runs as real OpenCode sessions
// spawned through the plugin's SDK `client`; orchestration logic here is pure and
// unit-testable against a mock client (see tests/workflow_runtime.test.mjs).
//
// SDK binding note: OpenCode's session API shape shifts between versions, so the
// child-session helpers below are defensive (envelope/`data` unwrap, multiple parts
// shapes, graceful degradation). The orchestration primitives do not depend on it.
//
// Determinism: this runtime uses no Date.now()/Math.random(), so a run is a pure
// function of (workflow, args, child replies). Saved scripts SHOULD likewise avoid
// wall-clock/random for reproducibility (pass timestamps via args). This is an
// authoring convention — imported modules cannot have their globals shadowed — not a
// hard sandbox guard. See docs/specs/2026-06-09-opencode-workflow-primitive.md.

import * as os from "node:os"

const DEBUG = !!process.env.GENESEED_DEBUG
function dlog(m) { if (DEBUG) console.error(`[geneseed-workflow] ${m}`) }

export const MAX_AGENTS = 1000
export const MAX_ITEMS = 4096

export function concurrencyCap() {
  let cpu = 4
  try { cpu = (os.cpus() || []).length || 4 } catch {}
  return Math.max(1, Math.min(16, cpu - 2))
}

// A tiny promise-pool limiter: at most `max` in flight; the rest queue.
export function createLimiter(max) {
  let active = 0
  const queue = []
  const pump = () => {
    if (active >= max || queue.length === 0) return
    active++
    const { fn, resolve, reject } = queue.shift()
    Promise.resolve().then(fn).then(
      (v) => { active--; resolve(v); pump() },
      (e) => { active--; reject(e); pump() },
    )
  }
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump() })
}

// ---- structured-output validation -------------------------------------------
// Accepts a Zod schema (.safeParse), a predicate fn (value) => true | "error", or a
// tiny JSON-schema-like descriptor ({ type, required, properties }).
export function validateSchema(schema, value) {
  if (!schema) return { ok: true, value }
  if (typeof schema === "function") {
    const r = schema(value)
    if (r === true) return { ok: true, value }
    return { ok: false, error: typeof r === "string" ? r : "predicate rejected value" }
  }
  if (typeof schema.safeParse === "function") {
    const r = schema.safeParse(value)
    return r.success
      ? { ok: true, value: r.data }
      : { ok: false, error: r.error?.message || "schema mismatch" }
  }
  const t = schema.type
  if (t === "array") return Array.isArray(value) ? { ok: true, value } : { ok: false, error: "expected array" }
  if (t === "object" || schema.properties || schema.required) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "expected object" }
    for (const k of (schema.required || [])) if (!(k in value)) return { ok: false, error: `missing key: ${k}` }
    return { ok: true, value }
  }
  if (t && typeof value !== t) return { ok: false, error: `expected ${t}` }
  return { ok: true, value }
}

// First balanced {...} or [...] span in a string (string-literal aware).
function sliceBalanced(text) {
  const start = (() => {
    const a = text.indexOf("{"), b = text.indexOf("[")
    if (a < 0) return b
    if (b < 0) return a
    return Math.min(a, b)
  })()
  if (start < 0) return null
  const open = text[start], close = open === "{" ? "}" : "]"
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === "\\") esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close) { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  return null
}

export function extractJson(text) {
  if (typeof text !== "string") return undefined
  const candidates = []
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) candidates.push(fence[1].trim())
  candidates.push(text.trim())
  const braced = sliceBalanced(text)
  if (braced) candidates.push(braced)
  for (const c of candidates) {
    try { return JSON.parse(c) } catch { /* try next */ }
  }
  return undefined
}

// ---- defensive SDK helpers --------------------------------------------------
function unwrap(res) {
  if (res && typeof res === "object" && "data" in res && res.data &&
      res.id === undefined && res.parts === undefined) return res.data
  return res
}
function sessionId(created) {
  const c = unwrap(created)
  return c?.id ?? c?.sessionID ?? c?.session?.id
}
function partsText(parts) {
  if (!Array.isArray(parts)) return ""
  return parts
    .filter((p) => p && (p.type === "text" || typeof p.text === "string"))
    .map((p) => p.text || "")
    .join("\n")
    .trim()
}
async function lastAssistantText(client, sid) {
  try {
    const res = await client.session.messages({ path: { id: sid } })
    const u = unwrap(res)
    const list = Array.isArray(res) ? res : (Array.isArray(u) ? u : (u?.data ?? []))
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      const role = m?.info?.role ?? m?.role
      if (role && role !== "assistant") continue
      const t = partsText(m?.parts ?? m?.info?.parts ?? [])
      if (t) return t
    }
  } catch (e) { dlog(`messages read failed: ${e?.message || e}`) }
  return ""
}
function usageFrom(res) {
  const r = unwrap(res)
  const tok = r?.tokens ?? r?.info?.tokens ?? r?.assistant?.tokens
  return { input: Number(tok?.input ?? 0) || 0, output: Number(tok?.output ?? 0) || 0 }
}

async function runChildSession(client, { prompt, agent, model, title }) {
  if (!client?.session?.create || !client?.session?.prompt) {
    throw new Error("OpenCode SDK session API unavailable")
  }
  let created
  try { created = await client.session.create({ body: { title: title || "geneseed-workflow" } }) }
  catch { created = await client.session.create() }
  const sid = sessionId(created)
  if (!sid) throw new Error("could not create child session")
  try {
    const body = { parts: [{ type: "text", text: prompt }] }
    if (agent) body.agent = agent
    if (model) body.model = model
    let res = null
    try { res = await client.session.prompt({ path: { id: sid }, body }) }
    catch (e) { dlog(`prompt failed: ${e?.message || e}`) }
    const r = unwrap(res)
    let text = partsText(r?.parts ?? r?.info?.parts ?? [])
    if (!text) text = await lastAssistantText(client, sid)
    return { text, usage: usageFrom(res) }
  } finally {
    try { await client.session.delete?.({ path: { id: sid } }) } catch { /* best effort */ }
  }
}

// ---- the runtime ------------------------------------------------------------
export function createRuntime(ctx) {
  const { client, directory, worktree, log: sink } = ctx
  const args = ctx.args || {}
  const cap = ctx.concurrency || concurrencyCap()
  const limit = createLimiter(cap)
  let agentCount = 0
  let spent = 0
  const budgetTotal =
    (args && typeof args.budget === "number") ? args.budget
    : (typeof ctx.budget === "number" ? ctx.budget : null)
  const phases = []
  const trace = []
  const emit = (line) => { trace.push(line); if (typeof sink === "function") sink(line) }

  const budget = {
    get total() { return budgetTotal },
    spent: () => spent,
    remaining: () => (budgetTotal == null ? Infinity : Math.max(0, budgetTotal - spent)),
  }

  async function spawn(prompt, opts) {
    return limit(() => runChildSession(client, {
      prompt, agent: opts.agent, model: opts.model, title: `geneseed-wf:${opts.label}`,
    }))
  }

  async function agent(prompt, opts = {}) {
    if (agentCount >= MAX_AGENTS) throw new Error(`workflow agent cap (${MAX_AGENTS}) exceeded`)
    if (budgetTotal != null && spent >= budgetTotal) {
      throw new Error(`workflow token budget (${budgetTotal}) exhausted`)
    }
    agentCount++
    const label = opts.label || String(prompt).slice(0, 40)
    emit(`· agent: ${label}`)
    let out
    try { out = await spawn(prompt, { ...opts, label }) }
    catch (e) { emit(`✗ agent failed: ${label} — ${e?.message || e}`); return null }
    spent += out.usage?.output || 0
    if (!opts.schema) return out.text

    let lastErr = "no JSON found in reply"
    for (let attempt = 0; attempt <= 2; attempt++) {
      const parsed = extractJson(out.text)
      if (parsed !== undefined) {
        const v = validateSchema(opts.schema, parsed)
        if (v.ok) return v.value
        lastErr = v.error
      }
      if (attempt === 2) break
      emit(`↻ retry ${label} (schema): ${lastErr}`)
      try {
        out = await spawn(
          `${prompt}\n\nYour previous reply did not satisfy the required schema (${lastErr}). ` +
          `Reply with ONLY a single valid JSON value — no prose, no code fence.`,
          { ...opts, label: `${label}:retry${attempt + 1}` },
        )
        spent += out.usage?.output || 0
      } catch (e) { lastErr = String(e?.message || e); break }
    }
    emit(`✗ schema unmet: ${label} — ${lastErr}`)
    return null
  }

  function phase(title) { phases.push(title); emit(`\n=== phase: ${title} ===`) }
  function log(msg) { emit(`  ${msg}`) }

  // BARRIER fan-out: awaits all thunks. A throwing thunk resolves to null.
  async function parallel(thunks) {
    if (!Array.isArray(thunks)) throw new Error("parallel() needs an array of thunks")
    if (thunks.length > MAX_ITEMS) throw new Error(`parallel() item cap (${MAX_ITEMS}) exceeded`)
    return Promise.all(thunks.map((fn) =>
      Promise.resolve().then(fn).catch((e) => { emit(`✗ parallel unit: ${e?.message || e}`); return null })))
  }

  // NO-BARRIER staged flow: each item runs all stages independently. A throwing
  // stage drops that item to null and skips its remaining stages.
  async function pipeline(items, ...stages) {
    if (!Array.isArray(items)) throw new Error("pipeline() needs an array of items")
    if (items.length > MAX_ITEMS) throw new Error(`pipeline() item cap (${MAX_ITEMS}) exceeded`)
    return Promise.all(items.map(async (item, i) => {
      let acc = item
      for (let s = 0; s < stages.length; s++) {
        try { acc = await stages[s](acc, item, i) }
        catch (e) { emit(`✗ pipeline item ${i} stage ${s}: ${e?.message || e}`); return null }
      }
      return acc
    }))
  }

  return {
    agent, parallel, pipeline, phase, log, budget, args, directory, worktree,
    _stats: () => ({ agentCount, spent, cap, phases: [...phases], trace: [...trace] }),
  }
}

export default createRuntime
