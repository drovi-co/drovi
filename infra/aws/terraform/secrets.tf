resource "random_password" "db_master" {
  length  = 32
  special = true
}

resource "random_password" "redis_auth" {
  length  = 48
  special = false
}

resource "random_password" "msk_scram" {
  length  = 48
  special = false
}
