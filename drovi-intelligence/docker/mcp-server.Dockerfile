# MCP Server Dockerfile
#
# Containerized MCP (Model Context Protocol) server for Drovi Intelligence.
# Enables AI clients like Claude Desktop and Cursor to access Drovi's knowledge graph.
#
# Part of Phase 5 (Agentic Memory) of the FalkorDB enhancement plan.

FROM python:3.12-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY pyproject.toml ./

# Install Python dependencies
RUN pip install --upgrade pip && \
    pip install .

# Copy application code
COPY src/ ./src/

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app
USER appuser

# Expose port for SSE transport (optional)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import src.mcp.server; print('healthy')" || exit 1

# Default command: run MCP server with stdio transport
ENTRYPOINT ["python", "-m", "src.mcp.server"]

# Alternative: SSE transport
# ENTRYPOINT ["python", "-m", "src.mcp.http_server"]
