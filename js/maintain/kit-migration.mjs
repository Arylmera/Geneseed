/**
 * The one-time move of an install built before the `superpowers` kit existed.
 *
 * Before the kit, the five vendored superpowers Rites shipped in every install. An install's
 * `Active kits:` line has never named the kit, so its next rebuild would drop all five. This reads
 * the release the install was BUILT by (the `[release X.Y.Z]` in `.geneseed-version`, which every
 * emit writes) and, for one built before `SUPERPOWERS_KIT_SINCE`, turns the kit on, unless the
 * official plugin is seen (then the plugin already provides them, and two providers duplicate
 * each other). One notice line per install says which, and why.
 *
 * `aware` (`kitAwareOfDir`): true: the carrier already shows a build that knows the kit, so the release
 * number is not asked. That covers builds made after the kit but before the release that names it.
 *
 * A marker that is missing or reads as no release (a bundle, a hand-copied tree) is treated as
 * built before: every such install did carry the five Rites. An install built at or after the
 * release keeps what its `Active kits:` line says, so a kit turned off on purpose stays off.
 *
 * Runs inside `installProfile` (`js/build/profile.mjs`), the one read-back `rebuild-all`, `update`
 * and `migrate` share, so `status` shows what a rebuild would do.
 */
import path from 'node:path';
import { readText } from '../lib/fs.mjs';
import { versionIsNewer } from '../build/version.mjs';
import { HOSTS, VERSION_MARKER, isGlobalInstall } from '../hosts/hosts.mjs';
import { kitAwareOfDir, kitsOfDir } from '../hosts/installs.mjs';
import { loadKits } from '../build/source.mjs';
import { describeDetection, detectSuperpowers } from './plugin-detect.mjs';

/** The first release where the five Rites are a kit. A build older than this carried them as core. */
export const SUPERPOWERS_KIT_SINCE = '6.0.0';

/**
 * The release an install was built by, or null (no marker, or one with no `[release …]`). The marker
 * sits in `root` for a global install and an OpenCode project bundle, and in the host's layer folder
 * (`<root>/.claude` and kin) for the Claude dialects' project installs.
 */
export function builtByRelease(root, host = null, scope = 'global') {
  const marker = scope === 'global' ? null : HOSTS.find((h) => h.host === host)?.projectMarker;
  // OpenCode's project bundle keeps the marker at the root; the Claude dialects keep it in their layer folder.
  for (const dir of marker ? [root, path.join(root, marker)] : [root]) {
    try {
      const m = /\[release ([^\]]+)\]/.exec(readText(path.join(dir, VERSION_MARKER)));
      if (m) return m[1];
    } catch { /* not here */ }
  }
  return null;
}

/**
 * `kits`, plus `superpowers` when this install predates the kit and the plugin is not seen.
 * @param {{ host: string, scope: string, root: string, kits: string[], notify?: ((line: string) => void) | null,
 *   aware?: boolean | null, knownKits?: string[], detectRoots?: Parameters<typeof detectSuperpowers>[1] }} a
 */
export function migrateSuperpowersKit({ host, scope, root, kits, notify = null, knownKits = [], detectRoots = {}, aware = false }) {
  if (kits.includes('superpowers') || !knownKits.includes('superpowers') || aware !== false) return kits;
  const built = builtByRelease(root, host, scope);
  // `versionIsNewer(a, b)` is a > b; null (unparseable) reads as old, never as current.
  const old = built === null || versionIsNewer(SUPERPOWERS_KIT_SINCE, built) === true;
  if (!old) return kits;
  const d = detectSuperpowers(host, { projectDir: scope === 'project' ? root : null, ...detectRoots });
  const was = built === null ? 'an install with no release marker' : `built by ${built}`;
  if (d.seen) {
    notify?.(`superpowers kit: off — ${was}, before the kit existed; the official plugin is ${describeDetection(d)}`);
    return kits;
  }
  notify?.(`superpowers kit: on — ${was}, before the kit existed, so it keeps its five Rites; the official plugin is ${describeDetection(d)}`);
  return [...kits, 'superpowers'].sort();
}

/**
 * The WARN `doctor` and `status` give one install about its workflow provider, or null when it
 * has exactly one. Two states are wrong, and a plugin is only ever read from a file, so each
 * line names what was read (see `plugin-detect.mjs`):
 *   - the kit is on and the plugin is seen: two providers, duplicate Rites, about 800 tokens
 *     injected per session (start, clear and compact);
 *   - the kit is off and the plugin is not seen: no provider at all.
 * @param {{ host: string, scope: string, root: string, kits: string[], detectRoots?: Parameters<typeof detectSuperpowers>[1] }} a
 */
export function providerWarning({ host, scope, root, kits, detectRoots = {} }) {
  const d = detectSuperpowers(host, { projectDir: scope === 'project' ? root : null, ...detectRoots });
  const on = kits.includes('superpowers');
  if (on && d.seen) {
    return 'WARN: the superpowers kit is on and the official plugin is also loaded (' + describeDetection(d)
      + '): the Rites are duplicated and the plugin injects about 800 tokens a session — turn off one of the two';
  }
  if (!on && !d.seen) {
    return d.supported
      ? `WARN: no workflow provider — the superpowers kit is off and the official plugin is ${describeDetection(d)}`
      : `WARN: no workflow provider — the superpowers kit is off and ${host} has no superpowers plugin`;
  }
  return null;
}

/**
 * `kitsOfDir` plus the migration of an install built before the kit: the set a rebuild of `dir`
 * would build with. `installProfile` is the read-back `rebuild-all`, `update`, `migrate` and
 * `status` share; the readers that render or rebuild one install without it (`diff`, the console's
 * restore and build forms) call this instead, so a pre-kit install reads the same set everywhere,
 * or its five Rites would read as drift in one place and be rebuilt away in another.
 * The scope is read off the folder: a host's global config dir is global, anything else a project.
 */
export function migratedKitsOfDir(dir, host = null, notify = null) {
  let scope = 'project';
  try { if (isGlobalInstall(host, dir)) scope = 'global'; } catch { /* cannot tell: a project */ }
  return migrateSuperpowersKit({
    host: host ?? '', scope, root: dir, kits: kitsOfDir(dir, host, notify), notify,
    knownKits: [...loadKits().keys()], aware: kitAwareOfDir(dir, host),
  });
}
