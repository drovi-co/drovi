# =============================================================================
# DROVI - Production Dockerfile (single-stage for simplicity)
# =============================================================================

FROM oven/bun:1.3.3-alpine
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache libc6-compat openssl

# Copy entire project (respects .dockerignore)
COPY . .

# Install all dependencies
RUN bun install

# Set production environment
ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 hono && \
    chown -R hono:nodejs /app

USER hono

EXPOSE 3000

# Run the server directly with bun (TypeScript)
CMD ["bun", "apps/server/src/index.ts"]
