# MangoRTS Prod DB Tunnel

This document explains the optional human-only DBeaver access path for the
private MangoRTS production database.

## Why This Exists

The production app does not need this tunnel.

Production traffic already works like this:

```text
Browser
  -> CloudFront / ALB
  -> ECS Fargate backend task inside the prod VPC
  -> private Aurora PostgreSQL database
```

Jonat's laptop is not inside the prod VPC, and the prod database must not be made
public just so DBeaver can connect. The tunnel gives Jonat a private admin path:

```text
DBeaver on Jonat's laptop
  -> localhost:15432
  -> AWS Systems Manager Session Manager tunnel
  -> tiny private EC2 managed node in the prod VPC
  -> prod Aurora PostgreSQL:5432
```

The EC2 instance is not an app server. It is only a managed SSM tunnel target.

## Security Rules

- Human-only.
- Do not use this from Codex, Claude, OpenCode, or other agent sessions.
- Do not save the prod writer password in an agent-accessible DBeaver profile.
- Do not make prod RDS public.
- Do not add public SSH.
- Do not add a key pair unless there is a separate, explicit reason.
- Do not store the DB password on the tunnel instance.
- Keep DBeaver `Save password` unchecked unless Jonat has a human-only password
  storage policy.
- Agents may help prepare Terraform/docs, but Jonat must unlock and operate the
  human-admin AWS/DB path.

## Terraform Resources

The optional tunnel is defined in:

```text
infra/aws-prod/db_tunnel.tf
```

It is disabled by default:

```hcl
enable_db_tunnel_host = false
```

When enabled, Terraform creates:

- A tiny private EC2 instance.
- An IAM role and instance profile for SSM.
- An attachment to `AmazonSSMManagedInstanceCore`.
- A security group with no inbound rules.
- Egress for SSM HTTPS.
- Egress from the tunnel host to the prod DB on `5432`.
- Ingress on the existing prod DB security group from the tunnel host security
  group on `5432`.
- Outputs with the instance ID and a PowerShell `aws ssm start-session` command.

## Enable The Tunnel Host

In Jonat's human-admin local `infra/aws-prod/terraform.tfvars`, set:

```hcl
enable_db_tunnel_host  = true
db_tunnel_instance_type = "t3.nano"
db_tunnel_subnet_id    = ""
db_tunnel_local_port   = 15432
```

Leaving `db_tunnel_subnet_id` empty uses the first private subnet used by the ECS
backend. Set it only if Jonat wants to force a specific private subnet.

## Plan And Apply

Run this from a human-admin PowerShell session, not from an agent session:

```powershell
aws sso login --profile mangorts-prod

$env:AWS_PROFILE = "mangorts-prod"
$env:AWS_SDK_LOAD_CONFIG = "1"

terraform -chdir=infra/aws-prod plan -out=tfplan -input=false -no-color
```

Review the plan before applying.

Expected new resources when this is the only intended change:

```text
aws_iam_role.db_tunnel[0]
aws_iam_role_policy_attachment.db_tunnel_ssm[0]
aws_iam_instance_profile.db_tunnel[0]
aws_security_group.db_tunnel[0]
aws_security_group_rule.db_tunnel_https_egress[0]
aws_security_group_rule.db_tunnel_to_existing_db_egress[0]
aws_security_group_rule.db_tunnel_to_existing_db_ingress[0]
aws_instance.db_tunnel[0]
```

If the full plan includes unrelated CloudFront/S3/production drift, do not apply
it casually. Either stop and review the drift, or create a scoped plan for the DB
tunnel resources only.

After Jonat approves the reviewed plan:

```powershell
terraform -chdir=infra/aws-prod apply -input=false -no-color tfplan
```

## Confirm SSM Sees The Instance

After apply, wait a minute or two for the SSM agent to register, then run:

```powershell
aws ssm describe-instance-information `
  --profile mangorts-prod `
  --region us-west-1 `
  --query "InstanceInformationList[].{InstanceId:InstanceId,Name:ComputerName,PingStatus:PingStatus,Platform:PlatformName,IPAddress:IPAddress}" `
  --output table
```

Look for the `mangorts-prod-db-tunnel` instance ID and `PingStatus = Online`.

Terraform also outputs:

```text
db_tunnel_instance_id
db_tunnel_start_session_command_powershell
```

## Start The Tunnel

In a human-admin PowerShell terminal, run the Terraform output command, or use
this shape with the real instance ID:

```powershell
aws ssm start-session `
  --profile mangorts-prod `
  --region us-west-1 `
  --target i-REPLACE_WITH_REAL_INSTANCE_ID `
  --document-name AWS-StartPortForwardingSessionToRemoteHost `
  --parameters host="<prod-rds-writer-endpoint>",portNumber="5432",localPortNumber="15432"
```

Keep this terminal open while DBeaver is connected.

The tunnel is active when `localhost:15432` is listening.

## DBeaver Settings

Use these DBeaver settings:

```text
Host: localhost
Port: 15432
Database: mangorts
Authentication: Username/password
Username: mangorts_app
Password: enter manually from human-only AWS Secrets Manager/password manager path
Save password: unchecked
SSL mode: require
```

Do not use local port `5432` for prod DBeaver on Jonat's laptop. A local
PostgreSQL process may already be listening there.

## Stop The Tunnel

When done:

- Disconnect DBeaver.
- Press `Ctrl+C` in the PowerShell terminal running `aws ssm start-session`.
- Confirm DBeaver no longer connects to `localhost:15432`.

## Troubleshooting

If DBeaver says:

```text
Connection to localhost:15432 refused
```

Then the local SSM tunnel is not running or not listening on `15432`.

If `describe-instance-information` returns nothing:

- The tunnel host has not been created yet, or
- the SSM agent is not online, or
- the instance has no outbound SSM connectivity, or
- the human AWS profile is pointed at the wrong account/region.

If the SSM session starts but DBeaver cannot connect:

- Confirm DBeaver uses `localhost:15432`.
- Confirm SSL mode is `require`.
- Confirm the DB security group ingress from the tunnel host SG exists.
- Confirm the tunnel host can resolve and reach the RDS endpoint.
- Confirm the password was copied from the human-only Secrets Manager path
  without sharing it in chat/docs/screenshots.

## Agent Boundary

This tunnel exists for Jonat's human DBeaver access. It does not create an agent
DB write path.

Agents must not:

- operate Jonat's DBeaver writer connection,
- retrieve the DB password,
- start SSM sessions using human-admin AWS credentials,
- run SQL through the writer/admin role,
- run one-off ECS tasks to bypass the database boundary.

For the broader policy, read:

```text
docs/important tasks/v1 permission security.md
docs/security/database-agent-access-contract.md
```

