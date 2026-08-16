// THE GATE ON THE GATES.
//
// Everything else in this phase asks "do the two implementations agree?" or "does the port
// still produce the recorded bytes?". Neither question is the one that matters after P4. The
// one that matters is: IF THE PORT BROKE, WOULD ANYTHING GO RED?
//
// A corpus proves UNCHANGED, never CORRECT, and a replayer is itself a large piece of code that
// can be wrong in the direction of agreeing. Five fixture defects in T5 alone were found only
// because the reference was still there to disagree; after the deletion each would have been an
// unexplainable red, or worse, a silent green. So each declared mutation below is a real defect
// planted in the product, with the CHEAPEST gate that must catch it — and the run is only
// meaningful with the unmutated tree green as the control.
//
// EACH MUTATION IS A ONE-STRING EDIT, applied to a working copy of the file and reverted in a
// `finally`. That is deliberate: a mutation harness that leaves the tree dirty on a crash is a
// worse problem than the one it is testing for.
//
// THE TABLE IS A TWO-SIDED PARTITION, like `tests/ported.json`. A mutation with no gate yet is
// listed with `gate: null` and REPORTED as ungated rather than quietly omitted — a mutation
// matrix that only contains the mutations someone already had a gate for is a matrix that
// measures the gates it was drawn from.
//
// USAGE:
//   node tests/mutate.mjs --list
//   node tests/mutate.mjs --all
//   node tests/mutate.mjs --only M3
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A narrow slice of the emit corpus: enough cells to carry a manifest, a settings.json, a
// memory store and a non-ASCII theme, and few enough to run in seconds.
const EMIT = ['tests/golden.mjs', '--against', 'tests/__snapshots__/emit', '--limit', '6'];
const EMIT_IMPERIAL = ['tests/golden.mjs', '--against', 'tests/__snapshots__/emit',
  '--only', 'imperial/claude', '--limit', '3'];
const CLI_CONTEXT = ['tests/cli_golden.mjs', '--against', 'tests/__snapshots__/cli',
  '--only', 'context/'];
// The catalog listing, which is the only place in 691 cells where a COLLATION is observable.
const WEB_CATALOG = ['tests/web_golden.mjs', '--against', 'tests/__snapshots__/web',
  '--only', 'catalog/'];
// A hook-WIRING emit. The first six cells of the matrix are files/opencode/opencode-global and
// none of them writes a settings.json hook, which is why M4 survived an `--limit 6` gate.
const EMIT_CLAUDE = ['tests/golden.mjs', '--against', 'tests/__snapshots__/emit',
  '--only', 'neutral/claude'];
const IDEMPOTENT = ['tests/golden.mjs', '--idempotent', '--only', 'neutral/claude'];
// A GLOB, not a directory. `node --test tests/unit/` resolves the path as a MODULE and fails to
// load it — `# pass 0, # fail 1` with no test having run, which as a mutation control reads
// exactly like a red gate and would have made every mutant below "pass" for the wrong reason.
// The control check at the top of `main` is what caught it.
const UNIT = ['--test', 'tests/unit/*.test.mjs'];

export const MUTATIONS = [
  {
    id: 'M1',
    name: "drop writeText's os.linesep translation",
    file: 'js/lib/pyfs.mjs',
    find: "writeFileSync(path, EOL === '\\n' ? text : text.replaceAll('\\n', EOL), 'utf8');",
    replace: "writeFileSync(path, text, 'utf8');",
    gate: EMIT,
    why: 'Every emitted file on Windows would carry LF where the reference wrote CRLF. This is '
      + 'the single most platform-specific behaviour in the product and the corpus is split by '
      + 'platform precisely so it stays observable.',
  },
  {
    id: 'M2',
    name: "drop ensure_ascii from jsonDumpsIndent",
    file: 'js/lib/pyfs.mjs',
    find: 'export function jsonDumpsIndent(value, { ensureAscii = true } = {}) {\n'
      + '  const text = JSON.stringify(value, null, 2);\n'
      + '  return ensureAscii ? escapeNonAscii(text) : text;',
    replace: 'export function jsonDumpsIndent(value, { ensureAscii = true } = {}) {\n'
      + '  const text = JSON.stringify(value, null, 2);\n'
      + '  return text;',
    gate: EMIT_IMPERIAL,
    why: "Python's json encoder escapes every non-ASCII character by default and JSON.stringify "
      + 'does not. A theme whose strings carry accents writes different bytes into every '
      + 'manifest and settings file — invisible in a terminal, and a real difference on disk.',
  },
  {
    id: 'M3',
    name: "reverse comparePaths' collation",
    file: 'js/lib/pyfs.mjs',
    find: "    if (A[i] !== B[i]) return A[i] < B[i] ? -1 : 1;",
    replace: "    if (A[i] !== B[i]) return A[i] < B[i] ? 1 : -1;",
    gate: WEB_CATALOG,
    why: 'It orders the catalog listing the console serves. THIS ROW TOOK THREE AIMS AND THE '
      + 'FIRST TWO ARE THE INTERESTING PART. An emit gate could not see it: comparePaths has '
      + 'five callers and all five are in js/doctor.mjs. Then all THIRTY doctor cells could not '
      + 'see it either - doctor sorts its scans internally and reports problems, so the order '
      + 'never reaches an output anyone compares. The web catalog cells catch it at once, and '
      + 'the diff is the reason a corpus hashes rather than measures: 553 bytes against 553, '
      + 'same length, reversed order. A gate comparing sizes would be blind to it.',
  },
  {
    id: 'M4',
    name: 'drop `|| exit 0` from a non-gate hook command',
    file: 'js/settings.mjs',
    find: 'const context = `${run} context --root "${cfg}" || exit 0`;',
    replace: 'const context = `${run} context --root "${cfg}"`;',
    gate: EMIT_CLAUDE,
    why: 'A hook that fails to LAUNCH — a moved checkout, a dead interpreter — must not break '
      + "the user's tool call. The partition is the assertion: `|| exit 0` on every non-gate "
      + 'hook and on NO gate, because a crashing gate must fail closed.',
  },
  {
    id: 'M5',
    name: 'break the ownership claim so an emit overwrites a file it never owned',
    file: 'js/native.mjs',
    find: '    if (oldSet.has(rel)) return true;',
    replace: '    if (rel || true) return true;',
    gate: UNIT,
    why: "The class of bug that destroys a user's own file. IT SURVIVED A CELL GATE AND WAS "
      + "CARRIED AS UNGATED FOR A WHILE, and the reason is the design doc's own: the claim "
      + 'guard only fires when a file EXISTS at the destination and was never owned, and a '
      + 'fresh-sandbox emit never reaches that state by construction. All 691 recorded cells '
      + 'are blind to it. tests/unit/user_files.test.mjs is what closes it, by driving '
      + 'writeNativeLayer in process over a seeded pre-existing file - which is the whole '
      + 'argument for a unit tier: a corpus can only record states a cell can reach, and the '
      + 'states worth fearing most are the ones a clean fixture cannot produce.',
  },
  {
    // THE FALSIFIER'S ROW. Not invented and not planted: this is a real historical defect,
    // documented in bin/geneseed.mjs's own docblock, found by GitHub's Windows runner, and
    // REVERTED AS AN EXPERIMENT during P3 - at which point the entire Node suite stayed green
    // (68 unit tests, 12 emit cells). That is what the design doc calls a hole named by name,
    // and tests/unit/resolve_out.test.mjs is the gate written to close it.
    id: 'M12',
    name: 'let resolveOut normalise instead of canonicalise (a REAL historical defect)',
    file: 'bin/geneseed.mjs',
    find: '  return pyResolve(path.resolve(process.cwd(), raw));',
    replace: '  return path.resolve(process.cwd(), raw);',
    gate: UNIT,
    why: 'The reference ends in Path.resolve(), which CANONICALISES - 8.3 short names expanded, '
      + 'symlinks followed, the filesystem own casing - where path.resolve only normalises . '
      + 'and .. . Nine pyResolve call sites had the rule and this one did not, so the two entry '
      + 'points printed the same directory under two different names, a 70-byte difference in a '
      + 'line compared byte for byte. Invisible on a machine whose paths are already canonical, '
      + 'which is every machine this ran on until a runner handed it C:/Users/RUNNER~1/... The '
      + 'fixture that could have caught it already existed and was locked inside a test about a '
      + 'different function; it lives in tests/helpers/alias.mjs now.',
  },
  {
    id: 'M13',
    name: 'let rmtreeQuiet delete a file where shutil.rmtree refuses one',
    file: 'js/uninstall.mjs',
    find: '    if (!lstatSync(p).isDirectory()) return;\n',
    replace: '',
    gate: UNIT,
    why: 'A REAL PORT DEFECT, found by porting tests/test_web.py rather than by review. '
      + 'shutil.rmtree(p, ignore_errors=True) REFUSES anything that is not a real directory - a '
      + 'file raises NotADirectoryError, a symlink raises outright - and ignore_errors turns '
      + 'both into a no-op that leaves the thing on disk. rmSync(recursive, force) deletes all '
      + 'three without complaint, so the port destroyed what the reference preserved. It is '
      + 'REACHABLE: installDeactivate rolls back by calling this on root/.geneseed-disabled, so '
      + 'a user with a plain FILE of that name at their install root lost it. NO CELL CAN SEE '
      + 'IT - all 690 replay green with the defect in place, because nothing plants a file where '
      + 'a stash directory belongs. The same shape as M5: the states worth fearing are the ones '
      + 'a clean fixture cannot reach.',
  },
  {
    id: 'M6',
    name: 'make parseJson collapse an integral float',
    file: 'js/lib/pyfs.mjs',
    find: '      ? new PyNumber(value, context.source)',
    replace: '      ? (Number.isInteger(value) ? value : new PyNumber(value, context.source))',
    gate: UNIT,
    why: "`1.0` and `1` are different values to Python's json round-trip and the same value to "
      + "JSON.parse. CLOSED AT P3/T7, after two phases declared ungated: the mutation above was "
      + "a NO-OP that only documented the hole, because a real one needs the reviver and the "
      + "corpus has no cell whose settings carry an integral float. This edit is the real thing "
      + "- it drops the PyNumber wrapper for any integral value, so a read-modify-write of a "
      + "user's `temperature: 1.0` writes back `1` and silently changes the value every "
      + "consumer reads. tests/unit/py_primitives.test.mjs is the gate, and it is absolute "
      + "rather than a comparison because after P4 these functions are not Python "
      + "compatibility, they ARE the spec for what Geneseed writes to a user's disk.",
  },
  {
    id: 'M7',
    name: 'make an emit non-idempotent',
    file: 'js/emit.mjs',
    find: 'export function sourceFingerprint(',
    replace: 'export function sourceFingerprint(',
    gate: null,
    why: 'The re-emit path is what every real user is on from their second build onwards. '
      + '`golden.mjs --idempotent` is the gate and it exists; what is missing is a one-string '
      + 'edit that reaches it without also breaking the corpus replay, which would make the '
      + 'mutation prove the wrong gate. Declared, ungated.',
  },
  {
    id: 'M8',
    name: 'remove a verb from the hook binary\'s table',
    file: 'bin/geneseed-hook.mjs',
    find: "  context: { fn: cmdContext, flags: { '--root': 'root' } },\n",
    replace: '',
    gate: CLI_CONTEXT,
    why: 'The hook table is what an emitted settings.json invokes. A verb missing from it is a '
      + 'hook that cannot launch, on every install, silently. THE FIRST DRAFT ADDED A KEY '
      + 'INSTEAD OF REMOVING ONE and survived: an additive edit to a dispatch table changes '
      + 'nothing any caller can see, which is a mutation that names a defect and plants a '
      + 'no-op.',
  },
  {
    id: 'M9',
    name: 'drop windowsHide from a capturing spawn',
    file: 'js/lib/pyproc.mjs',
    // THE SHARED OWNER, and the anchor took two tries: the flag is not spelled
    // `windowsHide: true` anywhere, it is `process.platform === 'win32'` in ONE place, which is
    // the whole point of the module. A mutation whose anchor is absent is reported as
    // unapplicable rather than silently passing — that report is what corrected this row.
    find: "export const NO_WINDOW = { windowsHide: process.platform === 'win32' };",
    replace: 'export const NO_WINDOW = {};',
    gate: UNIT,
    why: 'A console window flashing on every hook invocation is not a byte, so no corpus can '
      + 'see it — every one of 691 cells was byte-identical through the defect and a HUMAN '
      + 'using the product found it. The gate has to read the SOURCE, which is what '
      + 'tests/unit/spawn_hygiene.test.mjs does: brace-matched call bodies, capturing spawns '
      + 'only, with a floor under the scan so a pattern that stops matching reports zero rather '
      + 'than passing vacuously.',
  },
  {
    id: 'M10',
    name: 'stop the destamp asserting before it passes a line through',
    file: 'tests/helpers/golden.mjs',
    find: '      if (hit) {\n        throw new Error(`${name}: a line outside the canonical stamp carries `',
    replace: '      if (false) {\n        throw new Error(`${name}: a line outside the canonical stamp carries `',
    gate: UNIT,
    why: 'A normaliser that has stopped complaining is how a gate goes green while it has '
      + 'stopped looking. This one mutates the HARNESS rather than the product, deliberately: '
      + 'the replayers are now load-bearing and nothing else tests them.',
  },
  {
    id: 'M11',
    name: 'make the sandbox hand out an unresolved temp root',
    file: 'tests/helpers/sandbox.mjs',
    find: 'fs.realpathSync.native(',
    replace: 'fs.realpathSync(',
    all: true,
    gate: UNIT,
    why: 'THE ONE MUTATION THAT IS NOT INVENTED. It is the defect this phase actually shipped '
      + 'and that windows-latest caught: realpathSync resolves junctions but leaves an 8.3 '
      + 'short name alone, so every sandbox root leaked into every stream on the one platform '
      + 'that spells TEMP that way. Kept as a permanent regression gate.\n'
      + '    `all: true` IS THE POINT OF THIS ROW, AND IT WAS FOUND BY THIS FILE. The first '
      + 'draft mutated only the TMP_ROOT call and SURVIVED — because `makeSandbox` calls '
      + '`.native` a second time on the result, so either call alone is enough and neither is '
      + 'individually load-bearing. A mutation that does not reproduce the defect it names is '
      + 'a row that measures nothing, and the only thing that can tell you is running it.',
  },
  // ------------------------------------------------------------------------------------------
  // P3 T7. Three defects the ACCEPTANCE MATRIX IS STRUCTURALLY BLIND TO, added with
  // `tests/unit/node_driver.test.mjs` — the file whose whole subject is the axes no cell varies.
  // Each one would be byte-identical across all 259 emit cells, which is the argument for the
  // gate existing and therefore the argument for the row.
  {
    id: 'M14',
    name: 'drop the registry prune-on-read write',
    file: 'js/registry.mjs',
    find: '  if (kept.length !== original.length || kept.some((v, i) => v !== original[i])) {\n'
      + '    registrySave(kept);',
    replace: '  if (false) {\n    registrySave(kept);',
    gate: UNIT,
    why: 'The prune is a WRITE performed by a READ, and it is the part of that path most likely '
      + 'to be wrong. Every golden cell emits into a fresh sandbox whose registry is empty, so '
      + '`kept` equals `original` in all 259 of them and deleting the write is invisible to the '
      + 'entire matrix. The gate seeds a row pointing at a directory that no longer exists and '
      + 'requires the file to come back without it.',
  },
  {
    id: 'M15',
    name: 'make copilotConfigDir ignore its relocation variable',
    file: 'js/hosts.mjs',
    find: '  const env = process.env.COPILOT_CONFIG_DIR;',
    replace: '  const env = null;',
    gate: UNIT,
    why: 'UNREACHABLE BY CONSTRUCTION FROM THE MATRIX, and for a safety reason: `cellEnv` CLEARS '
      + 'every relocation variable, because leaving one set renders ~126 global cells into the '
      + "developer's real install. So a resolver that ignored its variable is byte-identical in "
      + "all 259 cells while writing into the user's real config dir on every machine that "
      + 'exports it. This is the M30 shape the per-host table was built for: the hazard had been '
      + 'generalised to Copilot in prose and not in the gate.',
  },
  {
    id: 'M16',
    name: 'drop the --root prefix from the recorded instruction path',
    file: 'bin/geneseed.mjs',
    find: "  const agentPath = agentPathRel ? `${agentPathRel}/AGENT.md` : 'AGENT.md';",
    replace: "  const agentPath = 'AGENT.md';",
    gate: UNIT,
    why: '`argvFor` builds every cell out of `--theme/--emit/--footprint/--out` plus an optional '
      + '`--posture`/`--mode`, so `out === root` in all 259 cells, `relUnder` returns the empty '
      + 'string every time and the prefix this mutation deletes was never once non-empty in the '
      + 'acceptance test. The instruction path `opencode.json` records — the whole reason '
      + '`--root` exists — is INDISTINGUISHABLE to the gate that is otherwise this port\'s '
      + 'acceptance test, which is why the successor asserts it as a partition rather than a '
      + 'containment.',
  },
];

function run(argv) {
  const r = spawnSync(process.execPath, argv, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function withMutation(m, fn) {
  const file = path.join(ROOT, m.file);
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes(m.find)) {
    return { skipped: `${m.id}: its anchor is no longer in ${m.file} — the mutation cannot be `
      + 'applied, so this row proves nothing and must be re-aimed' };
  }
  // `all` for a defect that needs every occurrence changed. M11 is why the flag exists: a
  // redundant second call meant a single-site mutation left the behaviour intact and survived.
  const mutated = m.all
    ? original.split(m.find).join(m.replace)
    : original.replace(m.find, m.replace);
  if (mutated === original) {
    return { skipped: `${m.id}: the edit changed nothing — a no-op mutation is a row that `
      + 'always passes' };
  }
  fs.writeFileSync(file, mutated);
  try {
    return fn();
  } finally {
    fs.writeFileSync(file, original);
  }
}

function main(argv) {
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
  if (argv.includes('--list')) {
    for (const m of MUTATIONS) {
      console.log(`${m.id}  ${m.gate ? 'gated  ' : 'UNGATED'}  ${m.name}`);
    }
    return 0;
  }
  const chosen = MUTATIONS.filter((m) => (!only || m.id === only));
  const gated = chosen.filter((m) => m.gate);
  const ungated = chosen.filter((m) => !m.gate);

  console.log(`[mutate] ${gated.length} gated, ${ungated.length} ungated`);
  // THE CONTROL, and it comes first. A mutant that reddens a gate which was already red proves
  // nothing at all, and that is the single easiest way for this whole file to lie.
  const seen = new Map();
  for (const m of gated) {
    const key = m.gate.join(' ');
    if (seen.has(key)) continue;
    const r = run(m.gate);
    seen.set(key, r.code);
    console.log(`[mutate] control ${key} -> ${r.code === 0 ? 'green' : `RED (${r.code})`}`);
    if (r.code !== 0) {
      console.error(`[mutate] the control is not green; every mutant below would "pass" for the `
        + `wrong reason:\n${r.out.slice(-2000)}`);
      return 2;
    }
  }

  const survivors = [];
  for (const m of gated) {
    const res = withMutation(m, () => run(m.gate));
    if (res.skipped) { survivors.push(res.skipped); console.log(`[mutate] ${res.skipped}`); continue; }
    const killed = res.code !== 0;
    console.log(`[mutate] ${m.id} ${killed ? 'KILLED' : 'SURVIVED'}  ${m.name}`);
    if (!killed) {
      survivors.push(`${m.id} survived: ${m.name}\n    ${m.why}`);
    }
  }

  for (const m of ungated) console.log(`[mutate] ${m.id} UNGATED — ${m.name}\n    ${m.why}`);

  if (survivors.length) {
    console.error(`\n[mutate] ${survivors.length} mutant(s) survived:\n`
      + survivors.map((s) => `  ${s}`).join('\n'));
    return 1;
  }
  console.log(`[mutate] every gated mutant died (${gated.length}); ${ungated.length} declared `
    + 'ungated');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
