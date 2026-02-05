terraform {
  backend "azurerm" {
    resource_group_name  = "dx-d-itn-tfstate-rg-01"
    storage_account_name = "dxditntfstatest01"
    container_name       = "terraform-state"
    key                  = "selfcare-poc.resources.dev.tfstate"
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
    Source         = "https://github.com/pagopa/selfcare-monorepo-poc/blob/main/infra/resources/dev"
    ManagementTeam = "Developer Experience"
    TestRun        = "infrastructure-deployment-test"
  }
}
