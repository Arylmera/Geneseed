// dispatch — live orchestrator: decompose a multi-domain goal, route each
// subtask to its owning capability agent, converge the results.
//
// The model-driven fallback is the parallel-agents skill; this runs the same
// shape on rails: the script, not the model, enforces routing and the handoff
// envelope (context in, output contract back, no commits — Law XX stays with
// the caller).
//
// args: { goal: string, context?: string, agents?: string[] }
//   goal    — the multi-part objective (required).
//   context — optional shared background prepended to every dispatch.
//   agents  — optional whitelist restricting which capabilities may be used.

export const meta = {
  name: "dispatch",
  description: "Decompose a goal, route subtasks to owning capability agents, converge.",
  phases: [{ title: "Decompose" }, { title: "Dispatch" }, { title: "Converge" }],
}

// [name, ownership] — name doubles as the OpenCode subagent name (Geneseed emits these).
const CAPABILITIES = [
  ["explorer", "sweep many files for an answer; read-only reconnaissance"],
  ["architect", "design or plan before code is written"],
  ["reviewer", "correctness + quality pass on a ready change"],
  ["tester", "write or run tests, diagnose a failure"],
  ["security", "auth, input handling, secrets, dependencies"],
  ["docs", "user-facing docs after code has landed"],
]

const PLAN_SCHEMA = {
  type: "object",
  required: ["subtasks"],
  properties: { subtasks: { type: "array" } },
}

export default async function run(rt) {
  const { agent, parallel, phase, log, args } = rt
  const goal = args?.goal
  if (!goal) return { error: "pass args.goal (the multi-part objective)" }

  const allowed = new Set(
    Array.isArray(args?.agents) && args.agents.length ? args.agents : CAPABILITIES.map(([n]) => n),
  )
  const roster = CAPABILITIES.filter(([n]) => allowed.has(n))
  if (!roster.length) return { error: `no capability matched — valid: ${CAPABILITIES.map(([n]) => n).join(", ")}` }

  phase("Decompose")
  const rosterText = roster.map(([n, o]) => `- ${n}: ${o}`).join("\n")
  const plan = await agent(
    `Decompose this goal into 1-6 independent subtasks and route each to the ` +
    `single owning capability below.\n\nGoal: ${goal}\n\nCapabilities:\n${rosterText}\n\n` +
    `Reply as JSON: {"subtasks":[{"agent":"<name>","goal":"<what to achieve>",` +
    `"inputs":"<files/scope/acceptance criteria the agent needs>"}]}. ` +
    `Only subtasks with no ordering between them; fold dependent steps into one subtask.`,
    { label: "decompose", phase: "Decompose", schema: PLAN_SCHEMA },
  )
  const subtasks = (plan?.subtasks || []).filter(
    (t) => t && allowed.has(t.agent) && typeof t.goal === "string" && t.goal.trim(),
  )
  if (!subtasks.length) return { error: "decomposition produced no routable subtasks", plan }
  log(`routing ${subtasks.length} subtask(s): ${subtasks.map((t) => t.agent).join(", ")}`)

  phase("Dispatch")
  const results = (await parallel(subtasks.map((t, i) => () =>
    agent(
      (args?.context ? `Shared context:\n${args.context}\n\n` : "") +
      `Subtask: ${t.goal}\nInputs: ${t.inputs || "none given"}\n\n` +
      `Handoff envelope: fulfil ONLY this subtask. Read your per-agent memory ` +
      `file first if it exists. Return your output contract as stated in your ` +
      `spec; if you cannot fulfil it, say what is missing — never invent. ` +
      `Do not commit, push, or widen scope; those stay with the caller.`,
      { label: `dispatch:${t.agent}`, phase: "Dispatch", agent: t.agent },
    ).then((text) => ({ ...t, index: i, result: text }))))).filter((r) => r && r.result)

  phase("Converge")
  const dossier = results
    .map((r) => `### ${r.agent} — ${r.goal}\n${r.result}`)
    .join("\n\n")
  const synthesis = await agent(
    `Goal: ${goal}\n\nSubtask results:\n\n${dossier}\n\n` +
    `Reconcile: state what was achieved, name conflicts between results and how ` +
    `to resolve them, list what remains undone, and give the caller one next ` +
    `action. Report faithfully — unfulfilled contracts are findings, not gaps to paper over.`,
    { label: "converge", phase: "Converge" },
  )

  log(`dispatched "${goal}" across ${results.length} agent(s)`)
  return { goal, subtasks, results, synthesis }
}
