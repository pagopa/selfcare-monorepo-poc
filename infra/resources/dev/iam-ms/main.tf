terraform {
  backend "azurerm" {
    resource_group_name  = "dx-d-itn-tfstate-rg-01"
    storage_account_name = "dxditntfstatest01"
    container_name       = "terraform-state"
    key                  = "selfcare-poc.resources.dev.iam-ms.tfstate"
  }
}

provider "azurerm" {
  features {}
}

locals {
  environment = {
    prefix          = "dx"
    location        = "italynorth"
    location_short  = "itn"
    env_short       = "d"
    domain          = "selc"
    app_name        = "poc"
    instance_number = "01"
  }

  tags = {
    CostCenter     = "TS000 - Tecnologia e Servizi"
    CreatedBy      = "Terraform"
    Owner          = "DevEx"
    Environment    = "Dev"
    Source         = "https://github.com/pagopa/selfcare-monorepo-poc/blob/main/infra/resources/dev/iam-ms"
    ManagementTeam = "Developer Experience"
    MicroService   = "iam"
  }
}

module "iam_app" {
  source = "../../_modules/dummy-resource"

  name        = "iam"
  environment = local.environment
  tags        = local.tags
}

output "resource_group_name" {
  value = module.iam_app.resource_group_name
}
# change
