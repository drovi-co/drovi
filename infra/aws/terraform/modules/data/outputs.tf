output "kms_key_arn" {
  description = "KMS key ARN for data-at-rest encryption."
  value       = aws_kms_key.data.arn
}

output "evidence_bucket_name" {
  description = "S3 evidence bucket name."
  value       = aws_s3_bucket.evidence.bucket
}

output "lakehouse_bucket_name" {
  description = "S3 lakehouse bucket name."
  value       = aws_s3_bucket.lakehouse.bucket
}

output "postgres_endpoint" {
  description = "RDS endpoint in host:port format."
  value       = aws_db_instance.postgres.endpoint
}

output "postgres_master_username" {
  description = "RDS master username."
  value       = aws_db_instance.postgres.username
}

output "redis_primary_endpoint" {
  description = "Primary ElastiCache endpoint."
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "msk_bootstrap_brokers_tls" {
  description = "MSK bootstrap brokers for TLS clients."
  value       = aws_msk_cluster.this.bootstrap_brokers_tls
}

output "glue_schema_registry_name" {
  description = "AWS Glue schema registry name for world-brain contracts."
  value       = try(aws_glue_registry.world_brain[0].registry_name, null)
}

output "world_brain_managed_secret_arns" {
  description = "ARNs for provisioned world-brain provider credential placeholders."
  value       = values(aws_secretsmanager_secret.world_brain_provider)[*].arn
}

output "ecr_repository_urls" {
  description = "Map of ECR repository URLs."
  value = {
    for name, repo in aws_ecr_repository.repo :
    name => repo.repository_url
  }
}
