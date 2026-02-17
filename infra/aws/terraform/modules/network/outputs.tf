output "vpc_id" {
  description = "VPC id."
  value       = module.vpc.vpc_id
}

output "vpc_cidr_block" {
  description = "VPC CIDR block."
  value       = module.vpc.vpc_cidr_block
}

output "private_subnet_ids" {
  description = "Private subnet ids."
  value       = module.vpc.private_subnets
}

output "public_subnet_ids" {
  description = "Public subnet ids."
  value       = module.vpc.public_subnets
}
