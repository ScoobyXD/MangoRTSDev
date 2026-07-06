# MangoRTS Production Nylas And Email Readiness

MangoRTS production must use separate provider configuration from dev. Do not reuse the dev Nylas application, callback URLs, webhook destination, API key, webhook secret, OAuth state secret, Google OAuth test mode setup, or SES verification state as production.

Production provider resources do not currently exist unless a human operator creates them outside this document.

## Required Production Provider Boundaries

Production requires:

- A separate Nylas application/client ID.
- A production Nylas API key stored in AWS Secrets Manager.
- A production Nylas OAuth state secret stored in AWS Secrets Manager.
- A production Nylas webhook secret stored in AWS Secrets Manager after the webhook destination is created.
- Production Hosted OAuth callback URL.
- Production frontend redirect URL.
- Production webhook URL.
- A verified SES sender or domain for Mango auth emails.
- Production DKIM, SPF, and DMARC DNS records.
- Google OAuth production readiness for Gmail scopes used through Nylas.

No provider secret value should be committed to the repo, placed in Terraform variables, or stored in local plaintext notes.

## Backend And Terraform Inputs

The backend reads Nylas settings in `backend/cmd/miraeopus-api/main.go`. The current Terraform wiring in `infra/aws-dev/ecs_alb.tf` shows the expected env vars:

- `NYLAS_CLIENT_ID`
- `NYLAS_API_BASE_URL`
- `NYLAS_REDIRECT_URI`
- `NYLAS_FRONTEND_REDIRECT_URL`
- `NYLAS_GOOGLE_SCOPES`
- `NYLAS_MICROSOFT_SCOPES`
- `NYLAS_API_KEY` from Secrets Manager
- `NYLAS_STATE_SECRET` from Secrets Manager
- `NYLAS_WEBHOOK_SECRET` from Secrets Manager

The prod Terraform inputs should pass ARNs and non-secret identifiers, following the dev variable names until a prod-specific Terraform root exists:

- `nylas_client_id`
- `nylas_api_base_url`
- `nylas_api_key_secret_arn`
- `nylas_state_secret_arn`
- `nylas_webhook_secret_arn`
- `nylas_google_scopes`
- `nylas_microsoft_scopes`

Use `https://api.us.nylas.com` or `https://api.eu.nylas.com` to match the Nylas app's data residency. Do not mix dev and prod Nylas regions.

## Production URLs

The target URL shape should match the app and API domains selected for production:

```text
Hosted OAuth callback: https://<prod-api-or-app-domain>/nylas/oauth/callback
Webhook destination:   https://<prod-api-or-app-domain>/nylas/webhook
Frontend redirect:     https://<prod-app-domain>/communications
```

If production uses one CloudFront distribution with API path routing on the app domain, these URLs may share the app domain. If production uses a separate API hostname, use that API hostname for callback and webhook routes.

CloudFront must forward these backend routes:

- `/nylas/oauth/*`
- `/nylas/webhook`

The webhook challenge must reach the Go backend and return the raw challenge body.

## Nylas App Setup

1. Create a production Nylas application.
2. Record the production client/application ID as a GitHub production environment variable.
3. Store the production Nylas API key in AWS Secrets Manager.
4. Generate a long random production OAuth state secret and store it in AWS Secrets Manager.
5. Configure the Hosted OAuth callback URL:

```text
https://<prod-api-or-app-domain>/nylas/oauth/callback
```

6. Confirm requested Google scopes match Mango's backend/frontend needs:

```text
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/gmail.labels
```

7. If Microsoft mailbox support is enabled, confirm Microsoft scopes:

```text
offline_access User.Read Mail.ReadWrite Mail.Send
```

8. After the first deploy exposes the webhook route, create the production webhook destination:

```text
https://<prod-api-or-app-domain>/nylas/webhook
```

9. Subscribe the webhook to:

```text
message.created
message.updated
message.deleted
message.opened
folder.created
folder.updated
folder.deleted
```

10. Store the returned webhook secret in AWS Secrets Manager and set the production `nylas_webhook_secret_arn`.
11. Redeploy so ECS receives `NYLAS_WEBHOOK_SECRET`.

## Secrets Manager

Use prod-specific secret names. Examples of name shape only:

```text
mangorts/prod/nylas-api-key
mangorts/prod/nylas-state-secret
mangorts/prod/nylas-webhook-secret
```

Do not include real secret values in docs, Terraform files, workflow logs, or local plaintext files.

The ECS task role must have permission to read only the production Secrets Manager ARNs needed by production. It should not read dev Nylas or dev DB secrets.

## Mailbox Reconnection

Dev mailbox grants should not be copied to prod. The production rule is:

```text
Users and shared inboxes reconnect through the production Nylas app.
```

For personal mailboxes:

- User logs into prod.
- User starts Connect Google from the prod app.
- Backend sends the user through prod Nylas Hosted OAuth.
- Prod stores a new `user_email_connections` row with the prod grant ID.

For company/shared inboxes:

- An authorized user connects the shared mailbox in prod.
- Prod stores a new `company_email_connections` row with the prod grant ID.
- Shared inbox folders/inboxes reference prod connection rows only.

Validation:

- No dev `grant_id` values exist in prod.
- `user_email_connections.status` and `company_email_connections.status` reflect prod grants only.
- Reauth-required behavior still works if a prod grant is revoked.

## SES Production Sender

Mango invitation and signup confirmation emails use `MANGORTS_EMAIL_FROM`. Production must use a verified SES identity before email sending is considered ready.

Required setup:

- Verify either a production sender address or the production domain in SES in the same AWS region used by the backend.
- Prefer domain verification for production.
- Publish SES DKIM records in Route 53.
- Configure SPF for the production sender domain.
- Configure DMARC for the production sender domain.
- Decide the production From address and set it as the prod `email_from_address`/`MANGORTS_EMAIL_FROM`.

Do not use a personal or dev-only sender for production invites.

## DNS Records

Production DNS must include:

- App/API records for CloudFront.
- Origin hostname for ALB, if the Terraform stack keeps the same pattern as dev.
- ACM DNS validation records.
- SES verification records.
- SES DKIM records.
- SPF record allowing SES for the sender domain.
- DMARC record with the team's chosen policy.
- Any Google/Nylas domain verification records required by provider dashboards.

Provider DNS records should be reviewed before tightening DMARC policy.

## Google OAuth Production Readiness

While dev can rely on Google test-user allowlists, production should not.

Before launch:

- Confirm the Google OAuth app behind the production Nylas app is in the appropriate production/published state for the requested Gmail scopes.
- Confirm the production app domain and privacy/support links are correct in the Google OAuth configuration.
- Confirm authorized domains include the production domain.
- Confirm Nylas Hosted OAuth uses the production callback URL.
- Confirm users outside a dev test-user allowlist can complete mailbox connection if the product is meant for them.

If Google verification is still pending, production Communications must remain disabled or limited to approved test users until verification is complete.

## Smoke Tests

After deployment:

```powershell
curl -i "https://<prod-api-or-app-domain>/nylas/webhook?challenge=prod-smoke"
```

Expected result:

- HTTP 200
- Body exactly `prod-smoke`
- No HTML app shell
- No JSON wrapper

Then test:

- Personal Connect Google from a real prod user.
- Shared inbox connection from an authorized prod user.
- Inbound message webhook updates.
- Invitation email delivery from the production SES sender.
- Signup confirmation email delivery if enabled.
- Reauth-required behavior after revoking a prod mailbox grant.

## Stop Conditions

Stop production email launch when:

- Any Nylas prod secret is stored outside Secrets Manager.
- Prod config references a dev Nylas client ID, callback URL, webhook URL, grant ID, or secret ARN.
- The webhook challenge is served by the frontend instead of the backend.
- SES sender/domain verification is incomplete.
- DKIM/SPF/DMARC records are missing or unreviewed.
- Google OAuth remains in a test-only state for users who need production access.
- A migrated `user_email_connections` or `company_email_connections` row contains a dev grant ID.
