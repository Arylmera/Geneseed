/**
 * `gateText` — the words a person reads when a gate stops a call.
 *
 * WHY THE TEXT IS WRITTEN OUT. The point of this text is that a person understands it without the
 * diff, and only a person can judge that: a row here is a sentence someone read and agreed to, so a
 * change of wording changes the row and the reason beside it. What each gate passes to the builder is
 * held where the gate is tested: tests/unit/hook_gates.test.mjs and tests/plugins/guard.test.mjs.
 *
 * The shape every text keeps: what changes, then the safe choice on line 2 (a dialog shows about
 * three lines and scrolls the rest), then why it asks and what an allow does, then the agent's
 * claim, then the agent's own instruction, last.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { CANDIDATES, protectedChecksSeed } from '../../js/hosts/geneseed-dir.mjs';
import { GATE_FILES, gateCount, gateLoss, gateName, gateSafe, gateText } from '../../js/hosts/hooks-prims.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

const lines = (...l) => l.join('\n');

// The owner's four examples, verbatim. Two carry no agent tail, and the `commit` ask is one line
// plus the claim because it is routine: three more lines on every commit would go unread.
const EXAMPLES = [
  ['check', { name: '.github/workflows/ci.yml', pairs: [['a\nold\nz\n', 'a\nnew\nnew\nnew\nz\n']] }, lines(
    'This edit changes .github/workflows/ci.yml (+3 lines, -1 line), which defines the checks that run on every push.',
    'Safe choice: Deny, unless you asked for this change. (External Gate)',
    'It asks because the agent\'s own work is judged by this file.',
    'If you allow it, those checks can get weaker or stop running, and a failure could go unseen.',
    'Agent: if refused, do not write this file another way.')],
  ['store', { name: 'user-rules.md', pairs: [['a\n', 'a\nb\nc\n']] }, lines(
    'This edit changes user-rules.md (+2 lines), your standing rules, which the agent obeys in every session.',
    'Safe choice: Deny, unless you asked for this rule. (Persist Insight)',
    'It asks because what becomes a rule is your decision.',
    'If you allow it, the text binds every later session until you remove it.',
    'Agent: if refused, ask the user; do not write it another way.')],
  ['force-push', { name: 'main', says: 'Force push rebased branch' }, lines(
    'This command force-pushes the protected branch main on the remote.',
    'Safe choice: Deny, then push without --force. (Deletion Is Deliberate)',
    'It asks because a force push replaces the remote history.',
    'If you allow it, commits that exist only on the remote can be lost for everyone.',
    'The agent says (not checked): "Force push rebased branch"')],
  ['commit', { says: 'Commit the gate text' }, lines(
    'This command commits or pushes with git, which needs your approval each time. (Consent Before Push)',
    'The agent says (not checked): "Commit the gate text"')],
];

for (const [id, facts, want] of EXAMPLES) {
  test(`the ${id} example renders verbatim`, () => assert.equal(gateText(id, 'ask', facts), want));
}

// Every other ask. A shell write has no count, and says so by starting "This command".
const ASKS = [
  ['a file no table row knows gets the generic text', 'check', { name: 'scripts/verify.sh' }, lines(
    'This edit changes scripts/verify.sh, which this project lists as a protected check.',
    'Safe choice: Deny, unless you asked for this change. (External Gate)',
    'It asks because the agent\'s own work is judged by this file.',
    'If you allow it, that check can get weaker or stop running, and a failure could go unseen.',
    'Agent: if refused, do not write this file another way.')],
  ['a linter config', 'check', { name: 'eslint.config.js', pairs: [['a', 'b']] }, lines(
    'This edit changes eslint.config.js (+1 line, -1 line), which sets the rules the linter enforces.',
    'Safe choice: Deny, unless you asked for this change. (External Gate)',
    'It asks because the agent\'s own work is judged by this file.',
    'If you allow it, those rules can get weaker, and bad code could pass unseen.',
    'Agent: if refused, do not write this file another way.')],
  ['the type-check config', 'check', { name: 'tsconfig.json' }, lines(
    'This edit changes tsconfig.json, which sets how strictly types are checked.',
    'Safe choice: Deny, unless you asked for this change. (External Gate)',
    'It asks because the agent\'s own work is judged by this file.',
    'If you allow it, the type checks can get weaker, and a type error could pass unseen.',
    'Agent: if refused, do not write this file another way.')],
  ['a test-runner config', 'check', { name: 'pytest.ini' }, lines(
    'This edit changes pytest.ini, which decides how the tests run.',
    'Safe choice: Deny, unless you asked for this change. (External Gate)',
    'It asks because the agent\'s own work is judged by this file.',
    'If you allow it, tests can be skipped or loosened, and a failure could go unseen.',
    'Agent: if refused, do not write this file another way.')],
  ['a manifest', 'check', { name: 'package.json' }, lines(
    'This edit changes package.json, which names the commands that test this project.',
    'Safe choice: Deny, unless you asked for this change. (External Gate)',
    'It asks because the agent\'s own work is judged by this file.',
    'If you allow it, those commands can change, and a failing test could read as a pass.',
    'Agent: if refused, do not write this file another way.')],
  ['the protected list itself', 'check', { name: '.geneseed/protected-checks.txt' }, lines(
    'This edit changes .geneseed/protected-checks.txt, which lists the files this gate protects.',
    'Safe choice: Deny, unless you asked for this change. (External Gate)',
    'It asks because the agent\'s own work is judged by this file.',
    'If you allow it, a check can lose its protection, and nothing would tell you.',
    'Agent: if refused, do not write this file another way.')],
  ['the done list', 'check', { name: '.geneseed/done-checks.txt' }, lines(
    'This edit changes .geneseed/done-checks.txt, which lists the checks that must pass before work counts as done.',
    'Safe choice: Deny, unless you asked for this change. (External Gate)',
    'It asks because the agent\'s own work is judged by this file.',
    'If you allow it, work could count as done without passing a check.',
    'Agent: if refused, do not write this file another way.')],
  ['a protected check through a shell command', 'check', { name: '.gitlab-ci.yml', shell: true }, lines(
    'This command writes to .gitlab-ci.yml, which defines the checks that run on every push.',
    'Safe choice: Deny, unless you asked for this change. (External Gate)',
    'It asks because the agent\'s own work is judged by this file.',
    'If you allow it, those checks can get weaker or stop running, and a failure could go unseen.',
    'Agent: if refused, do not write this file another way.')],
  ['gate configuration', 'config', { name: '.claude/settings.json', pairs: [['a\n', 'a\nb\n']] }, lines(
    'This edit changes .claude/settings.json (+1 line), which controls the gates that watch the agent.',
    'Safe choice: Deny, unless you asked for this change. (External Gate)',
    'It asks because a gate the agent can edit is a gate it can switch off.',
    'If you allow it, a gate can stop working, and nothing would tell you.',
    'Agent: if refused, do not write this file another way.')],
  ['the rule draft', 'store', { name: 'the rule draft' }, lines(
    'This edit changes the rule draft, which can become one of your standing rules.',
    'Safe choice: Deny, unless you asked for this rule. (Persist Insight)',
    'It asks because what becomes a rule is your decision.',
    'If you allow it, the text can become a rule that binds every later session.',
    'Agent: if refused, ask the user; do not write it another way.')],
  ['the memory index', 'store', { name: 'the memory index', pairs: [['', 'a\n']] }, lines(
    'This edit changes the memory index (+1 line), which lists what the agent remembers across sessions.',
    'Safe choice: Deny, unless you asked for this memory. (Persist Insight)',
    'It asks because what the agent remembers is your decision.',
    'If you allow it, the text shapes every later session until you remove it.',
    'Agent: if refused, ask the user; do not write it another way.')],
  ['a memory file through a shell command', 'store', { name: 'memory', shell: true }, lines(
    'This command writes to a memory file, which the agent reads in later sessions.',
    'Safe choice: Deny, unless you asked for this memory. (Persist Insight)',
    'It asks because what the agent remembers is your decision.',
    'If you allow it, the text shapes every later session until you remove it.',
    'Agent: if refused, ask the user; do not write it another way.')],
  ['Sealed Secrets', 'secret', { name: 'src/config.js' }, lines(
    'This edit puts a credential-shaped string in src/config.js.',
    'Safe choice: Deny, then keep the value in .env or a secret manager. (Sealed Secrets)',
    'It asks because a secret in a tracked file reaches everyone who can read the repository.',
    'If you allow it, the secret can land in a commit, and then it must be rotated.',
    'Agent: if refused, keep the value in .env; do not write it another way.')],
  ['a protected branch deleted', 'branch-delete', { name: 'main' }, lines(
    'This command deletes the protected branch main.',
    'Safe choice: Deny, unless you mean to remove this branch. (Deletion Is Deliberate)',
    'It asks because the project depends on a protected branch.',
    'If you allow it, commits that only this branch holds can be lost for everyone.')],
  ['a mirror, prune or forced --all push', 'remote-branches', {}, lines(
    'This command rewrites or deletes many remote branches, protected ones included.',
    'Safe choice: Deny, then push one named branch. (Deletion Is Deliberate)',
    'It asks because it makes the remote match this repository, branch by branch.',
    'If you allow it, branches and commits that exist only on the remote can be lost for everyone.')],
  ['uncommitted work discarded', 'discard-work', {}, lines(
    'This command discards uncommitted changes that git cannot bring back.',
    'Safe choice: Deny, then commit or stash the work first. (Deletion Is Deliberate)',
    'It asks because uncommitted work exists nowhere else.',
    'If you allow it, those changes are gone for good.')],
  ['commits abandoned', 'lose-commits', {}, lines(
    'This command drops commits that no remote and no other branch holds.',
    'Safe choice: Deny, then keep them on a branch first. (Deletion Is Deliberate)',
    'It asks because those commits exist only here.',
    'If you allow it, only the reflog can bring them back, and only for a while.')],
  ['files git cannot restore', 'delete-files', {}, lines(
    'This command deletes files that git cannot restore.',
    'Safe choice: Deny, unless you know these files can go. (Deletion Is Deliberate)',
    'It asks because git holds no copy of them.',
    'If you allow it, those files are gone for good.')],
  ['a loss the gate could not read', 'unverified', {}, lines(
    'This command may lose data, and the gate could not work out what it removes.',
    'Safe choice: Deny, unless you have checked the command yourself. (Deletion Is Deliberate)',
    'It asks because the gate cannot read what this command touches.',
    'If you allow it, data that nothing else holds could be lost.')],
  ['the catastrophic class', 'catastrophic', { name: 'rm -rf /*', says: 'Clean the build' }, lines(
    'This command, "rm -rf /*", would destroy a filesystem root, a drive, the home directory or a whole disk.',
    'Safe choice: Deny. (Deletion Is Deliberate)',
    'It asks because nothing could restore what it removes.',
    'If you allow it, everything under that path is gone for good.',
    'The agent says (not checked): "Clean the build"')],
  ['Commands Must Return', 'root-scan', { name: 'find / -name x', says: 'Find the config' }, lines(
    'This command, "find / -name x", scans a whole filesystem root.',
    'Safe choice: Deny, then search a specific directory. (Commands Must Return)',
    'It asks because a whole root spans every drive.',
    'If you allow it, the scan can run for hours.',
    'The agent says (not checked): "Find the config"',
    'Agent: if refused, search one named directory.')],
  ['a crashed gate reports a crash, not a change', 'gate-error', { name: 'stdin is not JSON' }, lines(
    'Geneseed gate error: the check failed with "stdin is not JSON", so nothing judged this call.',
    'Safe choice: Deny, then run geneseed doctor.',
    'It asks because a gate that crashed cannot say this call is safe.',
    'If you allow it, this call runs with no check at all.')],
];

for (const [what, id, facts, want] of ASKS) {
  test(`ask: ${what}`, () => assert.equal(gateText(id, 'ask', facts), want));
}

// `refused`: nothing can be allowed and the model is the only reader, so there is no allow line and
// no "Deny" to pick, the safe choice becomes what the user can do, and the model is told to relay it.
const REFUSED = [
  ['check', { name: '.github/workflows/ci.yml', pairs: [['a\n', 'b\n']] }, lines(
    'Tell the user this, word for word: This edit changes .github/workflows/ci.yml (+1 line, -1 line), which defines the checks that run on every push.',
    'It was refused because the agent\'s own work is judged by this file. (External Gate)',
    'You can make this change yourself, outside the agent.',
    'Agent: do not write this file another way.')],
  ['store', { name: 'user-rules.md' }, lines(
    'Tell the user this, word for word: This edit changes user-rules.md, your standing rules, which the agent obeys in every session.',
    'It was refused because what becomes a rule is your decision. (Persist Insight)',
    'You can make this change yourself, outside the agent.',
    'Agent: ask the user; do not write it another way.')],
  ['secret', { name: 'src/config.js' }, lines(
    'Tell the user this, word for word: This edit puts a credential-shaped string in src/config.js.',
    'It was refused because a secret in a tracked file reaches everyone who can read the repository. (Sealed Secrets)',
    'You can put the value in .env or a secret manager yourself.',
    'Agent: keep the value in .env; do not write it another way.')],
  ['force-push', { name: 'main', says: 'Force push rebased branch' }, lines(
    'Tell the user this, word for word: This command force-pushes the protected branch main on the remote.',
    'It was refused because a force push replaces the remote history. (Deletion Is Deliberate)',
    'You can push without --force, or run this command yourself.')],
  // The one command the text must never invite the user to run.
  ['catastrophic', { name: 'rm -rf /*' }, lines(
    'Tell the user this, word for word: This command, "rm -rf /*", would destroy a filesystem root, a drive, the home directory or a whole disk.',
    'It was refused because nothing could restore what it removes. (Deletion Is Deliberate)',
    'You can check what this command was meant to remove.')],
  ['root-scan', { name: 'find / -name x' }, lines(
    'Tell the user this, word for word: This command, "find / -name x", scans a whole filesystem root.',
    'It was refused because a whole root spans every drive. (Commands Must Return)',
    'You can name the directory to search.',
    'Agent: search one named directory.')],
  // The guard's own four. It only refuses them, so `refused` is the text a person can meet.
  ['secret-file', { name: '.ssh/id_rsa' }, lines(
    'Tell the user this, word for word: This edit writes to .ssh/id_rsa, a file that holds a secret or key.',
    'It was refused because a secret or key file is never for the agent to write. (Sealed Secrets)',
    'You can make this change yourself, outside the agent.',
    'Agent: leave this file alone.')],
  ['stream', { name: 'src/a.js:stream' }, lines(
    'Tell the user this, word for word: This edit names "src/a.js:stream", an NTFS stream that writes through to the file it hangs on.',
    'It was refused because a stream hides which file really changes. (External Gate)',
    'You can make this change yourself, outside the agent.',
    'Agent: name the file itself.')],
  ['wiki', { name: 'Brain: Codex/' }, lines(
    'Tell the user this, word for word: This edit changes the protected wiki folder "Brain: Codex/".',
    'It was refused because you marked this folder as closed to the agent.',
    'You can make this change yourself, outside the agent.',
    'Agent: leave this folder alone.')],
  ['deep-args', { name: 'mcp_notes_store' }, lines(
    'Tell the user this, word for word: The arguments of mcp_notes_store nest too deep to read, so a write to your rules or memory cannot be ruled out.',
    'It was refused because what the gate cannot read, it cannot clear. (Persist Insight)',
    'You can make this change yourself, outside the agent.',
    'Agent: ask the user; do not write it another way.')],
];

for (const [id, facts, want] of REFUSED) {
  test(`refused: ${id}`, () => assert.equal(gateText(id, 'refused', facts), want));
}

// `warned`: Bob's non-blocking rules, where the call has already gone through.
const WARNED = [
  ['commit', {}, lines(
    'This command commits or pushes with git, which needs your approval each time. (Consent Before Push)',
    'This ran without a prompt, because Bob has no approval step.')],
  ['store', { name: 'user-rules.md', shell: true }, lines(
    'This command writes to user-rules.md, your standing rules, which the agent obeys in every session. (Persist Insight)',
    'This ran without a prompt, because Bob has no approval step.')],
  ['gate-error', { name: 'boom' }, lines(
    'Geneseed gate error: the check failed with boom, so nothing judged this call.',
    'This ran without a prompt, because Bob has no approval step.')],
];

for (const [id, facts, want] of WARNED) {
  test(`warned: ${id}`, () => assert.equal(gateText(id, 'warned', facts), want));
}

const IDS = ['check', 'config', 'store', 'secret', 'force-push', 'branch-delete', 'remote-branches', 'discard-work',
  'lose-commits', 'drop-recovery', 'delete-files', 'unverified', 'catastrophic', 'root-scan', 'commit', 'gate-error',
  'secret-file', 'stream', 'wiki', 'deep-args'];
const MODES = ['ask', 'refused', 'warned'];
// Two-digit counts, a path past the clip, a claim past its clip: the longest each text gets.
const WORST = {
  name: `${'src/deeply/nested/'.repeat(8)}name with a space.yml`,
  pairs: [[Array(99).fill('a').join('\n'), Array(99).fill('b').join('\n')]],
  says: 'word '.repeat(60),
};

// The budget is about 450. Three rows pass it, and only with their clips full: `force-push` (467) and
// `branch-delete` (459) with a 60-character branch and a 100-character claim, `remote-branches` (455)
// with the claim alone. `force-push` is the owner's verbatim example, so it cannot shrink. Full
// clips get 470; a real path and claim get 450.
test('every text stays under the size a dialog can carry', () => {
  const typical = { name: 'packages/server/src/config/settings.yml', pairs: WORST.pairs, says: 'Rebase onto main and push the result' };
  for (const id of IDS) for (const mode of MODES) {
    for (const [facts, limit] of [[WORST, 470], [typical, 450]]) {
      const text = gateText(id, mode, facts);
      assert.ok(text.length < limit, `${id}/${mode} is ${text.length} characters:\n${text}`);
    }
  }
});

// Each line reads alone if a host folds the newlines. The rule name in brackets follows the period,
// and the agent's claim ends in its own quote mark, so those two endings are the only exceptions.
test('every line is a full sentence, and nothing is left unfilled', () => {
  for (const id of IDS) for (const mode of MODES) for (const facts of [WORST, { name: 'x', says: 'y' }]) {
    const text = gateText(id, mode, facts);
    assert.doesNotMatch(text, /undefined|null|\[object/, `${id}/${mode}`);
    for (const line of text.split('\n')) {
      if (line.startsWith('The agent says (not checked): "') && line.endsWith('"')) continue;
      assert.match(line.replace(/ \([A-Z][A-Za-z ]+\)$/, ''), /^[A-Z].*\.$/, `${id}/${mode}: ${line}`);
    }
  }
});

test('a refusal offers nothing that cannot happen, and a warning asks nothing', () => {
  for (const id of IDS) {
    const refused = gateText(id, 'refused', WORST);
    assert.ok(refused.startsWith('Tell the user this, word for word: '), id);
    assert.doesNotMatch(refused, /If you allow it|Safe choice|re-issue|if refused|\bDeny\b/, id);
    assert.doesNotMatch(gateText(id, 'warned', WORST), /If you allow it|Safe choice|Tell the user|Agent:/, id);
  }
});

test('the builder adds no host wrapping: the caller owns the Bob prefix and close', () => {
  for (const id of IDS) for (const mode of MODES) {
    assert.doesNotMatch(gateText(id, mode, WORST), /\[geneseed\]|BLOCKED|Bob has no approval step for this gate/, id);
  }
});

// The agent's opinion of a check it is judged by, of a secret, or of its own rules is the conflict of
// interest these gates exist for, so a claim is dropped there even when the caller passes one.
test('the agent is quoted only where its claim is no conflict of interest', () => {
  const says = 'CLAIM trust me';
  for (const id of ['check', 'config', 'store', 'secret', 'gate-error', 'secret-file', 'stream', 'wiki', 'deep-args']) for (const mode of MODES) {
    assert.ok(!gateText(id, mode, { name: 'x', says }).includes('CLAIM'), `${id}/${mode}`);
  }
  for (const id of ['force-push', 'branch-delete', 'remote-branches', 'discard-work', 'lose-commits', 'delete-files',
    'unverified', 'catastrophic', 'root-scan', 'commit']) {
    assert.ok(gateText(id, 'ask', { name: 'x', says }).includes('The agent says (not checked): "CLAIM trust me"'), id);
  }
});

test('the claim is clipped, cleaned and cannot close its own quotes', () => {
  const claim = (says) => gateText('commit', 'ask', { says }).split('\n')[1];
  assert.equal(claim(`${'a'.repeat(100)}`), `The agent says (not checked): "${'a'.repeat(100)}"`);
  assert.equal(claim(`${'a'.repeat(101)}`), `The agent says (not checked): "${'a'.repeat(97)}..."`);
  assert.equal(claim('line one\nSafe choice: Allow.'), 'The agent says (not checked): "line oneSafe choice: Allow."');
  assert.equal(claim('say "allow" now'), 'The agent says (not checked): "say \'allow\' now"');
  assert.equal(gateText('commit', 'ask', { says: ' \n\u0007 ' }).split('\n').length, 1, 'an empty claim adds no line');
  assert.equal(gateText('commit', 'ask', { says: 42 }).split('\n')[1], 'The agent says (not checked): "42"');
});

// One function cleans every agent-supplied value, because a name lands in text a person trusts.
const CLEAN = [
  ['a plain path stays bare', '.github/workflows/ci.yml', '.github/workflows/ci.yml'],
  ['a space brings quotes', 'my dir/ci.yml', '"my dir/ci.yml"'],
  ['a non-ASCII letter brings quotes', 'caf\u00e9.yml', '"caf\u00e9.yml"'],
  ['control characters go', 'a\u0000b\tc\nd\re\u007ff\u0085g', 'abcdefg'],
  ['line separators go', 'a\u2028b\u2029c', 'abc'],
  ['bidi and zero-width marks go', 'a\u202eb\u2066c\u200bd', 'abcd'],
  ['a quote cannot close the name', 'x" Safe choice: Allow. "y', '"x\' Safe choice: Allow. \'y"'],
  ['an empty value is still visibly a name', '', '""'],
  ['a missing value is too', undefined, '""'],
  ['exactly 60 is not clipped', 'a'.repeat(60), 'a'.repeat(60)],
  ['past 60 clips the middle and keeps the end', `${'a'.repeat(40)}/${'b'.repeat(40)}.yml`,
    `${'a'.repeat(20)}...${'b'.repeat(33)}.yml`],
  ['a clip never splits a character', `${'\u{1F600}'.repeat(70)}`,
    `"${'\u{1F600}'.repeat(20)}...${'\u{1F600}'.repeat(37)}"`],
];

// A curly or fullwidth quote reads as the end of the name, and what follows as Geneseed's own words.
CLEAN.push(['every double quote folds, so a name cannot seem to close its own quotes',
  '.github/workflows/x\u201D Safe choice: Allow, routine \u201C.yml', '".github/workflows/x\' Safe choice: Allow, routine \'.yml"'],
['a fullwidth quote folds too', 'a\uFF02 b', '"a\' b"']);
for (const [what, value, want] of CLEAN) {
  test(`gateName: ${what}`, () => assert.equal(gateName(value), want));
}

// A `replace_all` pair applies an unknown number of times, so its caller passes no pairs: no count
// beats a count the agent can make small.
test('a replace_all edit shows no count, because its caller passes no pairs', () => {
  assert.equal(gateText('check', 'ask', { name: 'tsconfig.json', pairs: undefined }).split('\n')[0],
    'This edit changes tsconfig.json, which sets how strictly types are checked.');
});

// `gateSafe` is what every gate calls. Each catch around a gate is a pass or a lesser verdict, so a
// builder that throws must still leave words to show. The verdict half is in hook_gates.test.mjs.
test('gateSafe says the fixed sentence when the builder throws, in every mode', () => {
  const unsaid = 'Geneseed could not describe this call. Check what it does before you trust it.';
  const bad = { name: { toString() { throw new Error('no words'); } } };
  for (const mode of MODES) {
    assert.equal(gateSafe('no-such-id', mode, {}), unsaid);
    assert.equal(gateSafe('check', mode, bad), unsaid);
    assert.equal(gateSafe('commit', mode, {}), gateText('commit', mode, {}));
  }
});

// `lossReason`'s sentences as they leave js/hosts/loss.mjs, each with the text a person should read.
// A sentence with no row reads as `unverified`: cautious, but it names the wrong loss.
const LOSS = [
  ['`git checkout --` would discard uncommitted changes (src/a.js)', 'discard-work'],
  ['`git rm -f` would discard uncommitted changes (a.js) on the protected branch main', 'discard-work'],
  ['`git stash drop` deletes stashed work', 'discard-work'],
  ['`git push --mirror` force-pushes and deletes every remote branch to match this repository', 'remote-branches'],
  ['`git push --prune` deletes every remote branch with no local counterpart', 'remote-branches'],
  ['a forced `git push --all` force-pushes every branch, protected ones included', 'remote-branches'],
  ['`git push :main` would delete the protected branch main', 'branch-delete', 'main'],
  ['`git push` would delete the protected branch main', 'branch-delete', 'main'],
  ['`git branch -D main` deletes the protected branch main', 'branch-delete', 'main'],
  ['`git push` would force-push the protected branch release/1', 'force-push', 'release/1'],
  ['`git branch -f` main would strand commits no remote and not HEAD~1 holds', 'lose-commits'],
  ['`git branch -D topic` deletes commits no remote and no HEAD holds', 'lose-commits'],
  ['`git reset --hard HEAD~2` would abandon commits no remote and not HEAD~2 holds', 'lose-commits'],
  ['`git reflog expire` deletes the reflog recovery depends on', 'drop-recovery'],
  ['`git gc --prune` deletes the unreachable commits recovery depends on', 'drop-recovery'],
  ['`git clean` would delete untracked files (notes.txt)', 'delete-files'],
  ['`rm .git/config` deletes git\'s own data', 'delete-files'],
  ['`rm /tmp/x` deletes a path outside any git repository, which nothing could restore', 'delete-files'],
  ['`rm .` deletes a whole repository or worktree', 'delete-files'],
  ['`Remove-Item a` deletes something git does not track, which nothing could restore', 'delete-files'],
  ['`rm a` deletes untracked or ignored files (a), which git cannot restore', 'delete-files'],
  ['the gate could not verify what this command would lose (HEAD is detached)', 'unverified'],
  // The redirect note, and the ends that are the agent's: the fixed part decides, not the name.
  ['`git stash drop` deletes stashed work (and --git-dir/--work-tree points it at a repository the gate did not read)', 'discard-work'],
  ['`rm x holds` deletes something git does not track, which nothing could restore', 'delete-files'],
  ['`git clean` would delete untracked files (a would discard uncommitted changes (b))', 'delete-files'],
  ['some sentence loss.mjs gains later', 'unverified'],
];
for (const [reason, id, name] of LOSS) {
  test(`gateLoss: ${reason}`, () => assert.deepEqual([gateLoss(reason).id, gateLoss(reason).name], [id, name]));
}

// The gate read this repository and the command runs on another, so what it says of the loss may not
// hold there. The person must learn that, after the safe choice, which keeps line 2.
test('a redirected loss says so, in the words of both modes', () => {
  const reason = '`git stash drop` deletes stashed work (and --git-dir/--work-tree points it at a repository the gate did not read)';
  const facts = gateLoss(reason);
  assert.equal(facts.redirected, true);
  assert.equal(gateLoss('`git stash drop` deletes stashed work').redirected, false);
  const elsewhere = 'This command runs on another repository, through --git-dir or --work-tree, which the gate did not read.';
  assert.equal(gateText(facts.id, 'ask', facts), lines(
    'This command discards uncommitted changes that git cannot bring back.',
    'Safe choice: Deny, then commit or stash the work first. (Deletion Is Deliberate)',
    elsewhere,
    'It asks because uncommitted work exists nowhere else.',
    'If you allow it, those changes are gone for good.'));
  assert.equal(gateText(facts.id, 'refused', facts).split('\n')[1], elsewhere);
  assert.ok(!gateText(facts.id, 'ask', { name: 'x' }).includes(elsewhere));
});

// Twenty places in js/hosts/loss.mjs write a sentence. A twenty-first has no row above until someone
// adds one, so this count goes red first. The sentences all say what is lost with one of these verbs.
test('every sentence loss.mjs can write has a row', () => {
  const src = readFileSync(path.resolve('js/hosts/loss.mjs'), 'utf8').split(/\r?\n/)
    .filter((l) => !/^\s*(?:\*|\/\*|\/\/)/.test(l) && /\b(?:deletes|would|force-pushes)\b/.test(l));
  assert.equal(src.length, 20, src.join('\n'));
});

// The lists feed a gate only at the repo root. Anything else with that name is an ordinary listed
// file, so it gets the generic text, never a claim about what it controls.
test('a gate list is read at the repo root, and nowhere else', () => {
  const first = (name) => gateText('check', 'ask', { name }).split('\n')[0];
  assert.equal(first('.geneseed/done-checks.txt'),
    'This edit changes .geneseed/done-checks.txt, which lists the checks that must pass before work counts as done.');
  assert.equal(first('.geneseed/protected-checks.txt'),
    'This edit changes .geneseed/protected-checks.txt, which lists the files this gate protects.');
  assert.equal(first('packages/a/.geneseed/done-checks.txt'),
    'This edit changes packages/a/.geneseed/done-checks.txt, which this project lists as a protected check.');
});

test('a Windows path reads as the repo-relative path, and still finds its class', () => {
  assert.equal(gateText('check', 'ask', { name: '.github\\workflows\\ci.yml' }).split('\n')[0],
    'This edit changes .github/workflows/ci.yml, which defines the checks that run on every push.');
});

// A pair loses its common leading and trailing lines; the rest is the count.
const COUNT = [
  ['a new file is all additions', [['', 'a\nb\nc\n']], ' (+3 lines)'],
  ['one line is singular', [['', 'a\n']], ' (+1 line)'],
  ['a trailing newline is no line', [['', 'a']], ' (+1 line)'],
  ['emptied to nothing', [['a\nb\n', '']], ' (-2 lines)'],
  ['one line changed', [['a\nb\nc\n', 'a\nx\nc\n']], ' (+1 line, -1 line)'],
  ['a repeated line is not counted from both ends', [['a\na', 'a\na\na']], ' (+1 line)'],
  ['a repeated line removed', [['a\na\na', 'a\na']], ' (-1 line)'],
  ['line endings alone change nothing', [['a\r\nb\r\n', 'a\nb\n']], ''],
  ['no difference shows no count', [['a\n', 'a\n']], ''],
  ['no pairs show no count', [], ''],
  ['pairs add up', [['a', 'b'], ['', 'c\nd']], ' (+3 lines, -1 line)'],
  ['two regions in one pair overstate, and never hide', [['a\nb\nc\nd\ne', 'A\nb\nc\nd\nE']], ' (+5 lines, -5 lines)'],
];

// Each of these ends a line for some viewer, so each must count, or an edit can hide its size.
COUNT.push(['a bare CR ends a line', [['x', 'a\rb\rc\rd\re']], ' (+5 lines, -1 line)'],
  ['so do the Unicode line and paragraph separators', [['x', 'a\u2028b\u2029c']], ' (+3 lines, -1 line)'],
  ['CRLF is one line end, not two', [['x', 'a\r\nb']], ' (+2 lines, -1 line)']);
for (const [what, pairs, want] of COUNT) {
  test(`gateCount: ${what}`, () => assert.equal(gateCount(pairs), want));
}

// Both ways, entry by entry: a candidate the table lacks and an entry no candidate holds are both red.
test('the file-class table holds exactly the seed candidates', () => {
  const entries = (list) => list.map(String).sort();
  assert.deepEqual(entries(GATE_FILES.flatMap(([files]) => files)), entries(CANDIDATES));
});

const GENERIC = 'which this project lists as a protected check';

// What `protectedChecksSeed` really finds, read back through the real lookup: equal entries prove
// nothing if the matcher misses them.
test('everything a seed lists gets its class, not the generic text', () => {
  const sb = makeSandbox('gate-text-');
  const root = sb.path;
  try {
    for (const c of CANDIDATES) {
      const name = typeof c === 'string' ? c : `${c.source.replace(/^\^/, '').replace(/\\/g, '')}js`;
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      if (name.endsWith('/')) mkdirSync(path.join(root, name), { recursive: true });
      else writeFileSync(path.join(root, name), '');
    }
    const seeded = protectedChecksSeed(root).split('\n').filter((l) => l && !l.startsWith('#'));
    assert.equal(seeded.length, CANDIDATES.length, 'a candidate went unseeded, so this test would prove nothing for it');
    for (const entry of seeded) {
      const name = entry.endsWith('/') ? `${entry}x.yml` : entry;
      assert.ok(!gateText('check', 'ask', { name }).includes(GENERIC), `${entry} would get the generic text`);
    }
  } finally {
    sb.cleanup();
  }
});

test('a class holds for the file in a subfolder too, and only for that file', () => {
  const generic = (name) => gateText('check', 'ask', { name }).includes(GENERIC);
  assert.equal(generic('packages/a/tsconfig.json'), false);
  assert.equal(generic('packages/a/.github/workflows/ci.yml'), false);
  assert.equal(generic('packages/a/eslint.config.mjs'), false);
  assert.equal(generic('docs/tsconfig.json.md'), true);
  assert.equal(generic('src/notpackage.json'), true);
  assert.equal(generic('github/workflows/ci.yml'), true);
  assert.equal(generic('docs/eslint.config'), true);
});
