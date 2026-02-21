variable "project" {
  description = "Project name prefix for AWS resources."
  type        = string
  default     = "drovi"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production"
  }
}

variable "aws_region" {
  description = "AWS region for this stack."
  type        = string
  default     = "us-east-1"
}

variable "availability_zones" {
  description = "AZs used by VPC, EKS, and managed data services."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

variable "vpc_cidr" {
  description = "Primary VPC CIDR block."
  type        = string
  default     = "10.42.0.0/16"
}

variable "eks_public_access_cidrs" {
  description = "CIDRs allowed to access EKS public endpoint."
  type        = list(string)
  default     = ["0.0.0.0/0"]

  validation {
    condition     = var.environment != "production" || !contains(var.eks_public_access_cidrs, "0.0.0.0/0")
    error_message = "Production must not expose the EKS API publicly to 0.0.0.0/0."
  }
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version."
  type        = string
  default     = "1.30"
}

variable "eks_node_instance_types" {
  description = "EC2 instance types for EKS managed node groups."
  type        = list(string)
  default     = ["m7i.large"]
}

variable "eks_node_min_size" {
  description = "Minimum EKS node count."
  type        = number
  default     = 3

  validation {
    condition     = var.eks_node_min_size >= 1
    error_message = "eks_node_min_size must be at least 1."
  }
}

variable "eks_node_desired_size" {
  description = "Desired EKS node count."
  type        = number
  default     = 4

  validation {
    condition     = var.eks_node_desired_size >= var.eks_node_min_size && var.eks_node_desired_size <= var.eks_node_max_size
    error_message = "eks_node_desired_size must be between eks_node_min_size and eks_node_max_size."
  }
}

variable "eks_node_max_size" {
  description = "Maximum EKS node count."
  type        = number
  default     = 10

  validation {
    condition     = var.eks_node_max_size >= 1
    error_message = "eks_node_max_size must be at least 1."
  }
}

variable "db_instance_class" {
  description = "RDS instance class for PostgreSQL."
  type        = string
  default     = "db.t4g.large"
}

variable "db_allocated_storage" {
  description = "RDS allocated storage in GiB."
  type        = number
  default     = 100
}

variable "db_max_allocated_storage" {
  description = "RDS autoscaling storage ceiling in GiB."
  type        = number
  default     = 500
}

variable "db_backup_retention_days" {
  description = "Number of days to retain RDS backups."
  type        = number
  default     = 7

  validation {
    condition     = var.environment != "production" || var.db_backup_retention_days >= 7
    error_message = "Production requires db_backup_retention_days >= 7."
  }
}

variable "db_multi_az" {
  description = "Enable multi-AZ for PostgreSQL."
  type        = bool
  default     = true
}

variable "db_skip_final_snapshot" {
  description = "Skip RDS final snapshot on destroy (set true for ephemeral envs only)."
  type        = bool
  default     = false
}

variable "db_master_username" {
  description = "Master username for PostgreSQL."
  type        = string
  default     = "drovi"
}

variable "db_master_password" {
  description = "Optional explicit RDS master password. If empty, Terraform generates one."
  type        = string
  default     = ""
  sensitive   = true
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.m7g.large"
}

variable "redis_engine_version" {
  description = "Redis engine version for ElastiCache."
  type        = string
  default     = "7.1"
}

variable "redis_replicas_per_node_group" {
  description = "Replica count for single Redis shard."
  type        = number
  default     = 1

  validation {
    condition     = var.redis_replicas_per_node_group >= 0
    error_message = "redis_replicas_per_node_group cannot be negative."
  }

  validation {
    condition     = var.environment != "production" || var.redis_replicas_per_node_group >= 1
    error_message = "Production requires at least one Redis replica per node group."
  }
}

variable "redis_auth_token" {
  description = "Optional explicit Redis auth token. If empty, Terraform generates one."
  type        = string
  default     = ""
  sensitive   = true
}

variable "msk_kafka_version" {
  description = "MSK Kafka version."
  type        = string
  default     = "3.6.0"
}

variable "msk_broker_count" {
  description = "Number of MSK brokers. Should match AZ count for HA."
  type        = number
  default     = 3

  validation {
    condition     = var.msk_broker_count >= 3
    error_message = "msk_broker_count must be at least 3 for HA."
  }
}

variable "msk_broker_instance_type" {
  description = "MSK broker instance type."
  type        = string
  default     = "kafka.m7g.large"
}

variable "msk_volume_size_gb" {
  description = "Per-broker EBS volume size for MSK in GiB."
  type        = number
  default     = 200
}

variable "msk_scram_username" {
  description = "SCRAM username for MSK clients."
  type        = string
  default     = "drovi"
}

variable "msk_scram_password" {
  description = "Optional explicit SCRAM password. If empty, Terraform generates one."
  type        = string
  default     = ""
  sensitive   = true
}

variable "evidence_bucket_name" {
  description = "Optional override for evidence S3 bucket name."
  type        = string
  default     = ""
}

variable "s3_object_lock_enabled" {
  description = "Enable S3 object lock for evidence bucket immutability."
  type        = bool
  default     = true
}

variable "evidence_default_retention_days" {
  description = "Default governance retention for evidence bucket objects."
  type        = number
  default     = 365
}

variable "web_cors_origins" {
  description = "Allowed origins for evidence bucket CORS."
  type        = list(string)
  default = [
    "https://app.drovi.co",
    "https://admin.drovi.co",
  ]
}

variable "ecr_lifecycle_max_images" {
  description = "How many tagged images to retain in each ECR repository."
  type        = number
  default     = 50
}
