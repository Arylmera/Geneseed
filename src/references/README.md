# {{REFERENCES}} convention

> **Host-specific and local.** This directory is **git-ignored** — its contents
> are private to each machine and never committed or shared. Only this `README.md`
> and the `.gitignore` are tracked. The `REFERENCES.md` index, every path it
> points to, and any document dropped here live only on your machine. This is the
> sanctioned escape hatch from the harness's hermetic rule: it lets the agent
> reach host-specific documentation **without** that documentation — or its
> location — ever entering the published bundle.

Use this layer to point the agent at substantial bodies of project documentation
that must **not** live in the harness itself: framework internals, front-end /
back-end architecture notes, design systems, API references — knowledge that is
either too large, too proprietary, or simply maintained elsewhere on the machine.

## Two modes (mix freely)

The index supports both, side by side:

- **A — External pointer.** The doc stays where it already lives on the machine.
  You record an **absolute path** to it. Nothing is copied.
- **B — Local drop.** You place a doc (or a copy) **inside this folder** and
  reference it by **relative path**. It is git-ignored like everything here.

Prefer **A** when the doc has its own home and is updated independently; prefer
**B** when you want a self-contained snapshot travelling with the repo checkout.

## The index — `REFERENCES.md`

Create a local `REFERENCES.md` in this folder (git-ignored) and list every
reference in one table. The agent reads it at the start of a session and consults
the listed sources before answering questions about this project's stack.

```markdown
---
name: references-index
---

# {{REFERENCES}} index

| Reference | Location | What it covers |
| --- | --- | --- |
| Front-end architecture | /abs/path/to/frontend-docs/        | component tree, state mgmt, routing |
| Back-end services      | /abs/path/to/backend/README.md     | service boundaries, auth flow, queues |
| Framework internals    | ./framework-notes.md               | (dropped here) lifecycle, gotchas, patterns |
```

## Rules

- **Pointers, not secrets.** A path or a doc is fine; never inscribe a credential,
  token, or password here (universal {{LAW}} I). Point at where a secret is
  configured, never at its value.
- **One row per source.** Before adding, check the index for an existing row that
  covers it and update that instead.
- **Verify before trusting.** A path can rot or a doc can drift; confirm a
  reference still resolves and still matches reality before acting on it
  (universal {{LAW}} III).
- **Not {{MEMORY}}.** {{MEMORY}} holds atomic, non-obvious *facts* learned across
  sessions; {{REFERENCES}} points at *bodies of documentation* maintained
  elsewhere. A one-line URL or ticket belongs in {{MEMORY}} (`type: reference`);
  a whole doc set belongs here.
