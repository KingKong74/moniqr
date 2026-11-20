// Backlog, from the "Moniqr backlog redesign" Claude Design project: one card on top with the
// rest fanned underneath (← → flick through them), beside the whole stack grouped by status. On
// a big enough screen the page fits the window and only the list and the top card scroll
// inside themselves; smaller screens scroll as usual. Every item is the owner's own and
// every change is saved straight away through the hub's same-origin /backlog routes. The EA can
// read open items in briefs but never changes them. The "Suggested" card is a simple rule
// (highest priority, then oldest, in the Backlog pile), worked out here, not by the EA.
import { Component, html } from '/vendor/preact-htm.js';

const DAY_MS = 86_400_000;
const LBL = { backlog: 'Backlog', next: 'Next', doing: 'Doing', done: 'Done' };
const ORDER = ['backlog', 'next', 'doing', 'done'];
const RANK = { doing: 0, next: 1, backlog: 2, done: 3 };
const PRI_RANK = { high: 3, normal: 2, low: 1 };
const PRIS = ['low', 'normal', 'high'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const daysSince = (iso) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY_MS));
const sortItems = (items) => [...items].sort((a, b) => RANK[a.status] - RANK[b.status] || a.position - b.position || a.id - b.id);
const stepsDone = (it) => it.steps.filter((s) => s.done).length;
const stepsLabel = (it) => (it.steps.length ? `${stepsDone(it)}/${it.steps.length} steps` : '');
const progress = (it) => (it.steps.length ? (100 * stepsDone(it)) / it.steps.length : 0);
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const isTyping = (el) => /INPUT|TEXTAREA|SELECT/.test(el?.tagName ?? '') || el?.isContentEditable;
const STALE_DAYS = 14;


/** Apply a change locally, the same way the agent API will, so the page responds at once. */
function applyLocal(items, id, patch) {
  const positions = items.map((i) => i.position);
  const { place, ...fields } = patch;
  return sortItems(items.map((i) => i.id !== id ? i : {
    ...i, ...fields, updated_at: new Date().toISOString(),
    position: place === 'top' ? Math.min(0, ...positions) - 1 : place === 'bottom' ? Math.max(0, ...positions) + 1 : i.position,
  }));
}

export class Backlog extends Component {
  state = {
    items: null, error: '', draft: '', pri: 'normal', adding: false,
    cursor: 0, filter: null, showDone: false, openId: null, dismissed: [],
    stepDraft: '', topStepDraft: '', titleDraft: null, notesDraft: null,
  };
  pending = new Map();
  queue = Promise.resolve();
  topRef = (el) => (this.topEl = el);
  dialogRef = (el) => (this.dialogEl = el);
  pageRef = (el) => (this.pageEl = el);

  /** The height left below the top bar, so the page can fit the window. Ignores the view-change transform. */
  fit = () => {
    let top = 0;
    for (let el = this.pageEl; el; el = el.offsetParent) top += el.offsetTop;
    this.pageEl?.style.setProperty('--bl-h', `${Math.max(0, window.innerHeight - top)}px`);
  };

  componentDidMount() {
    this.load();
    this.onKey = (e) => {
      if (e.key === 'Escape' && this.state.openId) return this.closeDetail();
      if (this.state.openId || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); this.flick(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.flick(-1); }
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.fit);
    this.fit();
  }

  componentWillUnmount() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.fit);
    this.flushDetail();
  }

  async load() {
    try {
      const r = await fetch('/api/backlog', { headers: { accept: 'application/json' } });
      if (r.status === 401) return void location.assign('/login');
      if (!r.ok) throw new Error();
      const { items } = await r.json();
      this.setState({ items: sortItems(items) });
    } catch {
      this.setState({ error: this.state.items ? 'Could not refresh the backlog. Reload to see the latest.' : 'Backlog unavailable.' });
    }
  }

  async send(path, body) {
    const r = await fetch(path, {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (r.status === 401) { location.assign('/login'); throw new Error('Signed out.'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Could not save. Please try again.');
    return data.item;
  }

  /** Change one item now, then save it. Saves run in order; a failed save reloads the list. */
  change(id, patch) {
    if (!this.state.items?.some((i) => i.id === id)) return;
    this.setState((st) => ({ items: applyLocal(st.items, id, patch), error: '' }));
    this.pending.set(id, (this.pending.get(id) ?? 0) + 1);
    this.queue = this.queue.then(async () => {
      try {
        const saved = await this.send(`/backlog/${id}`, patch);
        const left = this.pending.get(id) - 1;
        this.pending.set(id, left);
        // A later change to the same item is still on its way; let that reply settle it.
        if (!left && saved) this.setState((st) => ({ items: sortItems(st.items.map((i) => (i.id === id ? saved : i))) }));
      } catch (e) {
        this.pending.set(id, 0);
        this.setState({ error: `${e.message} The list has been reloaded.` });
        await this.load();
      }
    });
  }

  setStatus(id, status, place = 'top') {
    if (status === 'doing') this.setState({ cursor: 0 });
    this.change(id, { status, place });
  }
  start = (id) => this.setStatus(id, 'doing');
  finish = (id) => this.setStatus(id, 'done');
  queueUp = (id) => this.setStatus(id, 'next', 'bottom');
  bury = (id) => this.setStatus(id, 'backlog', 'bottom');
  reopen = (id) => this.setStatus(id, 'next');

  editSteps(it, fn) { this.change(it.id, { steps: fn(it.steps) }); }
  toggleStep = (it, k) => this.editSteps(it, (s) => s.map((x, j) => (j === k ? { ...x, done: !x.done } : x)));
  removeStep = (it, k) => this.editSteps(it, (s) => s.filter((_, j) => j !== k));
  addStep(it, key) {
    const t = this.state[key].trim();
    if (!t || !it) return;
    if (it.steps.length >= 50) return void this.setState({ error: 'An item can have up to 50 steps.' });
    this.editSteps(it, (s) => [...s, { t: t.slice(0, 240), done: false }]);
    this.setState({ [key]: '' });
  }

  async add() {
    const title = this.state.draft.trim();
    if (!title || this.state.adding) return;
    this.setState({ adding: true, error: '' });
    try {
      await this.queue;
      const item = await this.send('/backlog', { title: title.slice(0, 240), priority: this.state.pri, status: 'backlog' });
      this.setState((st) => ({ draft: '', items: sortItems([...(st.items ?? []), item]) }));
    } catch (e) { this.setState({ error: e.message }); }
    finally { this.setState({ adding: false }); }
  }

  /** Flick the top card away and bring the next one up (d > 0) or the previous one back (d < 0). */
  flick(d) {
    const el = this.topEl;
    if (el?.animate && !reducedMotion()) {
      const r = el.getBoundingClientRect();
      const ghost = el.cloneNode(true);
      Object.assign(ghost.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: 0, zIndex: 50, pointerEvents: 'none' });
      ghost.setAttribute('aria-hidden', 'true');
      document.body.appendChild(ghost);
      ghost.style.transformOrigin = d > 0 ? '50% 0%' : '50% 100%';
      const P = 'perspective(1100px) ';
      const out = d > 0
        ? [{ transform: `${P}translateY(0) rotateX(0deg)`, opacity: 1 }, { transform: `${P}translateY(-34%) rotateX(62deg) scale(0.96)`, opacity: 0 }]
        : [{ transform: `${P}translateY(0) rotateX(0deg)`, opacity: 1 }, { transform: `${P}translateY(30%) rotateX(-58deg) scale(0.94)`, opacity: 0 }];
      ghost.animate(out, { duration: 480, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' }).onfinish = () => ghost.remove();
      this.flickDir = d;
    }
    this.setState((st) => ({ cursor: st.cursor + d, topStepDraft: '' }));
  }

  componentDidUpdate(_props, prev) {
    if (!prev.items && this.state.items) this.fit();
    const d = this.flickDir;
    this.flickDir = 0;
    if (d && this.topEl?.animate) {
      const P = 'perspective(1100px) ';
      const inn = d > 0
        ? [{ transform: `${P}translateY(44px) rotateX(-28deg) scale(0.95)`, opacity: 0.3 }, { transform: `${P}translateY(0) rotateX(0deg) scale(1)`, opacity: 1 }]
        : [{ transform: `${P}translateY(-32%) rotateX(58deg) scale(0.96)`, opacity: 0 }, { transform: `${P}translateY(0) rotateX(0deg) scale(1)`, opacity: 1 }];
      this.topEl.style.transformOrigin = d > 0 ? '50% 100%' : '50% 0%';
      this.topEl.animate(inn, { duration: 560, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
    if (this.state.openId && !prev.openId) {
      this.returnFocus = document.activeElement;
      this.dialogEl?.focus();
    }
    if (!this.state.openId && prev.openId) this.returnFocus?.focus?.();
  }

  // — the card dialog —
  open = (id) => { this.flushDetail(); this.setState({ openId: id, stepDraft: '', titleDraft: null, notesDraft: null }); };
  closeDetail = () => { this.flushDetail(); this.setState({ openId: null }); };

  /** Save a title or notes edit that is still in the dialog. */
  flushDetail() {
    const { openId, titleDraft, notesDraft, items } = this.state;
    const it = items?.find((i) => i.id === openId);
    if (!it) return;
    const patch = {};
    const title = titleDraft?.trim();
    if (title && title !== it.title) patch.title = title.slice(0, 240);
    if (notesDraft !== null && notesDraft.trim() !== it.notes) patch.notes = notesDraft.trim();
    this.setState({ titleDraft: null, notesDraft: null });
    if (Object.keys(patch).length) this.change(it.id, patch);
  }

  render() {
    const { items, error } = this.state;
    const head = html`<div class="bl-head">
        <div class="bl-intro">
          <span class="fs12 muted">PERSONAL</span>
          <h1>Your backlog</h1>
          <p class="soft">Capture it now. Decide what comes next when you have space.</p>
        </div>
        ${items && html`<div class="bl-counts">
          <div><span class="bl-count-big">${items.filter((i) => i.status !== 'done').length}</span><span>in the stack</span></div>
          <i aria-hidden="true"></i>
          <div><span class="bl-count-done">${items.filter((i) => i.status === 'done').length}</span><span>cleared</span></div>
        </div>`}
      </div>`;
    if (!items) {
      return html`<main class="main bl-page" ref=${this.pageRef}>${head}
        ${error ? html`<p class="coral">${error}</p><div><button class="btn btn-secondary" onClick=${() => { this.setState({ error: '' }); this.load(); }}>Retry</button></div>` : html`<p class="muted">Loading backlog…</p>`}
      </main>`;
    }
    return html`<main class="main bl-page" ref=${this.pageRef}>
      ${head}
      ${this.renderSegments()}
      ${this.renderAdd()}
      <div class="bl-status-line" role="status" aria-live="polite">${error && html`<p class="coral">${error}</p>`}</div>
      ${this.renderStack()}
      ${this.renderDetail()}
    </main>`;
  }

  renderSegments() {
    const counts = Object.fromEntries(ORDER.map((k) => [k, this.state.items.filter((i) => i.status === k).length]));
    const flex = (k) => `${Math.max(counts[k], 0.6)} 1 0`;
    return html`<div class="bl-segments" aria-label="Items by status">
      <div class="bl-seg-bars">${ORDER.map((k) => html`<div class=${`bl-seg s-${k}`} style=${{ flex: flex(k) }}></div>`)}</div>
      <div class="bl-seg-labels">${ORDER.map((k, i) => html`<div style=${{ flex: flex(k) }}>
        <span class="text">${LBL[k]}</span><span class="muted">${counts[k]}</span>${i < 3 && html`<span class="bl-faint" aria-hidden="true">→</span>`}
      </div>`)}</div>
    </div>`;
  }

  renderAdd() {
    const { draft, pri, adding } = this.state;
    return html`<form class="bl-add" onSubmit=${(e) => { e.preventDefault(); this.add(); }}>
      <input aria-label="New backlog item" maxlength="240" value=${draft} onInput=${(e) => this.setState({ draft: e.target.value })}
        placeholder="Add to the stack: an idea, a task, something to come back to…" />
      <div class="bl-seg-pick" role="group" aria-label="Priority">
        ${PRIS.map((p) => html`<button type="button" aria-pressed=${pri === p} onClick=${() => this.setState({ pri: p })}>${cap(p)}</button>`)}
      </div>
      <button class="btn btn-primary" disabled=${adding || !draft.trim()}>${adding ? 'Adding…' : 'Add to stack'}</button>
    </form>`;
  }

  renderStack() {
    const { items, cursor, filter, showDone, dismissed, topStepDraft } = this.state;
    const active = items.filter((i) => i.status !== 'done');
    const done = items.filter((i) => i.status === 'done');
    const backlog = active.filter((i) => i.status === 'backlog');
    const next = active.filter((i) => i.status === 'next');
    const n = active.length;
    const cur = n ? ((cursor % n) + n) % n : 0;
    const ordered = [...active.slice(cur), ...active.slice(0, cur)];
    const top = ordered[0];
    const beneath = ordered.slice(1);

    // Stack health: untouched means not changed in two weeks.
    const stale = active.filter((i) => daysSince(i.updated_at) >= STALE_DAYS).sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
    const highPile = backlog.filter((i) => i.priority === 'high').length;
    const openSteps = active.reduce((s, i) => s + i.steps.filter((x) => !x.done).length, 0);
    const bad = stale.length + highPile * 2;
    const tone = bad > 8 ? ['Getting heavy', 'heavy'] : bad > 3 ? ['Needs a tidy', 'tidy'] : ['Healthy', 'healthy'];
    const FILTERS = {
      stale: { title: 'UNTOUCHED 2+ WEEKS', test: (i) => daysSince(i.updated_at) >= STALE_DAYS },
      high: { title: 'HIGH PRIORITY', test: (i) => i.priority === 'high' },
      steps: { title: 'WITH OPEN STEPS', test: (i) => i.steps.some((x) => !x.done) },
    };
    const filt = !showDone && FILTERS[filter];
    const shown = showDone ? done : filt ? active.filter(filt.test) : active;
    const cells = [
      ['stale', stale.length, 'untouched 2+ weeks', ''],
      ['high', active.filter((i) => i.priority === 'high').length, 'high priority', 'coral'],
      ['steps', openSteps, 'open steps', ''],
    ];

    const sug = backlog.filter((i) => !dismissed.includes(i.id))
      .sort((a, b) => PRI_RANK[b.priority] - PRI_RANK[a.priority] || Date.parse(a.created_at) - Date.parse(b.created_at))[0];
    const age = sug && daysSince(sug.created_at);

    const tabs = beneath.slice(0, 4);
    return html`<div class="bl-stack-grid">
      <section class="bl-col" aria-label="On top">
        <div class="row">
          <span class="grow bl-eyebrow">ON TOP</span>
          <span class="fs12 muted">${n ? `${cur + 1} / ${n}` : ''}<span class="bl-keys"> · ← → to flick</span></span>
          <button type="button" class="bl-icon-btn" disabled=${n < 2} onClick=${() => this.flick(-1)} title="Previous (←)" aria-label="Previous card">‹</button>
          <button type="button" class="bl-icon-btn" disabled=${n < 2} onClick=${() => this.flick(1)} title="Next (→)" aria-label="Next card">›</button>
        </div>
        ${top ? html`<div class="bl-deck">
          <article class="bl-top" ref=${this.topRef} key="top">
            <div class="row wrap">
              <span class=${`bl-status ${top.status === 'doing' ? 'doing' : ''}`}>${LBL[top.status]}</span>
              <span class="bl-pri"><span class=${`bl-dot p-${top.priority}`}></span>${cap(top.priority)} priority</span>
            </div>
            <h2 class="bl-top-title">${top.title}</h2>
            <div class="bl-top-body">
            <p class=${`bl-top-notes ${top.notes ? '' : 'empty'}`}>${top.notes || 'No notes yet. Add the context you’ll need when you pick this up.'}</p>
            <div class="bl-steps-box">
              <div class="row bl-steps-head"><span class="bl-label">Steps</span><div class="bar grow"><div style=${{ width: `${progress(top)}%` }}></div></div><span class="fs12 dim">${top.steps.length ? `${stepsDone(top)}/${top.steps.length} steps` : 'No steps'}</span></div>
              <div class="col bl-step-list">
                ${top.steps.map((st, k) => html`<div class="bl-step">
                  <button type="button" class="bl-tick" aria-pressed=${st.done} aria-label=${`${st.done ? 'Untick' : 'Tick'} ${st.t}`} onClick=${() => this.toggleStep(top, k)}>${st.done ? '✓' : ''}</button>
                  <span class=${st.done ? 'done' : ''}>${st.t}</span>
                </div>`)}
                <form class="bl-step bl-step-add" onSubmit=${(e) => { e.preventDefault(); this.addStep(top, 'topStepDraft'); }}>
                  <span aria-hidden="true">+</span>
                  <input aria-label="Add a step" maxlength="240" value=${topStepDraft} onInput=${(e) => this.setState({ topStepDraft: e.target.value })} placeholder="Break it down: add a step" />
                </form>
              </div>
            </div>
            </div>
            <div class="row wrap bl-top-actions">
              ${top.status === 'doing'
                ? html`<button type="button" class="btn btn-primary" onClick=${() => this.finish(top.id)}>Mark done</button>`
                : html`<button type="button" class="btn btn-primary" onClick=${() => this.start(top.id)}>Start this</button>`}
              <button type="button" class="btn btn-secondary" onClick=${() => this.bury(top.id)}>Not now, send to bottom</button>
              <span class="grow"></span>
              <button type="button" class="btn sm btn-secondary" onClick=${() => this.open(top.id)}>Open card ↗</button>
            </div>
          </article>
          ${tabs.map((it, k) => k < 2
            ? html`<button type="button" class=${`bl-under u${k}`} onClick=${() => this.flick(k + 1)} aria-label=${`Bring up ${it.title}`}>
                <span class="ellipsis grow">${it.title}</span><span class="bl-under-status">${LBL[it.status]}</span>
              </button>`
            : html`<div class=${`bl-under u${k}`} aria-hidden="true"></div>`)}
          <span class="fs12 muted bl-beneath">${beneath.length ? `${beneath.length} more underneath` : 'Nothing underneath'}</span>
        </div>` : html`<div class="bl-empty">The stack is clear. Add something above when it comes to mind.</div>`}

        <div class="tile bl-health">
          <div class="row"><span class="grow bl-eyebrow">STACK HEALTH</span><span class=${`bl-tone ${tone[1]}`}>${tone[0]}</span></div>
          <div class="bl-health-cells">
            ${cells.map(([key, num, label, cls]) => html`<button type="button" aria-pressed=${!showDone && filter === key}
                onClick=${() => this.setState((st) => ({ showDone: false, filter: st.filter === key && !st.showDone ? null : key }))}>
              <span class=${`bl-health-n ${cls}`}>${num}</span><span class="fs12 dim">${label}</span>
            </button>`)}
          </div>
          <div class="row">
            <span class="grow fs13 dim">Oldest: ${stale[0] ? `${stale[0].title} · ${plural(daysSince(stale[0].updated_at), 'day')}` : 'nothing stale'}</span>
            ${stale[0] && html`<button type="button" class="btn btn-ghost fs12" onClick=${() => this.open(stale[0].id)}>Open oldest ↗</button>`}
          </div>
        </div>
      </section>

      <section class="bl-col bl-right">
        <div class="col bl-list-wrap">
          <div class="row">
            <span class="grow bl-eyebrow">${showDone ? 'CLEARED' : filt ? filt.title : 'THE WHOLE STACK'}</span>
            ${filt || showDone
              ? html`<button type="button" class="bl-filter-chip" onClick=${() => this.setState({ filter: null, showDone: false })}>${plural(shown.length, 'item')} shown ×</button>`
              : html`<span class="fs12 muted">Click a card to bring it up</span>`}
          </div>
          <div class="bl-list-deck">
            <div class="bl-list">
              ${!shown.length && html`<div class="bl-list-empty">${showDone ? 'Nothing cleared yet.' : 'Nothing here. Nice.'}</div>`}
              ${shown.map((it, j) => {
                const i = active.indexOf(it);
                const sel = !showDone && i === cur;
                const first = j === 0 || shown[j - 1].status !== it.status;
                const act = it.status === 'backlog' ? ['Queue ↑', () => this.queueUp(it.id)] : it.status === 'next' ? ['Start', () => this.start(it.id)] : it.status === 'done' ? ['Reopen', () => this.reopen(it.id)] : null;
                return html`
                  ${first && html`<div class="bl-list-head"><span class=${`bl-sq s-${it.status}`}></span><span>${LBL[it.status]}</span><span class="bl-faint">${items.filter((x) => x.status === it.status).length}</span></div>`}
                  <div class=${`bl-row ${sel ? 'sel' : ''}`} key=${it.id}>
                    <button type="button" class="bl-row-main" onClick=${() => (showDone ? this.open(it.id) : this.setState({ cursor: i }))}
                      aria-current=${sel ? 'true' : undefined}>
                      <span class="fs12 bl-faint">${showDone ? '' : String(i + 1).padStart(2, '0')}</span>
                      <span class=${`bl-dot p-${it.priority}`}></span>
                      <span class=${`ellipsis bl-row-title ${it.status === 'done' ? 'done' : ''}`}>${it.title}</span>
                    </button>
                    <div class="row bl-row-tools">
                      <span class="fs12 muted">${stepsLabel(it)}</span>
                      ${act && html`<button type="button" class="btn btn-ghost fs12" onClick=${act[1]}>${act[0]}</button>`}
                      <button type="button" class="bl-open" onClick=${() => this.open(it.id)} title="Open card" aria-label=${`Open ${it.title}`}>↗</button>
                    </div>
                  </div>`;
              })}
            </div>
            <div class="bl-list-under u0" aria-hidden="true"></div>
            <div class="bl-list-under u1" aria-hidden="true"></div>
          </div>
        </div>

        <div class="bl-cleared">
          <span class="bl-dot live"></span>
          <span class="grow fs13 dim">${done.length} cleared · last: ${done[0]?.title ?? 'nothing yet'}</span>
          <button type="button" class="btn btn-ghost fs12" aria-pressed=${showDone} onClick=${() => this.setState((st) => ({ showDone: !st.showDone }))}>${showDone ? 'Show the stack' : 'Show done'}</button>
        </div>

        ${sug && html`<div class="bl-sug">
          <span class="bl-sug-avatar" aria-hidden="true">M</span>
          <div class="col grow" style="gap: 12px; min-width: 0;">
            <div class="row wrap"><span class="fs15 bright" style="font-weight: 500;">Worth queueing</span><span class="src live flush" title="Worked out from your backlog: highest priority first, then oldest">Live</span></div>
            <p class="bl-sug-text">“${sug.title}” is ${sug.priority} priority and has sat in the pile for ${age ? plural(age, 'day') : 'less than a day'}. Queue it behind ${next.length ? next[next.length - 1].title : 'your current focus'}?</p>
            <div class="grow"></div>
            <div class="row wrap">
              <button type="button" class="btn sm btn-primary" onClick=${() => this.queueUp(sug.id)}>Queue it</button>
              <button type="button" class="btn sm btn-secondary" onClick=${() => this.setState((st) => ({ dismissed: [...st.dismissed, sug.id] }))}>Not now</button>
            </div>
          </div>
        </div>`}
      </section>
    </div>`;
  }

  renderDetail() {
    const { items, openId, titleDraft, notesDraft, stepDraft } = this.state;
    const it = items.find((i) => i.id === openId);
    if (!it) return null;
    const active = items.filter((i) => i.status !== 'done');
    const all = [...active, ...items.filter((i) => i.status === 'done')];
    const di = all.indexOf(it);
    const go = (d) => this.open(all[(di + d + all.length) % all.length].id);
    const age = daysSince(it.created_at);
    const primary = it.status === 'done' ? ['Reopen', () => this.reopen(it.id)] : it.status === 'doing' ? ['Mark done', () => this.finish(it.id)] : ['Start this', () => this.start(it.id)];
    return html`<div class="bl-scrim" onClick=${this.closeDetail}></div>
      <aside class="bl-dialog" role="dialog" aria-modal="true" aria-label=${it.title} tabindex="-1" ref=${this.dialogRef}>
        <div class="row bl-dialog-head">
          <span class="grow fs12 muted">Backlog item · ${di + 1} of ${all.length}</span>
          <button type="button" class="bl-icon-btn" onClick=${() => go(-1)} aria-label="Previous item">‹</button>
          <button type="button" class="bl-icon-btn" onClick=${() => go(1)} aria-label="Next item">›</button>
          <button type="button" class="bl-icon-btn bare" onClick=${this.closeDetail} aria-label="Close">×</button>
        </div>
        <div class="bl-dialog-body">
          <div class="col" style="gap: 10px;">
            <div class="bl-seg-pick status" role="group" aria-label="Status">
              ${ORDER.map((k) => html`<button type="button" class=${`s-${k}`} aria-pressed=${it.status === k} onClick=${() => it.status !== k && this.setStatus(it.id, k)}>${LBL[k]}</button>`)}
            </div>
            <input class="bl-title-input" aria-label="Title" maxlength="240" value=${titleDraft ?? it.title}
              onInput=${(e) => this.setState({ titleDraft: e.target.value })} onBlur=${() => this.flushDetail()}
              onKeyDown=${(e) => e.key === 'Enter' && e.currentTarget.blur()} />
            <div class="row wrap fs13 dim" style="gap: 12px;">
              <div class="bl-seg-pick" role="group" aria-label="Priority">
                ${PRIS.map((p) => html`<button type="button" class=${`p-${p}`} aria-pressed=${it.priority === p} onClick=${() => it.priority !== p && this.change(it.id, { priority: p })}>${cap(p)}</button>`)}
              </div>
              <span>${age ? `Added ${plural(age, 'day')} ago` : 'Added today'}</span>
            </div>
          </div>
          <label class="col" style="gap: 8px;">
            <span class="bl-eyebrow">NOTES</span>
            <textarea class="bl-notes" rows="4" maxlength="10000" value=${notesDraft ?? it.notes} placeholder="Any context you want to keep"
              onInput=${(e) => this.setState({ notesDraft: e.target.value })} onBlur=${() => this.flushDetail()}></textarea>
          </label>
          <div class="col" style="gap: 10px;">
            <div class="row" style="align-items: baseline;"><span class="grow bl-eyebrow">BREAKDOWN</span><span class="fs12 dim">${it.steps.length ? `${stepsDone(it)} of ${it.steps.length} done` : 'No steps yet'}</span></div>
            <div class="bar"><div style=${{ width: `${progress(it)}%` }}></div></div>
            <div class="bl-breakdown">
              ${it.steps.map((st, k) => html`<div class="bl-step">
                <button type="button" class="bl-tick" aria-pressed=${st.done} aria-label=${`${st.done ? 'Untick' : 'Tick'} ${st.t}`} onClick=${() => this.toggleStep(it, k)}>${st.done ? '✓' : ''}</button>
                <span class=${st.done ? 'done' : ''}>${st.t}</span>
                <button type="button" class="bl-step-remove" onClick=${() => this.removeStep(it, k)} title="Remove step" aria-label=${`Remove ${st.t}`}>×</button>
              </div>`)}
              <form class="bl-step bl-step-add" onSubmit=${(e) => { e.preventDefault(); this.addStep(it, 'stepDraft'); }}>
                <span aria-hidden="true">+</span>
                <input aria-label="Add a smaller step" maxlength="240" value=${stepDraft} onInput=${(e) => this.setState({ stepDraft: e.target.value })} placeholder="Add a smaller step, press Enter" />
              </form>
            </div>
          </div>
        </div>
        <div class="row wrap bl-dialog-foot">
          <button type="button" class="btn btn-primary" onClick=${primary[1]}>${primary[0]}</button>
          ${it.status !== 'done' && html`<button type="button" class="btn btn-secondary" onClick=${() => { const k = active.findIndex((i) => i.id === it.id); this.flushDetail(); this.setState({ cursor: k, openId: null }); }}>Show on top</button>`}
          <span class="grow"></span>
          <span class="fs12 bl-faint bl-keys">Esc to close</span>
        </div>
      </aside>`;
  }
}
