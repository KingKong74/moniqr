// HQ, the moniqr.com homepage. A port of the Personal OS HQ v4 design to Preact + htm, loaded as
// one ES module so there's no build step. The server sends everything to draw from /api/hq:
// live briefs, runs, calendar, findings and proposal decisions, plus sample lifestyle content
// (data.mock). Enabled calendar proposals create events only after owner approval;
// manual/record-only choices never execute. Chat, priorities, mood and habits are samples.
import { Component, html, render } from '/vendor/preact-htm.js';
import { calendarLayers, calendarDayLayout } from './calendar-overlay.js';
import { projectSamples, financeSamples } from './dashboard-mocks.js';

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

// Calendar geometry: the full day at 26px an hour.
const H0 = 0;
const H1 = 24;
const PX = 26;
const SLIDE_SECONDS = 8;
const POLL_MS = 5000;

const EV_STYLE = {
  gym: { bg: 'var(--accent)', border: 'var(--accent)', line: 'solid', fg: 'var(--n100)', label: 'Training' },
  work: { bg: 'color-mix(in srgb, var(--n100) 16%, transparent)', border: 'transparent', line: 'solid', fg: 'var(--n100)', label: 'Work' },
  life: { bg: 'color-mix(in srgb, var(--accent-2) 30%, transparent)', border: 'transparent', line: 'solid', fg: 'var(--n100)', label: 'Google event' },
  pend: { bg: 'color-mix(in srgb, var(--a400) 14%, transparent)', border: 'var(--a400)', line: 'dashed', fg: 'var(--a200)', label: 'Moniqr request' },
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
    projectFilter: 'All',
    chatOpen: false,
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
  chatInputRef = (el) => (this.chatInputEl = el);
  chatButtonRef = (el) => (this.chatButtonEl = el);
  chatMessagesRef = (el) => (this.chatMessagesEl = el);

  componentDidMount() {
    this.load();
    this.clock = setInterval(() => this.setState({ now: Date.now() }), 30_000);
    this.onKey = (e) => {
      if (e.key === 'Escape' && this.state.chatOpen) this.setState({ chatOpen: false });
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
    const seq = this.loadSeq = (this.loadSeq ?? 0) + 1;
    try {
      const res = await fetch('/api/hq', { headers: { accept: 'application/json' } });
      // Session expired or signed out in another tab: back to the login page, then here.
      if (res.status === 401) return void location.assign('/login');
      if (!res.ok) throw new Error(`HQ data returned ${res.status}`);
      const data = await res.json();
      if (seq !== this.loadSeq) return;
      const first = !this.state.data;
      this.setState(first ? { data, ...this.seed(data.mock) } : { data, loadError: false }, () => {
        if (first) this.startBar();
      });
      this.poll = setTimeout(() => this.load(), data.busy ? POLL_MS : 60_000);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      console.error(err);
      this.setState({ loadError: true });
      this.poll = setTimeout(() => this.load(), 60_000);
    }
  }

  /** Page state that starts from the placeholder content. */
  seed(mock) {
    return {
      ap: {},
      read: {},
      sel: null,
      pri: mock.priorities.map((p) => p.id),
      messages: mock.chat.opening,
      muted: Object.fromEntries(mock.interests.map((i) => [i.label, !i.on])),
    };
  }

  async runEa(kind) {
    this.setState({ posting: true, runError: '' });
    try {
      const res = await fetch('/run', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ kind }),
      });
      if (!res.ok) throw new Error(`Run request returned ${res.status}`);
    } catch (err) {
      console.error(err);
      this.setState({ runError: 'The EA could not be started. Please try again.' });
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
    if (prev.chatOpen !== this.state.chatOpen) {
      if (this.state.chatOpen) this.chatInputEl?.focus();
      else this.chatButtonEl?.focus();
    }
    if (this.state.chatOpen && (!prev.chatOpen || prev.messages !== this.state.messages || prev.thinking !== this.state.thinking)) {
      this.chatMessagesEl?.scrollTo({ top: this.chatMessagesEl.scrollHeight });
    }
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

  // — chat (sample behaviour) —

  send(text) {
    if (!text.trim()) return;
    const { chat } = this.state.data.mock;
    this.setState((s) => ({ messages: [...s.messages, { me: true, text }], draft: '', thinking: true, chatOpen: true }));
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
              ${this.state.view === 'hq' ? this.renderHq(v) : this.state.view === 'projects' ? this.renderProjectDashboard() : this.state.view === 'finance' ? this.renderFinanceDashboard() : this.renderBriefing(v)}
            </div>
          </div>
        </div>
        ${this.state.chatOpen && this.renderAssistant(v)}
        <button type="button" class="chat-launcher" ref=${this.chatButtonRef}
          aria-label=${this.state.chatOpen ? 'Close Moniqr chat' : 'Open Moniqr chat'}
          aria-expanded=${this.state.chatOpen} aria-controls="moniqr-chat"
          onClick=${() => this.setState((s) => ({ chatOpen: !s.chatOpen }))}>
          <span class="m-mark" aria-hidden="true">M</span><span>${this.state.chatOpen ? 'Close chat' : 'Chat'}</span>
        </button>
      </div>
    `;
  }

  /** Values several sections share. */
  derive() {
    const { data } = this.state;
    const mock = { ...data.mock, mail: [], events: [], allDay: [], upNext: { title: 'No upcoming events', note: 'Google Calendar' } };
    const now = brisbane(this.state.now);
    const todayIdx = dowOf(now);
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - todayIdx * DAY_MS);
    const week = DOW.map((_, i) => new Date(monday.getTime() + i * DAY_MS));
    const weekStart = monday.getTime() - 10 * 3_600_000;
    const originalCalendar = data.calendar ?? { status: 'disconnected', events: [] };
    const layers = calendarLayers(originalCalendar.events, data.actions.items, this.state.showRequests !== false);
    const calendar = { ...originalCalendar, events: layers.events };
    for (const event of [...calendar.events, ...layers.requests]) {
      if (event.response === 'declined') continue;
      const start = event.allDay ? Date.parse(event.start + 'T00:00:00+10:00') : Date.parse(event.start);
      const end = event.allDay ? Date.parse(event.end + 'T00:00:00+10:00') : Date.parse(event.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      for (let day = 0; day < 7; day++) {
        const dayStart = weekStart + day * DAY_MS;
        if (start >= dayStart + DAY_MS || end <= dayStart) continue;
        if (event.allDay) mock.allDay.push({ day, title: event.title });
        else mock.events.push({
          day, start: (Math.max(start, dayStart) - dayStart) / 3_600_000,
          hours: (Math.min(end, dayStart + DAY_MS) - Math.max(start, dayStart)) / 3_600_000,
          title: event.title, kind: event.overlay ? 'pend' : 'life', overlay: !!event.overlay, actionId: event.actionId,
          note: [event.calendar, event.location].filter(Boolean).join(' · '),
        });
      }
    }
    const next = calendar.events.filter((e) => e.response !== 'declined' && !e.allDay && Date.parse(e.end) > this.state.now)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    if (next) mock.upNext = { title: next.title, note: new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Brisbane', weekday: 'short', hour: 'numeric', minute: '2-digit',
    }).format(new Date(next.start)) + (next.location ? ' · ' + next.location : '') };
    else if (calendar.status !== 'connected') mock.upNext = {
      title: calendar.status === 'error' ? 'Calendar unavailable' : 'Calendar not connected',
      note: calendar.status === 'error' ? 'Trying again automatically' : 'Connect Google Calendar',
    };
    const pending = data.actionsError ? 0 : data.actions.pending - (data.actions.demo_pending ?? 0);
    const unread = data.findings.items.filter((f) => f.status === 'new').length;
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
    return { mock, now, todayIdx, week, hour, pending, unread, workforce };
  }

  renderNav(v) {
    const items = [
      { label: 'HQ', view: 'hq', go: () => this.openView('hq') },
      { label: 'Inbox', badge: v.unread || '', go: () => { this.openView('hq'); this.later(() => document.getElementById('inbox')?.scrollIntoView({ behavior: 'smooth' }), 0); } },
      { label: 'Projects', view: 'projects', go: () => this.openView('projects') },
      { label: 'Finance', view: 'finance', go: () => this.openView('finance') },
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
              : html`<button type="button" class=${`nav-item${n.view === this.state.view ? ' on' : ''}${n.go ? '' : ' soon'}`} onClick=${n.go} disabled=${!n.go} aria-current=${n.view === this.state.view ? 'page' : null} title=${n.go ? null : 'Not built yet'}>
                  <span class="grow">${n.label}</span>
                  ${n.badge ? html`<span class="badge">${n.badge}</span>` : null}
                </button>`,
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
          <span class="text">HQ</span><span>/</span><span>${({ hq: 'Command centre', projects: 'Projects', finance: 'Finance', briefing: 'Daily briefing' })[this.state.view]}</span>
        </div>
        <div style="flex: 1; display: flex; justify-content: center;">
          <form class="search" onSubmit=${onSearch}>
            <input ref=${this.searchRef} name="q" placeholder="Ask Moniqr, search, or run a command" autocomplete="off" />
            <span class="kbd">⌘K</span>
          </form>
        </div>
        <span class="sample" title="The brief, calendar, email findings, proposal decisions, EA runs and links are live. Lifestyle cards and chat are samples.">Some sample cards</span>
        <span class="clock fs13 muted nowrap">${clock}</span>
        <form method="post" action="/logout" class="signout">
          <button type="submit" class="signout-btn fs12" title=${`Signed in as ${this.state.data?.email ?? ''}`}>Sign out</button>
        </form>
      </header>
    `;
  }

  renderHq(v) {
    return html`
      <main class="main">
        <section class="col" style="gap: 10px;" aria-label="Live Executive Assistant">
          <h2>Executive Assistant</h2>
          <p class="fs14 muted">Generate a brief from your connected email and calendars. Calendar events and email findings are live; lifestyle cards and chat contain sample data.</p>
          ${this.state.data.agentsError && html`<p class="fs14 coral">The agent service isn't reachable right now.</p>`}
          <div class="row wrap">
            <button class="btn btn-primary" disabled=${this.state.posting || this.state.data.busy || this.state.data.agentsError} onClick=${() => { this.openView('briefing'); this.runEa('morning_brief'); }}>${this.state.posting || this.state.data.busy ? 'EA is running…' : 'Run EA now'}</button>
            <button class="btn btn-secondary" onClick=${() => this.openView('briefing')}>View brief and run status</button>
          </div>
        </section>
        <div class="hero">${this.renderCarousel(v)} ${this.renderDecision(v)}</div>
        ${this.renderFocusCards(v)} ${this.renderActions()} ${this.renderInbox(v)} ${this.renderGlance(v)} ${this.renderCalendar(v)}
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
    return html`<section class="decision col" style="gap: 12px;">
      <span class="fs12 steel">Your decisions</span>
      <h2>${this.state.data.actionsError ? 'Action review unavailable' : v.pending ? `${v.pending} proposal${v.pending === 1 ? '' : 's'} to review` : 'No pending proposals'}</h2>
      <p class="fs14 soft">Inspect the source and details before deciding. Calendar proposals explicitly enabled for creation add an event after approval; manual suggestions stay yours to carry out.</p>
      <button class="btn btn-secondary" onClick=${() => document.getElementById('actions')?.scrollIntoView({ behavior: 'smooth' })}>Review proposals</button>
    </section>`;
  }

  openProposal(id) {
    this.setState({ actionSel: id, actionFilter: 'all', actionHistory: null, actionError: '', pick: null }, () => {
      document.getElementById('actions')?.scrollIntoView({ behavior: 'smooth' });
      document.querySelector('#actions article')?.focus({ preventScroll: true });
    });
  }

  async calendarOperation(a, operation) {
    if (this.state.actionSaving) return;
    if (operation === 'undo' && !window.confirm(`Remove the Moniqr-created event “${a.proposed_action?.calendar?.title}” from your main calendar?`)) return;
    this.setState({ actionSaving: true, actionError: '', actionNotice: '', actionHistory: null });
    try {
      const r = await fetch(`/actions/${a.id}/${operation}`, { method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ revision: String(a.revision) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'The calendar operation could not be confirmed.');
      this.applyActionResult(d.action, operation === 'prepare' ? 'Calendar creation is enabled for this proposal. Review the new revision and approve it to create the event.'
        : this.calendarResult(d.action));
    } catch (err) { this.setState({ actionError: err.message }); }
    finally { await this.load(); this.setState({ actionSaving: false }); }
  }

  applyActionResult(action, notice) {
    this.setState(s => {
      if (!action) return { actionNotice: notice };
      const old = s.data.actions.items.find(a => a.id === action.id);
      return { actionNotice: notice, data: { ...s.data, actions: { ...s.data.actions,
        pending: Math.max(0, s.data.actions.pending + (action.status === 'pending' ? 1 : 0) - (old?.status === 'pending' ? 1 : 0)),
        demo_pending: Math.max(0, (s.data.actions.demo_pending ?? 0) + (action.source_snapshot?.demo && action.status === 'pending' ? 1 : 0) - (old?.source_snapshot?.demo && old.status === 'pending' ? 1 : 0)),
        items: s.data.actions.items.map(a => a.id === action.id ? action : a),
      } } };
    });
  }

  calendarResult(a) {
    return a?.execution_status === 'succeeded' ? 'Confirmed: the event is on your main Google calendar.'
      : a?.execution_status === 'undone' ? 'Undo confirmed: the Moniqr-created event is no longer on your calendar.'
      : a?.execution_status === 'uncertain' || a?.execution_status === 'undo_uncertain' ? 'Google has not confirmed the result. Use Check result before taking further action.'
      : a?.execution_status === 'failed' ? `The calendar event was not created. ${a.execution_error || 'Please check the details.'}`
      : 'Your choice was recorded. No external action was taken.';
  }

  async decideProposal(action, decision) {
    if (this.state.actionSaving) return;
    this.setState({ actionSaving: true, actionError: '', actionNotice: '', actionHistory: null });
    try {
      const r = await fetch(`/actions/${action.id}/decision`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ decision, revision: String(action.revision) }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? 'Your decision could not be saved. Please try again.');
      }
      const result = r.status === 204 ? null : (await r.json()).action;
      this.applyActionResult(result, decision === 'approved' && result?.execution_mode === 'enabled' ? this.calendarResult(result) : decision === 'approved'
        ? `Approval recorded for “${action.title}” (revision ${action.revision}). Nothing was executed or queued; manual steps are yours to carry out.`
        : `Rejection recorded for “${action.title}” (revision ${action.revision}). No external action was taken.`);
    } catch (err) { this.setState({ actionError: err.message }); }
    finally { await this.load(); this.setState({ actionSaving: false }); }
  }

  async showActionHistory(id) {
    this.setState({ actionHistory: null, actionError: '' });
    try {
      const r = await fetch(`/api/actions/${id}`);
      if (!r.ok) throw new Error('Decision history could not load. Please try again.');
      const d = await r.json();
      this.setState({ actionHistory: { id, revision: d.action.revision, events: d.events } });
    } catch (err) { this.setState({ actionError: err.message }); }
  }

  renderActions() {
    const { data, actionSel, actionSaving, actionError, actionNotice, actionHistory } = this.state;
    const filter = this.state.actionFilter ?? 'pending';
    const actions = data.actions;
    const shown = actions.items.filter((a) => filter === 'all' || a.status === filter);
    const a = shown.find((x) => x.id === actionSel) ?? shown[0];
    const labels = { pending: 'Needs review', approved: 'Approval recorded', rejected: 'Rejected', expired: 'Expired' };
    const when = (iso) => iso ? new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(iso)) : 'Not specified';
    const payload = a?.proposed_action;
    const source = a?.source_snapshot ?? {};
    const history = a && actionHistory?.id === a.id && actionHistory.revision === a.revision ? actionHistory.events : null;
    return html`<section id="actions" class="col" style="gap: 12px;">
      <div class="between wrap" style="gap: 12px;"><h2 style="font-size: 20px;">Action review</h2>
        <span class="fs13 muted">${data.actionsError ? 'Unavailable' : `${actions.pending - (actions.demo_pending ?? 0)} awaiting review${actions.demo_pending ? ` · ${actions.demo_pending} demo requests` : ''}`}</span></div>
      <p class="fs12 muted">Only calendar proposals labelled “Creates an event after approval” can write to your main calendar. Manual plans and earlier record-only decisions never execute.</p>
      ${!actions.calendar_write_ready && html`<p class="fs13 dim">Calendar creation needs Google write permission. You can still review requests and see their overlay.</p>`}
      ${data.actionsError && html`<p class="fs13 coral" role="alert">Proposals could not load. Retrying automatically.</p>`}
      ${actionError && html`<p class="fs13 coral" role="alert">${actionError}</p>`}
      ${actionNotice && html`<p class="fs13 steel" role="status">${actionNotice}</p>`}
      <div class="filters" role="group" aria-label="Filter proposals">
        ${['pending', 'approved', 'rejected', 'expired', 'all'].map((id) => html`<button class="btn btn-ghost sm"
          aria-pressed=${filter === id} style=${filter === id ? on('var(--wash-8)') : ''}
          onClick=${() => this.setState({ actionFilter: id, actionHistory: null, actionError: '' })}>${id === 'all' ? 'All' : id === 'approved' ? 'Approved' : labels[id]}</button>`)}
      </div>
      ${actions.total > actions.items.length && html`<p class="fs12 muted">Showing ${actions.items.length} of ${actions.total} proposals, with pending proposals first.</p>`}
      ${!shown.length ? html`<div class="tile panel"><p class="fs14 soft">${data.actionsError ? 'Proposal state is unknown.' : 'No proposals in this view.'}</p></div>` : html`
        <div class="inbox">
          <div class="mail-list" aria-label="Action proposals">
            ${shown.map((x) => html`<button class=${`mail finding-row${x.id === a.id ? ' sel' : ''}`} key=${x.id}
              aria-pressed=${x.id === a.id} onClick=${() => this.setState({ actionSel: x.id, actionHistory: null, actionError: '' })}>
              <span class="dot" style=${`background: ${x.status === 'pending' ? 'var(--accent-2)' : 'transparent'};`}></span>
              <span class="col" style="gap: 4px; min-width: 0;"><span class="fs12 muted">${x.kind === 'manual' ? 'Manual step' : 'Calendar proposal'} · ${labels[x.status]}</span>
                <span class="fs14 text ellipsis">${x.title}</span><span class="fs13 muted ellipsis">${x.detail}</span></span>
            </button>`)}
          </div>
          <article class="reader" aria-label="Proposal details" tabindex="-1">
            <span class="fs12 steel">${labels[a.status]} · Revision ${a.revision}</span>
            ${a.source_snapshot?.demo && html`<span class="fs13 steel">Demo · Preview only · Never sent to Google</span>`}
            <h3>${a.title}</h3><p class="fs14 soft" style="white-space: pre-wrap; overflow-wrap: anywhere;">${a.detail}</p>
            ${a.kind === 'manual' ? html`<div class="col"><span class="fs12 muted">For you to do yourself</span>
              <p class="fs14 text" style="white-space: pre-wrap; overflow-wrap: anywhere;">${payload?.instructions || 'No structured instructions recorded.'}</p></div>` : html`
              <div class="col fs13 soft" style="overflow-wrap: anywhere;">
                <span>Event: ${payload?.calendar?.title || 'Not specified'}</span>
                <span>Start: ${when(payload?.calendar?.start)}</span><span>End: ${when(payload?.calendar?.end)}</span>
                <span>Timezone: ${payload?.calendar?.timeZone || 'Australia/Brisbane'}</span>
                <span>Target calendar: ${payload?.target_calendar || 'Not selected'}</span>
                ${payload?.calendar?.location && html`<span>Location: ${payload.calendar.location}</span>`}
              </div>`}
            <div class="col fs12 muted" style="overflow-wrap: anywhere;"><span>Source: ${source.subject || 'Legacy suggestion; source not recorded'}</span>
              ${source.sender && html`<span>Sender as shown: ${source.sender}</span>`}</div>
            ${source.evidence && html`<blockquote class="fs14 soft" style="white-space: pre-wrap; overflow-wrap: anywhere;">${source.evidence}</blockquote>`}
            ${source.deadline_text && html`<p class="fs13 dim">Date/time as stated: ${source.deadline_text}</p>`}
            ${source.thread_id && html`<a class="fs13 steel" href=${`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(source.thread_id)}`} target="_blank" rel="noopener noreferrer">Open proposal source in Gmail ↗</a>`}
            ${a.blocked_reasons.length > 0 && html`<div class="col"><span class="fs12 muted">Needs clarification before approval</span>
              <ul class="fs13 soft">${a.blocked_reasons.map((reason) => html`<li>${reason}</li>`)}</ul></div>`}
            <span class="fs12 muted">Expires: ${when(a.expires_at)}</span>
            <span class="fs13 steel">${a.execution_mode === 'enabled' ? 'Creates an event after approval' : 'Record-only decision · Does not create an event'}</span>
            ${a.execution_error && html`<p class="fs13 coral" role="status">${a.execution_error}</p>`}
            ${a.decided_at && html`<span class="fs12 muted">Decision recorded: ${when(a.decided_at)}</span>`}
            ${a.status === 'pending' && html`<div class="row wrap">
              ${!a.source_snapshot?.demo && html`<button class="btn btn-primary" disabled=${actionSaving || !a.can_approve} onClick=${() => this.decideProposal(a, 'approved')}>${a.execution_mode === 'enabled' ? 'Approve and create event' : 'Approve proposal'}</button>`}
              <button class="btn btn-secondary" disabled=${actionSaving} onClick=${() => this.decideProposal(a, 'rejected')}>${a.source_snapshot?.demo ? 'Dismiss demo' : 'Reject proposal'}</button>
            </div>`}
            ${a.can_prepare && html`<button class="btn btn-secondary" disabled=${actionSaving} onClick=${() => this.calendarOperation(a, 'prepare')}>Enable creation and review again</button>`}
            ${a.can_execute && html`<button class="btn btn-secondary" disabled=${actionSaving} onClick=${() => this.calendarOperation(a, 'execute')}>${['uncertain','executing'].includes(a.execution_status) ? 'Check result' : 'Retry calendar creation'}</button>`}
            ${a.can_undo && html`<button class="btn btn-secondary" disabled=${actionSaving} onClick=${() => this.calendarOperation(a, 'undo')}>${a.execution_status === 'undo_uncertain' ? 'Check undo result' : 'Undo Moniqr event'}</button>`}
            <span class="fs12 muted">${a.execution_status === 'succeeded' ? 'Confirmed on your main calendar.' : a.execution_status === 'undone' ? 'Event removed by your undo.'
              : a.execution_mode === 'record_only' ? 'This decision has not executed anything and cannot be consumed by a future executor.' : 'Creation status: ' + a.execution_status}</span>
            <button class="btn btn-ghost sm" onClick=${() => this.showActionHistory(a.id)}>Decision history</button>
            ${history && html`<ul class="fs12 dim">${history.length ? history.map((event) => html`<li>Revision ${event.revision}: ${event.event_type} · ${event.actor} · ${when(event.created_at)}</li>`) : html`<li>No recorded events for this legacy suggestion.</li>`}</ul>`}
          </article>
        </div>`}
    </section>`;
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

  async updateFinding(id, status) {
    if (this.state.findingSaving) return;
    this.setState({ findingSaving: true, findingError: '' });
    try {
      const res = await fetch(`/findings/${id}/status`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ status }),
      });
      if (!res.ok) throw new Error(`Could not save (${res.status}).`);
      await this.load();
    } catch (err) { this.setState({ findingError: 'Your change could not be saved. Please try again.' }); }
    finally { this.setState({ findingSaving: false }); }
  }

  renderInbox(v) {
    const { data, filter, sel, findingSaving, findingError } = this.state;
    const { items, scan, total } = data.findings;
    const labels = { bill: 'Bill or deadline', commitment: 'Commitment', reply: 'Reply needed' };
    const statuses = { new: 'New', reviewed: 'Reviewed', dismissed: 'Dismissed' };
    const shown = items.filter((f) => filter === 'all' || f.status === filter);
    const selected = shown.find((f) => f.id === sel) ?? shown[0];
    const when = (iso) => new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Brisbane', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso));
    const running = scan && ['queued', 'running'].includes(scan.run_status);
    const complete = scan?.status === 'completed' && scan.run_status === 'done';
    const partial = scan?.status === 'partial' && scan.run_status === 'done';
    const scanLabel = data.findingsError ? 'Inbox unavailable. Retrying automatically.'
      : !scan ? 'No email scan yet. Run the EA to scan your inbox.'
      : running ? 'Email scan queued or running…'
      : complete ? `Last scan completed ${when(scan.updated_at)}`
      : partial ? 'Last scan was partial. Some email could not be read; findings may be incomplete.'
      : 'Last scan did not complete. Existing findings are kept; run the EA to try again.';
    return html`
      <section id="inbox" class="col" style="gap: 12px;">
        <div class="between wrap" style="gap: 12px;">
          <div class="col"><h2 style="font-size: 20px;">Admin inbox</h2>
            <span class="fs13 muted">${v.unread} new · Gmail findings · Brisbane time</span></div>
          <button class="btn btn-secondary" disabled=${this.state.posting || data.busy} onClick=${() => this.runEa('morning_brief')}>${data.busy ? 'EA running…' : 'Scan email'}</button>
        </div>
        <p class="fs12 muted" role="status">${scanLabel}</p>
        ${scan?.last_success_at && !complete && html`<p class="fs12 muted">Last successful scan: ${when(scan.last_success_at)}</p>`}
        ${this.state.runError && html`<p class="fs13 coral" role="alert">${this.state.runError}</p>`}
        ${findingError && html`<p class="fs13 coral" role="alert">${findingError}</p>`}
        <div class="filters" role="group" aria-label="Filter findings">
          ${['all', 'new', 'reviewed', 'dismissed'].map((id) => html`<button class="btn btn-ghost sm" aria-pressed=${filter === id}
            style=${filter === id ? on('var(--wash-8)') : ''} onClick=${() => this.setState({ filter: id })}>${id === 'all' ? 'All' : statuses[id]}</button>`)}
        </div>
        ${total > items.length && html`<p class="fs12 muted">Showing the first ${items.length} of ${total} findings, with new findings first.</p>`}
        ${!shown.length ? html`<div class="tile panel"><p class="fs14 soft">${data.findingsError ? 'Findings could not load.'
          : items.length ? 'No findings in this filter.' : complete ? 'No saved findings. The latest scan completed.'
          : 'No saved findings yet. A successful scan is needed before this inbox is up to date.'}</p></div>` : html`
          <div class="inbox">
            <div class="mail-list" aria-label="Email findings">
              ${shown.map((f) => html`<button class=${`mail finding-row${f.id === selected.id ? ' sel' : ''}`} key=${f.id}
                aria-pressed=${f.id === selected.id} onClick=${() => this.setState({ sel: f.id })}>
                <span class="dot" style=${`background: ${f.status === 'new' ? 'var(--accent-2)' : 'transparent'};`}></span>
                <span class="col" style="gap: 4px; min-width: 0;">
                  <span class="fs12 muted">${labels[f.category]} · ${statuses[f.status]}</span>
                  <span class="fs14 text ellipsis">${f.subject}</span>
                  <span class="fs13 muted ellipsis">${f.summary}</span>
                </span>
              </button>`)}
            </div>
            <article class="reader" aria-label="Finding details">
              <span class="fs12 steel">${labels[selected.category]} · ${statuses[selected.status]}</span>
              <h3>${selected.subject}</h3>
              <p class="fs14 soft" style="white-space: pre-wrap; overflow-wrap: anywhere;">${selected.summary}</p>
              <div class="col fs12 muted" style="overflow-wrap: anywhere;">
                <span>Sender as shown: ${selected.sender || '(not stated)'}</span>
                <span>Received ${when(selected.received_at)}</span>
              </div>
              <div class="col"><span class="fs12 muted">Source evidence</span>
                <blockquote class="fs14 soft" style="white-space: pre-wrap; overflow-wrap: anywhere;">${selected.evidence}</blockquote></div>
              <p class="fs13 dim">${selected.deadline_text ? `Date/time as stated: ${selected.deadline_text}` : 'No date or time was extracted. Check the source before acting.'}</p>
              ${selected.missing_details.length > 0 && html`<div class="col"><span class="fs12 muted">Missing or uncertain</span>
                <ul class="fs13 soft">${selected.missing_details.map((d) => html`<li>${d}</li>`)}</ul></div>`}
              <a class="fs13 steel" href=${`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(selected.thread_id)}`} target="_blank" rel="noopener noreferrer">Open source in Gmail ↗</a>
              <div class="row wrap">
                ${selected.status !== 'reviewed' && html`<button class="btn btn-secondary" disabled=${findingSaving} onClick=${() => this.updateFinding(selected.id, 'reviewed')}>Mark reviewed</button>`}
                ${selected.status !== 'dismissed' && html`<button class="btn btn-ghost" disabled=${findingSaving} onClick=${() => this.updateFinding(selected.id, 'dismissed')}>Dismiss</button>`}
                ${selected.status !== 'new' && html`<button class="btn btn-ghost" disabled=${findingSaving} onClick=${() => this.updateFinding(selected.id, 'new')}>Mark new</button>`}
              </div>
              <span class="fs12 muted">This updates Moniqr only. It does not change your email, pay a bill or create a calendar event.</span>
            </article>
          </div>`}
      </section>`;
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
    const gridH = `${(H1 - H0) * PX}px`;
    const hours = [];
    for (let h = H0 + 1; h < H1; h++) hours.push({ top: `${(h - H0) * PX}px`, label: h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM` });
    const first = v.week[0];
    const last = v.week[6];
    const title =
      first.getUTCMonth() === last.getUTCMonth()
        ? `${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()}`
        : `${MONTHS[first.getUTCMonth()]} – ${MONTHS[last.getUTCMonth()]} ${last.getUTCFullYear()}`;
    const events = v.mock.events;
    const layouts = v.week.map((_, day) => calendarDayLayout(events.filter(e => e.day === day)));
    const nowTop = `${(Math.min(Math.max(v.hour, H0), H1) - H0) * PX}px`;
    const swatch = (c) => `background: ${c.bg}; border-style: ${c.line}; border-color: ${c.border === 'transparent' ? c.bg : c.border};`;
    const picked = this.state.pick;
    const calendarStatus = this.state.data.calendar?.status ?? 'disconnected';
    return html`
      <section id="calendar" class="col" style="gap: 12px;">
        <div class="row wrap" style="gap: 10px;">
          <button class="btn btn-secondary" style="border-radius: 18px; padding: 6px 16px;">Today</button>
          <h2 style="font-weight: 400; font-size: 20px;">${title}</h2>
          <div style="flex: 1;"></div>
          <div class="row wrap fs12 dim" style="gap: 12px;">
            ${[EV_STYLE.life, EV_STYLE.pend].map((c) => html`<span class="row nowrap" style="gap: 6px;"><span class="swatch" style=${swatch(c)}></span>${c.label}</span>`)}
          </div>
        </div>
        <p class="fs12 muted">${calendarStatus === 'connected'
          ? (events.length || v.mock.allDay.length ? 'Google Calendar + Moniqr requests · Brisbane time' : 'No events this week · Google Calendar · Brisbane time')
          : calendarStatus === 'error' ? 'Google Calendar could not load. Retrying automatically.'
          : 'Google Calendar is not connected. Configure the Google connection to show your events.'}</p>
        <label class="fs13 dim row"><input type="checkbox" checked=${this.state.showRequests !== false}
          onChange=${(e) => this.setState({ showRequests: e.target.checked })} />Show Moniqr requests</label>
        ${this.state.data.actionsError && html`<p class="fs12 coral">The request overlay could not load. Confirmed Google events are shown separately.</p>`}
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
                      const layout = layouts[i].get(e);
                      const pick = () => e.actionId ? this.openProposal(e.actionId) :
                        this.setState({
                          pick: {
                            title: e.title,
                            time,
                            dayLabel: `${DOW[i]} ${d.getUTCDate()}`,
                            note: e.kind === 'pend' ? `Awaiting your decision${e.note ? ` · ${e.note}` : ''}` : e.note,
                            swatch: swatch(c),
                          },
                        });
                      return html`<button type="button"
                        class=${`ev${e.overlay ? ' request' : ''}`}
                        aria-label=${`${e.overlay ? 'Moniqr request: ' : 'Event: '}${e.title}, ${time}`}
                        title=${`${e.overlay ? 'Moniqr request: ' : ''}${e.title} · ${time}${e.note ? ' · ' + e.note : ''}`}
                        onClick=${pick}
                        style=${`top: ${(e.start - H0) * PX}px; height: ${Math.max(e.hours * PX - 2, 18)}px; background: ${c.bg}; border-style: ${c.line}; border-color: ${c.border}; color: ${c.fg}; left: ${layout.left}%; width: ${layout.width}%; right: auto;`}
                      >
                        <b>${e.title}</b><span>${time}</span>
                      </button>`;
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

  dashboardHeader(title, description, app) {
    const url = this.state.data.links.find((l) => l.name === app)?.url;
    return html`<header class="dashboard-heading between wrap">
      <div class="col" style="gap: 8px;"><span class="fs12 steel">HEADQUARTERS / ${title.toUpperCase()}</span><h1>${title}</h1><p class="muted">${description}</p></div>
      <a class="btn btn-secondary" href=${url}>Open ${app} ↗</a>
    </header><div class="dashboard-notice"><span class="sample">Design preview</span><span>Sample data · ${app} is not connected to this dashboard yet.</span></div>`;
  }

  dashboardMetric(label, value, note) {
    return html`<section class="tile panel dashboard-metric"><span class="fs13 muted">${label}</span><strong>${value}</strong><span class="fs12 dim">${note}</span></section>`;
  }

  renderProjectDashboard() {
    const filter = this.state.projectFilter;
    const projects = projectSamples.filter((p) => filter === 'All' || (filter === 'Needs attention' ? !!p.attention : p.status === filter));
    const stack = this.state.data.links.find((l) => l.name === 'Stack')?.url;
    return html`<main class="main dashboard">
      ${this.dashboardHeader('Projects', 'Pick up your work, clear blockers and keep the next step in sight.', 'Stack')}
      <div class="dashboard-metrics">
        ${this.dashboardMetric('Projects in motion', '3', 'Across your workspace')}
        ${this.dashboardMetric('Needs attention', '2', '1 blocked · 1 awaiting review')}
        ${this.dashboardMetric('Live projects', '1', 'Stack is up and running')}
        ${this.dashboardMetric('Latest checkpoint', '2h ago', 'Moniqr · dashboard mockups')}
      </div>
      <div class="dashboard-columns">
        <section class="tile panel dashboard-resume"><span class="fs12 steel">PICK UP WHERE YOU LEFT OFF</span><h2>Moniqr</h2><p class="soft">Projects and Finance, right here in HQ.</p><p class="muted">The navigation is in place. Next up: review the overview cards and decide what to surface from each app.</p><div class="dashboard-next"><span class="fs12 muted">NEXT STEP</span><p>Finish the Projects and Finance overview</p></div><a class="btn btn-primary" style="align-self: flex-start;" href=${stack}>Continue in Stack ↗</a></section>
        <section class="tile panel"><div class="between"><h2 class="card-title">Needs your attention</h2><span class="badge">2</span></div><div class="dashboard-list-row col"><span class="coral fs12">BLOCKED · FINANCE</span><span>Confirm the categorisation approach</span><p class="fs13 muted">Choose the rules before the next import pass.</p></div><div class="dashboard-list-row col"><span class="steel fs12">REVIEW · MONIQR</span><span>Review the HQ dashboard layouts</span><p class="fs13 muted">Check the content hierarchy for both tabs.</p></div></section>
      </div>
      <section class="col" style="gap: 16px;"><div class="between wrap"><h2>Your projects</h2><div class="row wrap" aria-label="Filter projects">${['All', 'Building', 'Live', 'Needs attention'].map((f) => html`<button class=${`btn sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`} aria-pressed=${filter === f} onClick=${() => this.setState({ projectFilter: f })}>${f}</button>`)}</div></div>
        <div class="dashboard-projects">${projects.map((p) => html`<article class="tile panel"><div class="between"><span class="fs12 muted">${p.category}</span><span class=${`dashboard-status ${p.attention === 'Blocked' ? 'coral' : 'steel'}`}>${p.status}</span></div><h3>${p.name}</h3><p class="fs13 muted">${p.note}</p><div class="between fs12"><span class="dim">Delivery progress</span><span>${p.progress}%</span></div><div class="bar"><div style=${`width: ${p.progress}%`}></div></div><div class="dashboard-next"><span class="fs12 muted">NEXT STEP</span><p class="fs14">${p.next}</p></div>${p.attention && html`<span class="fs12 coral">${p.attention}</span>`}</article>`)}</div>
      </section>
      <section class="tile panel"><div class="between"><h2 class="card-title">Recent activity</h2><span class="fs12 muted">Across Stack</span></div>${projectSamples.map((p) => html`<div class="dashboard-list-row between wrap"><div><span class="steel">${p.name}</span><p class="fs13 soft">${p.activity}</p></div><span class="fs12 muted">${p.when}</span></div>`)}</section>
    </main>`;
  }

  renderFinanceDashboard() {
    const f = financeSamples;
    const money = (n) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);
    const finance = this.state.data.links.find((l) => l.name === 'Finance')?.url;
    return html`<main class="main dashboard">
      ${this.dashboardHeader('Finance', 'Your money at a glance. Budgets, cash flow and what needs a look.', 'Finance')}
      <div class="between wrap"><span class="fs13 dim">Personal overview · November 2026 · AUD</span><span class="fs12 muted">Illustrative month</span></div>
      <div class="dashboard-metrics">
        ${this.dashboardMetric('Cash balance', money(f.balance), 'Across everyday & savings')}
        ${this.dashboardMetric('Income this month', money(f.income), '2 salary payments')}
        ${this.dashboardMetric('Spent this month', money(f.spent), '68% of monthly budget')}
        ${this.dashboardMetric('Budget remaining', money(f.budget - f.spent), 'Of a $4,200 spending plan')}
      </div>
      <div class="dashboard-columns"><section class="tile panel dashboard-resume"><span class="fs12 steel">MONTHLY POSITION</span><h2>${money(f.income - f.spent)} ahead</h2><p class="muted">Income less spending in this sample month.</p><div class="dashboard-cash-row"><span>Income</span><meter min="0" max=${f.income} value=${f.income} aria-label="Monthly income"></meter><strong>${money(f.income)}</strong></div><div class="dashboard-cash-row"><span>Spending</span><meter min="0" max=${f.income} value=${f.spent} aria-label="Monthly spending"></meter><strong>${money(f.spent)}</strong></div><div class="dashboard-next"><span class="fs12 muted">COMING UP</span><p>${money(f.bills.reduce((sum, b) => sum + b.amount, 0))} in upcoming bills</p><span class="fs13 muted">Keep room in your everyday account for the next payments.</span></div></section>
      <section class="tile panel"><div class="between"><h2 class="card-title">Budget breakdown</h2><span class="fs12 muted">Spent / planned</span></div>${f.categories.map((c) => html`<div class="col" style="gap: 7px;"><div class="between fs13"><span>${c.name}</span><span class="muted">${money(c.spent)} / ${money(c.budget)}</span></div><meter class="dashboard-budget" min="0" max=${c.budget} value=${c.spent} aria-label=${`${c.name} budget used`}></meter></div>`)}</section></div>
      <div class="dashboard-columns"><section class="tile panel"><div class="between"><h2 class="card-title">Recent transactions</h2><span class="fs12 muted">Sample ledger</span></div>${f.transactions.map((t) => html`<div class="dashboard-list-row between"><div class="col"><span>${t.name}</span><span class=${`fs12 ${t.category === 'To categorise' ? 'coral' : 'muted'}`}>${t.date} · ${t.category}</span></div><strong class=${t.amount > 0 ? 'steel' : 'soft'}>${t.amount > 0 ? '+' : '−'}${Math.abs(t.amount).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}</strong></div>`)}</section>
      <section class="tile panel"><h2 class="card-title">Upcoming bills</h2>${f.bills.map((b) => html`<div class="dashboard-list-row between"><div class="col"><span>${b.name}</span><span class="fs12 muted">Due ${b.due}</span></div><strong>${money(b.amount)}</strong></div>`)}<span class="fs12 muted">Planned payments · no payments scheduled by HQ</span></section></div>
      <section class="tile panel"><div class="between wrap"><div class="col" style="gap: 6px;"><h2 class="card-title">A little housekeeping</h2><p class="muted">1 sample transaction needs a category. Review your ledger, budgets and personal or business reports in Finance.</p></div><a class="btn btn-secondary" href=${finance}>Review in Finance ↗</a></div></section>
    </main>`;
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
    const { thinking } = this.state;
    const submit = (e) => {
      e.preventDefault();
      this.send(this.state.draft);
    };
    return html`
      <section id="moniqr-chat" class="assistant" role="dialog" aria-modal="false" aria-labelledby="moniqr-chat-title">
        <div class="row" style="gap: 10px; padding: 16px 18px;">
          <span class="m-mark">M</span>
          <div class="col grow">
            <span id="moniqr-chat-title" class="fs15 bright" style="font-weight: 500;">Moniqr</span>
            <span class="fs12 muted">Sample chat · ${thinking ? 'drafting…' : 'preview'}</span>
          </div>
          <button type="button" class="btn sm btn-ghost" aria-label="Close chat" onClick=${() => this.setState({ chatOpen: false })}>Close</button>
        </div>
        <div class="msgs" role="log" aria-label="Chat messages" aria-live="polite" ref=${this.chatMessagesRef}>
          ${this.state.messages.map((m) => html`<div class=${`bubble ${m.me ? 'me' : 'them'}`}>${m.text}</div>`)}
          ${thinking && html`<span class="fs13 muted">Moniqr is drafting…</span>`}
        </div>
        <div class="col" style="gap: 10px; padding: 14px 18px 18px;">
          <div class="row wrap" style="gap: 6px;">
            ${v.mock.chat.suggestions.map((s) => html`<button type="button" class="btn sm btn-secondary" onClick=${() => this.send(s)}>${s}</button>`)}
          </div>
          <form class="composer" style="padding: 5px; border-radius: 12px;" onSubmit=${submit}>
            <input ref=${this.chatInputRef} aria-label="Message Moniqr" class="field" style="font-size: 16px;" value=${this.state.draft} onInput=${(e) => this.setState({ draft: e.target.value })} placeholder="Delegate, ask, or plan…" />
            <button type="submit" class="btn btn-primary" style="border-radius: 8px; padding: 6px 14px;">Send</button>
          </form>
        </div>
      </section>
    `;
  }
}

const root = document.getElementById('app');
root.textContent = '';
render(html`<${App} />`, root);
