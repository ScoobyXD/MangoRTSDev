# Notifications V1 Project Tracker

This is the project document for rebuilding MangoRTS notifications around domain events, effective resource access, and role-aware notification routing.

Use this as the working tracker for Codex instances. Keep it updated as work lands. Do not treat this as a brainstorming document once implementation starts; update checkboxes, notes, and follow-up tasks with concrete findings.

## Purpose

The goal is to make notifications simple, reliable, and cheap:

```text
domain event happens
event identifies affected resource targets
effective_resource_access expands eligible recipients
domain relationship tables classify each recipient's notification role
notification rows are written idempotently
read-time access filtering remains only as a final safety guard
```

Do not rebuild the old behavior where handlers loop through resources or users and call recursive permission checks one at a time. Notification fanout must be based on indexed reverse lookups from `effective_resource_access`.

## Core Decisions

### Effective Access

`effective_resource_access` is the notification eligibility read model.

It answers:

```text
Which users can view/edit/admin resource R?
```

For notification fanout, the primary question is usually:

```text
Which users can view resource R?
```

If a user does not have an effective access fact for the resource, they must not receive a resource notification.

### Resource Access Grants

The target notification architecture must not depend on `resource_access_grants` directly.

Important migration rule:

- Do not delete `resource_access_grants` until all effective-access source facts that still depend on it have been replaced, tests prove no runtime path depends on it, and the database migration plan is explicit.
- For Notifications V1, remove it from notification runtime logic first.
- Later backend cleanup can deprecate or delete the table once V4 effective-access source writers fully replace it.

### RACI

RACI is not access control at notification time.

RACI is notification classification and UI routing metadata:

- Responsible
- Accountable
- Consulted
- Informed

The access question is answered by `effective_resource_access`.

The notification kind, priority, destination, label, and copy can be influenced by `logic_gate_raci_assignments` or shared inbox RACI tables.

### Domain Events

Notifications should be created from committed domain events, not scattered HTTP-handler side effects.

The durable event stream should be the normal input. HTTP handlers may still trigger processing immediately after commit during the first implementation, but the business rule should live in a notification projector, not in route-specific notification snippets.

### Read-Time Filtering

Read-time notification visibility filtering is useful as a final safety guard.

It must not be the primary routing system. If notification rows are not created for the right users at event-processing time, the bug should be visible in tests.

## Current State

What exists:

- `effective_resource_access` exists.
- It supports reverse lookups by `(company_id, resource_type, resource_id, user_id)`.
- Notification storage tables exist.
- Notification API endpoints and frontend summary/SSE consumers exist.
- The notification service already has helper logic for reverse effective-access recipient expansion.
- Workspace fanout already extracts access targets from domain events.
- Logic Gate RACI assignments exist and are useful for recipient role classification.

What is still broken or incomplete:

- Active V2 Logic Gate work endpoints publish domain events but do not create notification rows.
- The frontend uses the V2 Logic Gate work endpoints for normal assignment/state updates.
- Old Kanban/work-item paths still contain notification side effects.
- Notification creation is still mostly handler-driven through `RecordAndProcess`.
- `notification_events` has pending-processing code, but there is no reliable always-on notification worker.
- Shared inbox/shared triage notification cases are mostly placeholders.
- Shared inbox RACI/access mutations are not consistently refreshing or transactionally updating effective access.
- Some notification tests cover old paths, not the active V2 Logic Gate workflow.
- Full-company effective-access rebuilds still appear in correctness paths.

## Architecture Rules

- Notification fanout must start from domain events.
- Resource notifications must use reverse `effective_resource_access` lookups.
- Do not loop all users and call per-user recursive permission checks.
- Do not call `UserCanAccessEntity` from notification fanout.
- Do not call `ListAccessibleEntityIDs` from notification fanout.
- Do not treat Kanban board/card permissions as canonical for Logic Gate work.
- Logic Gate work notifications should be based on Logic Gate and node assignment domain events.
- Node notifications should be based on node events and mention/comment events.
- Shared inbox notifications should be based on shared inbox/shared triage domain events.
- RACI tables classify notification roles; they do not replace access eligibility.
- Mention notifications can target explicit mentioned users, but still need resource access validation unless product explicitly supports external mentions.
- Actor self-notification behavior must be explicit per event type.
- Notification inserts must be idempotent.
- Tests must fail if active notification paths fall back to recursive permission loops.

## Target Notification Model

### Event Input

Each notification-worthy change should produce or map to a domain event with:

- `company_id`
- `actor_user_id`
- event type
- resource target IDs
- enough payload to render a stable notification
- enough payload to classify notification role when needed

### Resource Targets

Each event maps to one or more resource targets:

```text
node event              -> node:{node_id}
Logic Gate event        -> logic_gate:{logic_gate_id}
Logic Gate work event   -> logic_gate:{logic_gate_id}, node:{node_id}
shared inbox event      -> shared_triage_folder:{folder_id}
mention event           -> node:{node_id} or related artifact target
```

The target extraction should be centralized. Do not duplicate target-parsing logic in every handler.

### Recipient Expansion

For each resource target, expand recipients using an indexed reverse lookup:

```text
ListEffectiveUsersForResource(company_id, resource_type, resource_id, min_access=view)
```

Merge recipients across targets by user ID.

Do not perform one database query per user.

### Role Classification

After recipient expansion, classify recipients:

- Logic Gate RACI role from `logic_gate_raci_assignments`.
- Shared inbox role from shared inbox RACI assignment tables.
- Node assignee/responsible role from node assignment source data.
- Mention role from explicit mention payload.
- Actor role from the event actor.
- General viewer role for users who have access but no stronger relationship.

Classification should determine:

- notification role: responsible, accountable, consulted, informed, mention, assignee, viewer, other
- surface: work, RACI, node, shared inbox, mention, general
- priority or grouping bucket
- whether self-notification is skipped

### Notification Output

Create one notification row per intended recipient per event classification.

Each row should include:

- recipient user ID
- source event ID
- notification type
- primary resource entity type and ID
- access targets needed for final visibility filtering
- role/surface metadata
- dedupe key behavior that prevents duplicate rows from retries

## Event Taxonomy

Use this as the first V1 taxonomy. Adjust only with a concrete reason and update tests with the change.

### Node Events

- `node.mention_created`
- `node.comment_created`
- `node.assigned`
- `node.assignment_changed`
- `node.fields_changed`

Expected routing:

- Mentions notify explicitly mentioned users who can access the node.
- Assignment changes notify assigned/responsible users and relevant Logic Gate RACI users when the node is in Logic Gate work.
- Field changes should be lower priority unless the user is directly assigned, mentioned, or RACI-related through a Logic Gate context.

### Logic Gate Events

- `logic_gate.raci_changed`
- `logic_gate.assignment_added`
- `logic_gate.assignment_moved`
- `logic_gate.assignment_removed`
- `logic_gate.progress_changed`
- `logic_gate.issue_toggled`

Expected routing:

- Responsible users get responsible-role notifications.
- Accountable users get accountable-role notifications.
- Consulted and informed users get ACI-role notifications.
- Users with effective access but no RACI role may get general/informational notifications only if the product wants broad fanout for that event type.
- Actor self-notification behavior must be explicit.

### Shared Inbox Events

- `shared_inbox.item_created`
- `shared_inbox.item_assigned`
- `shared_inbox.item_status_changed`
- `shared_inbox.raci_changed`
- `shared_inbox.access_changed`

Expected routing:

- Shared inbox recipients come from effective access on the shared triage folder or item parent folder.
- Shared inbox RACI classifies role and priority.
- Access-change events should be careful: users who lost access should not receive details after revocation.

## V1 Definition Of Done

Notifications V1 is complete when all of these are true:

- Active V2 Logic Gate work mutations create correct notification rows.
- Node mentions create correct notification rows.
- Node assignment changes create correct notification rows.
- Shared inbox/shared triage events create correct notification rows for at least the first supported event set.
- Notification recipient expansion uses reverse `effective_resource_access`.
- Notification fanout does not call legacy recursive permission functions.
- Notification logic is centralized in a projector/service, not scattered through route handlers.
- Notification inserts are idempotent across retries.
- Pending/unprocessed notification events are either processed by a reliable worker or removed in favor of domain-event projection.
- Read-time filtering is retained as a safety guard.
- Tests cover revocation before processing and revocation after delivery.
- Tests cover RACI role classification.
- Tests cover actor self-notification rules.
- Tests cover the active frontend V2 Logic Gate paths.

## Progress Tracker

Status values:

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done
- `[!]` Blocked

### Phase 1 - Projector Core And Active Logic Gate Notifications

This phase should be one Codex instance. It includes the minimal audit needed to avoid wiring the wrong path.

- [x] List active Logic Gate work routes that publish domain events but do not create notifications.
- [x] Confirm current notification producers and whether `ProcessPending` is started anywhere.
- [x] Add a notification projector API that accepts committed domain events.
- [x] Keep HTTP handlers out of event-specific notification business logic.
- [x] Add event target extraction helpers for Logic Gate work notification fanout.
- [x] Reuse or align with workspace event target extraction.
- [x] Define actor self-notification defaults for Logic Gate work events.
- [x] Map `work_item.logic_gate_assignment_saved` to notification behavior.
- [x] Map `work_item.logic_gate_assignment_moved` to notification behavior.
- [x] Map `work_item.logic_gate_assignment_removed` to notification behavior.
- [x] Map `work_item.logic_gate_assignment_issue_toggled` to notification behavior.
- [x] Wire V2 Logic Gate work handlers to invoke the projector after domain events commit.
- [x] Avoid resurrecting old Kanban snapshot notification logic.
- [x] Use `effective_resource_access` to expand Logic Gate recipients.
- [x] Use `logic_gate_raci_assignments` to classify R/A/C/I notification roles.
- [x] Ensure notification row inserts are idempotent for retried Logic Gate events.
- [x] Add unit tests for Logic Gate target extraction and RACI recipient classification.
- [x] Add tests proving V2 Logic Gate work state changes create notifications.
- [x] Add tests proving users without effective Logic Gate access do not receive notifications.
- [x] Add or update a source-shape test so the V2 Logic Gate notification path cannot call `UserCanAccessEntity` or old recursive permission fanout.
- [x] Update this tracker with exact files touched and any follow-up findings.

Phase 1 implementation update:

- Active V2 Logic Gate work mutation routes audited: `POST /v2/logic-gates/{logic_gate_id}/nodes`, `PUT /v2/logic-gates/{logic_gate_id}/nodes/{node_id}/state`, and `DELETE /v2/logic-gates/{logic_gate_id}/nodes/{node_id}` commit `work_item.logic_gate_assignment_saved`, `work_item.logic_gate_assignment_moved`, `work_item.logic_gate_issue_toggled`, and `work_item.logic_gate_assignment_removed` domain events but previously did not create notification rows.
- Current notification producers are still the legacy handler-side `recordNotificationEvent`/`RecordAndProcess` paths for RACI, node, mention, and old Kanban state notifications. `ProcessPending` exists on `notifications.Service`, but no server startup path or worker currently starts it.
- Added `notifications.Service.ProcessDomainEvent` and `ProcessDomainEvents` as the projector seam for committed `domain.DomainEvent` values. V2 Logic Gate work handlers now call this projector after commit/workspace publish; event-specific notification rules live in the notification service, not in the handlers.
- Logic Gate work projector behavior now supports saved, moved, removed, and issue-toggled work-item events. It extracts Logic Gate and node target metadata, expands recipients with reverse `effective_resource_access` lookups on the Logic Gate for this Phase 1 path, classifies recipients with `logic_gate_raci_assignments` when available, skips actor self-notifications, and relies on existing notification insert idempotency by recipient/source event/type/entity.
- Added tests in `backend/internal/notifications/service_test.go` for domain-event projection, Logic Gate/node target extraction, RACI role classification, Logic Gate access eligibility, no-access exclusion, and idempotent replay.
- Added a route-level V2 test in `backend/internal/http/logic_gate_work_handlers_test.go` proving a V2 state change creates notifications for eligible users and not for the actor or blocked users.
- Updated `backend/internal/store/logic_gate_work_test.go` source-shape guard to reject `UserCanAccessEntity` and old Kanban notification helper calls from the V2 Logic Gate work handler path.
- Files touched: `backend/internal/notifications/service.go`, `backend/internal/notifications/service_test.go`, `backend/internal/http/logic_gate_work_handlers.go`, `backend/internal/http/logic_gate_work_handlers_test.go`, `backend/internal/http/notification_handlers.go`, `backend/internal/store/logic_gate_work_test.go`, and this tracker.
- Validation run: `go test ./...` from `backend`.
- Follow-up finding: `notification_events` pending processing remains unstarted and should be addressed in Phase 3 unless the project fully standardizes on domain-event projection before then.

### Phase 2 - Node, Mention, Shared Inbox, And Role Coverage

This phase should be one Codex instance. It expands the projector to the other V1 resources after the Logic Gate projector path exists.

- [x] Route node mention events through the projector.
- [x] Validate mentioned users against effective node access.
- [x] Route node assignment changes through the projector.
- [x] Classify assignees separately from general node viewers.
- [x] Decide whether node field changes notify all viewers or only related users.
- [x] Confirm canonical resource type for shared inbox notification targets.
- [x] Confirm which shared inbox item events are in V1 scope.
- [x] Add shared inbox/shared triage event target extraction.
- [x] Use reverse effective access on shared triage folders.
- [x] Use shared inbox RACI assignment tables for role classification.
- [x] Make `shared_inbox.raci_changed` create meaningful notifications.
- [ ] Make supported item/status/assignment events create meaningful notifications.
- [x] Identify any shared inbox access/RACI mutation that still depends on a full-company effective-access rebuild.
- [x] Add tests for mention access filtering.
- [x] Add tests for node assignment notifications.
- [x] Add tests for actor self-notification behavior.
- [x] Add tests for shared inbox RACI routing.
- [x] Add tests for access revocation before event processing.
- [x] Update this tracker with exact files touched and any follow-up findings.

Phase 2 implementation update:

- Audited current producers for node mentions, node assignment/update notifications, shared inbox access, and shared inbox RACI. Node mention and node assignment notifications were still created through handler-side `RecordAndProcess`; shared inbox access/RACI events published workspace events but had placeholder notification behavior in the projector.
- Node mentions now append committed `node.mention_created` domain events on a notification stream and invoke the projector. The event remains per mentioned user for idempotency across repeated edits to the same information ID, but recipient eligibility is enforced in `notifications.Service` through reverse effective node access before creating rows.
- Node assignment and selected field-change notifications now come from committed `node_updated` domain events carrying an explicit `notification_event_type` payload marker. Generic `node_updated` events from other systems, including Logic Gate work compatibility events, do not become node notifications unless that marker is present.
- V1 node field-change policy: only the current assignee is notified, only for status, due date, or priority changes, and only if the assignee still has effective node access. Broad node-viewer field-change fanout is intentionally deferred.
- Node assignee notifications are classified separately from general node viewers with `surface=my_triage` and `role=other`. The current schema does not yet have an `assignee` notification role, so Phase 2 uses the existing `other` role and the distinct `my_triage` surface.
- Canonical shared inbox/shared triage notification target is `shared_triage_folder:{folder_id}`. The first supported shared inbox event set is `communications_shared_inbox_raci_updated` and `shared_triage_access_updated`; item/status/assignment notification events remain deferred until their canonical item event payloads are defined.
- Shared inbox/shared triage projector support now maps `communications_shared_inbox_raci_updated` to `aci_inbox.raci_updated` and `shared_triage_access_updated` to `aci_inbox.changed`. Recipients are expanded with reverse effective access on `shared_triage_folder`, then classified from shared inbox RACI assignment tables, including group assignments expanded through company user group membership.
- Shared inbox access/RACI handlers now refresh the effective-access projection before immediate projection and then pass the committed workspace event into the notification projector. This keeps Phase 2 behavior correct, but the path still depends on a full-company effective-access rebuild rather than source-scoped transactional effective-access writers.
- Added a small Postgres compatibility guard so domain-event-projected notifications can satisfy the existing `notifications.source_event_id -> notification_events.event_id` foreign key by inserting a processed anchor notification event when needed. This does not start or otherwise change pending queue processing semantics.
- Added tests in `backend/internal/notifications/service_test.go` for node mention access filtering, node assignment fanout and actor self-suppression, assignment revocation before processing, shared inbox RACI routing and role classification, shared triage access revocation before processing, and broader notification source-shape guards.
- Updated route-level expectations in `backend/internal/http/notification_handlers_test.go` for node assignment/field-change notifications to use the `my_triage` assignee classification.
- Files touched: `backend/internal/notifications/service.go`, `backend/internal/notifications/service_test.go`, `backend/internal/http/notification_handlers.go`, `backend/internal/http/notification_handlers_test.go`, `backend/internal/http/node_handlers.go`, `backend/internal/http/workspace_handlers.go`, `backend/internal/http/communications_shared_inbox_handlers.go`, `backend/internal/http/company_explorer_handlers.go`, `backend/internal/store/repository.go`, `backend/internal/store/node_graph_workspace_events.go`, `backend/internal/store/memory_nodes.go`, `backend/internal/store/postgres_nodes.go`, `backend/internal/store/postgres_notifications.go`, and this tracker.
- Validation run: `go test ./...` from `backend` on May 22, 2026.
- Follow-up finding: `notification_events.ProcessPending` is still not started anywhere and remains Phase 3 reliability work.
- Follow-up finding: shared inbox RACI/access correctness still relies on full-company effective-access rebuilds. `SetCommunicationsSharedInboxRaciAssignments` and shared triage `SetEntityPermissions` should eventually move to source-scoped effective-access writers aligned with Backend Refactor V4 before `resource_access_grants` can be considered for removal.

### Phase 3 - Reliability, Legacy Removal, And Final Validation

This phase should be one Codex instance. It hardens the system after V1 event coverage exists.

- [ ] Decide whether `notification_events` remains as a queue or is replaced by domain-event projection.
- [ ] If `notification_events` remains, start a reliable processor on server startup.
- [ ] If domain events become the queue, add projector state/checkpointing or idempotent replay.
- [ ] Ensure notification row inserts are idempotent by source event and recipient.
- [ ] Ensure retries do not duplicate SSE publishes in a harmful way.
- [ ] Add tests for duplicate event processing.
- [ ] Add tests for failed processing and retry behavior.
- [ ] Remove notification logic tied to old Kanban card snapshots once V2 coverage exists.
- [ ] Remove handler-specific event construction that duplicates domain event payloads.
- [ ] Remove notification fanout paths that depend on legacy permission helpers.
- [ ] Remove or quarantine unused notification event types.
- [ ] Add source-shape tests that fail on `UserCanAccessEntity` inside notification fanout.
- [ ] Add source-shape tests that fail on old Kanban notification helpers from active V2 paths.
- [ ] Identify remaining notification correctness dependency on full-company effective-access rebuilds.
- [ ] Document which access source facts must be transactionally maintained before deleting `resource_access_grants`.
- [ ] Make shared inbox RACI/access mutations update effective access or call a temporary refresh with a TODO to replace it.
- [ ] Coordinate with Backend Refactor V4 for source-scoped effective-access writers.
- [ ] Confirm all notification tests pass without relying on full rebuild side effects.
- [ ] Confirm notification summary updates after V2 Logic Gate work changes.
- [ ] Confirm notification list renders Logic Gate RACI role metadata correctly.
- [ ] Confirm mention notifications deep-link to the node or artifact.
- [ ] Confirm shared inbox notifications deep-link to the correct shared inbox surface.
- [ ] Confirm SSE updates are received after notification row creation.
- [ ] Confirm polling still backfills missed SSE messages.
- [ ] Run backend tests and relevant frontend checks.
- [ ] Add a final audit note to this document with any intentionally retained legacy code.

## Files To Inspect First

- `backend/internal/notifications/service.go`
- `backend/internal/store/postgres_notifications.go`
- `backend/internal/store/memory_notifications.go`
- `backend/internal/http/notification_handlers.go`
- `backend/internal/http/logic_gate_work_handlers.go`
- `backend/internal/http/logic_gate_raci_command_handlers.go`
- `backend/internal/http/logic_gate_handlers.go`
- `backend/internal/http/node_handlers.go`
- `backend/internal/http/work_item_handlers.go`
- `backend/internal/http/kanban_handlers.go`
- `backend/internal/http/company_explorer_handlers.go`
- `backend/internal/http/communications_shared_inbox_handlers.go`
- `backend/internal/store/postgres_effective_access.go`
- `backend/internal/store/workspace_effective_fanout.go`
- `backend/internal/store/workspace_event_fanout.go`
- `backend/internal/store/work_item_assignment_workspace_events.go`
- `backend/internal/domain/types.go`
- `backend/db/migrations/20260517_notifications.sql`
- `backend/db/migrations/20260522_effective_resource_access.sql`
- `frontend/src/modules/notifications/notificationsApi.ts`
- `frontend/src/modules/notifications/useNotificationSummary.ts`
- `frontend/src/modules/kanban/kanbanApi.ts`

## Known Current Breakpoints

These are known from the initial investigation. Verify them before implementing, because code may have moved.

- `backend/internal/http/logic_gate_work_handlers.go` V2 work mutations publish workspace/domain events but do not create notifications.
- `frontend/src/modules/kanban/kanbanApi.ts` uses the V2 Logic Gate work endpoints for normal active work-board flows.
- `backend/internal/notifications/service.go` has reverse effective-access recipient helpers, but the service is driven by `notification_events` instead of domain events.
- `backend/internal/http/notification_handlers.go` creates notifications as a best-effort handler side effect.
- `backend/internal/store/workspace_effective_fanout.go` already centralizes event target extraction for workspace fanout and should be reused or mirrored.
- Shared inbox notification constants/helpers exist, but supported shared inbox events currently produce little or no notification output.

## Implementation Notes

### Projector Shape

Prefer a service shape like:

```go
type Projector struct {
    repo Repository
}

func (p *Projector) ProcessDomainEvent(ctx context.Context, event domain.DomainEvent) ([]domain.Notification, error)
func (p *Projector) ProcessDomainEvents(ctx context.Context, events []domain.DomainEvent) ([]domain.Notification, error)
```

The projector should:

1. Extract targets from event payload.
2. Expand recipient users from effective access.
3. Load classification metadata in bounded queries.
4. Build notification inputs.
5. Insert idempotently.

### Recipient Algorithm

Use this shape:

```text
recipients = map[user_id]RecipientContext

for target in event.targets:
    users = ListEffectiveUsersForResource(company_id, target.type, target.id, view)
    merge users into recipients with target context

roles = load role metadata for all recipient ids in bounded queries

for recipient in recipients:
    if should_skip_actor_self_notification(event, recipient):
        continue
    notification = classify(event, recipient, roles)
    insert notification idempotently
```

Do not use this shape:

```text
for user in all_company_users:
    if UserCanAccessEntity(user, target):
        create notification
```

### Logic Gate RACI Classification

For Logic Gate work events:

1. Expand recipients from effective access on the Logic Gate.
2. Load RACI assignments for the Logic Gate.
3. For each recipient:
   - responsible -> responsible notification role
   - accountable -> accountable notification role
   - consulted -> consulted notification role
   - informed -> informed notification role
   - no RACI role -> general or no notification depending on event policy

RACI classification should not grant the notification by itself. The user must also be eligible through effective access.

### Mention Classification

For mention events:

1. Start from explicit mentioned user IDs.
2. Validate each mentioned user against effective access on the mentioned resource.
3. Create direct mention notifications.

Mentions are allowed to be narrower than full resource fanout.

### Shared Inbox Classification

For shared inbox events:

1. Determine the shared triage folder target.
2. Expand recipients from effective access on the shared triage folder.
3. Load shared inbox RACI role data.
4. Classify recipient notification role.

Access changes are sensitive. If the event removes access, do not leak details to users after revocation.

## Testing Requirements

Each implementation PR should add tests at the lowest useful layer and at least one route-level test for active user paths.

Required test categories:

- V2 Logic Gate work mutation creates notifications.
- Notification fanout uses reverse effective access.
- Users without effective access do not receive notifications.
- RACI role changes notification role/classification.
- Duplicate event processing does not duplicate rows.
- Actor self-notification matches the explicit rule.
- Revocation before processing suppresses notification creation.
- Revocation after delivery hides or removes visibility through read-time guard.
- Shared inbox routing respects shared triage effective access.
- Source-shape tests reject legacy recursive permission checks in notification fanout.

## Codex Handoff Prompts

Use one prompt per implementation instance. The intended project plan is three Codex instances total.

### Phase 1 Prompt

```text
We are starting Notifications V1. Read docs/important tasks/notifications-v1-project-tracker.md, docs/important tasks/backend-refactor-v4.md, and the current notification/workspace fanout code before editing.

Goal for this PR:
Build the notification projector seam and fix active V2 Logic Gate work notifications without reintroducing per-user permission loops.

Context:
- effective_resource_access is the runtime fanout read model.
- Notification recipients must be expanded with reverse effective access lookups.
- RACI tables classify notification role only after access eligibility is known.
- Active frontend Logic Gate work flows call V2 endpoints in frontend/src/modules/kanban/kanbanApi.ts.
- backend/internal/http/logic_gate_work_handlers.go publishes committed workspace/domain events but does not currently create notifications.
- Old Kanban notification helpers should not become the new source of truth.

Tasks:
1. Audit the V2 Logic Gate work handlers and the domain events they publish.
2. Confirm current notification producers and whether ProcessPending is started anywhere.
3. Add or introduce a notification projector entry point that can process committed domain.DomainEvent values.
4. Support Logic Gate assignment saved/moved/removed/issue-toggled events for V2 where the current domain events allow it.
5. Use reverse effective_resource_access recipient expansion.
6. Use logic_gate_raci_assignments to classify recipient notification role when available.
7. Keep notification row inserts idempotent.
8. Add tests proving a V2 Logic Gate work state change creates notifications for eligible users.
9. Add tests proving users without effective access do not receive notifications.
10. Add or update a source-shape test so this path cannot call UserCanAccessEntity or old recursive permission fanout.
11. Run backend tests.

Do not delete resource_access_grants in this PR. Do not rewrite all notification types in this PR. Keep the change focused on the V2 Logic Gate work path and the projector seam needed for later phases.

After finishing, update docs/important tasks/notifications-v1-project-tracker.md with completed checkboxes and any follow-up findings.
```

### Phase 2 Prompt

```text
Continue Notifications V1. Read docs/important tasks/notifications-v1-project-tracker.md first, then inspect the projector created in Phase 1 before editing.

Goal for this PR:
Extend the projector to node mentions, node assignment notifications, and the first supported shared inbox/shared triage notifications.

Context:
- Phase 1 should already have a projector that processes committed domain.DomainEvent values.
- effective_resource_access remains the eligibility source.
- Mentions can start from explicit mentioned user IDs, but recipients still need effective access validation.
- Shared inbox/shared triage notifications should use shared triage effective access and shared inbox RACI metadata.

Tasks:
1. Route node mention events through the projector.
2. Validate mentioned users against effective node access.
3. Route node assignment changes through the projector.
4. Classify assignees separately from general node viewers.
5. Decide and document the V1 policy for node field-change notifications.
6. Confirm canonical shared inbox/shared triage notification targets.
7. Implement shared inbox/shared triage target extraction for the first supported event set.
8. Use shared inbox RACI tables to classify recipient roles after effective access eligibility.
9. Identify any shared inbox access/RACI path that still depends on a full-company effective-access rebuild.
10. Add tests for mention access filtering, node assignment notifications, shared inbox RACI routing, actor self-notification, and revocation before event processing.
11. Run backend tests.

Do not rewrite reliability/queue semantics in this PR unless a small change is required to make these event types work. Do not delete legacy notification paths yet unless they are directly replaced by the projector.

After finishing, update docs/important tasks/notifications-v1-project-tracker.md with completed checkboxes and any follow-up findings.
```

### Phase 3 Prompt

```text
Finish Notifications V1 hardening. Read docs/important tasks/notifications-v1-project-tracker.md and inspect the projector plus all remaining legacy notification callsites before editing.

Goal for this PR:
Make notification processing reliable, remove or quarantine replaced legacy notification paths, and validate frontend-visible behavior.

Context:
- Phase 1 should cover active V2 Logic Gate work notifications.
- Phase 2 should cover node mentions/assignments and initial shared inbox/shared triage notifications.
- This phase should not introduce new notification taxonomy unless a test exposes a missing case.

Tasks:
1. Decide whether notification_events remains as a queue or domain_events becomes the projector queue.
2. If notification_events remains, start reliable pending processing on server startup.
3. If domain_events becomes the queue, add the needed projector checkpointing or idempotent replay behavior.
4. Confirm notification inserts are idempotent by source event and recipient.
5. Add tests for duplicate event processing and failed processing/retry behavior.
6. Remove notification logic tied to old Kanban card snapshots once V2 coverage exists.
7. Remove or quarantine route-specific notification code that duplicates projector behavior.
8. Add source-shape tests rejecting UserCanAccessEntity and old recursive permission fanout inside notification fanout.
9. Document any remaining full-company effective-access rebuild dependency, especially around shared inbox access/RACI.
10. Validate notification summary/list/SSE behavior from frontend-facing paths.
11. Run backend tests and relevant frontend checks.

Do not delete resource_access_grants unless all V4 access-source replacement work is complete and there is an explicit migration plan. If not, document the remaining dependency instead.

After finishing, update docs/important tasks/notifications-v1-project-tracker.md with completed checkboxes, final audit notes, and any intentionally retained legacy code.
```

## Coordination With Backend Refactor V4

Notifications V1 depends on V4's effective-access direction but should not wait for every V4 task to finish.

Allowed temporary compromise:

- Process committed domain events immediately after a handler commits, as long as the logic lives in a projector/service and remains idempotent.

Not allowed:

- New recursive permission fanout.
- New Kanban-as-source-of-truth notification behavior.
- New route-specific copies of notification business rules.

When V4 finishes source-scoped effective-access updates, Notifications V1 should keep working without architectural changes.
