/**
 * The claims the top-level docs make about this port, gated against the tree.
 *
 * SUCCESSOR TO `tests/test_docs_claims.py`, and — per the finish plan — THE GATE P5's DOC
 * REWRITE LANDS AGAINST. It exists before those edits deliberately: a doc rewrite with no gate
 * in front of it is a rewrite nothing checks.
 *
 * `doctor`'s prose mirror already gates the counts that come out of `src/` (laws, agents,
 * skills, themes, plugins). This file gates the other kind of counting sentence — the one `src/`
 * cannot answer: WHAT A READER IS PROMISED. Every claim below was wrong at least once during
 * this port; the plugin count is the one that actually shipped wrong, with the README saying six
 * while seven shipped.
 *
 * NOTHING HERE PARSES YAML. The harness is stdlib-only on both sides and always has been, so the
 * structural claims about the publish workflow are text assertions over the file and the real
 * parse happens where the file actually runs.
 *
 * ⚠ `ThePublishWorkflowIsDeliberate` IS THE ONE WITH A SILENT FAILURE MODE, which is why it
 * carries seven of the twenty-three. npm's trusted publisher is keyed on `owner/repo` PLUS the
 * workflow FILENAME: rename the file and the workflow still runs, still mints an OIDC token, and
 * npm just refuses it — and nothing local can rehearse that. So the workflow is DISCOVERED here
 * (the one file under `.github/workflows/` that runs `npm publish`) rather than named by a
 * constant, because a constant would be a second copy of the value under test: renaming both
 * would pass while the npm side still pointed at the old name.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const readJson = (...p) => JSON.parse(read(...p));

const README = 'README.md';
const SETUP = 'SETUP.md';
const QUICKSTART = 'QUICKSTART.md';

const WORDS = Object.fromEntries(
  ('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen '
    + 'fifteen sixteen seventeen eighteen nineteen twenty').split(' ').map((w, i) => [w, i]));

/** A count written as a digit or as an English word, or null if it is neither. */
function asInt(token) {
  if (/^\d+$/.test(token)) return Number(token);
  return Object.prototype.hasOwnProperty.call(WORDS, token.toLowerCase())
    ? WORDS[token.toLowerCase()] : null;
}

/**
 * The verb table of a `bin/*.mjs` entry, SCRAPED — the table is the dispatch.
 *
 * `:\s*\S` rather than `:\s*\{`: `bin/geneseed-hook.mjs`'s rows are still `name: { fn: … }`
 * objects, but Task 5 flattened `bin/geneseed-cli.mjs`'s to `name: cmdX` directly, so the
 * value is no longer always a brace. Any non-whitespace after the colon still means a real
 * row rather than a bare `name:` with nothing after it on the line.
 */
function verbsOf(rel) {
  const src = read(...rel.split('/'));
  const m = /const VERBS = \{([\s\S]*?)\n\};/.exec(src);
  if (!m) return new Set();
  return new Set([...m[1].matchAll(/^ {2}'?([a-z][a-z-]*)'?:\s*\S/gm)].map((x) => x[1]));
}

/** Commands in the CLI table that neither Node entry point answers. */
test('every verb the table declares is dispatched by an entry point', () => {
  // THE DURABLE PROPERTY UNDER THE OLD MIGRATION BOOKKEEPING. `js/cli-table.json` is the CLI's
  // owned description of itself; a verb declared there and dispatched by neither binary is a
  // verb that parses, prints help, and then does nothing.
  const declared = readJson('js', 'cli-table.json').commands.map((c) => c.name);
  const dispatched = new Set([
    ...verbsOf('bin/geneseed-cli.mjs'), ...verbsOf('bin/geneseed-hook.mjs'),
  ]);
  const aliases = { update: 'upgrade' };            // an alias of a dispatched verb is dispatched
  const orphans = declared.filter((n) => !dispatched.has(n) && !dispatched.has(aliases[n]));
  assert.deepEqual(orphans, [], `declared but dispatched by neither binary: ${orphans}`);
  // THE POSITIVE CONTROLS — both scrapes must really have read something, or the line above is
  // satisfied by two empty sets agreeing.
  assert.ok(declared.length > 20, `js/cli-table.json parsed to ${declared.length} commands`);
  assert.ok(verbsOf('bin/geneseed-cli.mjs').size > 15, 'the CLI verb scrape found almost nothing');
  assert.ok(verbsOf('bin/geneseed-hook.mjs').size > 2, 'the hook verb scrape found almost nothing');
});

// ---------------------------------------------------------------------------------------------
// THE COUNTING SENTENCES `doctor`'s MIRROR IS NOT HANDED

test('every plugin count in prose is the real one', () => {
  // `doctor`'s mirror gained the plugin count and is handed the README; the same claim is made
  // in two adapter docs it never sees, and widening its signature would be a second owner of one
  // question. Word forms count — "seven plugins" drifts exactly as "7 plugins" does, and the
  // README's did.
  const want = readdirSync(path.join(ROOT, 'adapters', 'opencode', 'plugins'))
    .filter((n) => n.startsWith('geneseed-') && n.endsWith('.js')).length;
  assert.ok(want > 1, 'no plugins found — the assertion below would be vacuous');
  let seen = 0;
  for (const rel of ['docs/opencode-plugin-setup.md', 'adapters/opencode/README.md']) {
    for (const m of read(...rel.split('/')).matchAll(/(\w+) plugins\b/g)) {
      const got = asInt(m[1]);
      if (got === null) continue;                      // "the plugins", "OpenCode plugins"
      seen += 1;
      assert.equal(got, want, `${rel} says "${m[1]} plugins" and ${want} ship`);
    }
  }
  assert.ok(seen > 0, 'neither adapter doc states a plugin count');
});

test('every theme count in prose is the real one', () => {
  // PLURAL only: `themes?` also matched "one theme", which is a sentence about a single install
  // and not a claim about the roster.
  const want = readdirSync(path.join(ROOT, 'themes'))
    .filter((n) => n.endsWith('.json') && n !== '_TEMPLATE.json').length;
  assert.ok(want > 1, 'no themes found');
  let seen = 0;
  for (const doc of [README, SETUP, QUICKSTART]) {
    for (const m of read(doc).matchAll(/(\w+) themes\b/g)) {
      const got = asInt(m[1]);
      if (got === null) continue;
      seen += 1;
      assert.equal(got, want, `${doc} says "${m[1]} themes" and ${want} ship`);
    }
  }
  assert.ok(seen > 0, 'no theme count in any of the three docs');
});

// THE TREE IS JAVASCRIPT, AND STAYS THAT WAY

const bundleScripts = () => {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith('.py')) out.push(e.name);
    }
  };
  walk(path.join(ROOT, 'src'));
  return out.sort();
};

test('the bundle source carries no python at all', () => {
  // Derived by globbing `src/` — the tree every bundle is rendered from — rather than by
  // trusting the package manifest's declaration, so the two gates fail independently.
  assert.deepEqual(bundleScripts(), [],
    'Python is back inside the bundle source — the docs claim and the package manifest both '
    + "need the new row, and 'no Python needed' is false again");
});

// THE INSTALL COMMAND NAMES THE PUBLISHED PACKAGE

// ANCHORED TO A LINE START OR A BACKTICK, because a prose mention of a command reads exactly
// like an invocation of it: an unanchored `npx\s+(\w+)` matched "An npx install is Python-free"
// and reported that the README told people to run `npx install`.
const NPX_RE = /(?:^[ \t]*|`)npx((?:\s+[@\w./=-]+)+)/gm;
const NPM_G_RE = /(?:^[ \t]*|`)npm (?:install|i) -g\s+([@\w./-]+)/gm;

/** `geneseed@latest` → `geneseed`; `@scope/x@1` → `@scope/x`. */
const bare = (spec) => (spec.lastIndexOf('@') > 0 ? spec.slice(0, spec.lastIndexOf('@')) : spec);

/** `[packageSpec, binary]` per npx line, resolving `-p`/`--package`. */
function* npxCalls(text) {
  for (const m of text.matchAll(NPX_RE)) {
    const toks = m[1].split(/\s+/).filter(
      (t) => t && (!t.startsWith('-') || t === '-p' || t === '--package'));
    if (!toks.length) continue;
    if ((toks[0] === '-p' || toks[0] === '--package') && toks.length >= 3) yield [toks[1], toks[2]];
    else yield [toks[0], toks[0]];
  }
}

test('every npx line that runs a geneseed binary names the package', () => {
  // "EVERY npx LINE NAMES OUR PACKAGE" IS SIMPLY FALSE and the docs are right: SETUP.md tells
  // you to run `npx @modelcontextprotocol/server-filesystem` to wire an MCP server. The real
  // claim is narrower and derived — an npx line whose BINARY is one of `package.json`'s `bin`
  // keys must resolve to this package. That also catches what the loose version could not:
  // `npx geneseed-build` is a bin name, not a package name, and would install something else.
  const man = readJson('package.json');
  const bins = new Set(Object.keys(man.bin));
  let seen = 0;
  for (const doc of [README, QUICKSTART, SETUP, 'docs/web/install-quick.md']) {
    for (const [spec, binary] of npxCalls(read(...doc.split('/')))) {
      if (!bins.has(bare(binary))) continue;           // a third-party package the docs name
      seen += 1;
      assert.equal(bare(spec), man.name,
        `${doc}: \`npx ${spec} … ${binary}\` runs one of this package's binaries but names `
        + `'${bare(spec)}'; the package is '${man.name}'. A bin name is not a package name.`);
    }
  }
  assert.ok(seen > 0, 'no `npx …` line runs a geneseed binary in any install doc — this test is '
    + 'vacuous and the npx install path is undocumented');
});

test('the global install names the package too', () => {
  const { name } = readJson('package.json');
  let seen = 0;
  for (const doc of [README, QUICKSTART, SETUP]) {
    for (const m of read(doc).matchAll(NPM_G_RE)) {
      seen += 1;
      assert.equal(bare(m[1]), name, `${doc} says \`npm i -g ${m[1]}\` but the package is '${name}'`);
    }
  }
  assert.ok(seen > 0, 'no `npm install -g …` line in any install doc');
});

// ---------------------------------------------------------------------------------------------
// THE PUBLISH WORKFLOW — seven claims, one silent failure mode

/** The ONE workflow that runs `npm publish`, DISCOVERED rather than named. */
function publishWorkflow() {
  const dir = path.join(ROOT, '.github', 'workflows');
  const found = readdirSync(dir).filter((n) => n.endsWith('.yml')).sort()
    .filter((n) => /^\s*(-\s*)?run:.*npm publish/m.test(readFileSync(path.join(dir, n), 'utf8')));
  assert.equal(found.length, 1,
    `expected exactly one workflow that runs \`npm publish\`, found ${found}`);
  return { name: found[0], text: readFileSync(path.join(dir, found[0]), 'utf8') };
}

test('the publish workflow references its own filename', () => {
  const wf = publishWorkflow();
  const named = [...new Set([...wf.text.matchAll(/[\w.-]+\.ya?ml/g)].map((m) => m[0]))];
  assert.deepEqual(named, [wf.name],
    `${wf.name} names ${named} as a workflow filename. npm's trusted publisher is keyed on the `
    + 'filename, so the file must name itself and nothing else — renaming it without updating '
    + 'the npm side breaks publishing with no local symptom.');
});

test('the publish workflow mints an OIDC token and carries no registry credential', () => {
  const wf = publishWorkflow();
  // ⚠ THE CREDENTIAL HALF READS THE FILE WITH COMMENTS STRIPPED, and that is a gate defect the
  // reference found in ITSELF on its first run: the file's own header explains that there is no
  // NPM_TOKEN, and the check fired on the sentence saying so. A claim about what a workflow USES
  // cannot be made against its prose.
  const executable = wf.text.replace(/#.*/g, '');
  assert.match(wf.text, /^\s*id-token:\s*write\b/m,
    'trusted publishing needs `id-token: write`; without it the job cannot mint the OIDC token '
    + 'and falls back to a credential this repository deliberately does not have');
  for (const forbidden of ['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'secrets.']) {
    assert.ok(!executable.includes(forbidden),
      `${forbidden} in the publish workflow — the whole point of trusted publishing is that no `
      + 'long-lived registry credential exists in this repository');
  }
});

test('publishing is triggered by hand and never by a push', () => {
  const wf = publishWorkflow();
  const m = /^on:\n([\s\S]*?)(?=^\w)/m.exec(wf.text);
  assert.ok(m, 'the workflow has no `on:` block');
  assert.ok(m[1].includes('workflow_dispatch'), 'publishing must be startable by a human');
  for (const auto of ['push:', 'pull_request:', 'schedule:']) {
    assert.ok(!m[1].includes(auto),
      `\`${auto}\` triggers the publish workflow — a merge, a PR or a clock must never publish`);
  }
});

test('the publish workflow publishes once', () => {
  const wf = publishWorkflow();
  assert.equal((wf.text.match(/^\s*(?:-\s*)?run:.*npm publish/gm) ?? []).length, 1,
    'more than one `npm publish` step');
});

test('the publish workflow asks for a node and an npm that support trusted publishing', () => {
  // npm >= 11.5.1 and Node >= 22.14.0 — npm's own floor. `package.json`'s `engines` is a
  // different number on purpose: that is the floor for RUNNING geneseed, not for publishing it.
  const wf = publishWorkflow();
  assert.match(wf.text, /registry-url:\s*['"]?https:\/\/registry\.npmjs\.org/,
    'setup-node must set `registry-url`, or npm publishes nowhere the OIDC grant is valid for');
  const m = /node-version:\s*['"]?(\d+)/.exec(wf.text);
  assert.ok(m, 'the workflow pins no node-version');
  assert.ok(Number(m[1]) >= 22, 'trusted publishing needs Node >= 22.14.0');
  assert.match(wf.text, /npm install -g npm@/,
    "the runner's bundled npm may predate 11.5.1, which is where trusted publishing landed");
});

test('the publish workflow names the package it publishes', () => {
  const { name } = readJson('package.json');
  assert.ok(publishWorkflow().text.includes(name),
    `the workflow never names '${name}' — the trusted-publisher instructions in it must name `
    + 'the package they configure');
});

test('the publish workflow is tab free', () => {
  // Not a YAML parse — the harness is stdlib-only — but a tab is the one character that makes a
  // YAML file fail to parse for a reason nobody sees in a diff.
  const wf = publishWorkflow();
  wf.text.split('\n').forEach((line, i) => {
    assert.ok(!line.includes('\t'), `${wf.name}:${i + 1} contains a tab`);
  });
});

// ---------------------------------------------------------------------------------------------
// THE COUNT GATE READS TAP, SO THE REPORTER MUST BE PINNED TO TAP
//
// Both workflows gate on the discovered test COUNT rather than the exit code, and they read it
// with `awk '/^# tests /'`. `# tests` is TAP's spelling. Node's DEFAULT reporter is not a
// constant across majors — 22 emits TAP into a pipe, 24 emits `spec` (`ℹ tests N`) into the same
// pipe — so an unpinned `node --test` makes the gate's premise depend on whichever major the
// runner brings. It failed exactly that way: a 1043-test suite with `fail 0` reported `0 tests`
// to publish.yml's awk (Node 24) while ci.yml (Node 24 for actions, 22 for the job) stayed green,
// and the publish died at the last gate before the tarball.
//
// DISCOVERED, NOT NAMED, for the reason `publishWorkflow` is: naming the two files would pass
// happily on a third that copied the gate without the flag.

test('every workflow that count-gates `node --test` pins the TAP reporter', () => {
  const dir = path.join(ROOT, '.github', 'workflows');
  const gated = readdirSync(dir).filter((n) => n.endsWith('.yml'))
    .map((n) => [n, readFileSync(path.join(dir, n), 'utf8')])
    .filter(([, text]) => /awk '\/\^# tests \//.test(text));
  // The control on the loop below: it is equally satisfied by a discovery that found nothing,
  // and "the gate moved and this test went quiet" is the failure it must not have.
  assert.ok(gated.length >= 2,
    `expected the count gate in at least ci.yml and publish.yml, found ${gated.map(([n]) => n)}`);
  for (const [name, text] of gated) {
    for (const [i, line] of text.split('\n').entries()) {
      // COMMENTS ARE SKIPPED, and the skip is why this is a line scan rather than a
      // whole-file `includes`: both files EXPLAIN the gate in prose that quotes a bare
      // `node --test`, and a file-wide match would be satisfied by the prose while the
      // `run:` line went unpinned — the exact inversion of what is being gated.
      if (/^\s*#/.test(line)) continue;
      if (!/node --test/.test(line)) continue;
      assert.match(line, /--test-reporter=tap/,
        `${name}:${i + 1} runs \`node --test\` without --test-reporter=tap, but the file gates `
        + 'on `# tests` — the count reads 0 on any Node whose default reporter is not TAP');
    }
  }
});

// ---------------------------------------------------------------------------------------------
// THE ARGV `migrate` TELLS YOU TO PASTE INTO A LOGIN ITEM

// ⚠ ONE SOURCE NOW, NOT TWO. The reference's `test_both_implementations_advise_the_same_argv`
// compared `rituals/_harness_build.py`'s string against `js/maintain/migrate.mjs`'s; that comparison dies
// with the file. What it was protecting — that the advice is a REAL invocation — is what the
// three tests below derive, and they never needed the second copy.
const ADVICE_RE = /update it by hand to run: (.+?)(?:\\n)?['"]/g;

function advice() {
  const found = [...read('js', 'maintain', 'migrate.mjs').matchAll(ADVICE_RE)].map((m) => m[1].trim());
  assert.equal(found.length, 1,
    `js/maintain/migrate.mjs should carry exactly one 'update it by hand to run:' advice, found `
    + `${found.length} — a scrape that matches nothing must fail here, not pass silently`);
  return found[0];
}

test('the migrate advice names a launcher this package installs', () => {
  // The table's `prog` is `harness`; the launcher name is the npm `bin` key, so that is where it
  // is derived from.
  const bins = Object.keys(readJson('package.json').bin);
  const token = advice().split(/\s+/)[0];
  assert.ok(bins.includes(token),
    `js/maintain/migrate.mjs advises running '${token}', which is not one of the commands this package `
    + `installs (${bins.sort()})`);
});

test('the migrate advice names a real web action', () => {
  // THE REGRESSION ITSELF: it shipped advising `geneseed web --no-browser`, which names NO
  // action, so it falls through to the foreground `serve()` — a path that writes no daemon
  // record, so `web stop`/`restart`/`status` cannot see the server the user was told to launch
  // at every login, and a later `web start` orphans a second one on a taken port.
  //
  // NOT A LITERAL CHECK OF THE CORRECTED SENTENCE: that only re-transcribes the bug's shape and
  // says yes to the next wrong one just as readily. What a valid invocation IS gets derived.
  const commands = Object.fromEntries(
    readJson('js', 'cli-table.json').commands.map((c) => [c.name, c]));
  assert.ok(Object.keys(commands).length > 20, 'js/cli-table.json parsed to almost nothing');
  const tokens = advice().split(/\s+/).slice(1);
  const [verb, ...rest] = tokens;
  assert.ok(verb in commands, `the advice names the verb '${verb}', which the table does not declare`);
  const cmd = commands[verb];
  const known = new Set(cmd.options.flatMap((o) => o.names));
  for (const flag of rest.filter((t) => t.startsWith('-'))) {
    assert.ok(known.has(flag), `the advice names '${flag}', which is not an option of \`${verb}\``);
  }
  const choices = cmd.positionals.filter((p) => p.choices).map((p) => p.choices);
  assert.equal(choices.length, 1,
    `\`${verb}\` no longer has exactly one positional with choices — re-aim this gate, do not `
    + 'delete it');
  const positional = rest.filter((t) => !t.startsWith('-'));
  assert.equal(positional.length, 1,
    `the advice names ${positional.length} action(s), ${positional} — an autostart entry must `
    + `name one of ${choices[0]}, or it runs the foreground path that writes no daemon record`);
  assert.ok(choices[0].includes(positional[0]),
    `the advice names the action '${positional[0]}', which \`${verb}\` does not offer`);
});

test('the advised action is the one that daemonises', () => {
  // Naming AN action is not enough — `web stop --no-browser` would satisfy the grammar. The
  // branch the advice reaches must be the one that spawns the detached, record-writing daemon,
  // and that is read out of `cmdWeb`'s own dispatch.
  const src = read('js', 'web', 'server.mjs');
  const at = src.indexOf('export async function cmdWeb(args) {');
  assert.notEqual(at, -1, 'js/web/server.mjs has no cmdWeb');
  const body = src.slice(at, at + src.slice(at).indexOf('\n}\n'));
  const dispatch = Object.fromEntries(
    [...body.matchAll(/args\.action === '(\w+)'\)\s*return\s+(\w+)\(/g)].map((m) => [m[1], m[2]]));
  assert.ok(Object.keys(dispatch).length >= 4,
    `cmdWeb's dispatch scrape found ${Object.keys(dispatch).length} branches`);
  const action = advice().split(/\s+/).slice(2).filter((t) => !t.startsWith('-'))[0];
  assert.ok(action in dispatch,
    `cmdWeb has no \`action === '${action}'\` branch — the advice reaches the fallthrough, `
    + 'which is `serve()` in the foreground');
  assert.match(dispatch[action], /^start/,
    `the advice names \`web ${action}\`, whose branch calls ${dispatch[action]} — which does not `
    + 'start the daemon that writes the record `web stop` reads');
});

// ---------------------------------------------------------------------------------------------
// THE CHECK THE PYTHON SUITE COULD NOT HAVE — and the reason this file lands before P5's edits

test('every fenced geneseed command in the docs is one the CLI table declares', () => {
  // NEW IN P3, and the finish plan asks for it by name: a doc that tells the reader to run a
  // verb or a flag that does not exist is a doc that fails on their machine and nowhere else.
  // The reference could not have this — its parser was argparse, and enumerating a subparser's
  // options meant introspecting the live object. The table is a document now, so this is a
  // lookup.
  const commands = Object.fromEntries(
    readJson('js', 'cli-table.json').commands.map((c) => [c.name, c]));

  // ⚠ ONE VERB THE ENTRY ANSWERS IS DELIBERATELY NOT IN THE TABLE, and the first draft of this
  // gate reported SETUP.md for it. `validate` is `build.py --validate-only`: a GENERATOR flag,
  // so `harness.py` never had a `validate` subcommand for the table to describe. The docs are
  // right and the gate was wrong.
  //
  // NAMED AS AN EXCEPTION RATHER THAN WAVED THROUGH: the extras are derived from the entry's own
  // `verb === '…'` comparisons and asserted to be exactly this one, so a SECOND undeclared verb
  // fails here instead of quietly widening the hole. Its flags cannot be checked — there is no
  // row to check them against — and that is the cost of the exception, stated.
  const entrySrc = read('bin', 'geneseed-cli.mjs');
  const inline = [...new Set([...entrySrc.matchAll(/verb === '([a-z][a-z-]*)'/g)]
    .map((m) => m[1]))].filter((v) => !(v in commands)).sort();
  assert.deepEqual(inline, ['validate'],
    `the entry answers ${inline} outside js/cli-table.json. Only \`validate\` is allowed to be `
    + 'there — it is a generator flag with no subparser — and anything else is a verb whose '
    + 'flags no document check can reach');

  const docs = ['README.md', 'SETUP.md', 'QUICKSTART.md', 'SHIPPED.md'];
  let checked = 0;
  const bad = [];
  for (const doc of docs) {
    if (!existsSync(path.join(ROOT, doc))) continue;
    const text = read(doc);
    for (const m of text.matchAll(/^\s*(?:\$\s*)?geneseed\s+([a-z][a-z-]*)([^\n`]*)/gm)) {
      const [, verb, rest] = m;
      checked += 1;
      if (inline.includes(verb)) continue;            // the declared exception, flags unchecked
      if (!(verb in commands)) { bad.push(`${doc}: \`geneseed ${verb}\` is not a verb`); continue; }
      const known = new Set(commands[verb].options.flatMap((o) => o.names));
      for (const flag of (rest.match(/(?:^|\s)(--?[a-z][\w-]*)/g) ?? []).map((s) => s.trim())) {
        if (flag === '--help' || flag === '-h') continue;   // held at the parser, not in the table
        if (!known.has(flag)) bad.push(`${doc}: \`geneseed ${verb} ${flag}\` — no such option`);
      }
    }
  }
  assert.ok(checked > 5,
    `only ${checked} \`geneseed …\` commands were found in the docs, so this scan is thin`);
  assert.deepEqual(bad, [], `the docs name commands the CLI table does not declare:\n  ${
    bad.join('\n  ')}`);
});
