FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable \
    && apt-get update \
    && apt-get install --no-install-recommends -y openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Include schema/config in the dependency stage so Prisma's postinstall has
# the required inputs. This URL is build-only and is not copied into runtime.
FROM base AS dependencies
ENV DATABASE_URL="postgresql://vivarqo:vivarqo_dev@127.0.0.1:5432/vivarqo?schema=public"
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc prisma.config.ts ./
COPY prisma ./prisma
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm db:generate
RUN pnpm --filter @vivarqo/api build

# Runtime dependencies are installed separately to keep the image free of
# TypeScript, Vitest, Prisma CLI and other development-only packages.
FROM base AS production-dependencies
ENV DATABASE_URL="postgresql://vivarqo:vivarqo_dev@127.0.0.1:5432/vivarqo?schema=public"
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc prisma.config.ts ./
COPY prisma ./prisma
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --prod --frozen-lockfile

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
