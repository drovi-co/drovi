# Drovi Intelligence - AWS Deployment with Porter

This guide covers deploying drovi-intelligence to AWS using [Porter](https://porter.run).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           AWS (via Porter)                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │   ALB       │────│  API (x2)   │────│  Amazon MSK (Kafka)     │ │
│  │  Ingress    │    │  Service    │    │  - drovi-raw-events     │ │
│  └─────────────┘    └─────────────┘    │  - drovi-intelligence   │ │
│                            │           │  - drovi-graph-changes  │ │
│                            │           └─────────────────────────┘ │
│                            │                      │                │
│                            ▼                      ▼                │
│                     ┌─────────────┐    ┌─────────────────────────┐ │
│                     │  FalkorDB   │    │  Kafka Worker (x2)      │ │
│                     │  (Custom)   │    │  Consumer Service       │ │
│                     └─────────────┘    └─────────────────────────┘ │
│                            │                      │                │
│                            ▼                      ▼                │
│                     ┌─────────────┐    ┌─────────────────────────┐ │
│                     │  Amazon RDS │    │  Amazon ElastiCache     │ │
│                     │  PostgreSQL │    │  Redis                  │ │
│                     └─────────────┘    └─────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

1. **Porter Account & CLI**
   ```bash
   # Install Porter CLI
   curl -fsSL https://porter.run/install.sh | bash

   # Login to Porter
   porter login
   ```

2. **AWS Account Connected**
   - Go to Porter Dashboard → Settings → Integrations
   - Connect your AWS account
   - Porter will create necessary IAM roles

3. **Create a Porter Project**
   ```bash
   # Create a new project
   porter project create drovi-prod

   # Set as active project
   porter project set drovi-prod
   ```

## Step 1: Set Up Secrets

```bash
# API Keys for LLM providers
porter secret set together-api-key "your-together-api-key"
porter secret set openai-api-key "your-openai-api-key"

# Internal service token (generate a strong random string)
porter secret set internal-service-token "$(openssl rand -hex 32)"

# Optional: Custom domain SSL
porter secret set domain-ssl-cert "$(cat cert.pem | base64)"
porter secret set domain-ssl-key "$(cat key.pem | base64)"
```

## Step 2: Deploy Infrastructure Add-ons

### PostgreSQL (Amazon RDS)
```bash
porter addon create rds-postgres drovi-postgres \
  --version 16 \
  --instance-type db.t3.medium \
  --storage 50 \
  --multi-az true
```

### Redis (Amazon ElastiCache)
```bash
porter addon create elasticache-redis drovi-redis \
  --version 7.0 \
  --node-type cache.t3.medium \
  --num-nodes 2
```

### Kafka (Amazon MSK)
```bash
porter addon create msk drovi-kafka \
  --version 3.5.1 \
  --broker-type kafka.t3.small \
  --num-brokers 3 \
  --storage 100
```

After MSK is created, create topics:
```bash
# Get MSK connection info
porter addon get drovi-kafka

# Create topics (run from a bastion or via AWS Console)
# Or use the Porter Kafka UI if available
```

## Step 3: Deploy FalkorDB

FalkorDB requires a custom deployment since it's not a standard Porter addon.

```bash
# Deploy FalkorDB as a custom service
porter app create falkordb \
  --image falkordb/falkordb:latest \
  --type worker \
  --cpu 1000m \
  --memory 4Gi \
  --port 6379 \
  --internal
```

Or use the Helm chart:
```bash
porter helm install falkordb ./deploy/porter/charts/falkordb
```

## Step 4: Deploy the Application

### Option A: Using Porter CLI
```bash
# Deploy API service
porter app create drovi-api \
  --dockerfile ./Dockerfile \
  --type web \
  --port 8000 \
  --cpu 500m \
  --memory 1Gi \
  --replicas 2 \
  --autoscale-min 2 \
  --autoscale-max 10 \
  --health-check-path /health

# Set environment variables
porter app env set drovi-api \
  KAFKA_ENABLED=true \
  LOG_LEVEL=INFO \
  LOG_FORMAT=json \
  FALKORDB_HOST=falkordb \
  FALKORDB_PORT=6379

# Link addons
porter app addon-link drovi-api drovi-postgres DATABASE_URL
porter app addon-link drovi-api drovi-redis REDIS_URL
porter app addon-link drovi-api drovi-kafka KAFKA_BOOTSTRAP_SERVERS

# Deploy Kafka worker
porter app create drovi-worker \
  --dockerfile ./Dockerfile \
  --type worker \
  --command "python -m src.streaming.worker" \
  --cpu 500m \
  --memory 1Gi \
  --replicas 2

# Set same env vars for worker
porter app env set drovi-worker \
  KAFKA_ENABLED=true \
  LOG_LEVEL=INFO \
  LOG_FORMAT=json \
  FALKORDB_HOST=falkordb \
  FALKORDB_PORT=6379

porter app addon-link drovi-worker drovi-postgres DATABASE_URL
porter app addon-link drovi-worker drovi-redis REDIS_URL
porter app addon-link drovi-worker drovi-kafka KAFKA_BOOTSTRAP_SERVERS
```

### Option B: Using porter.yaml
```bash
# Deploy everything at once
porter apply -f porter.yaml
```

## Step 5: Configure Custom Domain (Optional)

```bash
# Add custom domain
porter app domain add drovi-api api.drovi.app

# Configure SSL (Porter handles Let's Encrypt automatically)
# Or use your own certificate
```

## Step 6: Verify Deployment

```bash
# Check app status
porter app list

# View logs
porter app logs drovi-api
porter app logs drovi-worker

# Check health
curl https://drovi-api-xxx.porter.run/health

# Check Kafka connection
curl https://drovi-api-xxx.porter.run/api/v1/stream/health
```

## Environment Variables Reference

| Variable | Description | Source |
|----------|-------------|--------|
| `DATABASE_URL` | PostgreSQL connection string | RDS addon |
| `REDIS_URL` | Redis connection string | ElastiCache addon |
| `KAFKA_ENABLED` | Enable Kafka streaming | Set to `true` |
| `KAFKA_BOOTSTRAP_SERVERS` | MSK bootstrap servers | MSK addon |
| `KAFKA_SECURITY_PROTOCOL` | `SASL_SSL` for MSK | Manual |
| `KAFKA_SASL_MECHANISM` | `SCRAM-SHA-512` for MSK | Manual |
| `KAFKA_SASL_USERNAME` | MSK SASL username | MSK addon |
| `KAFKA_SASL_PASSWORD` | MSK SASL password | MSK addon |
| `FALKORDB_HOST` | FalkorDB service name | `falkordb` |
| `FALKORDB_PORT` | FalkorDB port | `6379` |
| `TOGETHER_API_KEY` | Together.ai API key | Secret |
| `OPENAI_API_KEY` | OpenAI API key | Secret |
| `DROVI_INTERNAL_SERVICE_TOKEN` | Internal service auth | Secret |
| `LOG_LEVEL` | Logging level | `INFO` |
| `LOG_FORMAT` | Log format | `json` |
| `CORS_ORIGINS` | Allowed CORS origins | JSON array |

## Scaling

```bash
# Scale API service
porter app scale drovi-api --replicas 5

# Enable autoscaling
porter app autoscale drovi-api \
  --min 2 \
  --max 20 \
  --cpu-threshold 70
```

## Monitoring

Porter provides built-in monitoring:
- **Metrics**: CPU, Memory, Network in Porter Dashboard
- **Logs**: `porter app logs <app-name> --follow`
- **Alerts**: Configure in Porter Dashboard → Alerts

For advanced monitoring:
```bash
# Deploy Prometheus/Grafana stack
porter addon create prometheus drovi-monitoring
```

## Cost Estimation

| Resource | Type | Monthly Cost (Est.) |
|----------|------|---------------------|
| API (2x) | t3.medium | ~$60 |
| Worker (2x) | t3.medium | ~$60 |
| FalkorDB | t3.medium + 50GB EBS | ~$50 |
| RDS PostgreSQL | db.t3.medium | ~$50 |
| ElastiCache Redis | cache.t3.medium x2 | ~$50 |
| MSK Kafka | kafka.t3.small x3 | ~$150 |
| ALB | Application LB | ~$20 |
| Data Transfer | ~100GB | ~$10 |
| **Total** | | **~$450/month** |

## Troubleshooting

### Kafka Connection Issues
```bash
# Check MSK status
porter addon status drovi-kafka

# Test from within cluster
porter app exec drovi-api -- python -c "
from src.streaming import get_kafka_producer
import asyncio
asyncio.run(get_kafka_producer())
print('Kafka connected!')
"
```

### FalkorDB Connection Issues
```bash
# Check FalkorDB status
porter app status falkordb

# Test connection
porter app exec drovi-api -- python -c "
from src.graph.client import get_graph_client
import asyncio
g = asyncio.run(get_graph_client())
print('FalkorDB connected!')
"
```

### Database Migration
```bash
# Run migrations
porter app exec drovi-api -- alembic upgrade head
```

## Cleanup

```bash
# Delete apps
porter app delete drovi-api
porter app delete drovi-worker
porter app delete falkordb

# Delete addons
porter addon delete drovi-postgres
porter addon delete drovi-redis
porter addon delete drovi-kafka

# Delete project
porter project delete drovi-prod
```
