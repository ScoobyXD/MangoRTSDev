# Auth

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (auth middleware, membership cache, invite acceptance, and display-name refresh regression have focused coverage; rule IDs are not mapped to every endpoint yet)

## Business Logic

AUTH1 - Page refresh loads the current Mango user through `GET /v1/me`; that request is a current-user resolution path, not a profile edit.
AUTH2 - Auth middleware may validate the token, ensure the Mango user row exists, and load memberships before `/v1/me` returns.
AUTH3 - `users.display_name` is Mango-owned profile data and must stay nonblank at the database level.
AUTH4 - First-time auth user creation may use a fallback display name only to satisfy the nonblank database requirement: real incoming name first, then email, then Cognito subject.
AUTH5 - Existing Mango users must not have `users.display_name` overwritten by page refresh, `/v1/me`, auth cache misses, blank token names, or email-looking fallback token names.
AUTH6 - Auth refresh may update the stored email from authenticated identity claims, but it must preserve the existing Mango display name unless an incoming name is clearly real user-name data.
AUTH7 - Explicit Mango flows such as invite acceptance and future profile editing are authoritative places to set `users.display_name`.
AUTH8 - Auth membership cache misses can cause the backend to re-resolve the user and memberships, but cache refresh must preserve Mango-owned profile fields.

## Scenarios

### Scenario AUTH-S1: Page Refresh Preserves Mango Display Name

Business logic covered:
- AUTH1
- AUTH2
- AUTH3
- AUTH5
- AUTH8

Given:
- A Mango user row already exists with `display_name = "Jonathan Kim"`.
- The browser refreshes the app.
- The frontend calls `GET /v1/me`.
- The authenticated token has the same subject and email but no real display-name claim.

Expected:
- `/v1/me` returns the existing Mango user.
- The response keeps `display_name = "Jonathan Kim"`.
- The database keeps `users.display_name = "Jonathan Kim"`.
- The auth middleware does not turn a blank token name into an authoritative profile update.

### Scenario AUTH-S2: New Auth User Gets A Nonblank Fallback

Business logic covered:
- AUTH2
- AUTH3
- AUTH4

Given:
- An authenticated subject reaches Mango before a user row exists.
- The token may have a real name, only an email, or only a subject.

Expected:
- Mango creates the user row with a nonblank `display_name`.
- A real incoming name is preferred.
- Email or subject fallback is used only for initial row creation, not as future profile authority.

### Scenario AUTH-S3: Explicit Mango Profile Flow Owns Display Name

Business logic covered:
- AUTH3
- AUTH7

Given:
- A user accepts an invitation or uses an explicit Mango profile flow.
- The submitted display name is nonblank.

Expected:
- Mango stores the submitted display name.
- Later auth refreshes and page refreshes preserve that Mango-owned value.
