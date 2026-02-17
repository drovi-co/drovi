variable "name_prefix" {
  description = "Prefix used for naming resources."
  type        = string
}

variable "cluster_name" {
  description = "EKS cluster name used in subnet discovery tags."
  type        = string
}

variable "vpc_cidr" {
  description = "Primary VPC CIDR block."
  type        = string
}

variable "availability_zones" {
  description = "Availability zones for public/private subnets."
  type        = list(string)
}

variable "production_mode" {
  description = "When true, create one NAT gateway per AZ."
  type        = bool
}

variable "tags" {
  description = "Default tags applied to resources."
  type        = map(string)
  default     = {}
}
