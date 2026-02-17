FROM rust:1.86-alpine AS build
WORKDIR /app

RUN apk add --no-cache musl-dev openssl-dev pkgconfig

COPY services/imperium-backend ./services/imperium-backend

WORKDIR /app/services/imperium-backend
RUN cargo build --release -p imperium-api -p imperium-worker

FROM alpine:3.21
WORKDIR /app

RUN apk add --no-cache ca-certificates

COPY --from=build /app/services/imperium-backend/target/release/imperium-api /usr/local/bin/imperium-api
COPY --from=build /app/services/imperium-backend/target/release/imperium-worker /usr/local/bin/imperium-worker

EXPOSE 8010
CMD ["imperium-api"]
