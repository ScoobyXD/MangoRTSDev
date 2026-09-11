# V1 Permission Security

Last updated: 2026-07-07.

Priority: critical.

This document is the V1 security plan for protecting MangoRTS from malicious,
prompt-injected, mistaken, or impersonated AI-agent actions.

The core problem is simple:

```text
If an agent runs as Jonat on Jonat's laptop, and Jonat's laptop can silently do a
dangerous thing, then the agent may be able to silently do that dangerous thing too.
```

So the V1 solution is not "trust the agent" and not "write stronger prompt rules."
The V1 solution is credential separation:

```text
Dangerous capabilities must require a credential, session, password, passkey,
approval gate, or OS boundary that the default agent does not possess.
```

Chat approval is not a security boundary. A hostile prompt can ask for approval in
convincing words. The real boundary is that the agent cannot change AWS,
databases, GitHub main/prod, provider dashboards, secrets, or production data
unless a separate, programmatic gate is unlocked by Jonat.

## Current Goal

Make the default AI-agent environment safe even if the agent behaves
maliciously.

Default agent sessions may help with local development, but they must not have
the keys needed to damage:

- AWS dev or prod infrastructure.
- Dev or prod databases.
- GitHub `main`, branch protection, deploy workflows, or production secrets.
- Terraform state or prod deploy paths.
- DBeaver writer/admin connections.
- Nylas, Google, Microsoft, SES, domain registrar, AWS root, GitHub admin, or
  other provider accounts.
- Human-only local files, password manager material, browser sessions, SSH keys,
  or saved tokens.

## Non-Negotiable Principle

The agent may prepare. Jonat unlocks.

Agent can prepare code, docs, plans, checklists, and PRs. Jonat uses a separate
human/admin path to unlock or perform dangerous actions.

Examples:

- Agent prepares Terraform changes. Jonat runs or approves prod apply through a
  human-only admin session.
- Agent prepares a GitHub PR. Jonat reviews and merges through protected GitHub
  rules.
- Agent prepares a production deploy. Jonat approves the GitHub `production`
  environment gate.
- Agent prepares DB read queries. Jonat unlocks only a read-only DB path, never a
  writer path.
- Agent prepares AWS inspection commands. Jonat unlocks only a read-only AWS SSO
  role, never an admin role.

## Threat Model

We are defending against:

- Prompt injection in code, docs, websites, issues, PRs, terminal output, logs,
  emails, or app data.
- A malicious user pretending to be Jonat in an agent chat.
- A compromised or confused agent using available tools too broadly.
- An agent reading local credentials, cached sessions, browser data, DBeaver
  saved passwords, `.aws` files, GitHub tokens, Docker auth, or tfvars.
- An agent pushing directly to `main`.
- An agent deploying malicious code through GitHub Actions.
- An agent running `terraform apply`.
- An agent running one-off ECS/Fargate tasks that inherit backend writer secrets.
- An agent reading Secrets Manager values.
- An agent connecting to dev/prod DB with writer credentials.
- An agent deleting, truncating, migrating, or mutating app data directly.
- An agent modifying DNS, Cognito, RDS, ECS, CloudFront, Route 53, GitHub
  settings, Nylas settings, or provider secrets.

## Permission Classes

### Class 0: Default Agent

Allowed by default:

- Read non-secret repo files.
- Edit repo files inside the active workspace.
- Run local tests, linters, formatters, and type checks.
- Use `git status`, `git diff`, `git log`, and similar local inspection.
- Create local commits or branches only when asked.
- Prepare PR text, deploy notes, runbooks, and checklists.

Not allowed by default:

- AWS access.
- Database access.
- Secrets Manager access.
- GitHub admin/settings/secrets access.
- Direct push to `main`.
- Production deployment.
- Terraform apply.
- Terraform plan against prod state if it requires sensitive state or cloud
  credentials.
- DBeaver writer/admin access.
- Reading human-only tfvars, password stores, browser sessions, or credential
  caches.
- Installing system software, changing OS settings, changing scheduled tasks,
  changing startup items, changing firewall rules, changing registry settings,
  or changing global package/tool configuration unless explicitly approved.

### Class 1: Temporary Read-Only Unlock

Allowed only after Jonat unlocks a specific read-only credential or session:

- AWS read-only inspection through an agent read-only SSO profile.
- DB read-only inspection through a read-only DB role.
- GitHub issue/PR/branch inspection through non-admin GitHub auth.
- CloudWatch/log inspection if logs are needed and are not expected to contain
  secrets.

This must be time-limited and scoped. The agent should not keep access after the
task is done.

### Class 2: Human-Only Change

These actions stay human-only by default:

- AWS prod mutations.
- AWS dev mutations that affect shared resources, DB, auth, secrets, networking,
  DNS, or deploy infrastructure.
- Database writes, migrations, schema applies, data fixes, backfills, deletes,
  restores, or direct SQL changes.
- GitHub branch protection/ruleset/settings changes.
- GitHub environment secret changes.
- GitHub production deploy approvals.
- Provider dashboard changes.
- Domain/DNS registrar changes.
- Password manager changes.
- DBeaver writer/admin sessions.
- Terraform apply.
- One-off ECS/Fargate tasks with backend app credentials.

### Class 3: Break-Glass

Break-glass means Jonat intentionally leaves the default safety model to fix an
urgent problem.

Rules:

- Use a human-only session.
- Do not involve an agent operating with writer/admin credentials.
- Record what changed after the fact.
- Rotate any secret that might have been exposed to an agent, logs, terminal
  output, screenshots, or repo files.

## Laptop Boundary

The strongest V1 laptop boundary is a separate Windows user or VM for agents.

Recommended human profile:

```text
C:\Users\Jonat
```

Human profile may contain:

- AWS admin SSO sessions.
- GitHub owner/admin login.
- DBeaver writer/admin profiles.
- Password manager.
- Browser sessions for AWS/GitHub/provider dashboards.
- Prod/dev `terraform.tfvars`.
- Human-only SSH keys, Git credentials, Docker credentials, and provider tools.

Recommended agent profile:

```text
C:\Users\MangoAgent
```

Agent profile should contain:

- Repo clone.
- Go, Node, npm, Terraform, Git, GitHub CLI if needed.
- No AWS admin profiles.
- No saved DB writer/admin credentials.
- No password manager.
- No provider dashboard browser sessions.
- No prod/dev tfvars.
- No GitHub admin token.
- No access to `C:\Users\Jonat` secrets.

Important caveat:

```text
If a coding agent runs as the same Windows user as Jonat, Windows file permissions
do not provide a hard boundary between Jonat's files and the agent.
```

Same-user agent operation is acceptable only for low-risk local development after
human-only secrets are removed or protected from that profile.

## Local Files And Secrets

The default agent profile must not contain or read:

- `infra/aws-prod/terraform.tfvars`
- `infra/aws-dev/terraform.tfvars`
- `infra/aws-prod/backend.hcl`
- `infra/aws-dev/backend.hcl`
- `*.auto.tfvars`
- prod or dev Terraform plans that may contain sensitive values
- AWS credentials files with static keys
- active AWS SSO admin cache
- GitHub personal access tokens
- GitHub CLI auth that can administer the repo or push to `main`
- DBeaver writer/admin config or saved passwords
- password manager databases or browser extension storage
- browser profiles logged into AWS, GitHub, Nylas, Google, Microsoft, Route 53,
  or other provider dashboards
- Docker/ECR auth for prod if it can push production images
- SSH private keys that can mutate production systems or GitHub settings
- full DB connection strings
- DB writer passwords
- Nylas API keys or webhook secrets
- origin verification secrets
- AWS session tokens
- provider API keys

If these files or caches exist in the current shared Windows profile, they must
be moved to a human-only profile, removed, or treated as exposed to agents.

## AWS Rules

AWS must be strict read-only for agents.

Default agent state:

```text
No AWS access.
No active AWS SSO session.
No static AWS keys.
No admin profile.
No Secrets Manager access.
```

Required profiles:

```text
mangorts-prod-agent-readonly
mangorts-dev-agent-readonly
```

Human profiles:

```text
mangorts-prod
mangorts-dev
```

Human profiles must not be available in default agent sessions.

Agent AWS read access:

- Only through the `*-agent-readonly` SSO profiles.
- Only after Jonat explicitly unlocks the read-only SSO session through AWS
  Identity Center.
- Only for the task at hand.
- Session duration should be short.
- No static access keys.
- No `AdministratorAccess`.
- No `PowerUserAccess`.
- No Secrets Manager access, including secret listing and secret metadata.

Agent AWS read-only permission set should allow only inspection such as:

```text
sts:GetCallerIdentity
ec2:Describe*
ecs:Describe*
ecs:List*
elasticloadbalancing:Describe*
rds:Describe*
rds:ListTagsForResource
cloudwatch:Describe*
cloudwatch:Get*
cloudwatch:List*
logs:Describe*
logs:GetLogEvents
logs:FilterLogEvents
```

Agent AWS permission set must explicitly deny:

```text
secretsmanager:*
ecs:RunTask
ecs:StartTask
ecs:StopTask
ecs:RegisterTaskDefinition
ecs:DeregisterTaskDefinition
ecs:Update*
ecs:Create*
ecs:Delete*
iam:PassRole
iam:Create*
iam:Update*
iam:Delete*
iam:Put*
iam:Attach*
iam:Detach*
rds:Create*
rds:Modify*
rds:Delete*
rds:Restore*
rds:Start*
rds:Stop*
rds:Reboot*
rds:Failover*
rds-data:*
route53:Change*
route53:Create*
route53:Update*
route53:Delete*
cloudfront:Create*
cloudfront:Update*
cloudfront:Delete*
cloudfront:PublishFunction
cloudformation:Create*
cloudformation:Update*
cloudformation:Delete*
cloudformation:ExecuteChangeSet
cognito-idp:Admin*
cognito-idp:Create*
cognito-idp:Update*
cognito-idp:Delete*
acm:RequestCertificate
acm:ImportCertificate
acm:DeleteCertificate
elasticloadbalancing:Create*
elasticloadbalancing:Modify*
elasticloadbalancing:Delete*
ec2:AuthorizeSecurityGroup*
ec2:RevokeSecurityGroup*
ec2:Create*
ec2:Modify*
ec2:Delete*
```

Existing template:

```text
docs/security/aws-prod-agent-readonly-permission-set-policy.template.json
```

This template is a starting point. It must be applied by Jonat through a
human-only AWS admin session, not by an agent using admin credentials.

Before any agent AWS work:

```bash
python scripts/verify_agent_db_access_boundary.py
```

If this script reports active `mangorts-prod`, active `mangorts-dev`, static AWS
keys, or other write-enabling access, stop.

## Terraform Rules

Terraform is dangerous because it can change infrastructure and state can contain
sensitive values.

Default agent:

- May edit Terraform files.
- May run `terraform fmt`.
- May run `terraform validate` without backend access.
- Must not run prod `terraform plan` against real state unless Jonat has
  explicitly unlocked a safe, read-only path and confirmed state access is
  acceptable.
- Must not run `terraform apply`.
- Must not read prod/dev tfvars.
- Must not read prod state.

Human-only:

- `terraform apply`
- prod `terraform plan` with real backend/state
- backend configuration
- sensitive tfvars
- state inspection
- state repair
- imports
- taint/untaint
- resource replacement

If Terraform output ever prints a secret to terminal, rotate that secret.

## Database Rules

Dev and prod database access for agents must be strict read-only.

Default agent state:

```text
No direct DB access.
No DB writer password.
No DB connection string.
No DBeaver writer/admin profile.
No migration/schema-apply path.
```

Required DB roles in each environment:

```text
mangorts_app       -- backend app writer role; human/app only; never agent
mangorts_readonly  -- agent/human read-only inspection role
```

The read-only role must have:

```text
CONNECT on database mangorts
USAGE on schema public
SELECT on all current tables
SELECT on all current sequences if needed for inspection
SELECT on future tables by default privileges
SELECT on future sequences by default privileges if needed
default_transaction_read_only = on
statement_timeout set to a reasonable limit
idle_in_transaction_session_timeout set to a reasonable limit
```

The read-only role must not have:

```text
INSERT
UPDATE
DELETE
TRUNCATE
CREATE
ALTER
DROP
REFERENCES unless specifically needed
TRIGGER
TEMP if not needed
superuser
createdb
createrole
replication
bypassrls
```

Agent DB access must be unlocked by Jonat using only read-only credentials.

Acceptable read-only paths:

- A read-only DBeaver connection in an agent-safe profile.
- A read-only `psql` connection using `mangorts_readonly`.
- A read-only tunnel to private prod DB that cannot use writer credentials.
- A short-lived read-only credential provided through a safe temporary channel.

Forbidden paths:

- Writer/admin DB password.
- `mangorts_app` password.
- Full password-bearing writer connection strings.
- Direct prod SQL through writer/admin role.
- Migration tools against prod from agent sessions.
- Schema apply tools against prod from agent sessions.
- One-off ECS/Fargate tasks that inherit backend writer secrets.
- `aws secretsmanager get-secret-value` for DB writer/app/provider secrets.

Prod DB must remain private. Do not make prod RDS public for DBeaver or agent
convenience.

Dev DB may currently be public, but public PostgreSQL must be tightly scoped by
security group to Jonat's trusted IP or narrow ranges, require SSL, and avoid
production data.

## DBeaver Rules

Human DBeaver writer/admin:

- Human-only profile.
- Human-only password manager.
- Prefer manual password entry.
- Private tunnel for prod.
- Not accessible to agents.

Agent DBeaver:

- Read-only credentials only.
- No saved writer passwords.
- No access to human DBeaver workspace/profile.
- No access to human password manager.

If a writer DBeaver password is saved in the same Windows profile that the agent
can operate, that password is not protected from the agent.

## GitHub Rules

GitHub must be password/gate protected so agents cannot directly damage `main` or
deploy prod.

Default agent state:

```text
No GitHub admin token.
No repo settings access.
No environment secrets access.
No direct push to main.
No ability to merge PRs into main.
No ability to approve production deployments.
```

Agent may be allowed:

- Read repository metadata.
- Push feature branches.
- Open PRs.
- Comment on issues/PRs.
- Read CI status.

Agent must not be allowed:

- Push to `main`.
- Force push protected branches.
- Delete protected branches.
- Change branch protection or rulesets.
- Change repository settings.
- Change GitHub Actions secrets.
- Change GitHub environments.
- Approve production deployments.
- Disable CI.
- Modify deploy keys/tokens.
- Merge PRs unless Jonat explicitly designs a bot workflow for that later.

Required GitHub `main` protections:

- Require pull request before merge.
- Require status checks before merge.
- Require branch to be up to date before merge if practical.
- Require review from Jonat or CODEOWNER.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution.
- Restrict who can push to `main`.
- Disallow force pushes.
- Disallow deletions.
- Apply rules to administrators or disallow bypass, if available.
- Prevent unreviewed changes to workflow/deploy/security-sensitive files.

Recommended CODEOWNERS-sensitive paths:

```text
.github/**
infra/**
backend/db/**
scripts/**
docs/security/**
docs/important tasks/*permission*
AGENTS.md
```

GitHub auth model:

- Jonat's personal GitHub credentials stay human-only.
- Agent uses no GitHub auth by default, or a low-privilege bot/token.
- Any bot/token must be unable to bypass protected branch rules.
- Do not store GitHub tokens in agent-readable files.

## GitHub Actions And Production Deploys

Production deploys must be protected by GitHub Environment approval.

Required `production` environment:

- Required reviewer: Jonat.
- Prevent self-review if available.
- Disallow admin bypass if available.
- Limit deployment branches/tags to the intended production ref, usually `main`.
- Store production secrets only in the environment.
- Ensure secrets are unavailable until environment protection rules pass.

Production AWS OIDC role:

- Trust only GitHub Actions for the correct repository.
- Trust only the `production` environment and/or intended branch.
- Must not be assumable from random branches or PRs.
- Should not be available to local agents.

Agent can prepare a deploy PR or workflow dispatch input. Agent cannot approve
the `production` environment gate.

## MangoRTS Application Access

Prod app access is different from AWS/DB access.

An AI agent may have a real MangoRTS application user account if Jonat wants it.
That account may interact with the product through the same app/API paths as a
normal user.

The agent app account must be:

- Tenant-scoped.
- Audited.
- Easy to disable.
- Rate-limited if practical.
- Not a DB user.
- Not an AWS user.
- Not a Cognito admin.
- Not a GitHub deploy identity.

Allowed app capabilities can include ordinary non-destructive product actions
that Jonat approves.

Forbidden app capabilities by default:

- Hard delete.
- Bulk delete.
- Workspace/company deletion.
- User removal.
- Membership/admin changes.
- Billing/security/integration settings.
- Nylas/provider credential management for other users.
- Secrets access.
- System admin endpoints.
- Cross-tenant access.

Product rule:

```text
The AI can be a MangoRTS user. It cannot be a MangoRTS owner/admin with
destructive powers by default.
```

## Provider Dashboard Rules

Provider dashboards are human-only unless a separate read-only agent role exists.

Human-only by default:

- AWS root and AWS Organizations management account.
- Route 53 Domains / registrar.
- GitHub owner/admin settings.
- Nylas dashboard.
- Google Cloud / Google OAuth.
- Microsoft/Azure app registration.
- SES/email provider.
- Domain/DNS provider.
- Password manager.
- Payment/billing dashboards.

Agent must not have:

- Saved browser sessions to these dashboards.
- Provider API keys.
- OAuth client secrets.
- Webhook secrets.
- Recovery codes.
- MFA codes.
- Passkeys.
- Root passwords.

## Logs And Observability

Logs can contain sensitive values.

Agent log access is read-only only and must be explicitly unlocked.

Rules:

- Prefer scoped CloudWatch log queries.
- Do not dump broad logs into chat/docs.
- Do not record tokens, cookies, passwords, API keys, authorization headers, or
  customer data.
- If a secret appears in logs or terminal output, rotate it.
- CloudWatch read permissions must not include mutation permissions.

## Docker, ECR, And Images

Agent default:

- May build local images only when needed for dev.
- Must not push prod images.
- Must not use prod ECR auth by default.
- Must not change prod task definitions or services.

Human-only or GitHub protected deploy:

- Prod ECR push.
- Prod ECS task definition registration.
- Prod ECS service update.
- One-off prod ECS tasks.

## Local OS And Tooling Rules

Default agents should not be able to silently change the laptop's trust boundary.

Human approval and separate OS permissions are needed for:

- Installing system software.
- Uninstalling software.
- Changing firewall rules.
- Changing Windows Defender/security settings.
- Changing registry settings.
- Changing scheduled tasks.
- Changing startup services.
- Changing PATH or global tool configuration.
- Installing credential helpers.
- Changing Git credential storage.
- Changing SSH agent configuration.
- Changing browser profiles/extensions.
- Changing DBeaver global settings.

## Direct Permission Protocol

When Jonat wants an agent to use a sensitive read-only capability, use this
pattern:

1. Jonat decides the exact capability to unlock.
2. Jonat unlocks only the read-only identity, not admin.
3. The agent runs the verifier before use.
4. The agent states the exact commands it will run.
5. The agent runs only read-only commands.
6. The agent summarizes results without secrets.
7. Jonat closes the session, logs out, or lets the short session expire.

AWS example:

```text
Unlock mangorts-prod-agent-readonly, not mangorts-prod.
Verify sts identity shows the read-only role.
Run read-only describe/list/log commands only.
Do not read Secrets Manager.
Do not run ECS tasks.
Do not run Terraform apply.
```

DB example:

```text
Unlock mangorts_readonly, not mangorts_app.
Run SELECT-only queries.
Write attempts must fail.
Close the tunnel/session afterward.
```

GitHub example:

```text
Agent opens PR.
Checks pass.
Jonat reviews in GitHub.
Jonat merges if appropriate.
Jonat approves production environment deployment if appropriate.
```

## Existing MangoRTS Security Files

Read these together with this document:

```text
AGENTS.md
docs/security/database-agent-access-contract.md
docs/security/aws-prod-agent-readonly-permission-set-policy.template.json
scripts/verify_agent_db_access_boundary.py
docs/important tasks/prod launch next-agent handoff prompt.md
```

This document is the broader V1 permission-security plan. The DB contract is the
detailed DB/AWS boundary contract. The AWS policy template is the starting point
for the prod read-only agent permission set.

## Current Implementation Status

Already started:

- Root `AGENTS.md` says agent DB access boundaries are physical, not trust-based.
- `docs/security/database-agent-access-contract.md` exists.
- `scripts/verify_agent_db_access_boundary.py` exists.
- `docs/security/aws-prod-agent-readonly-permission-set-policy.template.json`
  exists.
- Prod first-admin bootstrap is complete and cleanup was applied.
- Prod DB schema-only apply is complete.
- Nylas prod prep is partial and should not continue with provider secrets until
  the agent boundary is real.

Still required:

- Create a separate Windows agent user or VM.
- Move/protect human-only tfvars and backend config outside the agent profile.
- Remove human/admin AWS SSO profiles from the agent profile.
- Create AWS IAM Identity Center permission sets:
  - `mangorts-prod-agent-readonly`
  - `mangorts-dev-agent-readonly`
- Assign agent sessions only to read-only AWS profiles.
- Verify read-only AWS can describe allowed resources.
- Verify read-only AWS cannot access Secrets Manager.
- Verify read-only AWS cannot run ECS tasks or mutate infrastructure.
- Create dev/prod `mangorts_readonly` DB roles.
- Store read-only DB credentials separately from writer credentials.
- Keep DBeaver writer/admin in a human-only profile.
- Configure GitHub `main` branch protection/rulesets.
- Configure CODEOWNERS for sensitive paths.
- Configure GitHub `production` environment required reviewer protection.
- Remove GitHub admin auth from agent profile.
- Decide whether agent may push feature branches or only prepare local patches.
- Create limited MangoRTS app user/role for AI-agent product interaction.
- Verify no human-only browser sessions/password manager data are available in
  the agent profile.

## Acceptance Tests

The boundary is not done until these are true.

AWS:

- Default agent has no AWS identity.
- `python scripts/verify_agent_db_access_boundary.py` passes.
- `aws sts get-caller-identity --profile mangorts-prod` fails from agent profile.
- `aws sts get-caller-identity --profile mangorts-prod-agent-readonly` works only
  after Jonat unlocks SSO.
- `aws secretsmanager list-secrets` fails for the agent read-only profile.
- `aws secretsmanager get-secret-value` fails for the agent read-only profile.
- `aws ecs run-task` fails for the agent read-only profile.
- `aws ecs update-service` fails for the agent read-only profile.
- RDS/Route53/CloudFront/Cognito mutation commands fail for the agent read-only
  profile.

Database:

- Agent cannot access DB by default.
- Agent cannot access writer/admin DB credentials.
- Agent read-only DB login can run `SELECT`.
- Agent read-only DB login cannot `INSERT`.
- Agent read-only DB login cannot `UPDATE`.
- Agent read-only DB login cannot `DELETE`.
- Agent read-only DB login cannot `TRUNCATE`.
- Agent read-only DB login cannot `CREATE`, `ALTER`, or `DROP`.
- Prod DB remains private.
- DBeaver writer/admin profile is not accessible from the agent profile.

GitHub:

- Agent cannot push directly to `main`.
- Agent cannot force push `main`.
- Agent cannot delete `main`.
- Agent cannot merge PRs without Jonat's protected review path.
- Agent cannot change repo settings, branch protections, rulesets, environments,
  Actions secrets, or deploy keys.
- Production deploy waits for Jonat's GitHub environment approval.
- Production secrets are unavailable before environment approval.

Laptop:

- Agent profile cannot read human-only tfvars.
- Agent profile cannot read human `.aws` admin cache.
- Agent profile cannot access human password manager.
- Agent profile cannot access human DBeaver writer passwords.
- Agent profile cannot access human browser sessions for AWS/GitHub/provider
  dashboards.

MangoRTS app:

- Agent app account exists only if intentionally created.
- Agent app account has no delete/destructive powers by default.
- Agent app actions are audited.
- Agent app account can be disabled quickly.

## Immediate Next Steps

1. Treat this document as the V1 permission-security source of truth.
2. Create a separate Windows agent user or VM.
3. Move human-only local secrets out of the shared agent workspace/profile.
4. Create and assign AWS `mangorts-prod-agent-readonly`.
5. Create and assign AWS `mangorts-dev-agent-readonly`.
6. Create dev/prod DB read-only roles.
7. Configure GitHub branch protections and production environment approval.
8. Update the agent verifier to also check GitHub auth, tfvars placement, and
   obvious DBeaver/password-manager exposure.
9. Continue Nylas/prod work only after this boundary is mechanically enforced.

## Final Rule

Agents can be powerful helpers inside a sandbox.

They must not hold the keys to production.

