FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
RUN CGO_ENABLED=0 GOOS=linux go build -o /ingestion-worker ./cmd/ingestion-worker

FROM alpine:3.19
RUN adduser -D -g '' app
USER app
COPY --from=builder /ingestion-worker /usr/local/bin/ingestion-worker
ENTRYPOINT ["ingestion-worker"]
