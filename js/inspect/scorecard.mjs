/**
 * `geneseed scorecard` — the AI Harness Scorecard, ported to JavaScript.
 *
 * UPSTREAM: markmishaev76/ai-harness-scorecard, pinned at commit
 * 5536e96227dc8278301eaff3f4ca3faaf13cf278, MIT License, "Copyright (c) 2026 Mark Mishaev".
 * This file ports `repo_context.py`, `ci_parser.py`, `scanner.py`, `models.py` and the JSON
 * reporter; `scorecard-checks.mjs` ports `checks/*.py`. Same 31 check ids, names, points,
 * partial scores, evidence and remediation strings, same category weights and grade thresholds.
 *
 * WHY A PORT AND NOT THE PYTHON TOOL. The CLI runs where Python may not (`ci.yml`'s
 * `package-no-python` job proves the package needs none), and doctor's ratchet has to run
 * in-process: the CLI is under a transitive spawn ban. Upstream uses no subprocess and no
 * network, and neither does this.
 *
 * WHAT IS DELIBERATELY DIFFERENT, and only this:
 *   * Paths are normalised to `/`. Upstream keeps the OS separator, so on Windows its evidence
 *     says `docs\x.md` where this says `docs/x.md`. Matching is unaffected: Python's `fnmatch`
 *     normcases both sides on Windows, and its `*` crosses separators — which the java
 *     indicator `*` + `/pom.xml` matching a pom.xml at ANY depth relies on, and `fnmatch` keeps.
 *   * The file list is sorted by the `/` spelling, i.e. upstream's order on POSIX. Only the
 *     first-match evidence strings can tell, never a score.
 *   * YAML is read by the small subset parser in `scorecard-yaml.mjs`, not PyYAML — see its
 *     `ponytail:` note.
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { isDir, isFile, printErr, printOut, readText, writeText } from '../lib/fs.mjs';
import { ALL_CHECKS } from './scorecard-checks.mjs';
import { badgeUrl, renderSvg } from './scorecard-svg.mjs';
import { parseYamlSubset, pyStr, pyTruthy } from './scorecard-yaml.mjs';

export { FlowMap, parseYamlSubset, pyStr, pyTruthy } from './scorecard-yaml.mjs';

// ---------------------------------------------------------------------------------------------
// ci_parser.py
// ---------------------------------------------------------------------------------------------

const GITLAB_RESERVED_KEYS = new Set([
  'stages', 'variables', 'default', 'include', 'workflow', 'image', 'services',
  'before_script', 'after_script', 'cache', 'artifacts', '.pre', '.post',
]);

const get = (m, k, dflt) => (m.has(k) ? m.get(k) : dflt);

/** `_load_yaml` — `[raw, mapping]`, or `[raw|'', null]` for a non-mapping or a parse failure. */
function loadYaml(file) {
  let raw;
  try { raw = readText(file); } catch { return ['', null]; }
  const data = parseYamlSubset(raw);
  if (data === undefined) return ['', null];
  return [raw, data instanceof Map ? data : null];
}

/** `parse_ci_configs` — `.gitlab-ci.yml`, then `.github/workflows/*.yml`, then `*.yaml`. */
export function parseCiConfigs(root) {
  const configs = [];
  const gitlab = path.join(root, '.gitlab-ci.yml');
  if (isFile(gitlab)) {
    const c = parseGitlabCi(...loadYaml(gitlab));
    if (c) configs.push(c);
  }
  const wf = path.join(root, '.github', 'workflows');
  if (isDir(wf)) {
    let names = [];
    try { names = readdirSync(wf); } catch { /* unreadable: no workflows */ }
    for (const suffix of ['.yml', '.yaml']) {
      for (const n of names.filter((x) => x.endsWith(suffix)).sort()) {
        const c = parseGithubActions(...loadYaml(path.join(wf, n)));
        if (c) configs.push(c);
      }
    }
  }
  return configs;
}

function parseGitlabCi(raw, data) {
  if (data === null) return null;
  const config = { ciType: 'gitlab', jobs: [], hasSchedule: false, rawContent: raw };
  config.hasSchedule = gitlabHasSchedule(data);
  for (const [key, value] of data) {
    if (typeof key !== 'string' || key.startsWith('.') || GITLAB_RESERVED_KEYS.has(key)) continue;
    if (!(value instanceof Map)) continue;
    config.jobs.push({
      name: key,
      commands: gitlabCommands(value),
      allowFailure: pyTruthy(get(value, 'allow_failure', false)),
      stage: get(value, 'stage', null),
    });
  }
  return config;
}

/** Every top-level mapping is scanned, reserved ones included — `workflow: rules:` counts. */
function gitlabHasSchedule(data) {
  for (const value of data.values()) {
    if (!(value instanceof Map)) continue;
    const rules = get(value, 'rules', []);
    if (!Array.isArray(rules)) continue;
    for (const rule of rules) {
      if (rule instanceof Map && pyStr(get(rule, 'if', '')).toLowerCase().includes('schedule')) {
        return true;
      }
    }
  }
  return false;
}

function gitlabCommands(job) {
  const commands = [];
  for (const key of ['before_script', 'script', 'after_script']) {
    const s = get(job, key, []);
    if (Array.isArray(s)) commands.push(...s.map(pyStr));
    else if (typeof s === 'string') commands.push(s);
  }
  return commands;
}

function parseGithubActions(raw, data) {
  if (data === null) return null;
  // `data.get("on")`, then `data.get(True)`: YAML 1.1 reads a bare `on:` key as the boolean.
  let on = get(data, 'on', null);
  if (on === null) on = get(data, true, null);
  const config = {
    ciType: 'github', jobs: [], hasSchedule: on instanceof Map && on.has('schedule'), rawContent: raw,
  };
  const jobs = get(data, 'jobs', new Map());
  if (!(jobs instanceof Map)) return config;
  for (const [name, job] of jobs) {
    if (!(job instanceof Map)) continue;
    const commands = [];
    const uses = job.get('uses');
    if (typeof uses === 'string') commands.push(`uses: ${uses}`);
    const steps = get(job, 'steps', []);
    for (const step of Array.isArray(steps) ? steps : []) {
      if (!(step instanceof Map)) continue;
      if (step.has('run')) commands.push(pyStr(step.get('run')));
      if (step.has('uses')) commands.push(`uses: ${pyStr(step.get('uses'))}`);
    }
    config.jobs.push({
      name: pyStr(name), commands, allowFailure: pyTruthy(get(job, 'continue-on-error', false)), stage: null,
    });
  }
  return config;
}

// ---------------------------------------------------------------------------------------------
// repo_context.py
// ---------------------------------------------------------------------------------------------

const LANGUAGE_INDICATORS = {
  rust: ['Cargo.toml'],
  python: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt'],
  javascript: ['package.json'],
  typescript: ['tsconfig.json'],
  go: ['go.mod'],
  java: ['pom.xml', '*/pom.xml', 'build.gradle', '*/build.gradle', 'build.gradle.kts', '*/build.gradle.kts'],
  ruby: ['Gemfile'],
  csharp: ['*.csproj', '*.sln'],
  swift: ['Package.swift'],
  kotlin: ['build.gradle.kts', '*/build.gradle.kts'],
};

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'target', '__pycache__', '.venv', 'venv', 'dist', 'build', '.tox',
  '.mypy_cache', '.pytest_cache', 'vendor', '.bundle', '.cargo',
]);

const FNMATCH_CACHE = new Map();

/**
 * `fnmatch(path.lower(), pattern.lower())`: anchored, `*` crossing `/`, `?` one character.
 *
 * ponytail: no `[...]` classes — none of the 31 checks' patterns uses one. Add the class branch
 * of `fnmatch.translate` when a pattern needs it.
 */
function fnmatch(name, pattern) {
  let re = FNMATCH_CACHE.get(pattern);
  if (!re) {
    const src = pattern.toLowerCase().replace(/[.+^${}()|[\]\\/]/g, '\\$&')
      .replace(/\*+/g, '.*').replace(/\?/g, '.');
    re = new RegExp(`^(?:${src})$`, 's');
    FNMATCH_CACHE.set(pattern, re);
  }
  return re.test(name.toLowerCase());
}

/** `os.walk` minus `IGNORED_DIRS` at every depth; a symlinked directory is listed but not entered. */
function scanFileTree(root) {
  const files = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) walk(path.join(dir, e.name), r);
      } else if (e.isSymbolicLink()) {
        let d = false;
        try { d = statSync(path.join(dir, e.name)).isDirectory(); } catch { /* broken: a file */ }
        if (!d) files.push(r);
      } else {
        files.push(r);
      }
    }
  };
  walk(root, '');
  return files.sort();
}

/** `RepoContext` — the pre-scanned repo every check reads. */
export class RepoContext {
  constructor(root) {
    this.path = path.resolve(root);
    this.fileTree = scanFileTree(this.path);
    this.languages = Object.keys(LANGUAGE_INDICATORS)
      .filter((lang) => LANGUAGE_INDICATORS[lang].some((p) => this.hasFile(p))).sort();
    this.ciConfigs = parseCiConfigs(this.path);
    this.scripts = this.loadScripts();
  }

  hasFile(...patterns) {
    for (const p of patterns) {
      for (const f of this.fileTree) if (fnmatch(f, p)) return f;
    }
    return null;
  }

  findFiles(...patterns) {
    const out = [];
    for (const p of patterns) for (const f of this.fileTree) if (fnmatch(f, p)) out.push(f);
    return out;
  }

  hasDir(...patterns) {
    return patterns.find((p) => isDir(path.join(this.path, p))) ?? null;
  }

  readFile(rel) {
    const full = path.join(this.path, rel);
    if (!isFile(full)) return null;
    try { return readText(full); } catch { return null; }
  }

  searchFile(rel, pattern) {
    const content = this.readFile(rel);
    return content !== null && new RegExp(pattern, 'im').test(content);
  }

  searchAnyFile(filePatterns, textPattern) {
    for (const fp of filePatterns) {
      for (const f of this.fileTree) {
        if (fnmatch(f, fp) && this.searchFile(f, textPattern)) return f;
      }
    }
    return null;
  }

  ciHasCommand(pattern) {
    const re = new RegExp(pattern, 'i');
    return this.ciConfigs.some((ci) => ci.jobs.some((j) => this.matchesCommand(j.commands, re)));
  }

  ciHasBlockingCommand(pattern) {
    const re = new RegExp(pattern, 'i');
    return this.ciConfigs.some((ci) => ci.jobs.some(
      (j) => !j.allowFailure && this.matchesCommand(j.commands, re),
    ));
  }

  matchesCommand(commands, re) {
    return commands.some((cmd) => {
      if (re.test(cmd)) return true;
      const resolved = this.resolveScript(cmd);
      return Boolean(resolved) && re.test(resolved);
    });
  }

  ciHasScheduledJob() {
    return this.ciConfigs.some((ci) => ci.hasSchedule);
  }

  ciRawContent() {
    return this.ciConfigs.map((ci) => ci.rawContent).join('\n');
  }

  loadScripts() {
    const content = this.readFile('package.json');
    if (!content) return new Map();
    let data;
    try { data = JSON.parse(content); } catch { return new Map(); }
    const scripts = data && typeof data === 'object' && !Array.isArray(data) ? data.scripts : null;
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return new Map();
    return new Map(Object.entries(scripts).map(([k, v]) => [k, pyStr(v)]));
  }

  /** `npm run X` / `yarn X` / `pnpm X` / `bun X` → the body of package.json's script X. */
  resolveScript(command) {
    const parts = command.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return null;
    const pm = parts[0].toLowerCase();
    if (!['npm', 'yarn', 'pnpm', 'bun'].includes(pm)) return null;
    let name = null;
    if (parts[1].toLowerCase() === 'run') {
      if (parts.length >= 3) name = parts[2];
    } else if (pm !== 'npm') {
      name = parts[1];
    }
    return name && this.scripts.has(name) ? this.scripts.get(name) : null;
  }
}

// ---------------------------------------------------------------------------------------------
// scanner.py + models.py
// ---------------------------------------------------------------------------------------------

const CATEGORY_CONFIG = {
  documentation: ['Architectural Documentation', 0.20],
  constraints: ['Mechanical Constraints', 0.25],
  testing: ['Testing & Stability', 0.25],
  review: ['Review & Drift Prevention', 0.15],
  ai_safeguards: ['AI-Specific Safeguards', 0.15],
};

/** @type {[string, number][]} */
const GRADES = [['A', 85], ['B', 70], ['C', 55], ['D', 40]];

const GRADE_DESCRIPTIONS = {
  A: 'Strong harness. AI-generated code has robust mechanical safeguards.',
  B: 'Good foundation. Some gaps in enforcement or feedback loops.',
  C: 'Basic practices present but insufficient for safe AI scaling.',
  D: 'Significant gaps. AI code likely accumulating undetected debt.',
  F: 'No meaningful harness. AI output is essentially unaudited.',
};

export function computeGrade(score) {
  return GRADES.find(([, t]) => score >= t)?.[0] ?? 'F';
}

/**
 * `assess_repo` — every check over `dir`. Scores stay unrounded here, summed in upstream's
 * order (checks, then categories, from 0) so the floating-point totals are the same doubles;
 * rounding is the renderers' job, as it is the reporters' upstream.
 */
export function assessRepo(dir) {
  const ctx = new RepoContext(dir);
  const categories = Object.entries(ALL_CHECKS).map(([id, checks]) => {
    const [name, weight] = CATEGORY_CONFIG[id];
    const results = checks.map((c) => c.run(ctx));
    const score = results.reduce((a, c) => a + c.score, 0);
    const maxScore = results.reduce((a, c) => a + c.maxPoints, 0);
    const percentage = maxScore === 0 ? 0 : (score / maxScore) * 100;
    return { id, name, weight, score, maxScore, percentage, checks: results };
  });
  const overallScore = categories.reduce((a, c) => a + c.percentage * c.weight, 0);
  const grade = computeGrade(overallScore);
  return {
    repoPath: ctx.path,
    repoName: path.basename(ctx.path),
    languages: ctx.languages,
    overallScore,
    grade,
    gradeDescription: GRADE_DESCRIPTIONS[grade],
    totalChecks: categories.reduce((a, c) => a + c.checks.length, 0),
    passedChecks: categories.reduce((a, c) => a + c.checks.filter((k) => k.passed).length, 0),
    categories,
  };
}

/**
 * Python's `round(x, 1)`: the nearest double's decimal value decides, and an exact tie goes to
 * the even digit. `toFixed` already rounds the exact binary value, which settles every case
 * but the exact tie (x.x5 representable exactly, e.g. 0.25), where it rounds away from zero.
 */
export function round1(x) {
  // `toFixed(30)` spells the double's exact decimal expansion, so an exact tie shows as one.
  if (/\.\d50*$/.test(Math.abs(x).toFixed(30))) {
    const down = Math.trunc(Math.abs(x) * 10);
    return (Math.sign(x) * (down % 2 === 0 ? down : down + 1)) / 10;
  }
  return Number(x.toFixed(1));
}

/** The JSON payload: upstream's reporter shape, keys renamed to this module's camelCase. */
function renderJson(a) {
  const r = (x) => round1(x);
  return `${JSON.stringify({
    ...a,
    overallScore: r(a.overallScore),
    categories: a.categories.map((c) => ({
      ...c, score: r(c.score), maxScore: r(c.maxScore), percentage: r(c.percentage),
      checks: c.checks.map((k) => ({ ...k, score: r(k.score), maxPoints: r(k.maxPoints) })),
    })),
  }, null, 2)}\n`;
}

/** The text report: grade, the per-pillar table, then every check that is not at full marks. */
function renderText(a) {
  const out = [
    `AI Harness Scorecard — ${a.repoName}`,
    `Grade ${a.grade} — ${round1(a.overallScore)}/100 (${a.passedChecks}/${a.totalChecks} checks passing)`,
    a.gradeDescription,
    '',
  ];
  const w = Math.max(...a.categories.map((c) => c.name.length));
  for (const c of a.categories) {
    out.push(`  ${c.name.padEnd(w)}  ${String(round1(c.percentage)).padStart(5)}%  `
      + `(weight ${Math.round(c.weight * 100)}%)`);
  }
  const gaps = a.categories.flatMap((c) => c.checks.filter((k) => k.score < k.maxPoints));
  if (gaps.length) {
    out.push('', 'To improve:');
    for (const k of gaps) {
      out.push(`  ${k.passed ? '~' : 'x'} ${k.name} (${round1(k.score)}/${round1(k.maxPoints)}) — ${k.evidence}`);
      if (k.remediation) out.push(`      fix: ${k.remediation}`);
    }
  }
  out.push('', 'Scores the repo (CI, tests, docs), not the harness files. Upstream: '
    + 'markmishaev76/ai-harness-scorecard (MIT).');
  return `${out.join('\n')}\n`;
}

/** The verb: a reading, never a gate — exit 0 whatever the grade. */
export function cmdScorecard(args) {
  const dir = path.resolve(args.path ?? process.cwd());
  if (!isDir(dir)) {
    printErr(`[scorecard] not a directory: ${dir}\n`);
    return 1;
  }
  const a = assessRepo(dir);
  if (args.svg) {
    // The README card (`scorecard-svg.mjs`). Written, not printed: an SVG on a terminal helps
    // nobody, and the path is where doctor's freshness check reads it back.
    writeText(path.resolve(args.svg), renderSvg(a));
    printOut(`[scorecard] ${a.grade} ${round1(a.overallScore)}/100 → ${args.svg}\n`
      + `[scorecard] README badge: ${badgeUrl(a)}\n`);
    return 0;
  }
  printOut(args.json ? renderJson(a) : renderText(a));
  return 0;
}
