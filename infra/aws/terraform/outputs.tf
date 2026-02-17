output "vpc_id" {
  description = "VPC id used by the stack."
  value       = module.network.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet ids used by EKS and data services."
  value       = module.network.private_subnet_ids
}

output "eks_cluster_name" {
  description = "EKS cluster name."
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "EKS API endpoint."
  value       = module.eks.cluster_endpoint
}

output "ecr_repository_urls" {
  description = "Map of ECR repository URLs by logical service image name."
  value       = module.data.ecr_repository_urls
}

output "evidence_bucket_name" {
  description = "S3 bucket for evidence and documents."
  value       = module.data.evidence_bucket_name
}

output "evidence_kms_key_arn" {
  description = "KMS key ARN for evidence encryption."
  value       = module.data.kms_key_arn
}

output "postgres_endpoint" {
  description = "RDS endpoint (host:port)."
  value       = module.data.postgres_endpoint
}

output "postgres_master_username" {
  description = "RDS master username."
  value       = module.data.postgres_master_username
}

output "postgres_master_password" {
  description = "RDS master password (generated unless overridden)."
  value       = local.db_master_password
  sensitive   = true
}

output "redis_primary_endpoint" {
  description = "Primary Redis endpoint for ElastiCache replication group."
  value       = module.data.redis_primary_endpoint
}

output "redis_auth_token" {
  description = "Redis AUTH token (generated unless overridden)."
  value       = local.redis_auth_token
  sensitive   = true
}

output "msk_bootstrap_brokers_tls" {
  description = "MSK TLS bootstrap brokers string."
  value       = module.data.msk_bootstrap_brokers_tls
}

output "msk_scram_username" {
  description = "MSK SCRAM username."
  value       = var.msk_scram_username
}

output "msk_scram_password" {
  description = "MSK SCRAM password (generated unless overridden)."
  value       = local.msk_scram_password
  sensitive   = true
}

output "kubeconfig_update_command" {
  description = "Command to set local kubectl context for the new EKS cluster."
  value       = "aws eks update-kubeconfig --region ${var.aws_region} --name ${module.eks.cluster_name}"
}
