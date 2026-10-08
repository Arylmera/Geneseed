/**
 * The scorecard's 31 checks — a port of upstream's `checks/*.py`.
 *
 * UPSTREAM: markmishaev76/ai-harness-scorecard, pinned at commit
 * 5536e96227dc8278301eaff3f4ca3faaf13cf278, MIT License, "Copyright (c) 2026 Mark Mishaev".
 *
 * Ported line for line, in upstream's order: the order is the scoring (a check returns on its
 * FIRST matching arm, so reordering two arms changes which partial score a repo gets). Every
 * pattern is upstream's Python raw string as a `String.raw` — compiled with `new RegExp` by the
 * context, and printed as written in evidence, never as `.source` (which escapes `/`).
 *
 * Every language branch stays, Rust and Go included. Nothing Node-native is added (`node --test`
 * is not a test runner here): parity with upstream comes first, and its score is a floor.
 */

const R = String.raw;

/** `BaseCheck` — the check's identity plus the three result shapes. */
function check(id, name, maxPoints, source, run) {
  const base = { id, name, maxPoints, source };
  const res = (passed, score, evidence, remediation) => ({
    ...base, passed, score, evidence, remediation,
  });
  return {
    ...base,
    run: (ctx) => run(ctx, {
      pass: (evidence) => res(true, maxPoints, evidence, ''),
      fail: (evidence, remediation) => res(false, 0, evidence, remediation),
      // `passed = score > 0`: a 0.0 partial is a fail that still carries its remediation.
      partial: (score, evidence, remediation = '') => res(score > 0, Math.min(score, maxPoints), evidence, remediation),
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// documentation.py — Architectural Documentation (20%)
// ---------------------------------------------------------------------------------------------

const MODULE_CONSTRAINT_PATTERNS = [
  R`never\s+depend`, R`must\s+not\s+depend`, R`does\s+not\s+(import|depend)`,
  R`must\s+not\s+import`, R`no\s+dependency\s+on`, R`independent\s+of`, R`zero.dependency`,
];

const DOCUMENTATION_CHECKS = [
  check('architecture_doc', 'Architecture Documentation', 5.0, 'matklad ARCHITECTURE.md guide', (ctx, r) => {
    const found = ctx.hasFile('architecture.md', 'architecture', 'docs/architecture.md',
      'docs/architecture/*.md', 'doc/architecture.md');
    if (found) return r.pass(`Found: ${found}`);
    return r.fail('No architecture documentation found',
      "Create ARCHITECTURE.md at repo root following matklad's pattern: "
      + 'short, stable, focused on module boundaries and constraints.');
  }),
  check('agent_instructions', 'Agent Instructions', 5.0, 'OpenAI Harness Engineering (2026)', (ctx, r) => {
    const found = ctx.hasFile('claude.md', 'agents.md', '.cursorrules',
      '.github/copilot-instructions.md', 'copilot.md');
    if (found) return r.pass(`Found: ${found}`);
    if (ctx.hasDir('.cursor/rules')) return r.pass('Found: .cursor/rules/ directory');
    return r.fail('No AI agent instruction files found',
      'Create CLAUDE.md or AGENTS.md with project context, code style, '
      + 'and constraints so AI agents produce consistent output.');
  }),
  check('adr_presence', 'Architecture Decision Records', 3.0, 'DORA 2025 Report - AI-accessible documentation', (ctx, r) => {
    const dir = ctx.hasDir('docs/adr', 'docs/decisions', 'docs/ADR', 'adr', 'doc/adr', 'doc/decisions');
    if (dir) return r.pass(`Found ADR directory: ${dir}`);
    const found = ctx.hasFile('docs/adr-*.md', 'docs/decisions/*.md', 'docs/000*.md');
    if (found) return r.pass(`Found ADR-like file: ${found}`);
    return r.fail('No Architecture Decision Records found',
      'Create docs/adr/ directory with numbered markdown decision records. '
      + 'Use adr-tools or a simple template.');
  }),
  check('module_boundary_docs', 'Module Boundary Documentation', 4.0, 'matklad ARCHITECTURE.md - constraints as absences', (ctx, r) => {
    const files = ['architecture.md', 'docs/architecture.md', 'claude.md', 'agents.md', 'readme.md', 'docs/*.md'];
    for (const p of MODULE_CONSTRAINT_PATTERNS) {
      const found = ctx.searchAnyFile(files, p);
      if (found) return r.pass(`Module boundary constraints found in ${found}`);
    }
    return r.fail('No module boundary constraints documented',
      'Document which modules must NOT depend on each other in ARCHITECTURE.md. '
      + "Example: 'The fields crate never depends on any other workspace crate.'");
  }),
  check('api_contracts', 'API Documentation', 3.0, 'DORA 2025 - AI-accessible documentation', (ctx, r) => {
    if (ctx.ciHasCommand(R`cargo\s+doc|rustdoc|typedoc|jsdoc|sphinx|mkdocs|pdoc|javadoc|godoc|swag|dokka`)) {
      return r.pass('Doc generation found in CI');
    }
    const spec = ctx.hasFile('openapi.yaml', 'openapi.json', 'openapi.yml', 'swagger.yaml',
      'swagger.json', 'docs/openapi*.yaml', 'docs/openapi*.json', 'docs/openapi*.yml',
      'api-docs/*.yaml', 'api-docs/*.json');
    if (spec) return r.pass(`API spec found: ${spec}`);
    for (const dep of ['build.gradle', 'build.gradle.kts', '*/build.gradle', '*/build.gradle.kts']) {
      if (ctx.searchAnyFile([dep], R`springdoc-openapi|springfox`)) {
        return r.pass(`Runtime API documentation library found in ${dep}`);
      }
    }
    const conf = ctx.hasFile('mkdocs.yml', 'docs/conf.py', 'typedoc.json', 'jsdoc.json');
    if (conf) return r.pass(`Doc generation config found: ${conf}`);
    return r.fail('No API documentation generation or spec files found',
      'Add doc generation to CI (cargo doc, typedoc, sphinx) '
      + 'or maintain OpenAPI/Swagger specs.');
  }),
];

// ---------------------------------------------------------------------------------------------
// constraints.py — Mechanical Constraints (25%)
// ---------------------------------------------------------------------------------------------

const JAVA_BUILD_FILES = ['build.gradle', '*/build.gradle', 'build.gradle.kts', '*/build.gradle.kts'];

const LINTER_PATTERNS = [
  R`cargo\s+clippy`, R`eslint`, R`flake8`, R`pylint`, R`ruff\s+(check|\.)`, R`rubocop`,
  R`golangci-lint`, R`mypy`, R`pyright`, R`ktlint`, R`swiftlint`, R`checkstyle`,
  R`\bpmd:(check|aggregate-pmd-check)\b`,
  R`\b(?:\./)?gradlew?\b.*\b(pmdMain|pmdTest)\b`,
  R`\bcom\.github\.spotbugs:spotbugs-maven-plugin:(check|spotbugs)\b`,
  R`\bspotbugs:(check|spotbugs)\b`,
  R`\b(?:\./)?gradlew?\b.*\bspotbugs(?:[A-Z]\w*)\b`,
];

const GRADLE_CHECK_PATTERN = R`\b(?:\./)?gradlew?\b.*\bcheck\b`;

const PMD_GRADLE = R`id\("pmd"\)|id\s+[\'"]pmd[\'"]|apply\s+plugin:\s*[\'"]pmd[\'"]|pmd\s*\{`;
const SPOTBUGS_GRADLE = R`id\("com\.github\.spotbugs"\)|id\s+[\'"]com\.github\.spotbugs[\'"]|`
  + R`apply\s+plugin:\s*[\'"]com\.github\.spotbugs[\'"]|spotbugs\s*\{`;

/** `_has_java_linter_config` with `has_gradle_config` always supplied, as both callers do. */
function javaLinterConfig(ctx, configFiles, pomPattern, hasGradle) {
  return Boolean(ctx.hasFile(...configFiles))
    || Boolean(ctx.searchAnyFile(['pom.xml', '*/pom.xml'], pomPattern)) || hasGradle;
}

const FORMATTER_PATTERNS = [
  R`cargo\s+fmt.*--check`, R`prettier\s+--check`, R`black\s+--check`, R`ruff\s+format\s+--check`,
  R`gofmt\s+-l`, R`goimports`, R`rustfmt.*--check`, R`scalafmt\s+--check`, R`spotless:check`,
  R`spotlessCheck`, R`\.?/?gradlew\s+spotlessCheck`, R`ktlintCheck`, R`ktfmt`,
];

const AUDIT_PATTERNS = [
  R`cargo\s+(audit|deny)`, R`npm\s+audit`, R`safety\s+check`, R`pip-audit`, R`snyk\s+test`,
  R`trivy\s+fs`, R`grype`, R`dependency.scanning`, R`gemnasium`, R`dependabot`, R`renovate`,
  R`snyk/actions`, R`dependency-check-maven`, R`ossindex-maven-plugin`,
];

const CONSTRAINT_CHECKS = [
  check('ci_pipeline_exists', 'CI Pipeline', 3.0, 'DORA 2025 Report', (ctx, r) => {
    if (ctx.ciConfigs.length) return r.pass(`CI detected: ${ctx.ciConfigs.map((c) => c.ciType).join(', ')}`);
    const found = ctx.hasFile('.travis.yml', 'Jenkinsfile', '.circleci/config.yml',
      'azure-pipelines.yml', 'bitbucket-pipelines.yml');
    if (found) return r.pass(`CI config found: ${found}`);
    return r.fail('No CI configuration found',
      'Add .gitlab-ci.yml or .github/workflows/ to run automated checks on every change.');
  }),
  check('linter_enforcement', 'Linter Enforcement', 4.0, 'OpenAI Harness Engineering - mechanical constraints', (ctx, r) => {
    const hasPmdGradle = Boolean(ctx.searchAnyFile(JAVA_BUILD_FILES, PMD_GRADLE));
    const hasSpotbugsGradle = Boolean(ctx.searchAnyFile(JAVA_BUILD_FILES, SPOTBUGS_GRADLE));
    const anyGradle = hasPmdGradle || hasSpotbugsGradle;
    for (const p of LINTER_PATTERNS) {
      if (ctx.ciHasBlockingCommand(p)) return r.pass(`Blocking linter found in CI: ${p}`);
    }
    if (anyGradle && ctx.ciHasBlockingCommand(GRADLE_CHECK_PATTERN)) {
      return r.pass(`Blocking linter found in CI: ${GRADLE_CHECK_PATTERN}`);
    }
    const notBlocking = 'Ensure linter job is not set to allow_failure / continue-on-error.';
    for (const p of LINTER_PATTERNS) {
      if (ctx.ciHasCommand(p)) return r.partial(2.0, `Linter found in CI (${p}) but may not be blocking`, notBlocking);
    }
    if (anyGradle && ctx.ciHasCommand(GRADLE_CHECK_PATTERN)) {
      return r.partial(2.0, `Linter found in CI (${GRADLE_CHECK_PATTERN}) but may not be blocking`, notBlocking);
    }
    const java = ctx.languages.includes('java');
    if (java && ctx.hasFile('checkstyle.xml')) {
      return r.partial(2.0, 'Checkstyle config found but not confirmed in CI',
        'Add checkstyle to your CI pipeline as a blocking job.');
    }
    if (java) {
      if (javaLinterConfig(ctx, ['pmd.xml', '*/pmd.xml'], R`maven-pmd-plugin`, hasPmdGradle)) {
        return r.partial(2.0, 'PMD config found but not confirmed in CI',
          'Add PMD to your CI pipeline as a blocking job.');
      }
      if (javaLinterConfig(ctx, ['spotbugs-exclude.xml', '*/spotbugs-exclude.xml'],
        R`spotbugs-maven-plugin`, hasSpotbugsGradle)) {
        return r.partial(2.0, 'SpotBugs config found but not confirmed in CI',
          'Add SpotBugs to your CI pipeline as a blocking job.');
      }
    }
    return r.fail('No linter found in CI',
      'Add a linter to CI that blocks merges on violations '
      + '(e.g. cargo clippy -- -D warnings, eslint --max-warnings 0).');
  }),
  check('formatter_enforcement', 'Formatter Enforcement', 3.0, 'OpenAI Harness Engineering - mechanical constraints', (ctx, r) => {
    for (const p of FORMATTER_PATTERNS) {
      if (ctx.ciHasCommand(p)) return r.pass(`Formatter check found in CI: ${p}`);
    }
    if (ctx.languages.includes('java') || ctx.languages.includes('kotlin')) {
      if (ctx.searchAnyFile(['pom.xml', '*/pom.xml'], R`spotless-maven-plugin`)) {
        return r.partial(2.0, 'Spotless plugin found but not confirmed in CI',
          'Add spotless:check to your CI pipeline.');
      }
      if (ctx.searchAnyFile(JAVA_BUILD_FILES, R`com\.diffplug\.spotless|spotless|spotlessGradlePlugin`)) {
        return r.partial(2.0, 'Spotless plugin found but not confirmed in CI',
          'Add spotlessCheck to your CI pipeline.');
      }
    }
    return r.fail('No formatter check found in CI',
      'Add a formatter check to CI (e.g. cargo fmt --all -- --check, prettier --check).');
  }),
  check('type_safety', 'Type Safety', 3.0, 'SlopCodeBench - preventing subtle type errors', (ctx, r) => {
    const langs = ctx.languages;
    if (langs.includes('rust')) return r.pass('Rust: type safety enforced by compiler');
    if (langs.includes('go')) return r.pass('Go: type safety enforced by compiler');
    if (langs.includes('java') || langs.includes('kotlin')) {
      return r.pass('JVM language: type safety enforced by compiler');
    }
    const ts = ctx.hasFile('tsconfig.json');
    if (ts && ctx.searchFile(ts, R`"strict"\s*:\s*true`)) return r.pass('TypeScript strict mode enabled');
    if (ts) {
      return r.partial(1.5, 'TypeScript found but strict mode not confirmed',
        'Enable "strict": true in tsconfig.json.');
    }
    if (ctx.ciHasCommand(R`mypy|pyright|pytype`)) return r.pass('Python type checker found in CI');
    const py = ctx.hasFile('pyproject.toml');
    if (py && ctx.searchFile(py, R`\[tool\.mypy\]|\[tool\.pyright\]`)) {
      return r.partial(1.5, 'Type checker configured but not confirmed in CI',
        'Add mypy/pyright to your CI pipeline.');
    }
    return r.fail('No type safety enforcement found',
      'Use a statically typed language, enable TypeScript strict mode, '
      + 'or add mypy/pyright to CI for Python.');
  }),
  check('dependency_auditing', 'Dependency Auditing', 4.0, 'Blog: security infrastructure reliability', (ctx, r) => {
    for (const p of AUDIT_PATTERNS) {
      if (ctx.ciHasBlockingCommand(p)) return r.pass(`Blocking dependency audit in CI: ${p}`);
    }
    for (const p of AUDIT_PATTERNS) {
      if (ctx.ciHasCommand(p)) {
        return r.partial(2.0, `Dependency audit found (${p}) but set to allow_failure`,
          'Make the audit job blocking (remove allow_failure / continue-on-error).');
      }
    }
    const conf = ctx.hasFile('deny.toml', '.cargo/audit.toml', '.snyk', 'renovate.json',
      '.github/dependabot.yml', '.github/dependabot.yaml');
    if (conf) {
      return r.partial(1.0, `Audit config found (${conf}) but not confirmed in CI`,
        'Add the audit tool to your CI pipeline as a blocking job.');
    }
    return r.fail('No dependency auditing found',
      'Add cargo deny/audit, npm audit, pip-audit, or Snyk to CI as a blocking check.');
  }),
  check('conventional_commits', 'Conventional Commits', 2.0, 'DORA 2025 - working in small batches', (ctx, r) => {
    if (ctx.ciHasCommand(R`commitlint|conventional-changelog|semantic-release`)) {
      return r.pass('Conventional commit enforcement found in CI');
    }
    const conf = ctx.hasFile('.commitlintrc.yml', '.commitlintrc.json', '.commitlintrc.js',
      'commitlint.config.js', '.releaserc.json', '.releaserc.yml');
    if (conf) return r.pass(`Commit lint config found: ${conf}`);
    return r.fail('No conventional commit enforcement found',
      'Add commitlint or equivalent to CI to enforce consistent commit message format.');
  }),
  check('unsafe_code_policy', 'Unsafe Code Policy', 3.0, 'Blog: 80% problem in AI-generated code', (ctx, r) => {
    const cargo = ctx.hasFile('cargo.toml');
    if (cargo && ctx.searchFile(cargo, R`unsafe_code\s*=\s*"forbid"`)) return r.pass('Rust: unsafe_code = forbid');
    const eslintrc = ctx.hasFile('.eslintrc.json', '.eslintrc.yml', '.eslintrc.js', 'eslint.config.js');
    if (eslintrc && ctx.searchFile(eslintrc, R`no-eval|no-implied-eval`)) return r.pass('ESLint unsafe pattern rules found');
    if (ctx.ciHasCommand(R`semgrep|bandit|brakeman|gosec`)) return r.pass('Security linter found in CI');
    const raw = ctx.ciRawContent().toLowerCase();
    if (raw.includes('sast') || raw.includes('semgrep')) return r.pass('SAST scanning found in CI');
    return r.fail('No explicit policy against unsafe code patterns',
      'Add unsafe_code = forbid (Rust), security linting (semgrep/bandit), '
      + 'or ESLint rules against dangerous patterns.');
  }),
];

// ---------------------------------------------------------------------------------------------
// testing.py — Testing & Stability (25%)
// ---------------------------------------------------------------------------------------------

const COVERAGE_PATTERNS = [
  R`llvm-cov|tarpaulin|cargo-llvm-cov`, R`coverage\.py|pytest-cov|--cov`, R`istanbul|nyc|c8\s`,
  R`jacoco|cobertura`, R`simplecov`, R`go\s+tool\s+cover|gocover`, R`codecov|coveralls`,
];

const TESTING_CHECKS = [
  check('test_suite_exists', 'Test Suite', 3.0, 'Kent Beck - tests define what correct means', (ctx, r) => {
    const hasTests = ctx.hasDir('tests', 'test', 'spec', 'src/test', '__tests__')
      || ctx.hasFile('tests/*.rs', 'tests/*.py', 'tests/*.ts', 'tests/*.js', 'test_*.py', '*_test.go',
        '*_test.rs', '*.test.ts', '*.test.js', '*.spec.ts', '*.spec.js');
    const inCi = ctx.ciHasCommand(R`cargo\s+(test|nextest)|pytest|jest|mocha|vitest|go\s+test|rspec|`
      + R`gradlew?\s+test|\.\/gradlew\s+test|mvn\s+test|dotnet\s+test`);
    if (hasTests && inCi) return r.pass('Tests present and executed in CI');
    if (hasTests) {
      return r.partial(1.5, 'Tests found but not confirmed in CI', 'Add test execution to your CI pipeline.');
    }
    return r.fail('No test suite found',
      "Add tests and run them in CI. As Kent Beck says: 'the test defines what correct means.'");
  }),
  check('feature_matrix_testing', 'Feature Matrix Testing', 3.0, 'DORA 2025 - stability through comprehensive testing', (ctx, r) => {
    const testJobs = ctx.ciConfigs.flatMap((ci) => ci.jobs).filter((j) => {
      const all = j.commands.join(' ').toLowerCase();
      return ['test', 'pytest', 'jest', 'rspec', 'nextest'].some((kw) => all.includes(kw));
    });
    if (testJobs.length >= 3) {
      return r.pass(`Multiple test jobs in CI: ${testJobs.slice(0, 5).map((j) => j.name).join(', ')}`);
    }
    const raw = ctx.ciRawContent().toLowerCase();
    if (raw.includes('matrix') || raw.includes('parallel')) return r.pass('Matrix/parallel testing strategy found in CI');
    const combos = [R`--all-features`, R`--no-default-features`, R`--features\s`, R`NODE_ENV=`]
      .filter((p) => ctx.ciHasCommand(p)).length;
    if (combos >= 2) return r.pass(`Feature combination testing found (${combos} variants)`);
    if (testJobs.length === 2) {
      return r.partial(1.5, 'Two test jobs found, consider adding more configurations',
        'Test with different feature flags, environments, or dependency versions.');
    }
    return r.fail('Only one test configuration found',
      'Add CI jobs for different feature flags, environments, or dependency versions '
      + '(e.g. --all-features, --no-default-features, MSRV check).');
  }),
  check('coverage_measurement', 'Code Coverage', 4.0, 'DORA 2025 - stability feedback loops', (ctx, r) => {
    for (const p of COVERAGE_PATTERNS) {
      if (ctx.ciHasCommand(p)) return r.pass(`Coverage measurement in CI: ${p}`);
    }
    const conf = ctx.hasFile('.codecov.yml', 'codecov.yml', '.coveragerc', 'coverage.config.js', 'jest.config.*');
    if (conf) {
      return r.partial(2.0, `Coverage config found (${conf}) but not confirmed in CI`,
        'Add coverage reporting to your CI pipeline.');
    }
    return r.fail('No code coverage measurement found',
      'Add cargo llvm-cov, pytest-cov, istanbul/c8, or equivalent to CI. '
      + 'Even informational coverage provides a feedback loop.');
  }),
  check('mutation_testing', 'Mutation Testing', 4.0, "SlopCodeBench - code that 'appears correct but is unreliable'", (ctx, r) => {
    if (ctx.ciHasCommand(R`cargo[\s-]mutants|stryker|mutmut|pitest|mull`)) return r.pass('Mutation testing found in CI');
    const conf = ctx.hasFile('stryker.conf.js', 'stryker.conf.json', '.stryker-tmp', 'mutmut_config.py', '.mutmut');
    if (conf) {
      return r.partial(2.0, `Mutation testing config found (${conf})`,
        'Add mutation testing to CI, even on a scheduled basis.');
    }
    return r.fail('No mutation testing found',
      'Add cargo-mutants (Rust), Stryker (JS/TS), mutmut (Python), or PIT (Java). '
      + 'Mutation testing catches tests that pass without verifying behavior.');
  }),
  check('property_based_testing', 'Property-Based Testing', 3.0, 'Blog: catching edge cases in AI-generated code', (ctx, r) => {
    const depFiles = ['cargo.toml', 'pyproject.toml', 'package.json', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts'];
    const patterns = [R`proptest|quickcheck|arbtest`, R`hypothesis`, R`fast-check|jsverify`, R`rapid`, R`jqwik`];
    for (const dep of depFiles) {
      for (const p of patterns) {
        if (ctx.searchAnyFile([dep, `*/${dep}`], p)) return r.pass(`Property-based testing library found in ${dep}`);
      }
    }
    const testFiles = ctx.findFiles('tests/*.rs', 'tests/*.py', 'test_*.py', '*.test.ts', '*PropertyTest.java', '*PropertyTest.kt');
    const propPatterns = [R`proptest!`, R`@given`, R`fc\.(assert|property)`, R`rapid\.Check`, R`@Property`];
    for (const tf of testFiles) {
      for (const p of propPatterns) {
        if (ctx.searchFile(tf, p)) return r.pass(`Property-based tests found in ${tf}`);
      }
    }
    return r.fail('No property-based testing found',
      'Add proptest (Rust), hypothesis (Python), fast-check (JS/TS), or jqwik (Java) '
      + 'for testing invariants with random structured inputs.');
  }),
  check('fuzz_testing', 'Fuzz Testing', 3.0, 'Blog: 80% problem - catching what AI misses', (ctx, r) => {
    for (const dep of ['pom.xml', 'build.gradle', 'build.gradle.kts']) {
      if (ctx.searchAnyFile([dep, `*/${dep}`], 'jazzer-junit')) return r.pass(`Jazzer fuzz testing library found in ${dep}`);
    }
    const dir = ctx.hasDir('fuzz', 'fuzz_targets', 'fuzzing');
    if (dir) return r.pass(`Fuzz testing directory found: ${dir}`);
    const file = ctx.hasFile('fuzz/fuzz_targets/*.rs', 'fuzz/*.py', 'fuzz_test.go', '*_fuzz_test.go', '*FuzzTest.java', '*FuzzTest.kt');
    if (file) return r.pass(`Fuzz target found: ${file}`);
    if (ctx.ciHasCommand(R`cargo\s+fuzz|go\s+test.*-fuzz|afl-fuzz|honggfuzz`)) return r.pass('Fuzz testing found in CI');
    return r.fail('No fuzz testing found', 'Add fuzz targets for parsing-heavy and input-handling code paths.');
  }),
  check('contract_tests', 'Contract / Compatibility Tests', 3.0, 'OpenAI Harness Engineering - mechanical constraints', (ctx, r) => {
    const files = ctx.findFiles('*contract*', '*golden*', '*compat*', '*snapshot*', '*fixture*')
      .filter((f) => ['.rs', '.py', '.ts', '.js', '.go', '.json'].some((ext) => f.includes(ext)));
    if (files.length) return r.pass(`Contract/compatibility tests found: ${files.slice(0, 3).join(', ')}`);
    if (ctx.ciHasCommand(R`golden|snapshot|contract`)) return r.pass('Contract/snapshot testing found in CI');
    return r.fail('No contract or compatibility tests found',
      'Add contract tests that verify external interface stability '
      + '(golden fixtures, snapshot tests, wire-format checks).');
  }),
  check('tests_blocking_ci', 'Tests Block Merge', 2.0, 'DORA 2025 - stability metrics', (ctx, r) => {
    const kws = ['test', 'pytest', 'jest', 'rspec', 'nextest', 'spec'];
    const blocking = [];
    const nonBlocking = [];
    for (const job of ctx.ciConfigs.flatMap((ci) => ci.jobs)) {
      const isTest = kws.some((kw) => job.name.toLowerCase().includes(kw)
        || job.commands.some((c) => c.toLowerCase().includes(kw)));
      if (!isTest) continue;
      (job.allowFailure ? nonBlocking : blocking).push(job.name);
    }
    if (blocking.length && !nonBlocking.length) {
      return r.pass(`All test jobs are blocking: ${blocking.slice(0, 3).join(', ')}`);
    }
    if (blocking.length) {
      return r.partial(1.0, `Some test jobs are allow_failure: ${nonBlocking.slice(0, 3).join(', ')}`,
        'Make all test jobs blocking to prevent merging broken code.');
    }
    if (nonBlocking.length) {
      return r.fail(`Test jobs found but all are allow_failure: ${nonBlocking.slice(0, 3).join(', ')}`,
        'Remove allow_failure from test jobs.');
    }
    return r.fail('No test jobs found in CI', 'Add test execution to CI as a blocking job.');
  }),
];

// ---------------------------------------------------------------------------------------------
// review.py — Review & Drift Prevention (15%)
// ---------------------------------------------------------------------------------------------

const REVIEW_CHECKS = [
  check('code_review_required', 'Code Review Required', 4.0, 'OpenAI Harness Engineering - author/reviewer separation', (ctx, r) => {
    const owners = ctx.hasFile('CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS');
    if (owners) return r.pass(`CODEOWNERS file found: ${owners}`);
    const raw = ctx.ciRawContent().toLowerCase();
    if (raw.includes('approval') || raw.includes('review')) {
      return r.partial(2.0, 'Review-related configuration found in CI',
        'Enforce code review via branch protection rules (requires API access to verify).');
    }
    return r.partial(0.0,
      'Cannot verify branch protection without API access. '
      + 'Run with --github-token or --gitlab-token for full assessment.',
      'Enable required reviews in branch protection settings and add CODEOWNERS.');
  }),
  check('scheduled_ci', 'Scheduled CI Jobs', 3.0, 'OpenAI Harness Engineering - garbage collection agents', (ctx, r) => {
    if (ctx.ciHasScheduledJob()) return r.pass('Scheduled CI pipeline found');
    const raw = ctx.ciRawContent().toLowerCase();
    if (raw.includes('cron') || raw.includes('schedule')) return r.pass('Scheduled trigger found in CI config');
    return r.fail('No scheduled CI jobs found',
      'Add scheduled/nightly CI pipelines for drift detection: '
      + 'stricter lints, dependency freshness, doc coverage scans.');
  }),
  check('stale_doc_detection', 'Stale Documentation Detection', 2.0, 'OpenAI Harness Engineering - quality drift', (ctx, r) => {
    if (ctx.ciHasCommand(R`todo|fixme|hack`)) return r.pass('TODO/FIXME scanning found in CI');
    for (const p of [R`link.check|markdown.link|lychee|linkinator`, R`vale|textlint|markdownlint`]) {
      if (ctx.ciHasCommand(p)) return r.pass(`Documentation quality check in CI: ${p}`);
    }
    return r.fail('No stale documentation detection found',
      'Add TODO/FIXME scanning, link checking (lychee), or prose linting (vale) to CI.');
  }),
  check('mr_template', 'PR/MR Template', 2.0, 'DORA 2025 - working in small batches', (ctx, r) => {
    const found = ctx.hasFile('.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md',
      '.gitlab/merge_request_templates/*.md', 'docs/pull_request_template.md');
    if (found) return r.pass(`PR/MR template found: ${found}`);
    if (ctx.hasDir('.gitlab/merge_request_templates')) return r.pass('GitLab MR template directory found');
    return r.fail('No PR/MR template found',
      'Add .github/PULL_REQUEST_TEMPLATE.md or '
      + '.gitlab/merge_request_templates/Default.md with '
      + 'sections for description, testing, and impact.');
  }),
  check('automated_review', 'Automated Code Review', 2.0, 'OpenAI Harness Engineering - separate authoring and reviewing agents', (ctx, r) => {
    const found = ctx.hasFile('.coderabbit.yaml', '.github/copilot-review.yml', 'renovate.json', '.renovaterc',
      '.renovaterc.json', 'dependabot.yml', '.github/dependabot.yml');
    if (found) return r.pass(`Automated review tool configured: ${found}`);
    const raw = ctx.ciRawContent().toLowerCase();
    for (const kw of ['coderabbit', 'codeclimate', 'sonarqube', 'sonarcloud', 'duo']) {
      if (raw.includes(kw)) return r.pass(`Automated review tool found in CI: ${kw}`);
    }
    return r.fail('No automated review tools found',
      'Configure CodeRabbit, SonarCloud, Dependabot/Renovate, or equivalent '
      + 'for automated review on every PR/MR.');
  }),
  check('doc_sync_check', 'Documentation Sync Check', 2.0, 'OpenAI Harness Engineering - curated knowledge base', (ctx, r) => {
    for (const p of [R`diff\s+.*\.md`, R`doc.*sync`, R`agent.*sync`, R`golden.*check`]) {
      if (ctx.ciHasCommand(p)) return r.pass(`Doc sync check found in CI: ${p}`);
    }
    const raw = ctx.ciRawContent().toLowerCase();
    if (raw.includes('sync') && (raw.includes('doc') || raw.includes('agent'))) {
      return r.pass('Documentation sync job found in CI');
    }
    return r.fail('No documentation sync checks found in CI',
      'Add CI jobs that verify related docs stay in sync '
      + '(e.g. diff AGENTS.md CLAUDE.md, golden fixture checks).');
  }),
];

// ---------------------------------------------------------------------------------------------
// ai_safeguards.py — AI-Specific Safeguards (15%)
// ---------------------------------------------------------------------------------------------

const AI_NORM_FILES = ['claude.md', 'agents.md', 'contributing.md', 'docs/ai-*.md', 'docs/development.md', '.cursor/rules/*.mdc'];
const AI_NORM_PATTERNS = [
  R`ai.*(usage|policy|guideline|norm|review)`,
  R`(review|verify|check).*(ai|generated|agent)`,
  R`(test|tests)\s+before\s+(implement|code|asking)`,
  R`code\s+style`,
  R`(naming|error.handling|comment)\s+(convention|standard|policy)`,
];

const AI_SAFEGUARD_CHECKS = [
  check('ai_usage_norms', 'AI Usage Norms', 4.0, 'DORA 2025 - clear organizational stance on AI use', (ctx, r) => {
    for (const p of AI_NORM_PATTERNS) {
      const found = ctx.searchAnyFile(AI_NORM_FILES, p);
      if (found) return r.pass(`AI usage norms found in ${found}`);
    }
    const agent = ctx.hasFile('claude.md', 'agents.md');
    if (agent) {
      return r.partial(2.0, `Agent file found (${agent}) but no explicit review norms detected`,
        'Add a section on AI review expectations: what reviewers should specifically '
        + 'check in AI-generated code, when to require manual implementation.');
    }
    return r.fail('No AI usage norms documented',
      'Document AI usage policies: review expectations for AI-generated code, '
      + 'when manual implementation is required, testing-before-implementation norms.');
  }),
  check('small_batch_enforcement', 'Small Batch Enforcement', 3.0, 'DORA 2025 - working in small batches', (ctx, r) => {
    if (ctx.ciHasCommand(R`danger|pr-size|diffstat|size-limit`)) return r.pass('PR size check tool found in CI');
    const contributing = ctx.hasFile('contributing.md', 'CONTRIBUTING.md');
    if (contributing && ctx.searchFile(contributing, R`small\s+(pr|mr|batch|change)|size\s+limit|keep.*(small|focused)`)) {
      return r.pass(`Small batch guidelines found in ${contributing}`);
    }
    const agent = ctx.hasFile('claude.md', 'agents.md');
    if (agent && ctx.searchFile(agent, R`small|batch|incremental|focused`)) {
      return r.partial(1.5, `Small batch hints found in ${agent}`,
        'Add explicit PR size guidelines or automated size checks to CI.');
    }
    return r.fail('No small batch enforcement found',
      'Add PR size checks (Danger, pr-size-labeler) or document size guidelines '
      + 'in CONTRIBUTING.md. Large AI-generated PRs are harder to review.');
  }),
  check('multiple_approach_culture', 'Design-Before-Code Culture', 3.0, 'Blog: cognitive offloading guardrails', (ctx, r) => {
    const dir = ctx.hasDir('docs/rfcs', 'rfcs', 'docs/proposals', 'docs/designs');
    if (dir) return r.pass(`RFC/design document directory found: ${dir}`);
    const docs = ctx.findFiles('docs/*plan*.md', 'docs/*design*.md', 'docs/*rfc*.md', 'docs/*proposal*.md', 'docs/phase-*.md');
    if (docs.length) return r.pass(`Design/plan documents found: ${docs.slice(0, 3).join(', ')}`);
    const agent = ctx.hasFile('claude.md', 'agents.md');
    if (agent && ctx.searchFile(agent, R`plan.*before|design.*first|multiple.*approach|spec\.md|plan\.md`)) {
      return r.pass(`Plan-before-code workflow documented in ${agent}`);
    }
    if (ctx.hasDir('.cursor/rules')) {
      for (const rf of ctx.findFiles('.cursor/rules/*.mdc')) {
        if (ctx.searchFile(rf, R`plan|design|spec`)) return r.pass(`Plan-driven development rule found in ${rf}`);
      }
    }
    return r.fail('No design-before-code process found',
      'Create docs/rfcs/ or docs/designs/ directory. Document a process where '
      + 'significant changes start with a design doc or plan before implementation.');
  }),
  check('error_handling_policy', 'Error Handling Policy', 3.0, 'Blog: AI agents deleting tests, using expect()', (ctx, r) => {
    const cargo = ctx.hasFile('cargo.toml');
    if (cargo && ctx.searchFile(cargo, R`unwrap_used|expect_used`)) return r.pass('Clippy panic-prevention lints configured');
    if (ctx.ciHasCommand(R`clippy.*unwrap_used|clippy.*expect_used`)) return r.pass('Panic-prevention clippy lints in CI');
    const eslintrc = ctx.hasFile('.eslintrc.json', '.eslintrc.yml', 'eslint.config.js');
    if (eslintrc && ctx.searchFile(eslintrc, R`no-throw-literal|no-implicit-coercion`)) {
      return r.pass('Error handling ESLint rules configured');
    }
    const agent = ctx.hasFile('claude.md', 'agents.md');
    if (agent && ctx.searchFile(agent, R`error.handling|unwrap|expect|panic|Result.*\?`)) {
      return r.partial(1.5, `Error handling guidelines found in ${agent}`,
        'Enforce error handling rules mechanically via lints, not just documentation.');
    }
    return r.fail('No error handling policy found',
      'Add clippy lints (unwrap_used, expect_used) for Rust, '
      + 'ESLint rules for JS/TS, or document error handling patterns in agent instructions.');
  }),
  check('security_critical_marking', 'Security-Critical Path Marking', 2.0, 'Blog: 80% problem in security infrastructure', (ctx, r) => {
    const owners = ctx.hasFile('CODEOWNERS', '.github/CODEOWNERS');
    if (owners) return r.pass(`CODEOWNERS found: ${owners}`);
    const sec = ctx.hasFile('SECURITY.md', 'security.md');
    if (sec) return r.pass(`Security policy found: ${sec}`);
    if (ctx.ciHasCommand(R`sast|dast|semgrep|bandit|gosec|brakeman`)) return r.pass('Security scanning in CI');
    return r.fail('No security-critical path marking found',
      'Add CODEOWNERS for sensitive directories, SECURITY.md for vuln reporting, '
      + 'or SAST scanning in CI.');
  }),
];

/** `ALL_CHECKS` — category id → its checks, in upstream's order. */
export const ALL_CHECKS = {
  documentation: DOCUMENTATION_CHECKS,
  constraints: CONSTRAINT_CHECKS,
  testing: TESTING_CHECKS,
  review: REVIEW_CHECKS,
  ai_safeguards: AI_SAFEGUARD_CHECKS,
};
