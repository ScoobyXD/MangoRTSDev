Last updated: 2026-07-10

# REST API & WebSocket Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (`backend/internal/http/calendar_invite_handlers_test.go` covers invitation parsing and RSVP handler behavior; `backend/internal/http/nylas_client_test.go` covers provider event lookup/response shapes; broader REST/WebSocket rule IDs are not fully mapped yet)

## Business Logic

RW1 - Durable editor saves for nodes and logic gates use HTTP API write routes, not WebSocket messages.
RW2 - WebSocket messages may notify clients that editor data changed, but WebSocket messages are not the source of truth for persisted editor content.
RW3 - A successful live editor autosave requires the HTTP projection write route to commit the current editor projection before the editor treats the live save as confirmed.
RW4 - Editor collaboration updates are opportunistic realtime updates and must not replace the durable HTTP projection autosave path or append durable workspace domain events per keystroke.
RW5 - A frontend API timeout means the browser stopped waiting for an HTTP response; it does not by itself prove whether the backend committed or failed the write.
RW6 - Timed-out, failed, pending, and confirmed editor saves must be distinguishable in the user-visible editor state.
RW7 - A timed-out editor save must leave enough information to retry or reconcile the latest local document value.
RW8 - Timeout investigations must identify the exact HTTP method, route, request duration, and backend log line for the affected request.
RW9 - Backend request logs must make it possible to distinguish slow durable writes from slow background reads or refetches.
RW10 - Realtime events may invalidate caches or trigger refetches, but they must not silently mutate durable editor content without a committed backend event.
RW11 - Realtime invalidation should use the narrowest semantic scope available instead of forcing broad workspace refetches.
RW12 - WebSocket reconnects or subscription failures must not be reported as successful durable saves.
RW13 - Browser-side API request timing should make status=error timeout cases visible with the route that timed out.
RW14 - Dev or production timeout triage must consider backend, database, and cache-refetch load before changing the client timeout threshold.
RW15 - Logic gate header renames are committed through `PUT /v1/logic-gates/{logic_gate_id}` and must reconcile the active Logic Gate Arena title, arena app target, and Company Explorer label from the committed response or `logic_gate_updated` workspace event without requiring a full page refresh.
RW16 - Explicit editor saved versions are created through HTTP save-version routes after pending projection writes are flushed; the information tables store those saved versions, not every live typing update.
RW17 - Restoring an editor saved version is an HTTP restore route that overwrites the current editor projection after user confirmation and publishes the normal committed projection/update signals.
RW18 - A terminal `401` or failed auth refresh must make realtime and API recovery quieter: stop ticket requests, WebSocket reconnects, fallback refetches, editor saves, and background retries, then rely on the auth layer to force the normal Mango login page.
RW19 - WebSocket reconnects after backend replacement/deploy must use randomized delay, exponential backoff, and bounded or very slow retry behavior; clients must not all reconnect immediately.
RW20 - WebSocket reconnect recovery must be scoped: reconnecting must not refetch the whole app by default, and should request only data that may be stale for the affected subscriptions.
RW21 - A `404` for a node, Logic Gate, or other resource is terminal for that resource until explicit user navigation or an authoritative event says the resource exists; the client must stop refetching that exact missing resource and unsubscribe from its realtime scope.
RW22 - Failure handling for `401`, `404`, and WebSocket disconnects must reduce frontend/backend work rather than creating retry, reconnect, or fallback-refetch storms.
RW23 - Realtime WebSocket tickets must be short-lived, HTTP-only, and valid across backend worker instances in the same environment so a ticket issued by one ECS task can be accepted by another task during WebSocket upgrade.
RW24 - Attachment upload control, metadata, linking, and content reads are HTTP operations; WebSocket messages may notify that attachment metadata changed, but WebSocket payloads must not carry file bytes, base64 blobs, presigned URLs, or S3 object contents.
RW25 - Calendar invitation responses use authenticated `POST /v1/communications/calendar-invites/respond` HTTP requests. The request supplies the company/mailbox scope plus `message_id` and `status` (`yes`, `maybe`, or `no`); the backend resolves the iCalendar UID and exactly one provider event under the authorized personal/shared mailbox scope instead of accepting client-supplied grant, calendar, or event identifiers. Shared inbox responses require edit access, WebSocket messages never send the RSVP, and expired/revoked grants or missing calendar scope return a recoverable mailbox/provider error rather than Mango logout or false success.
RW26 - Normal browser upload uses Mango HTTP JSON endpoints for policy, intent creation/state, multipart signing, completion, and abort, then raw HTTPS PUT directly to private S3 through the presigned URL. Mango API requests and WebSocket payloads never carry the browser file body. Intent creation carries active company context only in the membership-validated `X-Mango-Company-ID` Mango header, never in intent JSON or an S3 request; the S3 request also never carries Mango Authorization/cookies.

## Scenarios

### Scenario RW-S1: Editor Save Uses HTTP As The Durable Source Of Truth

Business logic covered:
- RW1
- RW2
- RW3
- RW4
- RW10

Given:
- A user edits a node or logic gate editor document.
- The frontend has an open WebSocket connection.
- The frontend has access to the normal HTTP API.

Expected:
- The editor sends live document updates through the node or logic gate HTTP projection route.
- The backend commits the editor projection before the live save is treated as confirmed.
- WebSocket messages may notify other clients or local caches after the committed change.
- Collaboration WebSocket updates do not replace the durable HTTP save.

### Scenario RW-S1B: Editor Saved Versions Use Explicit HTTP Version Routes

Business logic covered:
- RW1
- RW2
- RW3
- RW4
- RW16
- RW17

Given:
- A user edits a node or logic gate editor document.
- Pending projection autosaves may still be queued.
- The user clicks Save, an interval auto-save fires, or the user restores an existing saved version.

Expected:
- Manual and interval saved versions flush pending projection writes before creating the saved-version batch.
- Saved-version creation writes to the node or logic gate information table only through the save-version route.
- Per-keystroke collaboration WebSocket traffic does not create durable workspace domain events.
- Restoring a saved version asks for confirmation, then overwrites the current editor projection through the restore route.

### Scenario RW-S2: API Timeout Does Not Automatically Prove Save Failure

Business logic covered:
- RW5
- RW6
- RW7
- RW13
- RW14

Given:
- A user edits a node or logic gate editor document.
- The HTTP save request takes longer than the frontend API timeout.
- The backend may still be processing the request after the browser stops waiting.

Expected:
- The editor shows a state that is clearly different from a confirmed save.
- The editor preserves the latest local document value for retry or reconciliation.
- The UI does not imply that a WebSocket failure caused the durable save result.
- Browser request timing identifies the route and timeout status for the failed wait.

### Scenario RW-S3: Timeout Investigation Identifies The Exact Slow Route

Business logic covered:
- RW8
- RW9
- RW13
- RW14

Given:
- A user reports an API request timeout on the dev site.
- Browser request timing or the Network tab records the failed request.
- Backend logs are available for the same approximate timestamp.

Expected:
- The investigation records the HTTP method and route that reached the timeout.
- Backend logs show whether the matching request completed, failed, or never reached the backend.
- The investigation distinguishes editor save routes from background reads such as workspace snapshots, node views, logic gate views, company explorer loads, or kanban loads.
- The investigation focuses on the route, backend work, database behavior, and request fanout before changing the generic client timeout.

### Scenario RW-S4: Realtime Invalidations Stay Narrow

Business logic covered:
- RW10
- RW11
- RW12

Given:
- A committed backend event is published to realtime subscribers.
- The event includes enough data to identify an affected resource, branch, board, or user scope.

Expected:
- Realtime subscribers invalidate or refetch only the affected semantic scope when possible.
- A WebSocket reconnect or subscription rejection does not mark unrelated data as saved.
- Broad workspace refetches are reserved for missing sequence, missing scope, permission, or compatibility cases where the narrower path cannot be trusted.

### Scenario RW-S5: Logic Gate Rename Reconciles Arena And Explorer Titles

Business logic covered:
- RW1
- RW2
- RW3
- RW10
- RW15

Given:
- A logic gate is open in Logic Gate Arena.
- The same logic gate is visible in Company Explorer.
- The frontend has an open workspace WebSocket connection.

Expected:
- Renaming the logic gate from the arena title sends `PUT /v1/logic-gates/{logic_gate_id}` with the new `header`.
- After the PUT succeeds, the arena title keeps the committed header and does not fall back to the stale arena selection label.
- The backend publishes `logic_gate_updated` with `logic_gate_id` and `logic_gate.header`.
- Company Explorer applies the `logic_gate_updated` event to the matching visible row label.
- Renaming the same logic gate from Company Explorer updates the active Logic Gate Arena title from the `logic_gate_updated` workspace event.
- The app-level arena target and any collapsed Logic Gate Arena dock tab for that logic gate keep the committed label so later route changes do not reapply the old title.
- A full browser refresh is not required to see the committed logic gate header in either surface.

### Scenario RW-S6: Terminal Auth Failure Stops Realtime And Refetch Storms

Business logic covered:
- RW12
- RW18
- RW22

Given:
- A realtime ticket request, WebSocket open, API fallback refetch, or editor save receives a terminal auth failure.
- The auth layer cannot silently refresh the access token.

Expected:
- Realtime ticket requests stop.
- WebSocket reconnect attempts stop.
- Fallback refetches stop.
- Editor save attempts stop.
- Background API retries stop.
- The normal auth flow forces the existing Mango login page instead of keeping a half-authenticated work surface alive.

### Scenario RW-S7: Missing Resource 404 Does Not Refetch Forever

Business logic covered:
- RW11
- RW21
- RW22

Given:
- The client asks for a node, Logic Gate, board, or editor resource that the backend returns as `404`.
- The client may still have stale UI state, route state, or a realtime subscription for that resource.

Expected:
- The client treats the `404` as terminal for that resource.
- The client stops refetching that exact missing resource.
- The client unsubscribes from the missing resource's realtime scope when applicable.
- The client clears or closes the stale UI reference.
- The client does not retry until explicit user navigation or an authoritative event says the resource exists.

### Scenario RW-S8: Backend Replacement Reconnects Are Calm And Scoped

Business logic covered:
- RW19
- RW20
- RW22

Given:
- A new backend version is deployed and old backend workers are replaced.
- Existing WebSocket connections drop as old workers stop.
- Multiple browser tabs or users may reconnect at the same time.

Expected:
- Reconnect attempts use randomized delay so all clients do not reconnect at once.
- Reconnect attempts use exponential backoff after repeated failures.
- Reconnect behavior is capped or becomes very slow instead of retrying aggressively forever.
- A reconnect does not refetch the whole app by default.
- After reconnect, the client requests only the scoped data that may be stale for active subscriptions.

### Scenario RW-S9: Realtime Tickets Work Across Backend Workers

Business logic covered:
- RW18
- RW19
- RW23

Given:
- The dev or production backend is running more than one worker/task.
- A browser requests a realtime ticket from one backend worker.
- The subsequent WebSocket upgrade is routed to a different backend worker.

Expected:
- The ticket is accepted by the upgrade worker when it is unexpired and scoped to the requested company.
- The ticket is not exposed as a query parameter or normal JavaScript-readable credential.
- Cross-worker routing does not create repeated `401` WebSocket upgrade failures for a still-authenticated user.

### Scenario RW-S10: Attachments Use HTTP APIs, Not Realtime Byte Payloads

Business logic covered:
- RW10
- RW11
- RW24
- RW26

Given:
- A user uploads, links, unlinks, or reads an attachment.
- Other clients may be subscribed to the affected resource.

Expected:
- Browser upload policy/intent/part/complete/abort, metadata reads, link/unlink writes, and authenticated content reads use permissioned Mango HTTP routes.
- Browser raw File/Blob bytes use the short-lived presigned S3 HTTPS PUT and bypass Mango API; backend-originated producers retain the server streaming storage path.
- Realtime events may invalidate or update scoped attachment metadata.
- Realtime payloads do not include raw file bytes, base64 strings, presigned URLs, or S3 object content.
- S3 PUT requests include only exact signed headers and no Mango access token, cookies, company headers, or API-client interceptors.
- Clients fetch attachment content through the attachment HTTP content route only when they need to render or download it.

### Scenario RW-S11: Calendar Invitation RSVP Uses A Scoped HTTP Command

Business logic covered:
- RW25

Given:
- A personal or shared mailbox message contains one valid `METHOD:REQUEST` iCalendar event.
- The user chooses Accept, Tentative, or Decline in an email viewer.

Expected:
- The frontend posts the source `message_id`, normalized RSVP status, company scope, and shared inbox scope when applicable to `/v1/communications/calendar-invites/respond`.
- The endpoint requires the authenticated communications connection and shared-inbox edit access when a shared scope is supplied.
- The backend reads the source MIME, extracts the invitation UID, resolves exactly one non-cancelled event in the provider calendar, and sends the provider RSVP.
- Missing invitations or events return a validation/not-found response, and ambiguous event matches return a conflict instead of choosing an arbitrary event.
- The request does not accept or trust a client grant ID, provider event ID, calendar ID, provider token, or attachment bytes.
- Each provider request is rate-gated and the action is not sent through WebSocket.
- Expired or revoked grants, insufficient calendar scope, and provider failures return a recoverable reconnect/provider response and never report a successful RSVP or force Mango logout.
- Environment OAuth scopes must include Google/Microsoft calendar write access before integrated provider verification. Scope changes are not retroactive: existing grants must be reauthorized/reconsented after the configured scopes change. This route is invitation RSVP, not a full calendar workspace.
