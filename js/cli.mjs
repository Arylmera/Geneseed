/**
 * `cli.json` — the harness parser's metadata, and the one place either implementation
 * describes the CLI.
 *
 * WHY THIS FILE EXISTS. `rituals/harness.py`'s `build_argparser()` is 24 subparsers (25
 * invocable names — `update` aliases `upgrade`) and 43 `add_argument` calls. Node cannot
 * introspect argparse, and P6d deferred the console's `cli` docs page for exactly that
 * reason: a Node twin could only be a hand-written copy of the whole CLI surface, describing
 * verbs `bin/geneseed-cli.mjs` cannot even run. This port's standing rule is that a copy of a
 * value under test stops being the value under test, and that would have been the largest
 * copy in it.
 *
 * P10c's answer is that the metadata becomes DATA. `tests/gen_cli_reference.py` walks the
 * parser and writes `cli.json`; this module reads it, and it has THREE readers, which is the
 * point:
 *
 *   * `cliReference()` — `js/web/docs.mjs`'s `cli` kind, the page P6d deferred;
 *   * `cliSpec()` — `bin/geneseed-cli.mjs`'s argument parser. That table used to carry its
 *     OWN hand-written transcription of the same 43 calls, gated against the subparsers by
 *     name only, and P10c's brief was explicit that a data file which did not subsume it
 *     would make THREE transcriptions of one parser. So `VERBS` is now `{ fn }` per row and
 *     everything argparse-shaped is derived here;
 *   * `cliReferenceProblems()` — doctor's drift check, on BOTH binaries.
 *
 * THE DRIFT CHECK IS A DIGEST AND NOT A REGENERATE-AND-COMPARE, deliberately. Python could
 * regenerate and compare; Node cannot, and `tests/harness_golden.py` compares the two doctors
 * byte for byte — so a check only one of them performs is a check the other passes SILENTLY,
 * which is P4e's fifth coverage hole wearing a partition as a disguise. Hashing one file is
 * something both do equally well, so the fault that matters (the parser moved and nobody
 * regenerated) reddens BOTH binaries with the same sentence. The residue a digest cannot see
 * — a hand-edited `cli.json` whose digest still matches — belongs to
 * `tests/test_cli_reference.py`, where being Python-only costs nothing.
 *
 * THE COST, NAMED: this entry cannot parse anything without `cli.json`. It is tracked, it is
 * in `package.json`'s `files`, and an absent one is a refusal that names itself rather than a
 * wrong parse. `js/checkout.mjs` already reads `harness.config.json` at import for every
 * render, so a tracked data document the code needs is not a new shape here — and this is not
 * the hook entry, whose latency budget is `bin/geneseed-hook.mjs`'s and is untouched.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ROOT } from './checkout.mjs';

const CLI_JSON = path.join(ROOT, 'cli.json');
const HARNESS_PY = path.join(ROOT, 'rituals', 'harness.py');

/** The keys the docs page has always carried, per argument — `type` and `hidden` are ours. */
const PAGE_ARG_KEYS = ['names', 'dest', 'metavar', 'help', 'choices', 'default',
  'required', 'nargs', 'is_flag'];

/**
 * `cli.json`, parsed. An unreadable file is the empty reference; doctor reports it.
 *
 * NOT MEMOISED, and the first draft was. `harness.load_cli_reference` re-reads the file on
 * every call, so a cache here would make a regenerated `cli.json` visible to the reference's
 * running daemon and invisible to this one until it restarted — a divergence no cell can
 * reach (nothing regenerates mid-run) and no reviewer would look for. 23 kB per request is
 * not a cost worth buying that with.
 */
function load() {
  try {
    return JSON.parse(readFileSync(CLI_JSON, 'utf-8'));
  } catch {
    return { prog: 'harness', commands: [] };
  }
}

/**
 * `harness.cli_source_digest` — sha256 of the parser's own file, NEWLINE-NORMALISED.
 *
 * `.gitattributes` asks for `eol=lf` and this very directory has CRLF files on disk anyway —
 * an attribute governs a checkout, not a working tree that predates it. A digest sensitive to
 * the line ending would report drift on a machine that has none.
 */
export function cliSourceDigest(file = HARNESS_PY) {
  // `readFileSync(…, 'utf-8')` + `update(…, 'utf-8')` round-trips the bytes for any valid
  // UTF-8 document, BOM included, so this is `read_bytes()` with a newline replace on it.
  //
  // `file` is the reference's `path=` argument and exists for the same reason: with
  // `rituals/harness.py` LF in this working tree, a twin that dropped the `replaceAll` would
  // agree with the reference on every input either of them has. The corpus in
  // `tests/test_cli_reference.py` is what reaches it.
  return createHash('sha256')
    .update(readFileSync(file, 'utf-8').replaceAll('\r\n', '\n'), 'utf-8')
    .digest('hex');
}

/**
 * `harness._cli_reference_problems` — doctor's `cli` check, word for word with the reference.
 */
export function cliReferenceProblems() {
  let data;
  try {
    data = JSON.parse(readFileSync(CLI_JSON, 'utf-8'));
  } catch {
    return ['[cli] cli.json is missing or unreadable — regenerate it from a checkout '
      + 'with `python tests/gen_cli_reference.py`'];
  }
  if (data.source_sha256 !== cliSourceDigest()) {
    return ['[cli] cli.json is stale: rituals/harness.py has changed since it was '
      + 'generated — regenerate it from a checkout with '
      + '`python tests/gen_cli_reference.py`'];
  }
  return [];
}

const pageArgs = (args) => (args ?? [])
  .filter((a) => !a.hidden)
  .map((a) => Object.fromEntries(PAGE_ARG_KEYS.map((k) => [k, a[k] ?? null])));

/**
 * `harness.load_cli_reference` — the file as the docs PAGE consumes it.
 *
 * The page is a VIEW of the file, not the other way round: `cliSpec` below needs the
 * arguments argparse hides and the page must not show them, so the file carries everything
 * and each reader filters. `??  null` reproduces `dict.get(k)` for a key a future generator
 * stops writing — `undefined` would vanish from `JSON.stringify` and change the wire shape.
 */
export function cliReference() {
  const data = load();
  return {
    prog: data.prog ?? 'harness',
    commands: (data.commands ?? []).map((c) => ({
      name: c.name ?? '',
      help: c.help ?? '',
      description: c.description ?? '',
      positionals: pageArgs(c.positionals),
      options: pageArgs(c.options),
    })),
  };
}

/** argparse's `dest` is snake_case; every JS name in this port is camelCase. */
const camel = (dest) => dest.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());

/**
 * One subcommand's argparse surface, in the shape `bin/geneseed-cli.mjs`'s `parse` consumes.
 *
 * EVERY ROW OF THIS MAPPING WAS A HAND-WRITTEN COMMENT IN THAT FILE'S `VERBS` TABLE, and each
 * one names a failure it prevents:
 *
 *   * a positional with `nargs="?"` is OPTIONAL — `link [dir]`, `upgrade [ref] [theme]`;
 *   * a positional with `nargs="*"` is the trailing SINK (`bootstrap extra`), and `parse`
 *     keeps it from absorbing options, which is what stops `bootstrap --no-setpu` from
 *     running a full update-and-wizard while the user believes they asked for neither;
 *   * `store_true` is `nargs === '0'` and takes no value, so `--global=x` is an error;
 *   * an OPTION with `nargs="?"` is argparse's `const=True` — bare `diff --out` means "the
 *     default timestamped path" and `--out FILE` means the string. A plain option would
 *     refuse the bare form; a flag would drop the filename;
 *   * `type=int` refuses `--port abc` instead of silently binding 4747;
 *   * a mutually exclusive group refuses `--solid-only --transparent-only`, in the order the
 *     group declares them, which is the order the message names them in.
 *
 * `null` for a verb the file does not describe — the caller turns that into a refusal rather
 * than a parse with no rules, because a spec of `{}` would accept anything and bind nothing.
 */
export function cliSpec(verb) {
  const cmd = (load().commands ?? []).find((c) => c.name === verb);
  if (cmd === undefined) return null;
  const spec = { positionals: [] };
  for (const a of cmd.positionals ?? []) {
    if (a.nargs === '*') { spec.variadic = a.dest; continue; }
    const p = { name: a.dest };
    if (a.nargs === '?') p.optional = true;
    if (a.choices) p.choices = a.choices;
    spec.positionals.push(p);
  }
  for (const a of cmd.options ?? []) {
    const dest = camel(a.dest);
    // eslint-disable-next-line no-nested-ternary
    const table = a.is_flag ? 'flags' : (a.nargs === '?' ? 'optValue' : 'options');
    for (const name of a.names ?? []) {
      (spec[table] ??= {})[name] = dest;
      if (a.type === 'int') (spec.ints ??= []).push(name);
    }
  }
  if ((cmd.mutex ?? []).length) spec.mutex = cmd.mutex;
  return spec;
}
