// The brief page behind the Dashboard: option 2a of the "Briefing Redesign" Claude Design project.
// One decision in focus ("Next up"), the rest as a tight list, today and tomorrow drawn to scale,
// bills from email, then the full brief text. Everything is live: the latest brief, pending
// proposals, new email findings, Google Calendar and run history. Decisions use the same routes as
// the Inbox; approving only records the decision, it never executes anything by itself.
import { html } from '/vendor/preact-htm.js';

const BNE = 10 * 3_600_000; // Brisbane has no daylight saving.
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LABEL = { bill: 'Bill', commitment: 'Commitment', reply: 'Reply' };
const TONE = { Bill: 'bf-t-bill', Proposal: 'bf-t-proposal', Commitment: 'bf-t-check', Reply: 'bf-t-check' };

/** The first dollar amount written in the text, if any. Only what the email itself says. */
export function moneyIn(...texts) {
  for (const t of texts) {
    const m = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?)/.exec(t ?? '');
    if (m) return Number(m[1].replace(/,/g, ''));
  }
  return null;
}
const dollars = (n) => `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (ms, opts) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', ...opts }).format(new Date(ms));
const clock = (h) => {
  const hh = Math.floor(h) % 24, mm = Math.round((h % 1) * 60);
  return `${hh % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${hh < 12 ? 'am' : 'pm'}`;
};
const span = (mins) => (mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`);
const senderName = (s) => (s ?? '').replace(/<[^>]*>/, '').replace(/"/g, '').trim() || s;

/** What is waiting on Bailey: pending proposals first, then new findings, bills before the rest. */
export function decisionQueue(data) {
  const proposals = data.actionsError ? [] : (data.actions?.items ?? [])
    .filter((a) => a.status === 'pending' && !a.source_snapshot?.demo)
    .map((a) => {
      const c = a.proposed_action?.calendar;
      const amount = moneyIn(a.title, a.detail);
      return {
        key: `a${a.id}`, kind: 'proposal', type: 'Proposal', title: a.title, ref: a,
        when: c?.start ? fmt(Date.parse(c.start), { weekday: 'short', day: 'numeric', month: 'short', hour: c.type === 'reminder' ? undefined : 'numeric', minute: c.type === 'reminder' ? undefined : '2-digit' })
          : a.expires_at ? `Expires ${fmt(Date.parse(a.expires_at), { weekday: 'short', day: 'numeric', month: 'short' })}` : 'No date',
        note: a.can_approve ? a.detail : (a.blocked_reasons?.join(' ') || a.detail),
        amount: amount === null ? '' : dollars(amount),
        canApprove: a.can_approve,
      };
    });
  const rank = { bill: 0, commitment: 1, reply: 2 };
  const findings = data.findingsError ? [] : (data.findings?.items ?? [])
    .filter((f) => f.status === 'new')
    .sort((a, b) => rank[a.category] - rank[b.category])
    .map((f) => {
      const amount = moneyIn(f.summary, f.subject, f.evidence);
      return {
        key: `f${f.id}`, kind: 'finding', type: LABEL[f.category], title: f.subject || f.summary, ref: f,
        when: f.deadline_text || `Email ${fmt(Date.parse(f.received_at), { weekday: 'short', day: 'numeric', month: 'short' })}`,
        note: f.summary, amount: amount === null ? '' : dollars(amount),
      };
    });
  return [...proposals, ...findings];
}

/** Timed events and all-day items for one Brisbane day (0 today, 1 tomorrow), with the hours to draw. */
export function dayPlan(events, offset, now) {
  const today0 = Math.floor((now + BNE) / DAY) * DAY - BNE;
  const d0 = today0 + offset * DAY;
  const timed = [], allDay = [];
  for (const e of events) {
    if (e.response === 'declined') continue;
    if (e.allDay) {
      const s = Date.parse(`${e.start}T00:00:00+10:00`), en = Date.parse(`${e.end}T00:00:00+10:00`);
      if (s < d0 + DAY && en > d0) allDay.push(e.title);
      continue;
    }
    const s = Date.parse(e.start), en = Date.parse(e.end);
    if (!Number.isFinite(s) || s >= d0 + DAY || Math.max(en, s) < d0) continue;
    timed.push({ title: e.title, s: (Math.max(s, d0) - d0) / HOUR, e: (Math.min(Math.max(en, s), d0 + DAY) - d0) / HOUR, open: !(en > s), location: e.location });
  }
  timed.sort((a, b) => a.s - b.s);
  const nowH = (now - d0) / HOUR;
  const shown = offset === 0 ? timed.filter((t) => (t.open ? t.s : t.e) > nowH) : timed;
  let r0 = offset === 0 ? Math.floor(nowH) : Math.min(7, ...shown.map((t) => Math.floor(t.s)));
  let r1 = Math.max(offset === 0 ? Math.min(24, Math.max(23, r0 + 4)) : 22, ...shown.map((t) => Math.ceil(t.open ? t.s + 1 : t.e)));
  r1 = Math.min(24, r1);
  if (r1 - r0 < 3) r0 = Math.max(0, r1 - 3);
  // Two lanes when events overlap.
  const laneEnd = [-1, -1];
  for (const t of shown) {
    const end = t.open ? t.s + 0.5 : t.e;
    t.lane = laneEnd[0] <= t.s ? 0 : laneEnd[1] <= t.s ? 1 : 0;
    laneEnd[t.lane] = Math.max(laneEnd[t.lane], end);
  }
  const lanes = shown.some((t) => t.lane === 1) ? 2 : 1;
  const gaps = [];
  let cursor = offset === 0 ? Math.max(nowH, r0) : null;
  for (const t of shown.filter((x) => !x.open)) {
    if (cursor !== null && t.s - cursor >= 0.5 && t.s - cursor <= 4) gaps.push({ s: cursor, e: t.s });
    cursor = Math.max(cursor ?? 0, t.e);
  }
  return { d0, r0, r1, nowH, events: shown, allDay, lanes, gaps };
}

function Timeline({ plan, isToday }) {
  const { r0, r1, nowH, events, allDay, lanes, gaps } = plan;
  const pct = (h) => `${((h - r0) / (r1 - r0)) * 100}%`;
  const step = r1 - r0 > 10 ? 3 : 2;
  const ticks = [];
  for (let h = Math.ceil(r0 / step) * step; h <= r1; h += step) ticks.push(h);
  const laneStyle = (t) => (lanes === 2 ? { top: t.lane ? '50%' : '6px', bottom: t.lane ? '6px' : '50%' } : {});
  return html`<div class="bf-track">
      ${isToday && nowH >= r0 && nowH <= r1 && html`<div class="bf-now" style=${{ left: pct(nowH) }}><span>Now</span></div>`}
      ${gaps.map((g) => html`<div class="bf-gap" style=${{ left: pct(g.s), width: `calc(${pct(g.e)} - ${pct(g.s)})` }} title=${`Free ${clock(g.s)}–${clock(g.e)}`}><span>${span(Math.round((g.e - g.s) * 60))}</span></div>`)}
      ${events.map((t, i) => t.open
        ? html`<div class="bf-open" style=${{ left: pct(t.s), ...laneStyle(t) }} title=${`${t.title} · ${clock(t.s)} · no end time`}>
            <span class="bright">${t.title} · ${clock(t.s)}</span><span class="fs11 dim">No end time</span></div>`
        : html`<div class=${`bf-ev c${i % 3}`} style=${{ left: pct(t.s), width: `calc(${pct(t.e)} - ${pct(t.s)} - 3px)`, ...laneStyle(t) }}
            title=${`${t.title} · ${clock(t.s)}–${clock(t.e)}${t.location ? ` · ${t.location}` : ''}`}>
            <span class="bf-ev-title">${t.title}</span><span class="bf-ev-time">${clock(t.s)}–${clock(t.e)}</span></div>`)}
      ${!events.length && html`<span class=${`bf-track-empty ${isToday ? 'after-now' : ''}`}>${allDay.length ? '' : isToday ? 'Nothing else on the calendar' : 'Nothing on the calendar'}</span>`}
      ${allDay.length > 0 && html`<div class="bf-allday">${allDay.map((t) => html`<span title="All day">${t}</span>`)}</div>`}
    </div>
    <span></span>
    <div class="bf-ticks">${ticks.map((h) => html`<span style=${{ left: pct(h) }}>${clock(h)}</span>`)}</div>`;
}

/** Backlog and brief schedule for the right-hand rail; loaded when the page opens. */
export async function loadBriefExtras(app) {
  const get = async (path) => {
    try {
      const r = await fetch(path, { headers: { accept: 'application/json' } });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  };
  const [backlog, settings] = await Promise.all([get('/api/backlog'), get('/api/settings')]);
  app.setState({ briefExtras: { backlog, settings, loaded: true } });
}

/** Calendar events after tomorrow, up to 14 days out, plus dated proposals, grouped by Brisbane day. */
export function agenda(events, actions, now) {
  const today0 = Math.floor((now + BNE) / DAY) * DAY - BNE;
  const from = today0 + 2 * DAY, to = today0 + 16 * DAY;
  const items = [];
  for (const e of events) {
    if (e.response === 'declined') continue;
    if (e.allDay) {
      const s = Date.parse(`${e.start}T00:00:00+10:00`), en = Date.parse(`${e.end}T00:00:00+10:00`);
      for (let d = Math.max(s, from); d < Math.min(en, to); d += DAY) items.push({ at: d, allDay: true, title: e.title });
      continue;
    }
    const s = Date.parse(e.start);
    if (s >= from && s < to) items.push({ at: s, title: e.title, end: Date.parse(e.end), location: e.location });
  }
  for (const a of actions) {
    const c = a.proposed_action?.calendar;
    if (a.status !== 'pending' || !c?.start || a.source_snapshot?.demo) continue;
    const s = Date.parse(c.start);
    if (s >= from && s < to) items.push({ at: s, title: c.title || a.title, allDay: c.type === 'reminder', proposed: a.id });
  }
  items.sort((a, b) => a.at - b.at || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0));
  const days = [];
  for (const it of items) {
    const key = Math.floor((it.at + BNE) / DAY);
    let day = days.at(-1);
    if (!day || day.key !== key) days.push(day = { key, d0: key * DAY - BNE, items: [] });
    day.items.push(it);
  }
  return days;
}

function renderRail(app, data, now) {
  const ex = app.state.briefExtras;
  const cal = data.calendar ?? { status: 'disconnected', events: [] };
  const days = cal.status === 'connected' ? agenda(cal.events, data.actionsError ? [] : data.actions?.items ?? [], now) : [];
  const today0 = Math.floor((now + BNE) / DAY) * DAY - BNE;
  let shown = 0;
  const visible = [];
  for (const d of days) { if (shown >= 12) break; visible.push({ ...d, items: d.items.slice(0, 12 - shown) }); shown += Math.min(d.items.length, 12 - shown); }
  const hidden = days.reduce((n, d) => n + d.items.length, 0) - shown;

  const sched = (ex?.settings?.schedules ?? []).filter((s) => s.enabled && s.next_run_at).sort((a, b) => Date.parse(a.next_run_at) - Date.parse(b.next_run_at))[0];
  const nextAt = sched && Date.parse(sched.next_run_at);
  const hoursAway = nextAt && Math.max(0, Math.round((nextAt - now) / HOUR));
  const running = ex?.settings?.schedules?.find((s) => s.active_run);

  const items = ex?.backlog?.items ?? [];
  const plate = items.filter((i) => i.status === 'doing' || i.status === 'next');
  const pile = items.filter((i) => i.status === 'backlog').length;

  return html`<aside class="bf-rail" aria-label="Coming up">
    <section class="bf-card">
      <div class="row"><h3 class="grow">Coming up</h3><span class="fs12 muted">next 14 days</span></div>
      ${cal.status !== 'connected'
        ? html`<p class="fs13 muted">${cal.status === 'error' ? 'Google Calendar could not be read just now.' : 'Connect Google Calendar to see what is ahead.'}</p>`
        : !visible.length ? html`<p class="fs13 muted">Nothing on the calendar after tomorrow.</p>`
        : html`<div class="bf-agenda">${visible.map((d) => html`<div class="bf-agenda-day">
            <div class="bf-agenda-date"><span class="bright">${fmt(d.d0 + 12 * HOUR, { weekday: 'short', day: 'numeric', month: 'short' })}</span><span class="fs11 muted">in ${Math.round((d.d0 - today0) / DAY)} days</span></div>
            <div class="col" style="gap: 6px; min-width: 0;">${d.items.map((it) => html`<div class=${`bf-agenda-item ${it.proposed ? 'proposed' : ''}`}>
              <span class="bf-agenda-time">${it.allDay ? 'All day' : clock(((it.at + BNE) % DAY) / HOUR)}</span>
              <span class="bf-agenda-title" title=${[it.title, it.location].filter(Boolean).join(' · ')}>${it.title}</span>
              ${it.proposed && html`<button type="button" class="bf-proposed" onClick=${() => app.openProposal(it.proposed)} title="Proposed by Moniqr, not on your calendar yet">Proposed</button>`}
            </div>`)}</div>
          </div>`)}
          ${hidden > 0 && html`<span class="fs12 muted">${hidden} more after that</span>`}
        </div>`}
    </section>

    ${ex?.settings && html`<section class="bf-card bf-next-brief">
      <span class="fs12 muted">Next brief</span>
      ${running ? html`<span class="fs15 bright">${running.kind === 'afternoon_brief' ? 'Afternoon' : 'Morning'} brief is being prepared</span>`
        : sched ? html`<span class="fs15 bright">${sched.kind === 'afternoon_brief' ? 'Afternoon' : 'Morning'} brief · ${fmt(nextAt, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
            <span class="fs12 dim">${hoursAway < 1 ? 'within the hour' : `in ${hoursAway} hour${hoursAway === 1 ? '' : 's'}`}</span>`
        : html`<span class="fs14 dim">No brief is scheduled.</span>`}
      <button type="button" class="btn btn-ghost fs12" style="align-self: flex-start;" onClick=${() => app.openView('settings')}>Brief times ↗</button>
    </section>`}

    <section class="bf-card">
      <div class="row"><h3 class="grow">On your plate</h3><span class="fs12 muted">from your backlog</span></div>
      ${!ex?.loaded ? html`<p class="fs13 muted">Loading…</p>`
        : !ex.backlog ? html`<p class="fs13 muted">The backlog could not be loaded.</p>`
        : !plate.length ? html`<p class="fs13 muted">Nothing in Doing or Next.${pile ? ` ${pile} idea${pile === 1 ? '' : 's'} in the backlog.` : ''}</p>`
        : html`<div class="col" style="gap: 2px;">${plate.slice(0, 6).map((i) => html`<div class="bf-plate-item">
            <span class=${`bf-plate-dot p-${i.priority}`}></span>
            <span class="bf-plate-title">${i.title}</span>
            <span class=${`bf-plate-status ${i.status}`}>${i.status === 'doing' ? 'Doing' : 'Next'}</span>
          </div>`)}
          ${(plate.length > 6 || pile > 0) && html`<span class="fs12 muted" style="padding-top: 4px;">${[plate.length > 6 && `${plate.length - 6} more lined up`, pile && `${pile} in the backlog`].filter(Boolean).join(' · ')}</span>`}
        </div>`}
      <button type="button" class="btn btn-ghost fs12" style="align-self: flex-start;" onClick=${() => app.openView('backlog')}>Open backlog ↗</button>
    </section>
  </aside>`;
}

/** Renders the page. app is the dashboard component: its state, loaders and decision methods. */
export function renderBriefing(app, v, src) {
  const { data } = app.state;
  const { brief } = data;
  const now = app.state.now;
  const resolved = app.state.briefResolved ?? {};
  const saving = app.state.actionSaving || app.state.findingSaving;
  const back = () => app.openView('hq');
  const ask = () => window.dispatchEvent(new CustomEvent('moniqr:ask', { detail: { text: 'Walk me through this briefing', send: true } }));
  const mark = (item, label) => app.setState((s) => ({ briefResolved: { ...(s.briefResolved ?? {}), [item.key]: { ...item, label } } }));
  const unmark = (item) => app.setState((s) => { const r = { ...(s.briefResolved ?? {}) }; delete r[item.key]; return { briefResolved: r }; });
  const act = async (item, choice) => {
    if (saving) return;
    if (item.kind === 'proposal') {
      if (choice === 'primary' && !item.canApprove) return app.openProposal(item.ref.id);
      await app.decideProposal(item.ref, choice === 'primary' ? 'approved' : 'rejected');
      if (!app.state.actionError) mark(item, choice === 'primary' ? 'Approved' : 'Rejected');
    } else {
      await app.updateFinding(item.ref.id, choice === 'primary' ? 'reviewed' : 'dismissed');
      if (!app.state.findingError) mark(item, choice === 'primary' ? 'Reviewed' : 'Dismissed');
    }
  };
  const undo = async (item) => {
    await app.updateFinding(item.ref.id, 'new');
    if (!app.state.findingError) unmark(item);
  };
  const labels = (item) => item.kind === 'proposal'
    ? [item.canApprove ? 'Approve' : 'Review', 'Reject']
    : ['Mark reviewed', 'Dismiss'];

  const pending = decisionQueue(data).filter((i) => !resolved[i.key]);
  const next = pending[0];
  const rest = [...pending.slice(1), ...Object.values(resolved)];

  const [headline, ...ledeLines] = (brief?.summary || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const cal = data.calendar ?? { status: 'disconnected', events: [] };
  const plans = cal.status === 'connected' ? [dayPlan(cal.events, 0, now), dayPlan(cal.events, 1, now)] : null;
  const freeLine = plans && plans[1].gaps.length
    ? `Free tomorrow: ${plans[1].gaps.map((g) => `${clock(g.s)}–${clock(g.e)} (${span(Math.round((g.e - g.s) * 60))})`).join(', ')}.`
    : '';

  const bills = data.findingsError ? [] : (data.findings?.items ?? []).filter((f) => f.category === 'bill' && f.status !== 'dismissed');
  const billAmounts = bills.map((f) => moneyIn(f.summary, f.subject, f.evidence));
  const billTotal = billAmounts.reduce((s, n) => s + (n ?? 0), 0);

  const scan = data.findings?.scan;
  const limits = [
    cal.status !== 'connected' && (cal.status === 'error' ? 'Google Calendar could not be read.' : 'Google Calendar is not connected.'),
    data.findingsError && 'Email findings could not be loaded.',
    scan?.status === 'partial' && 'The last email scan was partial.',
    scan?.status === 'failed' && 'The last email scan failed.',
    scan?.failures && `${scan.failures} email searches failed in the last scan.`,
    data.agentsError && 'The agent service is not reachable.',
  ].filter(Boolean);
  const runs = data.runs ?? [];
  const failed = runs.filter((r) => r.status === 'failed').length;
  const busy = app.state.posting || data.busy;
  const brisbaneHour = new Date(now + BNE).getUTCHours();
  const runKind = brisbaneHour < 12 ? 'morning_brief' : 'afternoon_brief';
  const notesOpen = !!app.state.briefNotesOpen;
  const error = app.state.actionError || app.state.findingError;

  return html`<main class="main bf-page"><div class="bf-layout"><div class="bf-content">
    <div class="bf-hero">
      <div class="bf-head">
        <div class="bf-crumb">
          <button type="button" class="bf-back" onClick=${back}>← Dashboard</button>
          <span class="bf-sep" aria-hidden="true"></span>
          <span>${brief ? `${brief.kind} · ${brief.when}` : 'No brief from the EA yet'}</span>
          ${src(brief ? 'brief' : 'runs', data.agentsError && 'Offline')}
        </div>
        <h1>${headline || (brief ? 'Your brief' : 'No brief yet')}</h1>
        ${(ledeLines.length > 0 || !brief) && html`<p class="bf-lede">${brief ? ledeLines.join(' ') : 'Run the EA to prepare one. What is waiting on you and your calendar are below either way.'}</p>`}
        <div class="row wrap" style="padding-top: 4px;">
          <button type="button" class="btn btn-secondary" onClick=${ask}>Ask Moniqr about this</button>
        </div>
      </div>
      ${next ? html`<div class="bf-next">
          <div class="row" style="justify-content: space-between;">
            <span class="fs13 bf-next-count">Next up · 1 of ${pending.length}</span>
            <span class=${`bf-tag ${TONE[next.type]}`}>${next.type}</span>
          </div>
          <div class="col" style="gap: 4px;">
            <span class="bf-next-title">${next.title}</span>
            <span class="fs13 soft">${next.when}</span>
          </div>
          ${next.amount && html`<span class="bf-next-amount">${next.amount}</span>`}
          <p class="bf-next-note">${next.note}</p>
          <div class="row wrap">
            <button type="button" class="btn btn-primary" disabled=${saving} onClick=${() => act(next, 'primary')}>${labels(next)[0]}</button>
            <button type="button" class="btn btn-secondary" disabled=${saving} onClick=${() => act(next, 'secondary')}>${labels(next)[1]}</button>
            ${next.kind === 'proposal' && next.canApprove && html`<button type="button" class="btn btn-ghost fs13" onClick=${() => app.openProposal(next.ref.id)}>Details ↗</button>`}
          </div>
        </div>`
        : html`<div class="bf-clear">
          <span class="bf-clear-title">✓ All clear</span>
          <span class="fs14 dim">${data.actionsError || data.findingsError ? 'Some of your inbox could not be loaded, so this may be incomplete.' : 'Nothing is waiting on you right now.'}</span>
        </div>`}
    </div>
    ${error && html`<p class="coral" role="alert">${error}</p>`}

    ${rest.length > 0 && html`<section class="col" style="gap: 10px;">
      <div class="row" style="align-items: baseline; gap: 10px;"><h2>Then</h2><span class="fs13 muted">proposals first, then email, bills before the rest</span></div>
      <div class="bf-list">
        ${rest.map((n) => html`<div class="bf-row" key=${n.key}>
          <span class=${`bf-dot ${TONE[n.type]}`}></span>
          <div class="bf-row-main">
            <span class=${`bf-row-title ${n.label ? 'done' : ''}`}>${n.title}</span>
            <span class="bf-row-note">${n.note}</span>
          </div>
          <span class="bf-row-when">${n.when}</span>
          <span class="bf-row-amount">${n.amount}</span>
          <div class="bf-row-actions">
            ${n.label
              ? html`<span class="fs12 bf-ok">✓ ${n.label}</span>${n.kind === 'finding' && html`<button type="button" class="bf-undo" disabled=${saving} onClick=${() => undo(n)}>Undo</button>`}`
              : html`<button type="button" class="btn sm btn-primary" disabled=${saving} onClick=${() => act(n, 'primary')}>${labels(n)[0]}</button>
                  <button type="button" class="btn sm btn-secondary" disabled=${saving} onClick=${() => act(n, 'secondary')}>${labels(n)[1]}</button>`}
          </div>
        </div>`)}
      </div>
    </section>`}

    <section class="col" style="gap: 16px;">
      <h2>Today and tomorrow ${src('calendar', cal.status === 'error' ? 'Unavailable' : cal.status === 'disconnected' ? 'Not connected' : '')}</h2>
      ${plans ? html`<div class="bf-days">
          ${plans.map((p, i) => html`
            <div class="col"><span class="fs15 bright">${i ? 'Tomorrow' : 'Today'}</span>
              <span class="fs12 muted">${fmt(p.d0 + 12 * HOUR, { weekday: 'short', day: 'numeric' })} · ${i ? `${clock(p.r0)}–${clock(p.r1)}` : `from ${clock(p.r0)}`}</span></div>
            <${Timeline} plan=${p} isToday=${!i} />`)}
        </div>
        ${freeLine && html`<p class="bf-days-note">${freeLine}</p>`}`
        : html`<p class="fs14 muted">${cal.status === 'error' ? 'Google Calendar could not be read just now.' : 'Connect Google Calendar to see your days here.'}</p>`}
    </section>

    <section class="col" style="gap: 14px;">
      <div class="row" style="align-items: baseline; gap: 10px;">
        <h2>Bills from your email</h2>
        ${billTotal > 0 && html`<span class="bf-mono fs13 dim" title="The total of the amounts written in these emails">${dollars(billTotal)}</span>`}
      </div>
      ${bills.length
        ? html`<div class="bf-bills">${bills.map((f, i) => html`<div class="bf-bill">
            <span class="fs12 muted">${f.deadline_text || 'No due date found'}</span>
            <div class="row" style="align-items: baseline; justify-content: space-between;">
              <span class="fs15 bright bf-bill-name">${senderName(f.sender)}</span>
              ${billAmounts[i] !== null && html`<span class="bf-mono bf-bill-amount">${dollars(billAmounts[i])}</span>`}
            </div>
            <span class=${`fs12 ${f.status === 'new' ? 'coral' : 'muted'}`}>${f.status === 'new' ? 'Needs a look' : 'Reviewed'}${f.missing_details?.length ? ` · unknown: ${f.missing_details.join(', ')}` : ''}</span>
          </div>`)}</div>`
        : html`<p class="fs14 muted">${data.findingsError ? 'Email findings could not be loaded.' : 'No bills found in recent email.'}</p>`}
    </section>

    ${brief && html`<section class="col" style="gap: 10px;">
      <button type="button" class="bf-toggle" aria-expanded=${notesOpen} onClick=${() => app.setState({ briefNotesOpen: !notesOpen })}>
        <span class="bf-chevron" aria-hidden="true">${notesOpen ? '▾' : '▸'}</span>Also in this brief<span class="fs13 muted">the full text</span>
      </button>
      ${notesOpen && html`<div class="brief-md bf-md" dangerouslySetInnerHTML=${{ __html: brief.html }}></div>`}
    </section>`}

    </div>${renderRail(app, data, now)}</div>
    <footer class="bf-foot">
      <span>Sources: calendar ${cal.status === 'connected' ? '' : `(${cal.status === 'error' ? 'unavailable' : 'not connected'}) `}· email scan${scan?.updated_at ? ` ${fmt(Date.parse(scan.updated_at), { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''} · findings and proposals</span>
      ${limits.length > 0 && html`<span class="bf-limits" title=${limits.join(' ')}>${limits.length} limit${limits.length === 1 ? '' : 's'}</span>`}
      <span class="grow"></span>
      ${runs.length > 0 && html`<span class="bf-runs" aria-hidden="true">${runs.map((r) => html`<span class=${`bf-run ${r.status}`} title=${`${r.kind} · ${r.status} · ${r.when}`}></span>`)}</span>
        <span>${failed ? `${failed} of the last ${runs.length} runs failed` : `Last ${runs.length} run${runs.length === 1 ? '' : 's'} ${runs.some((r) => r.status === 'running' || r.status === 'queued') ? 'fine, one in progress' : 'done'}`}</span>`}
      <button type="button" class="btn sm btn-secondary" disabled=${busy} onClick=${() => app.runEa(runKind)}>${busy ? 'EA is running…' : 'Run EA now'}</button>
    </footer>
    ${app.state.runError && html`<p class="coral fs13">${app.state.runError}</p>`}
  </main>`;
}
