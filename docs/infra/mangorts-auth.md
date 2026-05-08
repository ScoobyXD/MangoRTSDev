# MangoRTS Auth MVP

MangoRTS uses Amazon Cognito for authentication and Mango-owned PostgreSQL tables for company authorization.

## Login Flow

The frontend uses custom React pages, Cognito Identity Provider API calls for sign-in, invite password challenges, and Cognito password resets:

1. Dev admin or company admin creates an invitation in Mango.
2. The backend stores a hashed Mango invitation token and calls Cognito `AdminCreateUser`.
3. The user opens `/accept-invite`, enters the Mango invite token, Cognito temporary password, and a new password.
4. Cognito completes the `NEW_PASSWORD_REQUIRED` challenge and issues tokens.
5. The frontend calls `/v1/invitations/accept` with the user's display name; Mango links the Cognito subject to `users`, writes `company_memberships`, and sends a signup confirmation email when `MANGORTS_EMAIL_FROM` is configured.
6. Authenticated requests send a Cognito bearer token to the backend.

The app does not use Cognito Managed Login / Hosted UI. Local development keeps auth disabled unless `VITE_AUTH_MODE=cognito` is set.

## Local Cognito Backend

Use `scripts/start_local_cognito_backend.ps1` when running the local API against the dev Cognito pool and dev Postgres:

```powershell
aws sso login --profile <profile>
.\scripts\start_local_cognito_backend.ps1 -AwsProfile <profile> -StopExisting
```

The script exports short-lived AWS credentials from the selected AWS CLI profile into `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` before launching the Go backend. This is required because the backend signs Cognito admin and SES email calls from process environment credentials. The active AWS identity must be allowed to call `cognito-idp:AdminCreateUser`, `cognito-idp:AdminDeleteUser`, and `ses:SendEmail` for the configured resources.

## Backend Enforcement

The backend enables auth only when `AUTH_MODE=cognito`.

- `/healthz` stays public for load balancer health checks.
- `/v1/*` requires a valid Cognito access or ID token when auth is enabled.
- The backend validates issuer, client ID, token use, expiry, and RS256 signature through the Cognito JWKS.
- The backend upserts the authenticated Cognito subject into `users`.
- Memberships are loaded once per request into an actor context.
- `dev_admin` can access all companies.
- `dev_admin` can list/search companies through bounded `GET /v1/companies?query=<text>&limit=<n>` for Settings scope selection and invite targeting.
- Company-scoped routes require company membership or `dev_admin`.
- `company_admin` manages users inside their company.
- `company_user` has full access inside their company for now.
- Company invitations can only be created by `dev_admin` or `company_admin`; this is enforced in both HTTP handlers and repository writes.
- Creating a new pending invitation for the same company and email revokes older pending invitations, so only the latest token can be accepted.
- Password resets use Cognito `ForgotPassword` and `ConfirmForgotPassword`. Mango's public `/v1/password-resets/request` endpoint only verifies that the email belongs to a Mango user before the frontend asks Cognito to send the reset code. Cognito owns reset-code delivery and its one-hour code lifetime.

## Tables

- `users`: maps Cognito `sub` values to internal user IDs.
- `companies`: stores tenant/company rows.
- `company_memberships`: Mango authorization roles: `dev_admin`, `company_admin`, `company_user`.
- `invitations`: company-scoped pending/accepted invite tokens; only token hashes are stored.

## Frontend Env

- `VITE_AUTH_MODE=cognito`
- `VITE_COGNITO_REGION`
- `VITE_COGNITO_USER_POOL_ID`
- `VITE_COGNITO_CLIENT_ID`
- `VITE_API_BASE_URL`

## Backend Email Env

- `MANGORTS_EMAIL_FROM`: verified SES sender address for signup confirmation emails.

Tokens are kept in `sessionStorage` for this MVP. This avoids persistent local storage, but a future secure cookie/session layer is still the preferred production hardening path.

