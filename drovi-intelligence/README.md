# Drovi Intelligence

State-of-the-art Python AI backend for intelligence extraction from communication data.

## Features

- **LangGraph Orchestrator**: Multi-agent pipeline for intelligence extraction
- **FalkorDB Integration**: Native Python client for knowledge graph
- **Hybrid Search**: Vector + fulltext + graph search with RRF fusion
- **Agentic Memory**: Graphiti-inspired temporal memory system
- **Multi-Provider LLM**: LiteLLM router for OpenAI, Anthropic, Google

## Quick Start

### Prerequisites

- Python 3.12+
- UV (Python package manager)
- FalkorDB instance
- PostgreSQL database

### Installation

```bash
# Install dependencies
uv pip install -e .

# Copy environment variables
cp .env.example .env
# Edit .env with your configuration
```

### Running

```bash
# Development server
uvicorn src.api.main:app --reload --port 8000

# Or use the script
./scripts/dev.sh
```

### Testing

```bash
# Run unit tests
pytest tests/ -v

# Run integration tests (server must be running)
python scripts/test_integration.py
```

## API Endpoints

### Health
- `GET /health` - Health check
- `GET /ready` - Readiness check
- `GET /live` - Liveness check

### Intelligence
- `POST /analyze` - Analyze content and extract intelligence
- `POST /analyze/stream` - Streaming analysis (SSE)

### Search
- `POST /search` - Hybrid search
- `POST /search/vector` - Vector-only search
- `POST /search/fulltext` - Fulltext-only search
- `POST /search/graph-aware` - Graph-aware search

### Memory
- `POST /memory/search` - Search agentic memory
- `POST /memory/search/cross-source` - Cross-source search
- `POST /memory/timeline` - Get entity/contact timeline
- `GET /memory/recent` - Get recent episodes

### Graph
- `POST /graph/query` - Execute Cypher queries
- `GET /graph/stats` - Get graph statistics

## Architecture

```
drovi-intelligence/
├── src/
│   ├── api/           # FastAPI application
│   ├── orchestrator/  # LangGraph pipeline
│   ├── llm/           # LLM service (LiteLLM)
│   ├── graph/         # FalkorDB client
│   ├── memory/        # Agentic memory
│   ├── search/        # Hybrid search
│   └── db/            # PostgreSQL client
├── tests/
└── scripts/
```

## Deployment

### Railway

```bash
# Deploy to Railway
railway up
```

The service is configured for Railway deployment with:
- `Dockerfile` for containerization
- `railway.toml` for deployment config
- Native FalkorDB support via Railway template

## Environment Variables

See `.env.example` for all available configuration options.

Key variables:
- `DATABASE_URL` - PostgreSQL connection string
- `FALKORDB_HOST` - FalkorDB host
- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic API key

## License

Proprietary
