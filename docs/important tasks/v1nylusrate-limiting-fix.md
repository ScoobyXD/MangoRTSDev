# V1 Nylas Rate Limiting Fix

Last updated: 2026-07-09

## Purpose

This document is a handoff brief for implementing the first real MangoRTS fix for Nylas/Gmail rate limiting in Home mail views.

The expired-token/Google OAuth Testing problem is mostly outside this code path. This document is specifically about reducing avoidable Nylas and Gmail API pressure while preserving the product expectation that mail views feel current.

## Problem Summary

Mango currently uses `refresh=true` in normal Home mail loading paths. That is an intentional freshness choice for now. In the communications API, `refresh=true` means "force a provider read":

- Frontend `listEmailMessages(...)` skips the frontend message-page cache when `params.refresh` is true.
- Backend `communicationsMessagePage(...)` skips the backend message-page cache when `query.Refresh` is true.
- The backend then calls Nylas `ListMessages(...)`, subject only to the per-process provider gate.

This makes normal view switching expensive, but the V1 correction should not remove `refresh=true` from the active mailbox load path unless the product decision changes later. Users expect the latest messages when they bounce between personal triage and shared triage. The fix is to make those provider refreshes singular, coalesced, cooldown-aware, and observable.

The correct behavior should be fresh-first but bounded:

- Keep existing visible mail state available while a provider refresh is running.
- Let Nylas webhooks update backend state, while browsers reconcile on canonical mailbox loads/manual refresh; communications WebSocket delivery is intentionally removed.
- Trigger at most one coalesced provider refresh for the active list identity.
- Preserve visible cached/stale content on Nylas `429` instead of blanking the list.
- Back off per grant/mailbox when Nylas returns `Retry-After`.

## Latest Findings To Preserve

### Batch Size Is Not The Main Rate-Limit Lever

For Mango's own per-grant provider gate, a message-list request with `limit=2` and a message-list request with `limit=12` both consume one in-flight slot. Mango currently gates provider work by request, not by number of messages returned.

This means the 12-message batch-size contract is still useful product hygiene, but it is not the main fix for rate limiting. The main risk is repeated provider reads for the same grant/list identity.

Batch size can still matter secondarily:

- A larger page can hold an in-flight slot slightly longer.
- Nylas might do more provider-side work for a larger page.
- Gmail quota is counted in provider quota units, and one Nylas request can fan out into multiple Google calls.
- Larger pages can create more downstream message-detail follow-up work.

Do not assume this from code alone. Add diagnostics for `Nylas-Provider-Request-Count` and `Nylas-Gmail-Quota-Usage` before making stronger claims about the exact provider-side cost of `limit=2` versus `limit=12`.

### Keep `refresh=true`, But Bound It

The current product decision is to leave `refresh=true` in the active mailbox freshness path because seeing current mail when switching inboxes is important.

The implementation target is not "never hard-refresh on mailbox switch." The target is:

- no duplicate hard refreshes for the same active list identity
- no parallel hard refreshes for the same grant/list identity
- no repeated hard refresh loop while a provider cooldown is active
- no list blanking when stale/cached content exists
- safe logging that proves whether Nylas, Gmail quota, or Mango request fan-out caused the 429

## Current Code Pointers

- `frontend/src/pages/home/HomePage.tsx`
  - `loadMessages(...)` passes `refresh: options.refresh` to `listEmailMessages(...)`.
  - Current hard-refresh callsites include:
    - shared OAuth completion / pending shared refresh
    - shared inbox activation
    - generic `useEffect(() => { void loadMessages({ refresh: true }); }, [loadMessages])`
  - These callsites should be audited so normal view switching does not issue duplicate provider reads for the same active list identity.

- `frontend/src/modules/communications/communicationsApi.ts`
  - `MESSAGE_PAGE_CACHE_TTL_MS` is currently short-lived frontend cache.
  - `listEmailMessages(...)` skips cache and existing in-flight joins when `params.refresh` is true.
  - Rate-limit fallback already tries to return stale cached data when possible.

- `backend/internal/http/communications_handlers.go`
  - `parseNylasMessageQuery(...)` parses `refresh=true`.
  - `communicationsMessagePage(...)` skips backend cache when `query.Refresh` is true.
  - `writeNylasError(...)` maps Nylas `429` to `nylas_rate_limited` and forwards `Retry-After`.
  - `communicationsMutationErrorCode(...)` maps mutation failures to `nylas_rate_limited`.

- `backend/internal/http/communications_cache.go`
  - Backend folders/message pages/message details already have long-lived cache plus stale-on-rate-limit fallback.

- `backend/internal/http/nylas_request_gate.go`
  - Provider gate is per backend process, keyed by grant/user fallback.
  - It is not a distributed cross-task or cross-tab throttle.

- `backend/internal/http/nylas_client.go`
  - Current Nylas error parsing captures `Retry-After`.
  - It does not capture or log Nylas/Gmail diagnostic headers on success or failure.

## Desired Product Contract

Opening or switching to a mailbox may force a Nylas provider refresh for freshness, but it must be bounded and idempotent for the active list identity.

Normal mailbox activation should:

1. Keep the current list visible while freshness work runs.
2. Start at most one provider refresh for the active list identity.
3. Join or suppress duplicate refresh attempts for the same grant/list identity.
4. Ignore stale background results if the user has navigated away or changed filters.
5. Avoid another refresh for the same grant/list identity while a request is in flight or while a provider cooldown is active.
6. Serve cached or stale data when a provider refresh fails with `429`.

Hard provider refresh is acceptable for:

- Active mailbox list load when freshness is the product priority.
- User explicit refresh action.
- OAuth connect/reconnect completion.
- A known cache-invalidating event that cannot be reconciled locally.
- A sequence gap or unreliable realtime/webhook condition.
- A cache miss where no usable page exists.

Hard provider refresh should not be used for:

- Duplicate effects triggered by the same Home view switch.
- Duplicate effects triggered by the same Shared Triage mailbox selection.
- Browser focus or visibility return.
- Clicking/focusing an email row.
- Local conversion/star/archive echoes that already patched visible state.

## Recommended Implementation Plan

### Phase 1: Keep Hard Refresh, Remove Duplicate Hard Refreshes

Audit the `loadMessages({ refresh: true })` callsites in `HomePage.tsx`.

Do not remove `refresh=true` from the active mailbox load path as the first fix. Instead, prove which callsites can fire for the same list identity and collapse them so one mailbox activation produces at most one provider refresh.

Known suspicious callsites:

- pending shared OAuth / pending shared inbox refresh
- shared inbox activation
- generic `useEffect(() => { void loadMessages({ refresh: true }); }, [loadMessages])`

If more than one of those fires for the same active mailbox, join/suppress the duplicate rather than letting each call issue its own Nylas list request.

Important: do not blank the message list before refresh completion unless there is no cached/stale/previous page that can be safely shown for the selected list identity.

### Phase 2: Add Coalesced Freshness Semantics

Introduce a small freshness policy at the communications frontend layer or Home mail layer.

Recommended shape:

- `listEmailMessages(params)` can still force provider freshness when `refresh=true`.
- Refresh requests should join an existing in-flight refresh for the same cache key/list identity.
- Refresh completion should update the same cache key and then patch visible state only if the active list identity still matches.
- Cached or stale content should remain available while the refresh is in flight or when the refresh fails with a rate limit.

Do not let `refresh=true` bypass in-flight joining for the same cache key. The current behavior can allow duplicate refresh requests because the existing in-flight check only runs for non-refresh loads.

### Phase 3: Add Per-Grant/List Cooldown After 429

When backend returns `nylas_rate_limited` or HTTP `429`, frontend should store a cooldown for the relevant mail scope.

Use the backend `Retry-After` value when present. If missing, use a conservative short fallback such as 30 to 60 seconds with jitter.

While a cooldown is active:

- Do not issue hard refreshes for that mail scope.
- Serve cached or stale data if available.
- Keep the UI message calm and specific only when no usable data can be shown.
- Let archive/background mutation retry machinery keep using its existing retry scheduling.

The cooldown key should be scoped tightly enough to avoid freezing unrelated inboxes. Good candidates are:

- company ID
- shared inbox ID or personal mailbox scope
- account email if already available in state
- mailbox/filter/search/unread identity where appropriate

Do not log or store provider secrets, API keys, tokens, or raw grant IDs in browser storage.

### Phase 4: Add Safe Diagnostics

We need proof about what is causing 429s. Nylas documents these response headers as useful for Google provider pressure:

- `Nylas-Provider-Request-Count`
- `Nylas-Gmail-Quota-Usage`
- `Retry-After`

Add safe backend logging or metrics around Nylas calls:

- endpoint category: folders, messages list, message detail, thread, update, send, archive
- HTTP status
- Nylas error code
- `Retry-After`
- provider request count
- Gmail quota usage
- request limit
- `refresh` flag
- mailbox type/filter/search presence
- hashed grant/account scope, not raw grant ID or email if logs are broadly visible

Do not log message bodies, snippets, subjects, recipients, OAuth tokens, API keys, raw provider secrets, or raw grant IDs.

If the current Nylas client cannot access headers on successful JSON responses, refactor carefully so response metadata is available without duplicating request code. Keep the public behavior of existing client methods stable unless tests are updated.

### Phase 5: Tests And Acceptance Checks

Add focused tests where the repo has harness support.

Backend checks:

- `refresh=false` uses backend message-page cache.
- `refresh=true` bypasses backend message-page cache only when explicitly requested.
- Nylas `429` serves stale message page when stale cache exists.
- `Retry-After` is preserved.
- New diagnostic metadata does not include secrets.

Frontend checks:

- Normal mailbox/view switch may use `refresh=true`, but it creates at most one provider refresh for the selected list identity.
- A second refresh attempt for the same cache key joins or is suppressed while the first is in flight.
- Multiple quick bounces between the same My Triage and Shared Triage views create bounded provider refreshes and respect cooldown.
- A 429 with stale data keeps the visible list instead of blanking it.
- Explicit user refresh still forces a provider refresh unless cooldown is active.

Manual smoke scenario:

1. Open My Triage primary inbox.
2. Switch to a connected Shared Triage mailbox.
3. Switch back and forth 10 times quickly.
4. Expected: provider reads are coalesced and bounded; duplicate refresh effects do not issue duplicate Nylas list calls; no repeated `nylas_rate_limited` notice if stale data exists.
5. Trigger explicit refresh once.
6. Expected: one provider refresh for the active list identity, or stale data plus cooldown if Nylas returns `429`.

## Non-Goals

- Do not solve Google OAuth Testing seven-day token expiry here.
- Do not poll Nylas grants or Gmail just to keep tokens alive.
- Do not add browser focus/visibility polling.
- Do not weaken the 12-message batch-size contract.
- Do not broaden OAuth scopes.
- Do not delete/recreate expired grants as part of rate-limit handling.

## Source References

- Nylas API and provider rate limits: https://developer.nylas.com/docs/dev-guide/platform/rate-limits/
- Nylas expired grant handling: https://developer.nylas.com/docs/cookbook/use-cases/build/handle-grant-expiry/
- Google OAuth refresh token expiration: https://developers.google.com/identity/protocols/oauth2
- Gmail API quota units: https://developers.google.com/workspace/gmail/api/reference/quota
