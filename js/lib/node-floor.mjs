/**
 * The Node floor — the FIRST import of all three binaries, so an old Node gets one sentence
 * instead of a stack trace from whichever API it lacks.
 *
 * `engines` in package.json only makes npm warn, and `npx geneseed`, a global install and the
 * hook shim all run the binaries directly. ESM links the whole graph before any body runs, so
 * this only helps while every file still PARSES on the old Node; it runs before any of them
 * executes. The hook exits 0: a hook must never block a tool call, and the message on stderr
 * is what the host surfaces. Nothing here may print to stdout — the hook's decision channel.
 */
import path from 'node:path';

export const NODE_FLOOR = '22.3.0';

/** Numeric, not string, comparison: '22.10.0' is above '22.3.0'. */
export function belowFloor(version, floor = NODE_FLOOR) {
  const v = version.replace(/^v/, '').split('.').map(Number);
  const f = floor.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((v[i] || 0) !== f[i]) return (v[i] || 0) < f[i];
  }
  return false;
}

if (belowFloor(process.versions.node)) {
  process.stderr.write(`geneseed needs Node 22.3 or newer; this is Node ${process.versions.node}. `
    + 'Install a current Node from https://nodejs.org (or your package manager), then run the '
    + 'command again.\n');
  process.exit(path.basename(process.argv[1] || '').startsWith('geneseed-hook') ? 0 : 1);
}
