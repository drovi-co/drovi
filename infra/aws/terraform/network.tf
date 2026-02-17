module "network" {
  source = "./modules/network"

  name_prefix        = local.name_prefix
  cluster_name       = "${local.name_prefix}-eks"
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
  production_mode    = var.environment == "production"
  tags               = local.common_tags
}
