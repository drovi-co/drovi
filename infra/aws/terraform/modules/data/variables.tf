variable "name_prefix" {
  description = "Prefix used for naming resources."
  type        = string
}

variable "vpc_id" {
  description = "VPC id for data plane security groups."
  type        = string
}

variable "vpc_cidr_block" {
  description = "VPC CIDR allowed to access internal data services."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet ids for managed services."
  type        = list(string)
}

variable "trusted_security_group_ids" {
  description = "Additional security groups allowed to access managed data services."
  type        = list(string)
  default     = []
}

variable "production_mode" {
  description = "True when running production environment."
  type        = bool
}

variable "db_instance_class" {
  description = "RDS instance class for PostgreSQL."
  type        = string
}

variable "db_allocated_storage" {
  description = "Allocated RDS storage in GiB."
  type        = number
}

variable "db_max_allocated_storage" {
  description = "Autoscaling storage ceiling in GiB."
  type        = number
}

variable "db_backup_retention_days" {
  description = "Backup retention in days."
  type        = number
}

variable "db_multi_az" {
  description = "Enable RDS multi-AZ."
  type        = bool
}

variable "db_skip_final_snapshot" {
  description = "Skip final RDS snapshot on destroy."
  type        = bool
}

variable "db_master_username" {
  description = "RDS master username."
  type        = string
}

variable "db_master_password" {
  description = "RDS master password."
  type        = string
  sensitive   = true
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
}

variable "redis_engine_version" {
  description = "Redis engine version."
  type        = string
}

variable "redis_replicas_per_node_group" {
  description = "Replica count per node group."
  type        = number
}

variable "redis_auth_token" {
  description = "Redis AUTH token."
  type        = string
  sensitive   = true
}

variable "msk_kafka_version" {
  description = "MSK Kafka version."
  type        = string
}

variable "msk_broker_count" {
  description = "Number of MSK brokers."
  type        = number
}

variable "msk_broker_instance_type" {
  description = "MSK broker instance type."
  type        = string
}

variable "msk_volume_size_gb" {
  description = "MSK EBS volume size in GiB."
  type        = number
}

variable "msk_scram_username" {
  description = "MSK SCRAM username."
  type        = string
}

variable "msk_scram_password" {
  description = "MSK SCRAM password."
  type        = string
  sensitive   = true
}

variable "evidence_bucket_name" {
  description = "S3 evidence bucket name."
  type        = string
}

variable "lakehouse_bucket_name" {
  description = "S3 lakehouse bucket name."
  type        = string
}

variable "s3_object_lock_enabled" {
  description = "Enable object lock on evidence bucket."
  type        = bool
}

variable "evidence_default_retention_days" {
  description = "Default object lock retention days."
  type        = number
}

variable "lakehouse_hot_retention_days" {
  description = "Lakehouse hot tier retention in days."
  type        = number
}

variable "lakehouse_warm_retention_days" {
  description = "Lakehouse warm tier retention in days."
  type        = number
}

variable "lakehouse_cold_retention_days" {
  description = "Lakehouse cold tier retention in days."
  type        = number
}

variable "enable_glue_schema_registry" {
  description = "Create AWS Glue Schema Registry."
  type        = bool
  default     = true
}

variable "glue_schema_registry_name" {
  description = "Optional override for Glue Schema Registry name."
  type        = string
  default     = ""
}

variable "enable_world_brain_managed_secrets" {
  description = "Create provider credential placeholders in Secrets Manager."
  type        = bool
  default     = false
}

variable "world_brain_managed_secret_names" {
  description = "Secret name suffixes for world-brain provider credentials."
  type        = list(string)
  default     = []
}

variable "web_cors_origins" {
  description = "Allowed origins for evidence CORS."
  type        = list(string)
}

variable "ecr_repositories" {
  description = "Logical ECR repository names."
  type        = set(string)
}

variable "ecr_lifecycle_max_images" {
  description = "Number of images to retain per ECR repository."
  type        = number
}

variable "tags" {
  description = "Default tags applied to resources."
  type        = map(string)
  default     = {}
}
