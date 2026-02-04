# Dummy module for PoC - creates NO real resources, no Azure auth needed

variable "name" {
  type        = string
  description = "Name of the dummy application"
}

variable "environment" {
  type = object({
    prefix          = string
    env_short       = string
    location        = string
    app_name        = string
    instance_number = string
  })
}

variable "tags" {
  type = map(string)
}

# Dummy resource - simulates infrastructure without creating anything real
resource "terraform_data" "app" {
  input = {
    name              = var.name
    resource_group    = "${var.environment.prefix}-${var.environment.env_short}-${var.name}-rg"
    location          = var.environment.location
    container_app     = "${var.environment.prefix}-${var.environment.env_short}-${var.name}-ca"
    environment_vars  = var.tags
  }

  lifecycle {
    precondition {
      condition     = var.name != ""
      error_message = "App name cannot be empty"
    }
  }
}

output "app_name" {
  value       = var.name
  description = "Application name"
}

output "resource_group_name" {
  value       = terraform_data.app.output.resource_group
  description = "Simulated resource group name"
}

output "container_app_name" {
  value       = terraform_data.app.output.container_app
  description = "Simulated container app name"
}
