import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, existsSync, symlinkSync, lstatSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  cmdLink, cmdUnlink, shellRcFile, withPathBlock, withoutPathBlock,
} from '../../js/hosts/link.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

const unix = process.platform !== 'win32';

// A sandbox dir that is NOT on PATH, so cmdUnlink's PATH sweep cannot reach it; the
// candidate list also carries ~/.local/bin and /usr/local/bin, which we must not touch.
function sandbox() {
  return makeSandbox('geneseed-link-').path;
}

// `unlink` also edits the shell startup files under HOME (the PATH block `link` may write), so
// it runs with HOME and ZDOTDIR pointed at a sandbox: no test may touch the real user's files.
function unlinkInSandbox() {
  const home = sandbox();
  const saved = { HOME: process.env.HOME, ZDOTDIR: process.env.ZDOTDIR };
  process.env.HOME = home;
  delete process.env.ZDOTDIR;
  try {
    return { rc: cmdUnlink() };
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

test('link writes a regular Node shim, not a symlink to the bash launcher',
  { skip: !unix }, () => {
    const dir = sandbox();
    try {
      assert.equal(cmdLink({ dir }), 0);
      const dest = path.join(dir, 'geneseed');
      assert.ok(existsSync(dest));
      assert.equal(lstatSync(dest).isSymbolicLink(), false, 'must not be a symlink');
      const body = readFileSync(dest, 'utf-8');
      assert.match(body, /bin\/geneseed-cli\.mjs/);
      assert.match(body, /GENESEED_LINK_SHIM/);
      assert.doesNotMatch(body, /python/i);
      assert.ok(lstatSync(dest).mode & 0o111, 'must be executable');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

test('unlink removes the shim link wrote', { skip: !unix }, () => {
  const dir = sandbox();
  const saved = process.env.PATH;
  try {
    assert.equal(cmdLink({ dir }), 0);
    process.env.PATH = `${dir}${path.delimiter}${saved}`;
    assert.equal(unlinkInSandbox().rc, 0);
    assert.equal(existsSync(path.join(dir, 'geneseed')), false,
      'unlink must remove what link wrote');
  } finally {
    process.env.PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unlink still removes a LEGACY symlink install', { skip: !unix }, () => {
  const dir = sandbox();
  const saved = process.env.PATH;
  try {
    // The shape every existing `geneseed link` install has on disk today.
    symlinkSync(path.join(process.cwd(), 'geneseed'), path.join(dir, 'geneseed'));
    process.env.PATH = `${dir}${path.delimiter}${saved}`;
    assert.equal(unlinkInSandbox().rc, 0);
    assert.equal(existsSync(path.join(dir, 'geneseed')), false);
  } finally {
    process.env.PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('link refuses to replace a FOREIGN geneseed, as unlink refuses to remove one',
  { skip: !unix }, () => {
    // npm's own bin link and a stranger's program both sit at this name. Link used to delete
    // whatever was there before writing; the two verbs now share one judgement of "ours".
    const dir = sandbox();
    const foreign = path.join(dir, 'geneseed');
    try {
      writeFileSync(foreign, '#!/bin/sh\necho not ours\n');
      assert.equal(cmdLink({ dir }), 1);
      assert.equal(readFileSync(foreign, 'utf-8'), '#!/bin/sh\necho not ours\n',
        'link overwrote a file it did not write');
      rmSync(foreign);
      assert.equal(cmdLink({ dir }), 0);
      assert.equal(cmdLink({ dir }), 0, 'link refused to refresh its OWN shim');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

test('unlink leaves a FOREIGN geneseed alone', { skip: !unix }, () => {
  const dir = sandbox();
  const saved = process.env.PATH;
  const foreign = path.join(dir, 'geneseed');
  try {
    writeFileSync(foreign, '#!/bin/sh\necho not ours\n');
    process.env.PATH = `${dir}${path.delimiter}${saved}`;
    assert.equal(unlinkInSandbox().rc, 0);
    assert.ok(existsSync(foreign), 'a file we did not write must survive');
  } finally {
    process.env.PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

// WHICH STARTUP FILE `link` offers to edit (reported 2026-10: macOS zsh does not search
// ~/.local/bin, so a linked `geneseed` was not found). zsh reads $ZDOTDIR/.zshrc, else ~/.zshrc;
// bash reads ~/.bashrc on Linux but ~/.bash_profile on macOS, whose Terminal opens login shells;
// any other shell (fish, csh, none) gets null, and `link` prints the line instead.
test('the startup file follows the login shell', () => {
  assert.equal(shellRcFile({ shell: '/bin/zsh', home: '/h', zdotdir: undefined, platform: 'darwin' }),
    path.join('/h', '.zshrc'));
  assert.equal(shellRcFile({ shell: '/bin/zsh', home: '/h', zdotdir: '/z', platform: 'linux' }),
    path.join('/z', '.zshrc'));
  assert.equal(shellRcFile({ shell: '/bin/bash', home: '/h', platform: 'linux' }),
    path.join('/h', '.bashrc'));
  assert.equal(shellRcFile({ shell: '/bin/bash', home: '/h', platform: 'darwin' }),
    path.join('/h', '.bash_profile'));
  assert.equal(shellRcFile({ shell: '/usr/bin/fish', home: '/h', platform: 'linux' }), null);
  assert.equal(shellRcFile({ shell: '', home: '/h', platform: 'linux' }), null);
});

// THE BLOCK, written out: appended after a newline when the file lacks a final one, never twice,
// the dir double-quoted with \\ " $ ` escaped so a home path cannot become code, and removed
// whole (markers included) leaving the user's own lines exactly as they were.
test('the PATH block is appended once, quoted, and removed whole', () => {
  const block = (dir) => '# >>> geneseed >>> (added by `geneseed link`; `geneseed unlink` removes it)\n'
    + `export PATH="${dir}:$PATH"\n# <<< geneseed <<<\n`;
  assert.equal(withPathBlock('', '/u/.local/bin'), block('/u/.local/bin'));
  assert.equal(withPathBlock('alias ll=ls', '/u/b'), `alias ll=ls\n${block('/u/b')}`);
  const once = withPathBlock('alias ll=ls\n', '/u/b');
  assert.equal(once, `alias ll=ls\n${block('/u/b')}`);
  assert.equal(withPathBlock(once, '/other'), once);
  assert.equal(withPathBlock('', '/u/a"b$c`d\\e'), block('/u/a\\"b\\$c\\`d\\\\e'));
  assert.equal(withoutPathBlock(`${once}export EDITOR=vi\n`), 'alias ll=ls\nexport EDITOR=vi\n');
  assert.equal(withoutPathBlock('alias ll=ls\n'), 'alias ll=ls\n');
});

test('unlink removes the PATH block from the startup file and keeps the rest', { skip: !unix }, () => {
  const home = sandbox();
  const saved = { HOME: process.env.HOME, ZDOTDIR: process.env.ZDOTDIR };
  try {
    const rc = path.join(home, '.zshrc');
    writeFileSync(rc, withPathBlock('alias ll=ls\n', path.join(home, '.local', 'bin')));
    process.env.HOME = home;
    delete process.env.ZDOTDIR;
    assert.equal(cmdUnlink(), 0);
    assert.equal(readFileSync(rc, 'utf-8'), 'alias ll=ls\n');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
  }
});
