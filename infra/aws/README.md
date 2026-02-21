# AWS Deployment Blueprint for drovi-stack

This directory provides a production-oriented scaffold to deploy the full `drovi-stack` from `docker-compose.yml` to AWS.

## Structure

- `terraform/`: AWS infrastructure foundation
  - VPC, EKS, ECR
  - RDS PostgreSQL
  - ElastiCache Redis
  - MSK Kafka (SCRAM)
  - S3 + KMS for evidence/documents
- `k8s/`: Kubernetes workloads and overlays for EKS
  - Drovi API/workers, Imperium API/workers, web/admin
  - FalkorDB and NATS StatefulSets
  - DB migration + Kafka topic bootstrap jobs
- `scripts/deploy_stack.sh`: CI/CD deployment script used by GitHub Actions

## Compose-to-AWS Mapping

- `postgres` + `temporal-postgres` -> RDS PostgreSQL (separate logical DBs: `drovi`, `temporal`)
- `redpanda` + `redpanda-init` -> Amazon MSK + `drovi-kafka-topic-bootstrap` Job
- `minio` + `minio-init` -> S3 + bucket CORS/object-lock configuration
- `redis` -> ElastiCache Redis
- `falkordb` -> EKS StatefulSet
- `nats` -> EKS StatefulSet
- `drovi-intelligence` + workers -> EKS Deployments
- `imperium-api` + workers -> EKS Deployments
- `web`, `admin`, `imperium-web` -> EKS Deployments + ALB Ingress
- `temporal`/`temporal-ui` -> Temporal Cloud (recommended) or separate Temporal Helm deployment

## End-to-End Rollout

1. Provision AWS foundation:

```bash
cd infra/aws/terraform
cp terraform.tfvars.example terraform.tfvars
cp backend.hcl.example backend.hcl
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

2. Update kube context:

```bash
aws eks update-kubeconfig --region <region> --name <cluster-name>
```

3. Build and push images to ECR repos from Terraform output `ecr_repository_urls`.

4. Create/update runtime secrets and deploy Kubernetes layer:

```bash
# Staging
kubectl apply -k infra/aws/k8s/overlays/staging

# Production
kubectl apply -k infra/aws/k8s/overlays/production
```

5. Run bootstrap jobs (migrations/topics) and verify health endpoints.

## GitHub Actions Deployment

Added workflows:

- `.github/workflows/deploy-aws-staging.yml`
- `.github/workflows/deploy-aws-production.yml`
- `.github/workflows/deploy-aws-shared.yml`

Required environment variables (`staging` and `production` GitHub environments):

- `AWS_REGION`
- `EKS_CLUSTER_NAME`
- `ECR_REPOSITORY_PREFIX` (example: `drovi-staging`)
- `VITE_SERVER_URL_WEB`
- `VITE_SERVER_URL_ADMIN`
- `DROVI_APP_IAM_ROLE_ARN`
- `IMPERIUM_IAM_ROLE_ARN`
- `ACM_CERT_ARN`

Required environment secrets:

- `AWS_ROLE_ARN` (OIDC assumable role)
- `DATABASE_URL`
- `DROVI_DATABASE_URL`
- `REDIS_URL`
- `KAFKA_BOOTSTRAP_SERVERS`
- `KAFKA_SASL_USERNAME`
- `KAFKA_SASL_PASSWORD`
- `EVIDENCE_S3_BUCKET`
- `EVIDENCE_S3_REGION`
- `EVIDENCE_S3_KMS_KEY_ID`
- `TEMPORAL_ADDRESS`
- `DROVI_INTERNAL_SERVICE_TOKEN`
- `INTERNAL_JWT_SECRET`
- `API_KEY_SALT`
- Provider secrets as needed (`OPENAI_API_KEY`, `TOGETHER_API_KEY`, etc.)

Tip: `DROVI_APP_IAM_ROLE_ARN` and `IMPERIUM_IAM_ROLE_ARN` are now emitted by Terraform outputs
(`drovi_app_iam_role_arn`, `imperium_iam_role_arn`) from `infra/aws/terraform`.

For ElastiCache with transit encryption enabled, `REDIS_URL` must use `rediss://`.

## Operational Defaults

- Kafka security is `SASL_SSL` + SCRAM.
- Evidence storage is S3/KMS with object-lock support.
- Core service probes align with existing app endpoints (`/health/live`, `/health/ready`, `/ready`).
- HPA included for `drovi-intelligence-api`, `drovi-worker`, and `imperium-api`.
