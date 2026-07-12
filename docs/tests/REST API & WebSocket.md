Last updated: 2026-07-12

# REST API & WebSocket Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (`backend/internal/http/calendar_invite_handlers_test.go` covers invitation parsing and RSVP handler behavior; `backend/internal/http/nylas_client_test.go` covers provider event lookup/response shapes; broader REST/WebSocket rule IDs are not fully mapped yet)

## Business Logic

RW1 - Durable editor saves for nodes and logic gates use HTTP API write routes, not WebSocket messages.
RW2 - Generic editor/document WebSocket delivery is absent. Another user sees durable editor content after reopen, navigation, focus revalidation, or manual refresh.
RW3 - A successful live editor autosave requires the HTTP projection write route to commit the current editor projection before the editor treats the live save as confirmed.
RW4 - The former whole-document collaboration endpoint, client, and presence UI are deleted. Future Huddle CRDT/OT work is a separate explicit product project.
RW5 - A frontend API timeout means the browser stopped waiting for an HTTP response; it does not by itself prove whether the backend committed or failed the write.
RW6 - Timed-out, failed, pending, and confirmed editor saves must be distinguishable in the user-visible editor state.
RW7 - A timed-out editor save must leave enough information to retry or reconcile the latest local document value.
RW8 - Timeout investigations must identify the exact HTTP method, route, request duration, and backend log line for the affected request.
RW9 - Backend request logs must make it possible to distinguish slow durable writes from slow background reads or refetches.
RW10 - Realtime is a post-commit wake-up only for notifications, mounted Node chat, and a mounted Logic Gate Kanban board; it never writes or carries durable editor content.
RW11 - Exactly three product scope families exist: `notifications:user:{user_id}`, `chat:node:{node_id}`, and `board:{board_id}`. Broad workspace, Explorer, graph, GVIC/My Work, Project Management, communications, permission, and generic editor scopes are forbidden.
RW12 - WebSocket reconnects or subscription failures must not be reported as successful durable saves.
RW13 - Browser-side API request timing should make status=error timeout cases visible with the route that timed out.
RW14 - Dev or production timeout triage must consider backend, database, and cache-refetch load before changing the client timeout threshold.
RW15 - Logic gate header renames are committed through `PUT /v1/logic-gates/{logic_gate_id}` and reconcile the initiating browser's active Arena title, app target, and visible local labels from the committed response/local command-result propagation. Another user revalidates on activation/navigation; there is no `logic_gate_updated` browser stream.
RW16 - Explicit editor saved versions are created through HTTP save-version routes after pending projection writes are flushed; the information tables store those saved versions, not every live typing update.
RW17 - Restoring an editor saved version is an HTTP restore route that overwrites the current editor projection after user confirmation; it does not publish a document or generic projection realtime message.
RW18 - A terminal `401` or failed auth refresh must make realtime and API recovery quieter: stop ticket requests, WebSocket reconnects, fallback refetches, editor saves, and background retries, then rely on the auth layer to force the normal Mango login page.
RW19 - WebSocket reconnects after backend replacement/deploy must use randomized delay, exponential backoff, and bounded or very slow retry behavior; clients must not all reconnect immediately.
RW20 - WebSocket reconnect recovery is limited to active notification summary, mounted Node chat, and mounted board canonical reads. It never refetches the whole app.
RW21 - A `404` for a node, Logic Gate, or other resource is terminal for that resource until explicit user navigation or an authoritative event says the resource exists; the client must stop refetching that exact missing resource and unsubscribe from its realtime scope.
RW22 - Failure handling for `401`, `404`, and WebSocket disconnects must reduce frontend/backend work rather than creating retry, reconnect, or fallback-refetch storms.
RW23 - Realtime WebSocket tickets must be short-lived, HTTP-only, and valid across backend worker instances in the same environment so a ticket issued by one ECS task can be accepted by another task during WebSocket upgrade.
RW24 - Attachment upload control, metadata, linking, and content reads are HTTP operations. No attachment WebSocket message exists, and socket payloads never carry file bytes, base64 blobs, presigned URLs, or S3 object contents.
RW25 - Calendar invitation responses use authenticated `POST /v1/communications/calendar-invites/respond` HTTP requests. The request supplies the company/mailbox scope plus `message_id` and `status` (`yes`, `maybe`, or `no`); the backend resolves the iCalendar UID and exactly one provider event under the authorized personal/shared mailbox scope instead of accepting client-supplied grant, calendar, or event identifiers. Shared inbox responses require edit access, WebSocket messages never send the RSVP, and expired/revoked grants or missing calendar scope return a recoverable mailbox/provider error rather than Mango logout or false success.
RW26 - Normal browser upload uses Mango HTTP JSON endpoints for policy, intent creation/state, multipart signing, completion, and abort, then raw HTTPS PUT directly to private S3 through the presigned URL. Mango API requests and WebSocket payloads never carry the browser file body. Intent creation carries active company context only in the membership-validated `X-Mango-Company-ID` Mango header, never in intent JSON or an S3 request; the S3 request also never carries Mango Authorization/cookies.
RW27 - `GET /v2/logic-gates/{logic_gate_id}/work` is the primary Kanban-specific Arena read and returns only `logic_gate`, actor `permissions`, `board`, `columns`, and minimal `cards`. The legacy `GET /v1/logic-gate-arena` route may delegate to the same representation but is not the primary path.
RW28 - The Logic Gate work response omits top-level repeated IDs, statuses, assignments, nodes, cards limits, and the full GVIC collection; contract tests must assert both required fields and absent redundant fields.
RW29 - A conditional Logic Gate work request performs owning-gate authorization first, then reads one `logic_gate_work_versions` primary-key row; it must not search multiple `domain_events` payload shapes to calculate an ETag.
RW30 - Logic Gate work ETags include actor identity/permission flags and a response-contract salt in addition to the work version, so permission and code-only representation changes cannot reuse an unsafe `304`.
RW31 - Arena HTTP reads accept an `AbortSignal`; selecting another Logic Gate cancels the obsolete request, and an aborted request does not report an application error or commit response state.
RW32 - A `kanban.changed` hint on the mounted `board:{board_id}` scope coalesces one targeted canonical `/work` revalidation. There is no browser projection delta, sequence, replay, or broad workspace refetch.
RW33 - One committed card-visible change publishes only to each affected mounted board scope, and one logical change cannot start duplicate board revalidations.
RW34 - `304 Not Modified` reuses the current complete snapshot without clearing board state or creating duplicate render churn.

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
- The frontend has access to the normal HTTP API.

Expected:
- The editor sends live document updates through the node or logic gate HTTP projection route.
- The backend commits the editor projection before the live save is treated as confirmed.
- No editor/document or collaboration WebSocket message is sent.
- Another user sees the durable value after reopening or revalidating the editor.

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
- No per-keystroke collaboration WebSocket traffic or endpoint exists.
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

### Scenario RW-S4: Only Explicit Product Scopes Publish

Business logic covered:
- RW10
- RW11
- RW12

Given:
- A durable notification, Node chat change, or mounted-board-visible mutation commits.
- A matching retained scope has a local subscriber.

Expected:
- The backend publishes only to the matching notification, Node chat, or board scope.
- Reconnect uses that scope's canonical HTTP read when needed.
- Ordinary workspace, Explorer, graph, My Work, Project Management, mail, permission, and document mutations emit no product socket message.

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
- The same browser has the relevant mounted surfaces.

Expected:
- Renaming the logic gate from the arena title sends `PUT /v1/logic-gates/{logic_gate_id}` with the new `header`.
- After the PUT succeeds, the arena title keeps the committed header and does not fall back to the stale arena selection label.
- Local committed-response propagation updates the visible labels in the initiating browser.
- No workspace WebSocket event is published.
- Another user sees the new title after opening or revalidating the surface.
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
- Other clients may later open the affected resource.

Expected:
- Browser upload policy/intent/part/complete/abort, metadata reads, link/unlink writes, and authenticated content reads use permissioned Mango HTTP routes.
- Browser raw File/Blob bytes use the short-lived presigned S3 HTTPS PUT and bypass Mango API; backend-originated producers retain the server streaming storage path.
- Attachment changes use canonical HTTP reads and local command responses only.
- Realtime payloads do not include attachment metadata, raw file bytes, base64 strings, presigned URLs, or S3 object content.
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

### Scenario RW-S12: Conditional Logic Gate Work And Mounted Board Hint

Business logic covered:
- RW27
- RW28
- RW29
- RW30
- RW31
- RW32
- RW33
- RW34

Given:
- An authorized Arena client has a complete Logic Gate work snapshot and ETag.
- The client starts a conditional read, changes Logic Gates, and later receives a `kanban.changed` hint.

Expected:
- The backend checks access before deciding whether to return `304`.
- ETag calculation uses the dedicated primary-key version row and actor/contract fingerprint, not domain-event searches.
- The obsolete HTTP request is aborted without committing stale state.
- The compact hint coalesces one targeted work read.
- Duplicate hints do not start a second concurrent revalidation.
- No projection-delta sequence or replay path exists.
- A `304` keeps the complete snapshot unchanged, and a `200` body contains no redundant collections.
