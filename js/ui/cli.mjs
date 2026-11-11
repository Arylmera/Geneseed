/**
 * `js/cli-table.json` — the CLI as data, and the one place either implementation describes it.
 *
 * WHY THIS FILE EXISTS. The CLI surface is 26 invocable names (`update` aliases `upgrade`),
 * and a hand-written copy of it for the console's `cli` docs page would describe verbs
 * `bin/geneseed-cli.mjs` cannot even run. A copy of a value under test stops being the value
 * under test, and that would have been the largest copy in the tree.
 *
 * So the metadata is DATA: the table is the OWNED document, and it lives here on a product
 * path because that is where a document npm ships belongs. `package.json`'s `files[]` already
 * carries `js/`, so it needs no row of its own, and nothing has to import out of `tests/`.
 *
 * ITS READERS, and each one takes a different view of the same rows:
 *
 *   * `cliReference()` — `js/web/docs.mjs`'s `cli` kind. STRIPS the
 *     hidden arguments and the two fields the page never carried;
 *   * `cliSpec()` — `bin/geneseed-cli.mjs`'s argument parser. `VERBS` is `{ fn }` per row
 *     and everything argparse-shaped is derived here. KEEPS the hidden arguments, `--port`'s int type and
 *     `theme`'s mutex group, none of which the page may show;
 *   * `cliCommand()`/`printHelp()` — `--help` on BOTH entry points, so the table owes a row to
 *     every verb `bin/geneseed-hook.mjs` dispatches as well, not only to the CLI entry's.
 *
 * THE STORED SHAPE IS THE UNION AND MUST STAY ONE. Neither reader's shape can be the file's:
 * a file filtered for the page breaks the CLI, and a file in `cliSpec`'s shape cannot render
 * the docs.
 *
 * WHAT GUARDS IT. The table is the source of truth and is edited directly.
 * `tests/unit/cli_table.test.mjs` checks the WHOLE table.
 *
 * THE COST, NAMED: this entry cannot parse anything without this file. `js/build/source.mjs`
 * already reads `harness.config.json` at import for every render, so a tracked data document
 * the code needs is not a new shape here — and this is not the hook entry, whose latency
 * budget is `bin/geneseed-hook.mjs`'s and is untouched.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { choicesFor } from '../build/args.mjs';
import { ROOT } from '../build/source.mjs';
import { printOut } from '../lib/fs.mjs';
import { parseIntStrict, stripWhitespace } from '../lib/text.mjs';

const CLI_JSON = path.join(ROOT, 'js', 'cli-table.json');

/** The keys the docs page has always carried, per argument — `type` and `hidden` are ours. */
const PAGE_ARG_KEYS = ['names', 'dest', 'metavar', 'help', 'choices', 'default',
  'required', 'nargs', 'is_flag'];

/**
 * `js/cli-table.json`, parsed. An unreadable file is the empty reference; the entry points
 * turn that into a refusal that names itself rather than a parse with no rules.
 *
 * NOT MEMOISED: a cache here would leave a running daemon showing the table it started with
 * after the file was edited, a divergence no cell can reach and no reviewer would look for.
 * One re-read of a file this size is not a cost worth buying that with.
 */
function load() {
  let data;
  try {
    data = JSON.parse(readFileSync(CLI_JSON, 'utf-8'));
  } catch {
    return { prog: 'geneseed', commands: [] };
  }
  // `build` forwards the generator's flags, and the generator owns their choice lists — two of
  // them (`--posture`, `--mode`) are discovered from the checkout. So the table carries no copy:
  // the choices are laid over its rows here, from `choicesFor`, the list the generator refuses by.
  const build = (data.commands ?? []).find((c) => c.name === 'build');
  if (build) {
    const choices = choicesFor();
    for (const o of build.options ?? []) {
      const list = choices[o.names?.[0]];
      if (!list) continue;
      o.choices = list;
      // A row with its own metavar (`--emit`: nine names do not fit a usage line) names the
      // list in its help instead of in `{…}`.
      if (o.metavar) o.help = `${o.help} (one of: ${list.join(', ')})`;
    }
  }
  return data;
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
    prog: data.prog ?? 'geneseed',
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
 * `-h/--help`, which the table does NOT carry.
 *
 * argparse adds it at parser construction, so it
 * is absent from every command in the file and present in every help text.
 * It is a row here rather than special-cased in the renderer, because it is
 * first in the options section and first in the usage line for every verb the table carries —
 * a position it only gets by being an action like the others.
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

// `textwrap`'s `wordsep_re`, which is what makes `wrapText` below a port rather than a guess.
//
// A GREEDY SPACE-ONLY WRAP WAS THE FIRST DRAFT AND THE GATE REFUSED IT. `textwrap` splits a
// hyphenated word into two chunks, so it can break a line inside `back-compat` where a
// space-only wrap cannot. Measured before deciding: every help string then in the table disagreed
// with a greedy wrap at some width, the widest at 175 — so "the branch is dead" was simply
// false. The rules are transcribed instead.
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
 * ponytail: lives here rather than in `js/lib/` because `formatHelp` is its only consumer;
 * move it when a second one appears, not before.
 */
export function wrapText(text, width) {
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
    const lines = wrapText(collapsed, Math.max(width - helpPosition, 11));
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
 * `prog` IS AN ARGUMENT: a user who typed `geneseed status --help` is shown
 * `usage: geneseed status`, which is also how every error this entry prints already spells
 * itself (`die`). The layout is pinned by the written-out `formatHelp` rows in
 * `tests/unit/text_layout.test.mjs`.
 *
 * `catalog`, `mcp` and `memory` have no subparser to render from, so they are held
 * ABSOLUTELY instead — and `tests/unit/hook_cli.test.mjs`'s `NATIVE` list names that
 * population and fails a verb that falls into neither, which is what keeps "no recorded
 * text" from meaning "no gate".
 *
 * The alias rides on the same argument: the shipped call passes `geneseed update`, which is
 * what the user typed.
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
    //
    // ONE PART PER MEMBER, NOT ONE PER GROUP, and that distinction is the whole of a real
    // divergence this port shipped. `_get_actions_usage_parts` decorates the members IN PLACE:
    // the first gets the opening bracket, every part but the last gains a trailing ` |`, the
    // last gains the closing bracket — and it returns them as SEPARATE parts. `_format_usage`
    // then wraps on the part boundaries, so argparse can break the line INSIDE the group and
    // end a line with `[--solid-only |`. A single atomic `[a | b]` part cannot be broken at
    // all, so the two layouts diverge at every width where the group straddles the wrap
    // column: measured on `theme`, 73 of the 181 widths in COLUMNS 20..200, and 64 of those in
    // the arm the fixtures exercise. COLUMNS=80 — the one width the 26 recorded fixtures are
    // rendered at — is not one of them, which is why nothing saw it.
    if (done.has(group)) continue;
    done.add(group);
    const members = group.map((f) => usagePart(options.find((o) => o.names.includes(f)), false));
    members[0] = `[${members[0]}`;
    members[members.length - 1] += ']';
    for (let i = 0; i < members.length - 1; i += 1) members[i] += ' |';
    optParts.push(...members);
  }
  const posParts = positionals.map((a) => usagePart(a, true));

  // `_action_max_length` is the widest invocation in the WHOLE parser plus the section indent,
  // and the hidden actions contribute nothing to it — `add_argument` drops a SUPPRESSed one
  // before it is measured, which is why `web`'s column is set by `{start,stop,restart,status}`
  // and not by `--daemon-internal`.
  const invocations = [...positionals.map((a) => actionInvocation(a, true)),
    ...options.map((a) => actionInvocation(a, false))];
  // `_max_help_position` IS ITSELF A FUNCTION OF THE WIDTH, which the port had baked as the
  // constant 24: `HelpFormatter.__init__` is
  // `min(max_help_position, max(width - 20, indent_increment * 2))`, so the two-column layout
  // collapses to a 4-column indent on a narrow terminal and every action's help moves to its
  // own line. Equal to 24 for every width from 44 up, which is why the fixtures at width 78
  // could not see it and why only a width SWEEP could.
  const maxHelpPosition = Math.min(24, Math.max(width - 20, 2 * 2));
  const helpPosition = Math.min(Math.max(...invocations.map((s) => s.length)) + 2 + 2,
    maxHelpPosition);

  const blocks = [`${formatUsage(prog, optParts, posParts, width)}\n`];
  // argparse's `description`, wrapped to the full width after the usage line. It is where a
  // verb's paragraph lives, so the top-level listing can keep each verb to one short line.
  if (cmd.description && cmd.description.trim()) {
    const collapsed = cmd.description.replace(/[ \t\n\v\f\r]+/g, ' ').trim();
    blocks.push(`${wrapText(collapsed, Math.max(width, 11)).join('\n')}\n`);
  }
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
 *
 * `parseIntStrict`, NOT `Number.parseInt`, and the tree already owned it. `get_terminal_size`
 * parses `$COLUMNS` with `int()`, and `int` is not `parseInt` (`tests/unit/cli_table.test.mjs`'s
 * 'the help width is the terminal width less two, and COLUMNS wins' keeps a written-out part
 * of the corpus): `COLUMNS=1_0` is 10 to `int` and 1 to `parseInt`, `COLUMNS=٣` is 3 and
 * NaN, `COLUMNS=' 80 '` is 80 and NaN. `COLUMNS=80abc` is a ValueError to `int` and 80 to
 * `parseInt` — the same answer down a PIPE, where the fallback is 80 either way, and a
 * different one on any terminal that is not 80 wide, which is why a unit test is the gate
 * rather than a cell. A non-positive value falls through on both sides.
 *
 * `stripWhitespace` because THIS is the caller `parseIntStrict`'s docblock did not have: its other two
 * strip before calling, and `$COLUMNS` arrives however the shell set it — `int(' 80 ')` is 80.
 */
export function helpWidth() {
  const env = parseIntStrict(stripWhitespace(process.env.COLUMNS ?? ''));
  if (env !== null && env > 0) return env - 2;
  return (process.stdout.columns > 0 ? process.stdout.columns : 80) - 2;
}

/** One command's raw row — everything the table knows, unlike the page's filtered view. */
export function cliCommand(verb) {
  return (load().commands ?? []).find((c) => c.name === verb) ?? null;
}

/**
 * `geneseed --help` — every verb with its one-line help, from the same table the per-verb help
 * reads. `verbs` is the entry's own dispatch list, so the listing can name nothing the entry
 * would refuse; a verb the table does not describe still appears, with no help line.
 */
export function printVerbList(prog, verbs, extra = {}) {
  const helpOf = new Map([...Object.entries(extra),
    ...cliReference().commands.filter((c) => c.help).map((c) => [c.name, c.help])]);
  const names = [...verbs].sort();
  const pad = Math.max(...names.map((n) => n.length)) + 2;
  const lines = [`usage: ${prog} <command> [options]`, '',
    `A bare \`${prog}\` runs \`home\`. \`${prog} <command> --help\` describes one command.`, '',
    'commands:'];
  for (const n of names) lines.push(`  ${n.padEnd(pad)}${helpOf.get(n) || ''}`.trimEnd());
  printOut(`${lines.join('\n')}\n`);
  return 0;
}

/**
 * `<verb> --help` for whichever binary asked, or `null` for a verb the table does not
 * describe — the caller already owns that refusal and its message.
 *
 * ONE OWNER FOR TWO ENTRIES. `bin/geneseed-hook.mjs` carries the four hook verbs and
 * `bin/geneseed-cli.mjs` the rest of the table, and `tests/unit/hook_cli.test.mjs`'s
 * "the two entry points carry disjoint verb sets" keeps them from learning each other's
 * tables — so the help each prints has to come from here rather than from a copy in each.
 *
 * CRLF ON WINDOWS through `printOut`, the one funnel every CLI print takes.
 */
export function printHelp(prog, verb) {
  const cmd = cliCommand(verb);
  if (cmd === null) return null;
  printOut(formatHelp(cmd, `${prog} ${verb}`, helpWidth()));
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
 *   * a positional with `nargs="?"` is OPTIONAL — `link [dir]`, `upgrade [theme]`;
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
     
    const table = a.is_flag ? 'flags' : (a.nargs === '?' ? 'optValue' : 'options');
    for (const name of a.names ?? []) {
      (spec[table] ??= {})[name] = dest;
      if (a.type === 'int') (spec.ints ??= []).push(name);
    }
  }
  if ((cmd.mutex ?? []).length) spec.mutex = cmd.mutex;
  return spec;
}
