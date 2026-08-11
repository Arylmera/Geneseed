/**
 * `_harness_core.NO_WINDOW` — the one spawn flag, in one place.
 *
 * Windows gives every console child of a CONSOLE-LESS parent a brand-new console window.
 * The web daemon is console-less by design (`DETACHED_PROCESS`), so without this flag every
 * short-lived process it shells out to pops a window and closes it — the Doctor page is the
 * worst case, running `node --check` once per plugin, and it is what a user actually sees:
 * seven consoles flashing on a dashboard load.
 *
 * WHY IT LIVES HERE AND NOT IN `js/update.mjs`, WHICH DEFINED IT FIRST. It was private to
 * that module and six of its spawns used it, so the four spawn sites in `js/doctor.mjs`,
 * `js/hooks.mjs`, `js/setup.mjs` and `js/link.mjs` each had to remember the flag on their
 * own. Two of them did not — and the miss is BYTE-INVISIBLE: a console window is not
 * something either implementation prints, so `golden.py`'s 259 cells and the web corpus
 * compare two CLIs that differ only in something neither one puts on stdout. The same shape
 * as P5b's transport hole: the property under test never reaches the comparison. A shared
 * constant plus `tests/test_spawn_hygiene.py` is what makes the next spawn site inherit the
 * answer instead of re-deciding it.
 *
 * CAPTURING SPAWNS ONLY, and the asymmetry is the reference's, not a Node preference.
 * Python sets `STARTF_USESTDHANDLES` only when a stream is redirected, so `CREATE_NO_WINDOW`
 * on an INHERITING spawn hands the child a fresh hidden console and discards everything it
 * prints — measured in P5e, where `geneseed build > log.txt` wrote an empty file. libuv
 * always passes the handles explicitly, so the flag on an inheriting spawn is harmless HERE;
 * it stays off anyway, because the port reproduces the reference's behaviour rather than
 * improving on it, and an inheriting child of a console-owning parent shows no window in the
 * first place.
 */
export const NO_WINDOW = { windowsHide: process.platform === 'win32' };
