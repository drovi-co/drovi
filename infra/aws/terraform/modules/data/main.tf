resource "aws_kms_key" "data" {
  description             = "KMS key for drovi-stack data at rest"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = var.tags
}

resource "aws_kms_alias" "data" {
  name          = "alias/${var.name_prefix}-data"
  target_key_id = aws_kms_key.data.key_id
}

locals {
  trusted_security_group_ids = toset(compact(var.trusted_security_group_ids))
  glue_registry_name = (
    trimspace(var.glue_schema_registry_name) != ""
    ? trimspace(var.glue_schema_registry_name)
    : "${var.name_prefix}-world-brain"
  )
  world_brain_managed_secret_names = (
    var.enable_world_brain_managed_secrets
    ? toset([for item in var.world_brain_managed_secret_names : trimspace(item) if trimspace(item) != ""])
    : toset([])
  )
}

resource "aws_ecr_repository" "repo" {
  for_each = var.ecr_repositories

  name                 = "${var.name_prefix}/${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.data.arn
  }

  tags = var.tags
}

resource "aws_ecr_lifecycle_policy" "repo" {
  for_each = var.ecr_repositories

  repository = aws_ecr_repository.repo[each.key].name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Retain the most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.ecr_lifecycle_max_images
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_s3_bucket" "evidence" {
  bucket              = var.evidence_bucket_name
  object_lock_enabled = var.s3_object_lock_enabled

  tags = merge(var.tags, {
    DataClass = "evidence"
  })
}

resource "aws_s3_bucket_versioning" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD", "PUT", "POST", "DELETE"]
    allowed_origins = var.web_cors_origins
    expose_headers  = ["ETag", "x-amz-request-id", "x-amz-id-2"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_object_lock_configuration" "evidence" {
  count  = var.s3_object_lock_enabled ? 1 : 0
  bucket = aws_s3_bucket.evidence.id

  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = var.evidence_default_retention_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.evidence]
}

data "aws_iam_policy_document" "evidence_tls_only" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.evidence.arn,
      "${aws_s3_bucket.evidence.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "evidence_tls_only" {
  bucket = aws_s3_bucket.evidence.id
  policy = data.aws_iam_policy_document.evidence_tls_only.json
}

resource "aws_s3_bucket" "lakehouse" {
  bucket = var.lakehouse_bucket_name

  tags = merge(var.tags, {
    DataClass = "lakehouse"
  })
}

resource "aws_s3_bucket_versioning" "lakehouse" {
  bucket = aws_s3_bucket.lakehouse.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "lakehouse" {
  bucket = aws_s3_bucket.lakehouse.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "lakehouse" {
  bucket = aws_s3_bucket.lakehouse.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "lakehouse" {
  bucket = aws_s3_bucket.lakehouse.id

  rule {
    id     = "lakehouse-hot-warm-cold"
    status = "Enabled"

    transition {
      days          = max(1, var.lakehouse_hot_retention_days)
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = max(var.lakehouse_hot_retention_days + 1, var.lakehouse_warm_retention_days)
      storage_class = "GLACIER"
    }

    expiration {
      days = max(var.lakehouse_warm_retention_days + 1, var.lakehouse_cold_retention_days)
    }
  }
}

data "aws_iam_policy_document" "lakehouse_tls_only" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.lakehouse.arn,
      "${aws_s3_bucket.lakehouse.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "lakehouse_tls_only" {
  bucket = aws_s3_bucket.lakehouse.id
  policy = data.aws_iam_policy_document.lakehouse_tls_only.json
}

resource "aws_security_group" "rds" {
  name        = "${var.name_prefix}-rds-sg"
  description = "RDS access for drovi-stack"
  vpc_id      = var.vpc_id

  ingress {
    description = "PostgreSQL from VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_security_group" "redis" {
  name        = "${var.name_prefix}-redis-sg"
  description = "ElastiCache Redis access for drovi-stack"
  vpc_id      = var.vpc_id

  ingress {
    description = "Redis from VPC"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_security_group" "msk" {
  name        = "${var.name_prefix}-msk-sg"
  description = "MSK broker access for drovi-stack"
  vpc_id      = var.vpc_id

  ingress {
    description = "Kafka TLS from VPC"
    from_port   = 9094
    to_port     = 9094
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr_block]
  }

  ingress {
    description = "Kafka SASL SCRAM from VPC"
    from_port   = 9096
    to_port     = 9096
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_security_group_rule" "rds_from_trusted_sg" {
  for_each = local.trusted_security_group_ids

  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rds.id
  source_security_group_id = each.value
  description              = "PostgreSQL access from trusted security group"
}

resource "aws_security_group_rule" "redis_from_trusted_sg" {
  for_each = local.trusted_security_group_ids

  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = aws_security_group.redis.id
  source_security_group_id = each.value
  description              = "Redis access from trusted security group"
}

resource "aws_security_group_rule" "msk_tls_from_trusted_sg" {
  for_each = local.trusted_security_group_ids

  type                     = "ingress"
  from_port                = 9094
  to_port                  = 9094
  protocol                 = "tcp"
  security_group_id        = aws_security_group.msk.id
  source_security_group_id = each.value
  description              = "MSK TLS access from trusted security group"
}

resource "aws_security_group_rule" "msk_scram_from_trusted_sg" {
  for_each = local.trusted_security_group_ids

  type                     = "ingress"
  from_port                = 9096
  to_port                  = 9096
  protocol                 = "tcp"
  security_group_id        = aws_security_group.msk.id
  source_security_group_id = each.value
  description              = "MSK SCRAM access from trusted security group"
}

resource "aws_db_subnet_group" "postgres" {
  name       = "${var.name_prefix}-postgres-subnets"
  subnet_ids = var.private_subnet_ids

  tags = var.tags
}

resource "aws_db_instance" "postgres" {
  identifier = "${var.name_prefix}-postgres"

  engine         = "postgres"
  engine_version = "16.4"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.data.arn

  db_name  = "drovi"
  username = var.db_master_username
  password = var.db_master_password

  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"

  multi_az                        = var.db_multi_az
  performance_insights_enabled    = true
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  deletion_protection       = var.production_mode
  skip_final_snapshot       = var.db_skip_final_snapshot
  final_snapshot_identifier = var.db_skip_final_snapshot ? null : "${var.name_prefix}-postgres-final"

  apply_immediately   = false
  publicly_accessible = false

  tags = var.tags
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.name_prefix}-redis-subnets"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${var.name_prefix}-redis"
  description          = "Redis for drovi-stack"
  engine               = "redis"
  engine_version       = var.redis_engine_version
  node_type            = var.redis_node_type
  port                 = 6379
  parameter_group_name = "default.redis${split(".", var.redis_engine_version)[0]}"
  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [aws_security_group.redis.id]

  automatic_failover_enabled = var.redis_replicas_per_node_group > 0
  multi_az_enabled           = var.redis_replicas_per_node_group > 0
  num_node_groups            = 1
  replicas_per_node_group    = var.redis_replicas_per_node_group

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = var.redis_auth_token

  snapshot_retention_limit = 7
  snapshot_window          = "02:00-03:00"
  maintenance_window       = "sun:06:00-sun:07:00"

  apply_immediately = false

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "msk" {
  name              = "/aws/msk/${var.name_prefix}"
  retention_in_days = 30
}

resource "aws_msk_configuration" "default" {
  name           = "${var.name_prefix}-msk-config"
  kafka_versions = [var.msk_kafka_version]

  server_properties = <<EOT
allow.everyone.if.no.acl.found=false
auto.create.topics.enable=false
default.replication.factor=3
min.insync.replicas=2
num.partitions=3
offsets.topic.replication.factor=3
transaction.state.log.replication.factor=3
transaction.state.log.min.isr=2
super.users=User:${var.msk_scram_username}
EOT
}

resource "aws_secretsmanager_secret" "msk_scram" {
  name                    = "AmazonMSK_${var.name_prefix}_scram"
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = 7

  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "msk_scram" {
  secret_id = aws_secretsmanager_secret.msk_scram.id
  secret_string = jsonencode({
    username = var.msk_scram_username
    password = var.msk_scram_password
  })
}

data "aws_iam_policy_document" "msk_secret" {
  statement {
    sid    = "AllowMSKToReadSecret"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["kafka.amazonaws.com"]
    }

    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
      "secretsmanager:ListSecretVersionIds",
    ]

    resources = [aws_secretsmanager_secret.msk_scram.arn]
  }
}

resource "aws_secretsmanager_secret_policy" "msk_secret" {
  secret_arn = aws_secretsmanager_secret.msk_scram.arn
  policy     = data.aws_iam_policy_document.msk_secret.json
}

resource "aws_msk_cluster" "this" {
  cluster_name           = "${var.name_prefix}-msk"
  kafka_version          = var.msk_kafka_version
  number_of_broker_nodes = var.msk_broker_count

  broker_node_group_info {
    instance_type   = var.msk_broker_instance_type
    client_subnets  = var.private_subnet_ids
    security_groups = [aws_security_group.msk.id]

    storage_info {
      ebs_storage_info {
        volume_size = var.msk_volume_size_gb
      }
    }
  }

  configuration_info {
    arn      = aws_msk_configuration.default.arn
    revision = aws_msk_configuration.default.latest_revision
  }

  encryption_info {
    encryption_at_rest_kms_key_arn = aws_kms_key.data.arn

    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
  }

  client_authentication {
    sasl {
      scram = true
    }
  }

  open_monitoring {
    prometheus {
      jmx_exporter {
        enabled_in_broker = true
      }
      node_exporter {
        enabled_in_broker = true
      }
    }
  }

  logging_info {
    broker_logs {
      cloudwatch_logs {
        enabled   = true
        log_group = aws_cloudwatch_log_group.msk.name
      }
    }
  }

  enhanced_monitoring = "PER_TOPIC_PER_PARTITION"

  tags = var.tags
}

resource "aws_msk_scram_secret_association" "this" {
  cluster_arn     = aws_msk_cluster.this.arn
  secret_arn_list = [aws_secretsmanager_secret.msk_scram.arn]

  depends_on = [aws_secretsmanager_secret_policy.msk_secret]
}

resource "aws_glue_registry" "world_brain" {
  count = var.enable_glue_schema_registry ? 1 : 0

  registry_name = local.glue_registry_name
  description   = "World Brain schema registry for event contracts and compatibility governance."

  tags = merge(var.tags, {
    Purpose = "world-brain-schema-registry"
  })
}

resource "aws_secretsmanager_secret" "world_brain_provider" {
  for_each = local.world_brain_managed_secret_names

  name                    = "${var.name_prefix}/world-brain/${each.value}"
  description             = "World Brain managed provider credential placeholder (${each.value})."
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = 7

  tags = merge(var.tags, {
    SecretClass = "world-brain-provider"
  })
}
