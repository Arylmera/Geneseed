---
group: start
order: 2
title: "Verify it works"
kind: "concept"
---
Three quick checks confirm everything wired up.

### 1. The readiness sigil

Open your agent in any repo. The first reply opens with the readiness line — `✅` for neutral, `🧬` for imperial, or your theme's equivalent. If it's missing, the agent isn't pointed at `AGENT.md` — re-check your tool's instructions setting.

### 2. The harness itself

```
./geneseed doctor       # macOS / Linux
.\geneseed.cmd doctor   # Windows
```

Should print `ok`. Failures include unresolved theme tokens, dead links, missing files, or a drifted bundle — each comes with a fix hint. Press the **Run doctor** button above to run it from here.

<!--harness:opencode-->
### 3. Context delivery

Start a session with `GENESEED_DEBUG=1` set. The context plugin logs what it discovered and injected; you should see the repo's `README.md` and any docs listed.
<!--/harness-->

---

Trouble? See [Troubleshooting](#/docs/trouble).
