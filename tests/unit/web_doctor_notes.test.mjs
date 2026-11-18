// A `[note] …` line from `doctorCollect` is information, not a problem: the CLI keeps them
// apart (`js/inspect/doctor.mjs`), and the console's state layer must too, or a healthy machine
// reads "1 problem". `stampDoctor` is the one split, shared by the in-process run and the
// warm-up worker's message.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { webFixtureTeardown } from '../helpers/web_fixture.mjs';
import { webState } from '../helpers/web_api_fixture.mjs';
import { apiDoctor } from '../../js/web/api.mjs';

after(webFixtureTeardown);

const NOTE = '[note] learn: nothing to learn yet';

test('a note-only run is ok, with the note beside the problems, per group too', () => {
  const st = webState('neutral');
  st.stampDoctor([NOTE], ['neutral'], [{ check: 'learn', label: 'Learn', problems: [NOTE] }]);
  assert.equal(st._doctor.ok, true);
  assert.deepEqual(st._doctor.problems, []);
  assert.deepEqual(st._doctor.notes, [NOTE]);
  const g = st._doctorRun.groups[0];
  assert.deepEqual(g.problems, []);
  assert.deepEqual(g.notes, [NOTE]);
});

test('a real problem stays a problem next to a note, and the API answers both', () => {
  const st = webState('neutral');
  st.stampDoctor(['dead link x', NOTE], ['neutral'],
    [{ check: 'build', label: 'Build', problems: ['dead link x', NOTE] }]);
  const a = apiDoctor(st);
  assert.equal(a.ok, false);
  assert.deepEqual(a.problems, ['dead link x']);
  assert.deepEqual(a.notes, [NOTE]);
  assert.deepEqual(a.groups[0].problems, ['dead link x']);
  assert.deepEqual(a.groups[0].notes, [NOTE]);
});
