const TERMINAL_STATUSES = new Set(['won', 'disqualified', 'no_response']);
const ACTIVE_ACTION_STATES = new Set(['pending', 'deferred']);

function melbourneDay(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value));
}

export function prospectNeedsAction(prospect, actions) {
  if (TERMINAL_STATUSES.has(prospect.status)) return false;
  return !actions.some((action) => action.prospectId === prospect.id && ACTIVE_ACTION_STATES.has(action.state));
}

export function buildTodayModel({ actions = [], drafts = [], prospects = [], now = new Date() } = {}) {
  const prospectById = new Map(prospects.map((prospect) => [prospect.id, prospect]));
  const today = melbourneDay(now);
  const active = actions
    .filter((action) => ACTIVE_ACTION_STATES.has(action.state))
    .filter((action) => !TERMINAL_STATUSES.has(prospectById.get(action.prospectId)?.status))
    .map((action) => ({ ...action, prospect: action.prospect || prospectById.get(action.prospectId) || null }))
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt) || left.id.localeCompare(right.id));

  const groups = { overdue: [], today: [], later: [] };
  for (const action of active) {
    const dueDay = melbourneDay(action.dueAt);
    groups[dueDay < today ? 'overdue' : dueDay === today ? 'today' : 'later'].push(action);
  }

  const activeDrafts = drafts.filter((draft) => ['pending_review', 'approved', 'opened'].includes(draft.state)
    || (draft.state === 'deferred' && (!draft.deferUntil || new Date(draft.deferUntil) <= now)));

  return {
    active,
    activeDrafts,
    complete: active.length === 0 && activeDrafts.length === 0,
    groups,
    missingNextAction: prospects.filter((prospect) => prospectNeedsAction(prospect, active)),
  };
}

export function actionLabel(type) {
  return String(type || 'action').replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
