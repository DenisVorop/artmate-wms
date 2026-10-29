# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json yarn.lock .yarnrc ./
COPY scripts/check-dependency-sources.mjs scripts/check-dependency-sources.mjs
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked \
    node scripts/check-dependency-sources.mjs && yarn install --frozen-lockfile --non-interactive

FROM dependencies AS generated
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Swagger uses an isolated in-memory DB, never release credentials or schedulers.
RUN yarn api:generate

FROM generated AS api-build
RUN yarn workspace @artmate-wms/api build

FROM generated AS web-build
# Next rewrites are compiled. Keep this private DNS identical on every host.
ENV API_INTERNAL_URL=http://artmate-wms-api-internal:4080
RUN mkdir -p apps/web/public && yarn workspace @artmate-wms/web build

FROM ${NODE_IMAGE} AS api-dependencies
WORKDIR /runtime
COPY apps/api/package.json ./package.json
COPY yarn.lock .yarnrc ./
COPY scripts/check-dependency-sources.mjs scripts/check-dependency-sources.mjs
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked \
    node scripts/check-dependency-sources.mjs && yarn install --production --frozen-lockfile --non-interactive

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4080
WORKDIR /app/apps/api
COPY --from=api-dependencies --chown=node:node /runtime/node_modules /app/node_modules
COPY --from=api-build --chown=node:node /app/apps/api/package.json ./package.json
COPY --from=api-build --chown=node:node /app/apps/api/dist ./dist
USER node
EXPOSE 4080
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4080/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3080
WORKDIR /app
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3080
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3080/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
