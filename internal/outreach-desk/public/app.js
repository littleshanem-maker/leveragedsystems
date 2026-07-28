import { actionLabel, buildTodayModel } from './view-model.mjs';

const state = { actions: [], prospects: [], drafts: [], csrfToken: null, selectedProspectId: null };
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
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', dateStyle: 'medium' }).format(new Date(value));
}

function renderSummary(model) {
  const followUps = model.active.filter((action) => action.type === 'follow_up').length;
  const firstApproaches = model.active.filter((action) => action.type === 'first_approach').length;
  elements.summary.innerHTML = [
    ['Due now', model.groups.overdue.length + model.groups.today.length],
    ['First approaches', firstApproaches],
    ['Follow-ups', followUps],
    ['Prospects', state.prospects.length],
  ].map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`).join('');
  elements.summary.setAttribute('aria-busy', 'false');
}

function renderQueueGroup(title, actions) {
  if (!actions.length) return '';
  return `<section class="queue-group"><h3>${escapeHtml(title)} · ${actions.length}</h3>${actions.map((action) => `
    <article class="queue-item">
      <div>
        <p class="eyebrow">${escapeHtml(actionLabel(action.type))}</p>
        <h3>${escapeHtml(action.prospect?.companyName || 'Unknown prospect')}</h3>
        <time datetime="${escapeHtml(action.dueAt)}">Due ${escapeHtml(dueLabel(action.dueAt))}</time>
      </div>
      <div class="action-row">
        <button class="action-button" type="button" data-open-prospect="${action.prospectId}">Open</button>
        <button class="action-button" type="button" data-action="deferAction" data-id="${action.id}" data-version="${action.version}">Defer</button>
        <button class="primary" type="button" data-action="completeAction" data-id="${action.id}" data-version="${action.version}">Complete</button>
      </div>
    </article>`).join('')}</section>`;
}

function renderToday() {
  const model = buildTodayModel({ actions: state.actions, prospects: state.prospects });
  renderSummary(model);
  if (model.complete) {
    elements.queue.innerHTML = '<div class="completion"><p class="eyebrow">Daily work complete</p><h3>Nothing required right now.</h3><p>The Desk will surface the next due action here.</p></div>';
    return;
  }
  const missing = model.missingNextAction.length
    ? `<div class="warning"><strong>${model.missingNextAction.length} active prospect${model.missingNextAction.length === 1 ? '' : 's'} need a next action.</strong></div>`
    : '';
  elements.queue.innerHTML = missing
    + renderQueueGroup('Overdue', model.groups.overdue)
    + renderQueueGroup('Today', model.groups.today)
    + renderQueueGroup('Later', model.groups.later);
}

function renderProspects(filter = '') {
  const query = filter.trim().toLowerCase();
  const filtered = state.prospects.filter((prospect) => `${prospect.companyName} ${prospect.decisionMaker} ${prospect.status}`.toLowerCase().includes(query));
  elements.list.innerHTML = filtered.length ? filtered.map((prospect) => `
    <button class="prospect-link" type="button" data-prospect-id="${prospect.id}" aria-current="${state.selectedProspectId === prospect.id}">
      <strong>${escapeHtml(prospect.companyName)}</strong>
      <span>${escapeHtml(prospect.decisionMaker)} · ${escapeHtml(actionLabel(prospect.status))}</span>
    </button>`).join('') : '<p class="empty">No prospects match this search.</p>';
}

function historyLabel(event) {
  return actionLabel(event.kind.replace('.', '_'));
}

async function openProspect(prospectId) {
  state.selectedProspectId = prospectId;
  renderProspects(document.querySelector('#prospect-search').value);
  elements.detail.setAttribute('aria-busy', 'true');
  elements.detail.innerHTML = '<p class="empty">Loading prospect…</p>';
  try {
    const prospect = await api(`/api/prospects/${prospectId}`);
    const active = prospect.actions.filter((action) => ['pending', 'deferred'].includes(action.state));
    elements.detail.innerHTML = `
      <div class="view-heading"><div><p class="eyebrow">${escapeHtml(actionLabel(prospect.status))}</p><h2>${escapeHtml(prospect.companyName)}</h2></div><a class="quiet" href="mailto:${encodeURIComponent(prospect.email)}">${escapeHtml(prospect.email)}</a></div>
      ${active.length ? '' : '<p class="warning"><strong>No next action.</strong> Add one before leaving this prospect active.</p>'}
      <div class="detail-grid">
        <section class="detail-block"><h3>Decision-maker</h3><p>${escapeHtml(prospect.decisionMaker)}</p><p>${escapeHtml(prospect.trade || 'Trade not recorded')} · ${escapeHtml(prospect.location || 'Location not recorded')}</p></section>
        <section class="detail-block"><h3>Next action</h3>${active.length ? active.map((action) => `<p>${escapeHtml(actionLabel(action.type))}<br><small>Due ${escapeHtml(dueLabel(action.dueAt))} · ${escapeHtml(action.owner)}</small></p>`).join('') : '<p>None recorded.</p>'}</section>
        <section class="detail-block wide"><h3>Evidence</h3><p>${escapeHtml(prospect.evidence)}</p>${prospect.sourceLinks.map((link) => `<p><a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">View source</a></p>`).join('')}</section>
        <section class="detail-block wide"><h3>Problem hypothesis</h3><p>${escapeHtml(prospect.problemHypothesis)}</p></section>
        <section class="detail-block wide"><h3>History</h3><ol class="history">${prospect.events.slice().reverse().map((event) => `<li>${escapeHtml(historyLabel(event))}<small>${escapeHtml(event.actor.name)} · ${escapeHtml(new Date(event.createdAt).toLocaleString('en-AU'))}</small></li>`).join('') || '<li>No activity yet.</li>'}</ol></section>
        <section class="detail-block wide"><h3>Prepare email</h3><form id="draft-form" data-prospect-id="${prospect.id}"><label>Subject<input name="subject" required></label><label>Body<textarea name="body" required></textarea></label><label>Problem angle<input name="problemAngle" value="${escapeHtml(prospect.problemHypothesis)}" required></label><label>Evidence basis<textarea name="evidenceBasis" required>${escapeHtml(prospect.evidence)}</textarea></label><button class="primary" type="submit">Add to approval queue</button></form></section>
      </div>`;
  } catch (error) {
    elements.detail.innerHTML = `<p class="warning"><strong>Could not load this prospect.</strong><br>${escapeHtml(error.message)}</p>`;
  } finally {
    elements.detail.setAttribute('aria-busy', 'false');
  }
}

async function loadAll() {
  try {
    if (!state.csrfToken) state.csrfToken = (await api('/api/session')).csrfToken;
    const [actions, prospects, drafts] = await Promise.all([api('/api/today'), api('/api/prospects'), api('/api/drafts')]);
    state.actions = actions;
    state.prospects = prospects;
    state.drafts = drafts;
    renderToday();
    renderProspects(document.querySelector('#prospect-search').value);
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
  const prospectButton = event.target.closest('[data-prospect-id], [data-open-prospect]');
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
});

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(elements.form);
  const dueAt = new Date(`${data.get('dueAt')}T09:00:00+10:00`).toISOString();
  try {
    await command('createProspect', {
      companyName: data.get('companyName'), trade: data.get('trade'), location: data.get('location'),
      decisionMaker: data.get('decisionMaker'), email: data.get('email'), sourceLinks: [data.get('sourceLink')],
      evidence: data.get('evidence'), problemHypothesis: data.get('problemHypothesis'),
      nextAction: { type: data.get('actionType'), owner: 'shane', dueAt },
    });
    elements.form.reset();
    elements.dialog.close();
  } catch {
    // Preserve form text for recovery.
  }
});

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'draft-form') return;
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const prospect = state.prospects.find((item) => item.id === form.dataset.prospectId);
  try {
    await command('createDraft', {
      prospectId: prospect.id, recipient: prospect.email, subject: data.get('subject'), body: data.get('body'),
      problemAngle: data.get('problemAngle'), evidenceBasis: data.get('evidenceBasis'),
    });
    await openProspect(prospect.id);
  } catch {
    // Preserve draft text for recovery.
  }
});

document.querySelector('#prospect-search').addEventListener('input', (event) => renderProspects(event.target.value));
loadAll();
