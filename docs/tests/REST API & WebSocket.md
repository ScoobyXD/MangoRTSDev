Last updated: 2026-07-13

# REST API & WebSocket Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (focused backend tests exercise realtime transport, authorization, routing, dead/stalled connections, and the Kanban lookup guard for RW23 and RW37-RW40. Frontend behavior tests exercise shared-socket acceptance/reconnect/late-handler semantics, notification HTTP/socket ordering, coalescing, local-title and edit-buffer helpers, and RW15 publication-time communications/Kanban/graph cache convergence. A central source inventory proves exactly three subscription owners, and one AppLayout guard proves installation of the committed-title cache reconciliation coordinator. These are not a full mounted React request-cardinality or dirty-`contentEditable`/caret integration suite. Calendar invitation/provider response tests cover RW25; broader REST rule IDs remain unmapped.)

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
RW15 - Successful Node and Logic Gate renames publish one concrete same-window committed-title event after the HTTP command succeeds. Every supported Editor, Kanban, Node Map, Logic Gate Map, Home/My Work, and Company Explorer rename entry point patches matching mounted Editor, Kanban/Arena, map, Explorer, Home, My Work, Updates current Node/Logic Gate row, selected-panel, and open-action labels, AppLayout dock/popup/sidebar-pin, AppTimeline, and Project Management labels as applicable. For Logic Gates only, Updates also resolves saved Logic Gate grouping headers and sort values from the current title; stored notification title/body prose remains historical. The wired async title-bearing setters capture the shared registry version before awaiting and overlay only newer same-window commits before storing their result. The app-lifetime publication coordinator synchronously patches or invalidates affected title-bearing communications, project-relationship, Kanban, My Work matrix, entity-record, workspace-snapshot, and graph caches. Request-start version folding and targeted cache generation/invalidation guards prevent pre-commit requests from repopulating an old title. Denormalized persisted sidebar-pin responses overlay all latest commits. A later canonical request remains authoritative rather than being permanently masked. Passive convergence preserves dock recency, pin persistence, dirty editor text, and every active title `contentEditable` draft/caret; another user revalidates on activation/navigation because there is no broad title browser stream.
RW16 - Explicit editor saved versions are created through HTTP save-version routes after pending projection writes are flushed; the information tables store those saved versions, not every live typing update.
RW17 - Restoring an editor saved version is an HTTP restore route that overwrites the current editor projection after user confirmation; it does not publish a document or generic projection realtime message.
RW18 - A terminal `401` or failed auth refresh must make realtime and API recovery quieter: stop ticket requests, WebSocket reconnects, fallback refetches, editor saves, and background retries, then rely on the auth layer to force the normal Mango login page.
RW19 - WebSocket reconnects after backend replacement/deploy must use randomized delay, exponential backoff, and bounded or very slow retry behavior; clients must not all reconnect immediately.
RW20 - First subscription acceptance and reconnect acceptance reconcile only the active notification summary, mounted Node chat, and mounted board canonical reads. A late local handler joining an already accepted shared scope receives immediate local acceptance; accepted state resets on disconnect, rejection, or last unsubscribe. Updates adds its canonical feed read only while open. Each slow canonical read is single-flight with at most one queued final refresh; later acceptance/hints never overlap or abort/restart it, and no path refetches the whole app.
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
RW35 - A conditional `GET /v2/nodes/{node_id}/view` performs effective Node authorization first, then reads one dedicated shared node-view version and one actor-specific version. Its ETag includes company, node, actor, effective permission flags, response-contract salt, and both versions; a match returns `304` before `GetNodeView`, serialization, body hashing, object reads, or seen-state writes and never depends on `event_rows`.
RW36 - Attachment content conditionals remain HTTP-authorized: one repository read selects attachment, requested-or-original variant, and active links; specialized resource checks authorize those links; and a strong validator match returns private `304` before the single object-storage read.
RW37 - The realtime handshake rejects unauthenticated clients and token-bearing URL query authentication, signed tickets work across Server instances that share the environment signing contract, unauthorized retained scopes are denied and not stored, and closing a connection removes its subscriptions.
RW38 - Backend WebSocket writes use a bounded deadline. A send failure removes and closes the dead connection so later mutations cannot block on it; healthy subscribers continue receiving messages, and delivery-failure metrics are distinct from no-subscriber metrics.
RW39 - Notification create, delete, and clear operations publish only to the matching authenticated user's notification scope. First acceptance/reconnect reconcile canonical state. A local delete/clear marker records HTTP and socket observers separately. HTTP-first keeps the local optimistic source, while socket-first uses a canonical non-local source so open Updates reloads even if the HTTP response is lost; the matching second observer emits nothing, and after both claim the marker is removed so a distinct later clear is not suppressed. Duplicate socket frames remain suppressed while a lost response is pending. A failed HTTP request with no socket emits no update and releases its marker.
RW40 - Ordinary `node_updated` processing does not query Kanban projection rows when there are no relevant local board subscribers; a mounted local board preserves exact affected-board lookup and delivery.

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
- First acceptance and reconnect use only that scope's coalesced canonical HTTP read; Updates fetches its feed only while open.
- Ordinary workspace, Explorer, graph, My Work, Project Management, mail, permission, and document mutations emit no product socket message.

### Scenario RW-S5: Same-Window Node And Logic Gate Titles Converge

Business logic covered:
- RW1
- RW2
- RW3
- RW10
- RW15

Given:
- The same Node or Logic Gate is visible in concurrently mounted Editor, Kanban/Arena, Node Map, Logic Gate Map, Company Explorer, Home, My Work, Updates, AppLayout dock/popup/sidebar pins, AppTimeline, and Project Management caches as applicable.
- Each supported rename entry point successfully commits once; one editor document is dirty/in flight and one Editor or map title `contentEditable` has a live draft and caret.

Expected:
- Each successful HTTP rename publishes one concrete committed-title event after commit.
- All matching same-window labels converge immediately, including Updates current Node/Logic Gate row, selected-panel, and open-action labels, dock and popup-parent labels, visible Node/Logic Gate sidebar pins, current/history timeline labels, and Project Management `display_title`/workspace labels. Logic Gate titles also update Updates saved Logic Gate grouping headers and sort values; notification title/body prose stays historical, and passive updates do not bump dock recency or write pin rows.
- Dirty, debounced, queued, or in-flight editor text remains unchanged, and an actively edited title defers the incoming label without changing its DOM draft or caret.
- Failed renames publish no event.
- No workspace WebSocket event is published.
- Another user sees the new title after opening or revalidating the surface.
- A full browser refresh is not required.

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
- First acceptance and reconnect each request only the canonical data for active subscriptions; a closed Updates view requests no feed.

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
- The client starts a conditional read, changes Logic Gates, receives first subscription acceptance, and later receives a `kanban.changed` hint and reconnect acceptance.

Expected:
- The backend checks access before deciding whether to return `304`.
- ETag calculation uses the dedicated primary-key version row and actor/contract fingerprint, not domain-event searches.
- The obsolete HTTP request is aborted without committing stale state.
- First acceptance, the compact hint, and reconnect each coalesce through the same targeted work loader.
- Duplicate hints do not start a second concurrent revalidation.
- No projection-delta sequence or replay path exists.
- A `304` keeps the complete snapshot unchanged, and a `200` body contains no redundant collections.

### Scenario RW-S13: Conditional Node View And Attachment Content

Business logic covered:
- RW24
- RW35
- RW36

Given:
- An authorized client has current ETags for a consolidated Node view and one attachment variant.

Expected:
- Each conditional request reauthorizes the caller before evaluating its validator.
- The node-view match reads dedicated shared/user version rows and returns `304` without building the consolidated response or writing seen state.
- The attachment match uses the minimal attachment/link/variant read and returns `304` before S3/object storage.
- Neither route uses `event_rows` as canonical version state or exposes object-storage keys.

### Scenario RW-S14: Retained Transport Authentication, Authorization, And Routing

Business logic covered:
- RW11
- RW23
- RW37
- RW39

Given:
- Clients attempt unauthenticated and token-query WebSocket handshakes.
- One Server instance signs a ticket and another Server instance accepts the upgrade.
- An authenticated client requests an unauthorized retained scope, later subscribes to an authorized scope, and then closes.
- Notification create, delete, and clear commands commit.

Expected:
- Unauthenticated and token-query handshakes are rejected.
- The signed ticket works across Server instances under the shared signing contract.
- The unauthorized scope is denied and never stored.
- Closing removes all retained subscriptions.
- Notification create, delete, and clear publish only to the matching user scope.

### Scenario RW-S15: Acceptance Reconciliation, Dead Connections, And Board Lookup Guard

Business logic covered:
- RW20
- RW38
- RW39
- RW40

Given:
- Notification, mounted Node chat, and mounted board subscriptions receive first acceptance, later reconnect acceptance, and compact hints while a canonical read is slow; a second local same-scope handler also joins after the shared scope is already accepted.
- One WebSocket writer is slow or dead while another subscriber is healthy.
- A local notification delete/clear result is followed by its matching socket echo.
- In the opposite ordering, the server commits and the socket echo arrives before a lost/rejected HTTP response for an Updates-local Seen mutation.
- Ordinary `node_updated` publication runs both without and with a relevant local board subscriber.

Expected:
- Each active retained surface performs one single-flight canonical reconciliation on first acceptance and reconnect, with at most one queued final read and no overlap/restart; Updates fetches only while open.
- A late handler joining an already accepted shared scope receives immediate local acceptance; accepted state clears on disconnect, rejection, or last unsubscribe.
- The dead write reaches its bounded deadline, the connection is closed and evicted, and the healthy subscriber still receives delivery.
- Delivery failures and no-subscriber publishes increment distinct metrics.
- HTTP-first plus its matching echo causes at most one summary request and, subject to the local optimistic source filter, at most one open-feed request.
- Socket-first plus a lost/rejected HTTP response performs exactly one summary reconciliation and one mounted Updates feed reconciliation; the later HTTP failure emits no second update.
- No-subscriber `node_updated` performs no Kanban projection lookup; a mounted board preserves correct lookup and board-scoped delivery.
