FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sync-protocol packages/sync-protocol
COPY server server

RUN pnpm install --frozen-lockfile
RUN pnpm --filter webwings-server typecheck

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable

COPY --from=build /app /app

EXPOSE 8787
CMD ["pnpm", "--filter", "webwings-server", "start"]
