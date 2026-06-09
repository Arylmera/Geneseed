// review — sweep a change across dimensions, then adversarially verify each finding.
// The canonical find→verify pipeline: each dimension's findings verify as soon as that
// dimension's review returns (no barrier between review and verify).
//
// args: { target?: string }  — what to review (default: the working-tree diff).

export const meta = {
  name: "review",
  description: "Review a change across correctness/security/quality, then adversarially verify each finding.",
  phases: [{ title: "Review" }, { title: "Verify" }],
}

const DIMENSIONS = [
  { key: "correctness", prompt: "logic errors, broken contracts, unhandled edge cases" },
  { key: "security", prompt: "injection, auth gaps, unsafe input handling, leaked secrets" },
  { key: "quality", prompt: "dead code, duplication, unclear naming, a simpler equivalent" },
]

const FINDINGS_SCHEMA = (v) => (Array.isArray(v?.findings) ? true : 'expected { "findings": [...] }')
const VERDICT_SCHEMA = (v) => (typeof v?.real === "boolean" ? true : 'expected { "real": boolean }')

export default async function run(rt) {
  const { agent, parallel, pipeline, phase, log, args } = rt
  const target = args?.target || "the current working-tree changes (git diff)"
  phase("Review")

  const results = await pipeline(
    DIMENSIONS,
    // Stage 1 — review one dimension, return structured findings.
    (d) => agent(
      `Review ${target} for ${d.key} issues: ${d.prompt}.\n` +
      `Return JSON: { "findings": [ { "title": "", "file": "", "line": 0, "detail": "" } ] }. ` +
      `Empty array if there are none.`,
      { label: `review:${d.key}`, phase: "Review", schema: FINDINGS_SCHEMA },
    ),
    // Stage 2 — verify this dimension's findings in parallel (no barrier on other dims).
    (review, d) => {
      phase("Verify")
      const findings = review?.findings || []
      if (!findings.length) { log(`${d.key}: no findings`); return [] }
      return parallel(findings.map((f) => () =>
        agent(
          `Adversarially verify this ${d.key} finding. Try to REFUTE it; default to ` +
          `real=false if uncertain.\nFinding: ${JSON.stringify(f)}\n` +
          `Return JSON: { "real": true|false, "why": "" }.`,
          { label: `verify:${f.file || d.key}`, phase: "Verify", schema: VERDICT_SCHEMA },
        ).then((v) => ({ ...f, dimension: d.key, verdict: v }))))
    },
  )

  const confirmed = results.flat().filter(Boolean).filter((f) => f.verdict?.real)
  log(`confirmed ${confirmed.length} finding(s) across ${DIMENSIONS.length} dimension(s)`)
  return { target, dimensions: DIMENSIONS.map((d) => d.key), confirmed }
}
