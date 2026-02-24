# World Brain Phase 14A Reference Architecture

## Scope
This document defines production reference architecture and environment parity rules for World Brain workloads running in existing Drovi AWS infrastructure.

## Environment Topology

| Layer | Staging | Production |
| --- | --- | --- |
| VPC/EKS | `drovi-staging` | `drovi-production` |
| Data Plane | RDS + Redis + MSK + S3 evidence/lakehouse + Glue registry | Same services, HA tuned |
| Graph Plane | FalkorDB statefulset in-cluster | FalkorDB statefulset in-cluster |
| Runtime | API + workers + world-brain worker pools | Same manifests with production overlays |

## Parity Rules

1. Every service deployed in production must exist in staging with identical image and API contracts.
2. Staging and production must share the same Terraform module versions and K8s base manifests.
3. Differences are allowed only in overlays for replicas, resource sizes, scaling ceilings, and ingress hostnames.
4. Event contracts, DB migrations, and kustomize renders must pass CI before merge.
5. New provider credentials must come from Secrets Manager or environment secrets, never from committed plaintext.

## Data Plane Components

1. Postgres: authoritative metadata and job ledgers.
2. MSK: stream backbone for world-brain contracts and replay.
3. Redis: fast coordination and cache workloads.
4. S3 Evidence bucket: immutable raw evidence and artifacts.
5. S3 Lakehouse bucket: bronze/silver/gold historical partitions.
6. Glue Schema Registry: stream contract governance and compatibility.
7. Secrets Manager: provider key custody with runtime sync.

## Network and Policy Boundaries

1. Managed data services are private-subnet only.
2. Data plane security groups accept traffic from VPC CIDR and explicitly trusted SG IDs (EKS nodes + approved peers).
3. IRSA role for `drovi-intelligence-sa` scopes access to evidence/lakehouse buckets, KMS, Glue registry, and managed world-brain secrets.
4. TLS-only bucket policies are required for evidence and lakehouse.

## World Brain Runtime Topology

1. `drovi-world-normalize-worker` for high-volume normalization.
2. `drovi-world-graph-worker` for graph/evolution updates.
3. `drovi-world-ml-worker` for hypothesis/learning pipelines.
4. `drovi-world-simulation-worker` for simulation/intervention jobs.
5. `drovi-world-critical-worker` for risk/compliance and world-twin critical paths.
6. Maintenance cron profiles:
 - `fast`: connector health + world twin prematerialization.
 - `hourly`: connector health + lakehouse lifecycle + reliability calibration.
7. Autoscale controller:
 - `world-brain-autoscaler` cronjob updates HPA `minReplicas` from queue lag + freshness lag pressure.

## Deployment Guardrails

1. Rollout checks include all world-brain deployments in `deploy_stack.sh`.
2. Failed rollouts trigger automatic `kubectl rollout undo` attempts.
3. Staging and production overlays enforce rollout strategy (`maxUnavailable=0`) for world-brain pools.
4. `world-brain-platform-gates` workflow blocks merges on infra/contract/migration/replay regressions.
5. Autoscaler patches are bounded by HPA max replicas, cooldown, and max-step controls.

## Acceptance Criteria

1. `terraform validate` and kustomize renders succeed for base, staging, and production overlays.
2. All world-brain deployments roll out and remain available after deploy.
3. Provider secret sync job can patch runtime secret keys from managed secret sources.
4. DR and incident runbooks exist and are exercised on schedule.
