# AWS Terraform Foundation for drovi-stack

This Terraform stack creates the AWS foundation required to run the full `drovi-stack` on EKS.

## Module Layout

- `modules/network`
  - VPC, subnets, NAT gateways, and EKS subnet discovery tags
- `modules/eks`
  - EKS control plane, managed node groups, and core add-ons
- `modules/data`
  - ECR repositories
  - RDS PostgreSQL
  - ElastiCache Redis
  - Amazon MSK (SCRAM)
  - S3 + KMS for evidence/documents

Root module responsibilities:

- Environment variables and defaults (`variables.tf`)
- Shared naming/tags (`locals.tf`)
- Generated secrets/passwords (`secrets.tf`)
- Wiring module inputs/outputs (`network.tf`, `eks.tf`, `ecr.tf`, `outputs.tf`)

## Prerequisites

1. Terraform `>= 1.6`
2. AWS CLI authenticated to your target account
3. IAM permission to create VPC/EKS/RDS/MSK/ECR/S3/KMS/ElastiCache resources

## Usage

```bash
cd infra/aws/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

## Next Steps After Apply

1. Create/update local kube context:

```bash
aws eks update-kubeconfig --region <region> --name <cluster-name>
```

2. Build and push all required images to the ECR repos emitted in `ecr_repository_urls`.
3. Populate Kubernetes secrets from Terraform outputs and provider keys.
4. Apply Kubernetes manifests from `infra/aws/k8s`.

## Notes

- This stack intentionally keeps stateful graph/event services in mixed mode:
  - Managed where native AWS exists (`RDS`, `ElastiCache`, `MSK`, `S3`)
  - In-cluster where AWS-native equivalent does not (`FalkorDB`, `NATS`)
- Temporal is expected to run in Temporal Cloud or as a separate Helm deployment.
- Tighten `eks_public_access_cidrs` before production.
