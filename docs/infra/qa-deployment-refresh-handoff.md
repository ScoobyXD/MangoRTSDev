# QA deployment refresh handoff

Checked on 2026-09-10 at 18:52 UTC. Status: waiting for the administrator's IAM review/application confirmation; no new deployment dispatched.

## Verified state

| Item | Evidence |
| --- | --- |
| Current remote `main` | `d92b1c6872fd8805a59dd4d24a9840a205da9fbe` |
| QA frontend revision | `a30cd0157f51389827924724fa7ad3aa1fef589b` from [deploy-info.json](https://qa.mangorts.com/deploy-info.json), HTTP 200 |
| QA backend revision | `a30cd0157f51389827924724fa7ad3aa1fef589b` from [healthz](https://qa.mangorts.com/healthz), HTTP 200, `ok: true`, environment `qa`, Cognito authentication |
| QA home | [qa.mangorts.com](https://qa.mangorts.com), HTTP 200 |
| Last actual QA deployment attempt | Deployment `6342736484`, commit `1605cafee4a219c2e489959036bd43d699fbe474`, failed in [Actions run 34311461177](https://github.com/ScoobyXD/MangoRTSDev/actions/runs/34311461177) |
| Last successful QA deployment | Deployment `6271625934`, [Actions run 33912686105](https://github.com/ScoobyXD/MangoRTSDev/actions/runs/33912686105), 2026-09-04 at 19:50 UTC |

The failed deployment log at 2026-09-09T05:00:01Z reports that `mangorts-qa-github-deploy` lacks `rds:DescribeDBInstanceAutomatedBackups` on `arn:aws:rds:us-west-1:686458136219:auto-backup:*`. Later successful diagnostic workflow runs are not evidence of a successful application deployment.

The originating handoff says migration-history reconciliation and recovery-image retention repairs were already applied. Do not rerun their repair SQL or diagnostic jobs. No database access or repair was performed in this task.

## Exact permission for administrator review

The only Terraform permission change is the isolated insertion from [commit 1c9c3c9f5e76a117a685d711867b2e05189c0ded](https://github.com/ScoobyXD/MangoRTSDev/commit/1c9c3c9f5e76a117a685d711867b2e05189c0ded), prepared in [release_iam.tf](../../infra/aws-qa/release_iam.tf) with a shorter new statement ID. None of the diagnostic branch's other changes were included. The permission was absent from remote `main` when checked.

The administrator subsequently supplied the current policy JSON. Adding the original statement ID would produce 6,154 non-whitespace characters, exceeding [IAM's 6,144-character managed-policy limit](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html). Using `ReadBackupMetadata` produces 6,137 characters while preserving all 22 existing statements exactly. This label change does not alter permissions. Use the shorter ID in both the console and Terraform.

The added statement resolves to:

```json
{
  "Sid": "ReadBackupMetadata",
  "Effect": "Allow",
  "Action": "rds:DescribeDBInstanceAutomatedBackups",
  "Resource": "arn:aws:rds:us-west-1:686458136219:auto-backup:*"
}
```

This is one statement to add to the existing policy, not a replacement policy document. Its managed policy is `arn:aws:iam::686458136219:policy/mangorts-qa-github-deploy-release`, Terraform resource `aws_iam_policy.qa_release`, attached to role `mangorts-qa-github-deploy`.

The wildcard permits reading automated-backup metadata for **all backups in this account and region**, including non-QA backups. It adds no database-content access, secret retrieval, writes, restore actions, or IAM administration. The release coordinator still filters the request by the active QA database resource ID and validates the returned database identity. [AWS's RDS authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_rds.html) lists `auto-backup` and `db` as supported resource types for this action.

The repository owner should review only this isolated fix. An AWS administrator must review and apply the policy change through the existing local SSO foundation process in account `686458136219`, region `us-west-1`, using QA's state key `mangorts/qa/terraform.tfstate`. The reviewed plan should change only `aws_iam_policy.qa_release`; do not apply a full foundation plan or stale bootstrap variables. Preserve all other policy statements. See [the existing foundation instructions](qa-release-recovery.md#one-time-foundation).

The available `mangorts-dev-agent-readonly` SSO profile authenticated to account `686458136219`, but AWS denied both `iam:ListAttachedRolePolicies` and `iam:ListRolePolicies` on the deploy role. Therefore this task cannot confirm whether the live permission has changed since the failed run. No IAM change or Terraform plan/apply was attempted.

## Resume after administrator confirmation

1. Record administrator confirmation that the exact permission above is applied to the QA deployment role. Do not let the deploy role grant itself permissions.
2. Read remote `main` again. The revision recorded above is a snapshot, not a permanently selected deployment target. The requested QA deployment includes that revision's pending migrations through the existing ECS runner; never retrieve its credential or invoke SQL directly.
3. Dispatch a **new** `deploy-qa.yml` run on `main`, with `stage=deploy` and that exact SHA as `expected_git_commit`. Do not rerun the old Actions run or dispatch the diagnostic branch.
4. Record the new run URL and its matching `qa` deployment ID. Require successful completion of both the workflow and deployment status.
5. Verify the public frontend and backend both report the new SHA, `/healthz` reports `ok: true`, and the site responds successfully. A healthy old revision does not complete the refresh.
6. Open the existing Arch integration and record the resulting Arch run URL/ID, its triggering deployment ID and commit. GitHub success alone is not proof that Arch launched.

Run these dispatch commands only after step 1:

```powershell
$qaExpectedCommit = gh api repos/ScoobyXD/MangoRTSDev/commits/main --jq .sha
if ($LASTEXITCODE -ne 0 -or $qaExpectedCommit -notmatch '^[0-9a-f]{40}$') {
  throw 'Could not resolve the current main commit.'
}
gh workflow run deploy-qa.yml --repo ScoobyXD/MangoRTSDev --ref main -f stage=deploy -f "expected_git_commit=$qaExpectedCommit"
if ($LASTEXITCODE -ne 0) { throw 'QA dispatch failed.' }
gh run list --repo ScoobyXD/MangoRTSDev --workflow deploy-qa.yml --branch main --commit $qaExpectedCommit --limit 5 --json databaseId,headSha,status,conclusion,createdAt,url
```

The workflow rejects a moving `main` if its checked-out SHA differs from `expected_git_commit`. If this occurs, resolve `main` again and create a new exact-revision dispatch. Select the newly created run by its creation time and SHA before monitoring it.

After that run succeeds, verify the public revision endpoints:

```powershell
$qaFrontend = Invoke-RestMethod 'https://qa.mangorts.com/deploy-info.json' -TimeoutSec 20
$qaBackend = Invoke-RestMethod 'https://qa.mangorts.com/healthz' -TimeoutSec 20
if ($qaFrontend.revision -ne $qaExpectedCommit -or
    $qaBackend.deploy_revision -ne $qaExpectedCommit -or
    $qaBackend.ok -ne $true -or
    $qaBackend.deploy_environment -ne 'qa') {
  throw 'QA health or deployed revisions do not match the requested release.'
}
```

## Missing Arch handoff

The original attachment was not provided to this task. No handoff file was found in this checkout or the diagnostic branch's tracked documentation. No existing Arch dashboard was open in the available browser session. The exact Arch project, trigger and run identifiers remain unknown.

No Arch trigger configuration was found in the tracked repository, the GitHub repository webhooks list was empty, and the relevant commits exposed only GitHub Actions checks and no commit statuses. This does not rule out a GitHub App-owned Arch integration. The current GitHub user authentication could not inspect the repository's app installation endpoint, which requires app authentication; no credentials were retrieved to bypass that limit. Obtain the original handoff or the existing Arch dashboard URL before claiming Arch verification.

The original handoff reports a daily 7:30 PM Pacific schedule in Rohan's local Codex app. This task did not inspect, transfer, modify or duplicate that schedule. Coordinate with its owner before creating any other schedule.

## Local verification and scope

- `terraform fmt -check infra/aws-qa/release_iam.tf`: passed.
- `node --test --test-isolation=none infra/tests/qa_environment.test.mjs infra/tests/qa_release_storage.test.mjs`: 37 passed, zero failed; offline checks only.
- `git diff --check`: passed.
- No application business logic, backend code, migration, schema, workflow, or schedule changed. No new abstraction or automation was added; the existing deployment workflow and tests remain the implementation.
- No deployment, live database write, cloud mutation, merge, push or pull request was performed.
