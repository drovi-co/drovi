# Drovi Intelligence Backend Dockerfile

FROM python:3.12-slim AS builder

WORKDIR /app

# Build deps for packages that may require native compilation.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

# Copy dependency files and install production dependencies only.
COPY pyproject.toml README.md ./
ARG PYTORCH_CPU_VERSION=2.5.1
RUN uv venv /app/.venv \
    && printf "torch==%s+cpu\ntorchaudio==%s+cpu\n" "${PYTORCH_CPU_VERSION}" "${PYTORCH_CPU_VERSION}" > /tmp/cpu-ml-constraints.txt \
    && uv pip install --python /app/.venv/bin/python \
      --index-url https://pypi.org/simple \
      --extra-index-url https://download.pytorch.org/whl/cpu \
      --index-strategy unsafe-best-match \
      -r /tmp/cpu-ml-constraints.txt \
    && uv pip install --python /app/.venv/bin/python \
      --constraint /tmp/cpu-ml-constraints.txt \
      --index-url https://pypi.org/simple \
      --extra-index-url https://download.pytorch.org/whl/cpu \
      --index-strategy unsafe-best-match \
      .

FROM python:3.12-slim

WORKDIR /app

# Runtime deps required by OCR/audio paths.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    tesseract-ocr \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.venv /app/.venv

# Runtime application code only.
COPY src/ ./src/
COPY alembic.ini ./alembic.ini
COPY alembic/ ./alembic/
COPY scripts/ ./scripts/

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/.venv/lib/python3.12/site-packages:/app" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD ["python","-c","code = \"\"\"import sys,urllib.request\ntry:\n    r=urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=2)\n    sys.exit(0 if r.status==200 else 1)\nexcept Exception:\n    sys.exit(1)\n\"\"\"; exec(code)"]

CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
