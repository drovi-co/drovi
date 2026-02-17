module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.19"

  name = "${var.name_prefix}-vpc"
  cidr = var.vpc_cidr

  azs             = var.availability_zones
  private_subnets = [for idx, _ in var.availability_zones : cidrsubnet(var.vpc_cidr, 4, idx)]
  public_subnets  = [for idx, _ in var.availability_zones : cidrsubnet(var.vpc_cidr, 4, idx + 8)]

  enable_dns_hostnames = true
  enable_dns_support   = true

  enable_nat_gateway     = true
  single_nat_gateway     = !var.production_mode
  one_nat_gateway_per_az = var.production_mode

  public_subnet_tags = {
    "kubernetes.io/role/elb"                     = 1
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb"            = 1
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }

  tags = var.tags
}
