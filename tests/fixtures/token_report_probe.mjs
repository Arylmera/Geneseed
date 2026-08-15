#!/usr/bin/env node
/**
 * Drive the token-report port's Python primitives from a JSON corpus on stdin.
 *
 * The twin of `tests/fixtures/sync_themes_probe.{py,mjs}`: the Python half of
 * `tests/test_token_report_parity.py` computes the same answers with the real Python
 * builtins and compares them one at a time, so a primitive is gated over a CORPUS rather
 * than over whatever numbers a seeded transcript happens to produce. Two `pyFixed`
 * defects survived a fully green behavioural suite before this existed.
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
