# V3 Email to Node

Date: August 6, 2026

Status: Investigation and planned business logic. Nothing in this document is implemented by creating this file, and this document does not change the current email contracts by itself.

## Process Story

A user places an email thread on a Node. The email may also be placed on one exact text box inside that Node. This first placement is deliberate: it means the stored thread and future real messages in that same provider thread belong at those exact destinations.

Later, two or three new messages arrive before anybody opens Mango. Nylas sends mailbox events, but Mango treats those events only as signals. Mango resolves the exact company and personal account or shared inbox, finds the already stored Mango thread by its exact provider thread ID, and starts one durable reconciliation job.

The job asks Nylas for the current message IDs in the thread. It compares those IDs with the message IDs already stored in Mango. It does not download, copy, or rewrite the old messages. It fetches only the missing or incomplete messages. Each new message receives a permanent Mango email-message ID, keeps its provider message ID as provider metadata, and is appended to the existing Mango thread.

For every newly completed message, Mango creates only the missing relationship rows needed to put that message on the thread's existing Node destinations and, where applicable, its exact text-box destinations. Old relationship rows are not copied or rewritten. A text-box placement is always an additional, more precise placement inside a Node; it does not replace the Node-wide placement.

When the user opens My Triage or Shared Triage, the mailbox may show only the latest card for the provider thread. That is enough. If the latest message belongs to a known stored thread but is not stored yet, Mango starts the same reconciliation job. The job discovers and appends all missing messages in that provider thread, including intermediate replies that are not represented by their own mailbox cards.

After the database commit, Mango sends a small live update. The latest email card can then show its Node icon, and opening the Node shows the newly appended messages at the correct Node and text boxes. Unknown threads remain provider-only until a user deliberately places them in a future picker workflow.

## Product Goal

The long-term email product has three simple outcomes:

1. It is easy to triage an email into a Node.
2. It is easy to discuss that email with other people.
3. It is easy to create a shared draft with other people for that email.

All three outcomes depend on the email being stored and placed correctly first. The work must therefore be built in small complete parts.

## Delivery Order

### Phase 1: automatic append for known threads

Phase 1 is the only implementation scope approved by this document:

- Detect newly arrived messages in the backend.
- Determine whether the exact provider thread already exists in Mango for the exact mailbox scope.
- Reconcile that known thread in the background.
- Download only missing or incomplete messages.
- Append those messages to the existing Mango thread.
- Place each new message on the thread's existing Nodes and exact text boxes.
- Make the Node icon appear on the new/latest mailbox card after placement succeeds.

### Later phases

These are part of the product direction, but they are not part of Phase 1:

- A universal picker or smaller Company Explorer for choosing Nodes, Projects, Logic Gates, and text boxes.
- Creating a new Node or other destination from the picker.
- Placing a novel thread for the first time.
- Chat creation and chat-side-panel changes.
- Shared draft creation and collaborative draft changes.
- Project and Logic Gate automatic placement. Their eventual behavior should follow the same typed rules as Nodes without using a generic resource registry.

Phase 1 must not add partial picker, chat, or shared-draft behavior.

## Terms

- **Provider message ID:** The immutable message ID supplied by Nylas for one connected mailbox.
- **Provider thread ID:** The thread ID supplied by Nylas for messages in one connected mailbox.
- **Mango email thread ID:** Mango's permanent internal ID for one normalized stored thread.
- **Mango email message ID:** Mango's permanent internal ID for one normalized stored message.
- **Mailbox scope:** One exact personal account or one exact shared inbox inside one company.
- **Known thread:** A stored Mango thread that matches the exact mailbox scope, provider, and non-empty provider thread ID and that has at least one current Node placement.
- **Unknown thread:** A provider thread for which that exact known-thread match does not exist.
- **Node-wide placement:** An `email_relationships` row with `resource_type='node'`, the exact Node ID, and `resource_textbox_id=null`.
- **Text-box placement:** An `email_relationships` row with `resource_type='node'`, the exact Node ID, and the exact active Node text-box ID in `resource_textbox_id`.
- **Thread destination set:** The distinct, still-valid Node-wide and text-box destinations currently represented by relationship rows for messages in one stored thread.
- **Reconciliation:** Fetching the provider thread's current message IDs, calculating which messages Mango lacks, and importing only that difference.

## Phase 1 Business Logic Laws

### Thread identity and eligibility

E2N1 - A provider thread matches a Mango thread only by exact company, exact mailbox scope, provider, and non-empty provider thread ID.

E2N2 - A personal mailbox scope is the exact company, personal user, and normalized personal account email. A shared mailbox scope is the exact company and shared inbox. Personal and shared scopes never match each other.

E2N3 - Subject, participants, reply headers, body text, timestamps, and similar-looking content must never be used to decide that two threads are the same.

E2N4 - The same provider thread ID in a different account, shared inbox, or company is a different Mango thread. No message or relationship crosses those boundaries.

E2N5 - Phase 1 automatically reconciles only known threads with a current Node placement. It does not import every unknown message in a mailbox into Mango.

E2N6 - A provider event without an exact grant, mailbox scope, message ID, or provider thread ID cannot start this automatic flow. Mango does not guess the missing identity.

E2N7 - If the same personal thread has deliberately been placed in more than one company, each company's Mango thread is reconciled independently and remains company-scoped.

### Append-only message import

E2N8 - Reconciliation fetches the provider thread's current message-ID list and compares it with the stored provider message IDs for that exact Mango thread.

E2N9 - Mango downloads only provider messages that are missing or whose stored `download_complete` value is false. A completed stored message is not fetched again.

E2N10 - Mango never re-copies the existing thread to append a reply. Existing Mango thread IDs, Mango message IDs, message bodies, attachment links, relationship IDs, and completed download data remain unchanged.

E2N11 - If two or three messages arrived since the last reconciliation, one full-thread reconciliation imports all two or three missing messages. It is not limited to the newest mailbox card or the message that caused the signal.

E2N12 - One provider message produces one Mango message inside the exact stored thread. The existing unique identity of company, Mango thread, and provider message ID remains the database backstop.

E2N13 - Every new provider message receives one permanent Mango email-message ID. Provider IDs remain metadata for provider operations and are never substituted for Mango's internal relationship identity.

E2N14 - Message order is recomputed from provider timestamp ascending, with provider message ID as the deterministic tie-breaker. Recomputing order must not change any existing Mango message ID.

E2N15 - Reconciliation keeps the complete real message sequence. It may append missing received and sent messages in the provider thread. Provider drafts are not imported as received/sent messages in Phase 1.

E2N16 - `history_complete=true` means complete as observed during the last successful reconciliation. It never means the provider thread is permanently finished.

E2N17 - A `message.created` event is a trigger, not authoritative email storage. The durable worker fetches the exact provider thread and full message data through the connected account before marking a message complete.

E2N18 - `message.updated` and `message.deleted` remain mailbox cache/update signals in Phase 1. They do not rewrite or delete a completed durable Mango message. An incomplete stored message may still be completed by the normal reconciliation worker.

### Node and text-box placement

E2N19 - `email_relationships` remains the authoritative typed relationship table for linking an internal Mango email message to a Node and optionally to an exact text box. Phase 1 does not introduce a universal resource registry or generic untyped edge.

E2N20 - Every email message placed on a Node has a Node-wide relationship with `resource_textbox_id=null`.

E2N21 - A text-box relationship is additional precision inside the same Node. A message placed on a text box must also have the Node-wide relationship for that same Node.

E2N22 - A text-box relationship is valid only when the exact text box currently exists, is not deleted, belongs to the exact Node, and is in the same company.

E2N23 - For each newly completed message, Mango derives the thread destination set from existing relationship rows for that exact stored thread. It creates only the missing relationship rows for the new message.

E2N24 - The destination set is the distinct union of the thread's current Node-wide and valid text-box destinations. If a thread is on two Nodes, the new message goes to both. If it is on two text boxes in one Node, the new message goes to the Node once and to both text boxes.

E2N25 - Multiple email threads may be placed on the same Node or the same text box. One thread's reconciliation never changes another thread.

E2N26 - Mango never invents a replacement Node or text box. If an old text box has been deleted, the new message keeps the still-valid Node-wide placement and does not recreate or redirect the text-box placement.

E2N27 - If the thread has no remaining Node placement when the job evaluates its destination set, the automatic job must not create a new placement. The thread remains stored, and a user must deliberately place it again.

E2N28 - Creating an email relationship does not create a permission, assignment, GVIC link, owner link, or participant. Existing Node access rules alone decide who may see the related email.

E2N29 - Deliberately placing a thread on a Node or text box enrolls that exact destination to receive future real messages from the same exact provider thread. This is the user consent boundary for automatic sharing.

E2N30 - Removing one message's relationship removes only that exact edge. It does not delete the message, thread, Node, or text box. If other messages still represent the same thread destination, future messages continue to inherit that destination.

E2N31 - Stopping future placement requires an explicit thread-unlink for the exact Node or exact text box. That command removes all relationship rows for that thread and destination only. Unlinking a text box leaves its Node-wide placement; unlinking a Node removes that thread's text-box placements inside the Node as well.

### Triggers and reconciliation scheduling

E2N32 - The primary fast trigger is a verified Nylas `message.created` webhook with an exact grant, message ID, and thread ID.

E2N33 - The webhook request performs only bounded work: validate the signature, resolve exact account scope, find matching known Mango threads, idempotently enqueue reconciliation, invalidate the current mailbox caches, publish the existing mailbox hint, and return. It does not download a full thread inside the webhook request.

E2N34 - My Triage and Shared Triage list reads are the catch-up trigger. After receiving a provider page, Mango checks the visible cards' exact thread IDs and latest message IDs. If a card belongs to a known thread and its latest message is missing or incomplete, Mango idempotently enqueues the same full-thread reconciliation.

E2N35 - The list response does not wait for thread bodies or attachments to download. The existing provider list remains responsive while the durable job runs in the background.

E2N36 - A merged mailbox card is sufficient. The catch-up trigger uses its exact provider thread ID, and the worker fetches the provider thread membership so intermediate missing messages are included.

E2N37 - Phase 1 does not add continuous polling of every mailbox. Verified webhooks provide the fast path, and mailbox-list catch-up covers missed or delayed webhooks when a user works through triage.

E2N38 - Only one active full-thread job may exist for a company and Mango thread. Duplicate webhooks, repeated list reads, multiple browser tabs, and concurrent users converge on that same active job.

E2N39 - A completed full-thread job does not prevent a later reconciliation job after a new message arrives. Completion applies only to the provider snapshot seen by that job.

E2N40 - A mailbox-list catch-up does not enqueue another provider call when the card's latest message is already complete in the exact known thread and no active retry is needed.

### Transactions, retries, and live updates

E2N41 - Database creation of a completed new message and its required relationship rows is one atomic store operation. A Node icon or Node-visible message must not appear before the required relationship commit succeeds.

E2N42 - Provider and object-storage calls occur outside long database transactions. Durable job state records progress and retries safely.

E2N43 - Attachment bytes continue to use `attachments` and typed `attachment_relationships` with `resource_type='email_message'`. Email relationship rows never own or duplicate attachment bytes.

E2N44 - A failed attachment or provider fetch leaves old messages and old placements unchanged. Retry work starts from the missing or incomplete set and never duplicates completed data.

E2N45 - Relationship creation is idempotent. The existing semantic uniqueness of company, internal email message, resource type, resource ID, and optional text-box ID remains the database backstop.

E2N46 - Concurrent reconciliation uses the existing active-job uniqueness and a transaction or lock around the per-thread append. Two workers cannot create different Mango IDs for the same provider message.

E2N47 - After a successful append and placement commit, Mango publishes a compact live event for the affected mailbox and Nodes. Clients invalidate the exact mailbox placement data and exact Node email-thread data rather than refetching unrelated company state.

E2N48 - The Node icon on a mailbox card is based on an authorized, committed Node-wide relationship for that exact provider message. A text-box-only row is not enough because E2N20 and E2N21 require the Node-wide row as well.

E2N49 - Safe job errors identify the operation and stable IDs but do not log provider tokens, message bodies, attachment bytes, temporary URLs, or secrets.

### Account, access, and lifecycle rules

E2N50 - The worker reads Nylas only through the exact connected personal account or company email connection that owns the stored thread's mailbox scope.

E2N51 - A disconnected, revoked, missing, or mismatched source connection cannot be replaced with another account. The job retries or fails with a safe source-unavailable status and preserves stored data.

E2N52 - For a personal webhook, Mango evaluates only companies in which the account owner currently has membership and only exact stored personal-thread matches in each company. For a shared webhook, Mango evaluates only the exact company and linked shared-inbox scopes for that company connection.

E2N53 - A collaborator may read appended mail only through normal Node authorization after it is stored. A collaborator's lack of a Nylas connection does not remove already stored Node mail and does not permit Mango to borrow that collaborator's unrelated account.

E2N54 - Recycle, restore, and permanent-delete behavior continues to follow `docs/tests/relationships.md`. Removing an email edge never deletes either endpoint. Deleting a Node or text box cleans only relationship rows that reference that exact typed endpoint.

E2N55 - Provider deletion does not silently erase the durable Mango record or its Node context. Any future product rule for deleting stored mail must be a separate, explicit lifecycle design.

## Exact Phase 1 Flow

### Fast path: provider webhook

```text
verified message.created webhook
  -> resolve exact grant and mailbox scope
  -> for each exact company/shared-inbox scope in bounds
  -> look up stored thread by provider + provider_thread_id
  -> require at least one current Node placement
  -> if webhook message is missing/incomplete, ensure one full_thread job
  -> wake durable worker
  -> keep existing cache invalidation and mailbox live hint
  -> return 200
```

The webhook snapshot may help validate the signal, but it is not the final durable message body. The worker remains the authority for provider reads and retries.

### Catch-up path: My Triage or Shared Triage

```text
provider mailbox page
  -> normal list response data
  -> inspect each card's exact thread_id and latest message id
  -> exact known-thread lookup in the requested mailbox scope
  -> if latest message is missing/incomplete, ensure one full_thread job
  -> return the mailbox page without waiting for the job
```

The catch-up path is important because webhook delivery can be delayed, repeated, or missed. It also directly supports the current UI behavior where several messages in one provider thread appear as one latest card.

### Durable worker path

```text
claim one full_thread job
  -> load exact stored Mango thread and exact source connection
  -> fetch provider thread
  -> validate returned provider thread ID
  -> normalize and deduplicate provider message IDs
  -> compare with stored provider message IDs
  -> skip every complete stored message
  -> fetch each missing/incomplete message and its required attachments
  -> validate message belongs to exact provider thread
  -> atomically finalize message + Node/text-box relationship rows
  -> recompute deterministic thread order
  -> mark this observed snapshot complete
  -> publish exact mailbox and Node updates
  -> complete job
```

## What the Current Code Already Provides

The investigation found that Mango already has most of the storage and worker foundation:

- `email_threads` stores exact personal/shared mailbox scope, provider thread identity, download status, and the last observed history state.
- `email_messages` has permanent Mango message IDs and unique provider-message identity inside a Mango thread.
- `email_relationships` already has `resource_textbox_id` and supports Node-wide and exact-text-box relationships.
- The email relationship validation trigger proves that an exact text box belongs to its typed resource and company.
- `email_thread_download_jobs` already supports durable full-thread jobs, leasing, retries, and one active full-thread job per Mango thread.
- The current worker already fetches a provider thread's message-ID list and skips every message whose stored download is complete. This is the correct append-only foundation.
- The current upsert reuses the existing Mango thread, preserves old Mango message IDs, and recomputes deterministic message order.
- Completed jobs are not part of the active-job uniqueness condition, so a later job can be created safely.
- My Triage and Shared Triage messages are already enriched with committed Node placements for the exact provider message visible on the card.
- Webhook parsing already supplies the grant ID, message ID, thread ID, and a resolved personal or shared account context.

No new central relationship table is needed. A structural database change is not expected for the core Phase 1 behavior. An implementation must still inspect query plans and add a normal scoped index by migration only if the exact known-thread lookup is not already covered efficiently.

## What Must Change for Phase 1

### 1. Permit later full-thread reconciliation

The current `communicationsEmailThreadDownloadRequest` schedules a full-thread job only while `history_complete` is false. Once a thread has completed its first download, later automatic signals cannot request another full-thread comparison through that path.

Phase 1 needs a separate explicit reconciliation command. It must be allowed after `history_complete=true` and must not pretend the old thread is incomplete. It asks, "Has the provider thread gained messages since our last observed snapshot?"

### 2. Add an exact known-thread lookup

The repository currently lists stored threads for an account, but the webhook and list catch-up need a bounded lookup by:

- company;
- provider;
- exact personal user and account email, or exact shared inbox;
- exact non-empty provider thread ID;
- existence of a current Node relationship.

This lookup must return only the Mango thread IDs needed for scheduling. It must not load every stored message body for the account.

### 3. Let webhooks enqueue reconciliation

The current webhook path verifies events, invalidates mailbox caches, records read signals where applicable, and publishes live mailbox hints. Tests currently prove that it performs no provider detail reads and makes no durable collaboration change.

Phase 1 should preserve the no-download-inside-webhook rule while adding an idempotent job enqueue for exact known threads. Existing tests that require no synchronous provider reads remain valid; tests that prohibit durable job creation for known threads must change.

### 4. Add mailbox-list catch-up scheduling

After a normal provider page is received, the backend should compare the visible provider thread/latest-message identities with exact known Mango threads. It should enqueue only when the latest visible message is missing or incomplete. This is a background side effect of the authorized mailbox read, not a replacement for the provider list response.

### 5. Propagate exact placements when finalizing a message

The worker currently stores new messages but does not copy the thread's current typed destinations onto each new message. Phase 1 needs one internal store command that:

1. locks the exact Mango thread;
2. resolves the distinct current Node and valid text-box destinations;
3. upserts or completes the exact provider message;
4. ensures the Node-wide row for every Node destination;
5. ensures the exact text-box rows;
6. commits once; and
7. returns the affected Node IDs for live updates.

This is relationship propagation, not thread copying. Only the new message and its missing edges are written.

### 6. Keep the Node icon current

The current card enrichment looks for a Node-wide relationship on the exact provider message ID. Once the worker commits the new message's Node-wide relationship, the current query can represent the icon. Phase 1 also needs a live invalidation or compact placement update so an already open triage list does not require a manual reload.

### 7. Update current business contracts when implementation ships

The current implemented contracts deliberately make later provider mail manual-only:

- `docs/tests/email.md` law EMAIL121;
- `docs/tests/nodes.md` law N126; and
- the later-message test stories in those files.

Those statements are correct for today's code. The Phase 1 implementation intentionally changes them. The implementation is not complete until the Process Stories, numbered laws, and test matrix in the current contract files are updated in the same change.

## Privacy and User Expectation

The most important user-facing consequence is simple:

> Placing a thread on a Node means future real messages in that exact provider thread can automatically become visible to everyone who can access that Node.

This must be understandable in the eventual placement UI. Mango must not enroll unrelated threads, other mailboxes, or guessed conversations. Users also need a clear future action to unlink the exact thread from a Node or text box and stop future placement there.

## Acceptance Tests Required for Phase 1

### Identity and scope

- A known personal thread is found only for the exact company, user, and account email.
- A known shared thread is found only for the exact company and shared inbox.
- The same provider thread ID in two accounts does not cross-link.
- The same subject and participants with a different thread ID do not match.
- A webhook without a thread ID does not guess or import.
- An unknown thread remains provider-only.

### Append behavior

- Zero missing messages causes zero message downloads and zero relationship writes.
- One missing message appends once without changing old Mango IDs or old relationships.
- Three missing messages append all three in one reconciliation.
- A complete existing message is never downloaded again.
- An incomplete existing message is completed without getting a second Mango message ID.
- Out-of-order and equal-time messages receive deterministic order without changing stable IDs.
- Provider drafts are not treated as delivered thread messages.

### Placement behavior

- A Node-wide thread gives each new message one Node-wide relationship.
- A Node plus text-box thread gives each new message both relationships.
- Two text boxes in one Node produce one Node-wide row and two text-box rows.
- Two Nodes receive independent exact relationships.
- Two email threads can occupy the same text box without conflict.
- A deleted text box is not recreated and does not block a valid Node-wide placement.
- No current Node destination produces no invented placement.
- Relationship propagation creates no permission, GVIC, assignment, chat, or draft.
- Duplicate propagation is a no-op.

### Trigger and concurrency behavior

- A verified known-thread `message.created` webhook enqueues a job but performs no synchronous provider thread/message download.
- An unknown-thread webhook keeps current cache/live-hint behavior and enqueues no import.
- Duplicate webhooks reuse one active full-thread job.
- Two browser tabs viewing the same latest card reuse one active job.
- A later message can create a new job after an earlier job completed.
- A merged latest card triggers import of every missing provider message in that thread.
- A card whose latest message is already complete does not create repeated provider work.
- Concurrent workers cannot create duplicate Mango messages or relationships.

### Failure, access, and live behavior

- A disconnected or mismatched source account imports nothing and preserves old data.
- A provider failure retries only missing/incomplete work.
- An attachment failure does not duplicate its message on retry.
- Node collaborators cannot read the message before the placement commit.
- Node authorization still controls the stored message after commit.
- An open triage list receives an update and shows the Node icon after commit.
- An open Node refreshes only the affected thread/Node data.
- Logs and errors contain no message bodies, tokens, attachment bytes, or temporary URLs.

### Database contract

- Tests run against PostgreSQL 17-compatible SQL.
- Unique indexes enforce one provider message per Mango thread and one semantic email relationship per exact destination.
- Exact thread lookup uses the existing typed tables and a bounded indexed plan.
- No central resource registry, surrogate resource identity, or untyped generic edge is introduced.

## Phase 1 Definition of Done

Phase 1 is done only when all of the following are true:

1. A known stored thread can receive new provider messages automatically through webhook scheduling.
2. My Triage and Shared Triage provide a safe catch-up trigger for missed events.
3. One reconciliation appends every missing message and does not re-download completed messages.
4. Each appended message receives the correct Node-wide and exact text-box relationships.
5. Old messages and old relationship rows remain unchanged.
6. The latest mailbox card shows the Node icon after the append commits.
7. Duplicate signals and retries are idempotent.
8. Exact mailbox, company, Node, text-box, and permission boundaries are proven by tests.
9. The current Process Stories and business laws in `docs/tests/email.md`, `docs/tests/nodes.md`, and `docs/tests/relationships.md` are updated where the implemented behavior changes them.
10. Picker, chat, and shared-draft changes remain out of this phase.

## Investigation Verdict

Yes, Mango can do this with the system it already has.

The efficient append behavior is mostly present in the durable worker: it can fetch provider thread membership, skip complete stored messages, append missing messages, preserve stable internal IDs, and retry safely. The existing schema already supports exact Node and text-box email relationships.

The work is therefore not a new email-storage system. Phase 1 is a focused extension of the existing system:

- schedule reconciliation when a known thread changes;
- allow reconciliation after the previous snapshot was complete;
- find known threads by exact mailbox-scoped provider identity;
- propagate only the new messages to the thread's current exact destinations; and
- notify the mailbox and affected Nodes after commit.

That is the smallest complete first layer for the larger email-to-Node product.
