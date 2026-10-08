## What and why

<!-- One concern per PR. What changes, and the reason it has to. -->

## Proof

<!-- Paste the counts, not "tests pass". See CLAUDE.md § Proving a change. -->

- [ ] `npm run lint`
- [ ] `node --test --test-reporter=tap "tests/**/*.test.mjs"` — `# tests N`, `# fail 0`
- [ ] `node tests/shim_intact.mjs`
- [ ] `node bin/geneseed-cli.mjs doctor --all`
- [ ] `node tests/golden.mjs` (emit path touched) / `--cli` (anything a verb prints)
- [ ] `node tests/mutate.mjs --verify` (code moved)

## Impact

- [ ] New tracked file → a SHIPS/WITHHELD row in `tests/unit/package_manifest.test.mjs`
- [ ] `web/src/` changed → `web/dist/` rebuilt and committed
- [ ] `src/` changed → installs need a re-emit (`geneseed rebuild-all`); say so in the release notes
- [ ] Security-critical path touched (see `SECURITY.md`) → say what a reviewer should read closest
