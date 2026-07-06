# MangoRTS Prod Launch Progress Log

This log tracks each step, result, and next action for the first MangoRTS production launch.

## Rules

- Keep prod and dev separate.
- Use `mangorts-prod` for prod AWS work.
- Do not use `mangorts-dev` for prod.
- Do not paste secrets in chat.
- Do not run `terraform apply` or mutate prod cloud resources without explicit Jonat approval.

## Step 1 — Repo-only prod scaffolding

Status: complete.

Completed on: 2026-07-05T00:55:00Z.

Branch:

```text
prod-scaffolding-v1
```

Changes made:

- Added `infra/aws-prod/` from a conservative copy of `infra/aws-dev`.
- Adjusted prod defaults.
- Set production domain to `mangorts.com`.
- Set production API default to `api.mangorts.com`.
- Set production origin default to `origin.mangorts.com`.
- Added `.github/workflows/deploy-prod.yml`.
- Added `docs/important tasks/prod deploy runbook.md`.
- Updated `.gitignore` for prod Terraform local files.
- Updated `docs/important tasks/version 1 prod server launch brief.md`.

Verification performed:

- `terraform fmt -recursive infra/aws-prod`
- `terraform init -backend=false`
- `terraform validate`
- `go test ./...` from `backend/`
- `node scripts/run_all_tests.mjs`
- Ad-hoc checks for `mangorts.com`, no hyphenated production domain, absence of the dev UUID in prod tfvars, and Terraform validation.

Result:

- Repo-only scaffolding is ready for review.
- Jonat reviewed it and said it looks correct.
- No prod cloud resources were created or changed.

## Step 2 — Prod AWS profile check

Status: blocked on manual AWS SSO setup.

Checked on: 2026-07-05T00:55:00Z.

Command run:

```bash
aws sts get-caller-identity --profile mangorts-prod
```

Result:

```text
aws: [ERROR]: The config profile (mangorts-prod) could not be found
```

Meaning:

- The local `mangorts-prod` AWS CLI profile does not exist yet.
- This is expected if Jonat has not set up prod AWS SSO on this laptop yet.
- No prod AWS action was taken.

Next action:

- Jonat needs to create or confirm the separate prod AWS account.
- Then configure local AWS SSO profile `mangorts-prod`.
- After that, rerun `aws sts get-caller-identity --profile mangorts-prod`.

## Step 2A — AWS account choice guidance

Status: guidance given.

Updated on: 2026-07-05T01:01:12Z.

Guidance:

- Do not use the AWS root user for routine work.
- Do not use the organization management/root account for the MangoRTS app runtime.
- Use or create a separate member account dedicated to MangoRTS production.
- Local CLI access should use IAM Identity Center / AWS SSO.
- Local profile name should be `mangorts-prod`.
- The selected account should not be the dev account.

Next action:

- Jonat should identify which existing AWS account is the prod member account, or create a new member account for MangoRTS prod.
- Then configure AWS SSO access to that account.

## Step 2B — Local AWS profile inventory

Status: checked.

Updated on: 2026-07-05T01:10:09Z.

Command run:

```bash
aws configure list-profiles
```

Result:

```text
mangorts-dev
```

Local AWS config status:

- AWS config file exists.
- AWS credentials file is missing.
- This is good for SSO-style access because no long-lived local access keys were found.
- `mangorts-prod` is not configured yet.

Guidance:

- Jonat likely does not need an old-style IAM user.
- Preferred setup is an IAM Identity Center / AWS SSO user assigned to the prod AWS member account.
- The resulting local AWS CLI profile should be `mangorts-prod`.

Next action:

- In AWS IAM Identity Center, assign Jonat access to the MangoRTS production member account.
- Use a high-permission permission set for first setup, likely `AdministratorAccess`.
- Then configure the local CLI profile as `mangorts-prod`.

## Step 2C — AWS account creation guidance

Status: guidance given.

Updated on: 2026-07-05T01:12:06Z.

Context:

- Jonat is signed into AWS with the root account.
- Jonat asked which Amazon/AWS account to create and how.

Guidance:

- Do not use the root user for normal MangoRTS production work.
- Use the current root/management login only to create or manage the AWS Organization setup.
- Create or identify a separate AWS Organization member account named `MangoRTS Production`.
- Do not create a classic IAM user with access keys.
- Use IAM Identity Center / AWS SSO for Jonat's access to the prod member account.

Recommended AWS account:

```text
Name: MangoRTS Production
Purpose: production app resources only
Local AWS CLI profile: mangorts-prod
```

High-level console path:

1. In the AWS management/root account, open AWS Organizations.
2. Create a new member AWS account named `MangoRTS Production`, unless a clearly dedicated prod member account already exists.
3. Open IAM Identity Center.
4. Add or confirm Jonat's SSO user.
5. Assign Jonat's SSO user to the `MangoRTS Production` account.
6. Use an `AdministratorAccess`-style permission set for the first setup.
7. Configure local AWS CLI SSO profile as `mangorts-prod`.

Next action:

- Jonat should create or identify the `MangoRTS Production` member account.
- Jonat should not paste root passwords, MFA codes, or secret access keys into chat.

## Step 2D — AWS Organizations screen guidance

Status: guidance given.

Updated on: 2026-07-05T01:14:51Z.

Context:

- Jonat is on the AWS Organizations > AWS accounts page.
- Visible account: `ScoobyXD`, marked as the management account.
- No separate production member account is visible yet.

Guidance:

- Click `Add an AWS account`.
- Choose `Create an AWS account`.
- Name it `MangoRTS Production`.
- Use a unique email address controlled by Jonat.
- Do not use the management/root account for MangoRTS production resources.

Next action:

- Jonat should click `Add an AWS account` and create the `MangoRTS Production` member account.

## Step 2E — Prod AWS account creation request

Status: submitted by Jonat.

Updated on: 2026-07-05T01:20:28Z.

Submitted account details:

```text
AWS account name: MangoRTS Production
IAM role name: ScoobyProd
```

Notes:

- The `ScoobyProd` role is the cross-account role AWS Organizations creates in the new member account.
- This is not the same thing as the local AWS CLI profile.
- The local AWS CLI profile should still be `mangorts-prod`.
- This is not a classic IAM user with long-lived access keys.

Next action:

- Wait for AWS Organizations to finish creating the account.
- Confirm that `MangoRTS Production` appears in the AWS accounts list.
- Record the new account ID as the prod AWS account ID.
- Then move to IAM Identity Center assignment for Jonat's SSO access.

## Step 2F — Possible duplicate account ID concern

Status: needs visual/user confirmation.

Updated on: 2026-07-05T01:39:02Z.

Context:

- Jonat reported that the newly created `MangoRTS Production` account ID appears to be the same as the root/management account ID.

Guidance:

- A real new AWS Organization member account should have a different 12-digit account ID from the management account.
- If both rows show the same account ID, the new account may not have been created yet, the page may not have refreshed, or Jonat may be looking at the management account row.
- Do not proceed to prod setup until the production member account is confirmed as separate from the management/dev account.

Next action:

- Jonat should refresh the AWS Organizations accounts page.
- Confirm there are two rows: `ScoobyXD` management account and `MangoRTS Production` member account.
- Confirm their 12-digit account IDs are different.
- If uncertain, send another screenshot with the account list visible.

## Step 2G — IAM vs IAM Identity Center guidance

Status: guidance given.

Updated on: 2026-07-05T01:48:22Z.

Context:

- Jonat confirmed the account creation issue was caused by using a similar email and then using a new email.
- Jonat reported that the new account now appears under the AWS Organizations root folder.
- Jonat opened the IAM Dashboard and asked whether the newly created user should appear there.

Guidance:

- The IAM Dashboard is not the right place for this step.
- The new AWS member account will not appear as an IAM user.
- Do not create a classic IAM user for Jonat.
- Use IAM Identity Center, not IAM Users.

Next action:

- In the AWS console search box, search for `IAM Identity Center`.
- Open IAM Identity Center.
- Go to `Users` to confirm Jonat's SSO user exists, or create it there.
- Then go to `AWS accounts` in IAM Identity Center and assign Jonat to `MangoRTS Production` with an AdministratorAccess-style permission set.

## Step 2H — IAM Identity Center user check

Status: guidance given.

Updated on: 2026-07-05T01:50:59Z.

Context:

- Jonat opened IAM Identity Center > Users.
- Only one existing user is visible, described by Jonat as the root user.

Guidance:

- AWS root user and IAM Identity Center users are separate concepts.
- If only one user exists and it represents Jonat, it can be used for SSO assignment.
- If it is unclear or named like the root email, it is okay to create a clearer Identity Center user for Jonat.
- Do not create IAM access keys.

Recommended user identity:

```text
Username: jonat
Display name: Jonat
Email: Jonat's normal login email
```

Next action:

- In IAM Identity Center > Users, either select the existing Jonat user or create a new user named `jonat`.
- Then assign that user to the `MangoRTS Production` AWS account with an AdministratorAccess-style permission set.

## Step 2I — IAM Identity Center account assignment confirmation

Status: visually confirmed as likely correct.

Updated on: 2026-07-05T02:36:45Z.

Context:

- Jonat showed the IAM Identity Center assignment screen.
- The screenshot shows `MangoRTS Production` with `AdministratorAccess` listed.

Result:

- This is the desired assignment shape for first setup.
- If the screen still has a final `Submit` or `Assign` button, Jonat should click it.
- If the assignment is already submitted, the next step is local AWS CLI SSO profile setup.

Local check:

```bash
aws configure list-profiles
```

Result:

```text
mangorts-dev
```

Meaning:

- `mangorts-prod` is not configured locally yet.

Next action:

- Configure local AWS CLI SSO profile `mangorts-prod` for the `MangoRTS Production` account.
- Then verify it with `aws sts get-caller-identity --profile mangorts-prod`.

## Step 2J — AWS access portal URL found

Status: ready for local AWS CLI SSO profile setup.

Updated on: 2026-07-05T06:08:15Z.

Context:

- Jonat found the AWS access portal URLs in IAM Identity Center settings.
- Region is `us-west-1`.
- AWS CLI v2 is installed.
- Current local profiles still only show `mangorts-dev`.

Privacy note:

- The portal URL is not a password, but it is account-specific.
- The full URL is not copied into this repo progress log.
- It can be stored in the local AWS CLI config when creating `mangorts-prod`.

Next action:

- Use the IPv4-only AWS access portal URL as the AWS CLI SSO start URL.
- Use SSO region `us-west-1`.
- Use account `MangoRTS Production`.
- Use role/permission set `AdministratorAccess`.
- Create local profile `mangorts-prod`.
- Verify with `aws sts get-caller-identity --profile mangorts-prod`.

## Step 2K — Local prod AWS CLI profile configured

Status: profile configured; SSO browser login in progress.

Updated on: 2026-07-05T06:13:50Z.

Important values:

```text
Prod AWS account ID: 828435022930
Local AWS CLI profile: mangorts-prod
SSO region: us-west-1
AWS region: us-west-1
Permission set / role: AdministratorAccess
```

Commands run:

```bash
aws configure set region us-west-1 --profile mangorts-prod
aws configure set output json --profile mangorts-prod
aws configure set sso_session SSO1 --profile mangorts-prod
aws configure set sso_account_id 828435022930 --profile mangorts-prod
aws configure set sso_role_name AdministratorAccess --profile mangorts-prod
aws configure list-profiles
aws sts get-caller-identity --profile mangorts-prod
aws sso login --profile mangorts-prod
```

Results:

- `mangorts-prod` now appears in the local AWS profile list.
- Profile values are set for account `828435022930` and role `AdministratorAccess`.
- First identity check failed because the SSO token was expired.
- `aws sso login --profile mangorts-prod` was started and is waiting for browser authorization.

Next action:

- Jonat should complete the browser SSO authorization.
- Then rerun `aws sts get-caller-identity --profile mangorts-prod` to confirm the profile returns account `828435022930`.

## Step 2L — Prod AWS SSO profile verified

Status: complete.

Updated on: 2026-07-05T06:17:22Z.

Command run:

```bash
aws sts get-caller-identity --profile mangorts-prod
```

Result:

```text
Account: 828435022930
Assumed role: AWSReservedSSO_AdministratorAccess
```

Meaning:

- Local AWS CLI profile `mangorts-prod` works.
- It points to the MangoRTS production AWS account.
- It uses SSO with `AdministratorAccess`.
- No prod cloud resources were created or changed by this verification.

Next action:

- Create the prod Terraform state backend S3 bucket in account `828435022930` after explicit Jonat approval.
- Recommended bucket name: `mangorts-prod-terraform-state-828435022930`.

## Step 3 — Prod Terraform state bucket created

Status: complete.

Updated on: 2026-07-05T06:19:30Z.

Approval:

- Jonat explicitly approved creating `mangorts-prod-terraform-state-828435022930`.

Created resource:

```text
S3 bucket: mangorts-prod-terraform-state-828435022930
AWS account: 828435022930
Region: us-west-1
Purpose: Terraform remote state for MangoRTS prod
```

Controls enabled:

- Block all public access.
- Bucket-owner-enforced object ownership.
- Versioning enabled.
- Default server-side encryption enabled with AES256.
- Tags set: `Project=MangoRTS`, `Environment=prod`, `Purpose=terraform-state`, `ManagedBy=Hermes`.

Local file created:

```text
infra/aws-prod/backend.hcl
```

This file is gitignored and should not be committed.

Repo example updated:

```text
infra/aws-prod/backend.hcl.example
```

Next action:

- Run Terraform init against the new S3 backend using `mangorts-prod`.
- Verify Terraform can read the backend before planning any prod resources.

## Step 3B — Prod Terraform S3 backend initialized

Status: complete.

Updated on: 2026-07-05T06:19:30Z.

Commands run:

```bash
export AWS_PROFILE=mangorts-prod
terraform -chdir=infra/aws-prod init -reconfigure -backend-config=backend.hcl -input=false
terraform -chdir=infra/aws-prod validate
```

Results:

- Terraform successfully configured the `s3` backend.
- Terraform initialized successfully.
- Terraform validation passed.
- No `terraform plan` or `terraform apply` was run.

Next action:

- Decide the prod network/database inputs for `infra/aws-prod/terraform.tfvars` before any prod plan/apply.

## Step 4 — Prod prerequisite discovery

Status: read-only discovery complete; setup inputs still missing.

Updated on: 2026-07-05T06:40:52Z.

Commands run:

```bash
aws sts get-caller-identity --profile mangorts-prod
aws ec2 describe-vpcs --profile mangorts-prod --region us-west-1
aws ec2 describe-subnets --profile mangorts-prod --region us-west-1
aws route53 list-hosted-zones-by-name --profile mangorts-prod --dns-name mangorts.com
aws rds describe-db-clusters --profile mangorts-prod --region us-west-1
aws rds describe-db-instances --profile mangorts-prod --region us-west-1
aws secretsmanager list-secrets --profile mangorts-prod --region us-west-1 --filters Key=name,Values=mangorts/prod
git remote get-url origin
```

Results:

- Confirmed prod AWS account: `828435022930`.
- Found default VPC: `vpc-058fed523b6e847bf`, CIDR `172.31.0.0/16`.
- Found two default public subnets:
  - `subnet-09be435bd9a9f6208` in `us-west-1c`, CIDR `172.31.0.0/20`.
  - `subnet-0f07a73d47130fc8a` in `us-west-1a`, CIDR `172.31.16.0/20`.
- No `mangorts.com` Route 53 hosted zone was found in the prod account.
- No RDS clusters were found in the prod account.
- No RDS instances were found in the prod account.
- No Secrets Manager secrets matching `mangorts/prod` were found.
- GitHub remote is `https://github.com/ScoobyXD/MangoRTSDev.git`.

Meaning:

- We can likely use the default VPC and the two default public subnets for first prod.
- Because there are no private app subnets, Terraform should create private ECS subnets if this path is approved.
- Since the VPC CIDR is `172.31.0.0/16`, valid private ECS CIDR candidates are `172.31.128.0/20` and `172.31.144.0/20`.
- The current example CIDRs `10.0.128.0/20` and `10.0.144.0/20` are only examples and should not be used with this VPC.
- Terraform cannot plan/apply the current prod stack yet because the Route 53 hosted zone, prod DB, DB password secret, and DB security group are missing.

No prod mutations in this step:

- This step only read AWS state and repo configuration.
- No Route 53, RDS, Secrets Manager, ECS, ECR, Cognito, or Terraform apply action was run.

Next action:

- Choose whether Jonat wants Hermes to create the Route 53 hosted zone and prod database resources with explicit approval, or whether Jonat wants to create those manually.
- After those prerequisites exist, create local `infra/aws-prod/terraform.tfvars` with the real non-secret IDs and secret ARNs.

## Step 4A — Remaining prerequisites and sensitive-info rules

Status: guidance documented.

Updated on: 2026-07-05T06:46:00Z.

Remaining prerequisites before first prod Terraform plan/apply:

1. Create or confirm a public Route 53 hosted zone for `mangorts.com` in prod.
2. Delegate `mangorts.com` DNS to that hosted zone at the domain registrar, if needed.
3. Create a separate prod PostgreSQL/Aurora DB in prod.
4. Store the prod DB password in AWS Secrets Manager.
5. Provide the DB endpoint, port, DB name, app username, DB password secret ARN, and DB security group ID.
6. Decide the first prod company UUID and first prod admin email.
7. Provide or generate the raw origin verification secret without putting it in chat or committed files.
8. Create local `infra/aws-prod/terraform.tfvars` with non-secret IDs and secret ARNs.

Information that is okay to record in docs/chat:

- AWS account IDs.
- VPC IDs, subnet IDs, security group IDs.
- Route 53 hosted zone IDs and nameservers.
- DB endpoint host, DB port, DB name, and DB app username.
- AWS Secrets Manager secret ARNs, but not secret values.
- GitHub owner/repo names.
- Terraform state bucket names.
- Production company UUID, if Jonat is comfortable treating it as config.

Information that must stay out of chat, docs, and committed repo files:

- AWS root password, MFA codes, recovery codes, access keys, or session tokens.
- DB password.
- Full DB connection strings that include passwords.
- Nylas API key, OAuth client secret, webhook secret, or state-signing secret.
- Raw origin verification secret.
- GitHub tokens or deploy credentials.
- Any provider API key or OAuth secret.

Allowed places for secrets:

- AWS Secrets Manager.
- GitHub Actions secrets / GitHub Environment secrets.
- Password manager controlled by Jonat.
- Short-lived shell environment variables during an approved command.

Avoid when possible:

- Raw secrets in local `terraform.tfvars`, even though it is gitignored.
- Raw secrets in screenshots.
- Raw secrets in terminal output.

Next action:

- Start with Route 53 hosted zone setup or prod DB/secret setup, with explicit approval before any mutation.

## Step 4B — Route 53 setup guidance and current DNS discovery

Status: guidance documented; no Route 53 mutation performed.

Updated on: 2026-07-05T06:52:57Z.

Read-only checks run:

```bash
nslookup -type=NS mangorts.com
nslookup -type=SOA mangorts.com
aws route53 list-hosted-zones-by-name --profile mangorts-prod --dns-name mangorts.com
aws route53 list-hosted-zones-by-name --profile mangorts-dev --dns-name mangorts.com
aws route53 list-resource-record-sets --profile mangorts-dev --hosted-zone-id Z07929803JGGMRO04UP2L
```

Findings:

- Public DNS for `mangorts.com` already points at AWS Route 53 nameservers.
- The prod AWS account does not yet contain a `mangorts.com` hosted zone.
- The `mangorts-dev` profile can see an existing public hosted zone:
  - Hosted zone ID: `Z07929803JGGMRO04UP2L`.
  - Name: `mangorts.com.`
  - Record count: `8`.
- Existing non-NS/SOA records are dev records only by name:
  - `dev.mangorts.com.` A alias.
  - `api.dev.mangorts.com.` A alias.
  - `origin.dev.mangorts.com.` A alias.
  - ACM validation CNAMEs for those dev names.

Route 53 setup plan:

1. Create a new public hosted zone for `mangorts.com` in prod account `828435022930`.
2. Copy the existing dev DNS records from the old zone into the new prod zone before delegation, so dev subdomains do not break.
3. Record the new prod Route 53 nameservers.
4. At the domain registrar, replace the domain's authoritative nameservers with the new prod Route 53 nameservers.
5. Wait for public DNS to return the new nameservers.
6. Confirm `aws route53 list-hosted-zones-by-name --profile mangorts-prod --dns-name mangorts.com` returns the prod hosted zone.

Sensitive-info note:

- Route 53 nameservers, hosted zone IDs, and DNS record names are okay to record.
- Registrar login credentials, MFA codes, recovery codes, and payment information must not be pasted into chat or docs.

Next action:

- Get explicit approval before Hermes creates the prod public hosted zone or copies DNS records.

## Step 4C — Prod Route 53 hosted zone created and dev DNS copied

Status: complete; waiting on registrar nameserver delegation by Jonat.

Updated on: 2026-07-05T07:05:59Z.

Approval:

- Jonat approved Hermes to go as far as possible and stop when Jonat's manual part is needed.

Created resource:

```text
Prod public hosted zone: mangorts.com.
Hosted zone ID: Z05521211GBNMIH6SBM5Z
AWS account: 828435022930
```

New prod Route 53 nameservers:

```text
ns-419.awsdns-52.com
ns-1490.awsdns-58.org
ns-890.awsdns-47.net
ns-1736.awsdns-25.co.uk
```

Copied records into the new prod hosted zone before delegation:

- `dev.mangorts.com.` A alias.
- `api.dev.mangorts.com.` A alias.
- `origin.dev.mangorts.com.` A alias.
- ACM validation CNAMEs for those dev names.

Verification:

- Prod hosted zone exists in account `828435022930`.
- Prod hosted zone currently has `8` record sets.
- Existing public DNS still points to the previous Route 53 nameservers until Jonat updates registrar delegation.

No secrets exposed:

- Only hosted zone IDs, nameservers, and DNS record names were recorded.
- No registrar credentials, MFA codes, recovery codes, payment data, or API keys were requested or recorded.

Jonat's required manual part:

- Log into the domain registrar for `mangorts.com`.
- Change authoritative nameservers to the four new prod Route 53 nameservers listed above.
- Do not paste registrar credentials, MFA codes, or recovery codes into chat.

Next action after Jonat updates the registrar:

- Verify public `NS` lookup for `mangorts.com` returns the new prod nameservers.
- Then continue with prod DB/Secrets Manager setup.

## Step 4D — Domain registrar location checked

Status: read-only discovery complete; registrar update can be done through AWS after explicit approval.

Updated on: 2026-07-05T07:16:51Z.

Read-only checks run:

```bash
aws route53domains list-domains --profile mangorts-prod --region us-east-1
aws route53domains list-domains --profile mangorts-dev --region us-east-1
nslookup -type=NS mangorts.com
```

Findings:

- `mangorts.com` is registered in AWS Route 53 Domains under the `mangorts-dev`/old account context, not the new prod account.
- The domain has auto-renew enabled.
- The domain expires in 2027 unless renewed.
- Current public nameservers still point to the old hosted zone:
  - `ns-1130.awsdns-13.org`
  - `ns-1629.awsdns-11.co.uk`
  - `ns-424.awsdns-53.com`
  - `ns-630.awsdns-14.net`

Meaning:

- Jonat does not need to find a separate third-party registrar login for this step.
- The registrar/delegation change can be done through AWS Route 53 Domains using the `mangorts-dev` profile.
- This is still a production DNS delegation mutation and should only be done after explicit approval.

No sensitive registrant details were read or recorded:

- Did not call domain detail APIs that return registrant contact information.
- Did not request or record registrar credentials, MFA codes, payment details, or recovery codes.

Next action if approved:

- Update the registered domain nameservers for `mangorts.com` to the prod hosted zone nameservers:
  - `ns-419.awsdns-52.com`
  - `ns-1490.awsdns-58.org`
  - `ns-890.awsdns-47.net`
  - `ns-1736.awsdns-25.co.uk`
- Then verify public DNS changes as they propagate.

## Step 4E — Registered domain nameservers updated to prod hosted zone

Status: complete.

Updated on: 2026-07-05T07:19:47Z.

Approval:

- Jonat explicitly approved updating the registered domain nameservers to the prod hosted zone.

Command category:

- AWS Route 53 Domains nameserver update using `mangorts-dev`/old account context, where the domain registration lives.

Operation:

```text
Operation ID: 05f81610-00b2-44a5-9768-02c31f90265e
Type: UPDATE_NAMESERVER
Status: SUCCESSFUL
```

New registered domain nameservers:

```text
ns-419.awsdns-52.com
ns-1490.awsdns-58.org
ns-890.awsdns-47.net
ns-1736.awsdns-25.co.uk
```

Verification:

- AWS Route 53 Domains now reports the four prod nameservers above for `mangorts.com`.
- Public `NS` lookup now returns the new prod nameservers.
- No registrant contact details were printed or recorded.
- No registrar credentials, MFA codes, recovery codes, payment data, or API keys were requested or recorded.

Next action:

- Continue with prod DB and Secrets Manager setup.

## Step 5 — Prod DB and Secrets Manager setup instructions

Status: instructions documented; no DB or secret created yet in this step.

Updated on: 2026-07-05T07:26:33Z.

Read-only context used:

- Dev currently uses Aurora PostgreSQL `17.7`.
- Prod has no RDS clusters/instances yet.
- Prod has no `mangorts/prod` Secrets Manager secrets yet.

Recommended first prod DB shape:

```text
Engine: Aurora PostgreSQL
Engine version: 17.7, to match dev for first launch
Region: us-west-1
DB cluster identifier: mangorts-prod-db
Initial database name: mangorts
App/master username for V1 bootstrap: mangorts_app
Public access: No
VPC: vpc-058fed523b6e847bf
Subnets/subnet group: default VPC subnets are acceptable for first launch if public access is off
Security group name: mangorts-prod-db
Initial inbound rules: none, or the minimum AWS console requires; Terraform will later add ECS ingress
Encryption: enabled
Backups: enabled
Deletion protection: enabled if this is intended as real prod
Aurora Serverless v2 capacity: min 1 ACU, max 4 ACU for first prod; tune later
```

Sensitive handling:

- Do not paste the DB password into chat, docs, screenshots, or committed files.
- Store the DB password in AWS Secrets Manager.
- Secret name should be `mangorts/prod/db-password`.
- Prefer a plaintext secret value containing only the password for this current Terraform shape.
- Do not use an RDS-managed JSON secret for the app password unless Terraform is updated to separate IAM secret ARN from ECS `valueFrom` JSON-key syntax.

Values Jonat may safely provide back after setup:

- DB writer endpoint hostname.
- DB port, expected `5432`.
- DB name, expected `mangorts`.
- DB username, expected `mangorts_app`.
- DB password secret ARN for `mangorts/prod/db-password`.
- DB security group ID for `mangorts-prod-db`.

Values Jonat must not provide back:

- DB password.
- Any screenshot showing the DB password or secret value.
- Any full connection string containing the password.

Next action:

- Jonat can either create the DB/secret manually using the documented console instructions, or explicitly approve Hermes to create them via AWS CLI while keeping the generated password out of terminal output.

## Step 5A — AWS console sign-in method clarified

Status: guidance documented; no AWS changes made.

Updated on: 2026-07-06T02:42:43Z.

Context:

- Jonat showed the AWS regular `IAM user sign in` page with authentication failure.
- Jonat tried using `MangoRTS Production` as an IAM username and the prod account ID as the account ID.
- Jonat suspected no IAM user password was created.

Clarification:

- This is expected: we did not create a classic IAM user or IAM password.
- `MangoRTS Production` is an AWS account/resource container, not a username.
- The prod account ID is not enough to sign in on the IAM-user page unless a classic IAM user exists in that account.
- For this workflow, Jonat should not create or use a classic IAM user.
- Use IAM Identity Center / AWS SSO via the AWS access portal instead.

Correct sign-in path:

1. Open the AWS access portal URL from IAM Identity Center settings.
2. Sign in with Jonat's Identity Center user.
3. Choose `MangoRTS Production`.
4. Choose `AdministratorAccess`.
5. Click the console/management-console link.
6. Then open RDS in `us-west-1` and continue DB setup.

Sensitive-info note:

- Do not create access keys.
- Do not paste passwords, MFA codes, or recovery codes into chat/docs/screenshots.
- If Identity Center asks to set or reset a password, Jonat should do that privately in the browser.

Next action:

- Jonat should leave the IAM-user sign-in page and use the AWS access portal / SSO path.

## Step 5B — AWS access portal URL clarified

Status: guidance documented; no AWS changes made.

Updated on: 2026-07-06T02:47:50Z.

Context:

- Jonat asked which of the three IAM Identity Center URLs is the correct sign-in URL.

Clarification:

- Use the AWS access portal URL ending in `/start`.
- The safest one to use here is the IPv4-only access portal URL Jonat previously found.
- The dual-stack portal URL is also a portal URL, but the IPv4-only `/start` URL is simpler for this setup.
- The Issuer URL is not for human console login; it is for OIDC applications/clients.

Correct browser sign-in target:

```text
IPv4-only AWS access portal URL ending in /start
```

After opening it:

1. Sign in with the Identity Center user.
2. Choose `MangoRTS Production`.
3. Choose `AdministratorAccess`.
4. Click the AWS console / management console link.
5. Switch region to `us-west-1`.
6. Open RDS.

Sensitive-info note:

- The portal URL is account-specific but not a password.
- Passwords, MFA codes, and recovery codes still must stay out of chat/docs/screenshots.

## Step 5C — Identity Center portal username/password confusion

Status: guidance documented; no AWS changes made.

Updated on: 2026-07-06T02:53:18Z.

Context:

- Jonat opened the correct AWS access portal sign-in flow.
- The portal page showed username `MangoRTS Production`, which is wrong because that is the AWS account name, not Jonat's Identity Center username.
- Jonat does not remember creating an Identity Center password.

Guidance:

- Do not use `MangoRTS Production` as the username.
- Click `not you?` on the sign-in page.
- Enter Jonat's actual IAM Identity Center username or email.
- After signing in, `MangoRTS Production` is the account to choose, not the username.
- If Jonat does not know the Identity Center password, use `Forgot password?` on the portal page and reset it privately.
- If password reset does not work, sign in as the AWS management/root user and go to IAM Identity Center > Users > select the user > reset/send password setup email.

Sensitive-info note:

- Do not paste the Identity Center password, reset link, MFA code, or recovery code into chat or docs.

Next action:

- Jonat should click `not you?`, enter the actual Identity Center username/email, and use `Forgot password?` if needed.

## Step 5D — AWS account vs user login model re-explained

Status: guidance documented; no AWS changes made.

Updated on: 2026-07-06T02:57:56Z.

Context:

- Jonat was confused about which account/user to use because AWS has root sign-in, IAM user sign-in, and IAM Identity Center / SSO sign-in.
- Jonat reported successfully logging in with the existing `ScoobyXD` user/account identity.
- Local CLI `mangorts-prod` SSO token is currently expired, which only means CLI login must be refreshed later; it does not change the browser sign-in model.

Clarification:

- `MangoRTS Production` is the AWS account/resource container created for prod. It is not the login username.
- `ScoobyXD` appears to be the human Identity Center/SSO identity Jonat can use to enter the AWS access portal.
- After signing in as the human SSO identity, Jonat chooses the `MangoRTS Production` AWS account and the `AdministratorAccess` permission set.
- Root sign-in should be reserved for rare management/emergency work only.
- Regular IAM user sign-in should not be used for this production setup.

Correct answer to "which account do I log in with?":

```text
Sign in to the AWS access portal with the existing human SSO identity, likely ScoobyXD.
Then choose MangoRTS Production → AdministratorAccess.
```

Next action:

- If Jonat is now inside AWS Console after signing in as `ScoobyXD`, switch to account `MangoRTS Production`, region `us-west-1`, and open RDS.

## Step 5E — AWS/Google passkey concern clarified

Status: guidance documented; no AWS changes made.

Updated on: 2026-07-06T03:00:40Z.

Context:

- Jonat saw Google passkeys for AWS and was concerned they may be dangerous or unnecessary.

Clarification:

- A passkey is a sign-in factor stored in a password manager/device, not an AWS account and not an IAM user.
- It may have been created for AWS root/IAM sign-in or AWS access portal sign-in.
- A passkey is usually safer than a reusable password because it is domain-bound and phishing-resistant.
- It is still sensitive in the sense that control of the Google account/device could affect access.
- Do not delete passkeys until another working sign-in method is confirmed, or Jonat may lock himself out.

Recommended handling:

- Keep the passkeys for now while prod setup is in progress.
- Do not share screenshots that show passkey details, recovery options, or account recovery material.
- Later, after access is stable, review AWS security credentials and passkeys intentionally.
- If removing a passkey, first confirm root/SSO recovery paths and MFA are working.

Next action:

- Continue using the working AWS access portal / SSO path rather than changing passkey settings during DB setup.

## Step 5F — Prod RDS sizing and form-setting decision

Status: guidance documented; no AWS changes made by Hermes.

Updated on: 2026-07-06T03:06:22Z.

Screen context:

- Jonat is on AWS Aurora and RDS > Create database in the `MangoRTS Production` account.
- Visible selections were Aurora PostgreSQL, Full configuration, Production template, and Provisioned cluster scalability.

Decision:

- Use Aurora PostgreSQL.
- Use Full configuration.
- Use Production template.
- Change cluster scalability from `Provisioned` to `Aurora serverless` / Aurora Serverless v2.
- Do not use Limitless Database for first prod.
- Use engine version `17.7` to match dev for first launch.
- Start with one writer and no reader instance to keep cost lower for first prod.
- Start capacity at min `1` ACU and max `4` ACU.
- Later scaling is easy: raise max ACU, add a reader, or move to provisioned/larger capacity if sustained load requires it.

Recommended DB form values:

```text
Engine type: Aurora PostgreSQL Compatible
Creation method: Full configuration
Template: Production
Cluster scalability type: Aurora serverless
Engine version: 17.7
DB cluster identifier: mangorts-prod-db
Master username: mangorts_app
Credentials: self-managed password for now; do not paste it into chat/docs/screenshots
Initial database name: mangorts
VPC: vpc-058fed523b6e847bf
Public access: No
Security group: mangorts-prod-db
Inbound rules: keep closed/minimal for now; Terraform will later allow ECS to connect
Encryption: enabled
Backups: enabled
Deletion protection: enabled
CloudWatch logs: PostgreSQL log enabled if available
Enhanced monitoring / Performance Insights: basic/default is acceptable for first prod; tune later
```

Rationale:

- Aurora Serverless v2 avoids guessing a fixed DB instance size before real traffic exists.
- Doubling DB capacity can usually be handled by increasing max ACUs, often without replacing the database.
- The app/backend compute is also easy to scale later via ECS task CPU/memory and desired task count.
- A single writer is cheaper for first prod; a reader/failover instance can be added later when real customer load or uptime requirements justify it.

Sensitive-info note:

- The DB password must stay out of chat/docs/screenshots.
- After DB creation, store only the password value in Secrets Manager secret `mangorts/prod/db-password` and return only the secret ARN.

Next action:

- Jonat should change the visible `Cluster scalability type` selection from `Provisioned` to `Aurora serverless`, then continue through the form using the values above.

## Step 5G — Full RDS form choices selected

Status: guidance documented; no AWS changes made by Hermes.

Updated on: 2026-07-06T03:11:59Z.

Screen context:

- Current visible estimate with Aurora Serverless `4–8` ACUs was `1,226.4 – 2,452.8 USD/month`, which is too expensive for first MangoRTS prod.
- Current visible selections included Aurora Serverless, engine `17.7`, cluster identifier `database-1`, username `postgres`, AWS-managed credentials, Aurora I/O-Optimized, Aurora replica enabled, default VPC, public access off, default security group, Database Insights Advanced, Enhanced Monitoring on, backup retention 7 days, AWS managed KMS, auto minor upgrades on, and deletion protection on.

Chosen settings for first prod:

```text
Capacity min ACU: 0.5
Capacity max ACU: 2
Pause after inactivity: disabled because min is not 0
Engine version: Aurora PostgreSQL 17.7
RDS Extended Support: unchecked
DB cluster identifier: mangorts-prod-db
Master username: mangorts_app
Credential management: Managed in AWS Secrets Manager
Credentials KMS key: aws/secretsmanager default
IAM database authentication: off
Kerberos authentication: off
Storage configuration: Aurora Standard
Aurora replica / reader in another AZ: do not create for first prod
Compute resource connection: do not connect to EC2
Network type: IPv4
VPC: default VPC vpc-058fed523b6e847bf
DB subnet group: default
Public access: No
VPC security group: create new mangorts-prod-db instead of using default
Certificate authority: default rds-ca-rsa2048-g1
RDS Data API: off
Database port: 5432
Read replica write forwarding: off
Tags: add project=mangorts and environment=prod if the console allows it
Babelfish: off
Database Insights: Standard, not Advanced
Enhanced Monitoring: off for first prod unless AWS requires it
Log exports: PostgreSQL log on if available; IAM DB auth/instance logs off
Initial database name: mangorts
DB cluster parameter group: default aurora-postgresql17
DB parameter group: default aurora-postgresql17
Failover priority: No preference
Backup retention: 7 days
Backup window: No preference
Backup tags: copy tags to snapshots on
Encryption: AWS managed KMS key aws/rds
Auto minor version upgrade: on
Maintenance window: No preference
Deletion protection: on
```

Rationale:

- `0.5–2` ACUs avoids the visible four-figure monthly DB estimate while still allowing the DB to scale up under early load.
- Aurora Standard is better for first prod because MangoRTS is not expected to have high I/O yet.
- No reader instance keeps cost lower; add a reader when real usage or uptime needs justify it.
- AWS-managed DB credentials reduce password exposure to Jonat/chat/docs/screenshots.
- A new DB security group is safer than attaching the database to the default security group.

Follow-up needed after DB creation:

- Capture the writer endpoint, port, DB name, username, RDS managed secret ARN, and DB security group ID.
- Either create an app-compatible plaintext Secrets Manager secret `mangorts/prod/db-password` without printing the password, or update Terraform to consume the RDS-managed JSON secret safely.
- Do not print or paste the DB password.

Next action:

- Jonat should apply the selected settings above in the RDS console and share only non-secret outputs after creation.

## Step 5H — RDS full screenshot review before create

Status: reviewed; do not click `Create database` until remaining changes are made.

Updated on: 2026-07-06T03:34:59Z.

Screen review result:

- Most settings now match the first-prod plan.
- Estimated monthly cost now shows `58.4 - 233.6 USD`, much better than the earlier four-figure estimate.
- Remaining required change: set `Initial database name` to `mangorts`.
- Recommended changes before create: enable `PostgreSQL log` export and add tags `project=mangorts`, `environment=prod` if the console allows it.

Explicit top-to-bottom selected-state checklist:

```text
Engine type: stay Aurora PostgreSQL Compatible
Creation method: stay Full configuration
Template: stay Production
Cluster scalability type: stay Aurora serverless
Minimum capacity: stay 0.5 ACU
Maximum capacity: stay 2 ACUs
Pause after inactivity: stay disabled/greyed out
Engine version: stay Aurora PostgreSQL 17.7
RDS Extended Support: stay unchecked
DB cluster identifier: stay mangorts-prod-db
Master username: stay mangorts_app
Credential management: stay Managed in AWS Secrets Manager
Secrets Manager encryption key: stay aws/secretsmanager default
IAM database authentication: stay unchecked
Kerberos authentication: stay unchecked
Storage configuration: stay Aurora Standard
Aurora replica/reader: stay Don't create an Aurora Replica
Compute resource connection: stay Don't connect to EC2
Network type: stay IPv4
VPC: stay Default VPC vpc-058fed523b6e847bf
DB subnet group: stay default
Public access: stay No
VPC security group: stay Create new
New VPC security group name: stay mangorts-prod-db
Availability Zone: stay No preference
Certificate authority: stay rds-ca-rsa2048-g1 default
RDS Data API: stay unchecked
Database port: stay 5432
Read replica write forwarding: stay unchecked
Tags: change from none to project=mangorts and environment=prod if easy
Babelfish: stay unchecked
Database Insights: stay Standard
Performance Insights: stay enabled with 7 days retention
Performance Insights KMS key: stay aws/rds default
Enhanced Monitoring: stay unchecked/off
Log exports: change PostgreSQL log to checked; leave iam-db-auth-error log and instance log unchecked
Initial database name: change blank to mangorts
DB cluster parameter group: stay default.aurora-postgresql17
DB parameter group: stay default.aurora-postgresql17
Failover priority: stay No preference
Backup retention period: stay 7 days
Backup window: stay No preference
Copy tags to automated backup: stay unchecked
Copy tags to snapshots: stay checked
Encryption type: stay AWS managed KMS key aws/rds
Auto minor version upgrade: stay checked
Maintenance window: stay No preference
Deletion protection: stay checked
Estimated monthly cost: accepted at 58.4 - 233.6 USD
```

Next action:

- Jonat should set `Initial database name = mangorts`, enable PostgreSQL log export if available, optionally add the two tags, then click `Create database`.

## Step 5I — Public access for database clarified

Status: guidance documented; no AWS changes made.

Updated on: 2026-07-06T03:44:02Z.

Question:

- Jonat asked why the database should not have public access if the product is meant for outside users.

Clarification:

- Public users should reach the product through the website/API, not directly through PostgreSQL.
- The public internet path is: browser/user -> CloudFront/ALB -> ECS backend -> private RDS database.
- `Public access: No` means the database itself has no public internet endpoint.
- This is correct for production because PostgreSQL should only accept traffic from the backend/ECS security group.
- The app can still be public even while the database is private.

Reason:

- A public database endpoint increases exposure to scans, brute-force attempts, misconfigured security groups, and credential attacks.
- Keeping RDS private is standard production architecture.
- If admin access is needed later, use controlled paths such as VPN, SSM/session manager, a bastion host, or a temporary tightly-scoped security-group rule.

Decision:

- Keep RDS `Public access: No`.

Next action:

- Continue with the RDS form review; do not change public access to Yes.

## Step 5J — RDS tags confirmed

Status: complete.

Updated on: 2026-07-06T03:51:10Z.

Screen result:

```text
project = mangorts
environment = prod
```

Decision:

- Tags are correct.
- Keep both tags.

Next action:

- Continue with the remaining pre-create checks: `Initial database name = mangorts` and PostgreSQL log export enabled if available.

## Step 5K — RDS create clicked

Status: in progress.

Updated on: 2026-07-06T03:56:20Z.

User action:

- Jonat clicked `Create database` for the prod Aurora PostgreSQL database.

Expected resource:

```text
DB cluster identifier: mangorts-prod-db
Engine: Aurora PostgreSQL 17.7
Mode: Aurora Serverless v2
Capacity: 0.5 - 2 ACUs
DB name: mangorts
Master username: mangorts_app
Public access: No
Security group: mangorts-prod-db
Tags: project=mangorts, environment=prod
```

Verification attempt:

- Hermes attempted to query RDS with `aws rds describe-db-clusters --profile mangorts-prod --region us-west-1`.
- Verification was blocked because the local `mangorts-prod` AWS SSO token is expired.
- This does not mean the DB creation failed; it only means CLI verification needs SSO refresh.

Sensitive-info note:

- No DB password was requested or recorded.
- Do not screenshot or paste any secret value shown by RDS/Secrets Manager.

Next action:

- Wait for RDS creation to finish in the console.
- Refresh local SSO when needed, then verify the DB endpoint, secret ARN, and security group ID with read-only AWS CLI calls.

## Step 5L — Prod RDS cluster verified

Status: partially complete.

Updated on: 2026-07-06T03:56:20Z.

Actions:

- Refreshed local `mangorts-prod` AWS SSO login.
- Ran read-only RDS verification commands.

Cluster verification result:

```text
DB cluster identifier: mangorts-prod-db
Cluster status: available
Writer endpoint: mangorts-prod-db.cluster-cpcceyaigiit.us-west-1.rds.amazonaws.com
Reader endpoint: mangorts-prod-db.cluster-ro-cpcceyaigiit.us-west-1.rds.amazonaws.com
Database name: mangorts
Engine: aurora-postgresql
Engine version: 17.7
Port: 5432
Master username: mangorts_app
RDS managed secret ARN: arn:aws:secretsmanager:us-west-1:828435022930:secret:rds!cluster-d26dab99-99bc-40c2-9465-4a67189b1177-2xZr7k
RDS managed secret status: active
DB security group ID: sg-0ba84e2c327457f1e
Publicly accessible: false
```

Instance verification result:

```text
DB instance identifier: mangorts-prod-db-instance-1
DB instance status: creating
DB instance class: db.serverless
```

Sensitive-info note:

- No DB password was printed or recorded.
- The recorded secret ARN is metadata, not the secret value.

Next action:

- Wait for DB instance `mangorts-prod-db-instance-1` to become `available`.
- Then decide how Terraform/ECS should consume the DB password: create an app-compatible plaintext password secret without printing the value, or update Terraform to reference the RDS-managed JSON secret correctly.

## Step 5M — Database, ECS hosting, and scaling model clarified

Status: guidance documented; no AWS changes made.

Updated on: 2026-07-06T04:05:25Z.

Current verification:

- RDS DB instance `mangorts-prod-db-instance-1` is now `available`.
- DB instance class is `db.serverless`.
- DB remains not publicly accessible.

Architecture clarification:

- The RDS database stores application data.
- The application logic runs in the Go backend container on ECS Fargate.
- Users reach CloudFront/ALB/API; ECS talks to private RDS.
- ECS has not been applied/created for prod yet.

Current prod Terraform backend compute defaults:

```text
backend_cpu: 1024 CPU units / 1 vCPU per task
backend_memory: 2048 MiB / 2 GiB per task
backend_desired_count: 2 tasks
launch type: Fargate
```

Scaling model:

- Backend/app scaling is easy after ECS exists: increase `backend_desired_count`, `backend_cpu`, and/or `backend_memory`, then redeploy/apply.
- Current prod Terraform does not yet define ECS autoscaling policies, so scaling is manual/config-driven until autoscaling is added.
- A 3x user spike can usually be handled by increasing desired backend tasks and, if needed, DB max ACUs.
- A 10x spike may require increasing backend task count, increasing CPU/memory per task, raising Aurora max ACUs, adding a DB reader if read-heavy, and possibly adding autoscaling policies.

Next action:

- Update Terraform to consume the RDS-managed DB secret safely, fill `infra/aws-prod/terraform.tfvars`, then plan the prod ECS/CloudFront/Cognito/ECR stack before any apply.

## Step 5N — Branch tracking and next Terraform task recorded

Status: documented.

Updated on: 2026-07-06T04:11:40Z.

Branch tracking check:

```text
Current branch: prod-scaffolding-v1
Upstream: origin/prod-scaffolding-v1
Latest shared commit: 71a55e34 prod stuff
Branch status before this documentation update: branch was tracking origin/prod-scaffolding-v1; only the progress log had local modifications from the current session.
```

User note:

- Jonat said he pushed all branch changes to GitHub.
- Hermes verified the local branch is `prod-scaffolding-v1` and has upstream `origin/prod-scaffolding-v1`.
- New documentation edits after that push still need to be committed/pushed later if Jonat wants them on GitHub.

Required next Terraform task, exact wording requested by Jonat:

```text
Update Terraform to reference the password field from the RDS-managed secret safely.
```

Why this is needed:

- RDS created an AWS-managed Secrets Manager credential secret.
- That secret is expected to be JSON-shaped.
- Current ECS Terraform passes `existing_db_password_secret_arn` directly to the container `DB_PASSWORD` secret.
- ECS needs to receive only the password field, not the full JSON secret.

Next action:

- Update prod Terraform secret handling before the prod ECS task definition is applied.

## Step 6 — Terraform RDS-managed secret JSON-key handling

Status: complete; repo-only change, no prod apply run.

Updated on: 2026-07-06T04:23:15Z.

Screen/AWS confirmation:

- RDS console showed `mangorts-prod-db` and `mangorts-prod-db-instance-1` both `Available`.
- Read-only AWS CLI confirmed cluster `mangorts-prod-db` is `available`.
- Read-only AWS CLI confirmed instance `mangorts-prod-db-instance-1` is `available`.

Changed files:

```text
.github/workflows/deploy-prod.yml
infra/aws-prod/ecs_alb.tf
infra/aws-prod/variables.tf
infra/aws-prod/terraform.tfvars.example
```

What changed:

- Added `existing_db_password_secret_json_key` Terraform variable.
- Updated ECS `DB_PASSWORD` secret `valueFrom` to select a JSON key when configured.
- Updated the prod GitHub workflow to pass `TF_EXISTING_DB_PASSWORD_SECRET_JSON_KEY` into Terraform inputs.
- RDS-managed credential secrets should set:

```hcl
existing_db_password_secret_json_key = "password"
```

- Plain password-only secrets can leave the key empty.

Validation:

```text
terraform -chdir=infra/aws-prod fmt
terraform -chdir=infra/aws-prod validate
```

Result:

```text
Success! The configuration is valid.
WORKFLOW_SECRET_JSON_KEY_CHECK_OK
```

Sensitive-info note:

- No DB password was read, printed, or recorded.
- Only the RDS-managed secret ARN metadata is recorded.

Next action:

- Create/update local gitignored `infra/aws-prod/terraform.tfvars` with the verified prod DB metadata and `existing_db_password_secret_json_key = "password"`, then run a Terraform plan for review before any apply.

## Step 7 — Local prod Terraform inputs and first plan

Status: plan complete; no apply run.

Updated on: 2026-07-06T04:38:58Z.

Actions:

- Created local gitignored `infra/aws-prod/terraform.tfvars`.
- Generated a local `origin_verify_secret` and wrote it only to the gitignored tfvars file.
- Did not print or record the `origin_verify_secret` value.
- Generated prod default company UUID:

```text
face60cd-27e2-4e5a-92b0-b2cdb78545c8
```

Initial plan attempt:

- First `terraform plan` failed because Terraform did not have an explicit AWS credential source.
- Reran with:

```bash
export AWS_PROFILE=mangorts-prod
export AWS_SDK_LOAD_CONFIG=1
```

Successful plan command:

```bash
terraform -chdir=infra/aws-prod plan -out=tfplan -input=false
```

Plan result:

```text
Plan: 55 to add, 0 to change, 0 to destroy.
```

Safe plan summary:

- Creates prod CloudFront/S3 frontend.
- Creates prod ALB/listener/target group.
- Creates prod Cognito user pool and clients.
- Creates prod ECR repository.
- Creates prod ECS cluster, but no ECS service/task yet because `backend_image_uri = ""` for phase-1 bootstrap.
- Creates private ECS subnets, route tables, one NAT gateway, and DB ingress from ECS security group.
- Creates Route 53 records for `mangorts.com`, `api.mangorts.com`, and `origin.mangorts.com`.
- Creates ACM certificates and validation records.
- Creates WAF for CloudFront.
- Creates GitHub OIDC deploy role scoped to branch `prod-scaffolding-v1`.

Notable outputs from the plan:

```text
app_url = https://mangorts.com
api_url = https://api.mangorts.com
default_company_id = face60cd-27e2-4e5a-92b0-b2cdb78545c8
ecs_cluster_name = mangorts-prod-cluster
ecs_service_name = "" because backend service is disabled until a backend image exists
frontend_bucket = mangorts-prod-frontend-828435022930
```

Sensitive-info note:

- `infra/aws-prod/terraform.tfvars` is gitignored.
- `infra/aws-prod/tfplan` is gitignored.
- The generated origin verification secret was not printed or recorded.
- No DB password was read, printed, or recorded.

Next action:

- Review the plan summary with Jonat.
- If Jonat explicitly approves, run `terraform apply tfplan` to create the prod skeleton resources.
- Do not apply without explicit approval.

## Step 8 — First prod Terraform apply completed

Status: complete.

Updated on: 2026-07-06T05:14:36Z.

Approval:

- Jonat explicitly approved running the first prod Terraform apply.

Command:

```bash
export AWS_PROFILE=mangorts-prod
export AWS_SDK_LOAD_CONFIG=1
terraform -chdir=infra/aws-prod apply -input=false tfplan
```

Apply result:

```text
Apply complete! Resources: 55 added, 0 changed, 0 destroyed.
```

Created/confirmed outputs:

```text
app_url = https://mangorts.com
api_url = https://api.mangorts.com
backend_ecr_repository_url = 828435022930.dkr.ecr.us-west-1.amazonaws.com/mangorts-prod-backend
cloudfront_distribution_id = E163LYR5A8EQMJ
cloudfront_domain = d3pnjorzs8umb3.cloudfront.net
cognito_issuer = https://cognito-idp.us-west-1.amazonaws.com/us-west-1_tddWJsjUA
cognito_region = us-west-1
cognito_spa_client_id = 5dds4k34vnt2n1ub8deg6m617h
cognito_user_pool_id = us-west-1_tddWJsjUA
default_company_id = face60cd-27e2-4e5a-92b0-b2cdb78545c8
ecs_cluster_name = mangorts-prod-cluster
ecs_service_name = "" because backend service is not created until a backend image exists
ecs_subnet_ids = subnet-053756cc89d3dfc95, subnet-0985f76c72ad2f80d
frontend_bucket = mangorts-prod-frontend-828435022930
github_deploy_role_arn = arn:aws:iam::828435022930:role/mangorts-prod-github-deploy
managed_nat_gateway_ids = nat-078f52f1357ee5442
nylas_callback_url = https://api.mangorts.com/nylas/oauth/callback
nylas_frontend_redirect_url = https://mangorts.com/communications
nylas_webhook_url = https://api.mangorts.com/nylas/webhook
```

Read-only verification after apply:

- CloudFront distribution `E163LYR5A8EQMJ` status is `Deployed` and enabled.
- CloudFront aliases include `mangorts.com` and `api.mangorts.com`.
- ECR repository `mangorts-prod-backend` exists.
- ECS cluster `mangorts-prod-cluster` is `ACTIVE`.
- ECS cluster has `0` running tasks and `0` active services, expected for phase-1 skeleton because no backend image/service exists yet.
- Route 53 `mangorts.com` and `api.mangorts.com` A records alias to CloudFront.
- Route 53 `origin.mangorts.com` A record aliases to the ALB.

Sensitive-info note:

- No DB password was printed or recorded.
- The generated origin verification secret remains only in the local gitignored `infra/aws-prod/terraform.tfvars` and Terraform state.
- `infra/aws-prod/terraform.tfvars` and `infra/aws-prod/tfplan` remain gitignored.

Next action:

- Build and push the first prod backend image to ECR.
- Then run a second Terraform plan/apply with `backend_image_uri` set so the ECS service can be created.
- Before GitHub Actions can deploy prod later, save `github_deploy_role_arn` as GitHub production secret `AWS_PROD_DEPLOY_ROLE_ARN` and store the origin verification secret as `PROD_ORIGIN_VERIFY_SECRET` without printing it.

## Step 9 — Backend image, ECS service, frontend publish, and DB bootstrap

Status: complete.

Updated on: 2026-07-06T06:35:00Z.

Safety note:

- No recursive deletion was run in this step.
- No DB password, origin verification secret, AWS session token, or GitHub token was printed or recorded.
- Temporary ECR login entries created by `ko login` were removed from the local Docker config after each push.

Backend image build/push:

- Docker was not installed on the laptop, so the backend image was built and pushed with `ko` instead of Docker Desktop.
- Backend image pushed to ECR:

```text
828435022930.dkr.ecr.us-west-1.amazonaws.com/mangorts-prod-backend@sha256:6dc68dc0a05072345a43b132982bff413485626883955a015cd3e3a34aaa4941
```

- Deploy revision used by Terraform/backend health:

```text
manual-71a55e34-20260706T053946Z
```

Second Terraform apply:

```text
Plan: 2 to add, 2 to change, 0 to destroy.
Apply complete! Resources: 2 added, 1 changed, 0 destroyed.
```

Result:

- ECS service `mangorts-prod-backend` was created.
- ECS service reached `ACTIVE` with desired `2`, running `2`, pending `0`.
- Target group had two healthy targets.

Frontend publish:

- Production frontend build initially failed because the bundle still contained the dev company UUID literal.
- Fixed `frontend/src/auth/currentCompany.ts` so production requires `VITE_COMPANY_ID`; the dev fallback is now gated to `import.meta.env.DEV`.
- Production frontend build passed after the fix.
- Frontend assets were synced to `s3://mangorts-prod-frontend-828435022930`.
- CloudFront invalidations completed for the frontend and deploy metadata.

DB schema bootstrap:

- Public/backend health worked before schema, but CloudWatch logs showed missing DB tables such as `event_rows`, `communications_email_archive_job_items`, and `companies`.
- Because the prod DB is private, schema bootstrap was run through one-off ECS/Fargate tasks in the prod ECS private subnets using ECS Secrets Manager injection for the RDS-managed secret `password` field.
- First bootstrap attempts failed safely inside transactions:
  - canonical schema initially failed because PostgreSQL validated function bodies before later tables existed;
  - fixed by setting `check_function_bodies = off` during bootstrap;
  - applying every historical migration on top of canonical schema failed because old migrations expected legacy intermediate columns.
- Final successful bootstrap applied the canonical schema, applied supplemental migration `20260629_communications_archive_jobs.sql`, and marked the 140 historical migration files as applied for this empty prod bootstrap.

Successful bootstrap log:

```text
MANGORTS_PROD_DB_BOOTSTRAP_OK schema_applied=true supplemental_migrations_applied=1 migrations_marked=140
```

One-off task cleanup:

- Temporary ECS task definitions were deregistered after use.
- Failed bootstrap attempts exited non-zero and did not commit partial schema changes.

Smoke verification after DB bootstrap:

```text
frontend deploy-info: HTTP 200
frontend route rewrite: HTTP 200
app health: HTTP 200
api health: HTTP 200
invite validate invalid token: HTTP 404 {"error":"invitation_bad_token"}
me unauth: HTTP 401
api me unauth: HTTP 401
v2 node view unauth: HTTP 401
v2 logic gate view unauth: HTTP 401
nylas webhook challenge: HTTP 200
PROD_SMOKE_OK
```

CloudWatch verification:

- A recent filter for `relation does not exist` after bootstrap returned no matching backend log events.

Next action:

- Decide the first prod admin email and bootstrap/login path.
- Configure GitHub production secrets/vars for repeatable GitHub Actions deploys.
- Commit/push the local repo/doc changes when Jonat is ready.
