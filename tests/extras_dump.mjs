/**
 * Node's half of the OpenCode-extras parity gate. Driven by
 * tests/test_opencode_extras_parity.py.
 *
 * Each `extras` job runs the writers in the SAME sequence `emit_opencode` runs them, so
 * the cell exercises a realistic composition rather than seven isolated calls. Results go
 * to files; stdout carries only what the Python's own writers put there (the
 * agent-overrides staleness notice), and the test compares it.
 *
 * The `jsondump` job kind renders a corpus of containers through both `jsonDumpsIndent`
 * variants. It is a job kind rather than a separate script because the question it settles
 * -- do Python's indent-2 separators really match JSON.stringify's -- is the reason this
 * whole unit exists, and it should fail in the same run as the writers that depend on it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  writeTheme, writeColorThemes, ensureAgentOverridesStub, writePrimaryAgent,
  writeCommandLayer, writePonytailCommand, copyPlugins, copyWorkflows,
} from '../js/opencode.mjs';
import { loadAgentOverrides } from '../js/native.mjs';
import { parseJson, jsonDumpsCompact, jsonDumpsIndent } from '../js/lib/pyfs.mjs';

const jobs = parseJson(readFileSync(process.argv[2], 'utf8'));
const ENV_KEYS = ['GENESEED_PRIMARY', 'GENESEED_COMMANDS'];

for (const job of jobs) {
  if (job.kind === 'jsondump') {
    const corpus = parseJson(readFileSync(job.corpusFile, 'utf8'));
    writeFileSync(job.resultFile, JSON.stringify({
      ascii: corpus.map((o) => jsonDumpsIndent(o)),
      raw: corpus.map((o) => jsonDumpsIndent(o, { ensureAscii: false })),
      // The COMPACT form, which cannot delegate to JSON.stringify at all: without an indent
      // Python's separators are `(', ', ': ')`. Its callers live in js/settings.mjs; the
      // measurement stays here so one corpus answers the whole separator question.
      compact: corpus.map((o) => jsonDumpsCompact(o)),
      sorted: corpus.map((o) => jsonDumpsCompact(o, { sortKeys: true })),
    }), 'utf8');
    continue;
  }

  // `_truthy_env` reads os.environ at call time, so the flags are set per job.
  for (const k of ENV_KEYS) {
    if (job.env && Object.prototype.hasOwnProperty.call(job.env, k)) process.env[k] = job.env[k];
    else delete process.env[k];
  }

  const cfg = {
    src: job.src,
    config: job.config,
    colorThemes: job.colorThemes,
    pluginSrc: job.pluginSrc,
    workflowSrc: job.workflowSrc,
    primaryAgentSrc: job.primaryAgentSrc,
  };
  const items = parseJson(readFileSync(job.itemsFile, 'utf8'))
    .map(([rel, text, src]) => ({ rel, text, src }));
  const theme = parseJson(readFileSync(job.themeFile, 'utf8'));
  const oc = job.cfgDir;
  const rel = (p) => (p === null ? null : path.relative(oc, p).split(path.sep).join('/'));

  // The order `emit_opencode` runs them in.
  ensureAgentOverridesStub(cfg, job.base);
  const overrides = loadAgentOverrides(job.base);
  const primary = writePrimaryAgent(cfg, path.join(oc, 'agents'), overrides);
  const commands = writeCommandLayer(cfg, items, path.join(oc, 'command'));
  commands.push(writePonytailCommand(path.join(oc, 'command')));
  const themeFile = writeTheme(path.join(oc, 'themes'), job.themeName, theme);
  const colorThemes = writeColorThemes(cfg, path.join(oc, 'themes'));
  const owned = [];
  const nPlugins = copyPlugins(cfg, path.join(oc, 'plugins'), owned);
  const nWorkflows = copyWorkflows(cfg, path.join(oc, 'workflows'), owned);

  writeFileSync(job.resultFile, JSON.stringify({
    primary: rel(primary),
    commands: commands.map(rel),
    themeFile: rel(themeFile),
    colorThemes: colorThemes.map(rel),
    nPlugins,
    nWorkflows,
    owned,
  }), 'utf8');
}
