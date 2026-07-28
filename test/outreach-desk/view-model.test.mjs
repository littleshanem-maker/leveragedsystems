import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTodayModel,
  buildColdCallGuide,
  createLatestRequestGuard,
  escapeHtmlAttribute,
  prospectNeedsAction,
  safePhoneHref,
  safeSourceHref,
  withFormSubmissionLock,
} from '../../internal/outreach-desk/public/view-model.mjs';

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
  assert.equal(model.dueFollowUps, 1);
  assert.equal(model.draftsAwaitingReview, 0);
  assert.equal(model.complete, false);
});

test('shows completion when no required action remains and flags active prospects without one', () => {
  const empty = buildTodayModel({ now: new Date('2026-07-28T12:00:00+10:00'), prospects, actions: [] });
  assert.equal(empty.complete, true);
  assert.deepEqual(empty.missingNextAction.map((prospect) => prospect.id), ['p1', 'p3']);
  assert.equal(prospectNeedsAction(prospects[1], []), false);
});

test('renders only HTTP evidence links from stored or restored records', () => {
  assert.equal(safeSourceHref('https://example.com/evidence'), 'https://example.com/evidence');
  assert.equal(safeSourceHref('javascript:alert(1)'), null);
  assert.equal(safeSourceHref('not a URL'), null);
});

test('creates safe click-to-call links from public phone numbers', () => {
  assert.equal(safePhoneHref('+61 (0)3 9000 1234'), 'tel:+61390001234');
  assert.equal(safePhoneHref('03 9000 1234 ext 5'), null);
  assert.equal(safePhoneHref('javascript:alert(1)'), null);
  assert.equal(safePhoneHref(''), null);
});

test('builds a tailored cold call guide from prospect evidence', () => {
  const guide = buildColdCallGuide({
    decisionMaker: 'Morgan Chen',
    problemHypothesis: 'variation evidence is split between inboxes and site records',
    evidence: 'The company lists four live commercial projects.',
  });

  assert.match(guide.opener, /Morgan Chen/);
  assert.match(guide.opener, /variation evidence is split between inboxes and site records/);
  assert.match(guide.opener, /cold call/i);
  assert.match(guide.opener, /30 seconds/);
  assert.match(guide.question, /chase, reconstruct or manually check/);
  assert.equal(guide.evidence, 'The company lists four live commercial projects.');
  assert.match(guide.guardrail, /Do not diagnose/i);
});

test('escapes restored identifiers before interpolation into HTML attributes', () => {
  assert.equal(escapeHtmlAttribute(`draft\" autofocus onfocus='alert(1)'`), 'draft&quot; autofocus onfocus=&#39;alert(1)&#39;');
  assert.equal(escapeHtmlAttribute('<script>&'), '&lt;script&gt;&amp;');
});

test('only the newest prospect request remains current', () => {
  const guard = createLatestRequestGuard();
  const first = guard.begin();
  const second = guard.begin();
  assert.equal(first(), false);
  assert.equal(second(), true);
  guard.invalidate();
  assert.equal(second(), false);
});

test('locks only one submitted form until its operation settles and restores control state', async () => {
  const controls = [{ disabled: false }, { disabled: true }];
  const attributes = new Map();
  const form = {
    querySelectorAll: () => controls,
    setAttribute: (name, value) => attributes.set(name, value),
  };
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const first = withFormSubmissionLock(form, async () => {
    calls += 1;
    await pending;
  });

  assert.deepEqual(controls.map((control) => control.disabled), [true, true]);
  assert.equal(attributes.get('aria-busy'), 'true');
  assert.equal(await withFormSubmissionLock(form, async () => { calls += 1; }), false);
  assert.equal(calls, 1);

  release();
  assert.equal(await first, true);
  assert.deepEqual(controls.map((control) => control.disabled), [false, true]);
  assert.equal(attributes.get('aria-busy'), 'false');
});
