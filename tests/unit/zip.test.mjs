// The zip codec behind `geneseed backup`/`restore` (js/lib/zip.mjs). The CLI may not spawn and
// takes no runtime dependency, so the archive is written and read in pure Node; these rows pin
// what a user's archive must survive. Every expected value is written out here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { writeZip, readZip } from '../../js/lib/zip.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

/** Deterministic bytes (an LCG), so the "incompressible" entry is the same on every run. */
function seeded(n, seed = 7) {
  const out = Buffer.alloc(n);
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; out[i] = x >>> 24; }
  return out;
}

const plain = (entries) => entries.map(({ name, data }) => ({ name, data: Buffer.from(data) }));

/** Rename one entry in place (local and central header), the way a crafted archive would. */
function renamed(buf, from, to) {
  assert.equal(Buffer.byteLength(from), Buffer.byteLength(to), 'a rename keeps the length');
  const out = Buffer.from(buf);
  const a = Buffer.from(from); const b = Buffer.from(to);
  let i = out.indexOf(a); let hits = 0;
  while (i !== -1) { b.copy(out, i); hits++; i = out.indexOf(a, i + 1); }
  assert.equal(hits, 2, 'the name sits in the local and the central header');
  return out;
}

// Names, bytes and order come back as written: an empty file, a nested binary file and text.
test('round-trip', () => {
  const entries = [
    { name: 'a.txt', data: Buffer.from('hello') },
    { name: 'dir/b.bin', data: seeded(256) },
    { name: 'empty.md', data: Buffer.alloc(0) },
  ];
  assert.deepEqual(plain(readZip(writeZip(entries))), entries);
});

// A tier fact named in French must keep its name: the UTF-8 flag (bit 11) is set.
test('utf8 names round-trip', () => {
  const entries = [{ name: 'memory/mémoire-réseau.md', data: Buffer.from('fait') }];
  const zip = writeZip(entries);
  assert.equal(zip.readUInt16LE(6) & 0x0800, 0x0800);
  assert.deepEqual(plain(readZip(zip)), entries);
});

// Deflate only when it shrinks the entry: method 0 (store) for random bytes, 8 for text.
test('stores incompressible data', () => {
  assert.equal(writeZip([{ name: 'r.bin', data: seeded(512) }]).readUInt16LE(8), 0);
  assert.equal(writeZip([{ name: 't.txt', data: Buffer.from('a'.repeat(512)) }]).readUInt16LE(8), 8);
});

// A crafted entry name must never reach the disk: parent steps, absolute paths, drive letters
// and backslash steps are all refused by name.
test('readZip refuses unsafe names', () => {
  const zip = writeZip([{ name: 'safe/xx', data: Buffer.from('x') }]);
  for (const bad of ['../x/xx', '/abs/xx', 'C:/x/xx', 'a\\..\\bx']) {
    const name = bad.padEnd(7, 'x').slice(0, 7);
    assert.throws(() => readZip(renamed(zip, 'safe/xx', name)), /unsafe entry name/, name);
  }
});

// No zip64: past 65 535 entries the archive is refused, not written wrong.
test('refuses zip64 limits', () => {
  const many = Array.from({ length: 65_536 }, (_, i) => ({ name: `f${i}`, data: Buffer.alloc(0) }));
  assert.throws(() => writeZip(many), /too many entries/);
});

// A changed byte is caught by the CRC, so a damaged archive never restores silently.
test('readZip refuses a crc mismatch', () => {
  const zip = writeZip([{ name: 'r.bin', data: seeded(64) }]);
  const bad = Buffer.from(zip);
  bad[30 + 'r.bin'.length + 3] ^= 0xff;
  assert.throws(() => readZip(bad), /crc mismatch/);
});

// An entry is inflated only up to the size its central directory declares: a crafted entry that
// claims 16 bytes and inflates to a megabyte is refused by name, before the megabyte is held.
test('readZip refuses an entry that inflates past its declared size', () => {
  const zip = Buffer.from(writeZip([{ name: 'z.txt', data: Buffer.alloc(1 << 20) }]));
  const cd = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  zip.writeUInt32LE(16, cd + 24);
  assert.throws(() => readZip(zip), /'z\.txt' inflates past its declared size/);
});

// The second observer: Windows' own expander must open what we write.
test('Windows Expand-Archive opens it', { skip: process.platform !== 'win32' }, () => {
  const sb = makeSandbox('gszip');
  const dir = sb.path;
  try {
    const entries = [
      { name: 'tier/user-rules.md', data: Buffer.from('## R1 — rule\n') },
      { name: 'tier/memory/mémoire.md', data: Buffer.from('a'.repeat(300)) },
      { name: 'skills/claude/x/r.bin', data: seeded(128) },
    ];
    const file = path.join(dir, 'b.zip');
    fs.writeFileSync(file, writeZip(entries));
    const out = path.join(dir, 'out');
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${file}' -DestinationPath '${out}'`], { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    for (const { name, data } of entries) assert.deepEqual(fs.readFileSync(path.join(out, name)), data, name);
  } finally {
    sb.cleanup();
  }
});
