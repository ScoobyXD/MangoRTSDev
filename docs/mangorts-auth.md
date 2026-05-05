# MangoRTS Auth V2

MangoRTS dev uses Amazon Cognito User Pools for human login.

## Login Flow

The frontend uses Cognito managed login with authorization code + PKCE:

1. Browser opens `https://dev.<domain>`.
2. Frontend checks `VITE_AUTH_MODE`.
3. If `VITE_AUTH_MODE=cognito` and no valid token exists, the browser redirects to Cognito managed login.
4. Cognito authenticates the user and redirects back to `https://dev.<domain>`.
5. Frontend exchanges the code for tokens and stores them in browser storage.
6. Frontend attaches `Authorization: Bearer <access_token>` to API requests.

The temporary CloudFront basic-auth gate protects static pages and health checks. `/v1/*` requests with a Bearer token pass through CloudFront so the backend can validate Cognito JWTs.

Local development keeps auth disabled unless `VITE_AUTH_MODE=cognito` is set.

## Backend Enforcement

The backend enables auth only when `AUTH_MODE=cognito`.

When enabled:

- `/healthz` stays public for load balancer health checks.
- `/v1/*` requires a valid Cognito access token.
- The backend validates issuer, client ID, token use, expiry, and RS256 signature through the Cognito JWKS.
- The backend upserts the authenticated Cognito subject into `users`.
- Any request with `company_id` is allowed only if `company_memberships` contains that user for that company.

The backend still accepts `company_id` in API requests for now, but it no longer trusts it blindly when auth is enabled.

## Tables

- `users`: maps Cognito `sub` values to internal user IDs.
- `companies`: stores tenant/company rows.
- `company_memberships`: authorizes a user for a company with `owner`, `admin`, `member`, or `agent` role.

## Dev User Setup

For dev, Cognito public signup is disabled. Create users from AWS Console or CLI, then insert a matching company membership after their first login has created the `users` row.

Future work:

- real invitation flow,
- enterprise SSO/SAML,
- role-aware authorization per endpoint,
- machine-to-machine agent clients and rotation.
