# Hub

The hub and EA homepage at the root of moniqr.com: today's brief, *Run EA now*, recent runs and links to every project and app. All Moniqr-related apps live on subdomains (the budgeting app at finance.moniqr.com) behind the same login.

It is a thin client of the agent API: a small Express server that renders one page, with no client-side scripts. The agent API token stays on the server.

## Login

Cloudflare Access sits in front of moniqr.com and its subdomains and only lets in the emails in its policy. Traefik can also be reached directly, so the hub checks the `Cf-Access-Jwt-Assertion` token on every request too: signature, team, AUD tag and an email in `HUB_ALLOWED_EMAILS`. `/health` is the only open route. *Run EA now* only accepts posts whose `Origin` is the hub itself.

## Local development

```sh
AGENTS_API_URL=http://localhost:8080 API_TOKEN=... HUB_DEV_EMAIL=you@example.com npm run dev -w apps/hub   # :3000
```

`HUB_DEV_EMAIL` skips Cloudflare Access and is refused when `NODE_ENV=production`.
