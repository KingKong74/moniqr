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
    return {
      mode: 'google' as const,
      clientId: required('HUB_GOOGLE_CLIENT_ID'),
      clientSecret: required('HUB_GOOGLE_CLIENT_SECRET'),
      redirectUri: new URL('/login/google/callback', origin).toString(),
      sessionSecret,
      allowedEmails: required('HUB_ALLOWED_EMAILS').split(','),
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
