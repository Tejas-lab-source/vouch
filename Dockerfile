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
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter @vouch/api... --ignore-scripts
COPY apps/api/src apps/api/src
COPY apps/api/migrations apps/api/migrations
COPY apps/api/scripts/admin-create.js apps/api/scripts/admin-create.js
COPY apps/api/scripts/backup.js apps/api/scripts/backup.js
COPY packages/contracts/src packages/contracts/src
RUN pnpm --filter @vouch/api deploy --prod --legacy --ignore-scripts /out
# Image trim (Phase 15): source maps, type declarations and docs are never read at runtime.
RUN find /out/node_modules -type f \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' \
      -o -name '*.d.cts' -o -name '*.md' -o -name '*.markdown' \) -delete

# ---- runtime: production dependencies only, non-root ------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
# pg_dump for the nightly backup job (scripts/backup.js; the same major version as the server).
# npm and corepack are not used at runtime (Phase 15 image trim).
ARG PG_CLIENT=postgresql17-client
RUN if [ -n "$PG_CLIENT" ]; then apk add --no-cache "$PG_CLIENT"; fi \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/src ./src
COPY --from=build /out/migrations ./migrations
# The only way to create staff accounts (ADR 0018): `node scripts/admin-create.js --email … --name …`.
COPY --from=build /out/scripts/admin-create.js ./scripts/admin-create.js
# Nightly backup (a Render Cron Job runs `node scripts/backup.js`).
COPY --from=build /out/scripts/backup.js ./scripts/backup.js
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
# 75% of the container for the JS heap (Phase 14: the default, about half, ran out under
# overload); the rest is for sockets and native buffers.
# The OpenTelemetry preload starts tracing before any library loads (a no-op without an
# OTLP endpoint), so ESM libraries are instrumented too.
CMD ["node", "--max-old-space-size-percentage=75", "--import", "./src/otel-preload.js", "src/main.js"]
