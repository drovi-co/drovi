# Drovi Intelligence Backend Dockerfile
# Uses UV for fast Python dependency management

FROM python:3.12-slim AS builder

WORKDIR /app

# Install UV
RUN pip install uv

# Copy dependency files and README
COPY pyproject.toml README.md ./

# Create virtual environment and install dependencies
RUN uv venv && uv pip install .

# Production image
FROM python:3.12-slim

WORKDIR /app

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Copy application code
COPY src/ ./src/

# Set environment variables
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app"
ENV PYTHONUNBUFFERED=1

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8000/health')" || exit 1

# Run with Uvicorn
CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
