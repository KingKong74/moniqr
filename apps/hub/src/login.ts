import type { SignInFailure } from './auth.js';
import { escapeHtml as esc } from './markdown.js';

const MESSAGES: Record<SignInFailure | 'signed-out', { tone: 'error' | 'info'; text: string }> = {
  denied: { tone: 'error', text: 'That Google account doesn’t have access to moniqr. Try a different account.' },
  failed: { tone: 'error', text: 'Google sign-in didn’t complete. Please try again.' },
  expired: { tone: 'error', text: 'That sign-in took too long or was started in another tab. Please try again.' },
  cancelled: { tone: 'info', text: 'Sign-in was cancelled.' },
  passcode: { tone: 'error', text: 'That security code isn’t right.' },
  locked: { tone: 'error', text: 'Too many wrong codes. Wait a while, then try again.' },
  'signed-out': { tone: 'info', text: 'You’ve signed out.' },
};

export const isLoginMessage = (v: unknown): v is keyof typeof MESSAGES =>
  typeof v === 'string' && Object.hasOwn(MESSAGES, v);

/** The moniqr sign-in page. No script: the security code is a plain form and Google is a link. */
export function renderLogin(opts: { message?: keyof typeof MESSAGES; next?: string; passcode?: boolean; google?: boolean } = {}): string {
  const usePasscode = opts.passcode ?? false;
  const useGoogle = opts.google ?? !usePasscode;
  const msg = opts.message && MESSAGES[opts.message];
  const href = opts.next && opts.next !== '/' ? `/login/google?next=${encodeURIComponent(opts.next)}` : '/login/google';
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <meta name="color-scheme" content="light dark">
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
        <img class="mark mark-light" src="/assets/moniqr-icon-light.png" width="34" height="34" alt="">
        <img class="mark mark-dark" src="/assets/moniqr-icon-dark.png" width="34" height="34" alt="">
        <span class="wordmark">moniqr</span>
      </div>
      <h1 id="title">Sign in</h1>
      <p class="lede">Welcome back. ${usePasscode ? 'Enter your security code to open your moniqr workspace.' : 'Continue with the Google account that has access to your moniqr workspace.'}</p>
      ${msg ? `<p class="notice notice-${msg.tone}" role="${msg.tone === 'error' ? 'alert' : 'status'}">${esc(msg.text)}</p>` : ''}
      ${usePasscode ? `<form class="code" method="post" action="/login">
        <input type="hidden" name="next" value="${esc(opts.next ?? '/')}">
        <label for="passcode">Security code</label>
        <input id="passcode" name="passcode" type="password" inputmode="numeric" autocomplete="current-password" required autofocus maxlength="64" placeholder="•••••••">
        <button type="submit">Unlock</button>
      </form>` : ''}
      ${usePasscode && useGoogle ? '<p class="or"><span>or</span></p>' : ''}
      ${useGoogle ? `<a class="google" href="${esc(href)}">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        </svg>
        <span>Continue with Google</span>
      </a>` : ''}
      <p class="fine">Private workspace. ${usePasscode ? 'Repeated wrong codes lock sign-in for a while.' : 'Only approved accounts can sign in, and moniqr asks Google only for your email address.'}</p>
    </section>
    <footer class="foot">© moniqr</footer>
  </main>
</body>
</html>`;
}
