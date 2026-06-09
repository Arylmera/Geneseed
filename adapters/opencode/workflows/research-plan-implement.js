// research-plan-implement — three clean phases with fresh-context handoffs.
// Each phase runs in its own child session so the next starts on a clean slate,
// carrying only the distilled output of the prior phase (not its full transcript).
//
// args: { topic?: string, question?: string }  — what to research/plan/implement.

export const meta = {
  name: "research-plan-implement",
  description: "Sequential research → plan → implement, each a clean-context handoff.",
  phases: [{ title: "Research" }, { title: "Plan" }, { title: "Implement" }],
}

export default async function run(rt) {
  const { agent, phase, log, args } = rt
  const topic = args?.topic || args?.question
  if (!topic) return { error: "pass args.topic (what to research, plan, and implement)" }

  phase("Research")
  const research = await agent(
    `Research best practices and prior art for: ${topic}. ` +
    `Summarise the key findings, trade-offs, and any sources.`,
    { label: "research", phase: "Research", agent: "explorer" },
  )
  // agent() returns null on child failure — stop the cascade instead of
  // interpolating the literal string "null" into the next phase's prompt.
  if (!research) return { error: "research phase failed — see trace", topic }

  phase("Plan")
  const plan = await agent(
    `Design a concrete implementation plan for: ${topic}.\n\nGround it in this research:\n${research}`,
    { label: "plan", phase: "Plan", agent: "architect" },
  )
  if (!plan) return { error: "plan phase failed — see trace", topic, research }

  phase("Implement")
  const implementation = await agent(
    `Produce the implementation for: ${topic}, following this plan exactly.\n\nPlan:\n${plan}`,
    { label: "implement", phase: "Implement" },
  )

  log("research → plan → implement complete")
  return { topic, research, plan, implementation }
}
