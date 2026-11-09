---
group: guides
order: 25.5
title: "Upgrade to 5.0"
kind: "concept"
section: "Keep it running"
description: "What moves when a 4.x machine reaches 5.0, what to check, and how to go back."
---
5.0 moves your memory, rules, profile and wiki manifest into one folder that every host on the machine shares: the [shared tier](../concepts/shared-tier.md), `~/.config/geneseed/`. The move runs by itself in the next global rebuild, and nothing is deleted. This page is the whole path for a machine that already runs 4.x. A first install needs none of it.

> **You already know this:** a database migration that runs at deploy time. You can preview it, it runs once, and it keeps the old table until you drop it yourself.

## 1. Check that the install is new enough

- A **1.x** install must rebuild on a 4.x release first. Hooks that name `harness.py` no longer read as Geneseed's.
- An install **older than 3.7.0** must also rebuild on 4.x first, or run `geneseed setup` for it. 5.0 rebuilds it as it reads, which drops the comms pack and leaves the old rule numbers unmapped.

Anything from 3.7.0 upward goes straight to 5.0.

## 2. Preview the fold

Get the new version first, and let nothing rebuild yet. A 4.x `migrate` knows nothing of the fold.

```
npm install -g geneseed@latest     # from npm
git pull --ff-only                 # from a clone, in the Geneseed folder
```

Then preview:

```
geneseed migrate --dry-run
```

It writes nothing. It prints one line for each global install, read against the tier as it stands:

```
[migrate] would fold claude: 1 fact folded, 1 note, 1 rule to approve, old store moved aside
[migrate] 1 install(s) to migrate.
[migrate] would re-emit claude:global (…/.claude)
[migrate] --dry-run: nothing was written.
```

**Use only the `--dry-run` form here.** The `would re-emit` lines are the plan of `geneseed migrate` itself, which moves a clone install to [the npm shape](migrate.md). That is not a 5.0 step. From a clone those lines do not appear: the preview ends by saying a real run would refuse, and a real `migrate` there exits 3 and changes nothing.

It also lists the folders of retired skills that no manifest owns. A `would prune` line names a folder that a Geneseed build rendered and that no longer ships. The next global emit moves it to `<config dir>/archived-skills/<name>/<timestamp>/`. An `orphan` line names a root `AGENT.md`, or a retired skill folder that is a link, holds a link, or does not look like a Geneseed render. Such a folder may be yours. Geneseed never moves it, so move it by hand if it is not.

**In the console.** With no terminal, there is no preview before the first fold: *Update* on a clone pulls and rebuilds in one job, so the fold runs in that click, and a 4.x console has no preview. Nothing is deleted, as step 3 shows. After that, *Preview next rebuild* on the Installs page, beside *Rebuild all*, shows the same fold lines and orphans for any later rebuild (not yet the `would prune` folders), without the `would re-emit` lines, and writes nothing.

## 3. Upgrade

Use the route you always use. See [Upgrade](upgrade.md).

```
geneseed rebuild-all     # from npm
geneseed upgrade         # from a clone
```

Between the install and the end of the rebuild:

- Hooks and running sessions stay safe. They read the host files until the rebuild moves them.
- Do not change anything in the web console until the rebuild ends. *Rebuild all* on its Installs page is the same rebuild as `geneseed rebuild-all`.
- The first `geneseed upgrade` from 4.x still runs the old doctor gate, which can take up to 300 seconds. Wait for it.

Each global install in its host's own config directory prints what it moved, once:

```
[shared] claude: 1 fact folded, 1 note, 1 rule to approve, old store moved aside
```

The next rebuild prints nothing, because nothing is left to move. A hand-written line in a host `MEMORY.md` is named on that line as `memory/MEMORY.md`, with the archive path: it stops loading, so copy it into a fact or a rule. A fact with the same name and other text counts as a `collision` and lands as `<name>-<host>.md`. The `memory-curator` agent can merge those later. A failed copy prints `fold stopped at …`: the old store stays readable, and the next rebuild retries.

| What you had | Where it is now |
|---|---|
| Facts in `<host>/memory/` | `~/.config/geneseed/memory/`. The index is rebuilt there: a hand-written `MEMORY.md` or `topics/` page stays only in `archived-memory/<stamp>/` |
| Agent lessons in `<host>/memory/agents/` | `~/.config/geneseed/memory/agents/`, merged by line |
| `<host>/notebook/skill-notes/`, `agent-notes/` | `~/.config/geneseed/notes/` |
| `PROFILE.md`, `geneseed-wiki.jsonc` | The tier, if it held only a seed. Otherwise it stays, and a pointer goes to the draft |
| Exclude paths | The shared `excludes.json` |
| Rules in `<host>/user-rules.md` | A rule the tier already holds word for word leaves the host file. Any other stays there, still binding, and goes to the draft |
| The old store | `<host>/archived-memory/<stamp>/`, with notes and whole files in the same kind of folder |
| The rest of `notebook/`, the constitution, kits | They stay per install |

A host installed after an `exclude add` also gets the repo-side wiring on this rebuild, so the first upgrade can write `.bob/rules/geneseed.md` or `settings.local.json` in an excluded repo. The report line names each file.

## 4. Decide what waits in the draft

`user-rules.draft.md` in the tier lists what the fold could not decide for you. It is never loaded: a drafted rule goes on binding from its host file until you decide.

Ask the agent to review the pending rules, or open **Pending** on the console's Personal page. The `rule` skill and that section are the only things that write a decision, and they take the same steps:

- **Approve** moves the rule to the shared file under a new number. The next rebuild of that host removes the host copy.
- **Reject** keeps the rule on that host only, and it is never drafted again.
- **Later** leaves it pending.
- For a profile or wiki pointer, you choose which file becomes the shared one.

In the console, an item you leave alone stays pending. After a decision that moves a file, the page offers *Rebuild all*, which removes the host copy. If another session changed the draft, the page reloads and applies nothing.

## 5. Project installs

A project install does not change. It keeps its own `memory/` and notes and never folds. To let one read the tier as well, add `--shared-tier on` to its build, or answer the `setup` question. The trade is stated in [Rules](../concepts/rules.md): a session pays about 1 500 tokens more, and a large tier can push the project's docs down to a lazy listing.

## What was removed

- `sync-self` is gone. Use `upgrade`.
- `upgrade` takes only a theme: `upgrade imperial` works, and `upgrade main imperial` is an error.
- `bootstrap` no longer takes `ref` or `extra`.
- `anamnesis/` is no longer read as a store. `status` reports one that is left over.
- `quiz` is part of `teach`. `/quiz` still opens it.
- The console's rule limit is gone: each rule shows its token cost, and the page shows a total with no ceiling.

## Going back

There is no automatic downgrade. Install the older version, then copy `archived-memory/<stamp>/` back over the host's `memory/`, and do the same for `archived-user-rules.md/` and `archived-PROFILE.md/`. Rules you approved into the tier and excludes folded into the shared list are not merged back, so the archives are where the old text lives. The tier stays where it is, and an older Geneseed does not read it.

---

**Next:** [The shared tier](../concepts/shared-tier.md) · [Verify it works](verify.md) · [Upgrade](upgrade.md)
