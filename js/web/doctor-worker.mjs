/**
 * The console's warm-up doctor, on its own thread (`warmDoctor` in `state.mjs`).
 *
 * A thread and not a child process: the CLI graph may not grow a spawn, and one message out is the
 * whole protocol. `jobs.mjs` argues the opposite for jobs, which need stdout and an exit code.
 * Its `process.stdout` is this thread's own, so the doctor's swallow cannot touch the daemon's.
 */
import { parentPort, workerData } from 'node:worker_threads';

import { doctorCollect } from '../inspect/doctor.mjs';

const groups = [];
const [themes, problems] = doctorCollect({ theme: workerData.theme, groups });
parentPort.postMessage({ themes, problems, groups });
