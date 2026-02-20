module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.31"

  cluster_name    = var.cluster_name
  cluster_version = var.kubernetes_version

  cluster_endpoint_public_access       = true
  cluster_endpoint_public_access_cidrs = var.eks_public_access_cidrs

  enable_cluster_creator_admin_permissions = true
  enable_irsa                              = true

  vpc_id     = var.vpc_id
  subnet_ids = var.private_subnet_ids

  cluster_addons = {
    coredns = {
      most_recent = true
    }
    kube-proxy = {
      most_recent = true
    }
    vpc-cni = {
      most_recent = true
    }
    aws-ebs-csi-driver = {
      most_recent = true
    }
  }

  # Allow pod traffic on all ports between nodes (for example, frontend pods on :80).
  node_security_group_additional_rules = {
    ingress_all_from_self = {
      description = "Node-to-node all traffic for pod networking"
      protocol    = "-1"
      from_port   = 0
      to_port     = 0
      type        = "ingress"
      self        = true
    }
  }

  eks_managed_node_group_defaults = {
    ami_type       = "AL2023_x86_64_STANDARD"
    instance_types = var.eks_node_instance_types
    capacity_type  = "ON_DEMAND"
  }

  eks_managed_node_groups = {
    default = {
      name         = "default"
      min_size     = var.eks_node_min_size
      max_size     = var.eks_node_max_size
      desired_size = var.eks_node_desired_size

      labels = {
        workload = "general"
      }
    }
  }

  tags = var.tags
}
