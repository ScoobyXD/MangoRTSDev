# Process Story: A Verifier group becomes an exact verification snapshot

A user creates a verification stamp on a Node with current effective Verifier people and groups
↓
Mango expands live nested group membership, deduplicates users, and snapshots each recipient once
↓
Later RCVI or membership changes do not rewrite that historical stamp, and each snapshotted recipient can complete only their own check
↓
The request update routes through the CVI surface with the Verifier role while ordinary Node permission remains authoritative

Last updated: 2026-08-06

# Node Timeline Transfer And Verification Rules

This document defines the durable business rules for compact activity entries on a Node timeline. Text boxes remain editable document rows; transfer and verification entries are immutable activity stamps and use a shorter visual row.

## Retired Node v2 projection

The unshipped Node v2 projection is retired. Migration `20260802_retire_node_v2_and_legacy_editor.sql` strictly removes `node_timeline_items`, `node_movements`, the Node v2 verification tables, and the Node v2 textbox comment/link tables. The canonical schema and runtime no longer create, read, or write them.

Current product activity uses `node_timeline_events` and `node_timeline_verification_recipients` for transfer and verification stamps. Current editable text lives in `node_textboxes`; existing information/projection tables continue to provide the workspace presentation. These retained stores are separate from the retired Node v2 subsystem.

The transfer and verification rules below remain current. Do not reintroduce the retired Node v2 projection as a second source of truth.

## Logic Gate transfer events

1. A transfer event is created only when an existing Node assignment moves from one Logic Gate ID to a different Logic Gate ID. Initial assignment, removal, and status/column movement inside one Logic Gate do not create transfer stamps.
2. The assignment mutation and transfer event commit in the same repository transaction. A failed assignment move must not leave a timeline event, and a failed timeline insert must roll back the move.
3. Each event snapshots the actor's display name and the source and destination Logic Gate names at commit time. Later user or Logic Gate renames, removal from the company, or Logic Gate deletion do not rewrite historical copy.
4. Transfer rows are ordered by event time, then stable event ID, newest first. They use the sentence: `{actor} moved this node from {source Logic Gate} to {destination Logic Gate}.`
5. Transfer stamps are read-only. Authorization to read them is the same as authorization to read the owning Node.
6. A compact stamp reuses the exact shared Node timeline rail and circle used by text boxes. Its leading timestamp includes a clock icon, and its header, source snapshot, and destination snapshot use the established Logic Gate icon. Visual labels must render the stored name snapshots, not a generic replacement label.
7. The transfer card consumes only its content height; spare Node-workspace viewport height must remain below the timeline rows and must never stretch a transfer card or create blank space inside it.
8. Source and destination Logic Gate chips are keyboard-accessible links whenever their snapshotted IDs are present. Opening one pushes the Logic Gate route onto browser history so Back returns to the exact Node route and preserved workspace state. A missing ID remains readable historical text and is not presented as an actionable link.

## Verification assignment rules

1. Responsible, Consulted, Verifier, and Informed each accept multiple direct user or group principals on Nodes and Logic Gates.
2. Group principals expand through current members and nested subgroups whenever effective RCVI is read. A verification request converts the current effective Verifier users into stable, individually actionable recipient snapshots.
3. One direct principal can hold only one role on the same resource; if a user reaches several roles through different sources, the effective order is Responsible, Consulted, Verifier, then Informed.
4. RCVI responsibility is not authorization. Verifier assignment does not itself grant view, edit, delete, or administrative access.

## Creating a verification request

1. The Node timeline plus action opens a choice. `New text box` preserves the existing text-box creation behavior; `Verify stamp` creates a verification request. Both choices are neutral at rest and expose the same visible hover and keyboard-focus selection treatment.
2. Creating a verification request requires current Node edit authorization and a nonblank idempotency key.
3. Browser CORS preflight must allow both `Idempotency-Key` and the supported `X-Idempotency-Key` alias so a valid verification request reaches the API rather than failing at the transport boundary.
4. The request snapshots all current effective Node RCVI users whose role is Verifier. PostgreSQL derives that effective set synchronously from canonical RCVI assignments, current company membership, and applicable snapshot rules inside the request transaction instead of trusting the materialized effective-assignment projection. This keeps the request consistent with the RCVI editor even if that rebuildable projection is stale. Duplicate effective users collapse to one recipient by user ID.
5. At least one Verifier recipient is required. Otherwise the API returns a conflict and no stamp or update is created.
6. The actor is included in the recipient snapshot when the actor is currently Verifier. The actor may complete their own verification, but does not receive a self-notification.
7. Later RCVI additions, removals, role changes, group changes, or Logic Gate transfers do not add, remove, or rewrite recipients on an existing stamp.
8. Every deliberate plus-menu action uses a new idempotency key and may create a new request. Retrying the same key for the same Node returns the original stamp, creates no second domain event, and sends no duplicate updates. Concurrent retries for one Node serialize against the same Node row before insert.
9. The actor display name and every recipient display name are stored as historical snapshots. User rename or company removal does not rewrite the stamp.
10. PostgreSQL request creation reads the current Node label from the canonical `nodes.name` column while locking that Node. The label is copied into the verification domain event so recipient Updates identify the correct Node.
11. Unexpected repository failures are logged server-side with the company, Node, and actor IDs plus the internal error. The API response remains the stable generic error and does not expose database details to the browser.

## Recipient updates and completion

1. One `node.verification_requested` update is created for each snapshotted recipient except the actor.
2. The update routes to the CVI Updates surface with RCVI role `verifier`, retains the Node's normal priority context, and uses copy equivalent to `{actor} requested verification from you on {node}`.
3. The update stores the verification timeline event ID as `information_id`. Activating it opens the Node panel and scrolls the compact verification stamp into view.
4. Each recipient controls only the check beside their own snapshotted name. A non-recipient receives not-found behavior so the API does not reveal the recipient list through completion attempts.
5. Completion is one-way and idempotent. The first accepted action stores the database timestamp; repeated or concurrent actions retain that original completion timestamp. One recipient never completes another recipient.
6. Removing a recipient from Verifier after request creation does not retract the historical update or completion right. Losing ordinary Node access still prevents opening or acting on the Node because authorization remains authoritative.
7. Completion updates the Node view version so canonical reloads and ETags expose the latest per-person state. The initiating browser also patches the returned stamp immediately.

## Persistence and rollout

- `node_timeline_events` stores immutable transfer and verification headers.
- `node_timeline_verification_recipients` stores the immutable recipient snapshot plus the one mutable completion timestamp.
- Both tables cascade only with deletion of the owning Node. Historical actor, Logic Gate, and recipient IDs/names are intentionally not foreign-key cascaded so audit copy survives rename/removal.
- Apply `backend/db/migrations/20260722_node_timeline_verification_events.sql` through the normal human-managed database rollout before deploying code that uses these endpoints. Agents must not apply it to a live database.
