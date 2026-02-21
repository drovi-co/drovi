locals {
  eks_oidc_issuer = replace(module.eks.oidc_provider, "https://", "")
}

data "aws_iam_policy_document" "drovi_app_irsa_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.eks_oidc_issuer}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.eks_oidc_issuer}:sub"
      values   = ["system:serviceaccount:drovi:drovi-intelligence-sa"]
    }
  }
}

resource "aws_iam_role" "drovi_app_irsa" {
  name               = "${local.name_prefix}-drovi-app-role"
  assume_role_policy = data.aws_iam_policy_document.drovi_app_irsa_assume.json
  description        = "IRSA role for drovi-intelligence workloads."

  tags = local.common_tags
}

data "aws_iam_policy_document" "drovi_app_runtime" {
  statement {
    sid = "EvidenceBucketAccess"

    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetBucketLocation",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
      "s3:ListBucketVersions",
      "s3:PutObject",
    ]

    resources = [
      "arn:aws:s3:::${module.data.evidence_bucket_name}",
      "arn:aws:s3:::${module.data.evidence_bucket_name}/*",
    ]
  }

  statement {
    sid = "EvidenceKmsAccess"

    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:Encrypt",
      "kms:GenerateDataKey",
      "kms:GenerateDataKeyWithoutPlaintext",
    ]

    resources = [module.data.kms_key_arn]
  }
}

resource "aws_iam_policy" "drovi_app_runtime" {
  name        = "${local.name_prefix}-drovi-app-runtime"
  description = "Runtime AWS permissions for drovi-intelligence workloads."
  policy      = data.aws_iam_policy_document.drovi_app_runtime.json

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "drovi_app_runtime" {
  role       = aws_iam_role.drovi_app_irsa.name
  policy_arn = aws_iam_policy.drovi_app_runtime.arn
}

data "aws_iam_policy_document" "imperium_irsa_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.eks_oidc_issuer}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.eks_oidc_issuer}:sub"
      values   = ["system:serviceaccount:drovi:imperium-sa"]
    }
  }
}

resource "aws_iam_role" "imperium_irsa" {
  name               = "${local.name_prefix}-imperium-role"
  assume_role_policy = data.aws_iam_policy_document.imperium_irsa_assume.json
  description        = "IRSA role for imperium workloads."

  tags = local.common_tags
}
