// EVERY CAPTURING SPAWN HIDES ITS CONSOLE — the half of `tests/test_spawn_hygiene.py` that
// survives the reference, and a property no corpus can hold.
//
// A CONSOLE WINDOW IS NOT A BYTE. The windowless daemon popped one per child — `node --check`
// seven times on the dashboard — and every one of 691 recorded cells was byte-identical through
// it. A HUMAN USING THE PRODUCT found it. So the gate cannot be a comparison of output; it has
// to read the SOURCE, which is why `tests/mutate.mjs`'s M9 was carried as ungated until this
// file existed.
//
// CAPTURING ONLY, and the rule is the reference's: a spawn that INHERITS its parent's streams
// must not set the flag, because on an inherited-stream spawn the hide discards the child's
// stdout outright — a live bug this project already shipped once.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIRS = ['js', 'bin'];
// The floor under the positive control. Measured at 24 today; a scanner that has stopped
// matching reports zero and every assertion below becomes vacuously true.
const MIN_SPAWNS = 10;

function sources() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs')) out.push(p);
    }
  };
  for (const d of DIRS) walk(path.join(ROOT, d));
  return out;
}

/**
 * Every spawn call in one source, as `{ line, callee, body }`.
 *
 * BRACE-MATCHED rather than line-regexed, because the options object is what the assertion is
 * about and it routinely spans lines. The scan walks forward from the opening paren counting
 * depth, so a nested object or an inline arrow inside the call is part of the body rather than
 * an early terminator.
 */
function spawnCalls(text) {
  const out = [];
  const re = /\b(spawnSync|spawn|execFileSync|execSync|execFile)\s*\(/g;
  for (const m of text.matchAll(re)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let i = open;
    for (; i < text.length; i += 1) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') { depth -= 1; if (depth === 0) break; }
    }
    out.push({
      line: text.slice(0, m.index).split('\n').length,
      callee: m[1],
      body: text.slice(open, i + 1),
    });
  }
  return out;
}

// `stdio: 'inherit'`, or a file descriptor handed straight to the child. The detached spawn
// passes an OPEN FD as both streams — the child writes to the log through a real handle, which
// is the inheriting case even though the word never appears.
const inherits = (body) => body.includes("'inherit'") || body.includes('"inherit"')
  || /stdio:\s*\[\s*'ignore',\s*\w+,\s*\w+\s*\]/.test(body);

test('the scan finds the spawn sites at all', () => {
  const found = sources().reduce((n, p) => n + spawnCalls(fs.readFileSync(p, 'utf8')).length, 0);
  assert.ok(found >= MIN_SPAWNS,
    `the scanner found ${found} spawn calls under ${DIRS.join('/')}, which is too few to be `
    + 'real — the pattern has stopped matching and this file now asserts nothing');
});

test('no capturing spawn is missing windowsHide', () => {
  const missing = [];
  for (const p of sources()) {
    const text = fs.readFileSync(p, 'utf8');
    for (const { line, callee, body } of spawnCalls(text)) {
      if (inherits(body)) continue;
      if (body.includes('windowsHide') || body.includes('NO_WINDOW')) continue;
      missing.push(`${path.relative(ROOT, p).split(path.sep).join('/')}:${line} ${callee}(...)`);
    }
  }
  assert.deepEqual(missing, [],
    'these capturing spawns will pop a console window each when the windowless daemon reaches '
    + 'them — spread `...NO_WINDOW` from js/lib/proc.mjs into the options object');
});

// ONE OWNER. A second private `const NO_WINDOW` is how two sites lost the flag: the rule stops
// being inherited by the next spawn site and starts being re-decided at each one.
test('the flag comes from the shared module', () => {
  const owners = [];
  for (const p of sources()) {
    if (path.basename(p) === 'proc.mjs') continue;
    if (/^\s*(?:const|let|var)\s+NO_WINDOW\s*=/m.test(fs.readFileSync(p, 'utf8'))) {
      owners.push(path.relative(ROOT, p).split(path.sep).join('/'));
    }
  }
  assert.deepEqual(owners, [],
    'these define their own NO_WINDOW; import it from js/lib/proc.mjs so the next spawn site '
    + 'inherits the rule instead of re-deciding it');
});

// AND THE SHARED OWNER MUST ACTUALLY SET THE FLAG — which the three scans above cannot tell you.
//
// They assert that every capturing call site SPELLS `...NO_WINDOW`, and that only one module
// defines it. Both stay green if that module is emptied to `{}`: the sites still reference the
// name, the name still has one owner, and every spawn on Windows quietly pops a console again.
// `tests/mutate.mjs`'s M9 survived exactly that way, which is how this assertion got written.
//
// A GATE ON A REFERENCE IS NOT A GATE ON THE VALUE. The scans are structural and this one is
// behavioural, and neither substitutes for the other: the scans catch a new call site that
// forgot the flag, this catches the flag itself going hollow.
test('the shared flag is actually set on Windows', async () => {
  const { NO_WINDOW } = await import('../../js/lib/proc.mjs');
  assert.equal(NO_WINDOW.windowsHide, process.platform === 'win32',
    'NO_WINDOW does not hide the console on this platform — every capturing spawn still names '
    + 'it, every scan above is still green, and the daemon pops a window per child');
});

// THERE IS NO INVERSE ASSERTION HERE, AND A DRAFT OF THIS FILE WRONGLY ADDED ONE.
//
// The reasoning looked sound: a gate that only ever says "add the flag" is satisfied by adding
// it everywhere, and this project HAS shipped a live bug where hiding the console on an
// inherited-stream spawn discarded the child's stdout. So the draft asserted that no inheriting
// spawn may set the flag.
//
// Three real call sites say otherwise — `js/hosts/link.mjs:136`, `js/maintain/update.mjs:890` and
// `js/web/server.mjs:781` all inherit AND hide, and all three are correct. The finding the
// assertion was built on is about Python's `CREATE_NO_WINDOW` CREATION FLAG, which suppresses
// the console the child would have written through. Node's `windowsHide` is a different
// mechanism (`STARTF_USESHOWWINDOW`/`SW_HIDE`), and with inherited stdio the child writes to the
// PARENT's handles, so there is nothing to discard.
//
// A port test that asserts a property the reference does not have is a test that gets "fixed"
// by breaking the port — the same mistake `tests/unit/destamp.test.mjs` records for the node
// banner. The inverse is left unasserted, deliberately and here rather than in silence.
