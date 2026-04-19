# Super Simple Staging Deploy (Step-by-Step)

This is the "elementary school level" version. Do these in order.

## What this does

Our helper script will:

1. build the backend Docker image,
2. push image(s) to ECR,
3. run Terraform plan/apply.

So you do not have to run 20 commands by hand.

---

## Before you start (one-time setup on your laptop)

Install:

- AWS CLI
- Docker Desktop
- Terraform

Make sure AWS works:

```bash
aws sts get-caller-identity
```

If that command fails, log in to AWS first.

---

## Step 1) Go to the repo

```bash
cd /path/to/MangoOSDev
```

---

## Step 2) Make your Terraform config file

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
```

Now open `infra/terraform/terraform.tfvars` and fill in real values:

- image URLs (script can auto-update these),
- DB strategy (`create_aurora=true` or `false`),
- if reusing DB: all `existing_db_*` values.

---

## Step 3) Run a dry run

### macOS/Linux

```bash
cd /path/to/MangoOSDev
chmod +x scripts/release_staging.sh
./scripts/release_staging.sh plan
```

### Windows PowerShell

```powershell
cd C:\path\to\MangoOSDev
./scripts/release_staging.ps1 -Action plan
```

If this step succeeds, Terraform will create `tfplan`.

---

## Step 4) Actually deploy

### macOS/Linux

```bash
./scripts/release_staging.sh apply
```

### Windows PowerShell

```powershell
./scripts/release_staging.ps1 -Action apply
```

---

## Step 5) Verify backend health

```bash
cd infra/terraform
ALB_DNS=$(terraform output -raw alb_dns_name)
curl -i "http://$ALB_DNS/healthz"
```

Expected: HTTP 200 with `{"ok":true}`.

---

## Step 6) Apply DB schema (if not already applied)

Use existing scripts:

- PowerShell: `./scripts/apply_canonical_schema.ps1`
- Bash: `./scripts/apply_canonical_schema.sh`

---

## If something fails

1. Read the exact failing command in script output.
2. Fix credentials / missing values in `terraform.tfvars`.
3. Re-run `plan`, then `apply`.
