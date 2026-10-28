// HQ, the moniqr.com homepage. A port of the Personal OS HQ v4 design to Preact + htm, loaded as
// one ES module so there's no build step. The server sends everything to draw from /api/hq:
// the real brief, runs and links, plus placeholder content (data.mock) until the agent service
// stores the rest. Approvals, chat replies, priorities, mood and habits only change this page's
// state for now. Nothing here books, buys or sends anything.
import { Component, html, render } from '/vendor/preact-htm.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

/** Now in Brisbane, which has no daylight saving: read the result with the UTC getters. */
const brisbane = (ms = Date.now()) => new Date(ms + 10 * 3_600_000);
const dowOf = (d) => (d.getUTCDay() + 6) % 7;
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (h) => {
  const hh = Math.floor(h);
  return `${pad(hh)}:${pad(Math.round((h - hh) * 60))}`;
};

// Calendar geometry: 6am to 11pm at 26px an hour.
const H0 = 6;
const H1 = 23;
const PX = 26;
const SLIDE_SECONDS = 8;
const POLL_MS = 5000;

const EV_STYLE = {
  gym: { bg: 'var(--accent)', border: 'var(--accent)', line: 'solid', fg: 'var(--n100)', label: 'Training' },
  work: { bg: 'color-mix(in srgb, var(--n100) 16%, transparent)', border: 'transparent', line: 'solid', fg: 'var(--n100)', label: 'Work' },
  life: { bg: 'color-mix(in srgb, var(--accent-2) 30%, transparent)', border: 'transparent', line: 'solid', fg: 'var(--n100)', label: 'Personal' },
  pend: { bg: 'transparent', border: 'var(--a400)', line: 'dashed', fg: 'var(--a300)', label: 'Awaiting decision' },
};

const STATUS = {
  pending: ['Needs decision', 'color-mix(in srgb, var(--accent) 40%, transparent)', 'var(--a200)'],
  executing: ['Working…', 'var(--wash-8)', 'var(--a300)'],
  completed: ['Done', 'var(--wash-8)', 'var(--n300)'],
  failed: ['Failed', 'var(--n200)', 'var(--n900)'],
  rejected: ['Declined', 'var(--wash-6)', 'var(--n400)'],
  fyi: ['Update', 'var(--wash-6)', 'var(--n400)'],
};

const MOODS = ['Low', 'Meh', 'Okay', 'Good', 'Great'];
const ENERGY = ['Drained', 'Low', 'Steady', 'High', 'Wired'];
const FOCUS_IDS = ['pri', 'news', 'mood', 'pick'];
const FOCUS_LABELS = { pri: 'priorities', news: 'news', mood: 'mood', pick: 'daily pick' };

const on = (bg, fg = 'var(--n100)') => `background: ${bg}; color: ${fg};`;
const choice = (active) => (active ? on('var(--accent)') : on('color-mix(in srgb, var(--n100) 5%, transparent)', 'var(--n300)'));

class App extends Component {
  state = {
    data: null,
    loadError: false,
    posting: false,
    now: Date.now(),
    view: 'hq',
    collapsed: window.matchMedia('(max-width: 760px)').matches,
    slide: 0,
    carPaused: false,
    ap: {},
    read: {},
    sel: null,
    filter: 'all',
    pick: null,
    draft: '',
    thinking: false,
    messages: [],
    pri: [],
    priExtra: {},
    priTouched: false,
    priDraft: '',
    mood: null,
    energy: null,
    journal: '',
    pickN: 0,
    focus: null,
    muted: {},
    saved: {},
    today: {},
    deals: {},
  };

  timers = [];
  barEls = {};
  barRefs = {};
  cardEls = {};
  cardRefs = Object.fromEntries(FOCUS_IDS.map((id) => [id, (el) => (this.cardEls[id] = el)]));
  gridRef = (el) => (this.gridEl = el);
  searchRef = (el) => (this.searchEl = el);

  componentDidMount() {
    this.load();
    this.clock = setInterval(() => this.setState({ now: Date.now() }), 30_000);
    this.onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.searchEl?.focus();
      }
    };
    window.addEventListener('keydown', this.onKey);
  }

  componentWillUnmount() {
    clearInterval(this.clock);
    clearTimeout(this.poll);
    this.timers.forEach(clearTimeout);
    window.removeEventListener('keydown', this.onKey);
  }

  later(fn, ms) {
    this.timers.push(setTimeout(fn, ms));
  }

  async load() {
    clearTimeout(this.poll);
    try {
      const res = await fetch('/api/hq', { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HQ data returned ${res.status}`);
      const data = await res.json();
      const first = !this.state.data;
      this.setState(first ? { data, ...this.seed(data.mock) } : { data, loadError: false }, () => {
        if (first) this.startBar();
      });
      if (data.busy) this.poll = setTimeout(() => this.load(), POLL_MS);
    } catch (err) {
      console.error(err);
      this.setState({ loadError: true });
    }
  }

  /** Page state that starts from the placeholder content. */
  seed(mock) {
    return {
      ap: Object.fromEntries(mock.mail.filter((m) => m.approveLabel).map((m) => [m.id, 'pending'])),
      read: Object.fromEntries(mock.readMail.map((id) => [id, true])),
      sel: mock.mail[0]?.id ?? null,
      pri: mock.priorities.map((p) => p.id),
      messages: mock.chat.opening,
      muted: Object.fromEntries(mock.interests.map((i) => [i.label, !i.on])),
    };
  }

  async runEa(kind) {
    this.setState({ posting: true });
    try {
      const res = await fetch('/run', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ kind }),
      });
      if (!res.ok) throw new Error(`Run request returned ${res.status}`);
    } catch (err) {
      console.error(err);
    } finally {
      this.setState({ posting: false });
      this.load();
    }
  }

  // — brief carousel —

  barRef(i) {
    return (this.barRefs[i] ??= (el) => (this.barEls[i] = el));
  }

  startBar() {
    this.barAnim?.cancel();
    if (this.state.carPaused || this.state.view !== 'hq') return;
    const el = this.barEls[this.state.slide];
    if (!el) return;
    this.barAnim = el.animate([{ width: '0%' }, { width: '100%' }], { duration: SLIDE_SECONDS * 1000, easing: 'linear', fill: 'forwards' });
    this.barAnim.onfinish = () => this.goSlide(this.state.slide + 1);
  }

  goSlide(i) {
    const n = this.slideCount || 1;
    this.setState({ slide: (i + n) % n }, () => this.startBar());
  }

  pauseCarousel = () => {
    this.barAnim?.pause();
    this.setState({ carPaused: true });
  };

  resumeCarousel = () => {
    this.setState({ carPaused: false }, () => {
      if (this.barAnim?.playState === 'paused') this.barAnim.play();
      else this.startBar();
    });
  };

  // — focus cards: FLIP between the grid and the focused layout —

  setFocus(id) {
    const snap = {};
    for (const [k, el] of Object.entries(this.cardEls)) {
      if (!el) continue;
      el.getAnimations().forEach((a) => a.cancel());
      snap[k] = el.getBoundingClientRect();
    }
    this.flip = { snap, gridH: this.gridEl?.getBoundingClientRect().height ?? 0 };
    this.setState({ focus: id });
  }

  componentDidUpdate(_props, prev) {
    if (prev.view !== this.state.view && this.state.view === 'hq') this.startBar();
    if (!this.flip) return;
    const { snap, gridH } = this.flip;
    this.flip = null;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const D = 460;
    const E = 'cubic-bezier(0.22, 1, 0.36, 1)';
    if (this.gridEl && gridH) {
      const nh = this.gridEl.getBoundingClientRect().height;
      if (Math.abs(nh - gridH) > 1) {
        this.gridEl.animate([{ height: `${gridH}px`, overflow: 'hidden' }, { height: `${nh}px`, overflow: 'hidden' }], { duration: D, easing: E });
      }
    }
    for (const [k, el] of Object.entries(this.cardEls)) {
      const a = snap[k];
      if (!el || !a) continue;
      const b = el.getBoundingClientRect();
      el.animate(
        [
          { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)`, width: `${a.width}px`, height: `${a.height}px`, overflow: 'hidden' },
          { transform: 'translate(0, 0)', width: `${b.width}px`, height: `${b.height}px`, overflow: 'hidden' },
        ],
        { duration: D, easing: E },
      );
      for (const c of el.children) {
        c.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 140, easing: 'ease-out', fill: 'backwards' });
      }
    }
  }

  // — approvals and chat (placeholder behaviour) —

  setAp(id, v) {
    this.setState((s) => ({ ap: { ...s.ap, [id]: v } }));
  }

  approve(id) {
    this.setAp(id, 'executing');
    this.later(() => this.setAp(id, 'completed'), 2600);
  }

  send(text) {
    if (!text.trim()) return;
    const { chat } = this.state.data.mock;
    this.setState((s) => ({ messages: [...s.messages, { me: true, text }], draft: '', thinking: true, collapsed: false }));
    const t = text.toLowerCase();
    const reply = chat.replies.find((r) => r.match.some((m) => t.includes(m)))?.text ?? chat.fallback;
    this.later(() => this.setState((s) => ({ thinking: false, messages: [...s.messages, { me: false, text: reply }] })), 1400);
  }

  openView(view) {
    this.setState({ view });
    window.scrollTo(0, 0);
  }

  // — render —

  render() {
    const { data, loadError } = this.state;
    if (!data) {
      return html`<p class="boot">${loadError ? 'HQ could not load. Refresh to try again.' : 'Loading HQ…'}</p>`;
    }
    const v = this.derive();
    return html`
      <div class="shell">
        ${this.renderNav(v)}
        <div class="grow col">
          ${this.renderTopbar(v)}
          <div class="body">
            <div class="content">
              ${this.state.view === 'hq' ? this.renderHq(v) : this.renderBriefing(v)}
              ${!this.state.collapsed && this.renderAssistant(v)}
            </div>
            ${this.state.collapsed &&
            html`<aside class="rail" title="Open Moniqr" onClick=${() => this.setState({ collapsed: false })}>
              <span class="m-mark">M</span>
              <span class="fs14 muted">←</span>
              <span class="v">Moniqr</span>
              ${v.pending > 0 && html`<span class="badge">${v.pending}</span>`}
            </aside>`}
          </div>
        </div>
      </div>
    `;
  }

  /** Values several sections share. */
  derive() {
    const { data, ap, read, sel } = this.state;
    const { mock } = data;
    const now = brisbane(this.state.now);
    const todayIdx = dowOf(now);
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - todayIdx * DAY_MS);
    const week = DOW.map((_, i) => new Date(monday.getTime() + i * DAY_MS));
    const stateOf = (m) => (m.approveLabel ? ap[m.id] : m.failed ? 'failed' : 'fyi');
    const pending = Object.values(ap).filter((x) => x === 'pending').length;
    const unread = mock.mail.filter((m) => !read[m.id] && m.id !== sel).length;
    const latest = data.runs[0];
    const workforce = [
      {
        name: 'Moniqr',
        ...(data.agentsError
          ? { kind: 'idle', state: 'offline' }
          : latest?.status === 'running'
            ? { kind: 'run', state: 'running' }
            : latest?.status === 'queued'
              ? { kind: 'wait', state: 'queued' }
              : latest?.status === 'failed'
                ? { kind: 'idle', state: 'last run failed' }
                : { kind: 'run', state: 'active' }),
      },
      ...mock.workforce,
    ];
    const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
    return { mock, now, todayIdx, week, hour, stateOf, pending, unread, workforce };
  }

  renderNav(v) {
    const { data } = this.state;
    const link = (name) => data.links.find((l) => l.name === name)?.url;
    const items = [
      { label: 'HQ', on: true, go: () => this.openView('hq') },
      { label: 'Inbox', badge: v.unread || '', go: () => { this.openView('hq'); this.later(() => document.getElementById('inbox')?.scrollIntoView({ behavior: 'smooth' }), 0); } },
      { label: 'Projects', href: link('Stack') },
      { label: 'Finance', href: link('Finance') },
      { label: 'Knowledge' },
      { label: 'Agents' },
      { label: 'Life' },
    ];
    const dot = { run: ['var(--accent)', 'var(--accent)'], wait: ['transparent', 'var(--a400)'], idle: ['transparent', 'var(--n600)'] };
    return html`
      <nav class="nav">
        <div class="row" style="gap: 10px; padding: 0 8px;">
          <span class="brand-mark">B</span>
          <div class="col brand-text">
            <span class="bright fs15" style="font-weight: 500;">Headquarters</span>
            <span class="fs12 muted">${v.mock.name}’s personal OS</span>
          </div>
        </div>
        <div class="col items" style="gap: 2px;">
          ${items.map((n) =>
            n.href
              ? html`<a class="nav-item" href=${n.href}><span class="grow">${n.label}</span></a>`
              : html`<div class=${`nav-item${n.on && this.state.view === 'hq' ? ' on' : ''}${n.go ? '' : ' soon'}`} onClick=${n.go} title=${n.go ? null : 'Not built yet'}>
                  <span class="grow">${n.label}</span>
                  ${n.badge ? html`<span class="badge">${n.badge}</span>` : null}
                </div>`,
          )}
        </div>
        <div class="col workforce" style="gap: 8px; padding: 0 10px;">
          <span class="fs12 muted">Workforce</span>
          ${v.workforce.map(
            (w) => html`<div class="row">
              <span class="dot" style=${`border: 1px solid ${dot[w.kind][1]}; background: ${dot[w.kind][0]};`}></span>
              <span class="fs13 soft grow">${w.name}</span>
              <span class="fs12 muted">${w.state}</span>
            </div>`,
          )}
        </div>
        <div class="spacer" style="flex: 1;"></div>
        <div class="up-next">
          <span class="fs12 muted">Up next</span>
          <span class="fs14 bright" style="font-weight: 500;">${v.mock.upNext.title}</span>
          <span class="fs12 dim">${v.mock.upNext.note}</span>
        </div>
      </nav>
    `;
  }

  renderTopbar(v) {
    const clock = `${DOW[v.todayIdx]} ${v.now.getUTCDate()} ${MONTHS[v.now.getUTCMonth()]} · ${pad(v.now.getUTCHours())}:${pad(v.now.getUTCMinutes())}`;
    const onSearch = (e) => {
      e.preventDefault();
      const input = e.currentTarget.elements.q;
      this.send(input.value);
      input.value = '';
    };
    return html`
      <header class="topbar">
        <div class="row crumb fs13 muted nowrap" style="gap: 6px;">
          <span class="text">HQ</span><span>/</span><span>${this.state.view === 'hq' ? 'Command centre' : 'Daily briefing'}</span>
        </div>
        <div style="flex: 1; display: flex; justify-content: center;">
          <form class="search" onSubmit=${onSearch}>
            <input ref=${this.searchRef} name="q" placeholder="Ask Moniqr, search, or run a command" autocomplete="off" />
            <span class="kbd">⌘K</span>
          </form>
        </div>
        <span class="sample" title="Only the brief, the EA runs and the links are real. Everything else is placeholder content until the database is ready, and nothing on this page books, buys or sends anything.">Sample data</span>
        <span class="clock fs13 muted nowrap">${clock}</span>
      </header>
    `;
  }

  renderHq(v) {
    return html`
      <main class="main">
        <div class="hero">${this.renderCarousel(v)} ${this.renderDecision(v)}</div>
        ${this.renderFocusCards(v)} ${this.renderInbox(v)} ${this.renderGlance(v)} ${this.renderCalendar(v)}
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 12px;">
          ${this.renderHabits(v)} ${this.renderMeals(v)} ${this.renderPeople(v)}
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px;">
          ${this.renderMarkets(v)} ${this.renderProjects(v)}
        </div>
      </main>
    `;
  }

  slides(v) {
    const { brief } = this.state.data;
    const h = v.now.getUTCHours();
    const greeting = `Good ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}, ${v.mock.name}.`;
    const first = brief
      ? {
          kicker: `Daily briefing · ${brief.kind} · ${brief.when}`,
          title: greeting,
          body: brief.summary,
          primary: { label: 'Open full briefing', briefing: true },
          secondary: { label: 'Plan my day', ask: 'Plan my day around my priorities' },
        }
      : {
          kicker: 'Daily briefing',
          title: greeting,
          body: 'No brief yet. Run the EA to write the first one.',
          primary: { label: 'Run EA now', run: true },
          secondary: { label: 'Open briefing', briefing: true },
        };
    return [first, ...v.mock.slides];
  }

  slideAction(a) {
    if (a.briefing) this.openView('briefing');
    else if (a.run) this.runEa('morning_brief');
    else if (a.ask) this.send(a.ask);
    else if (a.next) this.goSlide(this.state.slide + 1);
    else if (a.habit) this.setState((s) => ({ today: { ...s.today, [a.habit]: true } }));
    else if (a.priority) this.setState((s) => (s.pri.includes(a.priority) ? null : { pri: [...s.pri, a.priority] }));
  }

  renderCarousel(v) {
    const slides = this.slides(v);
    this.slideCount = slides.length;
    const si = Math.min(this.state.slide, slides.length - 1);
    const busy = this.state.posting || this.state.data.busy;
    return html`
      <section class="carousel" onMouseEnter=${this.pauseCarousel} onMouseLeave=${this.resumeCarousel}>
        <div class="row" style="gap: 10px;">
          <div class="progress" style=${`grid-template-columns: repeat(${slides.length}, minmax(0, 1fr));`}>
            ${slides.map(
              (s, i) => html`<div onClick=${() => this.goSlide(i)} title=${s.kicker}>
                <div class="track"><div class="fill" ref=${this.barRef(i)} style=${`width: ${i < si ? '100%' : '0%'};`}></div></div>
              </div>`,
            )}
          </div>
          <span class="icon-btn" title="Previous" onClick=${() => this.goSlide(si - 1)}>‹</span>
          <span class="icon-btn" title="Next" onClick=${() => this.goSlide(si + 1)}>›</span>
        </div>
        <div class="slides">
          ${slides.map(
            (s, i) => html`<div
              class="slide"
              style=${`opacity: ${i === si ? 1 : 0}; transform: translateX(${i === si ? 0 : i < si ? -18 : 18}px); pointer-events: ${i === si ? 'auto' : 'none'};`}
              aria-hidden=${i !== si}
            >
              <span class="fs13" style=${`color: ${i === 0 ? 'var(--n500)' : 'var(--accent-2)'};`}>${s.kicker}</span>
              <h1>${s.title}</h1>
              <p>${s.body}</p>
              <div class="row wrap" style="margin-top: 4px;">
                <button class="btn btn-primary" disabled=${s.primary.run && busy} onClick=${() => this.slideAction(s.primary)}>
                  ${s.primary.run && busy ? 'EA is running…' : s.primary.label}
                </button>
                <button class="btn btn-secondary" onClick=${() => this.slideAction(s.secondary)}>${s.secondary.label}</button>
              </div>
            </div>`,
          )}
        </div>
        <div class="between fs12 muted">
          <span>${si + 1} of ${slides.length}</span>
          <span>${this.state.carPaused ? 'Paused while you read' : 'Auto-advancing'}</span>
        </div>
      </section>
    `;
  }

  renderDecision(v) {
    const kd = v.mock.keyDecision;
    const mail = v.mock.mail.find((m) => m.id === kd.mailId);
    if (!mail) return null;
    const st = this.state.ap[mail.id];
    const stepIdx = { pending: 1, executing: 2, completed: 4, rejected: 1, failed: 2 }[st];
    const labels = kd.steps.map((l, i) => (i === 1 && st === 'rejected' ? 'You declined' : i === 2 && st === 'failed' ? 'Booking failed' : l));
    const deadline = { pending: kd.deadline, completed: 'Booked', rejected: 'Declined' }[st] ?? 'In progress';
    const settled = { executing: 'Booking now, not yet confirmed', completed: kd.completed, failed: 'Booking failed. Nothing was charged.', rejected: kd.rejected }[st];
    const others = Math.max(0, v.pending - (st === 'pending' ? 1 : 0));
    return html`
      <section class="decision">
        <div class="between wrap" style="align-items: center;">
          <span class="fs12 steel">Today's key decision · ranked by Moniqr</span>
          <span class="deadline">${deadline}</span>
        </div>
        <h2>${mail.subject}</h2>
        <div class="col" style="gap: 4px;">
          <span class="fs12 dim">Why this one first</span>
          <span class="fs14 text pretty" style="line-height: 1.55;">${kd.why}</span>
        </div>
        <div class="steps">
          ${labels.map((label, i) => {
            const bar = i < stepIdx ? 'var(--a300)' : i === stepIdx && st !== 'rejected' ? 'var(--accent-2)' : 'color-mix(in srgb, var(--n100) 12%, transparent)';
            return html`<div>
              <div class="seg" style=${`background: ${bar};`}></div>
              <span class=${`fs12 ${i <= stepIdx ? 'bright' : 'muted'}`} style="line-height: 1.3;">${label}</span>
            </div>`;
          })}
        </div>
        ${st === 'pending'
          ? html`<div class="row wrap">
              <button class="btn btn-primary" style="border-color: var(--a300); padding: 8px 16px;" onClick=${() => this.approve(mail.id)}>${mail.approveLabel}</button>
              <button class="btn btn-secondary" style="padding: 8px 16px;" onClick=${() => this.setAp(mail.id, 'rejected')}>Decline</button>
              <span class="fs13 steel" style="cursor: pointer;" onClick=${() => this.openMail(mail.id, true)}>Details in inbox</span>
            </div>`
          : html`<div class="row wrap" style="gap: 10px;">
              <span class="fs13 soft">${settled}</span>
              ${(st === 'rejected' || st === 'failed') &&
              html`<button class="btn btn-ghost" style="color: var(--a300);" onClick=${() => (st === 'failed' ? this.approve(mail.id) : this.setAp(mail.id, 'pending'))}>
                ${st === 'failed' ? 'Retry' : 'Undo'}
              </button>`}
            </div>`}
        <span class="fs12 dim">${others} other decision${others === 1 ? '' : 's'} in your inbox can wait until tonight</span>
      </section>
    `;
  }

  openMail(id, scroll = false) {
    this.setState((s) => ({ sel: id, read: { ...s.read, [id]: true } }));
    if (scroll) document.getElementById('inbox')?.scrollIntoView({ behavior: 'smooth' });
  }

  priorityDefs(v) {
    const defs = Object.fromEntries(v.mock.priorities.map((p) => [p.id, p]));
    return { ...defs, ...this.state.priExtra };
  }

  renderFocusCards(v) {
    const F = this.state.focus;
    const rest = FOCUS_IDS.filter((x) => x !== F);
    const L = Object.fromEntries(
      FOCUS_IDS.map((id) => {
        const isF = F === id;
        const mini = !!F && !isF;
        const style = [
          `gap: ${mini ? '4px' : '10px'}`,
          `padding: ${mini ? '12px 14px' : isF ? '20px 22px' : '16px 18px'}`,
          `grid-column: ${!F ? 'auto' : isF ? '1' : '2'}`,
          `grid-row: ${!F ? 'auto' : isF ? '1 / span 3' : String(rest.indexOf(id) + 1)}`,
          `cursor: ${isF ? 'default' : 'pointer'}`,
          `outline: 1px solid ${isF ? 'color-mix(in srgb, var(--a300) 35%, transparent)' : 'transparent'}`,
        ].join('; ');
        return [id, { full: !mini, big: isF, mini, style, onCard: () => this.state.focus !== id && this.setFocus(id) }];
      }),
    );
    const card = (id, extra, body) =>
      html`<section class=${`fcard ${extra}`} ref=${this.cardRefs[id]} style=${L[id].style} onClick=${L[id].onCard}>${body}</section>`;
    return html`
      <div class="col" style="gap: 8px;">
        ${F &&
        html`<div class="between" style="align-items: center;">
          <span class="fs12 muted">Focused on ${FOCUS_LABELS[F]} · tap another card to switch</span>
          <span class="chip" onClick=${() => this.setFocus(null)}>Show all cards</span>
        </div>`}
        <div
          class="cards"
          ref=${this.gridRef}
          style=${`grid-template-columns: ${F ? 'minmax(0, 2.2fr) minmax(200px, 1fr)' : 'repeat(auto-fit, minmax(240px, 1fr))'};`}
        >
          ${card('pri', '', this.renderPriorities(v, L.pri))} ${card('news', '', this.renderNews(v, L.news))}
          ${card('mood', '', this.renderMood(v, L.mood))} ${card('pick', 'pick', this.renderPick(v, L.pick))}
        </div>
      </div>
    `;
  }

  renderPriorities(v, L) {
    const defs = this.priorityDefs(v);
    const order = this.state.pri;
    const move = (i, d) => (e) => {
      e.stopPropagation();
      this.setState((s) => {
        const a = [...s.pri];
        const j = i + d;
        if (j < 0 || j >= a.length) return null;
        [a[i], a[j]] = [a[j], a[i]];
        return { pri: a, priTouched: true };
      });
    };
    const drop = (id) => (e) => {
      e.stopPropagation();
      this.setState((s) => ({ pri: s.pri.filter((x) => x !== id), priTouched: true }));
    };
    const dropped = Object.keys(defs).filter((id) => !order.includes(id));
    const plan =
      order
        .slice(0, 4)
        .map((id, i) => (i ? '' : 'First, ') + (defs[id].plan ?? `make time for “${defs[id].title}”`))
        .join(', then ') + '.';
    const addPri = (e) => {
      e.preventDefault();
      const t = this.state.priDraft.trim();
      if (!t) return;
      const id = `x${Date.now()}`;
      this.setState((s) => ({
        priExtra: { ...s.priExtra, [id]: { id, title: t, note: 'Added by you just now', forgot: false } },
        pri: [...s.pri, id],
        priDraft: '',
        priTouched: true,
      }));
    };
    if (L.mini) {
      return html`
        <div class="between"><span class="fs13 bright" style="font-weight: 500;">Your priorities</span><span class="fs11 muted nowrap">${order.length} items</span></div>
        <span class="fs12 dim clamp2">1. ${order.length ? defs[order[0]].title : 'Nothing set'}</span>
      `;
    }
    return html`
      <div class="between">
        <h2 class="card-title">Your priorities</h2>
        <span class=${`fs12 ${this.state.priTouched ? 'steel' : 'muted'}`}>${this.state.priTouched ? 'Moniqr replanned your day' : 'Order = importance'}</span>
      </div>
      ${order.map((id, i) => {
        const p = defs[id];
        return html`<div class="pri-row" key=${id}>
          <span class="fs13 muted" style="text-align: right;">${i + 1}</span>
          <div class="col" style="min-width: 0;">
            <div class="row wrap" style="gap: 6px;">
              <span class="fs13 text">${p.title}</span>
              ${p.forgot && html`<span class="forgot">Forgotten?</span>`}
            </div>
            <span class="fs12 muted">${p.note}</span>
          </div>
          <div class="row" style="gap: 2px;">
            <span class="icon-btn sm" title="Move up" onClick=${move(i, -1)}>↑</span>
            <span class="icon-btn sm" title="Move down" onClick=${move(i, 1)}>↓</span>
            <span class="icon-btn sm muted" title="Not a priority" onClick=${drop(id)}>✕</span>
          </div>
        </div>`;
      })}
      <span class="fs11 muted">Reorder to tell Moniqr what matters. It replans your day around this list.</span>
      ${L.big &&
      html`
        <div class="rule"></div>
        <form class="composer" onSubmit=${addPri}>
          <input class="field" value=${this.state.priDraft} onInput=${(e) => this.setState({ priDraft: e.target.value })} placeholder="Add a priority for Moniqr…" />
          <button type="submit" class="btn btn-primary sm">Add</button>
        </form>
        <div class="plan">
          <span class="fs12 steel">Moniqr's plan around this list</span>
          <span class="fs13 text" style="line-height: 1.55;">${plan}</span>
        </div>
        ${dropped.length > 0 &&
        html`
          <span class="fs12 muted">Dropped today</span>
          <div class="row wrap" style="gap: 6px;">
            ${dropped.map(
              (id) => html`<span
                class="restore"
                onClick=${(e) => {
                  e.stopPropagation();
                  this.setState((s) => ({ pri: [...s.pri, id] }));
                }}
                >↺ ${defs[id].title}</span
              >`,
            )}
          </div>
        `}
      `}
    `;
  }

  renderNews(v, L) {
    const { news, newsMore, interests } = v.mock;
    const visible = news.filter((n) => n.topic === 'Breaking' || !this.state.muted[n.topic]);
    if (L.mini) {
      const top = visible[0];
      return html`
        <div class="between"><span class="fs13 bright" style="font-weight: 500;">News for you</span><span class="fs11 muted nowrap">${visible.length + newsMore.length} stories</span></div>
        <span class="fs12 dim clamp2">${top ? `${top.topic} · ${top.title}` : 'Nothing new'}</span>
      `;
    }
    const followed = interests.filter((i) => !this.state.muted[i.label]).map((i) => i.label);
    return html`
      <div class="between">
        <h2 class="card-title">News for you</h2>
        <a
          href="#"
          class="fs12"
          onClick=${(e) => {
            e.preventDefault();
            e.stopPropagation();
            this.setFocus('news');
          }}
          >Edit interests</a
        >
      </div>
      ${visible.map((n) => {
        const breaking = n.topic === 'Breaking';
        return html`<div class="col" style="gap: 2px; padding: 4px 0;">
          <div class="row" style="gap: 6px;">
            <span class="tag" style=${breaking ? on('var(--accent-2)', 'var(--n900)') : on('var(--wash-8)', 'var(--n300)')}>${n.topic}</span>
            <span class="fs11 muted">${n.meta}</span>
          </div>
          <span class="headline link">${n.title}</span>
        </div>`;
      })}
      <span class="fs11 muted">From your interests: ${followed.join(', ') || 'none yet'}</span>
      ${L.big &&
      html`
        <div class="rule"></div>
        ${newsMore.map(
          (n) => html`<div class="col" style="gap: 2px; padding: 4px 0;">
            <div class="row" style="gap: 6px;">
              <span class="tag" style=${on('var(--wash-8)', 'var(--n300)')}>${n.topic}</span>
              <span class="fs11 muted">${n.meta}</span>
            </div>
            <span class="headline">${n.title}</span>
          </div>`,
        )}
        <span class="fs12 muted">Your interests · tap to mute or follow</span>
        <div class="row wrap" style="gap: 6px;">
          ${interests.map((it) => {
            const following = !this.state.muted[it.label];
            return html`<span
              class="pill"
              style=${following ? on('color-mix(in srgb, var(--accent) 55%, transparent)') : on('transparent', 'var(--n500)')}
              onClick=${() => this.setState((s) => ({ muted: { ...s.muted, [it.label]: following } }))}
              >${following ? '✓' : '+'} ${it.label}</span
            >`;
          })}
        </div>
      `}
    `;
  }

  renderMood(v, L) {
    const { mood, energy } = this.state;
    if (L.mini) {
      return html`
        <div class="between"><span class="fs13 bright" style="font-weight: 500;">Mood</span><span class="fs11 muted nowrap">${mood === null ? 'Not logged' : `Logged ${this.moodAt}`}</span></div>
        <span class="fs12 dim clamp2">${mood === null ? 'Tap to do your check-in' : `Feeling ${MOODS[mood].toLowerCase()} today`}</span>
      `;
    }
    const slot = v.hour < 15 ? 'Morning check-in · 1 of 2' : 'Evening check-in · 2 of 2';
    const pickMood = (i) => (e) => {
      e.stopPropagation();
      this.moodAt = `${pad(v.now.getUTCHours())}:${pad(v.now.getUTCMinutes())}`;
      this.setState({ mood: i });
    };
    const trendDays = Array.from({ length: 7 }, (_, i) => DOW[(v.todayIdx + i + 1) % 7][0]);
    const trend = [...v.mock.moodTrend, mood];
    return html`
      <div class="between">
        <h2 class="card-title">How are you feeling?</h2>
        <span class="fs12 muted">${slot}</span>
      </div>
      <div class="moods">
        ${MOODS.map((label, i) => html`<span style=${choice(mood === i)} onClick=${pickMood(i)}>${label}</span>`)}
      </div>
      <span class="fs12 muted">
        ${mood === null ? 'Moniqr uses this to pace your day. Evening check-in at 21:00.' : `Logged ${MOODS[mood].toLowerCase()} at ${this.moodAt}. Thanks.`}
      </span>
      ${L.big &&
      html`
        <div class="rule"></div>
        <span class="fs12 muted">Energy</span>
        <div class="moods">
          ${ENERGY.map((label, i) => html`<span style=${choice(energy === i)} onClick=${() => this.setState({ energy: i })}>${label}</span>`)}
        </div>
        <input class="journal" value=${this.state.journal} onInput=${(e) => this.setState({ journal: e.target.value })} placeholder="Anything on your mind? (optional)" />
        <span class="fs12 muted">Last 7 days</span>
        <div class="trend">
          ${trend.map((val, i) => {
            const isToday = i === 6;
            const bg = isToday
              ? val === null
                ? 'color-mix(in srgb, var(--n100) 10%, transparent)'
                : 'var(--accent-2)'
              : val <= 1
                ? 'color-mix(in srgb, var(--accent-2) 55%, transparent)'
                : 'var(--a300)';
            return html`<div>
              <div class="b" style=${`height: ${val === null ? 6 : (val + 1) * 14}px; background: ${bg};`}></div>
              <span class="fs10 muted">${trendDays[i]}</span>
            </div>`;
          })}
        </div>
        <span class="fs12 dim" style="line-height: 1.5;">${v.mock.moodInsight}</span>
      `}
    `;
  }

  renderPick(v, L) {
    const { picks } = v.mock;
    const idx = (this.dayOfYear(v) + this.state.pickN) % picks.length;
    const pk = picks[idx];
    if (L.mini) {
      return html`
        <div class="between"><span class="fs13 bright" style="font-weight: 500;">${pk.kind}</span></div>
        <span class="fs12 dim clamp2">${pk.text}</span>
      `;
    }
    return html`
      <div class="between" style="align-items: center;">
        <span class="fs12 steel">${pk.kind}</span>
        <span
          class="fs12 dim"
          style="cursor: pointer;"
          onClick=${(e) => {
            e.stopPropagation();
            this.setState((s) => ({ pickN: s.pickN + 1 }));
          }}
          >Shuffle ↻</span
        >
      </div>
      <p class="bright pretty" style="font-size: 17px; line-height: 1.45;">${pk.text}</p>
      <span class="fs12 dim">${pk.sub}</span>
      ${L.big &&
      html`
        <div class="rule"></div>
        <span class="fs12 muted">Jump to</span>
        <div class="row wrap" style="gap: 6px;">
          ${picks.map(
            (p, i) => html`<span
              class="pill"
              style=${i === idx ? on('var(--accent)') : on('var(--wash-6)', 'var(--n300)')}
              onClick=${() => this.setState((s) => ({ pickN: s.pickN + ((i - idx + picks.length) % picks.length) }))}
              >${p.kind}</span
            >`,
          )}
        </div>
        <div class="row wrap" style="gap: 6px;">
          <span class="chip" onClick=${() => this.setState((s) => ({ saved: { ...s.saved, [idx]: true } }))}>
            ${this.state.saved[idx] ? '✓ Saved to Knowledge' : 'Save to Knowledge'}
          </span>
        </div>
      `}
    `;
  }

  dayOfYear(v) {
    return Math.floor((v.now.getTime() - Date.UTC(v.now.getUTCFullYear(), 0, 1)) / DAY_MS);
  }

  renderInbox(v) {
    const { mock } = v;
    const { filter, read, sel } = this.state;
    const shown = mock.mail.filter((m) => filter === 'all' || (filter === 'dec' ? !!m.approveLabel : !m.approveLabel));
    const filters = [
      ['all', 'All'],
      ['dec', `Decisions${v.pending ? ` · ${v.pending}` : ''}`],
      ['fyi', 'Updates'],
    ];
    const m = mock.mail.find((x) => x.id === sel) ?? mock.mail[0];
    const st = v.stateOf(m);
    const [stateLabel, chipBg, chipFg] = STATUS[st];
    const settled = {
      executing: 'Working on it, not yet confirmed',
      completed: `Confirmed by ${m.from}`,
      failed: 'Something went wrong. Nothing was charged.',
      rejected: `${m.from} was told no`,
    }[st];
    return html`
      <section id="inbox" class="col" style="gap: 12px;">
        <div class="between wrap" style="align-items: center; gap: 12px;">
          <div class="row" style="align-items: baseline; gap: 10px;">
            <h2 style="font-size: 20px;">Inbox</h2>
            <span class="fs13 muted">${v.pending} need a decision · ${v.unread} unread</span>
          </div>
          <div class="filters">
            ${filters.map(
              ([id, label]) => html`<span
                style=${filter === id ? on('color-mix(in srgb, var(--n100) 10%, transparent)') : on('transparent', 'var(--n400)')}
                onClick=${() => this.setState({ filter: id })}
                >${label}</span
              >`,
            )}
          </div>
        </div>
        <div class="inbox">
          <div class="mail-list">
            ${shown.map((x) => {
              const xs = v.stateOf(x);
              const unread = !read[x.id] && x.id !== sel;
              const showTag = xs !== 'fyi';
              return html`<div class=${`mail${x.id === sel ? ' sel' : ''}`} key=${x.id} onClick=${() => this.openMail(x.id)}>
                <span class="dot" style=${`background: ${unread ? 'var(--accent-2)' : 'transparent'};`}></span>
                <div class="col" style="gap: 1px; min-width: 0;">
                  <div class="row" style="min-width: 0;">
                    <span class="fs13 dim nowrap">${x.from}</span>
                    ${showTag && html`<span class="mail-tag" style=${on(STATUS[xs][1], STATUS[xs][2])}>${STATUS[xs][0]}</span>`}
                  </div>
                  <span class="fs14 ellipsis" style=${`color: ${unread ? 'var(--n100)' : 'var(--n300)'}; font-weight: ${unread ? 500 : 400};`}>${x.subject}</span>
                  <span class="fs13 muted ellipsis">${x.preview}</span>
                </div>
                <span class="fs12 muted nowrap">${x.time}</span>
              </div>`;
            })}
          </div>
          <div class="reader">
            <div class="row wrap" style="gap: 10px;">
              <span class="avatar">${m.from[0]}</span>
              <div class="col grow">
                <span class="fs14 text">${m.from}</span>
                <span class="fs12 muted">${m.time} · to you</span>
              </div>
              <span class="fs12 nowrap" style=${`padding: 3px 10px; border-radius: 10px; ${on(chipBg, chipFg)}`}>${stateLabel}</span>
            </div>
            <h3>${m.subject}</h3>
            <p class="fs14 soft pretty" style="line-height: 1.65;">${m.body}</p>
            ${m.facts?.length > 0 &&
            html`<div class="facts">
              ${m.facts.map(([k, val]) => html`<div><span class="fs12 muted">${k}</span><span class="fs13 text">${val}</span></div>`)}
            </div>`}
            ${m.deals &&
            html`<div class="col">
              ${mock.deals.map(
                (d) => html`<div class="deal">
                  <div class="col" style="flex: 1 1 200px; min-width: 0;">
                    <span class="fs14 text">${d.brand} · ${d.offer}</span>
                    <span class="fs12 muted">${d.why} · ${d.ends}</span>
                  </div>
                  <button class="btn btn-secondary sm nowrap" onClick=${() => this.setState((s) => ({ deals: { ...s.deals, [d.id]: true } }))}>
                    ${this.state.deals[d.id] ? '✓ Reminder set' : 'Remind me'}
                  </button>
                </div>`,
              )}
            </div>`}
            <div style="flex: 1;"></div>
            ${st === 'pending' &&
            html`<div class="row wrap">
              <button class="btn btn-primary" style="padding: 8px 16px;" onClick=${() => this.approve(m.id)}>${m.approveLabel}</button>
              <button class="btn btn-secondary" style="padding: 8px 16px;" onClick=${() => this.setAp(m.id, 'rejected')}>Decline</button>
              <button class="btn btn-ghost" onClick=${() => this.send(`Tell me more about: ${m.subject}`)}>Ask Moniqr</button>
            </div>`}
            ${m.approveLabel &&
            st !== 'pending' &&
            html`<div class="row" style="gap: 10px;">
              <span class="fs13 dim">${settled}</span>
              ${(st === 'rejected' || st === 'failed') &&
              html`<button class="btn btn-ghost" onClick=${() => (st === 'failed' ? this.approve(m.id) : this.setAp(m.id, 'pending'))}>
                ${st === 'failed' ? 'Retry' : 'Undo'}
              </button>`}
            </div>`}
          </div>
        </div>
      </section>
    `;
  }

  renderGlance(v) {
    const g = v.mock.glance;
    const td = this.state.today;
    const protein = td.protein ? g.proteinTarget : g.proteinSoFar;
    const sessions = v.mock.habits.find((h) => h.id === 'gym')?.days.length ?? 0;
    const tiles = [
      ['Sleep', g.sleep, g.sleepPct, g.sleepNote],
      ['Training', 'Upper body', td.gym ? 100 : 75, td.gym ? `Done · ${sessions} of ${sessions} this week` : `09:00 · ${sessions - 1} of ${sessions} this week`],
      ['Protein', `${protein} / ${g.proteinTarget}g`, Math.round((protein / g.proteinTarget) * 100), 'Breakfast logged'],
      ['Steps', g.steps.toLocaleString('en-AU'), Math.round(g.steps / 100), 'of 10,000 · shift adds ~8k'],
    ];
    return html`
      <section class="glance">
        ${tiles.map(
          ([label, value, pct, note]) => html`<div class="tile">
            <span class="fs12 muted">${label}</span>
            <span class="v">${value}</span>
            <div class="bar"><div style=${`width: ${pct}%;`}></div></div>
            <span class="fs12 dim">${note}</span>
          </div>`,
        )}
      </section>
    `;
  }

  renderCalendar(v) {
    const { ap } = this.state;
    const gridH = `${(H1 - H0) * PX}px`;
    const hours = [];
    for (let h = H0 + 1; h < H1; h++) hours.push({ top: `${(h - H0) * PX}px`, label: h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM` });
    const first = v.week[0];
    const last = v.week[6];
    const title =
      first.getUTCMonth() === last.getUTCMonth()
        ? `${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()}`
        : `${MONTHS[first.getUTCMonth()]} – ${MONTHS[last.getUTCMonth()]} ${last.getUTCFullYear()}`;
    const events = v.mock.events
      .filter((e) => !e.mailId || ap[e.mailId] !== 'rejected')
      .map((e) => ({ ...e, kind: e.mailId && ap[e.mailId] !== 'completed' ? 'pend' : e.kind }));
    const nowTop = `${(Math.min(Math.max(v.hour, H0), H1) - H0) * PX}px`;
    const swatch = (c) => `background: ${c.bg}; border-style: ${c.line}; border-color: ${c.border === 'transparent' ? c.bg : c.border};`;
    const picked = this.state.pick;
    return html`
      <section class="col" style="gap: 12px;">
        <div class="row wrap" style="gap: 10px;">
          <button class="btn btn-secondary" style="border-radius: 18px; padding: 6px 16px;">Today</button>
          <h2 style="font-weight: 400; font-size: 20px;">${title}</h2>
          <div style="flex: 1;"></div>
          <div class="row wrap fs12 dim" style="gap: 12px;">
            ${Object.values(EV_STYLE).map((c) => html`<span class="row nowrap" style="gap: 6px;"><span class="swatch" style=${swatch(c)}></span>${c.label}</span>`)}
          </div>
        </div>
        <div class="cal-scroll">
          <div class="cal">
            <div class="cal-row">
              <span></span>
              ${v.week.map((d, i) => {
                const today = i === v.todayIdx;
                return html`<div class="cal-day">
                  <span class="fs11" style=${`letter-spacing: 0.04em; color: ${today ? 'var(--accent-2)' : 'var(--n500)'};`}>${DOW[i].toUpperCase()}</span>
                  <span class="cal-num" style=${today ? on('var(--accent-2)', 'var(--n900)') : on('transparent', 'var(--n200)')}>${d.getUTCDate()}</span>
                </div>`;
              })}
            </div>
            <div class="cal-row all-day">
              <span class="fs10 muted" style="text-align: right; padding: 4px 8px 0 0;">all day</span>
              ${v.week.map(
                (_, i) => html`<div class="col" style="gap: 2px; padding: 0 3px;">
                  ${v.mock.allDay.filter((a) => a.day === i).map((a) => html`<span class="all-day-ev">${a.title}</span>`)}
                </div>`,
              )}
            </div>
            <div class="cal-row">
              <div style=${`position: relative; height: ${gridH};`}>
                ${hours.map((h) => html`<span class="hour" style=${`top: ${h.top};`}>${h.label}</span>`)}
              </div>
              ${v.week.map(
                (d, i) => html`<div
                  class="day-col"
                  style=${`height: ${gridH}; background: ${i === v.todayIdx ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent'};`}
                >
                  ${hours.map((h) => html`<span class="hour-line" style=${`top: ${h.top};`}></span>`)}
                  ${events
                    .filter((e) => e.day === i)
                    .map((e) => {
                      const c = EV_STYLE[e.kind];
                      const time = `${hhmm(e.start)}–${hhmm(e.start + e.hours)}`;
                      const pick = () =>
                        this.setState({
                          pick: {
                            title: e.title,
                            time,
                            dayLabel: `${DOW[i]} ${d.getUTCDate()}`,
                            note: e.kind === 'pend' ? `Awaiting your decision${e.note ? ` · ${e.note}` : ''}` : e.note,
                            swatch: swatch(c),
                          },
                        });
                      return html`<div
                        class="ev"
                        onClick=${pick}
                        style=${`top: ${(e.start - H0) * PX}px; height: ${Math.max(e.hours * PX - 2, 18)}px; background: ${c.bg}; border-style: ${c.line}; border-color: ${c.border}; color: ${c.fg};`}
                      >
                        <b>${e.title}</b><span>${time}</span>
                      </div>`;
                    })}
                  ${i === v.todayIdx && html`<div class="now" style=${`top: ${nowTop};`}></div>`}
                </div>`,
              )}
            </div>
          </div>
        </div>
        ${picked &&
        html`<div class="row wrap tile" style="gap: 12px; padding: 12px 16px; border-radius: 12px;">
          <span class="swatch" style=${picked.swatch}></span>
          <span class="fs14 bright">${picked.title}</span>
          <span class="fs13 dim">${picked.dayLabel} · ${picked.time}</span>
          <span class="fs13 muted grow">${picked.note}</span>
          <span class="fs13 muted" style="cursor: pointer;" onClick=${() => this.setState({ pick: null })}>Close</span>
        </div>`}
      </section>
    `;
  }

  renderHabits(v) {
    const td = this.state.today;
    const done = v.mock.habits.filter((h) => td[h.id]).length;
    return html`
      <section class="tile panel">
        <div class="between"><h2 class="card-title">Habits</h2><span class="fs12 muted">${done} of ${v.mock.habits.length} today</span></div>
        <div class="habits">
          <span></span>
          ${DOW.map((d, i) => html`<span class="fs10" style=${`text-align: center; color: ${i === v.todayIdx ? 'var(--accent-2)' : 'var(--n500)'};`}>${d[0]}</span>`)}
        </div>
        ${v.mock.habits.map(
          (h) => html`<div class="habits">
            <span class="fs13 soft">${h.name}</span>
            ${DOW.map((_, i) =>
              i === v.todayIdx
                ? html`<span
                    class="cell today"
                    title=${td[h.id] ? 'Done' : 'Mark done'}
                    style=${`background: ${td[h.id] ? 'var(--accent)' : 'transparent'};`}
                    onClick=${() => this.setState((s) => ({ today: { ...s.today, [h.id]: !s.today[h.id] } }))}
                  ></span>`
                : html`<span class="cell" style=${`background: ${h.days.includes(i) ? 'var(--wash-6)' : 'transparent'};`}></span>`,
            )}
          </div>`,
        )}
      </section>
    `;
  }

  renderMeals(v) {
    const { meals } = v.mock;
    return html`
      <section class="tile panel">
        <div class="between"><h2 class="card-title">Food today</h2><span class="fs12 muted">${meals.planned}</span></div>
        ${meals.items.map(
          (m) => html`<div class="between">
            <div class="col" style="min-width: 0;">
              <span class="fs13 text">${m.name}</span>
              <span class="fs12 muted">${m.slot} · ${m.macros}</span>
            </div>
            <span class=${`fs12 nowrap ${m.logged ? 'coral' : 'muted'}`}>${m.logged ? 'Logged' : 'Planned'}</span>
          </div>`,
        )}
      </section>
    `;
  }

  renderPeople(v) {
    return html`
      <section class="tile panel">
        <h2 class="card-title">People</h2>
        ${v.mock.people.map(
          (p) => html`<div style="display: grid; grid-template-columns: 34px 1fr; gap: 8px;">
            <span class="fs12 coral" style="padding-top: 1px;">${p.when}</span>
            <div class="col" style="min-width: 0;"><span class="fs13 text">${p.title}</span><span class="fs12 muted">${p.note}</span></div>
          </div>`,
        )}
      </section>
    `;
  }

  renderMarkets(v) {
    const finance = this.state.data.links.find((l) => l.name === 'Finance')?.url;
    return html`
      <section class="tile panel" style="gap: 8px;">
        <div class="between"><h2 class="card-title">Markets this week</h2><a class="fs12" href=${finance}>Your portfolio is in Finance</a></div>
        ${v.mock.markets.map(
          (m) => html`<div style="display: grid; grid-template-columns: 52px 1fr auto; gap: 10px; align-items: baseline;">
            <span class="fs12 muted">${m.when}</span>
            <span class="fs13 text">${m.title}</span>
            <span class="fs11 dim" style="padding: 1px 8px; border-radius: 9px; background: color-mix(in srgb, var(--n100) 7%, transparent);">${m.kind}</span>
          </div>`,
        )}
      </section>
    `;
  }

  renderProjects(v) {
    const stack = this.state.data.links.find((l) => l.name === 'Stack')?.url;
    return html`
      <section class="tile panel">
        <div class="between"><h2 class="card-title">Projects</h2><a class="fs12" href=${stack}>All projects</a></div>
        ${v.mock.projects.map(
          (p) => html`<div class="col" style="gap: 5px;">
            <div class="between" style="gap: 10px;">
              <span class="fs13 text">${p.name} <span class="muted">· ${p.next}</span></span>
              <span class=${`fs12 nowrap ${p.warn ? 'coral' : 'muted'}`}>${p.due}</span>
            </div>
            <div class="bar"><div style=${`width: ${p.pct}%;`}></div></div>
          </div>`,
        )}
      </section>
    `;
  }

  renderBriefing(v) {
    const { data } = this.state;
    const { brief } = data;
    const fallback = v.mock.briefing;
    const busy = this.state.posting || data.busy;
    const back = () => this.openView('hq');
    const today = v.mock.events.filter((e) => e.day === v.todayIdx);
    return html`
      <main class="main">
        <article class="briefing">
          <div class="col" style="gap: 10px;">
            <button class="btn btn-ghost" style="align-self: flex-start;" onClick=${back}>← Back to HQ</button>
            ${brief
              ? html`<span class="fs13 muted">${brief.kind} · prepared by Moniqr ${brief.when}</span>
                  <h1>${brief.summary || 'Your brief'}</h1>`
              : html`<span class="fs13 muted">No brief from the EA yet · sample briefing</span>
                  <h1>${fallback.title}</h1>
                  <p class="lede">${fallback.lede}</p>`}
          </div>
          ${brief
            ? html`<section class="brief-md" dangerouslySetInnerHTML=${{ __html: brief.html }}></section>`
            : html`
                <section class="col" style="gap: 10px;">
                  <h2>Your day</h2>
                  ${today.map((e) => html`<div class="line"><span class="fs14 muted">${hhmm(e.start)}</span><span>${e.title}${e.note && html` <span class="muted">· ${e.note}</span>`}</span></div>`)}
                </section>
                <section class="col" style="gap: 10px;">
                  <h2>Health and habits</h2>
                  <p class="fs15 soft" style="line-height: 1.7;">${fallback.health}</p>
                </section>
                <section class="col" style="gap: 10px;">
                  <h2>People</h2>
                  ${v.mock.people.map((p) => html`<div class="line"><span class="fs14 coral">${p.when}</span><span>${p.title} <span class="muted">· ${p.note}</span></span></div>`)}
                </section>
                <section class="col" style="gap: 10px;">
                  <h2>Deals from your inbox</h2>
                  ${v.mock.deals.map((d) => html`<div class="line" style="grid-template-columns: 96px 1fr;"><span class="fs14 dim">${d.brand}</span><span>${d.offer} <span class="muted">· ${d.why} · ${d.ends}</span></span></div>`)}
                </section>
              `}
          <section class="col" style="gap: 10px;">
            <h2>Executive Assistant</h2>
            ${data.agentsError && html`<p class="fs14 coral">The agent service isn't reachable right now.</p>`}
            <div class="row wrap">
              <button class="btn btn-primary" disabled=${busy} onClick=${() => this.runEa('morning_brief')}>${busy ? 'EA is running…' : 'Run EA now'}</button>
              <button class="btn btn-secondary" disabled=${busy} onClick=${() => this.runEa('test')}>Plumbing test</button>
            </div>
            ${data.runs.length === 0
              ? html`<p class="fs14 muted">No runs yet.</p>`
              : html`<div>
                  ${data.runs.map(
                    (r) => html`<div class="run" key=${r.id}>
                      <span class=${`status ${r.status}`}>${r.status}</span>
                      <span>${r.kind}</span>
                      <span class="muted">${r.when}</span>
                      ${r.error && html`<span class="error">${r.error}</span>`}
                    </div>`,
                  )}
                </div>`}
          </section>
          <div class="row wrap">
            <button class="btn btn-primary" onClick=${() => this.send('Walk me through this briefing')}>Ask Moniqr about this</button>
            <button class="btn btn-secondary" onClick=${back}>Back to HQ</button>
          </div>
        </article>
      </main>
    `;
  }

  renderAssistant(v) {
    const { data, thinking } = this.state;
    const status = thinking ? 'drafting…' : data.busy ? 'running the EA…' : `coordinating ${v.workforce.length} agents`;
    const submit = (e) => {
      e.preventDefault();
      this.send(this.state.draft);
    };
    return html`
      <aside class="assistant">
        <div class="row" style="gap: 10px; padding: 16px 18px;">
          <span class="m-mark">M</span>
          <div class="col grow">
            <span class="fs15 bright" style="font-weight: 500;">Moniqr</span>
            <span class="fs12 muted">Executive Assistant · ${status}</span>
          </div>
          <span class="icon-btn" title="Collapse panel" onClick=${() => this.setState({ collapsed: true })}>→</span>
        </div>
        <div class="msgs">
          ${this.state.messages.map((m) => html`<div class=${`bubble ${m.me ? 'me' : 'them'}`}>${m.text}</div>`)}
          ${thinking && html`<span class="fs13 muted">Moniqr is drafting…</span>`}
        </div>
        <div class="col" style="gap: 10px; padding: 14px 18px 18px;">
          <div class="row wrap" style="gap: 6px;">
            ${v.mock.chat.suggestions.map((s) => html`<span class="chip" style="border-radius: 14px; padding: 5px 12px;" onClick=${() => this.send(s)}>${s}</span>`)}
          </div>
          <form class="composer" style="padding: 5px; border-radius: 12px;" onSubmit=${submit}>
            <input class="field" style="font-size: 14px;" value=${this.state.draft} onInput=${(e) => this.setState({ draft: e.target.value })} placeholder="Delegate, ask, or plan…" />
            <button type="submit" class="btn btn-primary" style="border-radius: 8px; padding: 6px 14px;">Send</button>
          </form>
        </div>
      </aside>
    `;
  }
}

const root = document.getElementById('app');
root.textContent = '';
render(html`<${App} />`, root);
