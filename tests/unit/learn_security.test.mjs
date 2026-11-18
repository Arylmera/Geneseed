// R-F1 and R-F6 of the blind review of A2: the detached worker runs a job file, and a job is DATA.
//
// A repository can ship a folder named `learn-jobs` with a `job-1.json` in it, and an agent can be talked
// into running `geneseed-hook learn-worker <that path>`. So the worker takes a job only from the machine
// cache's own folder, takes the model command from its own environment (never from the job), and writes
// only to the machine tier's memory or to an install's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FAKE_LLM } from '../helpers/cli_golden.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';

const REPLY = '---\nname: alpha-fact\ndescription: the first canned fact\nmetadata:\n  type: project\n---\n\nBody.\n';

function rig() {
  const sb = makeSandbox();
  const home = path.join(sb.path, 'home');
  const tier = path.join(home, '.config', 'geneseed');
  const inst = path.join(sb.path, 'inst');
  fs.mkdirSync(path.join(inst, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(inst, '.geneseed-manifest.json'), '{}');
  fs.mkdirSync(path.join(tier, 'memory'), { recursive: true });
  const transcript = path.join(sb.path, 't.jsonl');
  fs.writeFileSync(transcript, `${JSON.stringify({ message: { role: 'user', content: 'why does the build fail on windows' } })}\n`);
  const reply = path.join(sb.path, 'reply.md');
  fs.writeFileSync(reply, REPLY);
  const log = path.join(sb.path, 'calls.log');
  const marker = path.join(sb.path, 'marker.txt');
  const script = path.join(sb.path, 'evil.mjs');
  fs.writeFileSync(script, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  const env = { ...process.env, ...homeOverrides(home), GENESEED_LLM: `node ${FAKE_LLM}`, FAKE_LLM_OUT: reply, FAKE_LLM_LOG: log };
  delete env.GENESEED_LEARN_CHILD;
  const jobs = path.join(tier, 'cache', 'learn-jobs');
  fs.mkdirSync(jobs, { recursive: true });
  const job = (extra = {}) => ({ v: 1, event: 'SessionEnd', host: 'claude', memory: path.join(inst, 'memory'), transcript, agents: [], ...extra });
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0);
  const run = (file) => spawnHook(['learn-worker', file], '', { env });
  return { sb, inst, tier, jobs, job, env, run, calls, marker, script, transcript, fact: path.join(inst, 'memory', 'alpha-fact.md') };
}

test('a job outside the machine cache\'s learn-jobs folder is refused and left where it is', () => {
  const r = rig();
  try {
    // A folder merely NAMED learn-jobs, as a cloned repository could ship it.
    const fake = path.join(r.sb.path, 'repo', 'learn-jobs');
    fs.mkdirSync(fake, { recursive: true });
    const file = path.join(fake, 'job-1.json');
    fs.writeFileSync(file, JSON.stringify(r.job()));
    assert.equal(r.run(file).status, 0);
    assert.ok(fs.existsSync(file), 'the file is not deleted');
    assert.equal(r.calls(), 0, 'no model was run');
    assert.ok(!fs.existsSync(r.fact));
    // The real folder, the same job: it runs, so the refusal above is about the place.
    const good = path.join(r.jobs, 'job-1.json');
    fs.writeFileSync(good, JSON.stringify(r.job()));
    r.run(good);
    assert.ok(fs.existsSync(r.fact));
    assert.ok(!fs.existsSync(good));
  } finally { r.sb.cleanup(); }
});

test('a job holds no model command: an llm key in it changes nothing about what is run', () => {
  const r = rig();
  try {
    const file = path.join(r.jobs, 'job-2.json');
    fs.writeFileSync(file, JSON.stringify(r.job({ llm: `node ${r.script}` })));
    r.run(file);
    assert.ok(!fs.existsSync(r.marker), 'the command the job named was not run');
    assert.equal(r.calls(), 1, 'the worker ran its own GENESEED_LLM, once');
    assert.ok(fs.existsSync(r.fact));
  } finally { r.sb.cleanup(); }
});

test('a job naming a memory outside the allowed stores is refused; the machine tier\'s and an install\'s are allowed', () => {
  const r = rig();
  try {
    const foreign = path.join(r.sb.path, 'elsewhere', 'memory');
    fs.mkdirSync(foreign, { recursive: true });
    const notNamedMemory = path.join(r.inst, 'notes');
    fs.mkdirSync(notNamedMemory, { recursive: true });
    const bare = path.join(r.sb.path, 'bare');
    fs.mkdirSync(path.join(bare, 'memory'), { recursive: true });
    for (const [i, memory] of [foreign, notNamedMemory, path.join(bare, 'memory'), path.join(r.sb.path, 'missing', 'memory')].entries()) {
      const file = path.join(r.jobs, `job-3${i}.json`);
      fs.writeFileSync(file, JSON.stringify(r.job({ memory })));
      r.run(file);
      assert.equal(r.calls(), 0, `${memory}: no model run`);
      assert.deepEqual(fs.existsSync(memory) ? fs.readdirSync(memory).filter((n) => n.endsWith('.md')) : [], [], `${memory}: nothing written`);
    }
    const tierFile = path.join(r.jobs, 'job-4.json');
    fs.writeFileSync(tierFile, JSON.stringify(r.job({ memory: path.join(r.tier, 'memory') })));
    r.run(tierFile);
    assert.ok(fs.existsSync(path.join(r.tier, 'memory', 'alpha-fact.md')), 'the machine tier\'s memory is allowed');
  } finally { r.sb.cleanup(); }
});

test('a queued lesson line is capped, and one over the cap is dropped (R-F6)', () => {
  const r = rig();
  try {
    const run = (payload) => spawnHook(['learn', '--memory', path.join(r.inst, 'memory'), '--no-done-gate'], JSON.stringify(payload), { env: r.env });
    run({ hook_event_name: 'SubagentStop', session_id: 'q', agent_name: 'explore', last_assistant_message: 'x'.repeat(50000) });
    run({ hook_event_name: 'SubagentStop', session_id: 'q', agent_name: 'reviewer', agent_transcript_path: `/${'p'.repeat(5000)}` });
    const file = path.join(r.jobs, 'agents-q.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1, 'the line over the cap was dropped');
    assert.ok(lines[0].length <= 4000, `the kept line is ${lines[0].length} characters`);
    assert.equal(JSON.parse(lines[0]).agent, 'explore');
  } finally { r.sb.cleanup(); }
});

test('SessionEnd through learn records the session as ended in the activity view (R-F6)', () => {
  const r = rig();
  try {
    const run = (event) => spawnHook(['learn', '--memory', path.join(r.inst, 'memory'), '--no-done-gate'],
      JSON.stringify({ hook_event_name: event, session_id: 'sess-9', transcript_path: r.transcript, cwd: r.sb.path }), { env: r.env });
    run('UserPromptSubmit');
    run('SessionEnd');
    const dir = path.join(r.inst, 'activity');
    const texts = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((n) => /[.]json$/.test(String(n)))
      .map((n) => fs.readFileSync(path.join(dir, String(n)), 'utf8')) : [];
    assert.ok(texts.some((t) => t.includes('sess-9') && /"status":\s*"ended"/.test(t)), `no ended snapshot in ${dir}: ${texts.length} file(s)`);
  } finally { r.sb.cleanup(); }
});

// S-F1: an install's memory/ may be a junction or a symlink to a folder of another name. The guard reads the
// name and the manifest off the path the hook was given, and the real path only for the machine tier.
test('an install whose memory/ is a junction to a differently named folder is allowed; a look-alike is not', () => {
  const r = rig();
  try {
    const real = path.join(r.sb.path, 'real-store');
    fs.mkdirSync(real, { recursive: true });
    const inst2 = path.join(r.sb.path, 'inst2');
    fs.mkdirSync(inst2, { recursive: true });
    fs.writeFileSync(path.join(inst2, '.geneseed-manifest.json'), '{}');
    fs.symlinkSync(real, path.join(inst2, 'memory'), 'junction');
    const file = path.join(r.jobs, 'job-6.json');
    fs.writeFileSync(file, JSON.stringify(r.job({ memory: path.join(inst2, 'memory') })));
    r.run(file);
    assert.ok(fs.existsSync(path.join(real, 'alpha-fact.md')), 'the fact landed in the folder the junction points at');
    // A junction in a folder with no manifest, named memory, is still refused.
    const bare = path.join(r.sb.path, 'bare2');
    fs.mkdirSync(bare, { recursive: true });
    fs.symlinkSync(real, path.join(bare, 'memory'), 'junction');
    fs.rmSync(path.join(real, 'alpha-fact.md'));
    const file2 = path.join(r.jobs, 'job-7.json');
    fs.writeFileSync(file2, JSON.stringify(r.job({ memory: path.join(bare, 'memory') })));
    r.run(file2);
    assert.ok(!fs.existsSync(path.join(real, 'alpha-fact.md')), 'no manifest beside it: refused');
  } finally { r.sb.cleanup(); }
});

// S-F5(a): a model-CLI child never learns, whichever verb it reaches.
test('with GENESEED_LEARN_CHILD set, learn and learn-worker call no model', () => {
  const r = rig();
  try {
    const env = { ...r.env, GENESEED_LEARN_CHILD: '1', GENESEED_LEARN_INLINE: '1' };
    const payload = JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'c', transcript_path: r.transcript });
    spawnHook(['learn', '--memory', path.join(r.inst, 'memory'), '--no-done-gate'], payload, { env });
    const file = path.join(r.jobs, 'job-8.json');
    fs.writeFileSync(file, JSON.stringify(r.job()));
    spawnHook(['learn-worker', file], '', { env });
    assert.equal(r.calls(), 0);
    assert.ok(!fs.existsSync(r.fact));
  } finally { r.sb.cleanup(); }
});

// S-F5(b): a model that fails or exits 2 neither blocks a compaction or a session end nor prints on stdout.
test('a failing model on PreCompact and SessionEnd exits 0 and prints nothing on stdout', () => {
  for (const rc of ['1', '2']) {
    const r = rig();
    try {
      const env = { ...r.env, FAKE_LLM_RC: rc, FAKE_LLM_ERR: 'quota exceeded\n', GENESEED_LEARN_INLINE: '1' };
      for (const event of ['PreCompact', 'SessionEnd']) {
        const res = spawnHook(['learn', '--memory', path.join(r.inst, 'memory'), '--no-done-gate'],
          JSON.stringify({ hook_event_name: event, session_id: `f${rc}`, transcript_path: r.transcript, cwd: r.sb.path }), { env });
        assert.equal(res.status, 0, `${event} rc=${rc}`);
        assert.equal(res.stdout, '', `${event} rc=${rc}: stdout stays empty`);
        assert.ok(!fs.existsSync(r.fact), `${event} rc=${rc}: nothing stored from a failed model`);
      }
      assert.equal(r.calls(), 2, 'the model was called on both events');
    } finally { r.sb.cleanup(); }
  }
});

// S-F6: the queue goes only once the job is written and started.
test('the agent queue is consumed once the job is started, and a distil with no queue still runs', () => {
  const r = rig();
  try {
    const run = (payload) => spawnHook(['learn', '--memory', path.join(r.inst, 'memory'), '--no-done-gate'], JSON.stringify(payload), { env: r.env });
    run({ hook_event_name: 'SubagentStop', session_id: 'z', agent_name: 'explore', last_assistant_message: 'did a thing' });
    const queue = path.join(r.jobs, 'agents-z.jsonl');
    assert.ok(fs.existsSync(queue));
    run({ hook_event_name: 'SessionEnd', session_id: 'z', transcript_path: r.transcript });
    assert.ok(!fs.existsSync(queue), 'taken once the worker was started');
  } finally { r.sb.cleanup(); }
});
