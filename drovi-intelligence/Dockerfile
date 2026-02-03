# Drovi Intelligence Backend Dockerfile
# Uses UV for fast Python dependency management

FROM python:3.12-slim AS builder

WORKDIR /app

# System deps for audio + scientific libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    tesseract-ocr \
    poppler-utils \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install UV
RUN pip install uv

# Copy dependency files and README
COPY pyproject.toml README.md ./

# Create virtual environment and install dependencies (include dev deps for tests)
RUN uv venv && uv pip install ".[dev]"

# Production image
FROM python:3.12-slim

WORKDIR /app

# Runtime deps for audio decoding
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    tesseract-ocr \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Copy application code
COPY src/ ./src/
COPY alembic.ini ./alembic.ini
COPY alembic/ ./alembic/
COPY scripts/ ./scripts/
COPY deploy/ ./deploy/
COPY tests/ ./tests/
COPY evaluation/ ./evaluation/

# Set environment variables
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/.venv/lib/python3.12/site-packages:/app"
ENV PYTHONUNBUFFERED=1

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python - <<'PY'\nimport sys\nimport urllib.request\ntry:\n    with urllib.request.urlopen('http://localhost:8000/health', timeout=2) as r:\n        sys.exit(0 if r.status == 200 else 1)\nexcept Exception:\n    sys.exit(1)\nPY

# Run with Uvicorn
CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
