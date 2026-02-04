# Onboarding Microservice - PoC

This is a dummy microservice for testing the PoC.

## Structure

- Modify this file to trigger selective deploy
- Terraform will detect the change and deploy only this MS

## Test

```bash
# Modify this file to test selective deploy
echo "test" >> README.md
git add README.md
git commit -m "test: onboarding change"
```
