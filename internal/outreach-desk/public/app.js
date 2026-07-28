import {
  actionLabel,
  buildTodayModel,
  createLatestRequestGuard,
  escapeHtmlAttribute,
  safePhoneHref,
  safeSourceHref,
  withFormSubmissionLock,
} from './view-model.mjs';

const state = { actions: [], prospects: [], drafts: [], scorecard: null, csrfToken: null, selectedProspectId: null };
const prospectRequestGuard = createLatestRequestGuard();
const REQUEST_TIMEOUT_MS = 10_000;
const DUE_DATE_FORMATTER = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', dateStyle: 'medium' });
const AUD_CURRENCY_FORMATTER = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const elements = {
  dialog: document.querySelector('#prospect-dialog'),
  form: document.querySelector('#prospect-form'),
  list: document.querySelector('#prospect-list'),
  detail: document.querySelector('#prospect-detail'),
  queue: document.querySelector('#today-queue'),
  summary: document.querySelector('#today-summary'),
  status: document.querySelector('#status-message'),
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function notify(message) {
  elements.status.textContent = message;
  elements.status.classList.add('visible');
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => elements.status.classList.remove('visible'), 3500);
}

async function api(path, options = {}) {
  const mutating = options.method && options.method !== 'GET';
  const response = await fetch(path, {
    ...options,
    signal: options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      ...(mutating ? { 'Content-Type': 'application/json', 'x-outreach-token': state.csrfToken } : {}),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return result.data ?? result;
}

function dueLabel(value) {
  return DUE_DATE_FORMATTER.format(new Date(value));
}

function renderSummary(model) {
  const daily = state.scorecard?.today?.counts || {};
  const weekly = state.scorecard || { counts: {}, targets: {} };
  elements.summary.innerHTML = [
    ['First approaches today', daily.firstApproaches || 0],
    ['Warm actions today', daily.warmActions || 0],
    ['Follow-ups due', model.dueFollowUps],
    ['Drafts awaiting review', model.draftsAwaitingReview],
    ['First approaches this week', `${weekly.counts.firstApproaches || 0} / ${weekly.targets.firstApproaches || 0}`],
    ['Warm actions this week', `${weekly.counts.warmActions || 0} / ${weekly.targets.warmActions || 0}`],
    ['Follow-ups this week', `${weekly.counts.followUps || 0} / ${weekly.targets.followUps || 0}`],
  ].map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  elements.summary.setAttribute('aria-busy', 'false');
}

function renderQueueGroup(title, actions) {
  if (!actions.length) return '';
  return `<section class="queue-group"><h3>${escapeHtml(title)} · ${actions.length}</h3>${actions.map((action) => `
    <article class="queue-item">
      <div>
        <p class="eyebrow">${escapeHtml(actionLabel(action.type))}</p>
        <h3>${escapeHtml(action.prospect?.companyName || 'Unknown prospect')}</h3>
        <time datetime="${escapeHtmlAttribute(action.dueAt)}">Due ${escapeHtml(dueLabel(action.dueAt))}</time>
      </div>
      <div class="action-row">
        <button class="action-button" type="button" data-open-prospect="${escapeHtmlAttribute(action.prospectId)}">Open</button>
        <button class="action-button" type="button" data-action="deferAction" data-id="${escapeHtmlAttribute(action.id)}" data-version="${escapeHtmlAttribute(action.version)}">Defer</button>
        <button class="action-button" type="button" data-action="dismissAction" data-id="${escapeHtmlAttribute(action.id)}" data-version="${escapeHtmlAttribute(action.version)}">Dismiss</button>
        <button class="primary" type="button" data-action="completeAction" data-id="${escapeHtmlAttribute(action.id)}" data-version="${escapeHtmlAttribute(action.version)}">Complete</button>
      </div>
    </article>`).join('')}</section>`;
}

function renderDraftQueue(drafts) {
  if (!drafts.length) return '';
  return `<section class="queue-group"><h3>Approval queue · ${drafts.length}</h3>${drafts.map((draft) => `
    <article class="queue-item draft-card" data-draft-card="${escapeHtmlAttribute(draft.id)}">
      <div>
        <p class="eyebrow">${escapeHtml(actionLabel(draft.state))}</p>
        <label>Recipient<input name="recipient" type="email" value="${escapeHtml(draft.recipient)}" ${['pending_review', 'deferred'].includes(draft.state) ? '' : 'readonly'}></label>
        <label>Subject<input name="subject" value="${escapeHtml(draft.subject)}" ${['pending_review', 'deferred'].includes(draft.state) ? '' : 'readonly'}></label>
        <label>Body<textarea name="body" ${['pending_review', 'deferred'].includes(draft.state) ? '' : 'readonly'}>${escapeHtml(draft.body)}</textarea></label>
        <details><summary>Personalisation evidence</summary><p><strong>Problem angle:</strong> ${escapeHtml(draft.problemAngle)}</p><p><strong>Evidence:</strong> ${escapeHtml(draft.evidenceBasis)}</p></details>
      </div>
      <div class="action-row">
        ${['pending_review', 'deferred'].includes(draft.state) ? `
          <button class="action-button" type="button" data-draft-action="rejectDraft" data-id="${escapeHtmlAttribute(draft.id)}" data-version="${escapeHtmlAttribute(draft.version)}">Reject</button>
          <button class="action-button" type="button" data-draft-action="deferDraft" data-id="${escapeHtmlAttribute(draft.id)}" data-version="${escapeHtmlAttribute(draft.version)}">Defer</button>
          <button class="primary" type="button" data-draft-action="approveDraft" data-id="${escapeHtmlAttribute(draft.id)}" data-version="${escapeHtmlAttribute(draft.version)}">Approve</button>` : ''}
        ${draft.state === 'approved' ? `
          <button class="action-button" type="button" data-copy-draft="${escapeHtmlAttribute(draft.id)}">Copy</button>
          <button class="primary" type="button" data-draft-action="openDraft" data-id="${escapeHtmlAttribute(draft.id)}" data-version="${escapeHtmlAttribute(draft.version)}">Open in Apple Mail</button>` : ''}
        ${draft.state === 'opened' ? `
          <button class="action-button" type="button" data-draft-action="markNotSent" data-id="${escapeHtmlAttribute(draft.id)}" data-version="${escapeHtmlAttribute(draft.version)}">Not sent</button>
          <button class="primary" type="button" data-draft-action="confirmSent" data-id="${escapeHtmlAttribute(draft.id)}" data-version="${escapeHtmlAttribute(draft.version)}">Confirm sent</button>` : ''}
      </div>
    </article>`).join('')}</section>`;
}

function renderToday() {
  const model = buildTodayModel({ actions: state.actions, drafts: state.drafts, prospects: state.prospects });
  renderSummary(model);
  if (model.complete) {
    elements.queue.innerHTML = '<div class="completion"><p class="eyebrow">Daily work complete</p><h3>Nothing required right now.</h3><p>The Desk will surface the next due action here.</p></div>';
    return;
  }
  const missing = model.missingNextAction.length
    ? `<div class="warning"><strong>${model.missingNextAction.length} active prospect${model.missingNextAction.length === 1 ? '' : 's'} need a next action.</strong></div>`
    : '';
  elements.queue.innerHTML = missing
    + renderDraftQueue(model.activeDrafts)
    + renderQueueGroup('Overdue', model.groups.overdue)
    + renderQueueGroup('Today', model.groups.today)
    + renderQueueGroup('Later', model.groups.later);
}

function renderProspects(filter = '') {
  const query = filter.trim().toLowerCase();
  const filtered = state.prospects.filter((prospect) => `${prospect.companyName} ${prospect.decisionMaker} ${prospect.email} ${prospect.phone ?? ''} ${prospect.status}`.toLowerCase().includes(query));
  elements.list.innerHTML = filtered.length ? filtered.map((prospect) => `
    <button class="prospect-link" type="button" data-prospect-id="${escapeHtmlAttribute(prospect.id)}" aria-current="${state.selectedProspectId === prospect.id}">
      <strong>${escapeHtml(prospect.companyName)}</strong>
      <span>${escapeHtml(prospect.decisionMaker)} · ${escapeHtml(actionLabel(prospect.status))}</span>
    </button>`).join('') : '<p class="empty">No prospects match this search.</p>';
}

function renderScorecard() {
  if (!state.scorecard) return;
  const { counts, targets, week } = state.scorecard;
  const metrics = [
    ['First approaches', counts.firstApproaches, targets.firstApproaches],
    ['Warm actions', counts.warmActions, targets.warmActions],
    ['Follow-ups', counts.followUps, targets.followUps],
    ['Replies', counts.replies],
    ['Engaged leads', counts.engagedLeads],
    ['Calls', counts.calls],
    ['Confirmed problems', counts.confirmedProblems],
    ['Recommendations', counts.recommendations],
    ['Proposals', counts.proposals],
    ['Sales', counts.sales],
    ['Cash collected', AUD_CURRENCY_FORMATTER.format(counts.cashCollected)],
  ];
  document.querySelector('#scorecard-content').innerHTML = metrics.map(([label, value, target]) => `
    <div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${target ? `<small>of ${target}</small>` : ''}</div>`).join('')
    + `<p class="wide">Week of ${escapeHtml(week.startDate)}. Research, drafts, and Apple Mail opens are excluded.</p>`;
}

function historyLabel(event) {
  return actionLabel(event.kind.replace('.', '_'));
}

async function openProspect(prospectId) {
  const isLatestRequest = prospectRequestGuard.begin();
  state.selectedProspectId = prospectId;
  renderProspects(document.querySelector('#prospect-search').value);
  elements.detail.setAttribute('aria-busy', 'true');
  elements.detail.innerHTML = '<p class="empty">Loading prospect…</p>';
  try {
    const prospect = await api(`/api/prospects/${encodeURIComponent(prospectId)}`);
    if (!isLatestRequest()) return;
    const active = prospect.actions.filter((action) => ['pending', 'deferred'].includes(action.state));
    const actionOptions = active.map((action) => `<option value="${escapeHtmlAttribute(action.id)}">${escapeHtml(actionLabel(action.type))} · ${escapeHtml(dueLabel(action.dueAt))}</option>`).join('');
    const phoneHref = safePhoneHref(prospect.phone);
    elements.detail.innerHTML = `
      <div class="view-heading"><div><p class="eyebrow">${escapeHtml(actionLabel(prospect.status))}</p><h2>${escapeHtml(prospect.companyName)}</h2></div><span>${escapeHtml(prospect.email)}${phoneHref ? `<br><a href="${escapeHtmlAttribute(phoneHref)}">${escapeHtml(prospect.phone)}</a>` : ''}</span></div>
      ${active.length ? '' : '<p class="warning"><strong>No next action.</strong> Add one before leaving this prospect active.</p>'}
      <div class="detail-grid">
        <section class="detail-block"><h3>Decision-maker</h3><p>${escapeHtml(prospect.decisionMaker)}</p><p>${escapeHtml(prospect.trade || 'Trade not recorded')} · ${escapeHtml(prospect.location || 'Location not recorded')}</p></section>
        <section class="detail-block"><h3>Next action</h3>${active.length ? active.map((action) => `<p>${escapeHtml(actionLabel(action.type))}<br><small>Due ${escapeHtml(dueLabel(action.dueAt))} · ${escapeHtml(action.owner)}</small></p>`).join('') : '<p>None recorded.</p>'}</section>
        <section class="detail-block wide"><h3>Evidence</h3><p>${escapeHtml(prospect.evidence)}</p>${prospect.sourceLinks.map(safeSourceHref).filter(Boolean).map((link) => `<p><a href="${escapeHtmlAttribute(link)}" target="_blank" rel="noreferrer">View source</a></p>`).join('')}</section>
        <section class="detail-block wide"><h3>Problem hypothesis</h3><p>${escapeHtml(prospect.problemHypothesis)}</p></section>
        <section class="detail-block wide"><h3>History</h3><ol class="history">${prospect.events.slice().reverse().map((event) => `<li>${escapeHtml(historyLabel(event))}<small>${escapeHtml(event.actor.name)} · ${escapeHtml(new Date(event.createdAt).toLocaleString('en-AU'))}</small></li>`).join('') || '<li>No activity yet.</li>'}</ol></section>
        <section class="detail-block wide"><h3>Record real-world outcome</h3><form id="outcome-form" data-prospect-id="${escapeHtmlAttribute(prospect.id)}">
          <div class="form-grid">
            <label>Outcome<select name="recordType"><option value="reply">Reply</option><option value="call">Suitability call</option><option value="confirmed_problem">Confirmed problem</option><option value="recommendation">Recommendation</option><option value="proposal">Proposal sent</option><option value="sale">Sale won</option><option value="cash">Cash collected</option></select></label>
            <label>Cash amount (if applicable)<input name="amount" type="number" min="0" step="0.01"></label>
            <label class="wide">Exact language, notes, objections or evidence<textarea name="notes" required></textarea></label>
            <label>Next action<select name="nextActionType"><option value="book_call">Book call</option><option value="follow_up">Follow up</option><option value="prepare_recommendation">Prepare recommendation</option><option value="prepare_proposal">Prepare proposal</option><option value="nurture">Nurture</option></select></label>
            <label>Due<input name="nextActionDue" type="date" required></label>
          </div>
          <button class="primary" type="submit">Record outcome</button>
        </form></section>
        <section class="detail-block wide"><h3>Prepare email</h3>${active.length ? `<form id="draft-form" data-prospect-id="${escapeHtmlAttribute(prospect.id)}"><label>Linked action<select name="actionId" required>${actionOptions}</select></label><label>Subject<input name="subject" required></label><label>Body<textarea name="body" required></textarea></label><label>Problem angle<input name="problemAngle" value="${escapeHtmlAttribute(prospect.problemHypothesis)}" required></label><label>Evidence basis<textarea name="evidenceBasis" required>${escapeHtml(prospect.evidence)}</textarea></label><button class="primary" type="submit">Add to approval queue</button></form>` : '<p>Add an active next action before preparing an email.</p>'}</section>
      </div>`;
  } catch (error) {
    if (!isLatestRequest()) return;
    elements.detail.innerHTML = `<p class="warning"><strong>Could not load this prospect.</strong><br>${escapeHtml(error.message)}</p>`;
  } finally {
    if (isLatestRequest()) elements.detail.setAttribute('aria-busy', 'false');
  }
}

async function loadAll() {
  try {
    if (!state.csrfToken) state.csrfToken = (await api('/api/session')).csrfToken;
    const [actions, prospects, drafts, scorecard] = await Promise.all([api('/api/today'), api('/api/prospects'), api('/api/drafts'), api('/api/scorecard')]);
    state.actions = actions;
    state.prospects = prospects;
    state.drafts = drafts;
    state.scorecard = scorecard;
    renderToday();
    renderProspects(document.querySelector('#prospect-search').value);
    renderScorecard();
  } catch (error) {
    elements.queue.innerHTML = `<p class="warning"><strong>Outreach Desk could not load.</strong><br>${escapeHtml(error.message)} <button class="quiet" data-refresh>Retry</button></p>`;
  }
}

async function command(operation, input) {
  try {
    const result = await api(`/api/commands/${operation}`, { method: 'POST', body: JSON.stringify(input) });
    await loadAll();
    notify('Saved.');
    return result;
  } catch (error) {
    notify(error.status === 409 ? 'Version conflict: this record changed elsewhere. Refresh before trying again; your text is still here.' : error.message);
    throw error;
  }
}

document.addEventListener('click', async (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    document.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-current', button === viewButton ? 'page' : 'false'));
    document.querySelectorAll('.view').forEach((view) => { view.hidden = view.id !== `${viewButton.dataset.view}-view`; });
  }
  if (event.target.closest('#add-prospect-button')) elements.dialog.showModal();
  if (event.target.closest('[data-close-dialog]')) elements.dialog.close();
  if (event.target.closest('[data-refresh]')) await loadAll();
  const prospectButton = event.target.closest('button[data-prospect-id], [data-open-prospect]');
  if (prospectButton) {
    document.querySelector('[data-view="prospects"]').click();
    await openProspect(prospectButton.dataset.prospectId || prospectButton.dataset.openProspect);
  }
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    const dueAt = actionButton.dataset.action === 'deferAction'
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : undefined;
    actionButton.disabled = true;
    try {
      await command(actionButton.dataset.action, { actionId: actionButton.dataset.id, expectedVersion: Number(actionButton.dataset.version), dueAt });
    } catch {
      actionButton.disabled = false;
    }
  }
  const draftButton = event.target.closest('[data-draft-action]');
  if (draftButton) {
    const card = draftButton.closest('[data-draft-card]');
    const operation = draftButton.dataset.draftAction;
    const input = { draftId: draftButton.dataset.id, expectedVersion: Number(draftButton.dataset.version) };
    if (operation === 'approveDraft') {
      input.edits = {
        recipient: card.querySelector('[name="recipient"]').value,
        subject: card.querySelector('[name="subject"]').value,
        body: card.querySelector('[name="body"]').value,
      };
    }
    if (operation === 'deferDraft') input.deferUntil = new Date(Date.now() + 86_400_000).toISOString();
    draftButton.disabled = true;
    try {
      const result = await command(operation, input);
      if (operation === 'openDraft') window.location.href = result.mailtoUri;
    } catch {
      draftButton.disabled = false;
    }
  }
  const copyButton = event.target.closest('[data-copy-draft]');
  if (copyButton) {
    const draft = state.drafts.find((item) => item.id === copyButton.dataset.copyDraft);
    await navigator.clipboard.writeText(`To: ${draft.recipient}\nSubject: ${draft.subject}\n\n${draft.body}`);
    notify('Draft copied. No message was sent.');
  }
});

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(elements.form);
  const dueAt = new Date(`${data.get('dueAt')}T09:00:00+10:00`).toISOString();
  await withFormSubmissionLock(elements.form, async () => {
    try {
      await command('createProspect', {
        companyName: data.get('companyName'), trade: data.get('trade'), location: data.get('location'),
        decisionMaker: data.get('decisionMaker'), email: data.get('email'), phone: data.get('phone'), sourceLinks: [data.get('sourceLink')],
        evidence: data.get('evidence'), problemHypothesis: data.get('problemHypothesis'),
        nextAction: { type: data.get('actionType'), owner: 'shane', dueAt },
      });
      elements.form.reset();
      elements.dialog.close();
    } catch {
      // Preserve form text for recovery.
    }
  });
});

document.addEventListener('submit', async (event) => {
  if (event.target.id === 'outcome-form') {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const recordType = data.get('recordType');
    const dueAt = new Date(`${data.get('nextActionDue')}T09:00:00+10:00`).toISOString();
    const nextAction = { type: data.get('nextActionType'), owner: 'shane', dueAt };
    await withFormSubmissionLock(form, async () => {
      try {
        if (recordType === 'reply') {
          await command('recordReply', {
            prospectId: form.dataset.prospectId,
            exactLanguage: data.get('notes'),
            qualificationEvidence: data.get('notes'),
            nextAction,
          });
        } else if (recordType === 'call') {
          await command('recordCall', { prospectId: form.dataset.prospectId, notes: data.get('notes'), nextAction });
        } else {
          await command('recordOutcome', {
            prospectId: form.dataset.prospectId,
            outcomeType: recordType,
            notes: data.get('notes'),
            amount: data.get('amount'),
            nextAction,
          });
        }
        await openProspect(form.dataset.prospectId);
      } catch {
        // Preserve outcome notes for recovery.
      }
    });
    return;
  }
  if (event.target.id !== 'draft-form') return;
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const prospect = state.prospects.find((item) => item.id === form.dataset.prospectId);
  await withFormSubmissionLock(form, async () => {
    try {
      await command('createDraft', {
        prospectId: prospect.id, actionId: data.get('actionId'), recipient: prospect.email,
        subject: data.get('subject'), body: data.get('body'),
        problemAngle: data.get('problemAngle'), evidenceBasis: data.get('evidenceBasis'),
      });
      await openProspect(prospect.id);
    } catch {
      // Preserve draft text for recovery.
    }
  });
});

document.querySelector('#prospect-search').addEventListener('input', (event) => renderProspects(event.target.value));
document.querySelector('#export-button').addEventListener('click', async () => {
  try {
    const snapshot = await api('/api/export');
    const blob = new Blob([`${JSON.stringify(snapshot, null, 2)}\n`], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `outreach-desk-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    notify('Export downloaded.');
  } catch (error) {
    notify(error.message);
  }
});
document.querySelector('#restore-file').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const snapshot = JSON.parse(await file.text());
    if (!window.confirm('Restore this snapshot? A private pre-restore backup will be created first.')) return;
    const result = await api('/api/restore', { method: 'POST', body: JSON.stringify(snapshot) });
    await loadAll();
    notify(`Restored ${result.counts.prospects} prospects.`);
  } catch (error) {
    notify(`Restore failed without changing live data: ${error.message}`);
  } finally {
    event.target.value = '';
  }
});
loadAll();
