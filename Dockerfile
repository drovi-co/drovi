# =============================================================================
# LEADMINER - Enterprise SaaS Template
# Multi-stage Dockerfile for production deployment
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Base image with Bun
# -----------------------------------------------------------------------------
FROM oven/bun:1.3.3-alpine AS base
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache libc6-compat openssl

# -----------------------------------------------------------------------------
# Stage 2: Install dependencies
# -----------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app

# Copy package files for workspace
COPY package.json bun.lock* ./
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY packages/env/package.json ./packages/env/
COPY packages/auth/package.json ./packages/auth/
COPY packages/api/package.json ./packages/api/
COPY packages/email/package.json ./packages/email/
COPY packages/ai/package.json ./packages/ai/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN bun install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 3: Build the application
# -----------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/env/node_modules ./packages/env/node_modules
COPY --from=deps /app/packages/auth/node_modules ./packages/auth/node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=deps /app/packages/email/node_modules ./packages/email/node_modules
COPY --from=deps /app/packages/ai/node_modules ./packages/ai/node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

# Copy source code
COPY . .

# Build all packages
RUN bun run build

# -----------------------------------------------------------------------------
# Stage 4: Production server image
# -----------------------------------------------------------------------------
FROM base AS server
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 hono

# Copy built server and dependencies
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/server ./apps/server

USER hono

EXPOSE 3000

CMD ["bun", "run", "apps/server/dist/index.js"]

# -----------------------------------------------------------------------------
# Stage 5: Production web image (static files served via nginx)
# -----------------------------------------------------------------------------
FROM nginx:alpine AS web

# Copy nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built static files
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

# -----------------------------------------------------------------------------
# Default: Run the server
# -----------------------------------------------------------------------------
FROM server AS default
