function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function hubConfig() {
  const production = process.env.NODE_ENV === 'production';
  // Lets `npm run dev` skip sign-in. Refused in production so a stray variable can't open the hub.
  const devEmail = process.env.HUB_DEV_EMAIL;
  if (devEmail && production) throw new Error('HUB_DEV_EMAIL must not be set in production');
  const origin = process.env.HUB_ORIGIN ?? 'https://moniqr.com';

  const login = () => {
    const sessionSecret = required('HUB_SESSION_SECRET');
    if (sessionSecret.length < 32) throw new Error('HUB_SESSION_SECRET must be at least 32 characters');
    const allowedEmails = required('HUB_ALLOWED_EMAILS').split(',').map((e) => e.trim()).filter(Boolean);
    if (!allowedEmails.length) throw new Error('HUB_ALLOWED_EMAILS has no emails');
    const passcode = process.env.HUB_PASSCODE || undefined;
    if (passcode && passcode.length < 6) throw new Error('HUB_PASSCODE must be at least 6 characters');
    const clientId = process.env.HUB_GOOGLE_CLIENT_ID, clientSecret = process.env.HUB_GOOGLE_CLIENT_SECRET;
    if (!!clientId !== !!clientSecret) throw new Error('Set both HUB_GOOGLE_CLIENT_ID and HUB_GOOGLE_CLIENT_SECRET, or neither');
    if (!passcode && !clientId) throw new Error('Set HUB_PASSCODE or the HUB_GOOGLE_* sign-in, or both');
    return {
      mode: 'login' as const,
      google: clientId && clientSecret
        ? { clientId, clientSecret, redirectUri: new URL('/login/google/callback', origin).toString(), allowedEmails }
        : undefined,
      passcode,
      sessionSecret,
      allowedEmails,
    };
  };

  return {
    port: Number(process.env.PORT ?? 3000),
    origin,
    agentsApiUrl: required('AGENTS_API_URL'),
    apiToken: required('API_TOKEN'),
    login: devEmail ? { mode: 'dev' as const, email: devEmail } : login(),
  };
}
