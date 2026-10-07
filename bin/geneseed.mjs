#!/usr/bin/env node
/**
 * The generator's PRE-RENAME path, kept as a forwarder to `bin/build-driver.mjs`.
 *
 * WHY A RENAMED FILE STILL HAS TO EXIST. `geneseed upgrade` runs the updater it started with:
 * its module graph is loaded before the `git pull`, so an updater older than the rename
 * (5c970dc9, 2026-08) pulls the new tree and then spawns `bin/geneseed.mjs` to rebuild —
 * a file the tree it just pulled no longer has. The doctor gate passes (it spawns
 * `geneseed-cli.mjs`, which never moved), and the rebuild dies with MODULE_NOT_FOUND and
 * `[E-BUILD]`. An old web daemon's build jobs spawn the same path. Nothing in this tree
 * calls it, and it has no npm name on purpose: it is a landing pad for old processes, not a
 * fourth entry point.
 *
 * Importing the driver entry runs it on this process's argv, which is the argv the old
 * caller passed — so the forwarding is the import and nothing else.
 */
import './build-driver.mjs';
