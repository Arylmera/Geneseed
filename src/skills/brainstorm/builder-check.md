# {{SKILL}}: brainstorm — builder check

{{CREDIT:superpowers:skills/brainstorming/builder-check-prompt.md}}

The spec's author cannot read it cold: a re-read inherits the framing that wrote it. So a
fresh reader does.

1. **Dispatch one fresh subagent** — never resume one; isolation and the no-subagent
   fallback are as in [fresh-eyes](../fresh-eyes.md) step 3. Brief it with the spec file
   alone: *"You are a capable builder in this domain who must plan the work from this
   document and cannot reach its author. List, most important first, the questions where a
   wrong guess would cost real rework. Skip what a builder may rightly decide."*
2. **Sort its questions into three piles.** *Answered* — the answer exists (the code, the
   chat, the docs): write it into the spec. *Minor* — settle it yourself and mark it
   **your call** in the ledger ({{DOCTRINE:declare-the-judgment-calls}}). *Theirs* — only the
   user can decide: ask ONE numbered round, most important first, then update the spec.
3. **One round only.** Do not re-run the check on the updated spec; what is still open
   after the user's answers stays in the ledger as open.
