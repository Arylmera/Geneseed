/**
 * The number-formatting primitives behind the token-report skill.
 *
 * WHY THEY ARE PINNED THIS HARD. `src/skills/token-report/scripts/token_report.mjs` renders a
 * usage report a human reads and acts on, and every figure in it goes through one of the
 * fourteen functions below. The failure mode is not a crash — it is a report that is quietly
 * off by one in the last digit, which nobody notices and everybody trusts.
 *
 * Two rounding defects reached a fully green behavioural suite before this table existed: the
 * first because a written proof that `.1f` could not tie was false, the second because the fix
 * scaled by ten and manufactured a tie the real value never had. That is the argument for a
 * table over a seeded transcript — a transcript exercises the numbers it happens to produce,
 * which is not the same property. The ties below are chosen, not sampled.
 *
 * ⚠ HALF-TO-EVEN, NOT HALF-UP. `pyFixed(0.5, 0)` is `'0'` and `pyFixed(1.5, 0)` is `'2'` —
 * the rule that surprises everyone who expects `toFixed`. It is deliberate: these numbers are
 * summed and re-summed across a report, and half-up biases every total upward.
 *
 * The functions run in a child process through `tests/fixtures/token_report_probe.mjs` because
 * the script is a skill asset on a product path, not an importable module.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { makeSandbox } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PROBE = path.join(ROOT, 'tests', 'fixtures', 'token_report_probe.mjs');
const SCRIPT = path.join(ROOT, 'src', 'skills', 'token-report', 'scripts', 'token_report.mjs');

const sign = (n) => (n > 0 ? 1 : 0) - (n < 0 ? 1 : 0);

// `pyStrCmp` and `comparePaths` return an ordering whose MAGNITUDE is unspecified; only the
// sign is a promise, so only the sign is compared.
const SIGN_ONLY = new Set(["pyStrCmp","comparePaths"]);

// ⚠ THE TWO INPUTS DELIBERATELY LEFT OUT, and asserted below to still be out. Excluding a case
// and hiding it are the same act unless the exclusion is written down and checked. Both are
// consequences of an int/float distinction a JS double cannot carry; `want` is the answer we
// do NOT produce, compared as TEXT because the JSON transport cannot carry it either.
const KNOWN_LIMITS = [
  {
    "fn": "jsonDumps",
    "args": [
      {
        "a": 100000000000000000000
      }
    ],
    "notOut": "{\"a\": 1e+20}",
    "why": "json.loads keeps 1e20 a float, so json.dumps writes 1e+20; JSON.parse yields a double indistinguishable from the integer."
  },
  {
    "fn": "pyInt",
    "args": [
      "99999999999999999999"
    ],
    "notOut": "99999999999999999999",
    "why": "int() is arbitrary precision; pyInt ends in Number(), exactly as js/lib/pyfs.mjs's does - the SHARED ceiling, not a new one."
  }
];

/** Run the probe over `[[fn, args], …]` and return its answers. */
function probe(calls) {
  const sb = makeSandbox('tokrep-');
  try {
    const payload = path.join(sb.path, 'corpus.json');
    writeFileSync(payload, JSON.stringify(calls), 'utf8');
    const r = spawnSync(process.execPath, [PROBE, payload],
      { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, `the probe failed: ${r.stderr}`);
    return JSON.parse(r.stdout);
  } finally {
    sb.cleanup();
  }
}

const PRIMITIVES = {
  pyFixed: [
    { args: [0,0], out: "0" },
    { args: [0.5,0], out: "0" },
    { args: [1.5,0], out: "2" },
    { args: [2.5,0], out: "2" },
    { args: [3.5,0], out: "4" },
    { args: [4.5,0], out: "4" },
    { args: [-0.5,0], out: "-0" },
    { args: [-1.5,0], out: "-2" },
    { args: [-2.5,0], out: "-2" },
    { args: [0.4999999999,0], out: "0" },
    { args: [0.5000000001,0], out: "1" },
    { args: [0.5,0], out: "0" },
    { args: [1.5,0], out: "2" },
    { args: [2.5,0], out: "2" },
    { args: [3.5,0], out: "4" },
    { args: [0.0166666,0], out: "0" },
    { args: [99999.5,0], out: "100000" },
    { args: [100000.5,0], out: "100000" },
    { args: [-0.4,0], out: "-0" },
    { args: [6.25,1], out: "6.2" },
    { args: [6.75,1], out: "6.8" },
    { args: [0.25,1], out: "0.2" },
    { args: [0.75,1], out: "0.8" },
    { args: [1.25,1], out: "1.2" },
    { args: [12.5,1], out: "12.5" },
    { args: [2.55,1], out: "2.5" },
    { args: [2.55,1], out: "2.5" },
    { args: [0.05,1], out: "0.1" },
    { args: [0.15,1], out: "0.1" },
    { args: [0.35,1], out: "0.3" },
    { args: [33.333333333,1], out: "33.3" },
    { args: [66.66666666,1], out: "66.7" },
    { args: [99.95,1], out: "100.0" },
    { args: [99.99,1], out: "100.0" },
    { args: [100,1], out: "100.0" },
    { args: [0,1], out: "0.0" },
    { args: [5000,1], out: "5000.0" },
    { args: [0.049999,1], out: "0.0" },
    { args: [1e-9,1], out: "0.0" },
    { args: [37.9,1], out: "37.9" },
    { args: [55.2,1], out: "55.2" },
    { args: [6.2499999999,1], out: "6.2" },
    { args: [6.2500000001,1], out: "6.3" },
    { args: [-6.25,1], out: "-6.2" },
    { args: [6.25,1], out: "6.2" },
    { args: [12.5,1], out: "12.5" },
    { args: [37.5,1], out: "37.5" },
  ],
  pyRound: [
    { args: [0.5], out: 0 },
    { args: [1.5], out: 2 },
    { args: [2.5], out: 2 },
    { args: [-0.5], out: 0 },
    { args: [-1.5], out: -2 },
    { args: [0], out: 0 },
    { args: [2.4999], out: 2 },
    { args: [2.5001], out: 3 },
    { args: [1000000000000000.5], out: 1000000000000000 },
  ],
  fmt: [
    { args: [0], out: "0" },
    { args: [1], out: "1" },
    { args: [999], out: "999" },
    { args: [1000], out: "1,000" },
    { args: [1234], out: "1,234" },
    { args: [1000000], out: "1,000,000" },
    { args: [1234567], out: "1,234,567" },
    { args: [2500000], out: "2,500,000" },
    { args: [999999999], out: "999,999,999" },
    { args: [-1234], out: "-1,234" },
    { args: [-1000], out: "-1,000" },
    { args: [0.5], out: "0" },
    { args: [1.5], out: "2" },
    { args: [1234.5], out: "1,234" },
    { args: [1000.4], out: "1,000" },
  ],
  pct: [
    { args: [0,0], out: "–" },
    { args: [5,0], out: "–" },
    { args: [1,20], out: "5.0%" },
    { args: [1,3], out: "33.3%" },
    { args: [2,3], out: "66.7%" },
    { args: [4,64], out: "6.2%" },
    { args: [5100,200000], out: "2.5%" },
    { args: [1,8], out: "12.5%" },
    { args: [3,8], out: "37.5%" },
    { args: [5,8], out: "62.5%" },
    { args: [7,8], out: "87.5%" },
    { args: [500,10], out: "5000.0%" },
    { args: [1,1], out: "100.0%" },
    { args: [0,100], out: "0.0%" },
    { args: [1,7], out: "14.3%" },
    { args: [99,100], out: "99.0%" },
    { args: [1,200000], out: "0.0%" },
  ],
  bar: [
    { args: [0,0], out: "░░░░░░░░░░" },
    { args: [5,0], out: "░░░░░░░░░░" },
    { args: [1,20], out: "░░░░░░░░░░" },
    { args: [1,3], out: "███░░░░░░░" },
    { args: [2,3], out: "███████░░░" },
    { args: [4,64], out: "█░░░░░░░░░" },
    { args: [5100,200000], out: "░░░░░░░░░░" },
    { args: [1,8], out: "█░░░░░░░░░" },
    { args: [3,8], out: "████░░░░░░" },
    { args: [5,8], out: "██████░░░░" },
    { args: [7,8], out: "█████████░" },
    { args: [500,10], out: "██████████" },
    { args: [1,1], out: "██████████" },
    { args: [0,100], out: "░░░░░░░░░░" },
    { args: [1,7], out: "█░░░░░░░░░" },
    { args: [99,100], out: "██████████" },
    { args: [1,200000], out: "░░░░░░░░░░" },
  ],
  estTokens: [
    { args: [0], out: 0 },
    { args: [1], out: 0 },
    { args: [2], out: 0 },
    { args: [3], out: 1 },
    { args: [4], out: 1 },
    { args: [5], out: 1 },
    { args: [6], out: 2 },
    { args: [7], out: 2 },
    { args: [8], out: 2 },
    { args: [9], out: 2 },
    { args: [10], out: 2 },
    { args: [11], out: 3 },
    { args: [12], out: 3 },
    { args: [13], out: 3 },
    { args: [14], out: 4 },
    { args: [15], out: 4 },
    { args: [16], out: 4 },
    { args: [17], out: 4 },
    { args: [18], out: 4 },
    { args: [19], out: 5 },
    { args: [20], out: 5 },
    { args: [21], out: 5 },
    { args: [22], out: 6 },
    { args: [23], out: 6 },
    { args: [24], out: 6 },
    { args: [25], out: 6 },
    { args: [26], out: 6 },
    { args: [27], out: 7 },
    { args: [28], out: 7 },
    { args: [29], out: 7 },
    { args: [30], out: 8 },
    { args: [31], out: 8 },
    { args: [32], out: 8 },
  ],
  pyLen: [
    { args: [""], out: 0 },
    { args: ["abc"], out: 3 },
    { args: ["é"], out: 1 },
    { args: ["éé"], out: 2 },
    { args: ["世界"], out: 2 },
    { args: ["😀"], out: 1 },
    { args: ["😀😀😀😀😀😀😀😀"], out: 8 },
    { args: ["a😀b"], out: 3 },
    { args: ["é"], out: 2 },
    { args: [" "], out: 1 },
    { args: ["tab\there"], out: 8 },
  ],
  jsonDumps: [
    { args: [{}], out: "{}" },
    { args: [[]], out: "[]" },
    { args: [{"a":1}], out: "{\"a\": 1}" },
    { args: [{"a":1,"b":[1,2]}], out: "{\"a\": 1, \"b\": [1, 2]}" },
    { args: [[1,2,3]], out: "[1, 2, 3]" },
    { args: ["x"], out: "\"x\"" },
    { args: [null], out: "null" },
    { args: [true], out: "true" },
    { args: [false], out: "false" },
    { args: [0], out: "0" },
    { args: [-5], out: "-5" },
    { args: [1.5], out: "1.5" },
    { args: [-0.25], out: "-0.25" },
    { args: [{"é":"ü"}], out: "{\"\\u00e9\": \"\\u00fc\"}" },
    { args: [{"k":"a\nb\tc"}], out: "{\"k\": \"a\\nb\\tc\"}" },
    { args: [{"k":""}], out: "{\"k\": \"\\u007f\"}" },
    { args: [{"k":"😀"}], out: "{\"k\": \"\\ud83d\\ude00\"}" },
    { args: [[{"a":[1,{"b":null}]}]], out: "[{\"a\": [1, {\"b\": null}]}]" },
    { args: [{"a":"with, comma"}], out: "{\"a\": \"with, comma\"}" },
    { args: [{"a":"with: colon"}], out: "{\"a\": \"with: colon\"}" },
    { args: [{"":""}], out: "{\"\": \"\"}" },
    { args: [{"a":1e-7}], out: "{\"a\": 1e-07}" },
    { args: [{"a":-1e-7}], out: "{\"a\": -1e-07}" },
    { args: [{"a":1.7976931348623157e+308}], out: "{\"a\": 1.7976931348623157e+308}" },
  ],
  pyRepr: [
    { args: [""], out: "''" },
    { args: ["abc"], out: "'abc'" },
    { args: ["it's"], out: "\"it's\"" },
    { args: ["say \"hi\""], out: "'say \"hi\"'" },
    { args: ["both ' and \""], out: "'both \\' and \"'" },
    { args: ["a\nb"], out: "'a\\nb'" },
    { args: ["a\\b"], out: "'a\\\\b'" },
    { args: ["a\tb"], out: "'a\\tb'" },
    { args: [""], out: "'\\x7f'" },
    { args: ["é"], out: "'é'" },
    { args: ["😀"], out: "'😀'" },
    { args: [null], out: "None" },
    { args: [true], out: "True" },
    { args: [false], out: "False" },
    { args: [0], out: "0" },
    { args: [-5], out: "-5" },
    { args: [1.5], out: "1.5" },
    { args: [[1,"a",null,true]], out: "[1, 'a', None, True]" },
    { args: [{"a":1,"b":"x"}], out: "{'a': 1, 'b': 'x'}" },
    { args: [[[1,[2,[3]]]]], out: "[[1, [2, [3]]]]" },
    { args: [{"a":[null,false]}], out: "{'a': [None, False]}" },
  ],
  pyStrOfJson: [
    { args: [""], out: "" },
    { args: ["abc"], out: "abc" },
    { args: ["it's"], out: "it's" },
    { args: ["say \"hi\""], out: "say \"hi\"" },
    { args: ["both ' and \""], out: "both ' and \"" },
    { args: ["a\nb"], out: "a\nb" },
    { args: ["a\\b"], out: "a\\b" },
    { args: ["a\tb"], out: "a\tb" },
    { args: [""], out: "" },
    { args: ["é"], out: "é" },
    { args: ["😀"], out: "😀" },
    { args: [null], out: "None" },
    { args: [true], out: "True" },
    { args: [false], out: "False" },
    { args: [0], out: "0" },
    { args: [-5], out: "-5" },
    { args: [1.5], out: "1.5" },
    { args: [[1,"a",null,true]], out: "[1, 'a', None, True]" },
    { args: [{"a":1,"b":"x"}], out: "{'a': 1, 'b': 'x'}" },
    { args: [[[1,[2,[3]]]]], out: "[[1, [2, [3]]]]" },
    { args: [{"a":[null,false]}], out: "{'a': [None, False]}" },
  ],
  pyInt: [
    { args: ["0"], out: 0 },
    { args: ["12"], out: 12 },
    { args: ["+5"], out: 5 },
    { args: ["-5"], out: -5 },
    { args: [" 42 "], out: 42 },
    { args: ["1_000"], out: 1000 },
    { args: [" 1_000 "], out: 1000 },
    { args: ["_1"], out: null },
    { args: ["1_"], out: null },
    { args: ["1__0"], out: null },
    { args: [""], out: null },
    { args: ["abc"], out: null },
    { args: ["0x10"], out: null },
    { args: ["1 2"], out: null },
    { args: ["١٢"], out: 12 },
    { args: ["12.0"], out: null },
    { args: ["  "], out: null },
    { args: ["-0"], out: 0 },
    { args: ["007"], out: 7 },
    { args: ["9007199254740991"], out: 9007199254740991 },
  ],
  pySplitLines: [
    { args: [""], out: [] },
    { args: ["a"], out: ["a"] },
    { args: ["a\n"], out: ["a"] },
    { args: ["a\nb"], out: ["a","b"] },
    { args: ["a\r\nb"], out: ["a","b"] },
    { args: ["a\rb"], out: ["a","b"] },
    { args: ["a\n\nb"], out: ["a","","b"] },
    { args: ["a\u000bb"], out: ["a","b"] },
    { args: ["a\fb"], out: ["a","b"] },
    { args: ["a\u001cb"], out: ["a","b"] },
    { args: ["a\u001db"], out: ["a","b"] },
    { args: ["a\u001eb"], out: ["a","b"] },
    { args: ["ab"], out: ["a","b"] },
    { args: ["a b"], out: ["a","b"] },
    { args: ["a b"], out: ["a","b"] },
    { args: ["a\nb\n"], out: ["a","b"] },
    { args: ["\n"], out: [""] },
    { args: ["\n\n"], out: ["",""] },
  ],
  pyStrCmp: [
    { args: ["a","b"], out: -1 },
    { args: ["b","a"], out: 1 },
    { args: ["a","a"], out: 0 },
    { args: ["a","ab"], out: -1 },
    { args: ["ab","a"], out: 1 },
    { args: ["A","a"], out: -1 },
    { args: ["😀","￿"], out: 1 },
    { args: ["é","z"], out: 1 },
  ],
  comparePaths: [
    { args: ["a b.json","a/b.json"], out: 1 },
    { args: ["a/b.json","a b.json"], out: -1 },
    { args: ["x/y","x/y"], out: 0 },
    { args: ["x","x/y"], out: -1 },
    { args: ["a/z","b"], out: -1 },
  ],
};

test('every primitive answers its table, row for row', () => {
  const calls = [];
  for (const [fn, rows] of Object.entries(PRIMITIVES)) {
    for (const row of rows) calls.push([fn, row.args, row.out]);
  }
  const answers = probe(calls.map(([fn, args]) => [fn, args]));
  assert.equal(answers.length, calls.length, 'the probe dropped cases');
  const bad = [];
  for (let i = 0; i < calls.length; i += 1) {
    const [fn, args, want] = calls[i];
    const have = SIGN_ONLY.has(fn) ? sign(answers[i]) : answers[i];
    if (JSON.stringify(have) !== JSON.stringify(want)) {
      bad.push(`${fn}(${args.map((a) => JSON.stringify(a)).join(', ')}) -> `
        + `${JSON.stringify(have)}, expected ${JSON.stringify(want)}`);
    }
  }
  assert.deepEqual(bad, [], `primitives disagree with the table:\n  ${bad.join('\n  ')}`);
});

test('the two known limits are still limits', () => {
  // If one of these starts AGREEING, the limit closed: move the case into PRIMITIVES and delete
  // the row. A limit nobody rechecks is a rumour.
  const answers = probe(KNOWN_LIMITS.map((l) => [l.fn, l.args]));
  for (let i = 0; i < KNOWN_LIMITS.length; i += 1) {
    const { fn, args, notOut, why } = KNOWN_LIMITS[i];
    assert.notEqual(String(answers[i]), notOut,
      `${fn}(${JSON.stringify(args)}) now produces ${notOut} — a declared limit has closed. `
      + `Move the case into PRIMITIVES and delete this row.\n  the limit was: ${why}`);
  }
});

test('the script these primitives describe still ships, and still names them', () => {
  assert.ok(existsSync(SCRIPT),
    'src/skills/token-report/scripts/token_report.mjs is gone — this whole table is about nothing');
  assert.ok(existsSync(PROBE), 'the probe is gone and nothing here can run');
  const text = readFileSync(SCRIPT, 'utf8');
  for (const name of Object.keys(PRIMITIVES)) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(text),
      `${name} is in the table but no longer named by the script it describes`);
  }
  assert.equal(Object.keys(PRIMITIVES).length, 14, 'the table no longer covers fourteen exports');
});
