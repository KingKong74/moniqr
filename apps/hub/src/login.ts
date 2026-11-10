import type { SignInFailure } from './auth.js';
import { escapeHtml as esc } from './markdown.js';

const MESSAGES: Record<SignInFailure | 'signed-out', { tone: 'error' | 'info'; text: string }> = {
  denied: { tone: 'error', text: 'That Google account doesn’t have access to moniqr. Try a different account.' },
  failed: { tone: 'error', text: 'Google sign-in didn’t complete. Please try again.' },
  expired: { tone: 'error', text: 'That sign-in took too long or was started in another tab. Please try again.' },
  cancelled: { tone: 'info', text: 'Sign-in was cancelled.' },
  'signed-out': { tone: 'info', text: 'You’ve signed out.' },
};

export const isLoginMessage = (v: unknown): v is keyof typeof MESSAGES =>
  typeof v === 'string' && Object.hasOwn(MESSAGES, v);

/** The moniqr sign-in page. No script; the one button is a link to /login/google. */
export function renderLogin(opts: { message?: keyof typeof MESSAGES; next?: string } = {}): string {
  const msg = opts.message && MESSAGES[opts.message];
  const href = opts.next && opts.next !== '/' ? `/login/google?next=${encodeURIComponent(opts.next)}` : '/login/google';
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Sign in · moniqr</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&display=swap">
  <link rel="stylesheet" href="/login.css">
</head>
<body>
  <main class="shell">
    <section class="card" aria-labelledby="title">
      <div class="brand">
        <svg class="mark" viewBox="0 0 40 40" aria-hidden="true">
          <rect width="40" height="40" rx="11" fill="#3d5a80"/>
          <path d="M11 28V17.5a3.5 3.5 0 0 1 7 0V28M18 17.5a3.5 3.5 0 0 1 7 0V28" fill="none" stroke="#e0fbfc" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="30" cy="25.5" r="2.5" fill="#ee6c4d"/>
        </svg>
        <span class="wordmark">moniqr</span>
      </div>
      <h1 id="title">Sign in</h1>
      <p class="lede">Welcome back. Continue with the Google account that has access to your moniqr workspace.</p>
      ${msg ? `<p class="notice notice-${msg.tone}" role="${msg.tone === 'error' ? 'alert' : 'status'}">${esc(msg.text)}</p>` : ''}
      <a class="google" href="${esc(href)}">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        </svg>
        <span>Continue with Google</span>
      </a>
      <p class="fine">Private workspace. Only approved accounts can sign in, and moniqr asks Google only for your email address.</p>
    </section>
    <footer class="foot">© moniqr</footer>
  </main>
</body>
</html>`;
}
