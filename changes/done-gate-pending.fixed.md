- **The done gate no longer blocks a turn that only waits on its background proof.** When every
  owed check is a background run still running, the turn ends with a `done-gate-pending` ledger
  line (and, on a main turn, a warning naming the checks), and the run is judged when its
  notification resumes the agent: green passes, red blocks. Before, the block was followed by the
  cap in nearly every case: 230 blocks against 237 caps in a month of one machine's ledger. A
  sub-agent the host does not resume ends unjudged, as it did one stop later under the cap.
- **A sub-agent's green background run is credited again.** In a sub-agent's transcript Claude Code
  writes the task notification behind a `[SYSTEM NOTIFICATION - NOT USER INPUT]` preamble, which
  the gate did not read, so the worker owed a suite that had passed.
- **The developer agent runs its proof unpiped.** Its procedure now says that a pipe hides the
  exit code from the done gate, and to redirect output to a file instead.
