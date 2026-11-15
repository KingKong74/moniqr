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

export function applyTheme(theme, remember = false) {
  document.documentElement.dataset.theme = theme;
  if (remember) try { localStorage.setItem(THEME_KEY, theme); } catch {}
  return theme;
}
