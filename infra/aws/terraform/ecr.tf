module "data" {
  source = "./modules/data"

  name_prefix        = local.name_prefix
  vpc_id             = module.network.vpc_id
  vpc_cidr_block     = module.network.vpc_cidr_block
  private_subnet_ids = module.network.private_subnet_ids
  production_mode    = var.environment == "production"
  trusted_security_group_ids = distinct(concat(
    compact([module.eks.node_security_group_id]),
    var.trusted_data_plane_security_group_ids
  ))

  db_instance_class        = var.db_instance_class
  db_allocated_storage     = var.db_allocated_storage
  db_max_allocated_storage = var.db_max_allocated_storage
  db_backup_retention_days = var.db_backup_retention_days
  db_multi_az              = var.db_multi_az
  db_skip_final_snapshot   = var.db_skip_final_snapshot
  db_master_username       = var.db_master_username
  db_master_password       = local.db_master_password

  redis_node_type               = var.redis_node_type
  redis_engine_version          = var.redis_engine_version
  redis_replicas_per_node_group = var.redis_replicas_per_node_group
  redis_auth_token              = local.redis_auth_token

  msk_kafka_version        = var.msk_kafka_version
  msk_broker_count         = var.msk_broker_count
  msk_broker_instance_type = var.msk_broker_instance_type
  msk_volume_size_gb       = var.msk_volume_size_gb
  msk_scram_username       = var.msk_scram_username
  msk_scram_password       = local.msk_scram_password

  evidence_bucket_name               = local.evidence_bucket_name
  lakehouse_bucket_name              = local.lakehouse_bucket_name
  s3_object_lock_enabled             = var.s3_object_lock_enabled
  evidence_default_retention_days    = var.evidence_default_retention_days
  lakehouse_hot_retention_days       = var.lakehouse_hot_retention_days
  lakehouse_warm_retention_days      = var.lakehouse_warm_retention_days
  lakehouse_cold_retention_days      = var.lakehouse_cold_retention_days
  enable_glue_schema_registry        = var.enable_glue_schema_registry
  glue_schema_registry_name          = var.glue_schema_registry_name
  enable_world_brain_managed_secrets = var.enable_world_brain_managed_secrets
  world_brain_managed_secret_names   = var.world_brain_managed_secret_names
  web_cors_origins                   = var.web_cors_origins

  ecr_repositories         = local.ecr_repositories
  ecr_lifecycle_max_images = var.ecr_lifecycle_max_images

  tags = local.common_tags
}
