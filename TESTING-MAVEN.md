# Testing Maven (pom.xml) Versioning with Nx Release

This guide explains how Nx Release updates both `package.json` and `pom.xml` files synchronously.

## 🎯 How It Works

Unlike the `@nx/maven` plugin (which requires complex configuration), we use a **custom sync script** that:

1. **Nx Release** updates `package.json` and `CHANGELOG.md` (standard behavior)
2. **Custom script** reads each `package.json` and syncs the version to `pom.xml`
3. **Both files** end up with the same version number

**Scripts:**
- `scripts/sync-pom-version.js` - Syncs a single project
- `scripts/sync-all-poms.js` - Syncs all apps with pom.xml
- `scripts/preview-release.js` - Shows preview including pom.xml changes

**Workflow:**
- **Locally**: Run `npm run release` (not `npx nx release`)
- **GitHub**: Workflow automatically runs sync after nx release

---

## 📋 Setup

We've added `pom.xml` files to all microservices:
- `apps/onboarding-ms/pom.xml` (version: 1.0.0)
- `apps/product-ms/pom.xml` (version: 1.0.0)
- `apps/iam-ms/pom.xml` (version: 1.0.0)

Custom scripts synchronize versions between `package.json` and `pom.xml` automatically.

---

## 🧪 Test Scenario: Version Bump for Maven Project

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Verify All Projects

```bash
# Check all projects in workspace
npx nx show projects

# You should see:
# - onboarding-ms
# - product-ms
# - iam-ms
# - infra/resources/dev/* projects
# - etc.
```

### Step 3: Create a Version Plan

```bash
npx nx release plan

# Interactive prompts:
# ✔ Which projects would you like to include?
#   → Select: onboarding-ms
#
# ✔ How do you want to bump the version(s)?
#   → Select: minor
#
# ✔ What's the message for this change?
#   → Type: "Add new authentication endpoint"
```

This creates a file in `.nx/version-plans/` (e.g., `new-feature-20260216.md`):

```markdown
---
onboarding-ms: minor
---

Add new authentication endpoint
```

### Step 4: Preview Changes (including pom.xml)

```bash
npm run release:preview
```

**Expected Output:**
```
🔍 Preview Release Changes

============================================================

📦 Running Nx Release preview...

onboarding-ms
  Current: 1.0.0
  New:     1.1.0

Would update:
  ✓ apps/onboarding-ms/package.json
  ✓ apps/onboarding-ms/CHANGELOG.md

============================================================

📝 Additional changes for Maven projects:

  onboarding-ms/pom.xml
    Current: 1.0.0
    Will sync to: 1.1.0

============================================================

💡 Tip: Run `npm run release` to apply these changes
```

### Step 5: Apply the Version Plan

```bash
npm run release
# This runs: nx release --skip-publish && sync all pom.xml files
```

**Output:**
```
📦 Applying version plans...
  ✓ Updated apps/onboarding-ms/package.json: 1.0.0 → 1.1.0
  ✓ Updated apps/onboarding-ms/CHANGELOG.md
  ✓ Deleted .nx/version-plans/new-feature-20260216.md

🔄 Synchronizing all pom.xml files...

📦 Syncing pom.xml version for @selfcare/onboarding-ms...
  ✓ Updated pom.xml: 1.0.0 → 1.1.0

✅ Synchronized 1 project(s)
```

### Step 6: Verify Both Files Were Updated

```bash
# Check package.json was updated
cat apps/onboarding-ms/package.json | grep version
# Should show: "version": "1.1.0"

# Check pom.xml was updated
cat apps/onboarding-ms/pom.xml | grep "<version>"
# Should show: <version>1.1.0</version>
```

---

## 📝 How The Sync Mechanism Works

When you run `npm run release`:

1. **Nx Release** (first):
   - Reads version plans from `.nx/version-plans/*.md`
   - Updates `package.json` files with new versions
   - Generates/updates `CHANGELOG.md` files
   - Deletes consumed version plan files
   - Creates git commit

2. **Sync Script** (second):
   - Scans all `apps/*/package.json` files
   - For each project with both `package.json` and `pom.xml`:
     - Reads version from `package.json`
     - Updates `<version>` tag in `pom.xml` to match
   - Preserves all other pom.xml content unchanged
   - Keeps all other XML intact
   - Maintains formatting

4. **Synchronized Versions**:
   - `package.json` and `pom.xml` always have the same version
   - CHANGELOG generated once per project

---

## 🔍 Manual Verification Steps

After running the version bump, verify all files:

```bash
# 1. Check package.json
cat apps/onboarding-ms/package.json | grep -A 2 "version"

# 2. Check pom.xml
cat apps/onboarding-ms/pom.xml | grep -A 1 "<version>"

# 3. Check CHANGELOG was created/updated
cat apps/onboarding-ms/CHANGELOG.md

# 4. Verify version plan was deleted
ls .nx/version-plans/
# Should be empty (or not contain the processed plan)
```

---

## 🚀 Full End-to-End Test

Complete flow from version plan to deployment:

```bash
# 1. Create version plan for onboarding-ms
npx nx release plan
# Select: onboarding-ms
# Bump: minor
# Message: "Add health check endpoint"

# 2. Commit and push version plan
git add .nx/version-plans/
git commit -m "chore: add version plan for onboarding-ms"
git push origin main

# 3. Wait for version-packages.yml workflow
# → GitHub Action creates PR "Version Packages"
# → PR shows changes to package.json, pom.xml, CHANGELOG.md

# 4. Review PR and verify:
# - package.json: 1.0.0 → 1.1.0
# - pom.xml: 1.0.0 → 1.1.0
# - CHANGELOG.md: contains "Add health check endpoint"

# 5. Merge PR
# → release.yml creates git tag: onboarding-ms-v1.1.0
# → Deploys to PROD (stable version)
```

---

## 🎯 Testing Multiple Projects with pom.xml

Test that multiple Maven projects can be versioned together:

```bash
npx nx release plan

# Select BOTH:
# - onboarding-ms
# - product-ms
#
# Bump: patch
# Message: "Update shared dependency version"

# Verify both pom.xml files will be updated:
npx nx release --dry-run

# Expected:
# onboarding-ms: 1.1.0 → 1.1.1
# product-ms: 1.0.0 → 1.0.1
# Both package.json AND pom.xml updated
```

---

## 🐛 Troubleshooting

### Issue: pom.xml not detected

**Solution**: Ensure `@nx/maven` is installed:
```bash
npm list @nx/maven
# Should show: @nx/maven@19.0.0
```

### Issue: pom.xml not updated

**Solution**: Check that `<version>` tag exists in the pom.xml:
```xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>it.pagopa.selfcare</groupId>
  <artifactId>onboarding-ms</artifactId>
  <version>1.0.0</version>  ← Must be present
</project>
```

### Issue: Version mismatch between files

**Solution**: Ensure both files start with the same version:
```bash
# Sync versions manually if needed
echo '{"name": "onboarding-ms", "version": "1.0.0"}' > apps/onboarding-ms/package.json
# Edit pom.xml to match: <version>1.0.0</version>
```

---

## ✅ Success Criteria

A successful test should show:

1. ✅ `npx nx show projects` lists all Maven projects
2. ✅ `npx nx release plan` allows selecting Maven projects
3. ✅ `npx nx release --dry-run` shows BOTH package.json and pom.xml will be updated
4. ✅ After `npx nx release`, both files have the same new version
5. ✅ CHANGELOG.md is created/updated with the change message
6. ✅ Version plan file is deleted
7. ✅ Git commit is created with all changes

---

## 📚 References

- [Nx Maven Plugin Documentation](https://nx.dev/nx-api/maven)
- [Nx Release Documentation](https://nx.dev/features/manage-releases)
- [Version Plans Guide](https://nx.dev/features/manage-releases#version-plans)
