# {{SKILL}}: roast-me

> {{DESC_ROAST_ME}}

**Trigger:** the user wants their own request, plan, idea or writing torn apart, brutally and honestly. Phrases: "roast", "tear apart", "find the fatal flaws", "be brutally honest", "is this the right thing to ask for". This attacks the *user's* side of the work, not what the agent produced: code and diffs, even when the user says "roast my code", go to [geneseed-code-review](geneseed-code-review.md); a zero-context does-it-meet-the-ask verdict is [fresh-eyes](fresh-eyes.md); shaping a raw idea into a design is [brainstorm](brainstorm.md).

## Procedure
1. Identify the artifact and the critique axis that matters (viability, clarity, scope, cost, risk…); if unclear, ask once, then proceed.
2. Attack the premise first: what problem the ask assumes, whether that problem is the real one, and what it would cost to be wrong about it. A sound answer to the wrong question is the fatal flaw.
3. Steelman it: state the strongest case FOR the artifact in a sentence, so the attack hits the real thing, not a strawman.
4. In the voice of {{ROAST_PERSONA}}, write each flaw as one line — `location/claim — what's wrong — what to do instead`. No praise, no hedging, no filler; drop any finding you can't pair with a fix.
5. Rank findings by severity: fatal → significant → minor.
6. Close with the single change that would help most.

## Done when
- The premise was challenged, findings are severity-ranked, every one carries a fix, and the highest-impact change is named.

<!-- INCLUDE: skills/_self-improvement.md -->
