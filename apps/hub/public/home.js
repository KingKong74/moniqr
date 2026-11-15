// Home, the landing page from the moniqr design system: a greeting, the energy orb with today's
// items orbiting it, the latest brief and what's waiting on Bailey. Everything shown is live:
// today's Google Calendar events, today's brief and pending Moniqr proposals. Nothing here
// approves or sends anything; review buttons open Action review in HQ.
import { Component, html } from '/vendor/preact-htm.js';
import { calendarLayers } from './calendar-overlay.js';
import './energy-orb.js';

const DAY_MS = 86_400_000;
const BNE = 10 * 3_600_000; // Brisbane has no daylight saving.
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (h) => `${pad(Math.floor(h))}:${pad(Math.floor((h % 1) * 60))}`;
const col = (hue) => `oklch(0.7 0.13 ${hue})`;

// Lucide icon paths (ISC licence), drawn inline so the page needs no third-party requests.
const ICONS = {
  sunrise: '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  plus: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="M12 14v4"/><path d="M10 16h4"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  food: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  left: '<path d="M15 6l-6 6l6 6"/>',
  right: '<path d="M9 6l6 6l-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
};
export const icon = (name, color = 'currentColor', width = 2) =>
  html`<svg viewBox="0 0 24 24" fill="none" stroke=${color} stroke-width=${width} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICONS[name] }}></svg>`;

/** A sensible icon and hue for a calendar event, from its title. */
function eventLook(title, i) {
  const t = title.toLowerCase();
  if (/gym|run|swim|train|yoga|pilates|workout|walk|ride|physio/.test(t)) return { icon: 'activity', hue: 40 };
  if (/lunch|dinner|breakfast|brunch|coffee|meal|drinks/.test(t)) return { icon: 'food', hue: 160 };
  if (/meet|call|catch.?up|1:1|interview|sync|standup|stand-up/.test(t)) return { icon: 'people', hue: 285 };
  if (/class|lecture|tutorial|exam|study|assignment|lab/.test(t)) return { icon: 'book', hue: 75 };
  return { icon: 'calendar', hue: [75, 210, 285, 40, 160][i % 5] };
}

/** Today's items in Brisbane time, oldest first: the brief, events and dated Moniqr requests. */
export function todayItems(data, nowMs) {
  const dayStart = Math.floor((nowMs + BNE) / DAY_MS) * DAY_MS - BNE;
  const dayEnd = dayStart + DAY_MS;
  const todayIso = new Date(dayStart + BNE).toISOString().slice(0, 10);
  const time = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: 'numeric', minute: '2-digit' });
  const items = [];
  const brief = data.brief;
  if (brief?.at && Date.parse(brief.at) >= dayStart && Date.parse(brief.at) < dayEnd) {
    const at = Date.parse(brief.at);
    items.push({ key: 'brief', h: (at - dayStart) / 3_600_000, end: at, icon: 'sunrise', hue: 210, agent: 'Brief',
      label: `${brief.kind} ready`, short: brief.kind, sub: 'Ready to read', detail: brief.summary || 'Your latest brief is ready to read.', open: 'briefing' });
  }
  const layers = calendarLayers(data.calendar?.events ?? [], data.actions?.items ?? [], true, nowMs);
  layers.events.forEach((e, i) => {
    if (e.response === 'declined') return;
    if (e.allDay) {
      if (!(e.start <= todayIso && todayIso < e.end)) return;
      items.push({ key: `e${i}`, h: 0, allDay: true, end: dayEnd, ...eventLook(e.title, i), agent: 'Calendar',
        label: e.title, short: e.title, sub: 'All day', detail: [e.calendar, e.location].filter(Boolean).join(' · ') || 'All-day event', open: 'calendar' });
      return;
    }
    const start = Date.parse(e.start), end = Date.parse(e.end);
    if (!(start < dayEnd && end > dayStart)) return;
    const h = Math.max(0, (start - dayStart) / 3_600_000);
    items.push({ key: `e${i}`, h, end, ...eventLook(e.title, i), agent: e.actionId ? 'Added by Moniqr' : 'Calendar',
      label: e.title, short: e.title, sub: `${time.format(new Date(start)).replace(' ', '').toLowerCase()}${e.location ? ' · ' + e.location : ''}`,
      detail: [e.location, e.calendar].filter(Boolean).join(' · ') || 'Calendar event', open: 'calendar' });
  });
  for (const r of layers.requests) {
    const start = Date.parse(r.start), end = Date.parse(r.end);
    if (!(start < dayEnd && end > dayStart)) continue;
    items.push({ key: `r${r.actionId}`, h: Math.max(0, (start - dayStart) / 3_600_000), end, icon: 'plus', hue: 340, agent: 'Moniqr request',
      label: r.title, short: r.title, sub: 'Needs your review', detail: `${r.calendar}. Review it in HQ before anything is added to your calendar.`,
      review: true, actionId: r.actionId, open: 'actions' });
  }
  items.sort((a, b) => a.h - b.h);
  const nowH = (nowMs - dayStart) / 3_600_000;
  const next = items.find((x) => !x.allDay && x.h > nowH);
  for (const x of items) {
    x.time = x.allDay ? 'All day' : hhmm(x.h);
    x.past = !x.allDay && !x.review && x.end <= nowMs;
    x.status = x === next ? 'Next' : x.past ? 'Done' : '';
  }
  return items;
}

export class Home extends Component {
  state = { sel: null, listOpen: false, phases: [] };
  orbRef = (el) => (this.orbEl = el);

  componentDidMount() {
    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.yaw = 0; this.pitch = 0; this.vy = 0; this.vp = 0;
    let last = 0, prev = 0;
    const loop = (ts) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (ts - (prev || ts)) / 1000); prev = ts;
      const still = this.reduced?.matches;
      let moved = false;
      if (!this.drag && (Math.abs(this.vy) > 1e-4 || Math.abs(this.vp) > 1e-4)) {
        this.yaw += this.vy; this.pitch = Math.max(-1, Math.min(1, this.pitch + this.vp));
        this.vy *= 0.88; this.vp *= 0.88; moved = true;
      }
      if (still && !moved) return;
      const ps = this.ps || (this.ps = []);
      if (!still) for (let i = 0; i < 12; i++) if (i !== this.state.sel) ps[i] = (ps[i] || 0) + dt;
      if (ts - last < 33) return;
      last = ts; this.setState({ phases: ps.slice() });
    };
    this.raf = requestAnimationFrame(loop);
    this.onKey = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '') || e.metaKey || e.ctrlKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); this.step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.step(-1); }
      else if (e.key === 'Escape' && (this.state.sel != null || this.state.listOpen)) this.setState({ sel: null, listOpen: false });
    };
    window.addEventListener('keydown', this.onKey);
  }

  componentWillUnmount() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.endDrag?.();
  }

  step(d) {
    const n = this.items?.length ?? 0;
    if (!n) return;
    this.setState((s) => ({ listOpen: false, sel: s.sel == null ? (d > 0 ? 0 : n - 1) : (s.sel + d + n) % n }));
  }

  dragStart = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const sx = e.clientX, sy = e.clientY, y0 = this.yaw, p0 = this.pitch;
    let lx = sx, ly = sy;
    this.drag = true; this.moved = false; this.vy = 0; this.vp = 0;
    const mv = (ev) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 4) this.moved = true;
      this.vy = -(ev.clientX - lx) * 0.0035; this.vp = (ev.clientY - ly) * 0.0035; lx = ev.clientX; ly = ev.clientY;
      this.yaw = y0 - (ev.clientX - sx) * 0.0035; this.pitch = Math.max(-1, Math.min(1, p0 + (ev.clientY - sy) * 0.0035));
      this.forceUpdate();
    };
    const up = () => { this.drag = false; this.endDrag = null; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); this.forceUpdate(); };
    this.endDrag = up;
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  orbClick = () => {
    if (this.moved) { this.moved = false; return; }
    this.setState({ listOpen: true, sel: null });
  };

  render({ data, now, name, theme, pending, unread, onTheme, go }) {
    const dark = theme === 'dark';
    const items = (this.items = todayItems(data, now));
    const sel = this.state.sel != null && this.state.sel < items.length ? this.state.sel : null;
    const phs = this.state.phases;
    const cY = Math.cos(this.yaw || 0), sY = Math.sin(this.yaw || 0), cP = Math.cos(this.pitch || 0), sP = Math.sin(this.pitch || 0);
    // The design's orbits, with the nearest eight items on the sphere and the rest in the list.
    const shown = items.length > 8 ? items.filter((x) => !x.past).slice(0, 8) : items;
    const chips = shown.map((e, n) => {
      const i = items.indexOf(e);
      const sp = 0.07 + (n % 3) * 0.025, th = n * 2.3 + (phs[i] || 0) * sp * (n % 2 ? -1 : 1);
      const inc = 0.35 + (n % 3) * 0.32, node = n * 1.05, r = 0.44 + (n % 2) * 0.05;
      const x0 = Math.cos(th), y0 = -Math.sin(th) * Math.sin(inc), za = Math.sin(th) * Math.cos(inc);
      const xa = x0 * Math.cos(node) - y0 * Math.sin(node), ya = x0 * Math.sin(node) + y0 * Math.cos(node);
      const x = xa * cY - za * sY, z1 = xa * sY + za * cY, y = ya * cP + z1 * sP, z = -ya * sP + z1 * cP;
      const behind = z < 0 && Math.hypot(x, y) * r < 0.36;
      return { e, i, x: 50 + x * r * 100, y: 50 + y * r * 100, z, front: z >= 0,
        scale: (0.82 + (z + 1) * 0.14).toFixed(3), blur: z < -0.2 ? `blur(${((-z - 0.2) * 1.6).toFixed(2)}px)` : 'none',
        opacity: ((e.past ? 0.62 : 1) * (behind ? 0.35 : z < 0 ? 0.6 + (z + 1) * 0.4 : 1)).toFixed(3) };
    });
    const selChip = sel != null ? chips.find((c) => c.i === sel) : null;
    const selItem = sel != null ? items[sel] : null;
    const briefToday = items.some((x) => x.key === 'brief');
    const left = items.filter((x) => !x.past && !x.allDay && !x.review && x.key !== 'brief').length;
    const pendingItems = (data.actions?.items ?? []).filter((a) => a.status === 'pending' && !a.source_snapshot?.demo);
    const greeting = (() => { const h = new Date(now + BNE).getUTCHours(); return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })();
    const lede = data.agentsError
      ? 'The agent service isn’t reachable right now, so some of today may be missing.'
      : `${briefToday ? 'Your brief is ready' : 'No brief yet today'}, ${left ? `${left} thing${left === 1 ? '' : 's'} still on the calendar` : 'nothing else on the calendar'} and ${pending ? `${pending} waiting on your yes` : 'nothing waiting on you'}.`;
    const dateLabel = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(now));
    const open = (x) => go(x.open === 'briefing' ? 'briefing' : 'hq', x.open === 'actions' ? 'actions' : x.open === 'calendar' ? 'calendar' : null, x.actionId);
    const tabs = [
      { label: 'Home', on: true, go: () => {} },
      { label: 'HQ', go: () => go('hq') },
      { label: 'Inbox', count: unread, go: () => go('hq', 'inbox') },
      { label: 'Projects', go: () => go('projects') },
      { label: 'Finance', go: () => go('finance') },
    ];
    return html`
      <div class="home">
        ${backdrops}
        <div class="home-inner">
          <header class="home-head">
            <button type="button" class="home-brand" onClick=${onTheme} title=${dark ? 'Switch to light mode' : 'Switch to dark mode'}>
              <span class="brand-mark"><img class="ic-light" src="/assets/moniqr-icon-light.png" alt="" /><img class="ic-dark" src="/assets/moniqr-icon-dark.png" alt="" /></span>
              <span class="word">moniqr</span>
            </button>
            <nav class="home-tabs" aria-label="Sections">
              ${tabs.map((t) => html`<button type="button" class=${t.on ? 'on' : ''} aria-current=${t.on ? 'page' : null} onClick=${t.go}>
                ${t.label}${t.count ? html`<span class="count">${t.count}</span>` : null}</button>`)}
            </nav>
            <div class="home-actions">
              <button type="button" class="home-ghost round" onClick=${onTheme} aria-label=${dark ? 'Switch to light mode' : 'Switch to dark mode'}>${icon(dark ? 'sun' : 'moon')}</button>
              <form method="post" action="/logout"><button type="submit" class="home-ghost" title=${`Signed in as ${data.email}`}>Sign out</button></form>
            </div>
          </header>

          <section class="home-hero">
            <h1>${greeting}${name ? `, ${name}` : ''}</h1>
            <p>${lede}</p>
            <div class="home-ctas">
              <button type="button" class="home-cta" onClick=${() => this.setState({ listOpen: true, sel: null })}>Read today’s list</button>
              <button type="button" class="home-link" onClick=${() => go('hq', 'inbox')}>Open inbox${unread ? ` · ${unread} new` : ''}</button>
            </div>
          </section>

          <section class="home-stage-wrap">
            <div class="home-stage">
              <button type="button" class="home-card left" onClick=${() => go(data.brief ? 'briefing' : 'hq')}>
                <span class="t"><i style=${`background: ${col(210)};`}></i>Your latest brief</span>
                ${data.brief
                  ? html`<p class="clamp3">${data.brief.summary || 'Open it to read the full brief.'}</p><span class="meta">${data.brief.kind} · ${data.brief.when}</span>`
                  : html`<p>No brief yet. Run the EA from HQ and it will appear here.</p>`}
              </button>

              <div class=${`orb${this.drag ? ' dragging' : ''}`} ref=${this.orbRef} onPointerDown=${this.dragStart} onClick=${this.orbClick}
                title="Drag to turn · click for today’s list">
                <energy-orb mode=${dark ? 'orange' : 'blue'} motion=${this.reduced?.matches ? 'false' : 'true'}
                  yaw=${String(this.yaw || 0)} pitch=${String(this.pitch || 0)} grid=${this.drag ? '1' : '0'}></energy-orb>
                <svg class="links" viewBox="0 0 100 100" preserveAspectRatio="none" style="z-index: 2;" aria-hidden="true">
                  ${chips.slice(1).map((b, k) => { const a = chips[k], depth = Math.min(a.z, b.z);
                    return html`<line x1=${a.x} y1=${a.y} x2=${b.x} y2=${b.y} stroke=${col(a.e.hue)} stroke-opacity=${(0.18 + 0.36 * (depth + 1) / 2).toFixed(3)}
                      stroke-width="1.2" stroke-dasharray="2 3" vector-effect="non-scaling-stroke" />`; })}
                </svg>
                ${chips.map((c) => html`<div key=${c.e.key} class=${`orb-chip${c.i === sel ? ' sel' : ''}`}
                  style=${`left: ${c.x}%; top: ${c.y}%; z-index: ${c.front ? 3 : 0};`}>
                  <button type="button" title=${c.e.label} aria-label=${`${c.e.time} ${c.e.label}`}
                    style=${`transform: translate(-50%, -50%) scale(${c.scale}); filter: ${c.blur}; opacity: ${c.opacity};`}
                    onClick=${(ev) => { ev.stopPropagation(); this.setState((s) => ({ sel: s.sel === c.i ? null : c.i, listOpen: false })); }}>
                    <span class="ic" style=${`filter: drop-shadow(0 0 6px ${col(c.e.hue)});`}>${icon(c.e.icon, col(c.e.hue), 2.2)}
                      ${c.e.past && html`<span class="ok">${icon('check', '#fff', 4)}</span>`}</span>
                    <span><b>${c.e.short}</b><small>${c.e.sub}</small></span>
                  </button>
                </div>`)}
                ${!items.length && html`<div class="orb-chip" style="left: 50%; top: 50%; z-index: 3;"><button type="button" style="transform: translate(-50%, -50%); opacity: .9;" onClick=${(ev) => { ev.stopPropagation(); go('hq', 'calendar'); }}>
                  <span><b>${data.calendar?.status === 'connected' ? 'Nothing on today' : 'Calendar not connected'}</b></span></button></div>`}
                ${selItem && html`<div class="home-pop" onClick=${(e) => e.stopPropagation()} onPointerDown=${(e) => e.stopPropagation()}
                  style=${`left: ${Math.min(80, Math.max(20, selChip ? selChip.x : 50))}%; top: ${selChip ? Math.max(18, selChip.y) : 50}%;`} role="dialog" aria-label=${selItem.label}>
                  <div class="h">${icon(selItem.icon, col(selItem.hue))}
                    <span class="grow" style="min-width: 0;"><b>${selItem.label}</b><small>${selItem.agent} · ${selItem.time}</small></span>
                    <button type="button" class="home-round" aria-label="Close" onClick=${() => this.setState({ sel: null })}>×</button></div>
                  <p>${selItem.detail}</p>
                  <div class="f">
                    <div class="row">
                      <button type="button" class="home-round" aria-label="Previous" onClick=${() => this.step(-1)}>${icon('left', 'currentColor', 2.2)}</button>
                      <button type="button" class="home-round" aria-label="Next" onClick=${() => this.step(1)}>${icon('right', 'currentColor', 2.2)}</button>
                      <span class="fs12" style=${`font-weight: 500; color: ${selItem.status === 'Next' ? 'var(--next)' : selItem.status === 'Done' ? 'var(--done-ok)' : 'var(--done)'};`}>${selItem.status || 'Upcoming'}</span>
                    </div>
                    <button type="button" class=${`home-pill${selItem.review ? '' : ' soft'}`} onClick=${() => open(selItem)}>${selItem.review ? 'Review' : 'Open'}</button>
                  </div>
                </div>`}
              </div>

              <button type="button" class="home-card right" onClick=${() => go('hq', 'actions')}>
                <span class="t"><i style="background: var(--accent-dot);"></i>Waiting on you</span>
                ${data.actionsError ? html`<p>Proposals couldn’t load. HQ retries automatically.</p>`
                  : pending ? html`<p>${pending} proposal${pending === 1 ? '' : 's'} to review${pendingItems.length ? ': ' + pendingItems.slice(0, 3).map((a) => a.title).join(', ') : ''}. Nothing goes out until you say so.</p>`
                  : html`<p>Nothing needs your yes right now.</p>`}
                <span class="meta">Action review</span>
              </button>

              ${this.state.listOpen && html`<div class="home-list" role="dialog" aria-label="Today">
                <div class="hd"><span><b>Today</b><small>${dateLabel}</small></span>
                  <button type="button" class="home-pill soft" onClick=${() => this.setState({ listOpen: false })}>Close</button></div>
                ${!items.length && html`<p class="home-empty">${data.calendar?.status === 'connected' ? 'Nothing on the calendar today.' : 'The calendar isn’t connected, so today is empty here.'}</p>`}
                ${items.map((r, i) => html`<button type="button" class="home-row" key=${r.key} style=${`opacity: ${r.past ? 0.6 : 1};`}
                  onClick=${() => this.setState({ listOpen: false, sel: chips.some((c) => c.i === i) ? i : null }, () => chips.some((c) => c.i === i) || open(r))}>
                  <span class="tm">${r.time}</span><i style=${`background: ${col(r.hue)};`}></i>
                  <span style="min-width: 0;"><b>${r.label}</b><small>${r.agent}</small></span>
                  <span class="st" style=${`color: ${r.status === 'Next' ? 'var(--next)' : r.status === 'Done' ? 'var(--done-ok)' : 'var(--done)'};`}>${r.review ? 'Review' : r.status}</span>
                </button>`)}
              </div>`}
            </div>
          </section>
        </div>
      </div>`;
  }
}

// The two backdrops are static, so they're built once. Both stay mounted and cross-fade.
const drift = (l, t, w, h, rot, bg, blur, dur, delay, extra = '') => html`<div class="drift" style=${`left: ${l}; top: ${t}; width: ${w}; height: ${h}; --dur: ${dur}s; --delay: ${delay}s;`}>
  <div style=${`background: ${bg}; filter: blur(${blur}px); transform: rotate(${rot}deg); ${extra}`}></div></div>`;
const ribbon = (l, t, w, h, rot, grad, blur, dur, delay) => drift(l, t, w, h, rot, grad, blur, dur, delay, 'mix-blend-mode: screen;');
const band = (l, t, w, h, rot, c1, c2, blur, dur, delay) => drift(l, t, w, h, rot, `linear-gradient(90deg, transparent 0%, ${c1} 25%, ${c2} 55%, ${c1} 80%, transparent 100%)`, blur, dur, delay);
const blob = (l, t, w, h, rot, color, blur, dur, delay) => drift(l, t, w, h, rot, color, blur, dur, delay, 'border-radius: 45% 55% 60% 40% / 55% 45% 55% 45%;');
const backdrops = html`
  <div class="home-bg silk" aria-hidden="true">
    ${ribbon('-25%', '-5%', '95%', '42%', -58, 'linear-gradient(90deg, transparent, rgb(255 140 210 / .55) 30%, rgb(190 150 255 / .7) 55%, rgb(140 225 255 / .5) 75%, transparent)', 44, 18, 0)}
    ${ribbon('18%', '8%', '100%', '30%', -64, 'linear-gradient(90deg, transparent, rgb(160 120 255 / .6) 35%, rgb(255 180 230 / .55) 65%, transparent)', 32, 22, -4)}
    ${ribbon('40%', '34%', '80%', '22%', -52, 'linear-gradient(90deg, transparent, rgb(120 230 255 / .5) 40%, rgb(220 170 255 / .6) 70%, transparent)', 26, 16, -8)}
    ${ribbon('-12%', '52%', '90%', '28%', -60, 'linear-gradient(90deg, transparent, rgb(255 160 220 / .45) 40%, rgb(170 140 255 / .55) 70%, transparent)', 38, 20, -2)}
    ${ribbon('10%', '20%', '70%', '3%', -62, 'linear-gradient(90deg, transparent, rgb(255 255 255 / .75), transparent)', 4, 14, -3)}
    ${ribbon('34%', '46%', '60%', '2.4%', -57, 'linear-gradient(90deg, transparent, rgb(200 240 255 / .7), transparent)', 3, 17, -6)}
    ${ribbon('-4%', '62%', '64%', '2%', -63, 'linear-gradient(90deg, transparent, rgb(255 220 245 / .65), transparent)', 3, 19, -9)}
    <div class="veil" style="background: radial-gradient(ellipse 70% 45% at 50% 18%, rgb(14 10 38 / .6), transparent 70%);"></div>
  </div>
  <div class="home-bg warm" aria-hidden="true">
    ${blob('-28%', '-20%', '42%', '140%', 6, 'radial-gradient(ellipse, #e0288c 0%, rgb(224 40 140 / 0) 70%)', 50, 24, 0)}
    ${blob('84%', '-14%', '44%', '140%', -6, 'radial-gradient(ellipse, #d92a90 0%, rgb(217 42 144 / 0) 70%)', 50, 26, -6)}
    ${band('30%', '-12%', '90%', '26%', 62, 'rgb(248 140 58 / .85)', 'rgb(250 160 70 / .95)', 34, 20, -2)}
    ${band('-30%', '30%', '95%', '24%', -52, 'rgb(248 135 58 / .85)', 'rgb(250 150 64 / .95)', 30, 22, -5)}
    ${band('5%', '6%', '80%', '20%', 58, 'rgb(232 60 110 / .8)', 'rgb(236 72 96 / .9)', 34, 18, -8)}
    ${band('10%', '52%', '95%', '22%', -40, 'rgb(240 70 120 / .75)', 'rgb(226 46 130 / .85)', 36, 24, -3)}
    ${band('46%', '30%', '80%', '20%', 70, 'rgb(242 98 74 / .8)', 'rgb(246 112 70 / .9)', 30, 19, -10)}
    ${band('-20%', '72%', '90%', '18%', -24, 'rgb(246 128 60 / .75)', 'rgb(248 142 62 / .85)', 32, 21, -7)}
    ${band('50%', '70%', '80%', '22%', 48, 'rgb(230 52 136 / .8)', 'rgb(240 80 110 / .85)', 36, 23, -1)}
    <div class="veil" style="background: radial-gradient(ellipse 70% 45% at 50% 16%, rgb(120 20 50 / .3), transparent 70%);"></div>
  </div>`;
