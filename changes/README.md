# Changelog fragments

A pull request does not edit `CHANGELOG.md`. It adds one file here, and the release folds every
file into the version's section. One file per PR means two PRs never conflict on the changelog.

## Add one

Name it `<slug>.<type>.md`:

- `<slug>` is lower-case kebab, usually the branch name: `memory-topic-chips`.
- `<type>` is one of `added`, `changed`, `deprecated`, `removed`, `fixed`, `security`. These are
  the Keep a Changelog headings.

The body is one or more `- ` entries, written as they will read in the changelog. Do not add a
heading, because the fold writes the headings. For example, `changes/memory-topic-chips.changed.md`:

```markdown
- **Memory topics are chips that filter the facts.** The Topics card on Personal → Memory was a
  display-only list. Click a topic to narrow the facts to it, and click it again to clear.
```

## When one is required

The `pr-title` check fails on a `feat`, `fix` or `perf` PR, or on any breaking (`!`) PR, that adds
no fragment. A PR whose change no user would notice takes the `no-changelog` label instead.
`chore`, `docs`, `test`, `ci`, `refactor`, `build`, `style` and `revert` PRs need nothing.

```bash
node tests/changelog.mjs --check
```

This checks every fragment and checks that `## [Unreleased]` in `CHANGELOG.md` stays empty. The
fragments are the only place an unreleased entry lives.

## At release

```bash
node tests/changelog.mjs --fold 6.2.0
```

This writes `## [6.2.0] — <today>` with the fragments grouped by type and deletes them. Commit it
together with the version bump.
