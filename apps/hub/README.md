# Hub

The hub and EA homepage at the root of moniqr.com. Built in phase 2.

It is a thin client of the agent API: links to every project and app, today's brief, run history, approvals and the EA inbox. All Moniqr-related apps live on subdomains (the budgeting app at finance.moniqr.com) and share one login with the hub.

## Holding page

Until phase 2, this folder serves a static holding page from `public/` with nginx. `www.moniqr.com` redirects to `moniqr.com`. It becomes an npm workspace when the real hub is built.

```sh
docker build -f apps/hub/Dockerfile -t moniqr-hub .
docker run --rm -p 8081:80 moniqr-hub   # http://localhost:8081
```

In Dokploy it is a Dockerfile application (`apps/hub/Dockerfile`, build context the repo root) on port 80, with domains `moniqr.com` and `www.moniqr.com`.
