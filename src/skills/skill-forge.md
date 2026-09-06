# {{SKILL}}: skill-forge

> {{DESC_SKILL_FORGE}}

**Trigger:** a task has repeated and no {{SKILL}} covers it; a {{SKILL}}'s
self-improvement loop produced an edit worth making; the user says "make this a
skill", "write a skill for…", "fix the trigger of…"; or two {{SKILLS}} keep
disambiguating against each other and should merge. Meta by nature: it edits the
apparatus, so every step ends in the user's assent ({{LAW}} II, {{LAW}} IV).

## Procedure
1. **Reuse before authoring** ({{DOCTRINE}} craft 1, craft 4). Read the catalogue — the
   host's skill list, or AGENT.md §4 — and the nearest existing {{SKILL}} in full. If
   its domain already covers the need, the change is an *edit* to that file (a step,
   a trigger phrase, a done-when), not a new file. Name the skill by its domain, not
   the situation that prompted it.
2. **Write the trigger first, then the procedure.** Start from
   `{{DIR_SKILLS}}/_template.md`. The purpose line says *what*; the **Trigger** line
   says *when*, in the words a user would actually say and the situations the model
   would actually meet — the emitted `description:` is purpose + trigger, and it is
   the only text the host matches a task against. Then the numbered procedure (each
   step an action with a verification), and a **Done when** that a stranger could
   check. Keep it to one coherent domain; a "Requires:" line only for a hard external
   prerequisite. When only the user should ever open it (a teaching drill, a tool
   gated on an environment the model cannot see), put the `invocation: user` HTML
   comment on the line after the purpose blockquote — the template shows it. Never
   quote that marker inside another skill's body: the emit matches it anywhere in the
   text, and the quoting skill silently drops out of the model's catalogue.
   A name the host already owns as a built-in command (Claude Code ships
   `security-review`, `code-review`, `simplify`, `init`) is shadowed — pick another.
3. **Test the trigger against its neighbours.** For three real asks the skill should
   catch and two it should not, decide from the descriptions alone which skill fires.
   A wrong pick is a trigger to sharpen — or a sign two skills should be one. A trigger
   that needs a "not this, use that" clause to be safe is a trigger with a fuzzy edge;
   fix the edge rather than adding the clause.
4. **Register it where the host expects.** In an *installed* harness: the file under
   `{{DIR_SKILLS}}/`, one row in AGENT.md §4's table, then `geneseed doctor` — it fails
   if the table and the files disagree. In the *Geneseed source repo* the cost is the
   full satellite set (`docs/extending.md` §3): the file, the §4 row, `DESC_<NAME>` in
   every theme, `SKILL_CLASS`, a `registry.json` row, the README enumeration, then
   `doctor --all` and the suites. A skill that bundles a script or several files is a
   folder skill (`<name>/SKILL.md` + `VENDOR.md`), listed in `VENDORED_SKILL_DIRS`.
5. **Merge or retire honestly.** When two skills fold into one: keep the best steps of
   each, rewrite the exit so the survivor routes to what the retired one led to, and
   remove the retired file and *every* reference to it (table row, sibling links, theme
   tokens, registry, README) — a dangling link is a build failure, a dangling trigger
   phrase is a silent miss. Retirement is deletion; get consent ({{LAW}} IV).
6. **Verify by rendering.** Build or re-emit, open the emitted `SKILL.md`, read the
   frontmatter description as the host will, and confirm the body carries no
   unresolved token or dead link (`doctor`, or `geneseed-build --validate-only`).
   Show the user the diff and the emitted description before it lands ({{LAW}} II).

## Done when
- The need is met by an edit to an existing {{SKILL}} or by one new file in its own
  domain; the emitted description names both purpose and trigger and wins its five
  test asks against the neighbours; every satellite the host or the repo demands is in
  place, `doctor` is green, and the user saw and accepted the change.

<!-- INCLUDE: skills/_self-improvement.md -->
