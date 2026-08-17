#!/usr/bin/env node
/**
 * Drive the token-report port's Python primitives from a JSON corpus on stdin.
 *
 * ITS CALLER IS `tests/unit/token_report.test.mjs`, which spawns this file over the recorded
 * corpus in `tests/__snapshots__/token_report_primitives.json` — 266 rows whose answers were
 * taken from the real Python builtins while an oracle still existed to ask. The point of the
 * arrangement is that a primitive is gated over a CORPUS rather than over whatever numbers a
 * seeded transcript happens to produce: two `pyFixed` defects survived a fully green
 * behavioural suite before it existed. ⚠ The recording is frozen — nothing left can re-answer
 * a row — so this probe must keep reporting exactly what the port computes, unsmoothed.
 *
 * Input:  argv[2] = path to a JSON file [[fn, [args...]], ...] — a PATH rather than
 * stdin, because stdin redirection on Windows is the one transport this repository has
 * already been burned by.
 * Output: [result, ...] as JSON on stdout.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = path.resolve(HERE, '..', '..', 'src', 'skills', 'token-report',
  'scripts', 'token_report.mjs');

const fns = await import(new URL(`file://${PORT.replace(/\\/g, '/')}`).href);

const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = corpus.map(([name, args]) => {
  const fn = fns[name];
  if (typeof fn !== 'function') return `NO SUCH EXPORT: ${name}`;
  try {
    return fn(...args);
  } catch (e) {
    return `THREW: ${e.message}`;
  }
});
process.stdout.write(JSON.stringify(out));
