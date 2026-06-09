// council — the `council` skill as deterministic code.
//
// Seats the standing stance agents, gathers their steelmanned positions in parallel
// (each in its own isolated context, no groupthink), then a neutral chair synthesises
// a verdict and preserves the strongest dissent. The model-driven `council` skill asks
// the agent to convene seats in prose; this runs the same shape on rails.
//
// args: { motion?: string, question?: string, seats?: string[] }
//   motion  — the decision/change/claim under debate (required).
//   seats   — optional subset of seat roles to convene (default: the core six).

export const meta = {
  name: "council",
  description: "Council debate as code: stance agents argue in parallel, a chair returns a verdict + preserved dissent.",
  phases: [{ title: "Positions" }, { title: "Synthesis" }],
}

// [role, charter] — role doubles as the OpenCode subagent name (Geneseed emits these).
const SEATS = [
  ["advocate", "the strongest case FOR the motion — the prize, the cost of inaction"],
  ["skeptic", "devil's advocate — failure modes, hidden assumptions, why NOT"],
  ["pragmatist", "cost, effort, and complexity weighed against the payoff (YAGNI)"],
  ["steward", "long-term architecture, technical debt, and maintainability"],
  ["operator", "running it in production — reliability, on-call, operational cost"],
  ["empiricist", "every claim held to evidence; what would prove or disprove it"],
]

export default async function run(rt) {
  const { agent, parallel, phase, log, args } = rt
  const motion = args?.motion || args?.question
  if (!motion) return { error: "pass args.motion (the decision, change, or claim to debate)" }

  const wanted = Array.isArray(args?.seats) && args.seats.length ? args.seats : null
  const seats = wanted ? SEATS.filter(([role]) => wanted.includes(role)) : SEATS
  if (!seats.length) {
    return { error: `no seats matched ${JSON.stringify(wanted)} — valid: ${SEATS.map(([r]) => r).join(", ")}` }
  }
  if (wanted && seats.length < wanted.length) {
    log(`ignored unknown seat name(s): ${wanted.filter((w) => !SEATS.some(([r]) => r === w)).join(", ")}`)
  }

  phase("Positions")
  const briefs = (await parallel(seats.map(([role, charter]) => () =>
    agent(
      `You are the ${role} on a decision council. Motion: "${motion}".\n` +
      `Argue ONLY this stance: ${charter}. Give a tight, steelmanned brief — ` +
      `no hedging, no strawmen.`,
      { label: `seat:${role}`, phase: "Positions", agent: role },
    ).then((text) => ({ role, text }))))).filter((b) => b && b.text)

  phase("Synthesis")
  const dossier = briefs.map((b) => `### ${b.role}\n${b.text}`).join("\n\n")
  const verdict = await agent(
    `You are the neutral chair of a decision council. Motion: "${motion}".\n\n` +
    `The seat briefs:\n\n${dossier}\n\n` +
    `Synthesise in a neutral voice: state the verdict and its reasoning, record the ` +
    `single strongest surviving dissent verbatim, list what would change the verdict, ` +
    `and name one next action. The council advises — do not write code or push anything.`,
    { label: "chair", phase: "Synthesis" },
  )

  log(`debated "${motion}" across ${briefs.length} seat(s)`)
  return { motion, seats: seats.map(([r]) => r), verdict, briefs }
}
