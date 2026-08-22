/**
 * What `js/cli-table.json` claims ABOUT THE PORT, after argparse stops being able to check it.
 *
 * SUCCESSOR TO the surviving half of `tests/test_cli_reference.py`, and the split is the point.
 * That file's strongest gate walks `build_argparser()` and asserts the committed table equals it
 * field for field — 25 subparsers, 46 `add_argument` calls. It dies with argparse and NOTHING
 * replaces it: P4 is where the table stops having an oracle, and the honest record of that is
 * `tests/snapshot/cli_help.test.mjs`'s recorded corpus (frozen while the parser existed) plus this file,
 * which checks every claim the table makes about the program that reads it.
 *
 * ⚠ THE ONE STATE WHERE THE TWO IMPLEMENTATIONS ANSWER DIFFERENTLY ON PURPOSE. The reference
 * compiles its parser in; this entry READS it. So a tree with no `js/cli-table.json` is a state
 * no cell may compare — a `cli_golden` cell would report the difference as a failure. What must
 * hold is that the Node side REFUSES, loudly, with the fix in the message, rather than parsing
 * with an empty spec: an empty spec accepts every token and binds none, so
 * `uninstall --target X` would run against the DEFAULT target while the operator believes they
 * named one.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { cliCommand, cliReference, cliSpec, helpWidth } from '../../js/ui/cli.mjs';
import { copyCheckout } from '../helpers/cli_golden.mjs';
import { makeSandbox, cellEnv } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const TABLE = path.join(ROOT, 'js', 'cli-table.json');
const ENTRY = 'bin/geneseed-cli.mjs';

/** The verbs `bin/geneseed-cli.mjs` dispatches on, scraped from its own VERBS table. */
function entryVerbs() {
  const src = readFileSync(path.join(ROOT, ENTRY), 'utf8');
  const at = src.indexOf('const VERBS = {');
  assert.notEqual(at, -1, `${ENTRY} has no VERBS table — the scrape has gone stale`);
  const body = src.slice(at, at + src.slice(at).indexOf('\n};'));
  // ⚠ TWO-SPACE INDENT EXACTLY. The rows are `name: { fn: cmdX }`, so a `\s*` prefix also
  // matches the nested `fn:` — the first draft reported `fn` as an undescribed verb.
  const names = [...body.matchAll(/^  '?([a-z][a-z-]*)'?:/gm)].map((m) => m[1]);
  assert.ok(names.length > 15, `the VERBS scrape found only ${names.length} rows`);
  return [...new Set(names)];
}

test('every verb the entry dispatches has a spec', () => {
  // A verb the table does not describe would reach `parse` with NO RULES — which accepts every
  // token and binds none — so the entry refuses it. This says the refusal is never the normal
  // path: it is what an out-of-date install gets, not what a shipped verb gets.
  const missing = entryVerbs().filter((v) => cliSpec(v) === null);
  assert.deepEqual(missing, [],
    `js/cli-table.json describes no subcommand for ${missing.join(', ')}`);
});

test('the table is the document the entry reads, and the page is derived from it', () => {
  // THE ASSERTION A PAYLOAD EQUALITY CANNOT MAKE: that the reader is looking at the file this
  // test is about. The reference stated it by comparing two paths across implementations; with
  // one implementation left, what says it is that the live reader's answer tracks the FILE.
  const onDisk = JSON.parse(readFileSync(TABLE, 'utf8'));
  // 29 = the 26 names argparse answered to (25 subparsers plus the `update` alias) plus the
  // three verbs that never had a subparser: `catalog`, `mcp` and `memory`, each a terminal
  // face on a capability that had reached the product only through the web console. The split
  // is owned by `tests/snapshot/cli_help.test.mjs`, which names both populations and fails a verb that
  // falls into neither; this line is the count that says the table did not quietly grow past
  // it.
  assert.equal(onDisk.commands.length, 29,
    'the table is no longer the 29-row document — 26 recorded names plus three Node-native '
    + 'verbs. A new row needs a population in tests/snapshot/cli_help.test.mjs before it needs a number '
    + 'here');
  assert.equal(cliReference().commands.length, onDisk.commands.length,
    'cliReference() and js/cli-table.json disagree on how many commands exist, so the reader is '
    + 'not reading this file');
  // …and the ROWS, not just the count: a reader pointed at a stale copy of the same size would
  // satisfy the line above.
  assert.deepEqual(cliReference().commands.map((c) => c.name).sort(),
    onDisk.commands.map((c) => c.name).sort());
  // The page is the file MINUS what argparse hides — the one transformation between them.
  // ⚠ PER COMMAND, NOT GLOBALLY BY DEST. `ref` is hidden on `upgrade` and VISIBLE on
  // `bootstrap`, so a global dest set reports the visible one as a leak — which is what the
  // first draft did. The filter is a property of an ARGUMENT of a COMMAND.
  const page = Object.fromEntries(cliReference().commands.map((c) => [c.name, c]));
  let checked = 0;
  for (const c of onDisk.commands) {
    const shown = new Set([...(page[c.name]?.positionals ?? []),
      ...(page[c.name]?.options ?? [])].map((a) => a.dest));
    for (const a of [...c.positionals, ...c.options]) {
      if (!a.hidden) continue;
      checked += 1;
      assert.ok(!shown.has(a.dest),
        `${c.name}'s ${a.dest} is marked hidden in the table but reaches the rendered page`);
    }
  }
  assert.ok(checked >= 5, `only ${checked} hidden arguments were checked`);
});

test('the help width is the terminal width less two, and COLUMNS wins', () => {
  // `helpWidth()` against `shutil.get_terminal_size().columns - 2`. THE THIRD CALLER `parseIntStrict`'s
  // docblock did not have: `$COLUMNS` arrives however the shell set it, so this one strips
  // first — and the port had reached for `parseInt` in a tree that already owned `parseIntStrict` for
  // exactly this. Every help assertion in `tests/snapshot/cli_help.test.mjs` runs at `COLUMNS=80`, so
  // both the env-parse branch and the fallback were exercised at one value each.
  const saved = process.env.COLUMNS;
  try {
    for (const [set, want] of [['100', 98], [' 100 ', 98], ['80', 78], ['3', 1]]) {
      process.env.COLUMNS = set;
      assert.equal(helpWidth(), want, `COLUMNS=${JSON.stringify(set)}`);
    }
    // ⚠ THE JUNK VALUES ARE ASSERTED TO BE IGNORED, not to produce some other number, and the
    // first draft got that wrong: it required `80x` not to yield 78, which conflates "parsed as
    // 80" with "fell back to a terminal that happens to be 80 columns wide". The deterministic
    // claim is that a value `int()` refuses gives the SAME answer as no value at all.
    delete process.env.COLUMNS;
    const fallback = helpWidth();
    for (const junk of ['80x', 'abc', '', '   ', '0', '-5', '3.5', '+', '0x50']) {
      process.env.COLUMNS = junk;
      assert.equal(helpWidth(), fallback,
        `COLUMNS=${JSON.stringify(junk)} changed the width — int() refuses it, and `
        + 'Number.parseInt would read the leading digits of half of these');
    }
  } finally {
    if (saved === undefined) delete process.env.COLUMNS; else process.env.COLUMNS = saved;
  }
});

test('the entry refuses when the parser metadata is absent', () => {
  // ⚠ THE DIVERGENCE THE PORT BOUGHT, gated where no cell can reach it. Deleting the table from
  // a COPY is the whole fixture; the refusal must name the verb, name the fix, and — the
  // absolute half — must not have proceeded.
  const sb = makeSandbox('clitable-');
  try {
    const co = path.join(sb.path, 'checkout');
    copyCheckout(co, { 'js/cli-table.json': null });
    assert.ok(!existsSync(path.join(co, 'js', 'cli-table.json')), 'the fault did not take');
    const home = path.join(sb.path, 'home');
    const r = spawnSync(process.execPath,
      [path.join(co, ...ENTRY.split('/')), 'uninstall', '--target', 'X'],
      { cwd: co, encoding: 'utf8', windowsHide: true, env: cellEnv(home) });
    assert.equal(r.status, 2,
      `expected a refusal, got ${r.status}: ${r.stdout.slice(-400)}${r.stderr.slice(-400)}`);
    assert.match(r.stderr, /js\/cli-table\.json describes no subcommand 'uninstall'/);
    assert.match(r.stderr, /npm i -g geneseed@latest/,
      'the refusal does not tell the operator how to fix it');
    assert.ok(!r.stdout.includes('[uninstall]'),
      'the verb ran with an EMPTY spec — which accepts every token and binds none, so '
      + '--target X was silently ignored and the default target was used');
  } finally {
    sb.cleanup();
  }
});

test('the same copy with the table present runs', () => {
  // THE CONTROL THE REFUSAL NEEDS: a copy that could not run ANY verb produces the same exit
  // code for a reason that has nothing to do with the table.
  //
  // ⚠ `version`, NOT `exclude list`, AND P7a IS WHY. `exclude list` exits 0 when a global
  // install exists and 1 when none does, so that control passed on a laptop with Geneseed
  // installed and failed everywhere else — including under this suite's own home sandbox. A
  // control whose answer depends on the machine is not a control. `version` reads the COPY.
  const sb = makeSandbox('clitable-ok-');
  try {
    const co = path.join(sb.path, 'checkout');
    copyCheckout(co, {});
    assert.ok(existsSync(path.join(co, 'js', 'cli-table.json')));
    const r = spawnSync(process.execPath, [path.join(co, ...ENTRY.split('/')), 'version'],
      { cwd: co, encoding: 'utf8', windowsHide: true, env: cellEnv(path.join(sb.path, 'home')) });
    assert.equal(r.status, 0,
      `the untouched copy could not run a verb at all: ${r.stdout.slice(-400)}${r.stderr.slice(-400)}`);
  } finally {
    sb.cleanup();
  }
});

test('the hidden arguments are still the five the recording froze', () => {
  // The claim `test_the_file_carries_the_arguments_argparse_hides` made against the live parser.
  // `tests/snapshot/cli_help.test.mjs` already asserts the same equality against the recorded corpus; the
  // pointer is checked rather than duplicated, because two owners of one claim drift apart.
  const owner = readFileSync(path.join(ROOT, 'tests', 'snapshot', 'cli_help.test.mjs'), 'utf8');
  assert.ok(owner.includes("test('the table carries the surface argparse hides'"),
    'tests/snapshot/cli_help.test.mjs no longer owns the hidden-argument equality — every SUPPRESS-ed '
    + 'argument binds a real value, and without it `geneseed upgrade v1 imperial` mis-parses');
  // …and the one thing that pointer cannot carry: the table must still HAVE hidden rows, or the
  // owner is asserting an equality between two empty sets.
  const hidden = cliCommand('web').options.filter((a) => a.hidden);
  assert.ok(hidden.length > 0, 'the web command has no hidden option — `--daemon-internal` is '
    + 'passed 95 times a run by the recorded web cells');
});
