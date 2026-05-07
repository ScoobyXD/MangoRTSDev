# MangoRTS Auth MVP

MangoRTS uses Amazon Cognito for authentication and Mango-owned PostgreSQL tables for company authorization.

## Login Flow

The frontend uses custom React pages and direct Cognito Identity Provider API calls:

1. Dev admin or company admin creates an invitation in Mango.
2. The backend stores a hashed Mango invitation token and calls Cognito `AdminCreateUser`.
3. The user opens `/accept-invite`, enters the Mango invite token, Cognito temporary password, and a new password.
4. Cognito completes the `NEW_PASSWORD_REQUIRED` challenge and issues tokens.
5. The frontend calls `/v1/invitations/accept`; Mango links the Cognito subject to `users` and writes `company_memberships`.
6. Authenticated requests send a Cognito bearer token to the backend.

The app does not use Cognito Managed Login / Hosted UI. Local development keeps auth disabled unless `VITE_AUTH_MODE=cognito` is set.

## Local Cognito Backend

Use `scripts/start_local_cognito_backend.ps1` when running the local API against the dev Cognito pool and dev Postgres:

```powershell
aws sso login --profile <profile>
.\scripts\start_local_cognito_backend.ps1 -AwsProfile <profile> -StopExisting
```

The script exports short-lived AWS credentials from the selected AWS CLI profile into `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` before launching the Go backend. This is required because the backend signs Cognito `AdminCreateUser` calls from process environment credentials. The active AWS identity must be allowed to call `cognito-idp:AdminCreateUser` on the configured user pool.

## Backend Enforcement

The backend enables auth only when `AUTH_MODE=cognito`.

- `/healthz` stays public for load balancer health checks.
- `/v1/*` requires a valid Cognito access or ID token when auth is enabled.
- The backend validates issuer, client ID, token use, expiry, and RS256 signature through the Cognito JWKS.
- The backend upserts the authenticated Cognito subject into `users`.
- Memberships are loaded once per request into an actor context.
- `dev_admin` can access all companies.
- Company-scoped routes require company membership or `dev_admin`.
- `company_admin` manages users inside their company.
- `company_user` has full access inside their company for now.
- Company invitations can only be created by `dev_admin` or `company_admin`.
- Creating a new pending invitation for the same company and email revokes older pending invitations, so only the latest token can be accepted.

## Tables

- `users`: maps Cognito `sub` values to internal user IDs.
- `companies`: stores tenant/company rows.
- `company_memberships`: Mango authorization roles: `dev_admin`, `company_admin`, `company_user`.
- `invitations`: company-scoped pending/accepted invite tokens; only token hashes are stored.
- `resource_assignments`: legacy assignment rows for folders, nodes, logic gates, and kanban boards; these are not enforced by auth right now.

## Frontend Env

- `VITE_AUTH_MODE=cognito`
- `VITE_COGNITO_REGION`
- `VITE_COGNITO_USER_POOL_ID`
- `VITE_COGNITO_CLIENT_ID`
- `VITE_API_BASE_URL`

Tokens are kept in `sessionStorage` for this MVP. This avoids persistent local storage, but a future secure cookie/session layer is still the preferred production hardening path.

