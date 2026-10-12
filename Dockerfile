# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

# Base image pinned by digest (Dependabot proposes the updates).
FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
# Manifests first: the dependency layer is reused while only the sources change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The patch of @liam-hq/schema (pnpm-workspace.yaml, patchedDependencies) is applied by pnpm install.
COPY patches/ patches/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/model/package.json packages/model/
COPY packages/contracts/package.json packages/contracts/
COPY packages/schema-core/package.json packages/schema-core/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
# The web build knows its version (x-repoerd-version banner): same value as the final stage.
ARG REPOERD_VERSION=dev
# The deployed server must carry the patched parser (spec §5.1): fail the build otherwise.
RUN pnpm build \
 && pnpm --filter @repoerd/server deploy --prod --legacy /out/server \
 && grep -q '^// Modified by RepoERD' /out/server/node_modules/.pnpm/@liam-hq+schema@0.6.1_*/node_modules/@liam-hq/schema/dist/parser/drizzle/postgres/tableParser.js \
 && rm -rf apps/web/dist/.vite
# Trim what is not needed at run time (done here so the final image never carries it).
RUN find /out/server/node_modules -type f \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' \) -not -path '*/typescript@*' -delete \
 && rm -rf /out/server/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/deps \
           /out/server/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/src \
 && rm -rf /out/server/node_modules/.pnpm/typescript@*

FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ARG REPOERD_VERSION=dev
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/repoerd.sqlite \
    WEB_DIST_PATH=/app/web \
    FIXTURES_PATH=/app/fixtures \
    REPOERD_VERSION=$REPOERD_VERSION
WORKDIR /app/server
COPY --from=build /out/server ./
COPY --from=build /repo/apps/web/dist /app/web
# Example repositories of the demo mode (GITHUB_MODE=fake).
COPY --from=build /repo/fixtures/repos /app/fixtures
# repoerd-admin: the recovery commands, on the PATH (docker compose exec repoerd repoerd-admin <command>).
RUN mkdir /data && chown node:node /data \
 && printf '#!/bin/sh\nexec node /app/server/dist/cli.js "$@"\n' > /usr/local/bin/repoerd-admin \
 && chmod 755 /usr/local/bin/repoerd-admin
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Exec form: Node is PID 1 and receives the SIGTERM of `docker stop` (graceful shutdown).
CMD ["node", "dist/main.js"]
