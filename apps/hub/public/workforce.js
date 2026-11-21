// The Agents page: Bailey's workforce. He creates and edits agents here, hands them tasks and reads
// their reports. The EA can hand agents tasks too, but anything it wants changed about an agent
// (creating, editing, pausing or resuming one) waits in "Waiting on you" until Bailey decides.
// Every agent's tools come from a fixed read-only set; none can send, pay, book or change anything.
import { Component, html } from '/vendor/preact-htm.js';

const KIND = { create: 'Create', update: 'Change', pause: 'Pause', resume: 'Resume', schedule: 'Schedule' };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NEW_SCHEDULE = { freq: 'weekdays', day: '1', time: '07:00', cron: '', task: '' };
const RUN = { queued: 'Queued', running: 'Working', done: 'Done', failed: 'Failed' };
const BLANK = { slug: '', name: '', description: '', instructions_md: '', tools: [], enabled: true };
const FIELD_LABELS = { name: 'Name', description: 'What it is for', instructions_md: 'Instructions', tools: 'Tools' };

const ago = (iso) => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Brisbane' });
};
const clock = (h, m) => `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
const when = (iso) => iso ? new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Brisbane' }) : '';

/** The schedule form's choice as a cron line, in Brisbane time. */
function cronFrom(f) {
  if (f.freq === 'custom') return f.cron.trim();
  const [h, m] = f.time.split(':').map(Number);
  return `${m} ${h} * * ${f.freq === 'daily' ? '*' : f.freq === 'weekdays' ? '1-5' : f.day}`;
}

/** Plain words for the cron lines the form makes; anything else is shown as it is. */
export function describeCron(cron) {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/.exec(cron.trim());
  if (!m) return `Custom: ${cron}`;
  const at = clock(Number(m[2]), Number(m[1]));
  return m[3] === '*' ? `Every day at ${at}` : m[3] === '1-5' ? `Weekdays at ${at}` : `${DAYS[Number(m[3])]}s at ${at}`;
}
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 40);

function status(a) {
  if (!a.enabled) return { label: 'Paused', cls: 'muted' };
  if (a.active) return { label: a.last_run?.status === 'running' ? 'Working' : 'Queued', cls: 'steel' };
  if (a.last_run?.status === 'failed') return { label: 'Last task failed', cls: 'coral' };
  return { label: 'Ready', cls: 'muted' };
}

async function request(method, path, body) {
  const r = await fetch(path, {
    method, headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { location.assign('/login'); throw new Error('Signed out.'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const issue = Array.isArray(data.issues) && data.issues[0];
    throw new Error(issue ? `${FIELD_LABELS[issue.path?.[0]] ?? issue.path?.[0] ?? 'Field'}: ${issue.message}` : data.error || 'Something went wrong. Please try again.');
  }
  return data;
}

export class Workforce extends Component {
  state = { data: null, error: '', open: null, detail: null, form: null, saving: false, formError: '', task: '', taskNote: '', deciding: null,
    sched: { ...NEW_SCHEDULE }, schedNote: '' };

  componentDidMount() {
    this.load();
    // Tasks finish in the background; keep the page current while it is open.
    this.timer = setInterval(() => { if (document.visibilityState === 'visible') this.load(true); }, 10_000);
  }
  componentWillUnmount() { clearInterval(this.timer); }
  // Opening an agent from the roster below brings its editor into view.
  editorRef = (el) => {
    if (el && el !== this.editorEl) el.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    this.editorEl = el;
  };

  async load(quiet = false) {
    try {
      const data = await request('GET', '/api/workforce');
      this.setState({ data, error: '' });
      if (this.state.open && this.state.open !== 'new') await this.loadDetail(this.state.open, quiet);
    } catch (e) {
      if (!quiet || !this.state.data) this.setState({ error: this.state.data ? 'Could not refresh. Reload to see the latest.' : 'The agent service is not reachable right now.' });
    }
  }

  async loadDetail(slug, keepForm = false) {
    const detail = await request('GET', `/api/workforce/agents/${slug}`);
    this.setState((st) => ({ detail, form: keepForm && st.form ? st.form : { ...detail.agent } }));
  }

  open(slug) {
    if (slug === 'new') return this.setState({ open: 'new', detail: null, form: { ...BLANK }, formError: '', task: '', taskNote: '' });
    this.setState({ open: slug, detail: null, form: null, formError: '', task: '', taskNote: '', sched: { ...NEW_SCHEDULE }, schedNote: '' });
    this.loadDetail(slug).catch((e) => this.setState({ formError: e.message }));
  }
  close() { this.setState({ open: null, detail: null, form: null, formError: '' }); }

  setField(key, value) {
    this.setState((st) => {
      const form = { ...st.form, [key]: value };
      // A new agent's short name follows its name until Bailey types one himself.
      if (key === 'name' && st.open === 'new' && !st.slugTouched) form.slug = slugify(value);
      return { form, slugTouched: key === 'slug' ? true : st.slugTouched };
    });
  }
  toggleTool(tool) {
    const tools = this.state.form.tools.includes(tool) ? this.state.form.tools.filter((t) => t !== tool) : [...this.state.form.tools, tool];
    this.setField('tools', tools);
  }

  async save(e) {
    e.preventDefault();
    const { form, open } = this.state;
    const isNew = open === 'new';
    const body = { name: form.name, description: form.description, instructions_md: form.instructions_md, tools: form.tools, enabled: form.enabled };
    if (isNew) body.slug = form.slug;
    this.setState({ saving: true, formError: '' });
    try {
      const { agent } = await request('POST', isNew ? '/workforce/agents' : `/workforce/agents/${open}`, body);
      await this.load(true);
      this.open(agent.slug);
    } catch (err) {
      this.setState({ formError: err.message });
    } finally {
      this.setState({ saving: false });
    }
  }

  async sendTask(e) {
    e.preventDefault();
    const task = this.state.task.trim();
    if (!task) return;
    this.setState({ saving: true, taskNote: '' });
    try {
      await request('POST', `/workforce/agents/${this.state.open}/tasks`, { task });
      this.setState({ task: '', taskNote: 'Queued. The report appears here when it is done.' });
      await this.load(true);
    } catch (err) {
      this.setState({ taskNote: err.message });
    } finally {
      this.setState({ saving: false });
    }
  }

  async addSchedule(e) {
    e.preventDefault();
    const { sched, open } = this.state;
    this.setState({ saving: true, schedNote: '' });
    try {
      await request('POST', `/workforce/agents/${open}/schedules`, { cron: cronFrom(sched), task: sched.task });
      this.setState({ sched: { ...NEW_SCHEDULE } });
      await this.load(true);
    } catch (err) {
      this.setState({ schedNote: err.message });
    } finally {
      this.setState({ saving: false });
    }
  }

  async changeSchedule(id, path, body) {
    this.setState({ schedNote: '' });
    try {
      await request('POST', `/workforce/schedules/${id}${path}`, body);
      await this.load(true);
    } catch (err) {
      this.setState({ schedNote: err.message });
    }
  }

  async decide(change, decision) {
    this.setState({ deciding: change.id });
    try {
      await request('POST', `/workforce/changes/${change.id}/decision`, { decision });
      await this.load(true);
    } catch (err) {
      this.setState({ error: err.message });
    } finally {
      this.setState({ deciding: null });
    }
  }

  render() {
    const { data, error, open } = this.state;
    return html`<main class="main dashboard wf">
      <header class="dashboard-heading between wrap">
        <div class="col" style="gap: 8px;"><span class="fs12 steel">MONIQR / AGENTS</span><h1>Agents</h1>
          <p class="muted">The agents that work for you and your EA. Each one reads only what you tick for it, and its only output is a report. Your EA can hand them tasks, but it needs your approval to change them.</p></div>
        <button class="btn btn-primary" onClick=${() => this.open('new')}>New agent</button>
      </header>
      ${error && html`<p class="fs14 coral" role="alert">${error}</p>`}
      ${!data && !error && html`<p class="muted">Loading…</p>`}
      ${data && this.renderChanges(data)}
      ${data && open && this.renderEditor(data)}
      ${data && this.renderRoster(data)}
    </main>`;
  }

  renderChanges(data) {
    if (!data.changes.length) return null;
    return html`<section class="tile panel wf-changes">
      <div class="between"><h2 class="card-title">Waiting on you</h2><span class="badge">${data.changes.length}</span></div>
      <p class="fs13 muted">Your EA asked for these. Nothing changes until you approve.</p>
      ${data.changes.map((c) => this.renderChange(c, data.tools))}
    </section>`;
  }

  renderChange(c, tools) {
    const toolNames = (list) => (list?.length ? list.map((t) => tools[t]?.label ?? t).join(', ') : 'None');
    const proposed = c.kind === 'create' ? c.change.agent : c.change.fields;
    const sched = c.kind === 'schedule' ? c.change.schedule : null;
    const title = c.kind === 'create' ? `${KIND.create} ${proposed?.name ?? 'an agent'}` : `${KIND[c.kind]} ${c.agent_name ?? c.agent_slug}`;
    const current = { name: c.agent_name, description: c.current_description, instructions_md: c.current_instructions, tools: c.current_tools };
    const busy = this.state.deciding === c.id;
    return html`<article class="dashboard-list-row col wf-change">
      <div class="between wrap"><strong>${title}</strong><span class="fs12 muted">${ago(c.created_at)} · EA run ${c.run_id}</span></div>
      <p class="fs14 soft">${c.reason}</p>
      ${proposed && html`<dl class="wf-diff">${Object.keys(FIELD_LABELS).filter((k) => proposed[k] !== undefined).map((k) => html`
        <dt class="fs12 muted">${FIELD_LABELS[k]}</dt>
        <dd>${c.kind === 'update' && html`<div class="fs13 dim wf-was">Now: ${k === 'tools' ? toolNames(current[k]) : k === 'instructions_md' ? html`<details><summary>Show current</summary><pre class="wf-pre">${current[k]}</pre></details>` : current[k] || '(empty)'}</div>`}
          ${c.kind === 'update' && k !== 'instructions_md' && html`<span class="fs13 muted">Proposed: </span>`}${k === 'tools' ? toolNames(proposed[k]) : k === 'instructions_md' ? html`<details open=${c.kind === 'create'}><summary class="fs13">${c.kind === 'update' ? 'Proposed instructions' : 'Instructions'}</summary><pre class="wf-pre">${proposed[k]}</pre></details>` : proposed[k]}</dd>`)}
      </dl>`}
      ${sched && html`<dl class="wf-diff"><dt class="fs12 muted">When</dt><dd>${describeCron(sched.cron)}</dd><dt class="fs12 muted">Task</dt><dd class="wf-task">${sched.task}</dd></dl>`}
      <div class="row wrap"><button class="btn btn-primary sm" disabled=${busy} onClick=${() => this.decide(c, 'approved')}>Approve</button>
        <button class="btn btn-secondary sm" disabled=${busy} onClick=${() => this.decide(c, 'rejected')}>Reject</button></div>
    </article>`;
  }

  renderRoster(data) {
    return html`<section class="col" style="gap: 12px;">
      <h2>Your workforce</h2>
      <div class="dashboard-projects">
        <article class="tile panel wf-card wf-ea">
          <div class="between"><span class="fs12 muted">Executive Assistant</span><span class="dashboard-status steel">Lead</span></div>
          <h3>Your EA</h3>
          <p class="fs13 soft">Writes your briefs, reads their reports and hands them tasks. Its instructions live in the repo; its schedule is on Settings.</p>
        </article>
        ${data.agents.map((a) => {
          const s = status(a);
          return html`<button class=${`tile panel wf-card ${this.state.open === a.slug ? 'is-open' : ''}`} onClick=${() => this.open(a.slug)} aria-label=${`Open ${a.name}`}>
            <div class="between"><span class="fs12 muted">${a.last_run ? `Last task ${ago(a.last_run.queued_at)}` : 'No tasks yet'}</span><span class=${`dashboard-status ${s.cls}`}>${s.label}</span></div>
            <h3>${a.name}</h3>
            <p class="fs13 soft">${a.description || html`<span class="dim">No description</span>`}</p>
            <div class="row wrap wf-tools">${a.tools.length ? a.tools.map((t) => html`<span class="wf-tool">${data.tools[t]?.label ?? t}</span>`) : html`<span class="fs12 dim">No data tools</span>`}</div>
            <span class="fs12 muted">${a.reports} ${a.reports === 1 ? 'report' : 'reports'}${a.schedules ? ` · ${a.enabled ? `next run ${when(a.next_run_at)}` : `${a.schedules} schedule${a.schedules === 1 ? '' : 's'} paused`}` : ''}</span>
          </button>`;
        })}
      </div>
      ${!data.agents.length && html`<p class="muted">No agents yet. Create one with New agent, or your EA may suggest one in Waiting on you.</p>`}
    </section>`;
  }

  renderEditor(data) {
    const { form, detail, open, saving, formError } = this.state;
    if (!form) return html`<section class="tile panel"><p class="muted">${formError || 'Loading…'}</p></section>`;
    const isNew = open === 'new';
    return html`<section class="tile panel wf-editor" ref=${this.editorRef}>
      <div class="between"><h2 class="card-title">${isNew ? 'New agent' : form.name}</h2><button class="btn btn-ghost" onClick=${() => this.close()}>Close</button></div>
      <div class="wf-editor-grid">
        <form class="col personal-form" onSubmit=${(e) => this.save(e)}>
          <div class="row wrap">
            <label class="col" style="flex: 2 1 200px;">Name<input class="field" required maxlength="60" value=${form.name} onInput=${(e) => this.setField('name', e.target.value)} /></label>
            ${isNew && html`<label class="col" style="flex: 1 1 140px;">Short name<input class="field" required pattern="[a-z][a-z0-9\\-]{1,39}" title="2 to 40 lowercase letters, digits or hyphens, starting with a letter" maxlength="40" value=${form.slug} onInput=${(e) => this.setField('slug', e.target.value)} /></label>`}
          </div>
          <label class="col">What it is for <span class="fs12 muted">Your EA reads this to decide when to hand it a task.</span>
            <input class="field" maxlength="500" value=${form.description} onInput=${(e) => this.setField('description', e.target.value)} /></label>
          <label class="col">Instructions <span class="fs12 muted">Markdown. Who it is, what it does and how to write its report.</span>
            <textarea class="field wf-instructions" required rows="10" maxlength="20000" value=${form.instructions_md ?? ''} onInput=${(e) => this.setField('instructions_md', e.target.value)}></textarea></label>
          <fieldset class="col wf-toolset"><legend>Tools <span class="fs12 muted">All read-only</span></legend>
            ${Object.entries(data.tools).map(([key, t]) => html`<label class="row wf-tool-option">
              <input type="checkbox" checked=${form.tools.includes(key)} onChange=${() => this.toggleTool(key)} />
              <span class="col"><span>${t.label}</span><span class="fs12 muted">${t.detail}</span></span></label>`)}
          </fieldset>
          <label class="row"><input type="checkbox" checked=${form.enabled} onChange=${(e) => this.setField('enabled', e.target.checked)} /> Active <span class="fs12 muted">A paused agent takes no tasks.</span></label>
          ${formError && html`<p class="fs14 coral" role="alert">${formError}</p>`}
          <div class="row"><button class="btn btn-primary" type="submit" disabled=${saving}>${saving ? 'Saving…' : isNew ? 'Create agent' : 'Save changes'}</button></div>
        </form>
        ${!isNew && detail && this.renderWork(detail)}
      </div>
    </section>`;
  }

  renderSchedules(detail) {
    const { sched, schedNote, saving } = this.state;
    const set = (k, v) => this.setState((st) => ({ sched: { ...st.sched, [k]: v } }));
    return html`<div class="col wf-schedules" style="gap: 8px;">
      <h3 class="fs15">Schedule <span class="fs12 muted">Brisbane time</span></h3>
      ${detail.schedules.length ? detail.schedules.map((s) => html`<div class="dashboard-list-row col wf-schedule">
        <div class="between wrap"><strong class="fs14">${describeCron(s.cron)}</strong>
          <span class="row" style="gap: 10px;">
            <label class="row fs13"><input type="checkbox" checked=${s.enabled} onChange=${(e) => this.changeSchedule(s.id, '', { enabled: e.target.checked })} /> On</label>
            <button class="btn btn-ghost sm" onClick=${() => confirm('Remove this schedule? Past reports stay.') && this.changeSchedule(s.id, '/delete', {})}>Remove</button></span></div>
        <span class="fs13 wf-task">${s.task}</span>
        <span class="fs12 muted">${!detail.agent.enabled ? 'Agent paused' : s.enabled ? `Next run ${when(s.next_run_at)}` : 'Off'}${s.last_run ? ` · last ran ${ago(s.last_run.queued_at)} (${RUN[s.last_run.status].toLowerCase()})` : ''}</span>
      </div>`) : html`<p class="fs13 muted">No schedule. It only works when you or your EA hand it a task.</p>`}
      <form class="col personal-form wf-schedule-form" onSubmit=${(e) => this.addSchedule(e)}>
        <div class="row wrap">
          <label class="col" style="flex: 1 1 130px;">Runs<select class="field" value=${sched.freq} onChange=${(e) => set('freq', e.target.value)}>
            <option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekly">Once a week</option><option value="custom">Custom (cron)</option></select></label>
          ${sched.freq === 'weekly' && html`<label class="col" style="flex: 1 1 120px;">On<select class="field" value=${sched.day} onChange=${(e) => set('day', e.target.value)}>
            ${DAYS.map((d, i) => html`<option value=${String(i)}>${d}</option>`)}</select></label>`}
          ${sched.freq === 'custom'
            ? html`<label class="col" style="flex: 2 1 160px;">Cron<input class="field" placeholder="0 7 * * 1-5" value=${sched.cron} onInput=${(e) => set('cron', e.target.value)} /></label>`
            : html`<label class="col" style="flex: 1 1 100px;">At<input class="field" type="time" required value=${sched.time} onInput=${(e) => set('time', e.target.value)} /></label>`}
        </div>
        <label class="col">Standing task<textarea class="field" rows="2" maxlength="4000" required placeholder="What it should do each time" value=${sched.task} onInput=${(e) => set('task', e.target.value)}></textarea></label>
        <div class="row wrap"><button class="btn btn-secondary" type="submit" disabled=${saving || !sched.task.trim()}>Add schedule</button>
          ${schedNote && html`<span class="fs13 coral" role="alert">${schedNote}</span>`}</div>
      </form>
    </div>`;
  }

  renderWork(detail) {
    const { task, taskNote, saving } = this.state;
    return html`<div class="col wf-work">
      <form class="col personal-form" onSubmit=${(e) => this.sendTask(e)}>
        <label class="col">Hand it a task<textarea class="field" rows="3" maxlength="4000" placeholder="What to find out or do, and what to report back" value=${task} onInput=${(e) => this.setState({ task: e.target.value })}></textarea></label>
        <div class="row wrap"><button class="btn btn-secondary" type="submit" disabled=${saving || !task.trim() || !detail.agent.enabled}>Send task</button>
          ${!detail.agent.enabled && html`<span class="fs12 muted">Paused</span>`}
          ${taskNote && html`<span class="fs13 muted" role="status">${taskNote}</span>`}</div>
      </form>
      ${this.renderSchedules(detail)}
      <div class="col" style="gap: 4px;"><h3 class="fs15">Reports</h3>
        ${detail.reports.length ? detail.reports.map((r) => html`<details class="dashboard-list-row wf-report">
          <summary><span class="fs12 muted">${ago(r.created_at)}</span> <span>${r.summary}</span></summary>
          <div class="brief-md" dangerouslySetInnerHTML=${{ __html: r.html }}></div></details>`) : html`<p class="fs13 muted">No reports yet.</p>`}
      </div>
      <div class="col" style="gap: 4px;"><h3 class="fs15">Tasks</h3>
        ${detail.runs.length ? detail.runs.map((r) => html`<div class="dashboard-list-row col">
          <div class="between"><span class="fs12 muted">${r.trigger === 'delegated' ? 'From your EA' : r.trigger === 'schedule' ? 'Scheduled' : 'From you'} · ${ago(r.queued_at)}</span>
            <span class=${`fs12 ${r.status === 'failed' ? 'coral' : r.status === 'done' ? 'muted' : 'steel'}`}>${RUN[r.status]}</span></div>
          <span class="fs13 wf-task">${r.task}</span>
          ${r.error && html`<span class="fs12 coral">${r.error}</span>`}</div>`) : html`<p class="fs13 muted">No tasks yet.</p>`}
      </div>
    </div>`;
  }
}
