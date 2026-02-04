# SelfCare Monorepo PoC - Mock Workflows

**This is a Proof of Concept with MOCK workflows** for demonstrating selective application deployment.

## ⚠️ Critical: All Workflows are Mocked

**NO workflows in this repository will actually deploy anything.** They are demonstration versions that:

- ✅ Trigger at correct times
- ✅ Detect changed files
- ✅ Show what WOULD happen
- ❌ Do NOT call real DX workflows
- ❌ Do NOT require Azure authentication

The REAL production workflows are commented inside each workflow file.

## 🎯 What This PoC Demonstrates

1. **Infrastructure vs Application Separation**
   - Infrastructure (Terraform): Deploys ALL resources together
   - Applications: Selective deployment of only changed services

2. **Path-Based Change Detection**
   - Automatically detects which apps changed
   - Only triggers deployment for those specific apps

3. **DX-Compliant Structure**
   - Folder layout: `infra/resources/{env}/`
   - Ready for DX reusable workflows

## 🧪 Testing the Mock Workflows

### Test 1: Single App Change (DEV)

```bash
echo "test" >> apps/onboarding-ms/README.md
git add apps/onboarding-ms/
git commit -m "test: onboarding"
git push origin main
```

**Result**: `_release-deploy-apps-dev.yaml` shows onboarding would deploy, others skipped.

### Test 2: Multiple Apps (UAT)

```bash
git checkout -b releases/1.0.0
echo "update" >> apps/onboarding-ms/README.md
echo "update" >> apps/product-ms/README.md
git add apps/
git commit -m "feat: multi-app update"
git push origin releases/1.0.0
```

**Result**: `_release-deploy-apps-uat.yaml` shows onboarding + product would deploy, iam skipped.

### Test 3: Infrastructure Change

```bash
vi infra/resources/dev/apps.tf  # Make any change
git add infra/
git commit -m "infra: change"
git push origin main
```

**Result**: Terraform workflows show ALL infrastructure would deploy (no selective `-target`).

## 📋 Mock Workflow List

| Workflow                                 | Trigger                                 | What It Shows           |
| ---------------------------------------- | --------------------------------------- | ----------------------- |
| `_validate-terraform-plan-dev-resources` | PR with `infra/resources/dev/**`        | Terraform plan for DEV  |
| `_release-terraform-apply-dev-resources` | Push main with `infra/resources/dev/**` | Terraform apply for DEV |
| `_validate-terraform-plan-uat-resources` | PR with `infra/resources/uat/**`        | Terraform plan for UAT  |
| `_release-terraform-apply-uat-resources` | Push main with `infra/resources/uat/**` | Terraform apply for UAT |
| `_release-deploy-apps-dev`               | Push main with `apps/**`                | App deployment to DEV   |
| `_release-deploy-apps-uat`               | Push releases/\* with `apps/**`         | App deployment to UAT   |

## 🔧 Converting to Production

To use real workflows:

1. **Uncomment production sections** in each workflow file
2. **Setup GitHub Environments**: `infra-dev`, `infra-uat`, `app-dev-cd`, `app-uat-cd`
3. **Configure Azure Auth**: Federated Identity + secrets
4. **Replace dummy resources**: Change `terraform_data` to real Azure resources
5. **Test thoroughly**: Start with DEV, validate, then UAT

## 📚 See Also

- Original README: [README.md](README.md) - Devcontainer and project setup
- DX Workflows: https://github.com/pagopa/dx
- Path Filter Action: https://github.com/dorny/paths-filter

---

**Status**: Mock PoC - Workflows will NOT deploy real resources
