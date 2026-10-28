# The hub at moniqr.com. Build from the repo root: docker build -f apps/hub/Dockerfile .

FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/hub/package.json apps/hub/
RUN npm ci --workspace apps/hub --include-workspace-root
COPY apps/hub apps/hub
RUN npm run build --workspace apps/hub \
 && npm prune --omit=dev --workspace apps/hub --include-workspace-root

FROM node:22-slim
ENV NODE_ENV=production \
    TZ=Australia/Brisbane
WORKDIR /repo
# Workspace dependencies are hoisted to the root node_modules.
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/apps/hub/dist apps/hub/dist
COPY --from=build /repo/apps/hub/public apps/hub/public
COPY --from=build /repo/apps/hub/package.json apps/hub/package.json
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "apps/hub/dist/server.js"]
