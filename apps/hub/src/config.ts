function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function hubConfig() {
  const production = process.env.NODE_ENV === 'production';
  // Lets `npm run dev` skip Cloudflare Access. Refused in production so a stray variable can't open the hub.
  const devEmail = process.env.HUB_DEV_EMAIL;
  if (devEmail && production) throw new Error('HUB_DEV_EMAIL must not be set in production');

  return {
    port: Number(process.env.PORT ?? 3000),
    origin: process.env.HUB_ORIGIN ?? 'https://moniqr.com',
    agentsApiUrl: required('AGENTS_API_URL'),
    apiToken: required('API_TOKEN'),
    access: devEmail
      ? { mode: 'dev' as const, email: devEmail }
      : {
          mode: 'cloudflare' as const,
          teamDomain: required('CF_ACCESS_TEAM_DOMAIN'),
          audience: required('CF_ACCESS_AUD'),
          allowedEmails: required('HUB_ALLOWED_EMAILS')
            .split(',')
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean),
        },
  };
}
