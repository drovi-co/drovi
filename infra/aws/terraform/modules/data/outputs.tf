output "kms_key_arn" {
  description = "KMS key ARN for data-at-rest encryption."
  value       = aws_kms_key.data.arn
}

output "evidence_bucket_name" {
  description = "S3 evidence bucket name."
  value       = aws_s3_bucket.evidence.bucket
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

output "ecr_repository_urls" {
  description = "Map of ECR repository URLs."
  value = {
    for name, repo in aws_ecr_repository.repo :
    name => repo.repository_url
  }
}
