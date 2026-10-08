# Architecture decision records

Engineering decisions that shape how Geneseed is built, one file each, numbered in order of
writing. The product decisions — what the harness is for and how it is laid out — are in
[`DESIGN.md`](../../DESIGN.md#-decisions); the map of the code is [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

A record is never edited to say something else. A decision that changes gets a new record, and the
old one's status becomes `Superseded by NNNN`.

| # | Decision | Status |
|---|---|---|
| [0001](0001-zero-runtime-dependencies.md) | Zero runtime dependencies — vendor or do without | Accepted |
| [0002](0002-no-spawn-on-the-generator-and-hook-path.md) | No spawn on the generator, one on the hook path, declared ones in the CLI | Accepted |
| [0003](0003-expected-values-written-out.md) | Expected values are written out, never recorded | Accepted |
| [0004](0004-uninstall-without-backups.md) | Uninstall needs no backup, by construction | Accepted |
| [0005](0005-stable-rule-ids.md) | Rules have permanent ids; their numbers are positional | Accepted |
| [0006](0006-markdown-by-default-for-generated-docs.md) | Generated docs are Markdown by default | Accepted |

## Template

```markdown
# NNNN — <decision>

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context
## Decision
## Consequences
```
