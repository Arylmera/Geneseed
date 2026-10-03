#!/usr/bin/env node
/**
 * `geneseed-build` — the generator's entry. Everything it does lives in `js/build/driver.mjs`,
 * which the CLI verbs import too; this file only hands it argv. Keeping the entry this thin is
 * what lets a `js/` module import the driver without running it on the importer's argv.
 */
// FIRST, before anything it could fail to run: an old Node gets one sentence, not a stack trace.
import '../js/lib/node-floor.mjs';
import { main } from '../js/build/driver.mjs';

process.exitCode = main(process.argv.slice(2));
