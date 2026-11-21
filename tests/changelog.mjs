// CHANGELOG FRAGMENTS. A PR does not edit CHANGELOG.md: it adds one file under `changes/`, and the
// release folds every fragment into the version's section. Two reasons, both measured on 6.1.0:
// - 6 of the 19 PRs merged since 6.0.4 carried no entry, and nothing said so until release time,
//   when the entry had to be rebuilt from the PR body.
// - Agents in parallel all wrote under `## [Unreleased]`, so two PRs that each added a line
//   conflicted on the same hunk. A file per PR cannot conflict.
//
// A fragment is `changes/<slug>.<type>.md`; `<type>` is a Keep a Changelog heading in lower case,
// and the body is one or more `- ` entries in the CHANGELOG's own prose. `changes/README.md`
// explains this and is never folded.
//
//   node tests/changelog.mjs --check            fragments well-formed, `[Unreleased]` empty. CI.
//   node tests/changelog.mjs --gate             PR gate: reads TITLE and LABELS (JSON) from the
//                                               environment and the files the PR adds from
//                                               `git diff HEAD^1 HEAD` (the PR's merge commit).
//   node tests/changelog.mjs --fold <version> [--date YYYY-MM-DD]
//                                               release: seal the fragments as `## [<version>]`,
//                                               delete them, keep an empty `## [Unreleased]`.
//
// Why `[Unreleased]` must stay empty: two homes for one entry drift (One Writer Per Value). The
// fragments are the only writer until the release; the CHANGELOG holds released versions only.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = 'changes';

/** Keep a Changelog's headings, in the order a version section lists them. */
export const TYPES = ['added', 'changed', 'deprecated', 'removed', 'fixed', 'security'];
const HEADING = (t) => `### ${t[0].toUpperCase()}${t.slice(1)}`;

/** The label that waives the gate for a feat/fix PR with nothing a user would notice. */
export const SKIP_LABEL = 'no-changelog';

const NAME_RE = /^([a-z0-9][a-z0-9-]*)\.([a-z]+)\.md$/;

/** `{ slug, type }` for a fragment file name, or `null` when the name is not one. */
export function parseName(name) {
  const m = NAME_RE.exec(name);
  return m && TYPES.includes(m[2]) ? { slug: m[1], type: m[2] } : null;
}

/** Problems with one fragment's body: it must hold at least one `- ` entry and nothing above it. */
export function bodyProblems(body) {
  const lines = body.replace(/\r\n/g, '\n').trim().split('\n');
  if (!lines[0]) return ['is empty'];
  if (!lines[0].startsWith('- ')) return ['must start with a `- ` entry'];
  if (lines.some((l) => l.startsWith('#'))) return ['holds a heading; the fold writes the headings'];
  return [];
}

/** The `## [Unreleased]` body: everything between its heading and the next `## [`. */
export function unreleasedBody(changelog) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex((l) => l.trim() === '## [Unreleased]');
  if (at < 0) return null;
  const end = lines.findIndex((l, i) => i > at && l.startsWith('## ['));
  return lines.slice(at + 1, end < 0 ? lines.length : end).join('\n').trim();
}

/** Every fragment under `<root>/changes`, sorted by name: `{ file, slug, type, body }`. */
export function readFragments(root = ROOT) {
  const dir = path.join(root, DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f !== 'README.md').sort().map((file) => ({
    file, ...parseName(file), body: fs.readFileSync(path.join(dir, file), 'utf8'),
  }));
}

/** `--check`: every problem in the fragment directory and the CHANGELOG, as strings. */
export function checkProblems(root = ROOT) {
  const problems = [];
  for (const f of readFragments(root)) {
    if (!f.type) {
      problems.push(`${DIR}/${f.file}: not a fragment name — use <slug>.<type>.md, type one of ${TYPES.join(', ')}`);
      continue;
    }
    for (const p of bodyProblems(f.body)) problems.push(`${DIR}/${f.file}: ${p}`);
  }
  const body = unreleasedBody(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
  if (body === null) problems.push('CHANGELOG.md: no `## [Unreleased]` heading');
  else if (body) problems.push(`CHANGELOG.md: \`## [Unreleased]\` holds entries — move them to ${DIR}/<slug>.<type>.md`);
  return problems;
}

/**
 * Does a PR with this title owe a fragment? `feat`, `fix` and `perf` change what a user gets, and
 * so does any breaking change (`!`). `chore`, `docs`, `test`, `ci`, `refactor`, `build`, `style`
 * and `revert` do not: a release PR (`chore(release)`) consumes fragments instead of adding one.
 */
export function owesFragment(title) {
  const m = /^(\w+)(\([^)]*\))?(!)?:/.exec(title.trim());
  if (!m) return false;
  return m[3] === '!' || ['feat', 'fix', 'perf'].includes(m[1]);
}

/** `--gate`: `null` when the PR passes, else the reason it fails. `added` = paths the PR adds. */
export function gateVerdict({ title, labels = [], added = [] }) {
  if (!owesFragment(title)) return null;
  if (labels.includes(SKIP_LABEL)) return null;
  if (added.some((p) => p.startsWith(`${DIR}/`) && parseName(p.slice(DIR.length + 1)))) return null;
  return `"${title}" changes what a user gets, so it needs a changelog fragment: add `
    + `${DIR}/<slug>.<type>.md (type one of ${TYPES.join(', ')}; see ${DIR}/README.md), `
    + `or the \`${SKIP_LABEL}\` label when nothing a user would notice changed.`;
}

/**
 * `--fold`: the CHANGELOG with the fragments sealed under `## [<version>] — <date>`, grouped in
 * TYPES order, fragments in name order. `[Unreleased]` must be empty first (`--check`).
 */
export function fold(changelog, fragments, version, date) {
  const eol = changelog.includes('\r\n') ? '\r\n' : '\n';
  const text = changelog.replace(/\r\n/g, '\n');
  if (unreleasedBody(text)) throw new Error('`## [Unreleased]` holds entries; move them to fragments first');
  if (!fragments.length) throw new Error(`no fragments under ${DIR}/ — nothing to release`);
  if (text.includes(`## [${version}]`)) throw new Error(`CHANGELOG.md already has a ${version} section`);
  const parts = [`## [Unreleased]`, '', `## [${version}] — ${date}`];
  for (const type of TYPES) {
    const of = fragments.filter((f) => f.type === type);
    if (!of.length) continue;
    parts.push('', HEADING(type), '', ...of.map((f) => f.body.replace(/\r\n/g, '\n').trim()));
  }
  const out = text.replace(/^## \[Unreleased\]\n+/m, `${parts.join('\n')}\n\n`);
  return out.split('\n').join(eol);
}

function main(argv) {
  const [mode, ...rest] = argv;
  if (mode === '--check') {
    const problems = checkProblems();
    for (const p of problems) console.error(`[changelog] ${p}`);
    if (!problems.length) console.log(`[changelog] ok — ${readFragments().length} fragment(s) waiting`);
    return problems.length ? 1 : 0;
  }
  if (mode === '--gate') {
    const added = execFileSync('git', ['diff', '--name-only', '--diff-filter=A', 'HEAD^1', 'HEAD'],
      { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const verdict = gateVerdict({
      title: process.env.TITLE ?? '', labels: JSON.parse(process.env.LABELS || '[]'), added,
    });
    if (verdict) { console.error(`[changelog] ${verdict}`); return 1; }
    console.log('[changelog] ok');
    return 0;
  }
  if (mode === '--fold') {
    const version = rest[0];
    const di = rest.indexOf('--date');
    const date = di >= 0 ? rest[di + 1] : new Date().toISOString().slice(0, 10);
    if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      console.error('usage: node tests/changelog.mjs --fold <x.y.z> [--date YYYY-MM-DD]');
      return 2;
    }
    const problems = checkProblems();
    if (problems.length) { for (const p of problems) console.error(`[changelog] ${p}`); return 1; }
    const file = path.join(ROOT, 'CHANGELOG.md');
    const fragments = readFragments();
    fs.writeFileSync(file, fold(fs.readFileSync(file, 'utf8'), fragments, version, date));
    for (const f of fragments) fs.rmSync(path.join(ROOT, DIR, f.file));
    console.log(`[changelog] folded ${fragments.length} fragment(s) into ${version}`);
    return 0;
  }
  console.error('usage: node tests/changelog.mjs --check | --gate | --fold <x.y.z> [--date YYYY-MM-DD]');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
