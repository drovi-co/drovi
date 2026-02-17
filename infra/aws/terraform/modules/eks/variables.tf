variable "cluster_name" {
  description = "EKS cluster name."
  type        = string
}

variable "kubernetes_version" {
  description = "Kubernetes version for EKS control plane."
  type        = string
}

variable "eks_public_access_cidrs" {
  description = "CIDRs allowed to access EKS public endpoint."
  type        = list(string)
}

variable "vpc_id" {
  description = "VPC id for the EKS cluster."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets for EKS nodes."
  type        = list(string)
}

variable "eks_node_instance_types" {
  description = "EC2 instance types for node groups."
  type        = list(string)
}

variable "eks_node_min_size" {
  description = "Minimum desired node count."
  type        = number
}

variable "eks_node_desired_size" {
  description = "Desired node count."
  type        = number
}

variable "eks_node_max_size" {
  description = "Maximum node count."
  type        = number
}

variable "tags" {
  description = "Default tags applied to resources."
  type        = map(string)
  default     = {}
}
