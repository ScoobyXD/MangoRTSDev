Last updated: 2026-07-08

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
AUTH9 - Browser app sessions may stay alive while the app is open by silently refreshing short-lived access tokens; access tokens themselves must not be made long-lived merely to avoid re-login.
AUTH10 - Auth refresh means the app silently obtains a fresh access token from the auth provider; it must not require a visible user login while the refresh path is still valid.
AUTH11 - A terminal auth failure or failed silent refresh must force the normal Mango logout/login flow and show the existing Mango login page.
AUTH12 - After terminal auth failure, the frontend must stop product fetches, realtime ticket requests, WebSocket reconnects, fallback/refetch behavior, editor saves, and background retries until the user logs in again.
AUTH13 - The app must not leave the user editing a dead authenticated surface with only a small websocket/auth error indicator.
AUTH14 - Third-party provider credential failures, such as Nylas mailbox reauthorization for My Triage or Shared Triage, are not Mango auth failures and must not clear the Mango session or force the login page.

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

### Scenario AUTH-S4: Terminal Auth Failure Forces Login And Stops Product Work

Business logic covered:
- AUTH9
- AUTH10
- AUTH11
- AUTH12
- AUTH13

Given:
- A user has Mango open in the browser.
- The app has been keeping the session alive through silent access-token refresh.
- A product fetch, realtime ticket request, WebSocket connection, or fallback refetch receives a terminal auth failure.
- A single controlled silent refresh attempt fails or no refresh path is available.

Expected:
- The app stops product fetches, realtime ticket requests, WebSocket reconnects, fallback/refetch work, editor saves, and background retries.
- The app forces the normal Mango logout/login flow.
- The visible screen becomes the existing Mango login page.
- The user is not left typing into an editor or work surface that can no longer save.
- A small websocket/auth status badge is not the only user-visible auth failure state.

### Scenario AUTH-S5: Provider Reauth Does Not Log Out Mango

Business logic covered:
- AUTH11
- AUTH14

Given:
- A user is signed in to Mango with a valid Mango/Cognito session.
- The user opens My Triage or a Shared Triage mailbox.
- The mailbox provider grant has expired or requires reauthorization.

Expected:
- The backend returns a provider reauth error instead of a Mango `401`.
- The frontend shows the mailbox reconnect/repair flow.
- The user's Mango session remains active.
- The app does not navigate to the Mango login page solely because the mailbox provider needs reconnecting.
