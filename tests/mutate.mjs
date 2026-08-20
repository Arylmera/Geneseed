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

// THE FIVE ROWS THAT OUTLIVED THEIR GATE. M1..M4 and M8 were aimed at narrow slices of the
// recorded emit, cli and web corpora, and those corpora were retired with the implementation they
// recorded. A declared gate that can no longer run guards nothing, and a matrix naming one is
// worse than a matrix that says nothing, because it is trusted. Each is re-aimed at the ONE unit
// file that kills it — MEASURED, not assumed — and stays narrow for the reason the retired slices
// were narrow: the cheapest gate that must catch it, and a red that can only mean this mutation.
const UNIT_MAINTAINER = ['--test', 'tests/unit/maintainer_tools.test.mjs'];
const UNIT_DRIVER = ['--test', 'tests/unit/node_driver.test.mjs'];
const UNIT_HOOK_FORM = ['--test', 'tests/unit/hook_form.test.mjs'];
const UNIT_HOOK_CLI = ['--test', 'tests/unit/hook_cli.test.mjs'];
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
    file: 'js/lib/fs.mjs',
    find: "writeFileSync(path, EOL === '\\n' ? text : text.replaceAll('\\n', EOL), 'utf8');",
    replace: "writeFileSync(path, text, 'utf8');",
    gate: UNIT_MAINTAINER,
    why: 'Every emitted file on Windows would carry LF where the reference wrote CRLF. This is '
      + 'the single most platform-specific behaviour in the product, and THE MUTATION IS A NO-OP '
      + "ON POSIX — `EOL === '\\n'` there, so the branch it deletes is already the identity. That "
      + 'is why the retired corpus was split by platform, and the successor keeps the split '
      + 'inside one assertion: `tests/unit/maintainer_tools.test.mjs` requires every multi-line '
      + "file `--sync-themes` REWROTE to carry the running platform's separator — no bare LF "
      + 'here, no CRLF on the ubuntu runner — and it says in its own comment that it exists so '
      + 'this row keeps a gate.',
  },
  {
    id: 'M2',
    name: "drop ensure_ascii from jsonDumpsIndent",
    file: 'js/lib/fs.mjs',
    find: 'export function jsonDumpsIndent(value, { ensureAscii = true } = {}) {\n'
      + '  const text = JSON.stringify(value, null, 2);\n'
      + '  return ensureAscii ? escapeNonAscii(text) : text;',
    replace: 'export function jsonDumpsIndent(value, { ensureAscii = true } = {}) {\n'
      + '  const text = JSON.stringify(value, null, 2);\n'
      + '  return text;',
    gate: UNIT_DRIVER,
    why: "Python's json encoder escapes every non-ASCII character by default and JSON.stringify "
      + 'does not. A theme whose strings carry accents writes different bytes into every '
      + 'manifest and settings file — invisible in a terminal, and a real difference on disk. '
      + 'The retired imperial cells saw it through a theme; `tests/unit/node_driver.test.mjs` '
      + 'sees it through the PATH instead — it emits into `dépôt-café` and requires the registry '
      + 'that records it to carry no byte above 0x7F anywhere, which is the general claim and one '
      + 'no recorded cell ever made, because every cell path was ASCII.',
  },
  {
    id: 'M3',
    name: "reverse comparePaths' collation",
    file: 'js/lib/fs.mjs',
    find: "    if (A[i] !== B[i]) return A[i] < B[i] ? -1 : 1;",
    replace: "    if (A[i] !== B[i]) return A[i] < B[i] ? 1 : -1;",
    gate: UNIT_MAINTAINER,
    why: 'It orders every listing the product sorts by path. THIS ROW HAS TAKEN FOUR AIMS AND THE '
      + 'FIRST TWO ARE STILL THE INTERESTING PART. An emit gate could not see it: back then '
      + 'comparePaths had five callers and all five were in js/doctor.mjs. Then all THIRTY doctor '
      + 'cells could not see it either - doctor sorts its scans internally and reports problems, '
      + 'so the order never reaches an output anyone compares. The third aim, the web catalog '
      + 'cells, caught it at once and went with the corpora. The fourth is stronger than any of '
      + "them: `tests/unit/maintainer_tools.test.mjs` RE-DERIVES Python's `sorted(Path)` order "
      + 'for the running platform rather than replaying a recording, so it holds on both '
      + 'platforms and cannot agree with a drift. The diff is still the reason a corpus hashes '
      + 'rather than measures: 553 bytes against 553, same length, reversed order. A gate '
      + 'comparing sizes would be blind to it.',
  },
  {
    id: 'M4',
    name: 'drop `|| exit 0` from a non-gate hook command',
    file: 'js/settings.mjs',
    find: 'const context = `${run} context --root "${cfg}" || exit 0`;',
    replace: 'const context = `${run} context --root "${cfg}"`;',
    gate: UNIT_HOOK_FORM,
    why: 'A hook that fails to LAUNCH — a moved checkout, a dead interpreter — must not break '
      + "the user's tool call. The partition is the assertion: `|| exit 0` on every non-gate "
      + 'hook and on NO gate, because a crashing gate must fail closed. The retired cells could '
      + 'only see it as a byte difference in one emitted settings.json; '
      + '`tests/unit/hook_form.test.mjs` asserts BOTH halves of that partition over the hooks the '
      + 'generator produces, and names the hook that could block the host session.',
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
      + 'were blind to it. tests/unit/user_files.test.mjs is what closes it, by driving '
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
      + 'a user with a plain FILE of that name at their install root lost it. NO CELL COULD SEE '
      + 'IT - all 690 replayed green with the defect in place, because nothing planted a file '
      + 'where a stash directory belongs. The same shape as M5: the states worth fearing are '
      + 'the ones a clean fixture cannot reach.',
  },
  {
    id: 'M6',
    name: 'make parseJson collapse an integral float',
    file: 'js/lib/fs.mjs',
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
    file: 'js/settings.mjs',
    find: '    writeText(p, pre + block + lstripNewlines(post));',
    replace: '    writeText(p, pre + block + post);',
    gate: IDEMPOTENT,
    why: 'CLOSED IN P3 T7, after two phases declared ungated. The re-emit path is what every '
      + 'real user is on from their second build onwards, and `golden.mjs --idempotent` has '
      + 'always been the gate; what was missing was a one-string edit that reaches it WITHOUT '
      + 'also breaking the single-emit corpus replay, because a mutation that reddens both '
      + 'proves the wrong gate.\n'
      + '    THE SEAM IS THE `updated` BRANCH OF `managedBlockWrite`, which runs ONLY when the '
      + 'carrier already exists and already carries the markers — that is, never on a first '
      + 'emit into a fresh sandbox, and always on a re-emit. Dropping `lstripNewlines` from the '
      + 'tail leaves the first emit byte-identical and makes CLAUDE.md grow a blank line on '
      + 'EVERY subsequent build. Measured before it was written down: `--against --limit 12` '
      + 'green, `--idempotent --only neutral/claude` red at 23186 -> 23188 bytes.\n'
      + '    The defect is the one a user meets and a fixture never does: a file that grows by '
      + 'two bytes per build is invisible for a week and then is a diff nobody can explain.',
  },
  {
    id: 'M8',
    name: 'remove a verb from the hook binary\'s table',
    file: 'bin/geneseed-hook.mjs',
    find: "  context: { fn: cmdContext, flags: { '--root': 'root' } },\n",
    replace: '',
    gate: UNIT_HOOK_CLI,
    why: 'The hook table is what an emitted settings.json invokes. A verb missing from it is a '
      + 'hook that cannot launch, on every install, silently. THE FIRST DRAFT ADDED A KEY '
      + 'INSTEAD OF REMOVING ONE and survived: an additive edit to a dispatch table changes '
      + 'nothing any caller can see, which is a mutation that names a defect and plants a '
      + 'no-op. `tests/unit/hook_cli.test.mjs` replaces the retired cli cells and is broader '
      + 'than they were: it requires the verbs the entry carries and the verbs the emitter WIRES '
      + 'to be the same set, and then runs each one, so a removal reddens the partition and the '
      + 'probe together rather than one recorded stream.',
  },
  {
    id: 'M9',
    name: 'drop windowsHide from a capturing spawn',
    file: 'js/lib/proc.mjs',
    // THE SHARED OWNER, and the anchor took two tries: the flag is not spelled
    // `windowsHide: true` anywhere, it is `process.platform === 'win32'` in ONE place, which is
    // the whole point of the module. A mutation whose anchor is absent is reported as
    // unapplicable rather than silently passing — that report is what corrected this row.
    find: "export const NO_WINDOW = { windowsHide: process.platform === 'win32' };",
    replace: 'export const NO_WINDOW = {};',
    gate: UNIT,
    why: 'A console window flashing on every hook invocation is not a byte, so no corpus could '
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
  // P3 T7. Three defects the ACCEPTANCE MATRIX WAS STRUCTURALLY BLIND TO, added with
  // `tests/unit/node_driver.test.mjs` — the file whose whole subject is the axes no cell varied.
  // Each one would have been byte-identical across all 259 emit cells, which is the argument for
  // the gate existing and therefore the argument for the row.
  {
    id: 'M14',
    name: 'drop the registry prune-on-read write',
    file: 'js/registry.mjs',
    find: '  if (kept.length !== original.length || kept.some((v, i) => v !== original[i])) {\n'
      + '    registrySave(kept);',
    replace: '  if (false) {\n    registrySave(kept);',
    gate: UNIT,
    why: 'The prune is a WRITE performed by a READ, and it is the part of that path most likely '
      + 'to be wrong. Every golden cell emitted into a fresh sandbox whose registry was empty, so '
      + '`kept` equalled `original` in all 259 of them and deleting the write was invisible to '
      + 'the entire matrix. The gate seeds a row pointing at a directory that no longer exists and '
      + 'requires the file to come back without it.',
  },
  {
    id: 'M15',
    name: 'make copilotConfigDir ignore its relocation variable',
    file: 'js/hosts.mjs',
    find: '  const env = process.env.COPILOT_CONFIG_DIR;',
    replace: '  const env = null;',
    gate: UNIT,
    why: 'WAS UNREACHABLE BY CONSTRUCTION FROM THE MATRIX, and for a safety reason: `cellEnv` '
      + 'CLEARED every relocation variable, because leaving one set rendered ~126 global cells '
      + "into the developer's real install. So a resolver that ignored its variable was "
      + "byte-identical in all 259 cells while writing into the user's real config dir on every "
      + 'machine that exports it. This is the M30 shape the per-host table was built for: the '
      + 'hazard had been generalised to Copilot in prose and not in the gate.',
  },
  {
    id: 'M16',
    name: 'drop the --root prefix from the recorded instruction path',
    file: 'bin/geneseed.mjs',
    find: "  const agentPath = agentPathRel ? `${agentPathRel}/AGENT.md` : 'AGENT.md';",
    replace: "  const agentPath = 'AGENT.md';",
    gate: UNIT,
    why: '`argvFor` built every cell out of `--theme/--emit/--footprint/--out` plus an optional '
      + '`--posture`/`--mode`, so `out === root` in all 259 cells, `relUnder` returned the empty '
      + 'string every time and the prefix this mutation deletes was never once non-empty in the '
      + 'acceptance test. The instruction path `opencode.json` records — the whole reason '
      + '`--root` exists — was INDISTINGUISHABLE to the gate that was otherwise this port\'s '
      + 'acceptance test, which is why the successor asserts it as a partition rather than a '
      + 'containment.',
  },
  // ------------------------------------------------------------------------------------------
  // P3 T7, with `tests/unit/authoring_gates.test.mjs`. Doctor's three source-wide authoring
  // gates had NO test in `tests/` at all — a repo-wide search found the package manifest's row
  // and nothing else. They were reachable only through `geneseed doctor`, which prints one `ok`
  // line when all three are silent, so every mutation below previously survived everything.
  {
    id: 'M17',
    name: 'drop the orphan half of the registry gate',
    file: 'js/doctor.mjs',
    find: "  problems.push(...[...present].filter((k) => !expected.has(k)).sort()\n"
      + "    .map((key) => `[authoring] registry.json lists '${key}' but no such entity "
      + "exists`));\n",
    replace: '',
    gate: UNIT,
    why: 'The gate is two-way on purpose and only one direction is obvious. A row whose spec is '
      + 'gone is the silent half: the entity shows no lifecycle badge in the TUI and the web '
      + 'catalog while doctor stays green, because the loud reader and the forgiving reader are '
      + 'different functions over the same file.',
  },
  {
    id: 'M18',
    name: 'make the credential sweep echo what it found',
    file: 'js/doctor.mjs',
    find: '            problems.push(`[authoring] possible ${label} in ${rel}:${i + 1} — a `\n'
      + "              + 'credential must never be committed');",
    replace: '            problems.push(`[authoring] possible ${label} in ${rel}:${i + 1} '
      + '(${line}) — a `\n'
      + "              + 'credential must never be committed');",
    gate: UNIT,
    why: 'THE ONE MUTATION HERE THAT IS A SECURITY DEFECT RATHER THAN A COVERAGE ONE. The sweep '
      + 'reports file:line and the KIND only, because doctor runs in CI and echoing the match '
      + 'would republish the credential into every build log — turning the gate that exists to '
      + 'stop a leak into the thing that publishes it. A report is still produced, so every '
      + 'count and every containment assertion stays green; only an explicit "and it does NOT '
      + 'contain the planted secret" can see it.',
  },
  {
    id: 'M19',
    name: 'let an empty registry relabel the shipped catalogue as personal',
    file: 'js/inventory.mjs',
    find: "    return Object.keys(registry).length ? 'personal' : 'unknown';",
    replace: "    return 'personal';",
    gate: UNIT,
    why: '`loadRegistry` is forgiving by design — a missing or corrupt registry.json yields `{}` '
      + 'rather than breaking the browser. This mutation makes that forgiveness lie: every '
      + 'shipped agent and skill would be badged as the user\'s own work in the TUI and the web '
      + 'catalog, on exactly the machines where the file failed to read. The emptiness check '
      + 'belongs to the REGISTRY and not to the row, and that is the distinction this kills.',
  },
  // ------------------------------------------------------------------------------------------
  // P3 T7, with `tests/unit/web_jobs.test.mjs`. MEASURED WHILE ADDING THESE: the `$ <argv>` echo
  // line in the recorded web corpus normalised the WHOLE argv to `<ARGV>`, not merely its head
  // — so all 114 cells were blind to every argument the job runner resolves, and the reference's
  // own docstring understated it. Both rows below were therefore invisible to the entire corpus.
  {
    id: 'M20',
    name: 'drop --yes from the uninstall job argv',
    file: 'js/web/jobs.mjs',
    find: "    uninstall: [[NODE(), CLI(), 'uninstall', '--yes']],",
    replace: "    uninstall: [[NODE(), CLI(), 'uninstall']],",
    gate: UNIT,
    why: 'A REAL HAZARD AND NOT A COSMETIC ONE: the web Settings runs uninstall as a background '
      + 'job with no terminal attached, so without `--yes` the verb blocks on a confirmation '
      + 'prompt nobody can answer and the job hangs until the daemon is killed. Nothing observed '
      + 'it: the argv is not serialised to a client, and the one place it appears — the `$` echo '
      + 'line — was normalised whole in every recorded cell.',
  },
  {
    id: 'M21',
    name: 'make the deploy resolver ignore the requested host',
    file: 'js/web/actions.mjs',
    find: "  const argv = setupBuildArgs(theme || 'neutral', host, root, root, fp, pos, mode, "
      + 'doctrines,',
    replace: "  const argv = setupBuildArgs(theme || 'neutral', 'files', root, root, fp, pos, "
      + 'mode, doctrines,',
    gate: UNIT,
    why: "`apiDeployCmd`'s `{cmd: [...]}` is handed straight to the job runner and never reaches "
      + 'the wire, so a resolver that deployed the host-agnostic bundle to every host would '
      + 'answer every request successfully and write the wrong layer. The one recorded cell that '
      + 'touched the endpoint covered its two REFUSAL arms, where no command is produced at all.',
  },
  // ------------------------------------------------------------------------------------------
  // P3 T7, with `tests/unit/web_server.test.mjs`.
  //
  // ⚠ NUMBERING: docblocks in `js/web/server.mjs` and `js/web/docs.mjs` cite mutations as "M23",
  // "M30" and so on. Those belong to the NPX PORT's own mutation log and are unrelated to this
  // matrix, which runs M1..M23 of its own. Do not read a citation there as a row here.
  {
    id: 'M22',
    name: 'give /api/activity the 409 treatment',
    file: 'js/web/server.mjs',
    find: "  ['/api/activity', [apiActivityToggle, false]],",
    replace: "  ['/api/activity', [apiActivityToggle, true]],",
    gate: UNIT,
    why: 'THE REVERSE MUTATION, and it is the invisible direction. A port that gave every POST '
      + 'the 409 rule was caught by four recorded cells; giving `/api/activity` alone that rule '
      + 'was caught by none, because every toggle a cell could perform SUCCEEDED and the failing '
      + 'arm needs the flag write to raise — which the two runtimes worded differently and no byte '
      + 'comparison could hold. The convention column is the table `doPost` looks up, so the gate '
      + 'is on the dispatch and not on a declaration.',
  },
  {
    id: 'M23',
    name: 'consult the POST declarations on a GET',
    file: 'js/web/server.mjs',
    find: '  return NOT_PORTED.has(path) || NOT_PORTED_PREFIXES.some((p) => path.startsWith(p));',
    replace: '  return NOT_PORTED.has(path) || DECLINED_POST.has(path)\n'
      + '    || NOT_PORTED_PREFIXES.some((p) => path.startsWith(p));',
    gate: UNIT,
    why: 'LIMITS ROW 3, AS A DEFECT. This is the one-line collapse the split into separate '
      + 'GET and POST declarations exists to prevent: every exported set stays exactly as '
      + 'written, so every partition test that READS them stays green, while a GET to '
      + '`/api/pick-folder` answers 501 instead of falling through to the SPA that owns the path. '
      + 'Only a probe of the running dispatcher can see it, which is why row 3 is a probe and not '
      + 'a declaration — and why the row says so at both sites.',
  },
  // ------------------------------------------------------------------------------------------
  // P3 T7, with `tests/unit/web_daemon.test.mjs`. Both defects are real and both are invisible
  // to every other gate in the repo, for the same reason: the arms they break are the ones no
  // harness may drive, because driving them costs a browser window on the developer's screen or
  // a real `npm install` in the checkout.
  {
    id: 'M24',
    name: 'stop consulting --no-browser on the daemon-came-up arm',
    file: 'js/web/server.mjs',
    find: '      if (openBrowser) openUrl(rec.url);',
    replace: '      if (false && openBrowser) openUrl(rec.url);',
    gate: UNIT,
    why: 'THE ONE BRANCH NO HARNESS MAY DRIVE. Every cell that reaches `serve` passes '
      + '`--no-browser`, because a gate that popped a browser window on the developer\'s screen '
      + 'would be worse than the bug it caught — so the flag\'s three consumers are COUNTED '
      + 'instead. Dropping one leaves `web start` opening no window at all, on the arm a real '
      + 'user takes most often, and nothing else in this repo would notice.',
  },
  {
    id: 'M25',
    name: 'run the npm build before the install',
    file: 'js/web/server.mjs',
    find: "  for (const step of [['install'], ['run', 'build']]) {",
    replace: "  for (const step of [['run', 'build'], ['install']]) {",
    gate: UNIT,
    why: '`npm run build` before `npm install` fails on a fresh checkout with a missing vite, '
      + 'which is the exact situation this path exists for. It is unreachable from every cell BY '
      + 'CONSTRUCTION — `web/dist/index.html` is tracked, so `buildPlan` answers `serve` in any '
      + 'checkout a cell can build (limits row 7) — so the order is asserted as source and '
      + 'this row is what says the assertion is load-bearing.',
  },
  // ------------------------------------------------------------------------------------------
  // P3 T7, with `tests/unit/hook_form.test.mjs`. THE SHIM WAS EXCLUDED FROM THE RETIRED EMIT
  // CORPUS BY NAME — its body bakes the runner and checkout of whoever wrote it, so it would
  // have differed in every cell and drowned every real finding. `shimHealth` stood in for the
  // comparison then and is still what the shim has: it checks only that the quoted paths EXIST.
  // Both rows below live in that gap, which the corpus's retirement did not close.
  {
    id: 'M26',
    name: 'emit the shim path even when the shim could not be written',
    file: 'js/settings.mjs',
    find: '  if (shim !== null) return `"${shim}"`;',
    replace: '  if (true) return `"${shim}"`;',
    gate: UNIT,
    why: 'THE WORST OUTCOME THIS UNIT HAS, and no cell reaches the arm. A command naming a shim '
      + 'that does not exist fails on EVERY hook — 9009 under cmd.exe, 127 under sh — and takes '
      + 'both gates down with it, silently, because Geneseed\'s hooks return 0 on every path and '
      + 'signal through stdout. `shimHealth` cannot see it either: with no shim on disk there is '
      + 'no body for it to read, and it treats an absent shim as legitimate for the emits that '
      + 'wire no hooks. The fallback to the direct form is what makes the failure survivable.',
  },
  {
    id: 'M27',
    name: 'drop the POSIX argv placeholder from the shim exemption',
    file: 'js/settings.mjs',
    find: "export const SHIM_ARGV = new Set(['$@', '%*']);",
    replace: "export const SHIM_ARGV = new Set(['%*']);",
    gate: UNIT,
    why: 'THE ONE MUTATION IN THIS PAIR THAT IS NOT INVENTED — it is the defect the first Linux '
      + 'run of the cell harnesses found, and BOTH implementations had it, because the port '
      + 'copied the rule faithfully. The shim checker pulls every double-quoted token out of the '
      + 'body and requires each to name an existing file; the POSIX body ends `"$@"`, QUOTED, '
      + 'because the quoting is what keeps an emitted `--root "<cfg>"` intact. Without the '
      + 'exemption every Linux and macOS install had doctor reporting a perfectly healthy shim '
      + 'as "pointed at $@, which does not exist — every hook in every install was dead", and '
      + '`validate` failed on it. Kept as a permanent regression gate, and it fires on either '
      + 'platform because the successor asks the generator for BOTH shim shapes.',
  },
  {
    id: 'M28',
    name: 'leave the scratch file behind when the atomic rename fails',
    file: 'js/settings.mjs',
    find: '    rmSync(tmp, { force: true });\n',
    replace: '',
    gate: UNIT,
    why: 'THE HALF OF THE ATOMIC GUARANTEE THAT IS NOT ABOUT THE TARGET. No cell failed a rename, '
      + 'so nothing in 690 recorded cells reached this catch. A leaked `settings.json'
      + '.geneseed-tmp` sits in the user\'s own config directory, where the next emit\'s '
      + 'directory listing finds it and the user has to work out whose it is — and it holds a '
      + 'full copy of the config the write was about to make, which is a disclosure as well as '
      + 'litter.',
  },
  {
    id: 'M29',
    name: 'skip a user-authored file silently instead of saying so',
    file: 'js/native.mjs',
    find: "    warn(`[geneseed] kept your existing ${rel} — skipped Geneseed's copy to avoid `\n"
      + "      + 'clobbering it');",
    replace: '',
    gate: UNIT,
    why: 'CLAIM-ON-CREATE IS CORRECT AND SILENT IS NOT. A pre-existing file whose name collides '
      + "with a shipped spec is the user's, so the emit leaves it and does NOT claim it — but "
      + 'without the line, the user sees a successful emit and a reviewer agent that is still '
      + 'their old one, with nothing anywhere saying which of the two is on disk. No cell could '
      + 'reach it: every recorded cell emitted into a fresh sandbox, so no file ever collided.',
  },
  // ------------------------------------------------------------------------------------------
  // T8, with `tests/unit/emit_phase_order.test.mjs`. The phase markers ARE product code — they
  // are the only thing that makes the emit's stage order observable at all, now that the port
  // has no two-dispatcher seam for a source walker to read.
  {
    id: 'M30',
    name: 'fold the Claude wire stage away',
    file: 'js/emit.mjs',
    find: 'function claudeWire(job, claudeMdText, hasAgentText, doctrines = null, '
      + "excludeRules = []) {\n  phaseLog('WIRE');\n",
    replace: 'function claudeWire(job, claudeMdText, hasAgentText, doctrines = null, '
      + 'excludeRules = []) {\n',
    gate: UNIT,
    why: "THE EXACT SHAPE THE REFERENCE'S OWN VACUITY GUARD WAS BUILT FOR. An emit whose wire "
      + 'was folded into its render sibling still renders, still prunes, still manifests and is '
      + 'still perfectly MONOTONE — it simply has no WIRE at all, and nothing but a per-emit '
      + "partition notices. Here the marker is the wire's only witness, so deleting it is the "
      + 'observable form of the same defect.',
  },
  {
    id: 'M31',
    name: 'log the phase boundaries to stdout',
    file: 'js/emit.mjs',
    find: '  process.stderr.write(`[geneseed:phase] ${phase}\\n`);',
    replace: '  process.stdout.write(`[geneseed:phase] ${phase}\\n`);',
    gate: UNIT,
    why: 'STDOUT IS THE DECISION CHANNEL. Every Geneseed hook returns 0 on every path and '
      + 'signals its verdict as JSON on stdout, so one stray byte there turns a blocking gate '
      + 'into a silently permissive one that still reports success. The emit corpus could not see '
      + 'this either way, because it never set the variable; what catches it is that the phase '
      + 'gate reads the stream the marker is SUPPOSED to be on.',
  },
  // ------------------------------------------------------------------------------------------
  // The per-rule doctrine axis. Both rows sit on the seam where a NARROWING option can make a
  // gate pass by doing less — the shape `--repeat` taught this repo — and both are invisible to
  // every recorded carrier, because the default build excludes nothing and is byte-identical to
  // one from before the axis existed.
  {
    id: 'M32',
    name: 'key the consent gate on the pack instead of the rule',
    file: 'js/settings.mjs',
    find: '  processPackOn(d) && !(Array.isArray(excluded) && excluded.includes(CONSENT_RULE));',
    replace: '  processPackOn(d);',
    gate: UNIT,
    why: 'THE PROMPT AND THE BOUNDARY SAYING DIFFERENT THINGS, which is the one failure this '
      + 'axis can newly cause. `process 5` carries commit/push consent and can now be excluded '
      + 'ON ITS OWN; a gate still keyed on the PACK keeps `git commit*`/`git push*` wired to a '
      + 'rule the emitted AGENT.md no longer contains, and every install that excludes nothing '
      + '— every recorded cell, every default build — is byte-identical either way. Nothing but '
      + 'a cell that excludes exactly that one rule can see it.',
  },
  {
    id: 'M33',
    name: 'let an emptied pack keep its place in the active set',
    file: 'js/render.mjs',
    find: '.filter(survives)',
    replace: '',
    gate: UNIT,
    why: 'THE TWO AXES ARE NOT INDEPENDENT, and this is the direction that composes wrongly. A '
      + 'pack whose every rule is excluded must LEAVE `--doctrines`, or the render puts a pack '
      + 'header into AGENT.md with nothing under it and the `Active packs:` marker attests to a '
      + 'pack the file no longer states — the same lie the build refuses when a selected pack '
      + 'has no FILE. Survivable in every other configuration, so only an all-of-one-pack '
      + 'exclusion reaches it.',
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
  // ⚠ `--verify` EXISTS BECAUSE THIS FILE'S ONLY FAILURE MODE IS SILENT, AND CI RUNS NOTHING
  // ELSE HERE. Every row is anchored to an exact string in a product file; a refactor near an
  // anchor makes the mutation unappliable, and `withMutation` correctly calls that a SURVIVOR
  // rather than a skip — but only for whoever runs the matrix by hand, which no workflow does.
  // So a row can rot for months and the tree stays green. This asks the one question that needs
  // no mutation to answer: does every anchor still resolve? It WRITES NOTHING and runs no gate,
  // which is what makes it cheap enough to put in CI beside the suites.
  //
  // It is deliberately not a substitute for `--all`. A resolvable anchor is not a killed mutant;
  // this only refuses the state where the matrix has quietly stopped describing the code.
  if (argv.includes('--verify')) {
    const stale = MUTATIONS.filter((m) => {
      try { return !fs.readFileSync(path.join(ROOT, m.file), 'utf8').includes(m.find); }
      catch { return true; }
    });
    for (const m of stale) console.error(`[mutate] ${m.id}: anchor gone from ${m.file}`);
    console.log(`[mutate] ${MUTATIONS.length - stale.length}/${MUTATIONS.length} anchors resolve`);
    if (stale.length) {
      console.error('[mutate] a row whose anchor is gone proves nothing and reports as a '
        + 'survivor. Re-aim it against what the code says now, or retire it in writing.');
      return 1;
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
