// Light or dark, remembered per browser; the device setting decides until Bailey picks one.
// Shared by the signed-in app (hq.js) and the signed-out page (locked.js).
const THEME_KEY = 'moniqr-theme';

export function initialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let flipTimer;

/** Sets the theme. When Bailey switches it (remember), the moniqr logo flips as it changes. */
export function applyTheme(theme, remember = false) {
  const root = document.documentElement;
  if (remember && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    clearTimeout(flipTimer);
    root.classList.remove('logo-flip');
    void root.offsetWidth; // restart the animation on a quick second click
    root.classList.add('logo-flip');
    flipTimer = setTimeout(() => root.classList.remove('logo-flip'), 520);
  }
  root.dataset.theme = theme;
  if (remember) try { localStorage.setItem(THEME_KEY, theme); } catch {}
  return theme;
}
