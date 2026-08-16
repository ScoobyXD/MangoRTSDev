# MangoRTS Auth

MangoRTS uses Amazon Cognito for authentication and Mango-owned PostgreSQL tables for company authorization.

## Onboarding Flow

The frontend uses custom React pages, Cognito Identity Provider API calls for sign-in, Nylas Hosted OAuth for Google mailbox access, and Cognito password resets:

1. Dev admin, company admin, or company manager creates an invitation in Mango. Company managers can invite users and managers; only dev admins and company admins can invite company admins.
2. The backend stores a hashed Mango invitation token, creates or reissues the Cognito user with `AdminCreateUser`, and records Cognito status on the invitation.
3. Mango sends its own SES invitation email with `/accept-invite?token=...`. The email includes the Mango invite token link, not a temporary password.
4. The user opens the Mango invite link, enters their email, full name, and new password, and accepts the Mango invitation.
5. Mango links the Cognito subject to `users`, writes `company_memberships`, marks the invitation accepted, and sends a signup confirmation email when `MANGORTS_EMAIL_FROM` is configured.
6. After acceptance, the frontend sends the user to Connect Google. Mango starts Nylas Hosted OAuth with the user's email as the login hint.
7. The user approves Google access. Nylas creates a grant, Mango stores the Nylas `grant_id` in `user_email_connections`, and the user lands in the app.

The app does not use Cognito Managed Login / Hosted UI. Local development keeps auth disabled unless `VITE_AUTH_MODE=cognito` is set.

## Bootstrap Dev Admin Flow

The first dev admin is not created through the normal company invitation flow, because no Mango admin exists yet.

1. Create the first Cognito user from AWS Console or CLI.
2. Set `MANGORTS_BOOTSTRAP_DEV_ADMIN_EMAILS` to that email for the first backend deploy, or seed `company_memberships` with `backend/db/seed_dev_auth_membership.sql`.
3. The user signs in with the Cognito temporary password.
4. If Cognito returns `NEW_PASSWORD_REQUIRED`, the frontend sends the user to `/complete-account` to set a permanent password without requiring a Mango invite token.
5. On the first authenticated backend request, an allowlisted bootstrap email with no memberships is granted `dev_admin` against a bootstrap company.
6. Remove `MANGORTS_BOOTSTRAP_DEV_ADMIN_EMAILS` after the first dev admin can invite other users through Settings.

## Admin Visibility

Settings includes onboarding status for each company user or pending invitation:

- invitation state: invited, accepted, or replaced by a newer invitation
- Cognito user status: not configured, created, resent, existing Mango user, or failed
- Mango invitation email status: sent, failed, or not configured
- Google status: not connected, connected, or reauth required when Nylas detects an invalid or expired grant

The admin invite action is still only email + role. The invite token is not part of the normal admin workflow; the backend may return it for dev/test fallback, but the UI does not ask admins to copy it.

## Login Flow

Authenticated requests send a Cognito bearer token to the backend:

1. The user signs in with Cognito email and password.
2. Cognito completes any `NEW_PASSWORD_REQUIRED` challenge and issues tokens.
3. The backend validates each request and loads Mango memberships from PostgreSQL.

Password resets use Cognito `ForgotPassword` and `ConfirmForgotPassword`. Mango's public `/v1/password-resets/request` endpoint only verifies that the email belongs to a Mango user before the frontend asks Cognito to send the reset code. Cognito owns reset-code delivery and its one-hour code lifetime.

## Google/Nylas Notes

Google Audience test users are only a development/testing allowlist for the Google OAuth app. Adding an email there does not create a Nylas grant. A grant is created only after the invited user completes Google approval through Nylas Hosted OAuth.

While the Google app is in Testing mode, add invited Google accounts to Google Audience test users before asking them to connect Google.

## Local Cognito Backend

Use `scripts/start_local_cognito_backend.ps1` when running the local API against the dev Cognito pool and dev Postgres:

```powershell
aws sso login --profile <profile>
.\scripts\start_local_cognito_backend.ps1 -AwsProfile <profile> -StopExisting
```

The script exports short-lived AWS credentials from the selected AWS CLI profile into `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` before launching the Go backend. This is required because the backend signs Cognito admin, SES email, and SQS calls from process environment credentials. The active AWS identity must be allowed to call `cognito-idp:AdminCreateUser`, `cognito-idp:AdminSetUserPassword`, `cognito-idp:AdminGetUser`, `cognito-idp:AdminDeleteUser`, `ses:SendEmail`, `ecs:ListTaskDefinitions`, `ecs:DescribeTaskDefinition`, and `sqs:SendMessage` for the configured DEV resources.

The script reads `MANGORTS_EMAIL_WORK_QUEUE_URL` from the deployed DEV API task definition and exports that exact URL to the local API. The existing private DEV email worker consumes the queued work; the script does not start a second local worker and never requires a copied queue URL. Startup stops with a clear error when AWS SSO or ECS access is unavailable or the deployed DEV task has no email queue.

For local invitation emails, the script also exports:

- `MANGORTS_APP_URL`: defaults to the local frontend origin, usually `http://localhost:5173`, so invite links point at local `/accept-invite`.
- `MANGORTS_EMAIL_FROM`: resolved from `-EmailFrom`, the current shell, `scripts/start_local_cognito_backend.local.ps1` via `$MangoLocalEmailFrom`, `infra/aws-dev/terraform.tfvars` `email_from_address`, or the deployed backend task definition.

Override the sender directly when needed:

```powershell
.\scripts\start_local_cognito_backend.ps1 -AwsProfile mangorts-dev -StopExisting -EmailFrom "verified-sender@example.com"
```

To send invite links that open the public dev frontend while the backend runs locally, override `-AppURL` as well.

## Backend Enforcement

The backend enables auth only when `AUTH_MODE=cognito`.

- `/healthz` stays public for load balancer health checks.
- `/v1/*` requires a valid Cognito access or ID token when auth is enabled, except public invitation validation/acceptance and password-reset eligibility checks.
- The backend validates issuer, client ID, token use, expiry, and RS256 signature through the Cognito JWKS.
- The backend upserts the authenticated Cognito subject into `users`.
- Memberships are loaded once per request into an actor context.
- `dev_admin` can access all companies.
- `dev_admin` can list/search companies through bounded `GET /v1/companies?query=<text>&limit=<n>` for Settings scope selection and invite targeting.
- Company-scoped routes require company membership or `dev_admin`.
- `company_admin` manages users inside their company and bypasses company resource permissions.
- `company_manager` manages users, user groups, and permission settings for resources they can edit, but does not bypass resource permissions.
- `company_user` follows resource permissions and cannot manage invitations, user groups, or permission settings.
- Company invitations can be created by `dev_admin`, `company_admin`, or `company_manager`; managers can invite `company_user` and `company_manager`, while only dev admins and company admins can invite `company_admin`.
- Creating a new pending invitation for the same company and email revokes older pending invitations, so only the latest token can be accepted.
- Mango-owned invitation delivery is tracked independently from Cognito user creation, so admins can see when Cognito succeeded but SES invite delivery failed.

## Tables

- `users`: maps Cognito `sub` values to internal user IDs.
- `companies`: stores tenant/company rows.
- `company_memberships`: Mango authorization roles: `dev_admin`, `company_admin`, `company_manager`, `company_user`.
- `invitations`: company-scoped pending/accepted invite tokens; only token hashes are stored. It also tracks Cognito creation and Mango invitation email delivery status.
- `user_email_connections`: one Nylas mailbox grant per Mango user, including provider, account email, grant ID, and connection status.

## Frontend Env

- `VITE_AUTH_MODE=cognito`
- `VITE_COGNITO_REGION`
- `VITE_COGNITO_USER_POOL_ID`
- `VITE_COGNITO_CLIENT_ID`
- `VITE_API_BASE_URL`

## Backend Email Env

- `MANGORTS_APP_URL`: frontend base URL used to build `/accept-invite?token=...` links.
- `MANGORTS_EMAIL_FROM`: verified SES sender address for invitation and signup confirmation emails.
- `MANGORTS_BOOTSTRAP_DEV_ADMIN_EMAILS`: optional comma- or space-separated first-admin allowlist. Use only for initial bootstrap, then clear it.
- `MANGORTS_BOOTSTRAP_DEV_COMPANY_NAME`: optional company name for the temporary bootstrap company.

Tokens are kept in `sessionStorage` for this MVP. This avoids persistent local storage, but a future secure cookie/session layer is still the preferred production hardening path.
