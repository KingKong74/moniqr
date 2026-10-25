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
# Claude Code for the runner. Pin a version once the first real run has been checked.
RUN npm install -g @anthropic-ai/claude-code && npm cache clean --force
WORKDIR /repo
# Workspace dependencies are hoisted to the root node_modules.
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/services/agents/dist services/agents/dist
COPY --from=build /repo/services/agents/package.json services/agents/package.json
COPY services/agents/migrations services/agents/migrations
COPY agents agents
COPY package.json ./
# Claude Code keeps its config under HOME, so give the node user a writable one.
USER node
ENV HOME=/home/node
EXPOSE 8080
CMD ["node", "services/agents/dist/server.js"]
