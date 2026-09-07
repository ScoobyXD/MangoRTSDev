# Auth

1. Page refresh loads the current Mango user through `GET /v1/me`; that request is a current-user resolution path, not a profile edit.
2. Auth middleware must validate the token, resolve the Mango user, and load memberships before `/v1/me` returns.
3. `users.display_name` is Mango-owned profile data and must stay nonblank at the database level.
4. First-time auth user creation may use a fallback display name only to satisfy the nonblank database requirement: real incoming name first, then email, then Cognito subject.
5. Existing Mango users must not have `users.display_name` overwritten by page refresh, `/v1/me`, auth cache misses, blank token names, or email-looking fallback token names.
6. Auth refresh may update the stored email from authenticated identity claims, but it must preserve the existing Mango display name unless an incoming name is clearly real user-name data.
7. Explicit Mango profile edits are authoritative; accepting another company invitation must preserve an existing user's display name.
8. An auth membership cache miss must preserve Mango-owned profile fields and must not restore data invalidated while that cache load was running. Once a claim variant is accepted, a token with an older or equal issue time must return the stored profile and must not rewrite it; a token with a strictly later issue time may change the profile back. Cache expiry must still refresh current memberships.
9. Browser app sessions may stay alive while the app is open by silently refreshing short-lived access tokens; access tokens themselves must not be made long-lived merely to avoid re-login.
10. Auth refresh means the app silently obtains a fresh access token from the auth provider; it must not require a visible user login while the refresh path is still valid.
11. A terminal auth failure or failed silent refresh must force the normal Mango logout/login flow and show the existing Mango login page.
12. After terminal auth failure, the frontend must stop product fetches, realtime ticket requests, WebSocket reconnects, fallback/refetch behavior, editor saves, and background retries until the user logs in again.
13. The app must not leave the user editing a dead authenticated surface with only a small websocket/auth error indicator.
14. Third-party provider credential failures, such as Nylas mailbox reauthorization for My Triage or Shared Triage, are not Mango auth failures and must not clear the Mango session or force the login page.
15. A third-party provider reauthorization requirement must never be returned to an already-authenticated Mango browser as a Mango auth `401`, `unauthorized`, terminal-auth, logout, or login-redirect response. The backend must return a recoverable provider-specific response, such as `409 nylas_reauth_required`, so the frontend can show reconnect/repair UI while keeping the Mango session active.
16. A Mango session `401` or terminal logout stops authenticated work but must not purge an unsynchronized local email draft. The fallback remains isolated by company, Mango user, and exact personal-account/shared-inbox scope so another user or mailbox cannot see it; a later valid same-scope session may reconcile it.
17. Concurrent auth requests for one subject must share one in-flight identity and bootstrap operation; waiting requests must not reserve database connections and each waiter may cancel independently.
18. Repeated resolution of the same or an older token must only read the user. The first resolution of a later token may advance only the hidden auth-claims watermark; only a missing user or a real email or name change may update visible profile fields or emit a profile event.
19. Concurrent current-membership checks for one user must share one in-flight database read while realtime admission and Process Map subscription still use current membership.
20. Request cancellation must reach auth reads, transactions, membership reads, and lock acquisition; one auth resolution and its reads must have a six-second deadline, write transactions a five-second deadline, statements inside those transactions a four-second limit, and lock waits a one-second limit.
21. An authentication-resolution or realtime-admission timeout must roll back its transaction, release its database connection, and return `504 authentication_timeout`; a non-timeout storage failure on those paths must return `503 authentication_unavailable`.
22. Initial company creation must atomically recheck memberships under a cross-process lock and create one company plus membership; public signup grants company-admin, and dev-admin bootstrap requires an allowlisted email with the signed token's `email_verified` claim equal to boolean `true`.
23. A new Mango user must have mailbox_enabled=false; auth refresh, invitations, and company switching must preserve that stored account policy.
24. A mailbox-disabled actor must be denied personal and shared mailbox HTTP and realtime access without contacting the provider; ordinary product authentication must remain available.
25. Cognito must verify a replacement email before changing the user's current email attribute.

26. The scenic login page must show compact, equal Sign Up and Sign In forms directly over the scenery at the bottom left, without a shared background rectangle.
27. Landing navigation must select Sign In / Login by default and show only a minimal What We Offer placeholder when requested.
28. Switching landing sections or wallpapers must preserve mounted auth forms, entered values, and pending confirmation work.
29. Sign-up, sign-in, invitations, password recovery, account challenges, and deep-link return behavior must keep using the existing auth flows.
30. Wallpapers must use repository scene folders and let the browser select an available crop and resolution for the viewport and pixel density.
31. Missing wallpapers must leave a usable gradient background without blocking authentication or requesting nonexistent image files.
32. Wallpaper rotation must decode the next scene before showing it and retain the current scene if the next image fails.
33. Wallpaper rotation must wait about one minute between scenes, run only with multiple scenes, pause while the page is hidden, and stop for reduced motion.
34. Wallpaper loading must request only the current scene and the next scene when needed, and remove timers and listeners when unmounted.

35. Accept Invite and Forgot Password must remain separate compact buttons at the top right of the landing page.
36. Auth controls must remain reachable on small or short screens without overlapping the landing navigation.
37. Sign Up and Sign In fields must use opaque light backgrounds with dark text, and their exposed headings and labels must stay legible over varied scenery.

## Wallpaper setup

Add scene folders and image variants under `frontend/src/assets/auth-wallpapers/` following its [setup guide](../../frontend/src/assets/auth-wallpapers/README.md). Repository image changes are published by the existing frontend deployment.

## Process Story

A valid Cognito session resolves one Mango user and its company memberships. A user without memberships receives an initial company once. Repeated requests preserve the Mango profile and mailbox policy, while a terminal session failure returns the browser to sign-in.

## Scenarios

1. **Identity resolution:** Concurrent first requests create one user and initial company. Later requests preserve the display name, reuse bounded auth work, and observe membership invalidation.
2. **Cancellation:** An expired or canceled auth operation releases its transaction and locks; waiters may cancel independently, and a retry can recover without duplicate companies.
3. **Session versus mailbox failure:** A terminal Mango session failure stops product work and shows login. A legacy mailbox reauthorization failure keeps the Mango session and local draft intact. A mailbox-disabled account never starts mailbox work.
