const TERMINAL_STATUSES = new Set(['won', 'disqualified', 'no_response']);
const ACTIVE_ACTION_STATES = new Set(['pending', 'deferred']);
const MELBOURNE_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit',
});

function melbourneDay(value) {
  return MELBOURNE_DAY_FORMATTER.format(new Date(value));
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

  const dueActions = [...groups.overdue, ...groups.today];

  return {
    active,
    activeDrafts,
    complete: active.length === 0 && activeDrafts.length === 0,
    groups,
    missingNextAction: prospects.filter((prospect) => prospectNeedsAction(prospect, active)),
    dueFollowUps: dueActions.filter((action) => action.type === 'follow_up').length,
    draftsAwaitingReview: activeDrafts.filter((draft) => ['pending_review', 'deferred'].includes(draft.state)).length,
  };
}

export function actionLabel(type) {
  return String(type || 'action').replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function safeSourceHref(value) {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function safePhoneHref(value) {
  const phone = String(value ?? '').trim();
  if (!/^\+?[\d\s()-]+$/.test(phone)) return null;
  const compact = phone.replace(/[^\d+]/g, '');
  const normalized = compact.startsWith('+610') ? `+61${compact.slice(4)}` : compact;
  return /^\+?\d{8,15}$/.test(normalized) ? `tel:${normalized}` : null;
}

export function escapeHtmlAttribute(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

export function createLatestRequestGuard() {
  let sequence = 0;
  return {
    begin() {
      const request = ++sequence;
      return () => request === sequence;
    },
    invalidate() {
      sequence += 1;
    },
  };
}

const lockedForms = new WeakSet();

export async function withFormSubmissionLock(form, operation) {
  if (lockedForms.has(form)) return false;
  lockedForms.add(form);
  const controls = [...form.querySelectorAll('button, input, select, textarea')];
  const previousDisabled = controls.map((control) => control.disabled);
  controls.forEach((control) => { control.disabled = true; });
  form.setAttribute('aria-busy', 'true');
  try {
    await operation();
    return true;
  } finally {
    controls.forEach((control, index) => { control.disabled = previousDisabled[index]; });
    form.setAttribute('aria-busy', 'false');
    lockedForms.delete(form);
  }
}
