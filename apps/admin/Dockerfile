# =============================================================================
# DROVI ADMIN - Production Build
# =============================================================================

FROM oven/bun:1.3.3-alpine AS build
WORKDIR /app

# Install system deps
RUN apk add --no-cache libc6-compat openssl

# Copy repo
COPY . .

# Build-time environment for Vite
ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=${VITE_SERVER_URL}

# Install and build
RUN bun install
RUN cd apps/admin && bun run build

# -----------------------------------------------------------------------------
# Runtime
# -----------------------------------------------------------------------------
FROM nginx:alpine
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html

EXPOSE 80
