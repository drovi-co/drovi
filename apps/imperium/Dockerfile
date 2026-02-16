FROM oven/bun:1.3.3-alpine AS build
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY . .

RUN bun install
RUN cd apps/imperium && bun run build

FROM nginx:alpine
COPY apps/imperium/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/imperium/dist /usr/share/nginx/html

EXPOSE 80
