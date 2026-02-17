module "eks" {
  source = "./modules/eks"

  cluster_name             = "${local.name_prefix}-eks"
  kubernetes_version       = var.kubernetes_version
  eks_public_access_cidrs  = var.eks_public_access_cidrs
  vpc_id                   = module.network.vpc_id
  private_subnet_ids       = module.network.private_subnet_ids
  eks_node_instance_types  = var.eks_node_instance_types
  eks_node_min_size        = var.eks_node_min_size
  eks_node_desired_size    = var.eks_node_desired_size
  eks_node_max_size        = var.eks_node_max_size
  tags                     = local.common_tags
}
