import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTodayModel, prospectNeedsAction } from '../../internal/outreach-desk/public/view-model.mjs';

const prospects = [
  { id: 'p1', companyName: 'Alpha', status: 'qualified' },
  { id: 'p2', companyName: 'Beta', status: 'disqualified' },
  { id: 'p3', companyName: 'Gamma', status: 'engaged' },
];

test('sorts overdue and due work ahead of later actions and omits inactive states', () => {
  const model = buildTodayModel({
    now: new Date('2026-07-28T12:00:00+10:00'),
    prospects,
    actions: [
      { id: 'later', prospectId: 'p1', type: 'research', state: 'pending', dueAt: '2026-07-31T00:00:00.000Z' },
      { id: 'done', prospectId: 'p1', type: 'first_approach', state: 'completed', dueAt: '2026-07-27T00:00:00.000Z' },
      { id: 'today', prospectId: 'p3', type: 'warm_action', state: 'pending', dueAt: '2026-07-28T04:00:00.000Z' },
      { id: 'overdue', prospectId: 'p1', type: 'follow_up', state: 'pending', dueAt: '2026-07-25T00:00:00.000Z' },
    ],
  });
  assert.deepEqual(model.active.map((item) => item.id), ['overdue', 'today', 'later']);
  assert.deepEqual(model.groups.overdue.map((item) => item.id), ['overdue']);
  assert.deepEqual(model.groups.today.map((item) => item.id), ['today']);
  assert.equal(model.complete, false);
});

test('shows completion when no required action remains and flags active prospects without one', () => {
  const empty = buildTodayModel({ now: new Date('2026-07-28T12:00:00+10:00'), prospects, actions: [] });
  assert.equal(empty.complete, true);
  assert.deepEqual(empty.missingNextAction.map((prospect) => prospect.id), ['p1', 'p3']);
  assert.equal(prospectNeedsAction(prospects[1], []), false);
});
