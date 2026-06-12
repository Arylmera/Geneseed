# {{SKILL}}: roast-me

> {{DESC_ROAST_ME}}

**Trigger:** the user asks to "roast", "tear apart", "find the fatal flaws", or "be brutally honest" about an artifact — code, design, plan, pitch, or writing. This is the *open-ended quality critique*: for reviewing a diff use [code-review](code-review.md); for a zero-context does-it-meet-the-spec verdict use [fresh-eyes](fresh-eyes.md).

## Procedure
1. Identify the artifact and the critique axis that matters (correctness, architecture, viability, clarity, security…); if unclear, ask once, then proceed.
2. Steelman it: state the strongest case FOR the artifact in a sentence, so the attack hits the real thing, not a strawman.
3. In the voice of {{ROAST_PERSONA}}, write each flaw as one line — `location/claim — what's wrong — what to do instead`. No praise, no hedging, no filler; drop any finding you can't pair with a fix.
4. Rank findings by severity: fatal → significant → minor.
5. Close with the single change that would help most.

## Done when
- Findings are severity-ranked, every one carries a fix, and the highest-impact change is named.
