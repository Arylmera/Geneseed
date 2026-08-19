**{{PACK_CRAFT}}** — how code is written.

### {{DOCTRINE}} craft 1 — {{DOC_CRAFT_1}}
When an action repeats, automate it — a {{SCRIPT}}, a {{SKILL}}, a shortcut. Do not
perform by hand what the machine can perform a thousand times. When you build a
{{SKILL}} for it, make it a vessel for one coherent domain — not a single command and
not a grab-bag: seek an existing {{SKILL}} whose domain already covers the need and
extend it before forging a new one, and name {{SKILLS}} by domain. Reuse before creating.

### {{DOCTRINE}} craft 2 — {{DOC_CRAFT_2}}
All configuration and instruction files — this file, {{LAW}} and {{DOCTRINE}} files,
{{AGENT}} and {{SKILL}} specs — are written in English, so any contributor or tool can
read them.

### {{DOCTRINE}} craft 3 — {{DOC_CRAFT_3}}
When a change alters structure, an interface, or behaviour, update the affected
documentation — README, API docs, usage examples — in the *same* change. Code and
its description ship together; documentation that has drifted from the code is a
defect, not a deferred task.

### {{DOCTRINE}} craft 4 — {{DOC_CRAFT_4}}
Before adding a file, module, function, or abstraction, confirm an equivalent
does not already exist; prefer extending what is there. Duplication is a defect.
({{DOCTRINE}} craft 1 applies this to {{SKILLS}}; here it binds all code.)

### {{DOCTRINE}} craft 5 — {{DOC_CRAFT_5}}
Match the surrounding code — its naming, structure, formatting, and patterns.
Before writing new code, find a concrete example of the same pattern already in the
repo and follow it; build on libraries already in use, and do not introduce a new
dependency without surfacing it first. A new external dependency is a consequential
decision ({{ONTOLOGY}}: {{ONT_DECISIONS}}): confirm the existing stack cannot already
do the job ({{DOCTRINE}} craft 4), then present the choice with its cost —
maintenance, upgrades, supply chain — and add it only once accepted. Introduce a
divergent convention only with reason, and where it affects others, only with
agreement. Where a conventional and a clever path both work, prefer the conventional
one — the behaviour a reader expects beats the one that impresses. Consistency
outranks personal preference.

### {{DOCTRINE}} craft 6 — {{DOC_CRAFT_6}}
Change as little as the task requires. Make the minimal, surgical edit that solves
the problem and stop — do not rewrite a whole file when a few lines suffice,
reformat code you were not asked to touch, or refactor untouched regions because
you happened to read them. Where {{LAW}} II keeps one *intent* per change, this
keeps that intent's *footprint* small: a diff a human can review in one sitting is
a diff a human will actually review ({{DOCTRINE}} process 5). A genuinely needed wide
change — a rename, a codemod, a mechanical sweep — is itself one intent and is fine;
what is forbidden is the incidental churn that rides alongside the real change and
buries it. When matching conventions ({{DOCTRINE}} craft 5) would mean touching
regions the task does not, the smallest diff wins: note the convention gap and
surface the broader style fix as its own proposed change, not as baggage on this one.
The smaller the diff, the cheaper the review and the cleaner the revert.
