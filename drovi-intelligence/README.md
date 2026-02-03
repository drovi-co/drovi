# Drovi Intelligence Backend

State-of-the-art AI backend for the Drovi Intelligence Platform.

## Features

- Intelligence extraction via LangGraph orchestrator
- Knowledge graph operations via FalkorDB
- Agentic memory with temporal awareness
- Hybrid search (vector + fulltext + graph)
- Live meeting/call ingestion with Whisper transcription

## Live Ingestion (Meetings/Calls)

Endpoints:
- `POST /api/v1/ingest/live-session/start`
- `POST /api/v1/ingest/live-session/{session_id}/audio`
- `POST /api/v1/ingest/live-session/{session_id}/transcript`
- `GET /api/v1/ingest/live-session/{session_id}/transcript/stream`
- `WS /api/v1/ingest/live-session/{session_id}/stream`
- `POST /api/v1/ingest/live-session/{session_id}/end`

## Evidence Storage

Local (default):
```

## FalkorDB Index Management
Provide custom index statements as JSON:
```
FALKORDB_INDEX_STATEMENTS='["CREATE INDEX ON :UIO(id)"]'
```
Enable default index helpers:
```
FALKORDB_APPLY_DEFAULT_FULLTEXT=true
```
EVIDENCE_STORAGE_BACKEND=local
EVIDENCE_STORAGE_PATH=/tmp/drovi-evidence
```

S3/MinIO:
```
EVIDENCE_STORAGE_BACKEND=s3
EVIDENCE_S3_BUCKET=your-bucket
EVIDENCE_S3_REGION=us-east-1
EVIDENCE_S3_ENDPOINT_URL=http://localhost:9000   # MinIO
EVIDENCE_S3_ACCESS_KEY_ID=...
EVIDENCE_S3_SECRET_ACCESS_KEY=...
EVIDENCE_S3_PREFIX=drovi-evidence
EVIDENCE_S3_PRESIGN_EXPIRY_SECONDS=3600
EVIDENCE_S3_SSE=aws:kms
EVIDENCE_S3_KMS_KEY_ID=alias/drovi-evidence
EVIDENCE_REQUIRE_KMS=true
EVIDENCE_S3_OBJECT_LOCK=true
EVIDENCE_DEFAULT_RETENTION_DAYS=365
```

## Backups
- `scripts/backup_postgres.sh`
- `scripts/backup_falkordb.sh`
- `scripts/backup_minio.sh`
