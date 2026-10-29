/**
 * Where the done gate's checks come from (`./hooks-done.mjs` judges them): the project's
 * `.geneseed/done-checks.txt`, else what its root manifests imply.
 *
 * Its own module because two verbs read it — `learn` on Stop and `context` at SessionStart — and
 * `context` is in the CLI's closure (`js/inspect/cost.mjs`), which may not reach a spawn:
 * `./hooks-done.mjs` imports `./hooks.mjs`, which does. Nothing here may spawn either.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readText } from '../lib/fs.mjs';
import { DONE_LIST, splitLines } from './hooks-prims.mjs';

/** The declared checks, one per line, `#` comments; null when the project has no list. */
export function readDoneChecks(root) {
  const file = path.join(root, DONE_LIST);
  if (!existsSync(file)) return null;
  try {
    return splitLines(readText(file)).map((l) => l.trim().replace(/\s+/g, ' '))
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return null;
  }
}

// The package manager a lockfile names; first hit wins, npm without one.
const PM_LOCKS = [['bun.lockb', 'bun'], ['bun.lock', 'bun'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn']];
const PM_SCRIPTS = ['test', 'lint', 'typecheck'];

/** One package.json script as a check: the lockfile's own spellings, plus npm's (npm runs any). */
function scriptCheck(pm, s) {
  const npm = s === 'test' ? ['npm test', 'npm run test', 'npm t'] : [`npm run ${s}`];
  // `bun test` is bun's own runner, not the `test` script: only `bun run` runs the script.
  const own = pm === 'npm' ? [] : pm === 'bun' ? [`bun run ${s}`] : [`${pm} ${s}`, `${pm} run ${s}`];
  return { label: own[0] ?? npm[0], forms: [...own, ...npm] };
}

// Each wrapper spelling (POSIX and Windows) times each task that runs the tests, with and without
// a leading `clean`. `refuse` names the flags that make the same command skip the tests: a
// segment carrying one is no pass (`hooks-done.mjs`'s `groupPasses`).
const wrapped = (label, bins, tasks, refuse) => ({
  label, refuse, forms: bins.flatMap((b) => tasks.flatMap((t) => [`${b} ${t}`, `${b} clean ${t}`])),
});
const MAVEN = wrapped('mvn test', ['mvn', './mvnw', '.\\mvnw', 'mvnw', 'mvnw.cmd'], ['test', 'verify', 'install'],
  /(?:^|\s)-D(?:skipTests|maven\.test\.skip)(?=[=\s]|$)/);
const GRADLE = wrapped('gradle test', ['gradle', './gradlew', '.\\gradlew', 'gradlew', 'gradlew.bat'], ['test', 'build', 'check'],
  /(?:^|\s)(?:-x|--exclude-task)[ =](?:\S*:)?test(?=\s|$)/);
// shortcut: no `uv`-prefixed form — that spelling trips the no-Python gates in
// tests/unit/package_manifest.test.mjs (user decision 2026-10-29: no exemption), so a uv user's
// run reads as unproven, which is only an advisory.
const PYTEST = { label: 'pytest', forms: ['pytest', 'python -m pytest', 'python3 -m pytest', 'py -m pytest', 'poetry run pytest'] };
const MANIFEST_CHECKS = [
  ['pom.xml', MAVEN],
  ['build.gradle', GRADLE],
  ['build.gradle.kts', GRADLE],
  ['pyproject.toml', PYTEST],
  ['Cargo.toml', { label: 'cargo test', forms: ['cargo test'], refuse: /(?:^|\s)--no-run(?=\s|$)/ }],
  ['go.mod', { label: 'go test', forms: ['go test'] }],
];
/**
 * Every root manifest the checks are inferred from — what an emit seeds into the protected list.
 * @type {string[]}
 */
export const INFERRED_FROM = ['package.json', ...MANIFEST_CHECKS.map(([f]) => /** @type {string} */ (f))];

/**
 * The checks the root's manifests imply, and which manifests implied them. npm's default `test`
 * script (`echo "Error: no test specified" && exit 1`) is no check: it fails by design. A
 * pyproject.toml implies `pytest` only where pytest shows: `[tool.pytest` in it, or a
 * `pytest.ini`, `conftest.py` or `tests/` at the root — else a unittest-only or test-less repo
 * would owe an advisory it can never clear.
 *
 * shortcut: KNOWN UNSEEN FORMS. Every one reads as "not run", so it costs a stray advisory, never
 * a false pass; add a form here when a real transcript shows one:
 *   - the git root's manifests only — a monorepo's subprojects (`pnpm -r test`,
 *     `./gradlew :app:test`, `mvn -pl core test`) are neither inferred nor matched;
 *   - a sibling script (`npm run test:unit`) or a runner called directly (`npx vitest`);
 *   - a prefix before the command (`CI=1 npm test`, `mvn -q test`): forms match verbatim.
 */
export function inferDoneChecks(root) {
  const has = (f) => existsSync(path.join(root, f));
  const sources = [];
  const checks = [];
  const add = (source, list) => {
    if (!list.length) return;
    sources.push(source);
    for (const c of list) if (!checks.some((k) => k.label === c.label)) checks.push(c);
  };
  if (has('package.json')) {
    let scripts = null;
    try { scripts = JSON.parse(readText(path.join(root, 'package.json'))).scripts; } catch { /* unreadable: none */ }
    if (!scripts || typeof scripts !== 'object') scripts = {};
    const pm = (PM_LOCKS.find(([f]) => has(f)) ?? [null, 'npm'])[1];
    add('package.json', PM_SCRIPTS.filter((s) => typeof scripts[s] === 'string'
      && !(s === 'test' && /no test specified/.test(scripts[s]))).map((s) => scriptCheck(pm, s)));
  }
  const pytestShows = () => {
    let toml = '';
    try { toml = readText(path.join(root, 'pyproject.toml')); } catch { /* unreadable: no section */ }
    return toml.includes('[tool.pytest') || ['pytest.ini', 'conftest.py', 'tests'].some(has);
  };
  for (const [file, check] of MANIFEST_CHECKS) {
    if (has(file) && (check !== PYTEST || pytestShows())) add(file, [check]);
  }
  return { sources, checks };
}

/**
 * The project's checks: `{ source, blocking, checks: [{ label, forms, refuse? }] }`. The file, when
 * present, wins and blocks; else the inference, advisory. `source` names where they came from.
 */
export function doneChecksOf(root) {
  const listed = readDoneChecks(root);
  if (listed) return { source: DONE_LIST, blocking: true, checks: listed.map((l) => ({ label: l, forms: [l] })) };
  const { sources, checks } = inferDoneChecks(root);
  return { source: sources.join(', '), blocking: false, checks };
}

/**
 * The one SessionStart line naming the done gate's checks for the repo at `root`. `judged` false
 * is a host that never judges a turn (Bob: its Stop carries no transcript): the line names the
 * checks but claims no verdict.
 */
export function doneLine(root, judged = true) {
  const { source, blocking, checks } = doneChecksOf(root);
  const names = checks.map((c) => c.label).join(', ');
  const how = (verdict) => (judged ? verdict : 'not judged on this host');
  if (blocking) {
    return checks.length ? `Done gate: from ${source} — ${names} (${how('blocking')})`
      : `Done gate: off — ${source} lists no checks`;
  }
  return checks.length ? `Done gate: inferred from ${source} — ${names} (${how('advisory')})`
    : 'Done gate: no checks could be inferred';
}
