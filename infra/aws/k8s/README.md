# drovi-stack Kubernetes Layer (AWS / EKS)

This directory maps `docker-compose.yml` services to Kubernetes workloads for EKS.

## Included Workloads

- Drovi intelligence API + workers:
  - `drovi-intelligence-api`
  - `drovi-worker`
  - `drovi-jobs-worker`
  - `drovi-ingestion-worker`
  - `drovi-temporal-worker`
- Imperium API + all worker roles
- Frontends:
  - `web`
  - `admin`
  - `imperium-web`
- Stateful in-cluster services:
  - `falkordb`
  - `nats`
- Bootstrap jobs (applied separately):
  - `drovi-db-migrate`
  - `drovi-kafka-topic-bootstrap`

## Prerequisites

1. EKS cluster deployed and reachable with `kubectl`
2. AWS Load Balancer Controller installed
3. ECR images built/pushed and image placeholders replaced
4. `drovi-secrets` created in namespace `drovi` (template: `secrets.template.yaml`)

## Deploy

```bash
# Create/update runtime secrets first
kubectl apply -f infra/aws/k8s/base/secrets.template.yaml

# Staging
kubectl apply -k infra/aws/k8s/overlays/staging

# Production
kubectl apply -k infra/aws/k8s/overlays/production
```

## Run Bootstrap Jobs

```bash
kubectl -n drovi delete job drovi-db-migrate drovi-kafka-topic-bootstrap --ignore-not-found
kubectl apply -f infra/aws/k8s/base/jobs.yaml
kubectl -n drovi wait --for=condition=complete job/drovi-db-migrate --timeout=20m
kubectl -n drovi wait --for=condition=complete job/drovi-kafka-topic-bootstrap --timeout=20m
```

## Key Customization Points

1. Replace all `REPLACE_*` image, ARN, and endpoint placeholders.
2. Set `TEMPORAL_ADDRESS` in `drovi-secrets` for Temporal Cloud or self-hosted Temporal.
3. Update ingress certificate ARN and hostnames in overlays.
4. Replace service account IAM role annotations for IRSA.

## Notes

- `FalkorDB` and `NATS` are StatefulSets by design because there are no direct managed AWS equivalents for your required behavior.
- Core persistence/event services are expected to be managed AWS: `RDS`, `ElastiCache`, `MSK`, `S3`.
- If you self-host Temporal in-cluster, deploy it separately (Helm) and point `TEMPORAL_ADDRESS` accordingly.
