// The dashboard, the moniqr.com command centre, behind Home (home.js). A port of the Personal OS HQ v4 design to Preact + htm, loaded as
// one ES module so there's no build step. The server sends everything to draw from /api/hq:
// live briefs, runs, calendar, findings and proposal decisions, plus sample lifestyle content
// (data.mock). Enabled calendar proposals create events only after owner approval;
// manual/record-only choices never execute. Priorities and habits are samples; mood check-ins are saved. The moniqr console
// (console.js) opens from a right-click anywhere and talks to a read-only EA run.
// SOURCES below records which cards are live and which are samples; every card shows a badge.
import { Component, html, render } from '/vendor/preact-htm.js';
import { calendarLayers, calendarDayLayout } from './calendar-overlay.js';
import { projectSamples, financeSamples, knowledgeSamples, lifeSamples } from './dashboard-mocks.js';
import { Home } from './home.js';
import { Backlog } from './backlog.js';
import { Workforce } from './workforce.js';
import { renderBriefing, loadBriefExtras } from './briefing.js';
import { mountConsole } from './console.js';

import { applyTheme, initialTheme } from './theme.js';

applyTheme(initialTheme());

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
const PX_SMALL = 26;
const PX_FULL = 48;

// Fallback colours for calendars that have no colour from Google, picked by calendar name.
const CAL_FALLBACK = ['#039be5', '#33b679', '#e67c73', '#8e24aa', '#f6bf26', '#f4511e', '#3f51b5', '#0b8043'];
const calColour = (event) => {
  if (/^#[0-9a-f]{6}$/i.test(event.color ?? '')) return event.color;
  const key = event.calendarId ?? event.calendar ?? '';
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CAL_FALLBACK[h % CAL_FALLBACK.length];
};
const colourStyle = (hex) => ({ bg: `color-mix(in srgb, ${hex} 34%, var(--tile))`, border: hex, line: 'solid', fg: 'var(--n100)' });
const SLIDE_SECONDS = 8;
const POLL_MS = 5000;

const EV_STYLE = {
  gym: { bg: 'var(--accent)', border: 'var(--accent)', line: 'solid', fg: 'var(--n100)', label: 'Training' },
  work: { bg: 'color-mix(in srgb, var(--n100) 16%, transparent)', border: 'transparent', line: 'solid', fg: 'var(--n100)', label: 'Work' },
  life: { bg: 'color-mix(in srgb, var(--accent-2) 30%, transparent)', border: 'transparent', line: 'solid', fg: 'var(--n100)', label: 'Google event' },
  pend: { bg: 'color-mix(in srgb, var(--a400) 14%, transparent)', border: 'var(--a400)', line: 'dashed', fg: 'var(--a200)', label: 'Moniqr request' },
};

/**
 * Where each dashboard card's content comes from. Every card shows a Live or Sample badge from
 * this list, and "Hide samples" removes the sample cards, so flip a card to 'live' here when it's wired.
 */
const SOURCES = {
  ea: { kind: 'live', from: 'the agent service (EA runs)' },
  brief: { kind: 'live', from: 'the latest brief the EA wrote' },
  slides: { kind: 'sample', from: 'Suggestion slides are placeholder content' },
  decision: { kind: 'live', from: 'proposals stored by the agent service' },
  actions: { kind: 'live', from: 'proposals stored by the agent service' },
  calendar: { kind: 'live', from: 'Google Calendar, plus pending calendar proposals' },
  upNext: { kind: 'live', from: 'Google Calendar' },
  inbox: { kind: 'live', from: 'email findings from the inbox scan' },
  runs: { kind: 'live', from: 'the agent service run history' },
  moniqr: { kind: 'live', from: 'the latest EA run' },
  pri: { kind: 'sample', from: 'Priorities are not wired to the backlog yet' },
  news: { kind: 'sample', from: 'No news feed is connected' },
  mood: { kind: 'live', from: 'your check-ins, saved in moniqr' },
  pick: { kind: 'live', from: 'the daily pick written with your morning brief' },
  pickSample: { kind: 'sample', from: 'No morning brief has written a daily pick yet' },
  glance: { kind: 'sample', from: 'No health or fitness data is connected' },
  habits: { kind: 'sample', from: 'Habit ticks are not saved anywhere yet' },
  meals: { kind: 'sample', from: 'No meal plan is connected' },
  people: { kind: 'sample', from: 'People reminders are placeholder content' },
  markets: { kind: 'sample', from: 'No market data is connected' },
  projects: { kind: 'sample', from: 'Not connected to Stack yet' },
  finance: { kind: 'sample', from: 'Not connected to Finance yet' },
  knowledge: { kind: 'sample', from: 'No notes or documents are connected yet' },
  life: { kind: 'sample', from: 'No goals, health or journal data is connected yet' },
  briefFallback: { kind: 'sample', from: 'Shown until the EA writes its first brief' },
};
const LIVE_COUNT = Object.values(SOURCES).filter((x) => x.kind === 'live').length;
const SAMPLE_COUNT = Object.keys(SOURCES).filter((k) => k !== 'pickSample').length - LIVE_COUNT;

/** The Live or Sample badge for a card. `down` replaces "Live" when the live source is failing. */
function src(id, down, extra = '') {
  const s = SOURCES[id];
  const live = s.kind === 'live';
  const title = live ? `Live: reads ${s.from}.${down ? ' It is unavailable right now.' : ''}` : `Sample data. ${s.from}.`;
  return html`<span class=${`src ${live ? 'live' : 'sample'}${live && down ? ' down' : ''}${extra ? ` ${extra}` : ''}`} title=${title}>${live ? down || 'Live' : 'Sample'}</span>`;
}

const readHideSamples = () => { try { return localStorage.getItem('moniqr.hideSamples') === '1'; } catch { return false; } };

const MOODS = ['Low', 'Meh', 'Okay', 'Good', 'Great'];
const BNE_MS = 10 * 3_600_000;
/** Brisbane day number and check-in slot (morning before 3pm, evening after) for a time. */
const checkinSlot = (ms) => ({ day: Math.floor((ms + BNE_MS) / 86_400_000), pm: new Date(ms + BNE_MS).getUTCHours() >= 15 });
const brisbaneClock = (ms) => { const d = new Date(ms + BNE_MS); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const ENERGY = ['Drained', 'Low', 'Steady', 'High', 'Wired'];
const FOCUS_IDS = ['pri', 'news', 'mood', 'pick'];
const FOCUS_LABELS = { pri: 'priorities', news: 'news', mood: 'mood', pick: 'daily pick' };

const on = (bg, fg = 'var(--n100)') => `background: ${bg}; color: ${fg};`;
const choice = (active) => (active ? on('var(--accent)') : on('color-mix(in srgb, var(--n100) 5%, transparent)', 'var(--n300)'));

const pad2 = (n) => String(n).padStart(2, '0');
/** Best-effort prefill from quoted email wording ("24 November 2026", "Fri 21 Nov at 7pm").
 * Only a starting point: Bailey always sees and confirms the date and time before anything is added. */
function guessWhen(text) {
  if (!text) return null;
  const m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?(?:\s+(\d{4}))?/i)
    ?? text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!m) return null;
  const day = Number(m[1]), month = Number.isNaN(Number(m[2])) ? MONTHS.findIndex((x) => x.toLowerCase() === m[2].slice(0, 3).toLowerCase()) : Number(m[2]) - 1;
  const today = new Date(Date.now() + 10 * 3_600_000);
  let year = m[3] ? Number(m[3]) : today.getUTCFullYear();
  if (!m[3] && Date.UTC(year, month, day) < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) year++;
  const d = new Date(Date.UTC(year, month, day));
  if (d.getUTCMonth() !== month || d.getUTCDate() !== day) return null;
  const out = { date: `${year}-${pad2(month + 1)}-${pad2(day)}` };
  const t = text.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i) ?? text.match(/\b([01]?\d|2[0-3]):(\d{2})\b/);
  if (t) {
    const h = (Number(t[1]) % (t[3] ? 12 : 24)) + (t[3]?.toLowerCase() === 'pm' ? 12 : 0), min = Number(t[2] ?? 0);
    if (h < 24 && min < 60) Object.assign(out, { start: `${pad2(h)}:${pad2(min)}`, end: `${pad2(Math.min(h + 1, 23))}:${pad2(h >= 23 ? 59 : min)}` });
  }
  return out;
}

class App extends Component {
  state = {
    data: null,
    loadError: false,
    posting: false,
    now: Date.now(),
    view: 'home',
    personalData: null, personalError: '', personalBusy: false, personalMessage: '',
    theme: document.documentElement.dataset.theme,
    hideSamples: readHideSamples(),
    projectFilter: 'All',
    slide: 0,
    carPaused: false,
    ap: {},
    read: {},
    sel: null,
    filter: 'all',
    inboxTab: 'findings',
    pick: null,
    pri: [],
    priExtra: {},
    priTouched: false,
    priDraft: '',
    mood: null,
    energy: null,
    journal: '',
    checkins: null,
    checkinId: null,
    checkinError: '',
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
    this.loadCheckins();
    this.clock = setInterval(() => this.setState({ now: Date.now() }), 30_000);
    this.onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.searchEl?.focus();
      }
      if (e.key === 'Escape' && this.state.calFull) {
        this.setState({ calFull: false });
        document.documentElement.classList.remove('cal-full-open');
      }
    };
    window.addEventListener('keydown', this.onKey);
  }

  componentWillUnmount() {
    clearInterval(this.clock);
    clearTimeout(this.poll);
    clearTimeout(this.settingsPoll);
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
      if (!res.ok) throw new Error(`Dashboard data returned ${res.status}`);
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

  openView(view) {
    this.go(view);
  }

  /** Open a view, optionally scrolled to a section and with a proposal selected. */
  go = (view, anchor, actionId) => {
    if (this.state.personalBusy) return;
    if (view === 'settings') this.loadPersonal(view);
    if (view === 'briefing') loadBriefExtras(this);
    const from = this.state.view;
    // Proposals live on the Inbox's Proposals tab; older links still ask for the dashboard's 'actions' anchor.
    const proposals = anchor === 'actions' || Boolean(actionId);
    if (proposals) { view = 'inbox'; anchor = null; }
    const tab = proposals ? { inboxTab: 'proposals' } : {};
    const swap = () => new Promise((done) => this.setState(
      { view, ...tab, ...(actionId ? { actionSel: actionId, actionFilter: 'all', actionHistory: null } : {}) },
      () => { window.scrollTo(0, 0); done(); },
    ));
    const root = document.documentElement;
    const after = () => anchor && document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' });
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Only moves between Home and another page animate; switching among the other pages is instant.
    if (view === from || reduced || (from !== 'home' && view !== 'home')) return void swap().then(after);
    // The new page's sections rise in one after another (hq.css, .arriving), under a circular reveal.
    // The class goes on only once the old page has been captured, so the old snapshot stays intact.
    const arrive = () => {
      clearTimeout(this.arriving);
      root.classList.add('arriving');
      this.arriving = setTimeout(() => root.classList.remove('arriving'), 1400);
      return swap();
    };
    if (!document.startViewTransition) return void arrive().then(after);
    // Back to Home the page collapses into the corner; anywhere else the new page expands out of it.
    root.classList.toggle('collapsing', view === 'home');
    document.startViewTransition(arrive).finished.finally(() => { root.classList.remove('collapsing'); after(); });
  };

  toggleSamples = () => {
    const hideSamples = !this.state.hideSamples;
    try { localStorage.setItem('moniqr.hideSamples', hideSamples ? '1' : '0'); } catch {}
    this.setState({ hideSamples, slide: 0 }, () => this.startBar());
  };

  toggleTheme = () => {
    this.setState({ theme: applyTheme(this.state.theme === 'dark' ? 'light' : 'dark', true) });
  };

  // — render —

  render() {
    const { data, loadError } = this.state;
    if (!data) {
      return html`<p class="boot">${loadError ? 'The dashboard could not load. Refresh to try again.' : 'Loading the dashboard…'}</p>`;
    }
    const v = this.derive();
    if (this.state.view === 'home') {
      return html`<${Home} data=${data} now=${this.state.now} name=${v.mock.name} theme=${this.state.theme}
        pending=${v.pending} unread=${v.unread} onTheme=${this.toggleTheme} go=${this.go} />`;
    }
    return html`
      <div class="shell">
        ${this.renderNav(v)}
        <div class="grow col">
          ${this.renderTopbar(v)}
          <div class="body">
            <div class="content">
              ${this.state.view === 'hq' ? this.renderHq(v) : this.state.view === 'inbox' ? html`<main class="main">${this.renderInbox(v)}</main>` : this.state.view === 'backlog' ? html`<${Backlog} />` : this.state.view === 'settings' ? this.renderSettings() : this.state.view === 'projects' ? this.renderProjectDashboard() : this.state.view === 'finance' ? this.renderFinanceDashboard() : this.state.view === 'knowledge' ? this.renderKnowledge() : this.state.view === 'agents' ? this.renderAgentsPage() : this.state.view === 'life' ? this.renderLife() : this.renderBriefing(v)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /** Loads recent check-ins and picks up the one for this morning or evening, if already logged. */
  async loadCheckins() {
    try {
      const r = await fetch('/api/checkins', { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error();
      const { items } = await r.json();
      const slot = checkinSlot(Date.now());
      const cur = items.find((c) => { const s = checkinSlot(Date.parse(c.created_at)); return s.day === slot.day && s.pm === slot.pm; });
      this.setState(cur ? { checkins: items, checkinId: cur.id, mood: cur.mood, energy: cur.energy, journal: cur.note, checkinError: '' }
        : { checkins: items, checkinId: null, mood: null, energy: null, journal: '', checkinError: '' });
    } catch { this.setState({ checkins: this.state.checkins ?? [], checkinError: 'Past check-ins could not be loaded.' }); }
  }

  /** Saves the current check-in: the first tap of a mood creates it, later changes update it. */
  async saveCheckin(fields) {
    let { checkinId } = this.state;
    // A card left open past 3pm or midnight starts a new check-in rather than changing the earlier one.
    const cur = (this.state.checkins ?? []).find((c) => c.id === checkinId);
    if (cur) {
      const a = checkinSlot(Date.parse(cur.created_at)), b = checkinSlot(Date.now());
      if (a.day !== b.day || a.pm !== b.pm) { checkinId = null; this.setState({ checkinId: null }); }
    }
    if (!checkinId && fields.mood === undefined) return; // energy and notes wait for a mood
    if (this.checkinSaving) { this.checkinQueued = { ...(this.checkinQueued ?? {}), ...fields }; return; }
    this.checkinSaving = true;
    const body = checkinId ? fields : { mood: this.state.mood ?? fields.mood, energy: this.state.energy, note: this.state.journal.trim() };
    try {
      const r = await fetch(checkinId ? `/checkins/${checkinId}` : '/checkins', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (r.status === 401) return void location.assign('/login');
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Your check-in could not be saved.');
      const others = (this.state.checkins ?? []).filter((c) => c.id !== d.item.id);
      this.setState({ checkinId: d.item.id, checkins: [d.item, ...others], checkinError: '' });
    } catch (e) {
      this.setState({ checkinError: e.message || 'Your check-in could not be saved.' });
    } finally {
      this.checkinSaving = false;
      const queued = this.checkinQueued; this.checkinQueued = null;
      if (queued) this.saveCheckin(queued);
    }
  }

  async loadPersonal(view) {
    const seq = this.personalSeq = (this.personalSeq ?? 0) + 1;
    this.setState({ personalData: null, personalError: '', personalMessage: '' });
    try {
      const r = await fetch(`/api/${view}`, { headers: { accept: 'application/json' } });
      if (r.status === 401) return void location.assign('/login');
      if (!r.ok) throw new Error('Could not load. Please try again.');
      const data = await r.json();
      if (seq === this.personalSeq) this.setState({ personalData: data }, () => { if (view === 'settings') this.refreshSettings(); });
    } catch (e) { if (seq === this.personalSeq) this.setState({ personalError: e.message }); }
  }

  /** Refresh settings in place (no loading flash); keeps polling while a brief is queued or running. */
  async refreshSettings() {
    clearTimeout(this.settingsPoll);
    if (this.state.view !== 'settings') return;
    try {
      const r = await fetch('/api/settings', { headers: { accept: 'application/json' } });
      if (r.status === 401) return void location.assign('/login');
      if (r.ok && this.state.view === 'settings') this.setState({ personalData: await r.json() });
    } catch {}
    if (this.state.view === 'settings' && this.state.personalData?.schedules?.some((s) => s.active_run)) {
      this.settingsPoll = setTimeout(() => this.refreshSettings(), 8_000);
    }
  }

  async runBriefNow(kind) {
    this.setState({ personalBusy: true, personalError: '', personalMessage: '' });
    try {
      const r = await fetch('/run', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ kind }),
      });
      if (r.status === 401) return void location.assign('/login');
      if (!r.ok) throw new Error('The brief could not be started. Please try again.');
      const { existing } = await r.json().catch(() => ({}));
      this.setState({ personalMessage: existing
        ? 'That brief is already queued or running, so no second copy was started.'
        : 'Brief queued. It usually takes one to two minutes.' });
    } catch (e) { this.setState({ personalError: e.message }); }
    finally { this.setState({ personalBusy: false }); await this.refreshSettings(); this.load(); }
  }

  async savePersonal(event, path) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new URLSearchParams(new FormData(form));
    this.setState({ personalBusy: true, personalError: '', personalMessage: '' });
    try {
      const r = await fetch(path, { method: 'POST', headers: { accept: 'application/json' }, body });
      if (r.status === 401) return void location.assign('/login');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not save. Please try again.');
      this.setState({ personalData: data, personalMessage: 'Brief schedule saved.' });
    } catch (e) { this.setState({ personalError: e.message }); }
    finally { this.setState({ personalBusy: false }); }
  }

  personalNotice() {
    return html`<div role="status" aria-live="polite">${this.state.personalError && html`<p class="coral">${this.state.personalError}</p>`}${this.state.personalMessage && html`<p class="soft">${this.state.personalMessage}</p>`}</div>`;
  }

  renderSettings() {
    const data = this.state.personalData;
    const schedule = kind => data?.schedules.find(s => s.kind === `${kind}_brief`);
    const time = s => { const [m,h] = s.cron.split(' '); return `${pad(Number(h))}:${pad(Number(m))}`; };
    const fmt = iso => new Intl.DateTimeFormat('en-AU', {timeZone:'Australia/Brisbane',weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(iso));
    return html`<main class="main personal-page"><div><span class="fs12 muted">CONTROL PANEL</span><h1>Settings</h1><p class="soft">Make Moniqr fit your day.</p></div>${this.personalNotice()}
      ${!data ? html`<p>${this.state.personalError ? 'Settings unavailable.' : 'Loading settings…'}</p><button class="btn btn-secondary" onClick=${() => this.loadPersonal('settings')}>Retry</button>` : html`
      <section class="tile panel"><h2>Daily briefs</h2><p class="soft">A morning plan and an afternoon check-in. Every day, in Brisbane time (Australia/Brisbane).</p>
      <form class="col personal-form" onSubmit=${e => this.savePersonal(e, '/settings')}>
        ${['morning','afternoon'].map(slot => { const s = schedule(slot); return html`<fieldset class="brief-setting"><legend>${slot === 'morning' ? 'Morning brief' : 'Afternoon brief'}</legend><div class="row wrap"><label class="row"><input type="checkbox" name=${`${slot}_enabled`} checked=${s?.enabled ?? false} /> Enabled</label><label class="col">Time<input class="field" type="time" required name=${slot} value=${s ? time(s) : slot === 'morning' ? '07:00' : '16:30'} /></label></div><p class="fs13 muted">${s?.enabled ? s.next_run_at ? `Next: ${fmt(s.next_run_at)}` : 'Next run is being scheduled.' : 'Paused. It will not run on its own.'}</p>${s && this.renderRunStatus(s, fmt)}</fieldset>`; })}
        <p class="fs13 muted">Saving applies to future runs. It does not run a brief immediately.</p><button class="btn btn-primary" disabled=${this.state.personalBusy}>${this.state.personalBusy ? 'Saving…' : 'Save brief schedule'}</button>
      </form></section><section class="tile panel"><h2>Personal backlog</h2><p class="soft">Keep ideas and tasks ready for your EA to help prioritise.</p><button class="btn btn-secondary" onClick=${() => this.go('backlog')}>Open backlog</button></section>`}
    </main>`;
  }

  /** The last real outcome of a brief kind: failures, partial email reads and a safe manual rerun. */
  renderRunStatus(s, fmt) {
    const last = s.last_run, active = s.active_run;
    const by = (r) => r.trigger === 'schedule' ? 'scheduled' : 'manual';
    let tone = 'muted', text = 'No run yet.';
    if (last?.status === 'failed') { tone = 'coral'; text = `Last run failed (${by(last)}, ${fmt(last.finished_at ?? last.queued_at)}).`; }
    else if (last) {
      const email = last.email_status === 'completed' ? `email read in full (${last.email_searches} searches)`
        : last.email_status === 'partial' ? `email only partly read: ${last.email_failures} ${last.email_failures === 1 ? 'read' : 'reads'} failed`
        : last.email_status === 'failed' ? 'email could not be read'
        : 'email not searched';
      if (last.email_status === 'partial' || last.email_status === 'failed') tone = 'coral';
      text = `Last run ${fmt(last.finished_at ?? last.queued_at)} (${by(last)}): brief written, ${email}.`;
    }
    return html`<div class="col run-status" style="gap: 6px;">
      <p class=${`fs13 ${tone}`} role="status">${text}</p>
      ${last?.status === 'failed' && last.error && html`<p class="fs12 muted" style="overflow-wrap: anywhere;">${last.error}</p>`}
      ${last?.status === 'failed' && s.last_success_at && html`<p class="fs12 muted">Last successful brief: ${fmt(s.last_success_at)}</p>`}
      <div class="row wrap" style="gap: 10px; align-items: center;">
        <button type="button" class="btn sm btn-secondary" disabled=${this.state.personalBusy || !!active}
          onClick=${() => this.runBriefNow(s.kind)}>${active ? (active.status === 'running' ? 'Running…' : 'Queued…') : 'Run now'}</button>
        <span class="fs12 muted">${active ? `Started ${fmt(active.queued_at)}. This page updates when it finishes.` : 'Runs once now. Your schedule is unchanged.'}</span>
      </div>
    </div>`;
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
    mock.calendars = [...new Map(calendar.events.filter((e) => e.response !== 'declined')
      .map((e) => [e.calendarId ?? e.calendar, { name: (e.calendar ?? '').split(' · ')[0] || 'Calendar', colour: calColour({ ...e, color: e.calendarColor ?? (e.calendarId ? undefined : e.color) }) }])).values()];
    for (const event of [...calendar.events, ...layers.requests]) {
      if (event.response === 'declined') continue;
      const start = event.allDay ? Date.parse(event.start + 'T00:00:00+10:00') : Date.parse(event.start);
      const end = event.allDay ? Date.parse(event.end + 'T00:00:00+10:00') : Date.parse(event.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      for (let day = 0; day < 7; day++) {
        const dayStart = weekStart + day * DAY_MS;
        if (start >= dayStart + DAY_MS || end <= dayStart) continue;
        const colour = event.overlay ? null : calColour(event);
        const link = event.overlay ? undefined : event.link;
        if (event.allDay) mock.allDay.push({ day, title: event.title, colour, link });
        else mock.events.push({
          day, start: (Math.max(start, dayStart) - dayStart) / 3_600_000,
          hours: (Math.min(end, dayStart + DAY_MS) - Math.max(start, dayStart)) / 3_600_000,
          title: event.title, kind: event.overlay ? 'pend' : 'life', overlay: !!event.overlay, actionId: event.actionId, colour, link,
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
      ...(data.workforce ?? []).map((a) => ({
        name: a.name,
        ...(!a.enabled ? { kind: 'idle', state: 'paused' }
          : a.active ? { kind: a.last === 'running' ? 'run' : 'wait', state: a.last === 'running' ? 'working' : 'queued' }
            : a.last === 'failed' ? { kind: 'idle', state: 'task failed' } : { kind: 'idle', state: 'ready' }),
      })),
    ];
    const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
    return { mock, now, todayIdx, week, hour, pending, unread, workforce };
  }

  renderNav(v) {
    // Sidebar tabs sit in small groups so the list scans quickly. On phones the groups flatten into one strip.
    const item = (label, view, extra = {}) => ({ label, view, go: () => this.openView(view), ...extra });
    const groups = [
      { title: 'Today', items: [item('Home', 'home'), item('Dashboard', 'hq'), item('Inbox', 'inbox', { badge: v.unread + v.pending || '' })] },
      { title: 'Work', items: [item('Projects', 'projects'), item('Backlog', 'backlog'), item('Knowledge', 'knowledge')] },
      { title: 'Personal', items: [item('Finance', 'finance'), item('Life', 'life')] },
      { title: 'System', items: [item('Agents', 'agents'), item('Settings', 'settings')] },
    ];
    const dot = { run: ['var(--accent)', 'var(--accent)'], wait: ['transparent', 'var(--a400)'], idle: ['transparent', 'var(--n600)'] };
    return html`
      <nav class="nav">
        <button type="button" class="brand-btn" onClick=${this.toggleTheme} title=${this.state.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          <span class="brand-mark"><img class="ic-light" src="/assets/moniqr-icon-light.png" alt="" /><img class="ic-dark" src="/assets/moniqr-icon-dark.png" alt="" /></span>
          <span class="col brand-text">
            <span class="bright" style="font-size: 18px; font-weight: 600; letter-spacing: -0.015em;">moniqr</span>
            <span class="fs12 muted">${v.mock.name}’s personal OS</span>
          </span>
        </button>
        <div class="col items">
          ${groups.map((g) => html`<div class="col nav-group" role="group" aria-labelledby=${`nav-${g.title}`}>
            <span class="nav-group-title fs12 muted" id=${`nav-${g.title}`}>${g.title}</span>
            ${g.items.map((n) => html`<button type="button" class=${`nav-item${n.view === this.state.view ? ' on' : ''}`} onClick=${n.go}
                aria-current=${n.view === this.state.view ? 'page' : null}>
                <span class="grow">${n.label}</span>
                ${n.badge ? html`<span class="badge">${n.badge}</span>` : null}
              </button>`)}
          </div>`)}
        </div>
        <div class="col workforce" style="gap: 8px; padding: 0 10px;">
          <button class="fs12 muted wf-side-link" onClick=${() => this.openView('agents')}>Workforce${this.state.data.pendingAgentChanges ? html` <span class="badge">${this.state.data.pendingAgentChanges}</span>` : ''}</button>
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
          <span class="fs12 muted">Up next ${src('upNext', this.state.data.calendar?.status === 'error' ? 'Down' : this.state.data.calendar?.status !== 'connected' ? 'Off' : null)}</span>
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
      // The Ask box hands its question to the moniqr console (console.js).
      if (input.value.trim()) window.dispatchEvent(new CustomEvent('moniqr:ask', { detail: { text: input.value, send: true } }));
      input.value = '';
    };
    return html`
      <header class="topbar">
        <nav class="tabs" aria-label="Sections">
          ${[['home', 'Home'], ['hq', 'Dashboard'], ['inbox', 'Inbox'], ['projects', 'Projects'], ['finance', 'Finance'], ['backlog', 'Backlog'], ['settings', 'Settings']].map(([id, label]) => html`<button type="button"
            class=${this.state.view === id || (id === 'hq' && this.state.view === 'briefing') ? 'on' : ''} aria-current=${this.state.view === id ? 'page' : null}
            onClick=${() => this.openView(id)}>${label}</button>`)}
        </nav>
        <div style="flex: 1; display: flex; justify-content: center;">
          <form class="search" onSubmit=${onSearch}>
            <input ref=${this.searchRef} name="q" placeholder="Ask Moniqr, search, or run a command" autocomplete="off" />
            <span class="kbd">⌘K</span>
          </form>
        </div>
        <button type="button" class="src-toggle" aria-pressed=${this.state.hideSamples} onClick=${this.toggleSamples}
          title=${`${LIVE_COUNT} cards read live data and ${SAMPLE_COUNT} show sample data. Hover any badge to see its source.`}>
          <span class="src live">Live</span><span class="src sample">Sample</span>
          <span>${this.state.hideSamples ? 'Show samples' : 'Hide samples'}</span>
        </button>
        <span class="clock fs13 muted nowrap">${clock}</span>
        <button type="button" class="ask-touch signout-btn fs12" aria-label="Ask moniqr" title="Ask moniqr"
          onClick=${() => window.dispatchEvent(new CustomEvent('moniqr:ask'))}><span aria-hidden="true">›_</span> Ask</button>
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
          <h2>Executive Assistant ${src('ea', this.state.data.agentsError && 'Offline')}</h2>
          <p class="fs14 muted">Generate a brief from your connected email and calendars. Cards marked Live read real data; cards marked Sample are placeholders that aren't wired up yet.</p>
          ${this.state.data.agentsError && html`<p class="fs14 coral">The agent service isn't reachable right now.</p>`}
          <div class="row wrap">
            <button class="btn btn-primary" disabled=${this.state.posting || this.state.data.busy || this.state.data.agentsError} onClick=${() => { this.openView('briefing'); this.runEa('morning_brief'); }}>${this.state.posting || this.state.data.busy ? 'EA is running…' : 'Run EA now'}</button>
            <button class="btn btn-secondary" onClick=${() => this.openView('briefing')}>View brief and run status</button>
          </div>
        </section>
        <div class="hero">${this.renderCarousel(v)} ${this.renderDecision(v)}</div>
        ${!this.state.hideSamples && this.renderFocusCards(v)} ${!this.state.hideSamples && this.renderGlance(v)} ${this.renderCalendar(v)}
        ${!this.state.hideSamples && html`<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 12px;">
          ${this.renderHabits(v)} ${this.renderMeals(v)} ${this.renderPeople(v)}
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px;">
          ${this.renderMarkets(v)} ${this.renderProjects(v)}
        </div>`}
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
          src: 'brief',
          primary: { label: 'Open full briefing', briefing: true },
          secondary: { label: 'Plan my day', ask: 'Plan my day around my priorities' },
        }
      : {
          kicker: 'Daily briefing',
          title: greeting,
          body: 'No brief yet. Run the EA to write the first one.',
          src: 'brief',
          primary: { label: 'Run EA now', run: true },
          secondary: { label: 'Open briefing', briefing: true },
        };
    return this.state.hideSamples ? [first] : [first, ...v.mock.slides.map((s) => ({ ...s, src: 'slides' }))];
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
              <span class="fs13" style=${`color: ${i === 0 ? 'var(--n500)' : 'var(--accent-2)'};`}>${s.kicker} ${src(s.src)}</span>
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
      <span class="fs12 steel">Your decisions ${src('decision', this.state.data.actionsError && 'Down')}</span>
      <h2>${this.state.data.actionsError ? 'Proposals unavailable' : v.pending ? `${v.pending} proposal${v.pending === 1 ? '' : 's'} to review` : 'No pending proposals'}</h2>
      <p class="fs14 soft">Inspect the source and details before deciding. Calendar proposals explicitly enabled for creation add an event after approval; manual suggestions stay yours to carry out.</p>
      <button class="btn btn-secondary" onClick=${() => this.go('inbox', 'actions')}>Review proposals in Inbox</button>
    </section>`;
  }

  openProposal(id) {
    this.setState({ view: 'inbox', inboxTab: 'proposals', actionSel: id, actionFilter: 'all', actionHistory: null, actionError: '', pick: null }, () => {
      window.scrollTo(0, 0);
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
      <div class="between wrap" style="gap: 12px;"><h2 style="font-size: 20px;">Proposals ${src('actions', this.state.data.actionsError && 'Down')}</h2>
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
      html`<section class=${`fcard is-sample ${extra}`} ref=${this.cardRefs[id]} style=${L[id].style} onClick=${L[id].onCard}>${body}</section>`;
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
        <h2 class="card-title">Your priorities ${src('pri')}</h2>
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
        <h2 class="card-title">News for you ${src('news')}</h2>
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
    const { mood, energy, checkins, checkinId, checkinError } = this.state;
    const current = (checkins ?? []).find((c) => c.id === checkinId);
    const moodAt = current ? brisbaneClock(Date.parse(current.created_at)) : '';
    if (L.mini) {
      return html`
        <div class="between"><span class="fs13 bright" style="font-weight: 500;">Mood</span><span class="fs11 muted nowrap">${mood === null ? 'Not logged' : moodAt ? `Logged ${moodAt}` : 'Saving…'}</span></div>
        <span class="fs12 dim clamp2">${mood === null ? 'Tap to do your check-in' : `Feeling ${MOODS[mood].toLowerCase()} today`}</span>
      `;
    }
    const slot = v.hour < 15 ? 'Morning check-in · 1 of 2' : 'Evening check-in · 2 of 2';
    const pickMood = (i) => (e) => {
      e.stopPropagation();
      if (mood === i && checkinId) return;
      this.setState({ mood: i });
      this.saveCheckin({ mood: i });
    };
    const pickEnergy = (i) => (e) => {
      e.stopPropagation();
      const next = energy === i ? null : i;
      this.setState({ energy: next });
      this.saveCheckin({ energy: next });
    };
    const saveNote = () => {
      const note = this.state.journal.trim();
      if (checkinId && note !== (current?.note ?? '')) this.saveCheckin({ note });
    };
    const trendDays = Array.from({ length: 7 }, (_, i) => DOW[(v.todayIdx + i + 1) % 7][0]);
    // Each day's average mood from saved check-ins; today shows what is picked now.
    const today = checkinSlot(Date.now()).day;
    const trend = Array.from({ length: 7 }, (_, i) => {
      const day = today - 6 + i;
      const all = (checkins ?? []).filter((c) => c.id !== checkinId || i !== 6).filter((c) => checkinSlot(Date.parse(c.created_at)).day === day).map((c) => c.mood);
      if (i === 6 && mood !== null) all.push(mood);
      return all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null;
    });
    return html`
      <div class="between">
        <h2 class="card-title">How are you feeling? ${src('mood')}</h2>
        <span class="fs12 muted">${slot}</span>
      </div>
      <div class="moods">
        ${MOODS.map((label, i) => html`<span style=${choice(mood === i)} onClick=${pickMood(i)}>${label}</span>`)}
      </div>
      <span class="fs12 muted">
        ${checkinError ? html`<span class="coral">${checkinError}</span>`
          : mood === null ? 'Saved to your log. Moniqr uses it to pace your day. Evening check-in after 3pm.'
          : moodAt ? `Logged ${MOODS[mood].toLowerCase()} at ${moodAt}. Tap again to change it.` : 'Saving…'}
      </span>
      ${L.big &&
      html`
        <div class="rule"></div>
        <span class="fs12 muted">Energy</span>
        <div class="moods">
          ${ENERGY.map((label, i) => html`<span style=${choice(energy === i)} onClick=${pickEnergy(i)}>${label}</span>`)}
        </div>
        <input class="journal" value=${this.state.journal} maxlength="2000" onInput=${(e) => this.setState({ journal: e.target.value })}
          onBlur=${saveNote} onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }}
          placeholder=${checkinId ? 'Anything on your mind? (optional, saved with this check-in)' : 'Anything on your mind? (optional)'} />
        <span class="fs12 muted">Last 7 days</span>
        <div class="trend">
          ${trend.map((val, i) => {
            const isToday = i === 6;
            const bg = val === null
              ? 'color-mix(in srgb, var(--n100) 10%, transparent)'
              : isToday
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
    // The morning brief writes a fresh set each day; until one has, the card shows samples.
    const live = this.state.data?.dailyPick?.items?.length ? this.state.data.dailyPick : null;
    const picks = live ? live.items : v.mock.picks;
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
        <span class="fs12 steel">${pk.kind} ${src(live ? 'pick' : 'pickSample')}</span>
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
        ${live && html`<span class="fs12 muted">From your ${new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'long' }).format(new Date(live.created_at))} morning brief</span>`}
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

  openCalendarForm(f, actions) {
    const cal = actions?.items.find((a) => a.finding_id === f.id && a.kind === 'calendar_create' && a.proposed_action?.calendar?.start)?.proposed_action.calendar;
    const type = cal?.type ?? (f.category === 'commitment' ? 'event' : 'reminder');
    const wall = (iso) => new Date(Date.parse(iso) + 10 * 3_600_000).toISOString(); // Brisbane wall-clock
    const guess = cal ? null : guessWhen(f.deadline_text);
    this.setState({ calError: '', calNotice: null, calForm: {
      findingId: f.id, type, title: cal?.title ?? f.subject, date: cal ? wall(cal.start).slice(0, 10) : guess?.date ?? '', location: cal?.location ?? '',
      start_time: cal && cal.type !== 'reminder' ? wall(cal.start).slice(11, 16) : guess?.start ?? '09:00',
      end_time: cal?.end && cal.type !== 'reminder' ? wall(cal.end).slice(11, 16) : guess?.end ?? '10:00',
    } });
  }

  async addToCalendar(f) {
    const form = this.state.calForm;
    if (this.state.calSaving || !form) return;
    this.setState({ calSaving: true, calError: '' });
    try {
      const body = new URLSearchParams({ type: form.type, title: form.title, date: form.date, location: form.location });
      if (form.type === 'event') { body.set('start_time', form.start_time); body.set('end_time', form.end_time); }
      const r = await fetch(`/findings/${f.id}/calendar`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.issues?.[0]?.message ?? d.error ?? 'It could not be added to your calendar.');
      this.setState({ calForm: null, calNotice: { id: f.id, text: d.action?.execution_status === 'succeeded'
        ? `Added to your calendar as ${form.type === 'reminder' ? 'a reminder' : 'an event'}.` : this.calendarResult(d.action) } });
    } catch (err) { this.setState({ calError: err.message }); }
    finally { await this.load(); this.setState({ calSaving: false }); }
  }

  renderCalendarAdd(f, actions) {
    const { calForm, calSaving, calError, calNotice, actionSaving, actionError } = this.state;
    const notice = calNotice?.id === f.id && html`<span class="fs13 soft" role="status">${calNotice.text}</span>`;
    const entry = actions?.items.find((a) => a.finding_id === f.id && a.kind === 'calendar_create'
      && ['queued', 'executing', 'succeeded', 'uncertain', 'undo_uncertain'].includes(a.execution_status));
    if (entry) {
      const cal = entry.proposed_action?.calendar;
      const reminder = cal?.type === 'reminder';
      const day = cal?.start && new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short',
        ...(reminder ? {} : { hour: 'numeric', minute: '2-digit' }) }).format(new Date(cal.start));
      return html`<div class="cal-add">
        <span class="fs13 soft">${entry.execution_status === 'succeeded'
          ? `On your calendar as ${reminder ? 'a reminder' : 'an event'}: “${cal?.title}”, ${day}.`
          : 'Google has not confirmed this calendar entry yet. Check the result before trying again.'}</span>
        <div class="row wrap">
          ${['uncertain', 'executing'].includes(entry.execution_status) && html`<button class="btn btn-secondary sm" disabled=${actionSaving} onClick=${() => this.calendarOperation(entry, 'execute')}>Check result</button>`}
          ${entry.can_undo && html`<button class="btn btn-ghost sm" disabled=${actionSaving} onClick=${() => this.calendarOperation(entry, 'undo')}>${entry.execution_status === 'undo_uncertain' ? 'Check undo' : 'Undo'}</button>`}
        </div>
        ${notice}${actionError && html`<span class="fs13 coral" role="alert">${actionError}</span>`}
      </div>`;
    }
    if (!actions?.calendar_write_ready) return html`<span class="fs12 muted">Connect calendar write access to add findings to your calendar.</span>`;
    if (calForm?.findingId !== f.id) {
      return html`<div class="cal-add"><div class="row wrap"><button class="btn btn-secondary" onClick=${() => this.openCalendarForm(f, actions)}>Add to calendar</button></div>${notice}</div>`;
    }
    const set = (k) => (e) => this.setState((st) => ({ calForm: { ...st.calForm, [k]: e.currentTarget.value } }));
    const reminder = calForm.type === 'reminder';
    const ready = calForm.title.trim() && calForm.date && (reminder || (calForm.start_time && calForm.end_time));
    return html`<form class="cal-add" onSubmit=${(e) => { e.preventDefault(); this.addToCalendar(f); }}>
      <div class="filters" role="group" aria-label="Calendar entry type" style="align-self: flex-start;">
        ${[['reminder', 'Reminder'], ['event', 'Event']].map(([id, label]) => html`<button type="button" class="btn btn-ghost sm" aria-pressed=${calForm.type === id}
          style=${calForm.type === id ? on('var(--wash-8)') : ''} onClick=${() => this.setState((st) => ({ calForm: { ...st.calForm, type: id } }))}>${label}</button>`)}
      </div>
      <span class="fs12 muted">${reminder ? 'All day on the date and shown as free, with alerts at 9am three days before and the day before. Best for bills, due dates and reports.'
        : 'A timed entry with your usual calendar alerts. Best for bookings and appointments.'}</span>
      <label class="cal-field"><span>Title</span><input type="text" maxlength="200" required value=${calForm.title} onInput=${set('title')} /></label>
      <div class="row wrap" style="gap: 10px;">
        <label class="cal-field"><span>${reminder ? 'Due date' : 'Date'}</span><input type="date" required value=${calForm.date} onInput=${set('date')} /></label>
        ${!reminder && html`<label class="cal-field"><span>Starts</span><input type="time" required value=${calForm.start_time} onInput=${set('start_time')} /></label>
          <label class="cal-field"><span>Ends</span><input type="time" required value=${calForm.end_time} onInput=${set('end_time')} /></label>`}
      </div>
      ${!reminder && html`<label class="cal-field"><span>Location (optional)</span><input type="text" maxlength="500" value=${calForm.location} onInput=${set('location')} /></label>`}
      <span class="fs12 muted">Brisbane time. Added to your main calendar with no guests; you can undo it here.</span>
      ${calError && html`<span class="fs13 coral" role="alert">${calError}</span>`}
      <div class="row wrap">
        <button type="submit" class="btn btn-primary" disabled=${calSaving || !ready}>${calSaving ? 'Adding…' : reminder ? 'Add reminder' : 'Add event'}</button>
        <button type="button" class="btn btn-ghost" disabled=${calSaving} onClick=${() => this.setState({ calForm: null, calError: '' })}>Cancel</button>
      </div>
    </form>`;
  }

  renderInbox(v) {
    const tab = this.state.inboxTab === 'proposals' ? 'proposals' : 'findings';
    const tabs = [
      ['findings', 'Email findings', v.unread ? `${v.unread} new` : ''],
      ['proposals', 'Proposals', this.state.data.actionsError ? '' : v.pending ? `${v.pending} to review` : ''],
    ];
    return html`<div class="col" style="gap: 16px;">
      <div class="filters" role="tablist" aria-label="Inbox sections" style="align-self: flex-start;">
        ${tabs.map(([id, label, count]) => html`<button type="button" role="tab" class="btn btn-ghost sm" id=${`inbox-tab-${id}`}
          aria-selected=${tab === id} aria-controls="inbox-panel" style=${tab === id ? on('var(--wash-8)') : ''}
          onClick=${() => this.setState({ inboxTab: id })}>${label}${count && html` <span class="muted">· ${count}</span>`}</button>`)}
      </div>
      <div id="inbox-panel" role="tabpanel" aria-labelledby=${`inbox-tab-${tab}`}>
        ${tab === 'proposals' ? this.renderActions() : this.renderFindings(v)}
      </div>
    </div>`;
  }

  renderFindings(v) {
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
          <div class="col"><h2 style="font-size: 20px;">Email findings ${src('inbox', this.state.data.findingsError && 'Down')}</h2>
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
              ${this.renderCalendarAdd(selected, data.actions)}
              <div class="row wrap">
                ${selected.status !== 'reviewed' && html`<button class="btn btn-secondary" disabled=${findingSaving} onClick=${() => this.updateFinding(selected.id, 'reviewed')}>Mark reviewed</button>`}
                ${selected.status !== 'dismissed' && html`<button class="btn btn-ghost" disabled=${findingSaving} onClick=${() => this.updateFinding(selected.id, 'dismissed')}>Dismiss</button>`}
                ${selected.status !== 'new' && html`<button class="btn btn-ghost" disabled=${findingSaving} onClick=${() => this.updateFinding(selected.id, 'new')}>Mark new</button>`}
              </div>
              <span class="fs12 muted">Reviewed, dismissed and new update Moniqr only. They do not change your email or pay a bill.</span>
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
          ([label, value, pct, note]) => html`<div class="tile is-sample">
            <span class="fs12 muted">${label} ${src('glance')}</span>
            <span class="v">${value}</span>
            <div class="bar"><div style=${`width: ${pct}%;`}></div></div>
            <span class="fs12 dim">${note}</span>
          </div>`,
        )}
      </section>
    `;
  }

  renderCalendar(v) {
    const full = !!this.state.calFull;
    const PX = full ? PX_FULL : PX_SMALL;
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
    const styleOf = (e) => e.colour ? colourStyle(e.colour) : EV_STYLE[e.kind];
    const setFull = (on) => this.setState({ calFull: on }, () => {
      document.documentElement.classList.toggle('cal-full-open', on);
      if (on) document.querySelector('#calendar .cal-scroll')?.scrollTo({ top: Math.max(0, (v.hour - 2) * PX_FULL) });
    });
    const picked = this.state.pick;
    const calendarStatus = this.state.data.calendar?.status ?? 'disconnected';
    return html`
      <section id="calendar" class=${`col${full ? ' cal-full' : ''}`} style="gap: 12px;" role=${full ? 'dialog' : null} aria-modal=${full ? 'true' : null} aria-label=${full ? 'Calendar, full screen' : null}>
        <div class="row wrap" style="gap: 10px;">
          <button class="btn btn-secondary" style="border-radius: 18px; padding: 6px 16px;">Today</button>
          <h2 style="font-weight: 400; font-size: 20px;">${title} ${src('calendar', calendarStatus === 'error' ? 'Down' : calendarStatus !== 'connected' ? 'Not connected' : null)}</h2>
          <div style="flex: 1;"></div>
          <div class="row wrap fs12 dim" style="gap: 12px;">
            ${[...(v.mock.calendars ?? []).map((c) => ({ ...colourStyle(c.colour), label: c.name })), EV_STYLE.pend].map((c) => html`<span class="row nowrap" style="gap: 6px;"><span class="swatch" style=${swatch(c)}></span>${c.label}</span>`)}
          </div>
          <button type="button" class="btn btn-secondary" style="border-radius: 18px; padding: 6px 14px;" autofocus=${full}
            aria-label=${full ? 'Close full-screen calendar' : 'Open calendar full screen'} onClick=${() => setFull(!full)}>${full ? 'Close' : 'Expand'}</button>
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
                  ${v.mock.allDay.filter((a) => a.day === i).map((a) => a.link
                    ? html`<a class="all-day-ev" href=${a.link} target="_blank" rel="noopener noreferrer" title=${`${a.title} · Open in Google Calendar`} style=${a.colour ? `background: ${a.colour}; color: #fff; text-decoration: none;` : 'text-decoration: none;'}>${a.title}</a>`
                    : html`<span class="all-day-ev" title=${a.title} style=${a.colour ? `background: ${a.colour}; color: #fff;` : ''}>${a.title}</span>`)}
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
                      const c = styleOf(e);
                      const time = `${hhmm(e.start)}–${hhmm(e.start + e.hours)}`;
                      const layout = layouts[i].get(e);
                      // Google events open in Google Calendar to edit there; Moniqr requests open their proposal.
                      const pick = () => e.link ? window.open(e.link, '_blank', 'noopener,noreferrer') : e.actionId ? this.openProposal(e.actionId) :
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
                        title=${`${e.overlay ? 'Moniqr request: ' : ''}${e.title} · ${time}${e.note ? ' · ' + e.note : ''}${e.link ? ' · Open in Google Calendar' : ''}`}
                        onClick=${pick}
                        style=${`top: ${(e.start - H0) * PX}px; height: ${Math.max(e.hours * PX - 2, 18)}px; background: ${c.bg}; border-style: ${c.line}; border-color: ${c.border}; ${e.colour ? `border-left: 3px solid ${c.border};` : ''} color: ${c.fg}; left: ${layout.left}%; width: ${layout.width}%; right: auto;`}
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
      <section class="tile panel is-sample">
        <div class="between"><h2 class="card-title">Habits ${src('habits')}</h2><span class="fs12 muted">${done} of ${v.mock.habits.length} today</span></div>
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
      <section class="tile panel is-sample">
        <div class="between"><h2 class="card-title">Food today ${src('meals')}</h2><span class="fs12 muted">${meals.planned}</span></div>
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
      <section class="tile panel is-sample">
        <h2 class="card-title">People ${src('people')}</h2>
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
      <section class="tile panel is-sample" style="gap: 8px;">
        <div class="between"><h2 class="card-title">Markets this week ${src('markets')}</h2><a class="fs12" href=${finance}>Your portfolio is in Finance</a></div>
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
      <section class="tile panel is-sample">
        <div class="between"><h2 class="card-title">Projects ${src('projects')}</h2><a class="fs12" href=${stack}>All projects</a></div>
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

  dashboardHeader(title, description, app, id) {
    const url = this.state.data.links.find((l) => l.name === app)?.url;
    return html`<header class="dashboard-heading between wrap">
      <div class="col" style="gap: 8px;"><span class="fs12 steel">MONIQR / ${title.toUpperCase()}</span><h1>${title}</h1><p class="muted">${description}</p></div>
      <a class="btn btn-secondary" href=${url}>Open ${app} ↗</a>
    </header><div class="dashboard-notice">${src(id, null, 'flush')}<span>Everything on this page is sample data. ${app} is not connected to moniqr yet.</span></div>`;
  }

  dashboardMetric(label, value, note) {
    return html`<section class="tile panel dashboard-metric"><span class="fs13 muted">${label}</span><strong>${value}</strong><span class="fs12 dim">${note}</span></section>`;
  }

  renderProjectDashboard() {
    const filter = this.state.projectFilter;
    const projects = projectSamples.filter((p) => filter === 'All' || (filter === 'Needs attention' ? !!p.attention : p.status === filter));
    const stack = this.state.data.links.find((l) => l.name === 'Stack')?.url;
    return html`<main class="main dashboard">
      ${this.dashboardHeader('Projects', 'Pick up your work, clear blockers and keep the next step in sight.', 'Stack', 'projects')}
      <div class="dashboard-metrics">
        ${this.dashboardMetric('Projects in motion', '3', 'Across your workspace')}
        ${this.dashboardMetric('Needs attention', '2', '1 blocked · 1 awaiting review')}
        ${this.dashboardMetric('Live projects', '1', 'Stack is up and running')}
        ${this.dashboardMetric('Latest checkpoint', '2h ago', 'Moniqr · dashboard mockups')}
      </div>
      <div class="dashboard-columns">
        <section class="tile panel dashboard-resume"><span class="fs12 steel">PICK UP WHERE YOU LEFT OFF</span><h2>Moniqr</h2><p class="soft">Projects and Finance, right here in your dashboard.</p><p class="muted">The navigation is in place. Next up: review the overview cards and decide what to surface from each app.</p><div class="dashboard-next"><span class="fs12 muted">NEXT STEP</span><p>Finish the Projects and Finance overview</p></div><a class="btn btn-primary" style="align-self: flex-start;" href=${stack}>Continue in Stack ↗</a></section>
        <section class="tile panel"><div class="between"><h2 class="card-title">Needs your attention</h2><span class="badge">2</span></div><div class="dashboard-list-row col"><span class="coral fs12">BLOCKED · FINANCE</span><span>Confirm the categorisation approach</span><p class="fs13 muted">Choose the rules before the next import pass.</p></div><div class="dashboard-list-row col"><span class="steel fs12">REVIEW · MONIQR</span><span>Review the dashboard layouts</span><p class="fs13 muted">Check the content hierarchy for both tabs.</p></div></section>
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
      ${this.dashboardHeader('Finance', 'Your money at a glance. Budgets, cash flow and what needs a look.', 'Finance', 'finance')}
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
      <section class="tile panel"><h2 class="card-title">Upcoming bills</h2>${f.bills.map((b) => html`<div class="dashboard-list-row between"><div class="col"><span>${b.name}</span><span class="fs12 muted">Due ${b.due}</span></div><strong>${money(b.amount)}</strong></div>`)}<span class="fs12 muted">Planned payments · no payments scheduled by moniqr</span></section></div>
      <section class="tile panel"><div class="between wrap"><div class="col" style="gap: 6px;"><h2 class="card-title">A little housekeeping</h2><p class="muted">1 sample transaction needs a category. Review your ledger, budgets and personal or business reports in Finance.</p></div><a class="btn btn-secondary" href=${finance}>Review in Finance ↗</a></div></section>
    </main>`;
  }

  /** Heading for a page that has no app behind it yet: every card on it is sample data. */
  sampleHeader(title, description, id) {
    return html`<header class="dashboard-heading between wrap">
      <div class="col" style="gap: 8px;"><span class="fs12 steel">MONIQR / ${title.toUpperCase()}</span><h1>${title}</h1><p class="muted">${description}</p></div>
    </header><div class="dashboard-notice">${src(id, null, 'flush')}<span>Everything on this page is sample data. ${title} is not wired up yet.</span></div>`;
  }

  renderKnowledge() {
    const k = knowledgeSamples;
    return html`<main class="main dashboard">
      ${this.sampleHeader('Knowledge', 'Your notes, study material and reference documents, searchable in one place.', 'knowledge')}
      <div class="dashboard-metrics">
        ${this.dashboardMetric('Notes and documents', String(k.collections.reduce((n, c) => n + c.count, 0)), `Across ${k.collections.length} collections`)}
        ${this.dashboardMetric('Added this week', '7', '4 study · 3 admin')}
        ${this.dashboardMetric('Due for review', String(k.review.filter((r) => r.due === 'Today').length), 'Flashcards today')}
        ${this.dashboardMetric('Study streak', '5 days', 'Keep it going')}
      </div>
      <div class="dashboard-projects">${k.collections.map((c) => html`<article class="tile panel"><div class="between"><span class="fs12 muted">Collection</span><span class="fs12 steel">${c.count} items</span></div><h3>${c.name}</h3><p class="fs13 muted">${c.note}</p><span class="fs12 dim">Updated ${c.updated}</span></article>`)}</div>
      <div class="dashboard-columns">
        <section class="tile panel"><div class="between"><h2 class="card-title">Recently added</h2><span class="fs12 muted">All collections</span></div>${k.recent.map((r) => html`<div class="dashboard-list-row between wrap"><div class="col"><span>${r.title}</span><span class="fs12 muted">${r.source}</span></div><span class="fs12 muted">${r.when}</span></div>`)}</section>
        <section class="tile panel"><div class="between"><h2 class="card-title">Review queue</h2><span class="badge">${k.review.length}</span></div>${k.review.map((r) => html`<div class="dashboard-list-row col"><span class=${`fs12 ${r.due === 'Today' ? 'steel' : 'muted'}`}>DUE ${r.due.toUpperCase()}</span><span>${r.q}</span></div>`)}</section>
      </div>
    </main>`;
  }

  renderAgentsPage() {
    return html`<${Workforce} />`;
  }

  renderLife() {
    const l = lifeSamples;
    return html`<main class="main dashboard">
      ${this.sampleHeader('Life', 'Goals, health, people and reflection, outside work and study.', 'life')}
      <div class="dashboard-metrics">${l.health.map(([label, value, note]) => this.dashboardMetric(label, value, note))}</div>
      <section class="col" style="gap: 16px;"><h2>Goals</h2>
        <div class="dashboard-projects">${l.goals.map((g) => html`<article class="tile panel"><h3>${g.name}</h3><p class="fs13 muted">${g.note}</p><div class="between fs12"><span class="dim">Progress</span><span>${g.progress}%</span></div><div class="bar"><div style=${`width: ${g.progress}%`}></div></div></article>`)}</div>
      </section>
      <div class="dashboard-columns">
        <section class="tile panel"><h2 class="card-title">People</h2>${l.people.map((p) => html`<div class="dashboard-list-row col"><span>${p.name}</span><span class="fs13 muted">${p.note}</span></div>`)}</section>
        <section class="tile panel"><div class="between"><h2 class="card-title">Weekly reflection</h2><span class="fs12 muted">Sunday</span></div><p class="soft">${l.journal}</p></section>
      </div>
    </main>`;
  }

  renderBriefing(v) {
    return renderBriefing(this, v, src);
  }
}

const root = document.getElementById('app');
root.textContent = '';
render(html`<${App} />`, root);
mountConsole();
