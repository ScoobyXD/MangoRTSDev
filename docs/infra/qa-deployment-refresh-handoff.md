# QA deployment refresh handoff

On 2026-09-10, Jonathan confirmed that he is the administrator, saved the supplied policy, and authorized deployment to continue. The fresh deployment failed before maintenance: [Actions run 34519274923](https://github.com/ScoobyXD/MangoRTSDev/actions/runs/34519274923), GitHub deployment `6379254722`, dispatched at 19:15:05 UTC for current remote `main`, `d92b1c6872fd8805a59dd4d24a9840a205da9fbe`. QA remains healthy on its old revision. A recovery-image lookup fix is prepared locally; explicit main integration and push approval are required before a new main deployment can use it. Jonathan subsequently supplied the Arch dashboard URL, and authenticated access works. Its latest visible run predates this deployment attempt; the deployment-trigger binding remains unverified.

## Verified state before the new deployment

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

## Fresh deployment result and code fix

The new run passed backend tests, Terraform validation, image builds, the frontend build, and QA release/recovery contract tests. Its ECS migration-plan task `0759e1cd9eb24eb899420f7de370affa`, task definition `mangorts-qa-database-migration:27`, exited successfully with code 0. The workflow then failed at 19:23:42 UTC with `Required recovery image is unavailable`; GitHub recorded failure at 19:23:46 UTC. The failure occurred during recovery-artifact capture, before maintenance, migration execution, or application rollout. The public frontend and backend still reported `a30cd0157f51389827924724fa7ad3aa1fef589b`, and `/healthz` returned `ok: true`.

The image was present. A read-only ECR lookup for backend digest `sha256:e4fea17564c83b232c36c4c6cb0c63a1d65c0d312b0d1d884b43d7fc2b298fd0` returned two entries with identical digests, manifests and media types, and no failures. Their tags were `a30cd0157f51389827924724fa7ad3aa1fef589b` and `qa-recovery-20260909045327849-1605cafee4a2-0`. The current code rejected this valid response because it required exactly one entry.

The local fix in `scripts/qa_release_aws.mjs` accepts nonempty matching entries and publishes one recovery tag. It still rejects lookup failures, missing images, differing digests/manifests/media types, and an unconfirmed published digest. No image was deleted, retagged manually, rebuilt as a substitute, or skipped to bypass the recovery check.

The regression test reproduced the failure before the fix. All 83 QA release, AWS, storage and environment tests passed afterward, including rejection of conflicting image entries. Deployment laws 35-36 document the required behavior. Independent diff review found no issues.

The agent-readonly SSO profile also lacked QA ECR access. Follow-up metadata reads used the existing `mangorts-dev` SSO profile in account `686458136219`, without retrieving database credentials or secret values. IAM simulation returned `allowed` for both the deployment role's `ecr:BatchGetImage` permission on the QA repository and its new `rds:DescribeDBInstanceAutomatedBackups` permission on the regional automated-backup ARN.

The failed commit has only GitHub Actions checks and no commit statuses exposing Arch. No successful deployment or Arch run is claimed. Do not rerun the unchanged failed workflow; first integrate the reviewed local fix into remote `main` after the required explicit authorization, then resolve current `main` and dispatch a fresh run.

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

The available `mangorts-dev-agent-readonly` SSO profile authenticated to account `686458136219`, but AWS denied both `iam:ListAttachedRolePolicies` and `iam:ListRolePolicies` on the deploy role. The agent could not independently inspect the live policy. Jonathan subsequently supplied its existing JSON and confirmed saving the corrected policy as administrator. The agent did not apply IAM changes or run a local Terraform plan/apply.

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

## Arch access and baseline

Jonathan supplied the existing [MangoRTS Arch session](https://arch.foothill.sh/?appId=dbe123fe-8943-4985-945d-11e4cd0175ed&sessionId=4a8eda4f-bd41-4fb6-93cd-752dcf2249d3). Authenticated browser inspection confirmed recorder app `mangorts`, application ID `dbe123fe-8943-4985-945d-11e4cd0175ed`, and session ID `4a8eda4f-bd41-4fb6-93cd-752dcf2249d3`. The session menu shows 28 runs.

The newest visible entry is [run 9a3dbf34-09a2-4ad9-ae1c-8e31940698d1](https://arch.foothill.sh/?appId=dbe123fe-8943-4985-945d-11e4cd0175ed&sessionId=4a8eda4f-bd41-4fb6-93cd-752dcf2249d3&goalQaRunId=9a3dbf34-09a2-4ad9-ae1c-8e31940698d1), displayed as September 8, 2026, 8:16 PM, with `Goals completed` and `history completed`. These statuses do not mean all journey assertions passed. The all-runs view reports 7 of 26 active journeys passed, 19 failed, and 28 open issues. These are existing results, not results from the pending deployment. No newer run was visible on September 10.

The inspected Inbox, Journeys, app, session, run-history and account controls expose no deployment-trigger configuration or commit/deployment linkage. No Arch trigger configuration was found in the tracked repository, the GitHub repository webhooks list was empty, and the relevant commits exposed only GitHub Actions checks and no commit statuses. This does not rule out a GitHub App-owned Arch integration. The current GitHub user authentication could not inspect the repository's app installation endpoint, which requires app authentication; no credentials were retrieved to bypass that limit. After a successful QA deployment, require a new Arch run and evidence tying it to the exact deployment and commit before claiming trigger verification. No Arch run, fixture change, integration change or schedule was created manually.

The original handoff reports a daily 7:30 PM Pacific schedule in Rohan's local Codex app. This task did not inspect, transfer, modify or duplicate that schedule. Coordinate with its owner before creating any other schedule.

## Local verification and scope

- `terraform fmt -check infra/aws-qa/release_iam.tf`: passed.
- `node --test --test-isolation=none infra/tests/qa_environment.test.mjs infra/tests/qa_release_storage.test.mjs`: 37 passed, zero failed; offline checks only.
- `git diff --check`: passed.
- After the live failure, `node --test --test-isolation=none infra/tests/qa_release.test.mjs infra/tests/qa_release_aws.test.mjs infra/tests/qa_release_storage.test.mjs infra/tests/qa_environment.test.mjs`: 83 passed, zero failed.
- Local changes cover the isolated IAM statement, recovery-image response validation, its regression tests, deployment laws and this handoff. No application backend code, migration, schema, workflow or schedule changed. No new abstraction or automation was added.
- The new QA deployment was dispatched after administrator confirmation through the existing workflow, including its authorized ECS migration and coordinated recovery path. No direct database write, repair SQL, local cloud mutation, merge, push or pull request was performed.
