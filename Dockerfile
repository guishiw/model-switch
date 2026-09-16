# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
# Optional registry mirrors (e.g. for mainland China): pass --build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG PRISMA_ENGINES_MIRROR=
ENV PRISMA_ENGINES_MIRROR=${PRISMA_ENGINES_MIRROR}
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm config set registry $NPM_REGISTRY && npm ci --no-audit --no-fund

# ---------- build ----------
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG PRISMA_ENGINES_MIRROR=
ENV PRISMA_ENGINES_MIRROR=${PRISMA_ENGINES_MIRROR}
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time placeholders only: env.ts validates at import time during page-data collection.
# Real values come from --env-file at runtime.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build \
    ADMIN_JWT_SECRET=build-time-placeholder-secret-not-used-at-runtime
RUN npx prisma generate && npm run build

# ---------- web runtime ----------
FROM node:20-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl && addgroup -S app && adduser -S app -G app
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
USER app
EXPOSE 3000
CMD ["node", "server.js"]

# ---------- worker runtime ----------
FROM node:20-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./
CMD ["npx", "tsx", "src/worker/index.ts"]
