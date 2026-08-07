/**
 * Node's half of the native-layer parity gate. Driven by tests/test_native_layer_parity.py.
 *
 * Reads a jobs file and runs each job. Two job kinds:
 *
 *   native — call `writeNativeLayer` with the SAME items the Python side used (dumped to
 *            disk by the test, not re-rendered here), so the only variable under test is
 *            the native layer itself. `js/render.mjs` has its own parity gate.
 *   pynum  — render a list of JSON number literals through `parseJson` + `pyStr`, which is
 *            how `temperature:` and `steps:` reach an emitted file. Its own job kind
 *            because the divergence it guards (`1.0` -> `1`) is invisible to any gate that
 *            works by emitting a bundle: the emit always writes an EMPTY overrides stub.
 *
 * RESULTS GO TO FILES, NEVER TO STDOUT. The test asserts this process printed nothing on
 * stdout at all. That is not tidiness — the emitted git-gate and rule-gate hooks signal
 * their verdict as JSON on stdout and return 0 on every path, so one stray byte written by
 * anything on that code path turns a blocking gate into a silently permissive one that
 * still reports success. Warnings belong on stderr, and the test compares them.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { writeNativeLayer, loadAgentOverrides } from '../js/native.mjs';
import { parseJson, pyStr } from '../js/lib/pyfs.mjs';

// parseJson, so a synthetic `theme` in a job arrives exactly as `loadTheme` would have
// delivered it — with the int/float distinction Python's json keeps and JSON.parse drops.
const jobs = parseJson(readFileSync(process.argv[2], 'utf8'));

for (const job of jobs) {
  if (job.kind === 'pynum') {
    const out = job.literals.map((lit) => {
      try {
        return pyStr(parseJson(lit));
      } catch (e) {
        return `<${e.constructor.name}>`;
      }
    });
    writeFileSync(job.resultFile, JSON.stringify(out), 'utf8');
    continue;
  }

  const items = JSON.parse(readFileSync(job.itemsFile, 'utf8'))
    .map(([rel, text, src]) => ({ rel, text, src }));
  const overrides = job.overridesBase ? loadAgentOverrides(job.overridesBase) : {};
  const { nAgents, nSkills, written } = writeNativeLayer(
    items, job.agentsDir, job.skillsDir, overrides,
    {
      host: job.host,
      oldOwned: job.oldOwned,
      cfg: job.cfg,
      manifestExisted: job.manifestExisted,
      theme: job.theme,
      src: job.src,
    });
  writeFileSync(job.resultFile, JSON.stringify({
    nAgents,
    nSkills,
    // Relativised the way every caller does it before the path reaches a manifest.
    // Against `relBase`, not `cfg`: `cfg` is null when claim-on-create is off, but the
    // caller still relativises the written paths into its ownership manifest.
    written: written.map((p) => path.relative(job.relBase, p).split(path.sep).join('/')),
  }), 'utf8');
}
