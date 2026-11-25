// The learn model on OpenCode (js/hosts/opencode-run.mjs): `opencode run`, isolated, as a plain model call. Every
// expectation is written out. What the isolation buys was measured against the real hosts (the module's docblock);
// `tests/host_canary.mjs` checks it again against them. These rows state the shape of the call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { JUDGE_AGENT, opencodeIsolation, opencodeModelOf, opencodeUserConfig } from '../../js/hosts/opencode-run.mjs';
import { learnCommandFor } from '../../js/hosts/learn-command.mjs';
import { spawnPlan, userBinDirs } from '../../js/hosts/hooks-learn.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

const V2_HELP = 'FLAGS\n  --model, -m string\n\nGLOBAL FLAGS\n  --standalone    Run with a private server\n';
const V1_HELP = 'Options:\n  --pure  run without external plugins\n  -m, --model\n';

// The words gain `run` when they lack it, then --title and --agent, and --standalone only where `run --help` lists
// it (V2). A flag the command already names is not added twice.
test('opencodeIsolation: the words', () => {
  const rows = [
    ['bare opencode gains run', ['opencode'], V1_HELP, ['opencode', 'run', '--title', 'geneseed-learn', '--agent', JUDGE_AGENT]],
    ['a model rides through', ['opencode', 'run', '--model', 'a/b'], V1_HELP,
      ['opencode', 'run', '--model', 'a/b', '--title', 'geneseed-learn', '--agent', JUDGE_AGENT]],
    ['V2 gets a private server', ['opencode', 'run'], V2_HELP,
      ['opencode', 'run', '--title', 'geneseed-learn', '--agent', JUDGE_AGENT, '--standalone']],
    ['a named title is kept', ['opencode', 'run', '--title', 'mine'], '', ['opencode', 'run', '--title', 'mine', '--agent', JUDGE_AGENT]],
    ['--standalone-ish text is no flag', ['opencode', 'run'], '  --standalone-mode x\n', ['opencode', 'run', '--title', 'geneseed-learn', '--agent', JUDGE_AGENT]],
  ];
  for (const [what, argv, help, want] of rows) {
    assert.deepEqual(opencodeIsolation(argv, { scratch: '/s', help }).argv, want, what);
  }
});

// The child reads only what is passed: an empty config folder (the user's config folder and file unset), an empty
// working folder (PWD too), and a config holding the user's provider keys (and the npm plugins a provider may sign in
// through) and our tool-less agent, nothing else.
test('opencodeIsolation: the folders and the config it reads', () => {
  const user = {
    model: 'p/big', small_model: 'p/small', provider: { p: { options: { baseURL: 'http://x' } } }, enabled_providers: ['p'],
    instructions: ['/home/u/AGENT.md'], plugin: ['x'], permission: { edit: 'allow' }, agent: { mine: {} },
  };
  const iso = opencodeIsolation(['opencode'], { scratch: path.join('/', 's'), user, role: 'judge facts' });
  assert.equal(iso.cwd, path.join('/', 's', 'cwd'));
  assert.deepEqual(Object.keys(iso.env).sort(), ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_CONFIG_DIR', 'PWD', 'XDG_CONFIG_HOME']);
  assert.equal(iso.env.XDG_CONFIG_HOME, path.join('/', 's', 'config'));
  assert.equal(iso.env.OPENCODE_CONFIG_DIR, undefined);
  assert.equal(iso.env.OPENCODE_CONFIG, undefined);
  assert.equal(iso.env.PWD, iso.cwd);
  assert.deepEqual(JSON.parse(iso.env.OPENCODE_CONFIG_CONTENT), {
    model: 'p/big', small_model: 'p/small', provider: { p: { options: { baseURL: 'http://x' } } }, enabled_providers: ['p'],
    plugin: ['x'], agent: { [JUDGE_AGENT]: { mode: 'primary', prompt: 'judge facts', tools: { '*': false } } },
  });
});

// The user's config: opencode.json, then opencode.jsonc (comments allowed), then the file $OPENCODE_CONFIG names,
// a later key winning. The model asked for is small_model (OpenCode's light tier), else model, else none.
test('opencodeUserConfig and opencodeModelOf', () => {
  const sb = makeSandbox('gs-ocrun-');
  try {
    fs.writeFileSync(path.join(sb.path, 'opencode.json'), JSON.stringify({ model: 'a/one', provider: { a: {} } }));
    fs.writeFileSync(path.join(sb.path, 'opencode.jsonc'), '{\n  // mine\n  "model": "a/two"\n}\n');
    const extra = path.join(sb.path, 'extra.json');
    fs.writeFileSync(extra, JSON.stringify({ small_model: 'a/tiny' }));
    assert.deepEqual(opencodeUserConfig({}, sb.path), { model: 'a/two', provider: { a: {} } });
    const all = opencodeUserConfig({ OPENCODE_CONFIG: extra }, sb.path);
    assert.equal(opencodeModelOf(all), 'a/tiny');
    assert.equal(opencodeModelOf({ model: 'a/two' }), 'a/two');
    assert.equal(opencodeModelOf({ model: '  ' }), null);
    assert.deepEqual(opencodeUserConfig({}, path.join(sb.path, 'none')), {});
  } finally { sb.cleanup(); }
});

// OpenCode's command is `opencode run`, with the model or without (the user's default); a model id a shell would
// read is no command. Its prompt goes over stdin, as claude's does, never on the command line.
test('learnCommandFor opencode, and the prompt over stdin', () => {
  assert.equal(learnCommandFor('opencode', 'anthropic/claude-haiku-4-5'), 'opencode run --model anthropic/claude-haiku-4-5');
  assert.equal(learnCommandFor('opencode', 'session'), 'opencode run');
  assert.equal(learnCommandFor('opencode', 'x$(id)'), null);
  const plan = spawnPlan(['opencode', 'run', '--model', 'a/b'], 'the notes', { platform: 'linux' });
  assert.deepEqual([plan.file, plan.args, plan.input], ['opencode', ['run', '--model', 'a/b'], 'the notes']);
});

// A console started at login runs with the system's short PATH. A model CLI it does not name is looked for in the
// usual install folders (OpenCode's installer, npm/bun/Volta prefixes, Homebrew), never the current folder; one on
// PATH runs as its bare word.
test('spawnPlan finds a CLI PATH misses in the usual install folders', () => {
  const env = { HOME: '/home/u', PATH: '/usr/bin:/bin' };
  assert.deepEqual(userBinDirs(env, 'darwin'), ['/home/u/.opencode/bin', '/home/u/.local/bin', '/home/u/.bun/bin',
    '/home/u/.npm-global/bin', '/home/u/.volta/bin', '/opt/homebrew/bin', '/usr/local/bin']);
  const at = (...files) => (f) => files.includes(f);
  assert.equal(spawnPlan(['opencode', 'run'], 'p', { platform: 'darwin', env, exists: at('/opt/homebrew/bin/opencode') }).file,
    '/opt/homebrew/bin/opencode');
  assert.equal(spawnPlan(['opencode', 'run'], 'p', { platform: 'darwin', env, exists: at('/usr/bin/opencode', '/opt/homebrew/bin/opencode') }).file,
    'opencode', 'on PATH: the bare word');
  assert.equal(spawnPlan(['opencode', 'run'], 'p', { platform: 'darwin', env, exists: at() }).file, 'opencode', 'nowhere: the OS says so');
});
