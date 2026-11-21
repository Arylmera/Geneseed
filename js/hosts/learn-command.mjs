/**
 * The learn hook's model command, from the host and the `--learn-model` value the emit bakes into the hook's
 * command line (O13, spec 2026-11-21-memory-load-and-dedupe, D15–D17).
 *
 * WHY NOT `env.GENESEED_LLM` ANY MORE. A Claude-family command hook has no way to the session's model: the
 * host's `prompt` and `agent` hook types do not run on PreCompact or SessionEnd and answer with a decision
 * only, so a second `claude -p` is unavoidable. What was avoidable is where its command lived. In the settings
 * `"env"` it reached every shell the host starts, which made a test suite run inside a session read it (F14),
 * and it needed an ownership dance (replace-if-ours, "set in your shell") to tell Geneseed's value from the
 * user's. Baked into the hook's own argv, it reaches only the hook, and `$GENESEED_LLM` is left wholly to the
 * user: set, it wins (a custom CLI or model); unset, the hook derives the command here.
 *
 * Pure and import-free: the hook path (every PreCompact/SessionEnd) and the generator (under a spawn ban)
 * both import it.
 */

/** `--learn-model session`: no `--model`, so the CLI uses the user's own default model. */
export const LEARN_SESSION = 'session';

/**
 * A model id that may ride in the hook's command line, which a shell runs (`… || exit 0`). Letters and digits,
 * then `.` `_` `-` `:` `/` `@` — enough for an alias (`haiku`), a full id, a Bedrock id
 * (`us.anthropic.claude-haiku-4-5-20251001-v1:0`) and a Vertex one (`claude-haiku-4-5@20251001`) — and nothing a
 * shell reads: no space, quote, `$`, backtick, `;`, `|`, `&`, `<`, `>`. The value comes from
 * `agent-overrides.json`, a file the user edits by hand.
 */
export const LEARN_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,199}$/;

/** The CLI a Claude-family host runs its learn child with, or null for a host that does not learn this way. */
const cliOf = (host) => (host === 'openclaude' ? 'openclaude' : host === 'claude' || !host ? 'claude' : null);

/**
 * The model command for `host` and a `--learn-model` value: `<cli> -p --model <m>`, `<cli> -p` for `session`,
 * null when the value is absent (learning off) or not a safe model id. The lean flags are not here: learn adds
 * them at run time to any command whose first word is the CLI (`leanArgv`, js/hosts/hooks-learn.mjs).
 */
export function learnCommandFor(host, learnModel) {
  const cli = cliOf(host);
  if (!cli || typeof learnModel !== 'string' || !learnModel) return null;
  if (learnModel === LEARN_SESSION) return `${cli} -p`;
  return LEARN_MODEL_RE.test(learnModel) ? `${cli} -p --model ${learnModel}` : null;
}
