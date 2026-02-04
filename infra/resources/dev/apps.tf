module "onboarding_app" {
  source = "../_modules/dummy-resource"

  name        = "onboarding"
  environment = local.environment
  tags        = merge(local.tags, { MicroService = "onboarding" })
}

module "product_app" {
  source = "../_modules/dummy-resource"

  name        = "product"
  environment = local.environment
  tags        = merge(local.tags, { MicroService = "product" })
}

module "iam_app" {
  source = "../_modules/dummy-resource"

  name        = "iam"
  environment = local.environment
  tags        = merge(local.tags, { MicroService = "iam" })
}

output "onboarding_rg" {
  value = module.onboarding_app.resource_group_name
}

output "product_rg" {
  value = module.product_app.resource_group_name
}

output "iam_rg" {
  value = module.iam_app.resource_group_name
}
