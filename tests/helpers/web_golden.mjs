// THE WEB CONSOLE REPLAYER — the surviving half of `tests/web_golden.py`.
//
// A cell here is a REQUEST SCRIPT driven over ONE reused connection against a daemon started
// with `--daemon-internal --port 0` in a fresh sandbox. That shape is the point: keep-alive,
// caching and compression are properties of a CONNECTION, and a harness that opened a socket
// per request could not see any of them.
//
// THE SHARED CLOCK IS AN ARGUMENT, not a call. `now` seeds the worlds and the expectations, and
// the reference took it as a parameter precisely so both sides of a live cell got the same
// second; a replay keeps it for the corpus's sake — the recorded bodies carry `<NOW>`/`<OLDER>`/
// `<STALE>` tags computed from it.
//
// WHAT DID NOT CROSS: the `--ref`/`--new` comparison and `--record`.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';

import { cellEnv, makeSandbox } from './sandbox.mjs';
import { ROOT, normalise, snapshot } from './golden.mjs';
import { copyCheckout, destampCli, repoint, seed, subst } from './cli_golden.mjs';

// The five response headers a cell observes. Everything else — Date, Server, Connection — is
// either a clock or a constant, and neither is what these cells are about.
const HEADERS = ['Content-Type', 'Content-Length', 'Content-Encoding', 'Vary', 'Cache-Control'];

// A positive integer no operating system can have handed out: Linux caps `pid_max` at 4,194,304
// and Windows pids are DWORDs. Deliberately not 0 and not -1 — 0 hits the `pid <= 0` guard
// before any syscall (its own seeded case), and a negative would signal every process the user
// owns on POSIX.
const DEAD_PID = 2000000000;

// A job cell starts a REAL child process, so the wait is seconds. 240 x 0.25s is four minutes,
// long enough that exhausting it means the job wedged rather than that the machine was busy.
const POLL_MAX = 240;
const POLL_EVERY = 250;

// The per-run values that live in a RESPONSE BODY rather than in the daemon record, so the
// record-derived stamps cannot reach them. Targeted twice over: each pattern names the FIELD as
// well as the shape of its value.
const WEB_STAMPS = [
  [/"checked_at": "\d{4}-\d{2}-\d{2} \d{2}:\d{2}"/g, '"checked_at": "<WHEN>"'],
  [/"build_time": "\d{4}-\d{2}-\d{2} \d{2}:\d{2}"/g, '"build_time": "<WHEN>"'],
  [/"(job_id|id)": "[0-9a-f]{16}"/g, '"$1": "<JOBID>"'],
  // THE RELEASE LABEL out of the version stamp, wherever a body quotes the line — two cells
  // record it inside a `diff` hunk. It moves only when a human bumps the configured version,
  // which is not a change in anything the web console does, and a corpus that recorded it raw
  // reddens on the next bump for a reason that is not the server. The emit harness already
  // blanks it inside the stamp FILE; this is the same value seen through an HTTP body.
  //
  // ONLY WHERE THE LABEL IS. A stamp line without one produces no tag, exactly as the emit
  // side does it, so "stamped with a release" and "stamped without one" stay distinguishable.
  [/\[release [^\]]+\]/g, '[release <REL>]'],
  // THE INTERPRETER VERSION, REMOVED RATHER THAN TAGGED, and that is the one arm here that
  // deletes instead of replacing. The recorded corpus was taken from a server that ran on an
  // interpreter and published its version; this one has no such field at all, so there is no
  // value on this side to hang a tag on and a tag would simply never appear here. Erasing the
  // key wherever it occurs leaves the two bodies IDENTICAL rather than merely comparable —
  // which is also why it belongs above the line and not below it: the recorded
  // `Content-Length` is recomputed from the normalised body, so once the key is gone from both
  // the header is a real number again on both sides and stays compared.
  [/, "python": (?:"[^"]*"|null)/g, ''],
];

// The same, for values whose LENGTH differs between two runs — which is the question
// `Content-Length` asks, and why these are a separate table.
const WEB_STAMPS_WIDTH = [
  [/"started": \d+(?:\.\d+)?/g, '"started": <T>'],
  [/"duration": \d+(?:\.\d+)?/g, '"duration": <SECS>'],
  // THE REPLACEMENT IS `'$$ <ARGV>\\n'` AND NOT `'$$ <ARGV>\\\\n'`, and that is a genuine
  // difference between the two substitution languages rather than a typo. Python's `re.sub`
  // treats the replacement as a TEMPLATE — `\\` in it means one literal backslash — so the
  // reference's `'$ <ARGV>\\\\n'` emits `\n` as two characters, which is what a newline looks
  // like inside a JSON string. JavaScript's `String.replace` gives `\` no meaning in the
  // replacement at all (only `$` is special), so the same spelling would emit one backslash too
  // many. It cost the last of 114 cells, reported as VACUOUS because the cell's own `expect`
  // names the tag it produces.
  [/(?<=: ")\$ (?:[^"\\]|\\.)*?\\n/g, '$$ <ARGV>\\n'],
  [/(?<=\\n)\$ (?:[^"\\]|\\.)*?\\n/g, '$$ <ARGV>\\n'],
];

function webDestamp(data) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { return data; }
  for (const [pat, repl] of [...WEB_STAMPS, ...WEB_STAMPS_WIDTH]) text = text.replace(pat, repl);
  return Buffer.from(text, 'utf8');
}

/** Does this body carry a normalised value whose LENGTH differs between two runs? */
function widthVaries(body) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { return false; }
  return WEB_STAMPS_WIDTH.some(([pat]) => new RegExp(pat.source).test(text));
}

/**
 * The two DATES `rules promote` stamps, derived from the cell's own clock rather than
 * destamped — a destamp would erase the one rule that endpoint owns (a month of probation, not
 * a week and not none) and leave two servers that both wrote the wrong date agreeing forever.
 */
export function clockRepl(now) {
  const day = 86400000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  // `date.fromtimestamp` is LOCAL; `toISOString` is UTC. The offset is subtracted so the two
  // agree on which calendar day `now` falls in — the recorded corpus carries the recording
  // machine's local date, and a replay in another zone would otherwise name the day before.
  const local = now * 1000 - new Date(now * 1000).getTimezoneOffset() * 60000;
  return { '{today}': iso(local), '{trial}': iso(local + 30 * day) };
}

/** The four per-run values the SERVER owns, in every spelling a cell can observe them in. */
function dynStamps(record, port, pid) {
  const out = [];
  const token = String(record.token || '');
  if (token) out.push([token, '<TOKEN>']);
  out.push([`http://127.0.0.1:${port}`, 'http://127.0.0.1:<PORT>']);
  out.push([`"port": ${port}`, '"port": <PORT>']);
  out.push([`"pid": ${pid}`, '"pid": <PID>']);
  return out;
}

/**
 * The four per-run values the HARNESS owns. Both sides of a live cell share them, so the live
 * gate compared them in full and needed nothing here — but a corpus recorded on Tuesday is
 * replayed by a different process on Thursday.
 *
 * Targeted, so the DELIBERATE constants beside them — `"pid": 0`, `"pid": "not-a-pid"`, the
 * impossible pid — stay byte-compared. Tagging those would make the live/dead partition
 * unreadable in the corpus, and that partition is what the `_is_live` cells are for.
 */
function corpusStamps(now, harnessPid) {
  const out = [];
  for (const field of ['updated_at', 'turn_started_at']) {
    for (const [value, tag] of [[now, 'NOW'], [now - 600, 'OLDER'], [now - 3600, 'STALE']]) {
      out.push([`"${field}": ${value}`, `"${field}": <${tag}>`]);
    }
  }
  out.push([`"pid": ${harnessPid}`, '"pid": <HARNESS-PID>']);
  out.push([`"pid": "${harnessPid}"`, '"pid": "<HARNESS-PID>"']);
  return out;
}

// THE HASH OF A VALUE THE OTHER TABLE JUST TAGGED — the one rot a normaliser cannot reach by
// naming a field. The rules endpoints answer with a `fingerprint` over the WHOLE rules file, and
// `promote` writes two dates into that file from the server's clock. The dates are tagged; a
// hash taken over them BEFORE they were tagged cannot be. Scoped to the cells that CAUSE it
// rather than to the field: 14 web cells carry a fingerprint, only the 2 that promote move, and
// one of the other twelve is the cell where that value IS the subject.
const PROMOTED = /, promoted \d{4}-\d{2}-\d{2}/;
const RULES_FINGERPRINT = /("fingerprint": ")[0-9a-f]{16}(?=")/g;

export function webCorpusNormalise(snap, now, harnessPid) {
  if (typeof snap === 'string') return snap;
  const stamps = corpusStamps(now, harnessPid);
  const out = new Map();
  for (const [k, v] of snap) out.set(k, applyStamps(v, stamps));
  if ([...out.values()].some((v) => PROMOTED.test(v.toString('latin1')))) {
    for (const [k, v] of out) {
      out.set(k, Buffer.from(v.toString('utf8').replace(RULES_FINGERPRINT, '$1<RULES-FP>'),
        'utf8'));
    }
  }
  return out;
}

function applyStamps(data, stamps) {
  let text = data.toString('utf8');
  for (const [oldS, newS] of stamps) text = text.split(oldS).join(newS);
  return Buffer.from(text, 'utf8');
}

/**
 * A gzipped response, compared as the bytes a CLIENT ends up with.
 *
 * THE COMPRESSED FORM IS NOT COMPARABLE AND CHASING IT WOULD BE THE WRONG WORK. Two of the three
 * differences are cosmetic (the member header's MTIME and OS byte), and the third is not: the
 * DEFLATE STREAMS THEMSELVES differ, 753 bytes against 751 for one asset. Neither side chose
 * that — it is the zlib build each runtime links, at identical level and window settings, and a
 * port cannot fix it or be blamed for it. So the branch is gated on what it MEANS: the header
 * says gzip, the body inflates, and it inflates to exactly the bytes the uncompressed cell
 * serves. The compressed LENGTH is tagged rather than dropped, so "Content-Length is still set"
 * — which is what keep-alive depends on — stays gated.
 */
function decodeBody(body, encoding) {
  if (!(encoding || '').includes('gzip')) return body;
  return zlib.gunzipSync(body);
}

/**
 * Poll the sandbox for the daemon record the started server writes.
 *
 * Found by GLOB rather than by resolving the config dir here: a second implementation of that
 * resolution in the gate is a second thing that can be wrong. Also catches a server that dies on
 * startup, which would otherwise be a 30-second hang per cell.
 */
async function waitForRecord(sb, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return null;
    const hits = findRecords(sb);
    if (hits.length) {
      try {
        const rec = JSON.parse(fs.readFileSync(hits[0], 'utf8'));
        if (rec && rec.port) return rec;
      } catch { /* half-written: try again */ }
    }
    await sleep(50);
  }
  return null;
}

function findRecords(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findRecords(p, out);
    else if (e.name === '.geneseed-web.json') out.push(p);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Run a cell's request script over ONE connection and return its observations.
 *
 * ONE SOCKET, held open across the whole script. `keepAlive` with `maxSockets: 1` is Node's way
 * of saying what `http.client.HTTPConnection` says by construction; a cell that declares
 * `reconnect` gets a fresh agent, which is the only way the script can ask for a new connection.
 *
 * NO `Accept-Encoding` UNLESS THE CELL SENDS ONE. The gzip branch is chosen by the header's
 * presence, so a harness that added one by default would make every cell take it. Node does not
 * add it; Python's client does, which is why the reference passes `skip_accept_encoding=True`.
 */
async function drive(port, token, requests) {
  const obs = new Map();
  let last = {};
  let agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    for (let i = 1; i <= requests.length; i += 1) {
      const r = requests[i - 1];
      if (r.reconnect) {
        agent.destroy();
        agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
      }
      const headers = { ...r.headers };
      if (r.token) headers['X-Geneseed-Token'] = token;
      let body = r.body === null || r.body === undefined ? null : Buffer.from(r.body);
      let reqPath = r.path;

      if (r.from_body !== null && r.from_body !== undefined && reqPath.includes('{FROM_BODY}')) {
        const val = last[r.from_body];
        if (val === undefined || val === null || val === '') {
          obs.set(`<r${i} from_body ${r.from_body} MISSING>`,
            Buffer.from('the previous response carried no such field', 'utf8'));
        }
        reqPath = reqPath.split('{FROM_BODY}').join(val === undefined || val === null ? '' : String(val));
      }
      if (r.from_body !== null && r.from_body !== undefined && body !== null) {
        const val = last[r.from_body];
        if (val === undefined || val === null || val === '') {
          // FAIL LOUD. An empty substitution sends a stale fingerprint, the endpoint takes its
          // 409 arm, and a cell written to gate the FRESH arm compares two 409s and looks green.
          obs.set(`<r${i} from_body ${r.from_body} MISSING>`,
            Buffer.from('the previous response carried no such field', 'utf8'));
        }
        body = Buffer.from(body.toString('utf8')
          .split('{FROM_BODY}')
          .join(val === undefined || val === null ? '' : String(val)), 'utf8');
        obs.set(`<r${i} sent>`, body);
      }
      if (body !== null) {
        if (!hasHeader(headers, 'Content-Type')) headers['Content-Type'] = 'application/json';
        if (!hasHeader(headers, 'Content-Length')) headers['Content-Length'] = String(body.length);
      }

      let res = null;
      const attempts = r.poll ? POLL_MAX : 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt) await sleep(POLL_EVERY);
        res = await once(port, agent, r.method, reqPath, headers, body);
        if (!r.poll) break;
        try {
          if (JSON.parse(res.body.toString('utf8')).status !== 'running') break;
        } catch { break; }
      }

      const enc = headerOf(res.headers, 'content-encoding') || '';
      const bodyOut = decodeBody(res.body, enc);
      // Content-Length is tagged in exactly two situations, and both are the same rule: the
      // length is a CONSEQUENCE of a value this harness has already decided it cannot compare,
      // so comparing the length would re-introduce the comparison through the back door. Its
      // PRESENCE stays gated, which is what the tag is for.
      const untagged = !enc.includes('gzip') && !widthVaries(bodyOut);
      obs.set(`<r${i} status>`, Buffer.from(`${res.statusCode} ${res.statusMessage}`, 'utf8'));
      obs.set(`<r${i} headers>`, Buffer.from(res.orderedHeaders
        .filter(([k]) => HEADERS.includes(title(k)))
        .map(([k, v]) => `${k}: ${(untagged || title(k) !== 'Content-Length') ? v : '<CLEN>'}`)
        .join('\n'), 'utf8'));
      obs.set(`<r${i} body>`, bodyOut);
      try {
        const parsed = JSON.parse(bodyOut.toString('utf8'));
        last = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch { last = {}; }
    }
  } catch (e) {
    obs.set('<transport>', Buffer.from(`${e.constructor.name}: ${e.message}`, 'utf8'));
  } finally {
    agent.destroy();
  }
  return obs;
}

const title = (k) => k.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
  .join('-');
const hasHeader = (h, name) => Object.keys(h).some((k) => k.toLowerCase() === name.toLowerCase());
const headerOf = (h, lower) => h[lower];

function once(port, agent, method, reqPath, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers, agent },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          // `rawHeaders` preserves the order and the spelling the server sent, which the
          // recorded `<rN headers>` column is a transcript of.
          const ordered = [];
          for (let i = 0; i < res.rawHeaders.length; i += 2) {
            ordered.push([res.rawHeaders[i], res.rawHeaders[i + 1]]);
          }
          resolve({
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            orderedHeaders: ordered,
            body: Buffer.concat(chunks),
          });
        });
        res.on('error', reject);
      });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    if (body !== null) req.write(body);
    req.end();
  });
}

/**
 * Graceful stop, then a kill. NEVER throws.
 *
 * It runs in a `finally`, so anything it throws replaces the finding the cell was about to
 * report — and worse, it throws BEFORE the kill, leaving the server running. The reference found
 * that with a mutation that stopped writing the daemon record: `stop` raised parsing a port out
 * of nothing, and the whole run died with one orphaned server per cell instead of reporting
 * fifteen cells whose server never came up. A harness that leaks a process per failed cell eats
 * the port and then the machine.
 */
async function stopServer(record, child) {
  try {
    if (record && record.port) {
      await once(Number(record.port), undefined, 'POST', '/api/shutdown', {
        'X-Geneseed-Token': record.token || '', 'Content-Type': 'application/json',
        'Content-Length': '2',
      }, Buffer.from('{}'));
    }
  } catch { /* see the docstring; nothing here may escape */ }
  const exited = await Promise.race([
    new Promise((r) => child.once('exit', () => r(true))),
    sleep(10000).then(() => false),
  ]);
  if (!exited) {
    child.kill();
    await Promise.race([new Promise((r) => child.once('exit', r)), sleep(10000)]);
  }
}

/** Start one server in a fresh sandbox, drive it, stop it, and snapshot everything. */
export async function runCell(cli, cell, now) {
  const faults = cell.checkout;
  const sb = makeSandbox();
  const ctd = makeSandbox();
  try {
    const home = path.join(sb.path, 'home');
    const repo = path.join(sb.path, 'repo');
    const cfg = path.join(sb.path, 'cfg');
    for (const d of [home, repo, cfg]) fs.mkdirSync(d, { recursive: true });
    const checkout = faults !== undefined ? path.join(ctd.path, 'checkout') : ROOT;

    let repl = {
      '{sb}': sb.path, '{home}': home, '{repo}': repo, '{cfg}': cfg,
      '{py}': 'node', '{ck}': checkout,
    };
    repl = {
      ...Object.fromEntries(Object.entries(repl)
        .map(([k, v]) => [`${k.slice(0, -1)}/}`, v.split('\\').join('/')])),
      ...repl,
    };
    // Added AFTER the slash variants: these are numbers, so a forward-slash spelling of one
    // would be a placeholder nothing could ever use.
    Object.assign(repl, {
      '{now}': String(now), '{older}': String(now - 600), '{stale}': String(now - 3600),
      '{pid}': String(process.pid), '{deadpid}': String(DEAD_PID),
    });
    // JSON-ESCAPED variants. Three endpoints match a body's `path` against the native spelling
    // EXACTLY, so the forward-slash form cannot be used there — and a raw Windows path inside a
    // JSON string is not valid JSON.
    for (const [k, v] of Object.entries({ ...repl })) {
      if (!k.endsWith('/}')) repl[`${k.slice(0, -1)}J}`] = v.split('\\').join('\\\\');
    }
    repl['{sepJ}'] = path.sep.split('\\').join('\\\\');
    Object.assign(repl, clockRepl(now));

    let argv0 = cli;
    if (faults !== undefined) {
      copyCheckout(checkout, subst(faults, repl));
      argv0 = repoint(cli, checkout);
    }
    seed(sb.path, cell.world, repl);

    const env = cellEnv(home);
    Object.assign(env, subst(cell.env || {}, repl));

    // `--port 0` so the OS picks a free port and two cells can never collide with each other
    // or with the developer's own running daemon.
    const args = [...argv0.slice(1), '--daemon-internal', '--port', '0', '--no-browser',
      ...subst(cell.argv || [], repl)];
    const child = spawn(argv0[0], args, {
      cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    const outChunks = [];
    const errChunks = [];
    child.stdout.on('data', (c) => outChunks.push(c));
    child.stderr.on('data', (c) => errChunks.push(c));

    let record = null;
    let obs = new Map();
    try {
      record = await waitForRecord(sb.path, child);
      if (record !== null) {
        obs = await drive(record.port, record.token || '',
          substRequests(cell.requests, repl));
      }
    } finally {
      await stopServer(record, child);
    }
    const out = decodeStream(Buffer.concat(outChunks));
    const err = decodeStream(Buffer.concat(errChunks));
    if (record === null) {
      return `server did not start (rc=${child.exitCode}): ${out.slice(-400)}${err.slice(-400)}`;
    }

    const stamps = dynStamps(record, record.port, record.pid);
    const roots = [['<HOME>', home], ['<REPO>', checkout], ['<REPO>', ROOT], ['<SB>', sb.path]];
    // `webDestamp` FIRST, and that ordering is not a tidy-up: the record's `started` is an
    // integer second and a JOB's `started` is a FLOAT whose integer part is that same second
    // whenever the two were sampled inside one tick, so a literal replacement bit a prefix out
    // of it and left a per-run tail behind. Running the field-and-value patterns first makes the
    // whole number a tag before any literal can reach it.
    const clean = (b) => destampCli(applyStamps(normalise(applyStamps(webDestamp(b), stamps),
      roots), stamps));

    const snap = new Map();
    for (const [k, v] of snapshot(sb.path, roots)) snap.set(k, clean(v));
    for (const [k, v] of obs) snap.set(k, clean(v));
    snap.set('<dirs>', clean(Buffer.from(dirsUnder(sb.path).sort().join('\n'), 'utf8')));
    // The record, as a column of its own. It is DELETED by a graceful stop, so the file snapshot
    // cannot see it — and it carries the token, the port, the pid and the started second, which
    // is the only place four of this harness's destamps are observable at all. Its absence from
    // the file snapshot is what gates the cleanup.
    snap.set('<daemon-record>', clean(Buffer.from(jsonSortedKeys(record), 'utf8')));
    snap.set('<server stdout>', clean(Buffer.from(out, 'utf8')));
    snap.set('<server stderr>', clean(Buffer.from(err, 'utf8')));
    snap.set('<exit>', Buffer.from(String(child.exitCode), 'utf8'));
    return snap;
  } finally {
    sb.cleanup();
    ctd.cleanup();
  }
}

// `json.dumps(record, sort_keys=True)` — Python's separators with no indent are `(', ', ': ')`.
function jsonSortedKeys(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jsonSortedKeys).join(', ')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}: ${jsonSortedKeys(value[k])}`).join(', ')}}`;
}

function substRequests(requests, repl) {
  return requests.map((r) => ({
    ...r,
    path: subst(r.path, repl),
    headers: subst(r.headers, repl),
    body: r.body === null || r.body === undefined ? null
      : Buffer.from(subst(Buffer.from(r.body.__b64__, 'base64').toString('utf8'), repl), 'utf8'),
  }));
}

function dirsUnder(root, base = root, out = []) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(root, e.name);
    out.push(path.relative(base, p).split(path.sep).join('/'));
    dirsUnder(p, base, out);
  }
  return out;
}

function decodeStream(buf) {
  if (!buf || buf.length === 0) return '';
  return buf.toString('utf8').split('\r\n').join('\n').split('\r').join('\n');
}

/**
 * THE ABSOLUTE ASSERTIONS. Sharper here than anywhere else in the harness: two servers that both
 * stopped enforcing the CSRF token would agree in every guard cell, forever.
 *
 * RESPONSES ONLY. `<rN sent>` is a REQUEST, and folding it in would let a cell's own request body
 * satisfy its `expect` and trip its `expect_absent` — measured, not feared: one cell sends an
 * invalid scope precisely to prove the endpoint DROPS it, and reading the request back made the
 * cell report the server as answering it.
 */
export function checkExpectations(cell, snap, now, side = 'the candidate') {
  const problems = [];
  const clock = clockRepl(now);
  const expanded = {
    expect: subst(cell.expect || [], clock),
    expect_absent: subst(cell.expect_absent || [], clock),
    expect_re: subst(cell.expect_re || [], clock),
  };
  const text = [...snap.entries()]
    .filter(([k]) => (k.startsWith('<r') && !k.endsWith(' sent>'))
      || k === '<server stdout>' || k === '<server stderr>')
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, v]) => v)
    .map((v) => v.toString('utf8'))
    .join('\n');

  for (const k of [...snap.keys()].sort()) {
    if (k.endsWith('MISSING>')) {
      problems.push(`${k.slice(1, -1)} — a \`from_body\` request substituted an EMPTY value, so `
        + 'it sent a stale fingerprint and this cell is gating the 409 arm it was not written for');
    }
  }
  for (const want of expanded.expect) {
    if (!text.includes(want)) {
      problems.push(`${side} no longer answers ${JSON.stringify(want)} — this cell has stopped `
        + 'exercising what it names');
    }
  }
  for (const unwanted of expanded.expect_absent) {
    if (text.includes(unwanted)) {
      problems.push(`${side} now answers ${JSON.stringify(unwanted)}, which this cell exists to `
        + 'prove it leaves out');
    }
  }
  for (const pat of expanded.expect_re) {
    if (!new RegExp(pat).test(text)) {
      problems.push(`${side}'s answer no longer matches ${JSON.stringify(pat)}`);
    }
  }
  for (const rel of cell.expect_files || []) {
    if (!snap.has(rel)) {
      problems.push(`${side} no longer leaves ${JSON.stringify(rel)} behind — this cell names it `
        + 'as a file the endpoint must NOT remove');
    }
  }
  const wantAbsent = cell.expect_absent_files || [];
  if (wantAbsent.length && !(snap.get('<dirs>') || Buffer.alloc(0)).toString('utf8').trim()) {
    problems.push("the snapshot's <dirs> column is missing or empty, so every directory named in "
      + 'expect_absent_files would pass without being looked at — and the sandbox always holds '
      + 'home/repo/cfg');
    return problems;
  }
  const kept = wantAbsent.length
    ? new Set(snap.get('<dirs>').toString('utf8').split('\n')) : new Set();
  for (const rel of wantAbsent) {
    if (snap.has(rel) || kept.has(rel)) {
      problems.push(`${side} now leaves ${JSON.stringify(rel)} behind, which this cell exists to `
        + 'prove it prunes');
    }
  }
  if (snap.has('<transport>')) {
    problems.push(`${side}'s connection failed: ${snap.get('<transport>').toString('utf8')}`);
  }
  // The record is not optional. Every cell's server runs with `--daemon-internal`, so a missing
  // or empty record means the run was not observed at all — and four of this harness's destamps
  // read their values out of it, so an empty one would make them all no-ops and every cell would
  // compare two un-normalised runs.
  const rec = snap.get('<daemon-record>') || Buffer.alloc(0);
  if (!rec.toString('utf8').trim() || !rec.toString('utf8').includes('<TOKEN>')) {
    problems.push('the daemon record is missing, empty, or carries no token — the destamps read '
      + 'their values out of it, so every cell would then compare two un-normalised runs');
  }
  return problems;
}
