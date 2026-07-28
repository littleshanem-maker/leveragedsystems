function melbourneDate(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value));
}

function shiftDate(date, days) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function melbourneWeek(referenceDate = new Date()) {
  const referenceLocalDate = melbourneDate(referenceDate);
  const day = new Date(`${referenceLocalDate}T00:00:00.000Z`).getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const startDate = shiftDate(referenceLocalDate, -daysSinceMonday);
  return { startDate, endDate: shiftDate(startDate, 7) };
}

export function buildWeeklyScorecard(events, {
  referenceDate = new Date(),
  targets = { firstApproaches: 50, warmActions: 20, followUps: 30 },
} = {}) {
  const week = melbourneWeek(referenceDate);
  const weeklyEvents = events.filter((event) => {
    const date = melbourneDate(event.createdAt);
    return date >= week.startDate && date < week.endDate;
  });
  const counts = {
    firstApproaches: 0,
    warmActions: 0,
    followUps: 0,
    replies: 0,
    engagedLeads: 0,
    calls: 0,
    confirmedProblems: 0,
    recommendations: 0,
    proposals: 0,
    sales: 0,
    cashCollected: 0,
  };
  const engagedProspects = new Set();
  for (const event of weeklyEvents) {
    if (event.kind === 'email.sent') {
      if (event.payload.actionType === 'first_approach') counts.firstApproaches += 1;
      if (event.payload.actionType === 'warm_action') counts.warmActions += 1;
      if (event.payload.actionType === 'follow_up') counts.followUps += 1;
    }
    if (event.kind === 'reply.recorded') {
      counts.replies += 1;
      if (event.prospectId) engagedProspects.add(event.prospectId);
    }
    if (event.kind === 'call.recorded') counts.calls += 1;
    if (event.kind === 'problem.confirmed') counts.confirmedProblems += 1;
    if (event.kind === 'recommendation.made') counts.recommendations += 1;
    if (event.kind === 'proposal.sent') counts.proposals += 1;
    if (event.kind === 'sale.won') counts.sales += 1;
    if (event.kind === 'cash.collected') counts.cashCollected += Number(event.payload.amount || 0);
  }
  counts.engagedLeads = engagedProspects.size;
  return { week, targets, counts };
}
