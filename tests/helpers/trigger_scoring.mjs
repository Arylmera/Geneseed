// SCORING FOR `tests/skill_triggers.mjs`, pulled out so a test can feed it recorded stream lines.
//
// The probe's one rule: a run that could not reach a model is an ERROR, never a miss. A miss
// PASSES every negative case and fails every positive one, so a session that died on an HTTP 429
// (`usage_limit_reached`) used to score a clean sweep of negatives and zero of positives while
// looking like a verdict. Measured 2026-11-15: Claude's stream ends with a `result` event whose
// `is_error` is true and whose `result` text names the cause; the old handler read only `type`.

/** One line of the reason, so a run summary can name why runs errored. */
function reasonOf(ev) {
  const text = typeof ev.result === 'string' ? ev.result : '';
  const why = [ev.subtype, ev.api_error_status, text].filter((x) => x !== undefined && x !== '').join(' ');
  return (why || 'is_error result').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * Claude Code stream-json: fired = a `Skill` tool_use naming the wanted skill; the `result` event
 * ends the run, as an error when `is_error` is set.
 * @returns {(ev: any) => ({ hit: boolean, other: string | null } | { error: string } | null)}
 */
export function claudeScorer(want) {
  let other = null;
  return (ev) => {
    // Decide on the SUBTYPE, not the flag: Claude Code 2.1.302 flags a --max-turns stop
    // (`error_max_turns`) and a budget stop (`error_max_budget_usd`) `is_error: true` too, yet the
    // run reached the model and simply did not call the skill — a miss. Every case runs with
    // --max-turns, so counting those as errors would void most no-fire runs. An error is an API
    // failure (`subtype: "success"`, `is_error: true`, `api_error_status`) or `error_during_execution`.
    if (ev.type === 'result') return ev.is_error && !/^error_max_/.test(ev.subtype ?? '') ? { error: reasonOf(ev) } : { hit: false, other };
    if (ev.type !== 'assistant') return null;
    for (const b of ev.message?.content ?? []) {
      if (b.type !== 'tool_use' || b.name !== 'Skill') continue;
      if (want.test(b.input?.skill ?? '')) return { hit: true, other: null };
      other ??= b.input?.skill;
    }
    return null;
  };
}

/**
 * OpenCode `run --format json`: fired = a `skill` tool part; an `error` event is an errored run;
 * the run ends after `turns` finished steps.
 */
export function opencodeScorer(want, turns) {
  let other = null;
  let steps = 0;
  return (ev) => {
    if (ev.type === 'error') return { error: ev.error?.data?.message ?? ev.error?.name ?? 'error event' };
    if (ev.type === 'step_finish' && ++steps >= Number(turns)) return { hit: false, other };
    const p = ev.part;
    if (p?.type !== 'tool' || p.tool !== 'skill') return null;
    const name = p.state?.input?.name ?? '';
    if (want.test(name)) return { hit: true, other: null };
    other ??= name;
    return null;
  };
}

/**
 * Score one case from its runs. Errored runs leave the count: the verdict is over the valid runs
 * only, and with fewer than half of `runs.length` valid (and never fewer than one) the case is
 * INCONCLUSIVE — a failure of the probe, not a pass. `pass` is null then.
 * @param {{ hit?: boolean, other?: string | null, error?: string }[]} runs
 * @param {boolean} shouldTrigger
 */
export function scoreCase(runs, shouldTrigger) {
  const valid = runs.filter((r) => !r.error);
  const errors = runs.filter((r) => r.error).map((r) => r.error);
  const hits = valid.filter((r) => r.hit).length;
  const others = [...new Set(valid.map((r) => r.other).filter(Boolean))];
  const needed = Math.max(1, Math.ceil(runs.length / 2));
  if (valid.length < needed) return { status: 'inconclusive', pass: null, hits, valid: valid.length, errors, others };
  const pass = (hits / valid.length >= 0.5) === shouldTrigger;
  return { status: pass ? 'pass' : 'fail', pass, hits, valid: valid.length, errors, others };
}
