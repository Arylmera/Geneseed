---
group: concepts
kind: "concept"
section: "Loops"
order: 20
title: "Contracts and ignored deletions"
description: "The contract globs that always raise risk, the deletions a template ignores, and the glob dialect."
---
A template may declare `contracts`: globs for the interface or schema files whose *shape* a
change can break, not just the implementation behind it — `update-contract` and
`api-endpoint` ship defaults (OpenAPI/Swagger/AsyncAPI specs, `.proto`, `.avsc`, GraphQL schemas,
Flyway/Liquibase migrations). They're copied into `LOOP.md`'s own `contracts` at `loop init`;
`loop init --contracts <globs>` appends more, and the list is editable by hand in `LOOP.md`
afterward, applying from the next score on. Touching a file any of these globs match raises the
*actual* score to at least the **api** weight (0.8) regardless of the declared card — a contract
edit is never silent.

A template may also declare `ignoreDeletions`: globs excluded from the ">20 deleted lines"
escalation rule only. `deps-upgrade` lists lockfiles this way (`**/package-lock.json`,
`**/yarn.lock`, `**/pnpm-lock.yaml`, `**/*.lock`, `**/gradle.lockfile`) because a lockfile
regenerating under a bump deletes and re-adds hundreds of lines with no risk in them;
`remove-dead-code` ignores generated output (`**/generated/**`, `**/generated-sources/**`,
`**/target/**`, `**/build/generated/**`) for the same reason. A file matched by `ignoreDeletions`
is still subject to the write-set check — it must still be declared or match a write-set glob, it
just doesn't count toward the deletion total.

Both lists, and the write set, share one hand-rolled glob dialect (no dependency — this module
imports only node builtins): `*` and `?` stay inside one path segment, `**` crosses segments and
`**/` may match zero directories (so `**/yarn.lock` also covers the root one); there is no brace
expansion (`{a,b}`). A write-set entry is matched as a glob too, but only when it has at least one
literal (non-`*`/`?`) path segment — a wildcard-only entry like `**` or `**/*.java` would
otherwise declare the whole repo as writable, so it's left to match nothing instead and the
check fails closed.
