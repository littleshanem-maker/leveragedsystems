import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDailyActivity, buildWeeklyScorecard, melbourneWeek } from '../../internal/outreach-desk/lib/reporting.mjs';

test('counts completed acquisition and funnel events once while excluding internal preparation', () => {
  const events = [
    ['email.sent', { actionType: 'first_approach' }, 'p1'],
    ['email.sent', { actionType: 'warm_action' }, 'p2'],
    ['email.sent', { actionType: 'follow_up' }, 'p1'],
    ['draft.created', {}, 'p3'],
    ['draft.opened', {}, 'p3'],
    ['reply.recorded', {}, 'p1'],
    ['reply.recorded', {}, 'p1'],
    ['call.recorded', {}, 'p1'],
    ['call.recorded', {}, 'p2'],
    ['call.attempted', { outcome: 'no_answer' }, 'p1'],
    ['call.attempted', { outcome: 'connected' }, 'p2'],
    ['call.attempted', { outcome: 'booked' }, 'p3'],
    ['problem.confirmed', {}, 'p1'],
    ['problem.confirmed', {}, 'p3'],
    ['recommendation.made', {}, 'p1'],
    ['proposal.sent', {}, 'p1'],
    ['sale.won', {}, 'p1'],
    ['cash.collected', { amount: 5000 }, 'p1'],
  ].map(([kind, payload, prospectId], index) => ({
    id: `e${index}`, kind, payload, prospectId, createdAt: '2026-07-28T02:00:00.000Z',
  }));
  const scorecard = buildWeeklyScorecard(events, { referenceDate: new Date('2026-07-29T02:00:00.000Z') });
  assert.deepEqual(scorecard.counts, {
    firstApproaches: 1, warmActions: 1, followUps: 1, replies: 2, engagedLeads: 3,
    calls: 2, coldCallAttempts: 3, coldCallConnections: 2, coldCallBookings: 1,
    confirmedProblems: 2, recommendations: 1, proposals: 1, sales: 1, cashCollected: 5000,
  });
});

test('uses Melbourne Monday-to-Sunday boundaries across daylight-saving changes', () => {
  const bounds = melbourneWeek(new Date('2026-10-04T15:30:00.000Z'));
  assert.equal(bounds.startDate, '2026-10-05');
  assert.equal(bounds.endDate, '2026-10-12');
  const events = [
    { id: 'sun', kind: 'email.sent', prospectId: 'p1', payload: { actionType: 'first_approach' }, createdAt: '2026-10-04T12:00:00.000Z' },
    { id: 'mon', kind: 'email.sent', prospectId: 'p2', payload: { actionType: 'first_approach' }, createdAt: '2026-10-04T13:01:00.000Z' },
  ];
  assert.equal(buildWeeklyScorecard(events, { referenceDate: new Date('2026-10-04T15:30:00.000Z') }).counts.firstApproaches, 1);
});

test('reports only real acquisition events from the current Melbourne day', () => {
  const events = [
    { kind: 'email.sent', payload: { actionType: 'first_approach' }, createdAt: '2026-07-27T13:59:00.000Z' },
    { kind: 'email.sent', payload: { actionType: 'first_approach' }, createdAt: '2026-07-27T14:01:00.000Z' },
    { kind: 'email.sent', payload: { actionType: 'warm_action' }, createdAt: '2026-07-28T02:00:00.000Z' },
    { kind: 'draft.created', payload: {}, createdAt: '2026-07-28T03:00:00.000Z' },
  ];
  assert.deepEqual(buildDailyActivity(events, { referenceDate: new Date('2026-07-28T04:00:00.000Z') }), {
    date: '2026-07-28',
    counts: {
      firstApproaches: 1, warmActions: 1, followUps: 0,
      coldCallAttempts: 0, coldCallConnections: 0, coldCallBookings: 0,
    },
  });
});
