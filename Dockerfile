# syntax=docker/dockerfile:1

# Base image is overridable (for example, to pin a digest).
ARG NODE_IMAGE=node:24-alpine

# ---- build: install the workspace and assemble a production-only bundle ----------
FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --filter @vouch/api... --ignore-scripts
COPY apps/api/src apps/api/src
COPY apps/api/migrations apps/api/migrations
RUN pnpm --filter @vouch/api deploy --prod --legacy --ignore-scripts /out

# ---- runtime: production dependencies only, non-root ------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/src ./src
COPY --from=build /out/migrations ./migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "src/main.js"]
