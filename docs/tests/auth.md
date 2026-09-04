Last updated: 2026-09-04

# Auth

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (auth concurrency, cancellation, membership caching, invite acceptance, and display-name refresh have focused coverage; frontend terminal-auth laws are not mapped to every endpoint yet)

## Business Logic

AUTH1 - Page refresh loads the current Mango user through `GET /v1/me`; that request is a current-user resolution path, not a profile edit.
AUTH2 - Auth middleware must validate the token, resolve the Mango user, and load memberships before `/v1/me` returns.
AUTH3 - `users.display_name` is Mango-owned profile data and must stay nonblank at the database level.
AUTH4 - First-time auth user creation may use a fallback display name only to satisfy the nonblank database requirement: real incoming name first, then email, then Cognito subject.
AUTH5 - Existing Mango users must not have `users.display_name` overwritten by page refresh, `/v1/me`, auth cache misses, blank token names, or email-looking fallback token names.
AUTH6 - Auth refresh may update the stored email from authenticated identity claims, but it must preserve the existing Mango display name unless an incoming name is clearly real user-name data.
AUTH7 - Explicit Mango flows such as invite acceptance and future profile editing are authoritative places to set `users.display_name`.
AUTH8 - An auth membership cache miss must preserve Mango-owned profile fields and must not restore data invalidated while that cache load was running. Once a claim variant is accepted, a token with an older or equal issue time must return the stored profile and must not rewrite it; a token with a strictly later issue time may change the profile back. Cache expiry must still refresh current memberships.
AUTH9 - Browser app sessions may stay alive while the app is open by silently refreshing short-lived access tokens; access tokens themselves must not be made long-lived merely to avoid re-login.
AUTH10 - Auth refresh means the app silently obtains a fresh access token from the auth provider; it must not require a visible user login while the refresh path is still valid.
AUTH11 - A terminal auth failure or failed silent refresh must force the normal Mango logout/login flow and show the existing Mango login page.
AUTH12 - After terminal auth failure, the frontend must stop product fetches, realtime ticket requests, WebSocket reconnects, fallback/refetch behavior, editor saves, and background retries until the user logs in again.
AUTH13 - The app must not leave the user editing a dead authenticated surface with only a small websocket/auth error indicator.
AUTH14 - Third-party provider credential failures, such as Nylas mailbox reauthorization for My Triage or Shared Triage, are not Mango auth failures and must not clear the Mango session or force the login page.
AUTH15 - A third-party provider reauthorization requirement must never be returned to an already-authenticated Mango browser as a Mango auth `401`, `unauthorized`, terminal-auth, logout, or login-redirect response. The backend must return a recoverable provider-specific response, such as `409 nylas_reauth_required`, so the frontend can show reconnect/repair UI while keeping the Mango session active.
AUTH16 - A Mango session `401` or terminal logout stops authenticated work but must not purge an unsynchronized local email draft. The fallback remains isolated by company, Mango user, and exact personal-account/shared-inbox scope so another user or mailbox cannot see it; a later valid same-scope session may reconcile it.
AUTH17 - Concurrent auth requests for one subject must share one in-flight identity and bootstrap operation; waiting requests must not reserve database connections and each waiter may cancel independently.
AUTH18 - Repeated resolution of the same or an older token must only read the user. The first resolution of a later token may advance only the hidden auth-claims watermark; only a missing user or a real email or name change may update visible profile fields or emit a profile event.
AUTH19 - Concurrent current-membership checks for one user must share one in-flight database read while realtime admission and Process Map subscription still use current membership.
AUTH20 - Request cancellation must reach auth reads, transactions, membership reads, and lock acquisition; one auth resolution and its reads must have a six-second deadline, write transactions a five-second deadline, statements inside those transactions a four-second limit, and lock waits a one-second limit.
AUTH21 - An authentication-resolution or realtime-admission timeout must roll back its transaction, release its database connection, and return `504 authentication_timeout`; a non-timeout storage failure on those paths must return `503 authentication_unavailable`.
AUTH22 - First dev-admin bootstrap must create its company and membership in one transaction that rechecks the user under a cross-process lock, so cancellation, retries, or multiple API tasks cannot create an orphan or duplicate bootstrap company.

## Scenarios

### Scenario AUTH-S1: User Resolution Preserves Mango Identity

Business logic covered:
- AUTH1
- AUTH2
- AUTH3
- AUTH4
- AUTH5
- AUTH6
- AUTH7
- AUTH8
- AUTH18

Given:
- A Mango user may be new or may already have `display_name = "Jonathan Kim"`.
- The browser refreshes the app.
- The frontend calls `GET /v1/me`.
- The authenticated token may contain unchanged claims, a real changed name, or no real display-name claim.

Expected:
- A missing user is created with a nonblank real-name, email, or subject fallback.
- A repeated token with unchanged claims is read without a user write transaction; the first later-issued token may advance only the hidden auth-claims watermark.
- A real changed email or name is stored through the serialized write path.
- A blank or email-looking name does not replace `display_name = "Jonathan Kim"`.
- The auth middleware does not turn a blank token name into an authoritative profile update.

### Scenario AUTH-S2: Auth Burst Is Coalesced And Bounded

Business logic covered:
- AUTH2
- AUTH8
- AUTH17
- AUTH19
- AUTH20
- AUTH21
- AUTH22

Given:
- One page load starts `/v1/me`, protected API calls, realtime ticket work, and realtime admission for the same user.
- More requests arrive than the configured database connection-pool capacity.
- A client may cancel while the shared operation is waiting on a database statement or lock.
- A membership invalidation may race the shared load.
- Two API tasks may attempt first dev-admin bootstrap together.

Expected:
- At most one identity/bootstrap operation and one current-membership read for that user are in flight.
- Waiters consume no extra database connections and may cancel without canceling a valid leader.
- A canceled or timed-out leader releases its transaction and connection so another request can recover.
- Timeout and storage failures return the controlled auth errors.
- A racing invalidation forces a fresh load instead of restoring stale memberships.
- Dev-admin bootstrap creates one company and membership atomically across both API tasks.

### Scenario AUTH-S3: Session Failure Is Separate From Provider Reauthorization

Business logic covered:
- AUTH9
- AUTH10
- AUTH11
- AUTH12
- AUTH13
- AUTH14
- AUTH15
- AUTH16

Given:
- A Mango session refresh fails terminally, or a third-party mailbox provider separately requires reauthorization.

Expected:
- The app stops product fetches, realtime ticket requests, WebSocket reconnects, fallback/refetch work, editor saves, and background retries.
- The app forces the normal Mango logout/login flow.
- The visible screen becomes the existing Mango login page.
- The user is not left typing into an editor or work surface that can no longer save.
- Any unsynchronized local email draft is retained under its exact company/user/account-or-inbox key rather than being destroyed by the `401`; no other user or mailbox can load that fallback.
- The backend returns a provider reauth error, such as `409 nylas_reauth_required`, instead of a Mango `401`, `unauthorized`, terminal-auth, logout, or login-redirect response.
- The frontend shows the mailbox reconnect/repair flow.
- The user's Mango session remains active.
- The app does not navigate to the Mango login page solely because the mailbox provider needs reconnecting.
