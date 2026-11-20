// The moniqr console. Right-click anywhere in moniqr (or press Ctrl+J) for an "Ask moniqr" button that opens
// a small terminal-styled session with the EA. Each message queues a read-only Codex run on the agent service
// (POST /chat); this page polls /api/chat/:id for the reply. moniqr can read the calendar, email and inbox
// state here but cannot act, so nothing typed in the console sends, books, pays or changes anything.
// The conversation lives in this tab's sessionStorage, so it survives a reload and clears when the tab closes.
// Other scripts open it without importing this module (home.js is also served signed out) by dispatching
//   window.dispatchEvent(new CustomEvent('moniqr:ask', { detail: { text, send } }))
// which is how the touch-screen topbar button and the dashboard's Ask box reach it.
import { Component, html, render } from '/vendor/preact-htm.js';

const STORE = 'moniqr-console';
const POLL_MS = 1500;
const GIVE_UP_MS = 12 * 60_000;
const MAX_SENT = 30;
const MAX_CHARS = 20_000;
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const TOOL_NAMES = {
  get_events: 'calendar', list_calendars: 'calendar', search_email: 'email', read_email: 'email',
  get_daily_admin: 'inbox', list_action_proposals: 'decisions',
};

const readStore = () => {
  try { return JSON.parse(sessionStorage.getItem(STORE) ?? 'null') ?? {}; } catch { return {}; }
};
const writeStore = (value) => {
  try { sessionStorage.setItem(STORE, JSON.stringify(value)); } catch {}
};

/** The conversation the agent sees: Bailey's messages and moniqr's replies, newest last, within the API's limits. */
export function outgoing(log) {
  const turns = log.filter((m) => m.role === 'user' || m.role === 'moniqr').map((m) => ({ role: m.role, text: m.text }));
  let total = 0;
  const kept = [];
  for (let i = turns.length - 1; i >= 0 && kept.length < MAX_SENT; i--) {
    total += turns[i].text.length;
    if (total > MAX_CHARS && kept.length) break;
    kept.unshift(turns[i]);
  }
  while (kept.length && kept[0].role !== 'user') kept.shift();
  return kept;
}

/** True when the right-click should keep the browser's own menu: fields, links, the console itself, or Shift held. */
export function keepNativeMenu(event) {
  if (event.shiftKey) return true;
  const el = event.target instanceof Element ? event.target : null;
  return !!el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], a[href], .mq-console');
}

/** **bold** only; everything else is shown as written. */
function inline(text) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? html`<strong>${part.slice(2, -2)}</strong>` : part);
}

class MoniqrConsole extends Component {
  constructor() {
    super();
    const saved = readStore();
    this.state = {
      menu: null, open: !!saved.open, log: Array.isArray(saved.log) ? saved.log : [], pending: saved.pending ?? null,
      draft: '', status: null, frame: 0, pos: null, history: -1,
    };
  }

  inputRef = (el) => (this.inputEl = el);
  logRef = (el) => (this.logEl = el);
  menuButtonRef = (el) => (this.menuButtonEl = el);

  componentDidMount() {
    this.onContext = (e) => {
      if (keepNativeMenu(e)) return;
      e.preventDefault();
      const selection = String(window.getSelection?.() ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
      const x = Math.min(e.clientX, window.innerWidth - 240), y = Math.min(e.clientY, window.innerHeight - 110);
      this.setState({ menu: { x: Math.max(8, x), y: Math.max(8, y), selection } });
    };
    this.onDown = (e) => {
      if (this.state.menu && !(e.target instanceof Element && e.target.closest('.mq-menu'))) this.setState({ menu: null });
    };
    this.onKey = (e) => {
      if (e.key === 'Escape' && this.state.menu) this.setState({ menu: null });
      else if (e.key === 'Escape' && this.state.open && document.activeElement?.closest?.('.mq-console')) this.close();
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        this.state.open ? this.close() : this.openConsole('');
      }
    };
    this.onAway = () => this.state.menu && this.setState({ menu: null });
    this.onAsk = (e) => {
      const text = typeof e.detail?.text === 'string' ? e.detail.text.trim() : '';
      if (text && e.detail.send && !this.state.pending) this.setState({ draft: text, open: true, menu: null }, () => this.send());
      else this.openConsole(text);
    };
    window.addEventListener('moniqr:ask', this.onAsk);
    window.addEventListener('contextmenu', this.onContext);
    window.addEventListener('pointerdown', this.onDown, true);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onAway);
    window.addEventListener('scroll', this.onAway, true);
    if (this.state.pending) this.poll();
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
    clearInterval(this.spinner);
    window.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('pointerdown', this.onDown, true);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onAway);
    window.removeEventListener('scroll', this.onAway, true);
    window.removeEventListener('moniqr:ask', this.onAsk);
  }

  componentDidUpdate(_props, prev) {
    const { open, log, pending } = this.state;
    if (open !== prev.open || log !== prev.log || pending !== prev.pending) writeStore({ open, log: log.slice(-60), pending });
    if (this.state.menu && !prev.menu) this.menuButtonEl?.focus();
    if (open && (!prev.open || log !== prev.log || pending !== prev.pending)) this.logEl?.scrollTo({ top: this.logEl.scrollHeight });
    if (open && !prev.open) this.inputEl?.focus();
    if (pending && !this.spinner) this.spinner = setInterval(() => this.setState((s) => ({ frame: s.frame + 1 })), 100);
    if (!pending && this.spinner) { clearInterval(this.spinner); this.spinner = null; }
  }

  openConsole(prefill) {
    this.setState((s) => ({ menu: null, open: true, draft: prefill || s.draft }), () => {
      this.inputEl?.focus();
      this.inputEl?.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
    });
  }

  close() {
    this.setState({ open: false, menu: null });
  }

  clear() {
    if (this.state.pending) return;
    this.setState({ log: [], draft: '', history: -1 });
  }

  note(text) {
    this.setState((s) => ({ log: [...s.log, { role: 'note', text }] }));
  }

  async send() {
    const text = this.state.draft.trim();
    if (!text || this.state.pending) return;
    if (text === '/clear' || text === 'clear') return void this.clear();
    if (text === '/help' || text === 'help') {
      this.setState({ draft: '' });
      return void this.note('Ask about your day, calendar, email, bills or decisions. moniqr can read but not act. ' +
        'Enter sends, ↑ recalls your last message, clear starts again, Esc closes. Right-click anywhere or press Ctrl+J to come back.');
    }
    const log = [...this.state.log, { role: 'user', text }];
    this.setState({ log, draft: '', history: -1, pending: { id: null, since: Date.now() }, status: 'sending' });
    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ messages: outgoing(log) }),
      });
      if (res.status === 401) return void location.assign('/login');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `The console returned ${res.status}.`);
      this.setState({ pending: { id: body.id, since: Date.now() }, status: 'queued' }, () => this.poll());
    } catch (err) {
      this.setState((s) => ({ pending: null, status: null, log: [...s.log, { role: 'error', text: err.message || 'moniqr could not be reached.' }] }));
    }
  }

  async poll() {
    clearTimeout(this.timer);
    const pending = this.state.pending;
    if (!pending?.id) return void this.setState({ pending: null });
    if (Date.now() - pending.since > GIVE_UP_MS) {
      return void this.setState((s) => ({ pending: null, status: null, log: [...s.log, { role: 'error', text: 'No reply after 12 minutes. The runner may be busy or offline; try again shortly.' }] }));
    }
    try {
      const res = await fetch(`/api/chat/${pending.id}`, { headers: { accept: 'application/json' } });
      if (res.status === 401) return void location.assign('/login');
      if (res.status === 404) throw Object.assign(new Error('That reply is no longer available.'), { final: true });
      const run = await res.json();
      if (this.state.pending?.id !== pending.id) return;
      if (run.status === 'done' && run.reply) {
        const tools = [...new Set((run.tools ?? []).map((t) => TOOL_NAMES[t]).filter(Boolean))];
        return void this.setState((s) => ({ pending: null, status: null, log: [...s.log, { role: 'moniqr', text: run.reply.trim(), tools }] }));
      }
      if (run.status === 'failed' || run.status === 'done') {
        return void this.setState((s) => ({ pending: null, status: null, log: [...s.log, { role: 'error', text: `moniqr couldn't answer: ${run.error ?? 'no reply came back'}` }] }));
      }
      this.setState({ status: run.status });
    } catch (err) {
      if (err.final) return void this.setState((s) => ({ pending: null, status: null, log: [...s.log, { role: 'error', text: err.message }] }));
    }
    this.timer = setTimeout(() => this.poll(), POLL_MS);
  }

  onInputKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    } else if (e.key === 'ArrowUp' && (!this.state.draft || this.state.history >= 0)) {
      const mine = this.state.log.filter((m) => m.role === 'user');
      const history = Math.min(this.state.history + 1, mine.length - 1);
      if (history < 0) return;
      e.preventDefault();
      this.setState({ history, draft: mine[mine.length - 1 - history].text });
    } else if (e.key === 'ArrowDown' && this.state.history >= 0) {
      e.preventDefault();
      const mine = this.state.log.filter((m) => m.role === 'user');
      const history = this.state.history - 1;
      this.setState({ history, draft: history < 0 ? '' : mine[mine.length - 1 - history].text });
    }
  };

  // Drag the console by its title bar.
  onGrab = (e) => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest('button'))) return;
    if (matchMedia('(max-width: 760px)').matches) return; // full screen on phones, nothing to drag
    const panel = e.currentTarget.parentElement.getBoundingClientRect();
    const dx = e.clientX - panel.left, dy = e.clientY - panel.top;
    const move = (ev) => this.setState({ pos: {
      x: Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - panel.width),
      y: Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 48),
    } });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  renderMenu() {
    const { menu } = this.state;
    const about = menu.selection ? `About “${menu.selection}”: ` : '';
    return html`
      <div class="mq-menu" role="menu" style=${`left: ${menu.x}px; top: ${menu.y}px;`}>
        <button type="button" role="menuitem" class="mq-menu-item" ref=${this.menuButtonRef} onClick=${() => this.openConsole(about)}>
          <span class="mq-glyph" aria-hidden="true">›_</span>
          <span class="grow">${menu.selection ? 'Ask moniqr about this' : 'Ask moniqr'}</span>
          <kbd>Ctrl J</kbd>
        </button>
        <span class="mq-menu-hint">Shift + right-click for the browser menu</span>
      </div>`;
  }

  renderLine(m, i) {
    if (m.role === 'user') return html`<div class="mq-line mq-you" key=${i}><span class="mq-prompt" aria-hidden="true">›</span><span class="mq-text">${m.text}</span></div>`;
    if (m.role === 'moniqr') {
      return html`<div class="mq-line mq-reply" key=${i}>
        <span class="mq-text">${inline(m.text)}</span>
        ${m.tools?.length > 0 && html`<span class="mq-meta">checked ${m.tools.join(' · ')}</span>`}
      </div>`;
    }
    return html`<div class=${`mq-line ${m.role === 'error' ? 'mq-error' : 'mq-note'}`} key=${i}><span class="mq-text">${m.text}</span></div>`;
  }

  renderConsole() {
    const { log, pending, status, frame, draft, pos } = this.state;
    const secs = pending ? Math.max(0, Math.floor((Date.now() - pending.since) / 1000)) : 0;
    const waiting = status === 'queued' ? 'waiting for the runner' : status === 'running' ? 'thinking' : 'sending';
    const place = pos ? `left: ${pos.x}px; top: ${pos.y}px; right: auto; bottom: auto;` : '';
    return html`
      <section class="mq-console" role="dialog" aria-modal="false" aria-labelledby="mq-title" style=${place}>
        <header class="mq-bar" onPointerDown=${this.onGrab}>
          <span class="mq-mark" aria-hidden="true">M</span>
          <span id="mq-title" class="mq-name">moniqr</span>
          <span class="mq-chip" title="moniqr can read your calendar, email and inbox here, but cannot send, book, pay or change anything">codex · read-only</span>
          <span class=${`mq-dot ${pending ? 'busy' : ''}`} aria-hidden="true"></span>
          <span class="grow"></span>
          <button type="button" class="mq-btn" onClick=${() => this.clear()} disabled=${!!pending || !log.length}>Clear</button>
          <button type="button" class="mq-btn" aria-label="Close the console" onClick=${() => this.close()}>✕</button>
        </header>
        <div class="mq-log" role="log" aria-live="polite" aria-label="Conversation with moniqr" ref=${this.logRef}>
          ${!log.length && html`<div class="mq-line mq-note"><span class="mq-text">moniqr console. Ask about today, your calendar, email, bills or decisions. I can read everything here but can't act, so nothing you type sends, books or pays. Type help for keys.</span></div>`}
          ${log.map((m, i) => this.renderLine(m, i))}
          ${pending && html`<div class="mq-line mq-wait"><span class="mq-spin" aria-hidden="true">${SPIN[frame % SPIN.length]}</span><span class="mq-text">${waiting}… ${secs}s</span></div>`}
        </div>
        <form class="mq-input" onSubmit=${(e) => { e.preventDefault(); this.send(); }}>
          <span class="mq-prompt" aria-hidden="true">›</span>
          <input ref=${this.inputRef} aria-label="Message moniqr" value=${draft} maxlength="4000" autocomplete="off" spellcheck="true"
            placeholder=${pending ? 'moniqr is answering…' : 'Ask moniqr…'}
            onInput=${(e) => this.setState({ draft: e.target.value, history: -1 })} onKeyDown=${this.onInputKey} />
          <button type="submit" class="mq-send" disabled=${!!pending || !draft.trim()} aria-label="Send">↵</button>
        </form>
      </section>`;
  }

  render() {
    return html`${this.state.menu && this.renderMenu()}${this.state.open && this.renderConsole()}`;
  }
}

/** Mounts the console once, outside the dashboard's own tree, so it keeps its session across views. */
export function mountConsole() {
  if (document.getElementById('moniqr-console')) return;
  const host = document.createElement('div');
  host.id = 'moniqr-console';
  document.body.append(host);
  render(html`<${MoniqrConsole} />`, host);
}
