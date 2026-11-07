# One image for both the agent API and the runner; docker-compose picks the command.
# Build from the repo root: docker build -f services/agents/Dockerfile .

FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY services/agents/package.json services/agents/
RUN npm ci --workspace services/agents --include-workspace-root
COPY services/agents services/agents
RUN npm run build --workspace services/agents \
 && npm prune --omit=dev --workspace services/agents --include-workspace-root

FROM node:22-slim
ENV NODE_ENV=production \
    AGENTS_REPO_ROOT=/repo \
    TZ=Australia/Brisbane
# Codex uses the system trust store for HTTPS.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Pin the CLI: the generated catalog removes native filesystem/exec tool capabilities.
RUN npm install -g @openai/codex@0.166.0 && npm cache clean --force
COPY services/agents/scripts/codex-models.mjs /opt/moniqr/codex-models.mjs
RUN codex debug models --bundled | node /opt/moniqr/codex-models.mjs > /opt/moniqr/codex-models.json
RUN mkdir -p /home/node/.moniqr-codex && chown node:node /home/node/.moniqr-codex
WORKDIR /repo
# Workspace dependencies are hoisted to the root node_modules.
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/services/agents/dist services/agents/dist
COPY --from=build /repo/services/agents/package.json services/agents/package.json
COPY services/agents/migrations services/agents/migrations
COPY agents agents
COPY package.json ./
# Codex uses a dedicated persistent login directory, separate from agent instructions.
USER node
ENV HOME=/home/node
EXPOSE 8080
CMD ["node", "services/agents/dist/server.js"]
