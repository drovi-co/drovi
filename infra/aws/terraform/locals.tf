locals {
  name_prefix = "${var.project}-${var.environment}"

  db_master_password = var.db_master_password != "" ? var.db_master_password : random_password.db_master.result
  redis_auth_token   = var.redis_auth_token != "" ? var.redis_auth_token : random_password.redis_auth.result
  msk_scram_password = var.msk_scram_password != "" ? var.msk_scram_password : random_password.msk_scram.result

  evidence_bucket_name  = var.evidence_bucket_name != "" ? var.evidence_bucket_name : "${local.name_prefix}-evidence"
  lakehouse_bucket_name = var.lakehouse_bucket_name != "" ? var.lakehouse_bucket_name : "${local.name_prefix}-lakehouse"

  ecr_repositories = toset([
    "drovi-intelligence",
    "drovi-ingestion-worker",
    "imperium-backend",
    "web",
    "admin",
    "imperium-web",
  ])

  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "drovi-stack"
  }
}
