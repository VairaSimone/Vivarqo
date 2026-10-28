FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable \
    && apt-get update \
    && apt-get install --no-install-recommends -y openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencies
ENV DATABASE_URL="postgresql://vivarqo:vivarqo_dev@127.0.0.1:5432/vivarqo?schema=public"
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY backend/prisma.config.ts backend/prisma.config.ts
COPY backend/prisma ./backend/prisma
COPY backend/api/package.json backend/api/package.json
COPY frontend/package.json frontend/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm db:generate
RUN pnpm --filter @vivarqo/api build

FROM base AS production-dependencies
ENV DATABASE_URL="postgresql://vivarqo:vivarqo_dev@127.0.0.1:5432/vivarqo?schema=public"
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY backend/prisma.config.ts backend/prisma.config.ts
COPY backend/prisma ./backend/prisma
COPY backend/api/package.json backend/api/package.json
COPY frontend/package.json frontend/package.json
RUN pnpm install --prod --frozen-lockfile

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/backend/api/node_modules ./backend/api/node_modules
COPY --from=build /app/backend/api/dist ./backend/api/dist
COPY --from=build /app/backend/api/package.json ./backend/api/package.json
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/prisma.config.ts ./backend/prisma.config.ts
RUN mkdir -p /app/var/private && chown -R node:node /app/var/private
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/api/dist/server.js"]
