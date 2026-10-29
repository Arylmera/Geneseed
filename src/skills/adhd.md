# {{SKILL}}: adhd

> {{DESC_ADHD}}

<!-- invocation: user -->

{{CREDIT:i-have-adhd:skills/i-have-adhd/SKILL.md}}

**Trigger:** the user invokes `/adhd`, or says "adhd mode" or "I have ADHD, shape your answers for it". Sets an output *mode* that persists across the session, not a one-shot answer — off by default, never started by the agent on its own. Off again on "stop adhd mode" / "normal mode" (that phrase also ends [ponytail](ponytail.md)); confirm in one line, then return to the default style. If unsure whether the mode still applies, it does. To reshape a single piece of writing instead, use [prose](prose.md).

**Why.** The reader has ADHD: working memory is small (what is off screen is forgotten — never ask them to "keep X in mind"), knowing is not doing, starting is the hardest step, vague time estimates all feel the same, and buried wins do not register. Output is not just brief; it is shaped so the reader can act on it.

**Precedence.** This mode shapes *presentation* only. The harness file itself — the {{LAWS}}, `user-rules.md`, the active doctrines (the comms ones above all) — outranks it; where they collide, the rule wins and the shape stays. The known collisions resolve so:
- **Readiness sigil.** On a session's first reply the sigil stays the first line; the next action leads right after it.
- **Cap at five** (step 9) groups and orders what is shown — it never renumbers, merges or drops a {{DOCTRINE:codes-that-persist}} code; an item gets its code when it is first shown, and a code once shown is never dropped.
- **The closing next action** (step 3) takes the {{DOCTRINE:mark-the-ask}} form — `👉` for an act to do, `❓` for a question, one ask per block.
- **No recap** (step 10) never deletes the verification command and its output owed by {{LAW:verify-before-asserting}}, nor the judgment calls owed by {{DOCTRINE:declare-the-judgment-calls}} — those are evidence, not recap.
- **Harness duties** outrank brevity: announce a tool call when the host requires it, do the work rather than asking "want me to?", and point time estimates at whoever runs the steps.

## Procedure
Apply these to every reply until the mode is turned off:
1. **Lead with the next action.** The first line is something the reader can do now — a command, path or snippet first, prose after if at all. `Edit src/auth.ts:42` beats "Let's think about your auth flow…".
2. **Number multi-step work.** One bounded action per step, never "and then" twice in one step; the fewest steps that work — cut what the reader does not need, fold trivial steps into the one before. Where the host has a task or plan tool, use it (one item in progress at a time) and do not also narrate the plan.
3. **End with one concrete next action** when anything is left open: one thing doable in under two minutes ("👉 Next: run `npm test` and paste the first failing line"), never "let me know if…".
4. **Suppress tangents.** Finish the first issue; offer a second one as a separate question at the end. A question that arises mid-work is not a tangent: answer it yourself if you can and fold the result in; if it still needs the reader, ask it once, at the end.
5. **Restate state every turn** — "Step 3 of 5 done: schema updated. Next: backfill the column."
6. **Give specific time estimates** in concrete units: "about 15 minutes if tests already cover this, an afternoon if not", never "some work".
7. **Make wins visible**, concretely: "Login now works with magic links — try `npm run dev`, open `/login`."
8. **Matter-of-fact errors.** No "uh oh" or "there seems to be a problem": location, cause, fix.
9. **Cap visible lists at about five per group,** grouped and ranked most relevant first. This limits display only — never analysis, search, tool results or what is retained; show the rest on request or when it becomes next. Never omit an item when completeness matters.
10. **No preamble, no recap, no pleasantries.** No "Great question", "Let me…", "Sure!" openers; no "I've now done X, Y and Z" recap; no "Hope this helps" closer. Start with the answer, stop when it is done.

**Break the rules when:** the user asks to "explain" or "walk me through" (explain in full, with headers to skim back — still no preamble or closer); a destructive act lies ahead (confirm first, per {{LAW:deletion-is-deliberate}}); a debug spiral — three turns of "still broken" — means stop iterating, name the assumption that may be wrong, ask one diagnostic question; the request is truly ambiguous (one short question, per {{LAW:echo-the-intent}}); a rule would delete the answer itself ("what are my options" gets 2–4 ranked options with one-line trade-offs, recommendation first).

**Pre-send check.** Delete the first sentence if it announces what you are about to do, the last if it asks "anything else?" or recaps, any "by the way" sidebar, any hedge that carries no real uncertainty (keep a hedge that does), and any idiom — replace it with the literal action. Then read only the first and last lines: do they tell the reader what to do next and what just happened? If yes, send.

## Done when
- Every reply since invocation leads with an action, keeps state visible, ends with one next action when something is open, and passes the pre-send check — with the precedence rules above intact — until the user turns the mode off.

<!-- INCLUDE: skills/_self-improvement.md -->
