---
group: concepts
order: 13
title: "Agent pipelines"
kind: "concept"
link: {"hash": "#/section/agents", "label": "Browse the agents →"}
---
An **agent pipeline** is the isolated crew that [foreman mode](#/docs/foreman-mode) spawns for a substantial task. Where [agents](#/section/agents) are capability specialists you delegate to one at a time, a pipeline chains them into a single, self-contained unit of work that runs apart from your session.

### The default crew

- **analyst** — turns the request into a concrete plan and acceptance criteria.
- **developer** — implements against that plan.
- **tester** — exercises the result and gates the outcome.

The foreman adds whatever other specialists the task calls for — a reviewer, a security pass, a docs writer — routing each subtask to the agent that owns it.

### Isolated, and gated on green

A pipeline runs in its own context so the main session stays free to keep answering you, and it **merges only once its own tests and lint pass** — a crew that can't get to green reports back rather than landing broken work. It's the same *decompose → route to the owning specialist → converge* shape the saved workflow runner uses, but driven live by the foreman rather than a pre-written script.

---

**Related:** [Foreman mode](#/docs/foreman-mode) · [Agents](#/section/agents)
