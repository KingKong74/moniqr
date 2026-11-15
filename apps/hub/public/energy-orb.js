// <energy-orb mode="orange|blue" motion="true|false" yaw="0" pitch="0" grid="0|1">
// From the moniqr design system's landing page: a glowing dot sphere that ripples under the
// pointer. Orange in dark mode, blue in light mode, cross-fading when the mode changes.
(() => {
  if (customElements.get('energy-orb')) return;
  const PAL = {
    orange: { dot: [255, 226, 196], accent: [255, 128, 34], glow: [255, 112, 26], core: [6, 3, 2], rim: [255, 240, 225] },
    blue: { dot: [228, 242, 255], accent: [70, 170, 255], glow: [40, 130, 255], core: [2, 4, 12], rim: [235, 246, 255] },
  };
  const mixc = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  class EnergyOrb extends HTMLElement {
    connectedCallback() {
      if (this._init) return; this._init = true;
      // Size comes from the page's CSS (an inset box around the orb), so nothing is set inline.
      this.style.display = 'block';
      const c = document.createElement('canvas');
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
      this.appendChild(c); this._c = c; this._ctx = c.getContext('2d');
      const N = 1500, pts = [], ga = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
        pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
      }
      this._pts = pts; this._parts = [];
      this._dust = Array.from({ length: 520 }, () => { const a = Math.random() * Math.PI * 2, r = 0.97 + Math.pow(Math.random(), 3.2) * 0.55; return { a, r, w: (Math.random() - 0.5) * 0.04, ph: Math.random() * 6.28, sz: Math.random() < 0.14 ? 1.5 : 0.7, o: 0.3 + Math.random() * 0.7 }; });
      { const n = document.createElement('canvas'); n.width = n.height = 192; const nx = n.getContext('2d'), id = nx.createImageData(192, 192);
        for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = Math.random() < 0.5 ? 60 + Math.random() * 120 : 0; }
        nx.putImageData(id, 0, 0); this._noise = n; }
      this._mix = this.getAttribute('mode') === 'blue' ? 1 : 0;
      this._mouse = [-1e4, -1e4]; this._hover = 0; this._t = 0; this._last = performance.now();
      this._onMove = (e) => { const r = c.getBoundingClientRect(); this._mouse = [(e.clientX - r.left) * this._dpr, (e.clientY - r.top) * this._dpr]; };
      this._onLeave = () => { this._mouse = [-1e4, -1e4]; };
      window.addEventListener('pointermove', this._onMove, { passive: true });
      document.addEventListener('pointerleave', this._onLeave);
      this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(this); this._resize();
      const loop = (now) => { this._raf = requestAnimationFrame(loop); this._frame(now); };
      this._raf = requestAnimationFrame(loop);
    }
    disconnectedCallback() {
      cancelAnimationFrame(this._raf); this._ro && this._ro.disconnect();
      window.removeEventListener('pointermove', this._onMove); document.removeEventListener('pointerleave', this._onLeave);
      this._init = false; this._c && this._c.remove();
    }
    _resize() {
      const r = this.getBoundingClientRect(); this._dpr = Math.min(window.devicePixelRatio || 1, 2);
      this._c.width = Math.max(2, Math.round(r.width * this._dpr)); this._c.height = Math.max(2, Math.round(r.height * this._dpr));
    }
    _frame(now) {
      const dt = Math.min(0.05, (now - this._last) / 1000); this._last = now;
      const still = this.getAttribute('motion') === 'false';
      if (!still) this._t += dt;
      const target = this.getAttribute('mode') === 'blue' ? 1 : 0;
      this._mix += (target - this._mix) * 0.08;
      const P = {}; for (const k in PAL.orange) P[k] = mixc(PAL.orange[k], PAL.blue[k], this._mix);
      const ctx = this._ctx, W = this._c.width, H = this._c.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.34, t = this._t, dpr = this._dpr;
      const [mx, my] = this._mouse, md = Math.hypot(mx - cx, my - cy);
      this._hover += ((md < R * 1.35 ? 1 : 0) - this._hover) * 0.08;
      const hv = this._hover, rot = t * 0.12 + (+this.getAttribute('yaw') || 0), tilt = 0.38 + (+this.getAttribute('pitch') || 0), cr = Math.cos(rot), sr = Math.sin(rot), ct = Math.cos(tilt), st = Math.sin(tilt);
      const proj = (p, s = 1) => {
        const x = p[0] * cr - p[2] * sr, z0 = p[0] * sr + p[2] * cr;
        const y = p[1] * ct - z0 * st, z = p[1] * st + z0 * ct;
        return [cx + x * R * s, cy - y * R * s, z];
      };
      ctx.clearRect(0, 0, W, H);
      // outer glow
      let g = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.6);
      g.addColorStop(0, rgba(P.glow, 0.34)); g.addColorStop(0.45, rgba(P.glow, 0.1)); g.addColorStop(1, rgba(P.glow, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // body
      g = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R);
      g.addColorStop(0, rgba(P.core, 0.55)); g.addColorStop(0.7, rgba(P.core, 0.35)); g.addColorStop(0.93, rgba(P.accent, 0.22)); g.addColorStop(1, rgba(P.rim, 0.6));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      // sphere dots
      for (let pi = 0; pi < this._pts.length; pi++) {
        let [x, y, z] = proj(this._pts[pi]);
        const d = Math.hypot(x - mx, y - my), near = hv * Math.exp(-d / (R * 0.32));
        if (near > 0.01) {
          const w = Math.sin(d / (R * 0.05) - t * 7) * near * R * 0.035, dx = x - cx, dy = y - cy, L = Math.hypot(dx, dy) || 1;
          x += dx / L * w; y += dy / L * w;
        }
        const front = (z + 1) / 2, a = (0.06 + front * 0.6) * (1 + near * 1.5), s = (0.7 + front * 1.1) * dpr * (1 + near * 0.8);
        if (z > 0.2 && pi % 23 === 0) this._spark(x, y, (0.8 + 0.4 * Math.sin(t * 2 + pi)) * dpr, P.rim, P.accent, 0.3 + front * 0.35);
        ctx.fillStyle = rgba(near > 0.25 ? P.rim : P.dot, Math.min(1, a));
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
      // orientation grid while dragging
      this._grid = (this._grid || 0) + ((this.getAttribute('grid') === '1' ? 1 : 0) - (this._grid || 0)) * 0.12;
      if (this._grid > 0.02) {
        ctx.lineWidth = 1 * dpr;
        const seg = (fn, n, hi) => { let prev = null;
          for (let i = 0; i <= n; i++) { const q = proj(fn(i / n)), vis = q[2] > -0.05;
            if (prev && vis && prev[2] > -0.05) { ctx.strokeStyle = rgba(hi ? P.accent : P.rim, this._grid * (hi ? 0.75 : 0.28) * (0.3 + 0.7 * Math.max(0, q[2]))); ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
            prev = q; } };
        for (let m = 0; m < 12; m++) { const lo = m * Math.PI / 6; seg(u => { const la = -Math.PI / 2 + u * Math.PI; return [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)]; }, 40, m === 0); }
        for (let p = -2; p <= 2; p++) { const la = p * Math.PI / 6; seg(u => { const lo = u * Math.PI * 2; return [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)]; }, 64, p === 0); }
        const np = proj([0, 1, 0]); if (np[2] > 0) this._spark(np[0], np[1], 2.2 * dpr, P.rim, P.accent, this._grid);
      }
      // sprites
      const spawn = still ? 0 : Math.min(10, Math.floor(dt * (55 + hv * 90) + Math.random()));
      for (let k = 0; k < spawn; k++) this._parts.push({ p: this._pts[(Math.random() * this._pts.length) | 0], age: 0, life: 1.6 + Math.random() * 2.2, v: 0.08 + Math.random() * 0.2, sz: Math.random() < 0.3 ? 2 : 1 });
      this._parts = this._parts.filter(s => (s.age += dt) < s.life);
      for (const s of this._parts) {
        const q = proj(s.p, 1.01 + s.age * s.v);
        if (q[2] < 0 && Math.hypot(q[0] - cx, q[1] - cy) < R) continue;
        const k = s.age / s.life, a = Math.sin(Math.PI * k) * (0.5 + Math.max(0, q[2]) * 0.5);
        if (s.sz === 2) this._spark(q[0], q[1], 1.5 * dpr, P.rim, P.accent, a);
        else { const z = 1.5 * dpr; ctx.fillStyle = rgba(k < 0.4 ? P.rim : P.accent, a); ctx.fillRect(q[0] - z / 2, q[1] - z / 2, z, z); }
      }
      // grain
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2); ctx.clip();
      const fr = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.02);
      fr.addColorStop(0, rgba(P.rim, 0)); fr.addColorStop(0.8, rgba(P.rim, 0.06)); fr.addColorStop(1, rgba(P.rim, 0.22));
      ctx.fillStyle = fr; ctx.fillRect(cx - R * 1.05, cy - R * 1.05, R * 2.1, R * 2.1);
      ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.25;
      const pat = ctx.createPattern(this._noise, 'repeat'), jx = (Math.random() * 192) | 0, jy = (Math.random() * 192) | 0;
      ctx.translate(jx, jy); ctx.fillStyle = pat; ctx.fillRect(cx - R - jx, cy - R - jy, R * 2, R * 2);
      ctx.restore();
      // dust
      for (const d of this._dust) {
        d.a += d.w * dt * (1 + hv * 2) * (still ? 0 : 1);
        const rr = d.r + Math.sin(t * 0.5 + d.ph) * 0.012 * (1 + hv * 3), x = cx + Math.cos(d.a) * R * rr, y = cy + Math.sin(d.a) * R * rr;
        const tw = 0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(t * 2.2 + d.ph * 3), 2), fade = Math.max(0, 1 - (d.r - 0.97) / 0.55);
        const a = d.o * tw * fade * 0.45, z = d.sz * dpr;
        if (d.sz > 1) { ctx.fillStyle = rgba(P.rim, a); ctx.fillRect(x - z * 1.6, y - 0.4 * dpr, z * 3.2, 0.8 * dpr); ctx.fillRect(x - 0.4 * dpr, y - z * 1.6, 0.8 * dpr, z * 3.2); }
        else { ctx.fillStyle = rgba(d.o > 0.7 ? P.rim : P.accent, a); ctx.fillRect(x - z / 2, y - z / 2, z, z); }
      }
    }
    _spark(x, y, r, core, halo, a) {
      const ctx = this._ctx, g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      g.addColorStop(0, rgba(core, a)); g.addColorStop(0.25, rgba(halo, a * 0.7)); g.addColorStop(1, rgba(halo, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(core, Math.min(1, a + 0.2)); ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, Math.PI * 2); ctx.fill();
    }
  }
  customElements.define('energy-orb', EnergyOrb);
})();
