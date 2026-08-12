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
  // The digest reads a SECOND file, and the migration that deletes it must leave doctor
  // able to say so. An unreadable parser source is the same class of fault as an
  // unreadable cli.json: a report, never a throw.
  let digest;
  try {
    digest = cliSourceDigest();
  } catch {
    return ['[cli] rituals/harness.py is missing or unreadable — cli.json cannot be '
      + 'checked for staleness'];
  }
  if (data.source_sha256 !== digest) {
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

/**
 * `-h/--help`, which `cli.json` does NOT carry.
 *
 * argparse adds it at parser construction, before any `add_argument` the walk can see, so it
 * is absent from every command in the file and present in every help text the reference
 * prints. Reproduced here as a row rather than special-cased in the renderer, because it is
 * first in the options section and first in the usage line for all 26 verbs — a position it
 * only gets by being an action like the others.
 */
const HELP_ACTION = {
  names: ['-h', '--help'],
  dest: 'help',
  metavar: null,
  help: 'show this help message and exit',
  choices: null,
  required: false,
  nargs: '0',
  is_flag: true,
  hidden: false,
};

/** argparse's `_metavar_formatter`: an explicit metavar, else the choices, else the default. */
function metavarFor(a, positional) {
  if (a.metavar !== null && a.metavar !== undefined) return a.metavar;
  if (a.choices) return `{${a.choices.join(',')}}`;
  return positional ? a.dest : a.dest.toUpperCase();
}

/** argparse's `_format_args`, for the three `nargs` spellings this parser uses. */
function formatArgs(a, positional) {
  const mv = metavarFor(a, positional);
  if (a.nargs === '0') return '';
  if (a.nargs === '?') return `[${mv}]`;
  if (a.nargs === '*') return `[${mv} ...]`;
  return mv;
}

/** The usage-line spelling of one action, WITHOUT the `[…]` an optional gets around it. */
function usagePart(a, positional) {
  if (positional) return formatArgs(a, true);
  const args = formatArgs(a, false);
  return args ? `${a.names[0]} ${args}` : a.names[0];
}

/** argparse's `_format_action_invocation` — the left column of the two-column body. */
function actionInvocation(a, positional) {
  if (positional) return metavarFor(a, true);
  const args = formatArgs(a, false);
  return args ? `${a.names.join(', ')} ${args}` : a.names.join(', ');
}

// `textwrap`'s `wordsep_re`, which is what makes `pyTextWrap` below a port rather than a guess.
//
// A GREEDY SPACE-ONLY WRAP WAS THE FIRST DRAFT AND THE GATE REFUSED IT. `textwrap` splits a
// hyphenated word into two chunks, so it can break a line inside `back-compat` where a
// space-only wrap cannot. Measured before deciding: all 38 help strings in `cli.json` disagree
// with a greedy wrap at some width, the widest being 175 — so "the branch is dead" was simply
// false, and `test_the_ports_line_breaker_is_textwrap_at_every_width` said so on the run that
// first asserted it. The rules are transcribed instead.
//
// Python's classes, spelled for a `u`-flagged JavaScript regex: `\w` is letters, numbers and
// underscore; `[^\d\W]` is that minus the DECIMAL digits, which leaves the letter-ish half
// (`\p{Nl}`/`\p{No}` are `\w` and not `\d` in Python, so they stay). `\s` is the one class left
// spelled as itself, and the two languages differ on U+FEFF — Python excludes it, JavaScript
// does not. The gate sweeps the real help strings at every width rather than assuming that
// stays unreachable.
const WD = '[\\p{L}\\p{N}_]';
const LT = '[\\p{L}\\p{Nl}\\p{No}_]';
const WP = '[\\p{L}\\p{N}_!"\'&.,?]';
const WORDSEP = new RegExp(
  '(\\s+'                                              // any whitespace
  + `|(?<=${WP})-{2,}(?=${WD})`                        // em-dash between words
  + '|\\S+?(?:'                                        // word, possibly hyphenated
  + `-(?:(?<=${LT}{2}-)|(?<=${LT}-${LT}-))(?=${LT}-?${LT})`
  + '|(?=\\s|$)'
  + `|(?<=${WP})(?=-{2,}${WD})))`, 'u');

/**
 * `textwrap.wrap(text, width)` for the settings argparse's `_split_lines` uses: no indent,
 * `drop_whitespace`, `break_long_words` and `break_on_hyphens` all on, and the text already
 * whitespace-collapsed and stripped by the caller.
 *
 * ponytail: lives here rather than in `js/lib/` because `formatHelp` is its only consumer.
 * `rituals/_harness_tui*.py` calls `textwrap.wrap` in seven places and is declared unported;
 * move this when that changes, not before.
 */
export function pyTextWrap(text, width) {
  const chunks = text.split(WORDSEP).filter(Boolean).reverse();
  const blank = (s) => s.trim() === '';
  const lines = [];
  while (chunks.length) {
    const line = [];
    let len = 0;
    if (blank(chunks[chunks.length - 1]) && lines.length) chunks.pop();
    while (chunks.length && len + chunks[chunks.length - 1].length <= width) {
      len += chunks[chunks.length - 1].length;
      line.push(chunks.pop());
    }
    // `_handle_long_word`: a chunk too wide for any line is cut to what is left of this one —
    // after the last hyphen inside that room, if there is one with something before it.
    //
    // `room > 0` IS CPython's gh-139065 fix — `if self.break_long_words and space_left > 0:`,
    // landed on main as 1c598e0 and cherry-picked to 3.13 as b1bc743, first shipped in 3.13.14.
    // Without it a line already exactly `width` long gets `chunk.slice(0, 0)` — an EMPTY string
    // — appended, and that empty chunk then absorbs the single trailing-whitespace `pop` below,
    // so the real whitespace chunk survives and the line keeps a trailing space. This machine's
    // 3.13.5 predates the fix, so the sweep gate agreed with the unguarded port here and
    // disagreed on CI's 3.13.14. `room <= 0` needs no `elif not cur_line` arm: an empty line has
    // `len === 0`, so `room` is `width` (or 1 when `width < 1`) and is never <= 0 there.
    const room = width < 1 ? 1 : width - len;
    if (room > 0 && chunks.length && chunks[chunks.length - 1].length > width) {
      const chunk = chunks[chunks.length - 1];
      let end = room;
      if (chunk.length > room) {
        const hyphen = chunk.lastIndexOf('-', room - 1);
        if (hyphen > 0 && [...chunk.slice(0, hyphen)].some((c) => c !== '-')) end = hyphen + 1;
      }
      line.push(chunk.slice(0, end));
      chunks[chunks.length - 1] = chunk.slice(end);
      len = line.reduce((n, s) => n + s.length, 0);
    }
    if (line.length && blank(line[line.length - 1])) line.pop();
    if (line.length) lines.push(line.join(''));
  }
  return lines.length ? lines : [''];
}

/**
 * argparse's `_format_usage`, including the re-flow it does when the line does not fit.
 *
 * `prog` is the WHOLE program word — `harness diff`, `geneseed diff` — because that is what
 * the indent of a wrapped continuation line is computed from, which is why the divergence
 * cannot be patched into a recorded text after the fact.
 */
function formatUsage(prog, optParts, posParts, width) {
  const prefix = 'usage: ';
  const flat = [prog, [...optParts, ...posParts].join(' ')].filter(Boolean).join(' ');
  if (prefix.length + flat.length <= width) return prefix + flat;

  const getLines = (parts, indent, pre) => {
    const out = [];
    let line = [];
    let lineLen = (pre === undefined ? indent.length : pre.length) - 1;
    for (const part of parts) {
      if (lineLen + 1 + part.length > width && line.length) {
        out.push(indent + line.join(' '));
        line = [];
        lineLen = indent.length - 1;
      }
      line.push(part);
      lineLen += 1 + part.length;
    }
    if (line.length) out.push(indent + line.join(' '));
    if (pre !== undefined && out.length) out[0] = out[0].slice(indent.length);
    return out;
  };

  let lines;
  if (prefix.length + prog.length <= 0.75 * width) {
    const indent = ' '.repeat(prefix.length + prog.length + 1);
    if (optParts.length) {
      lines = getLines([prog, ...optParts], indent, prefix);
      lines.push(...getLines(posParts, indent));
    } else if (posParts.length) {
      lines = getLines([prog, ...posParts], indent, prefix);
    } else {
      lines = [prog];
    }
  } else {
    const indent = ' '.repeat(prefix.length);
    lines = getLines([...optParts, ...posParts], indent);
    if (lines.length > 1) {
      lines = [...getLines(optParts, indent), ...getLines(posParts, indent)];
    }
    lines = [prog, ...lines];
  }
  return prefix + lines.join('\n');
}

/** argparse's `_format_action` — the two-column row, and the wrapped help beside it. */
function formatAction(a, positional, helpPosition, width) {
  const actionWidth = helpPosition - 2 - 2;
  const header = actionInvocation(a, positional);
  const help = a.help ?? '';
  const parts = [];
  let indentFirst = 0;
  if (!help) {
    parts.push(`  ${header}\n`);
  } else if (header.length <= actionWidth) {
    parts.push(`  ${header.padEnd(actionWidth)}  `);
  } else {
    parts.push(`  ${header}\n`);
    indentFirst = helpPosition;
  }
  if (help && help.trim()) {
    // `_whitespace_matcher` is `re.compile(r'\s+', re.ASCII)` — the ASCII class, so a help
    // string carrying U+00A0 keeps it rather than having it collapsed to a break opportunity.
    const collapsed = help.replace(/[ \t\n\v\f\r]+/g, ' ').trim();
    const lines = pyTextWrap(collapsed, Math.max(width - helpPosition, 11));
    parts.push(`${' '.repeat(indentFirst)}${lines[0]}\n`);
    for (const line of lines.slice(1)) parts.push(`${' '.repeat(helpPosition)}${line}\n`);
  } else if (!parts[0].endsWith('\n')) {
    parts.push('\n');
  }
  return parts.join('');
}

/**
 * `parser.format_help()` for one subcommand, byte for byte with argparse.
 *
 * WHY THE PORT RENDERS THIS AT ALL. Task 10 compared the two implementations' `--help` for the
 * first time — `tests/harness_golden.py` has zero `--help` cells — and found the port answering
 * `geneseed: error: unrecognized arguments: --help`, exit 2, on all 26 verbs. That is not the
 * declared wording divergence `parse`'s docblock reserves for argparse's ERROR text: it is the
 * absence of the surface, on the binary that survives the reference's deletion.
 *
 * `prog` IS AN ARGUMENT AND THAT IS THE ONE DELIBERATE DIVERGENCE. The reference names itself
 * `harness`, after the Python file this migration deletes; a user who typed `geneseed status
 * --help` is shown `usage: geneseed status`, which is also how every error this entry prints
 * already spells itself (`die`). `tests/__snapshots__/help/` freezes the reference's answers
 * and `tests/cli_help.test.mjs` replays them through here with `prog` set to the reference's
 * own — so the layout is gated byte for byte and the rename is the only thing that moves.
 *
 * The alias rides on the same argument: argparse gives `update` the parser object it built for
 * `upgrade`, so `harness.py update --help` prints `usage: harness upgrade`. The recorded prog
 * map reproduces that; the shipped call passes `geneseed update`, which is what the user typed.
 *
 * `width` is argparse's `shutil.get_terminal_size().columns - 2`, passed in rather than read,
 * because a recorded help text whose wrap column came from the recorder's terminal is a corpus
 * that reddens on the next machine — the rot vector this branch has now found nine ways.
 */
export function formatHelp(cmd, prog, width) {
  const positionals = (cmd.positionals ?? []).filter((a) => !a.hidden);
  const options = [HELP_ACTION, ...(cmd.options ?? []).filter((a) => !a.hidden)];

  const optParts = [];
  const done = new Set();
  for (const a of options) {
    const group = (cmd.mutex ?? []).find((g) => g.includes(a.names[0]));
    if (group === undefined) {
      optParts.push(a.required ? usagePart(a, false) : `[${usagePart(a, false)}]`);
      continue;
    }
    // `add_mutually_exclusive_group()` — never required in this parser, so `[a | b]`, and the
    // members lose their own brackets to it. Emitted once, at the first member's position.
    if (done.has(group)) continue;
    done.add(group);
    optParts.push(`[${group
      .map((f) => usagePart(options.find((o) => o.names.includes(f)), false))
      .join(' | ')}]`);
  }
  const posParts = positionals.map((a) => usagePart(a, true));

  // `_action_max_length` is the widest invocation in the WHOLE parser plus the section indent,
  // and the hidden actions contribute nothing to it — `add_argument` drops a SUPPRESSed one
  // before it is measured, which is why `web`'s column is set by `{start,stop,restart,status}`
  // and not by `--daemon-internal`.
  const invocations = [...positionals.map((a) => actionInvocation(a, true)),
    ...options.map((a) => actionInvocation(a, false))];
  const helpPosition = Math.min(Math.max(...invocations.map((s) => s.length)) + 2 + 2, 24);

  const blocks = [`${formatUsage(prog, optParts, posParts, width)}\n`];
  if (positionals.length) {
    blocks.push(`positional arguments:\n${positionals
      .map((a) => formatAction(a, true, helpPosition, width)).join('')}`);
  }
  blocks.push(`options:\n${options
    .map((a) => formatAction(a, false, helpPosition, width)).join('')}`);
  // `HelpFormatter.format_help`'s last two steps: collapse a run of blank lines, then trim to
  // exactly one trailing newline.
  return `${blocks.join('\n').replace(/\n\n\n+/g, '\n\n').replace(/^\n+|\n+$/g, '')}\n`;
}

/**
 * The width argparse would use, from the same inputs: `COLUMNS` first, then the terminal, then
 * 80 — minus the two columns `HelpFormatter.__init__` subtracts. (`shutil.get_terminal_size`
 * reads `COLUMNS` before it asks the tty, and falls back to 80 when neither answers, which is
 * every pipe both implementations write help into.)
 */
function helpWidth() {
  const env = Number.parseInt(process.env.COLUMNS ?? '', 10);
  if (Number.isInteger(env) && env > 0) return env - 2;
  return (process.stdout.columns > 0 ? process.stdout.columns : 80) - 2;
}

/** One command's raw row — everything `cli.json` knows, unlike the page's filtered view. */
export function cliCommand(verb) {
  return (load().commands ?? []).find((c) => c.name === verb) ?? null;
}

/**
 * `<verb> --help` for whichever binary asked, or `null` for a verb `cli.json` does not
 * describe — the caller already owns that refusal and its message.
 *
 * ONE OWNER FOR TWO ENTRIES. `bin/geneseed-cli.mjs` carries 22 verbs and
 * `bin/geneseed-hook.mjs` the four hook verbs, and
 * `test_the_two_entry_points_carry_disjoint_verb_sets` keeps them from learning each other's
 * tables — so the help each prints has to come from here rather than from a copy in each.
 *
 * CRLF ON WINDOWS for `die`'s reason: argparse writes through a Python text stream, which
 * translates, and this text lands in the same terminals and the same pipes as that one.
 */
export function printHelp(prog, verb) {
  const cmd = cliCommand(verb);
  if (cmd === null) return null;
  const text = formatHelp(cmd, `${prog} ${verb}`, helpWidth());
  process.stdout.write(process.platform === 'win32' ? text.replaceAll('\n', '\r\n') : text);
  return 0;
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
