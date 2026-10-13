/**
 * Manifest rel -> path on disk decisions — the small set of rules that turn an `owned` list
 * entry (a POSIX-spelled relative path, read straight off a `.geneseed-manifest.json` that
 * sits inside the install) into something safe to act on.
 *
 * `ownedWithin` is the first tenant: both `uninstall.mjs`'s owned-file walk and the generator
 * driver's prune read a manifest's `owned` list and must agree on the one security boundary
 * neither may skip — a manifest is a file on disk, and per-repo ones live inside the very repo
 * a build runs over, so a cloned repo's manifest is as untrusted as any other file it ships.
 */
import path from 'node:path';

import { resolvePath } from './hosts.mjs';
import { within } from '../lib/paths.mjs';

/**
 * The manifest rels that resolve INSIDE `base` — the one security boundary every walk over
 * `owned` goes through (uninstall, both deactivates).
 *
 * `path.resolve(rroot, r)` and NOT `path.join`, which is the one line here that is a security
 * boundary rather than a translation. The Python is `(rroot / r).resolve()`, and pathlib's
 * `/` REPLACES the base when the right operand is absolute — so a manifest entry naming
 * `C:/evil.md` resolves outside the root and `_within` rejects it. `path.join` would have
 * concatenated it into `<root>/C:/evil.md`, which passes containment and would then be acted
 * on. `path.resolve` has pathlib's semantics for exactly this case, and collapses `..`
 * besides, which is why the guard runs on the resolved path rather than the lexical one.
 */
export function ownedWithin(base, rels) {
  const rroot = resolvePath(base);
  return rels.filter((r) => r && within(resolvePath(path.resolve(rroot, r)), rroot));
}
