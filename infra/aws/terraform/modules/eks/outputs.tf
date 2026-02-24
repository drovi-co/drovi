output "cluster_name" {
  description = "EKS cluster name."
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "EKS control plane endpoint."
  value       = module.eks.cluster_endpoint
}

output "oidc_provider" {
  description = "OIDC issuer URL for IRSA."
  value       = module.eks.oidc_provider
}

output "oidc_provider_arn" {
  description = "OIDC provider ARN for IRSA trust policies."
  value       = module.eks.oidc_provider_arn
}

output "node_security_group_id" {
  description = "EKS managed node security group id."
  value       = module.eks.node_security_group_id
}

output "cluster_security_group_id" {
  description = "EKS cluster security group id."
  value       = module.eks.cluster_security_group_id
}
