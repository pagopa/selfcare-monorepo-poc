# App Configuration Files

Each microservice has its own `app-config.json` file containing environment-specific configurations.

## 📁 Structure

```
apps/
├── onboarding-ms/
│   ├── app-config.json  ← Environment variables configuration
│   └── src/
├── product-ms/
│   ├── app-config.json
│   └── src/
└── iam-ms/
    ├── app-config.json
    └── src/
```

## 📝 File Format

Each branch contains configuration for its environment:

```json
{
  "DB_HOST": "postgres-dev.postgres.database.azure.com",
  "API_TIMEOUT_MS": "30000",
  "LOG_LEVEL": "DEBUG"
}
```

**Git Flow Mapping**:

- `main` branch → DEV environment → Uses `selfcare-dev-appconfig`
- `releases/**` branches → UAT environment → Uses `selfcare-uat-appconfig`
- `prod` branch → PROD environment → Uses `selfcare-prod-appconfig`

The workflow automatically determines the environment based on the branch.

## 🔄 How It Works

### 1. Modify Configuration

```bash
# Example: Update database host for onboarding-ms
# On main branch (DEV environment)
vim apps/onboarding-ms/app-config.json

# Change:
"DB_HOST": "postgres-dev-old.postgres.database.azure.com"
# To:
"DB_HOST": "postgres-dev-new.postgres.database.azure.com"
```

### 2. Commit and Push

```bash
git add apps/onboarding-ms/app-config.json
git commit -m "config(onboarding): update DEV database host"

# Push to main → deploys to DEV
git push origin main

# For UAT: cherry-pick to release branch
git checkout releases/1.0.0
git cherry-pick <commit-hash>
# Edit app-config.json with UAT-specific values
vim apps/onboarding-ms/app-config.json
# Change to UAT database host
git add apps/onboarding-ms/app-config.json
git commit --amend
git push origin releases/1.0.0
```

### 3. Automatic Workflow

The workflow detects changes and:

1. **Determines environment** from branch (main=DEV, releases/\*\*=UAT)
2. **Reads `app-config.json`** from the current branch
3. **Updates Azure App Configuration** with all values
4. **Deploys the application** which will read the new configuration

```
main branch: apps/onboarding-ms/app-config.json modified
    ↓
Workflow: _release-deploy-apps-dev.yaml
    ↓
Step 1: Update App Configuration
  - Reads app-config.json from main branch
  - For each key:
    → az appconfig kv set onboarding-ms:KEY=VALUE --label dev
    ↓
Step 2: Deploy App
  - Build image
  - Push to ACR
  - Deploy to Container App
  - App reads config from App Configuration (label: dev)
    ↓
✅ Deployment complete with updated configuration

---

releases/1.0.0 branch: apps/onboarding-ms/app-config.json modified
    ↓
Workflow: _release-deploy-apps-uat.yaml
    ↓
Step 1: Update App Configuration
  - Reads app-config.json from releases/1.0.0 branch
  - For each key:
    → az appconfig kv set onboarding-ms:KEY=VALUE --label uat
    ↓
Step 2: Deploy App (with approval)
  - Wait for approval in 'app-uat-cd' environment
  - Deploy to UAT Container App
  - App reads config from App Configuration (label: uat)
    ↓
✅ Deployment complete with updated configuration
```

## 🎯 Benefits

### Infrastructure vs Configuration Separation

**Before** (config in Terraform):

```hcl
# infra/resources/dev/apps.tf
resource "azurerm_container_app" "onboarding" {
  env {
    name = "DB_HOST"
    value = "postgres-dev.azure.com"  # ❌ Config hardcoded
  }
  env {
    name = "API_TIMEOUT_MS"
    value = "30000"  # ❌ Requires terraform apply
  }
}
```

**After** (config in app-config.json with Git Flow):

```json
// main branch: apps/onboarding-ms/app-config.json
{
  "DB_HOST": "postgres-dev.azure.com",
  "API_TIMEOUT_MS": "30000"
}

// releases/1.0.0 branch: apps/onboarding-ms/app-config.json
{
  "DB_HOST": "postgres-uat.azure.com",
  "API_TIMEOUT_MS": "30000"
}
```

**Key Advantage**: Each branch has its own configuration, following Git Flow naturally.

**Terraform creates ONLY**:

```hcl
resource "azurerm_container_app" "onboarding" {
  env {
    name = "AZURE_APPCONFIG_ENDPOINT"
    value = module.app_configuration.endpoint  # ✅ SINGLE env var
  }
}
```

### Workflow Comparison

| Aspect            | Config in Terraform             | Config in app-config.json (Git Flow) |
| ----------------- | ------------------------------- | ------------------------------------ |
| Location          | `infra/resources/dev/apps.tf`   | `apps/onboarding-ms/app-config.json` |
| Per environment   | Multiple .tf files              | One file per branch                  |
| Proximity to code | ❌ Far away                     | ✅ In app folder                     |
| Change process    | Edit .tf → PR → Terraform apply | Edit JSON → commit → Auto-sync       |
| Deploy time       | 5-10 minutes (Terraform)        | 10 seconds (config sync)             |
| Restart needed    | ✅ Yes (terraform apply)        | ❌ No (@RefreshScope)                |
| Main/Prod drift   | ⚠️ Possible (manual sync)       | ✅ Impossible (separate branches)    |
| Rollback          | Git revert → Terraform apply    | Git revert → Auto-sync               |

## 🔐 Secrets (Key Vault)

For **sensitive secrets** (passwords, API keys), **DO NOT use app-config.json**.

Instead, use Key Vault References in Azure App Configuration:

```bash
# 1. Add secret to Key Vault
az keyvault secret set \
  --vault-name selfcare-dev-kv \
  --name db-password \
  --value "super-secret-password"

# 2. Create reference in App Configuration
az appconfig kv set-keyvault \
  --name selfcare-dev-appconfig \
  --key "onboarding-ms:DB_PASSWORD" \
  --secret-identifier "https://selfcare-dev-kv.vault.azure.net/secrets/db-password"
```

**Result**:

- The secret lives in Key Vault (secure)
- App Configuration points to Key Vault (reference)
- The app reads from App Configuration which retrieves from Key Vault
- **Zero secrets in Git or Azure App Configuration**

## 📊 Naming Convention

### Keys in app-config.json

```
{KEY_NAME}: "{value}"

Examples:
DB_HOST: "postgres-dev.azure.com"
DB_PORT: "5432"
API_TIMEOUT_MS: "30000"
LOG_LEVEL: "DEBUG"
```

**Note**: Each branch contains values for its environment (main=DEV, releases/\*\*=UAT, prod=PROD)

### Keys in Azure App Configuration

Keys are saved with app prefix:

```
{app-name}:{KEY_NAME}

Examples:
onboarding-ms:DB_HOST
onboarding-ms:API_TIMEOUT_MS
product-ms:CACHE_TTL_SECONDS
```

With labels per environment:

```
Key: onboarding-ms:DB_HOST
Label: dev   → Value: postgres-dev.azure.com
Label: uat   → Value: postgres-uat.azure.com
Label: prod  → Value: postgres-prod.azure.com
```

## 🧪 Testing

### Local Testing

```bash
# 1. Switch to the branch you want to test
git checkout main  # For DEV config

# 2. Edit config
vim apps/onboarding-ms/app-config.json

# 3. Validate JSON
cat apps/onboarding-ms/app-config.json | jq .

# 4. Test parsing (as workflow does)
cat apps/onboarding-ms/app-config.json | jq -r 'to_entries[] | "\(.key)=\(.value)"'

# Output:
# DB_HOST=postgres-dev.postgres.database.azure.com
# DB_PORT=5432
# API_TIMEOUT_MS=30000
# ...
```

### PoC Testing

```bash
# Test DEV deployment
git checkout main
echo '{"TEST":"dev-value","LOG_LEVEL":"DEBUG"}' > apps/onboarding-ms/app-config.json
git add apps/onboarding-ms/app-config.json
git commit -m "test: config update for DEV"
git push origin main

# Test UAT deployment
git checkout releases/1.0.0
echo '{"TEST":"uat-value","LOG_LEVEL":"INFO"}' > apps/onboarding-ms/app-config.json
git add apps/onboarding-ms/app-config.json
git commit -m "test: config update for UAT"
git push origin releases/1.0.0

# Check workflows on GitHub Actions
# DEV: _release-deploy-apps-dev (should show TEST=dev-value)
# UAT: _release-deploy-apps-uat (should show TEST=uat-value)
```

## 🔍 Troubleshooting

### Config Not Updated

**Problem**: I modified app-config.json but the app still uses old values.

**Causes**:

1. App Configuration cache (default TTL: 30 seconds)
2. Workflow didn't run (path not detected)
3. App doesn't implement runtime refresh

**Solutions**:

```bash
# Check workflow
gh run list --workflow="_release-deploy-apps-dev.yaml"

# Force app refresh (if needed)
az containerapp revision restart \
  --name onboarding-ms-dev \
  --resource-group selfcare-dev-rg

# Check in App Configuration
az appconfig kv show \
  --name selfcare-dev-appconfig \
  --key "onboarding-ms:DB_HOST" \
  --label "dev"
```

### Invalid JSON

**Problem**: Workflow fails with parsing error.

**Solution**:

```bash
# Validate JSON locally
cat apps/onboarding-ms/app-config.json | jq .

# If error, fix syntax:
# - Missing commas
# - Unclosed quotes
# - Trailing commas
```

### Missing Environment Variable

**Problem**: App fails due to missing variable.

**Check**:

1. Is the variable present in `app-config.json`?
2. Did the workflow execute the "Update App Configuration" step?
3. Is the app reading from Azure App Configuration?

---

**TL;DR**: Config close to code, automatic deployment, zero Terraform apply, zero main/prod drift! 🚀
