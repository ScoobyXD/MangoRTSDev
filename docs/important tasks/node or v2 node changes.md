# Node v2: product requirements, editor architecture, scale, and handoff

Last updated: 2026-07-26

Status: product and architecture handoff. This file records the product story, confirmed requirements, decisions, current implementation concerns, and the next design work. It is not evidence that the proposed architecture has been implemented.

## Why this document exists

Mango is reaching the point where the Node, editor, chat, email, attachment, timeline, realtime, and history systems cannot be designed independently. A Node may remain active for weeks, move between teams and Logic Gates, accumulate dozens of text boxes, thousands of chat messages, hundreds of email messages, many files and images, verification records, permissions, GVIC assignments, and future snapshots.

The user must still be able to open the Node quickly, scroll smoothly, type with immediate feedback, undo correctly, work through a network interruption, and open the same document in several browser tabs without one tab silently replacing another.

The existing editor modernization work contains useful foundations, but some earlier decisions no longer match the clarified product requirements. In particular:

- the existing plan uses complete JSON snapshots with exact-revision conflicts;
- the existing plan explicitly excludes Yjs, CRDTs, Hocuspocus, and automatic concurrent merging;
- a single Tiptap JSON document is arbitrarily limited to two MiB;
- the current JSON save path stores the complete accepted document in current, operation, and version rows;
- the current browser pending record is keyed only by the document, so same-document tabs share one IndexedDB record without a cross-tab coordinator;
- the current conflict choice is whole-document `keep-local` or `use-canonical`, not merged concurrent editing.

Those choices must be reconsidered before the Tiptap cutover. Do not delete production data, convert live documents, enable the JSON workspace gate, or remove legacy paths solely because this document exists.

## Product foundation

Mango is fundamentally built on Logic Gates and Nodes.

- A Logic Gate represents a process, stage, or operating workflow.
- A Node represents a task, work item, case, or thing moving through processes.
- Nodes appear within statuses in a Logic Gate.
- Nodes may move between Logic Gates owned by different teams or people.
- Projects provide another organized workspace and contain multiple text boxes.
- Permissions and GVIC assignments are core business rules, not editor features.

Everything else should attach to those concepts cleanly instead of turning a Node into one giant content blob.

## One editor system, separate domain ownership

Logic Gates, Nodes, and Projects should use the same editor behavior and document schema, but they do not need to store their permanent content in one generic database table.

The desired product shapes are different:

- A Logic Gate normally has one large editor document.
- A Node contains multiple independently created text boxes.
- A Project contains multiple independently created text boxes.

The current direction is therefore:

- use one shared Tiptap/ProseMirror editor implementation;
- use one shared collaboration and persistence protocol;
- retain domain-specific permanent storage and real foreign keys;
- introduce a dedicated Node-text-box table;
- introduce a dedicated Project-text-box table;
- keep the Logic Gate information/projection structure unless detailed design proves a change is necessary;
- avoid a single permanent polymorphic `editor_documents` table merely for code reuse;
- avoid searching rich document source tables directly.

Candidate names such as `node_textboxes` and `project_textboxes` are architectural placeholders until the detailed schema is approved. This document does not approve a migration yet.

## Node product story

A Node is an evolving work record, not a static note.

Over its lifetime, a Node may contain:

- dozens of text boxes;
- thousands of chat messages spread across those text boxes;
- hundreds of emails and email replies;
- inline images and files;
- Logic Gate movement records;
- verification requests and stamps;
- permissions and GVIC assignments;
- future intentional Node snapshots;
- future Logic Gate-side records or snapshots of movement.

The Node ties those records together by identity. It must not physically embed all of them into one JSON object or load all of them into the browser at once.

## Node timeline

Each Node has a user-visible timeline ordered newest first.

Confirmed or planned timeline item types include:

- text box created;
- Node moved from one Logic Gate to another;
- actor who moved the Node;
- source and destination Logic Gates;
- movement timestamp;
- verification requested;
- verification completed, rejected, or stamped;
- future intentional Node snapshot;
- potentially future Logic Gate-side snapshot or movement record.

Every item type must share one stable ordering. A monotonic per-Node sequence is preferable to ordering solely by timestamp because timestamps can collide or arrive late.

The timeline should contain lightweight entries that reference authoritative business records. It should not duplicate full documents, email bodies, chat histories, or attachment bytes.

Current main already contains dedicated Node timeline and verification work. Read these before redesigning timeline storage:

- `docs/backend/node-timeline-verification.md`
- `backend/internal/store/node_timeline.go`
- `backend/internal/store/postgres_node_timeline.go`
- `backend/internal/http/node_timeline_handlers.go`

Preserve working timeline behavior during any editor or table migration.

## Three different meanings of history

Do not combine these into one retention policy or one table merely because they all involve time.

### 1. Editor collaboration and recovery history

This exists to deliver changes, recover offline work, resolve synchronization gaps, and compact a document. It is operational. Most of it should expire after safe acknowledgement and compaction.

### 2. Node business timeline

This is user-visible business history: a text box was created, a Node moved, or somebody verified work. It is permanent unless the product explicitly permits deletion.

### 3. Intentional snapshots

A future Node snapshot is a deliberate capture of the Node at a moment in time. It is a business record and must be retained according to product policy. It is not the same thing as an automatic editor checkpoint.

Typing a character must not create a permanent business timeline item. Removing an expired collaboration update must never remove a movement or verification record.

## Node text boxes

Each Node text box is an independent editor document and timeline object.

Required properties include:

- a stable text-box ID;
- Node ownership;
- creator and creation timestamp;
- placement on the Node timeline;
- independently loadable and editable content;
- independent collaboration state;
- an associated chat/comment area;
- optional anchored comments referring to selected text;
- attachment relationships;
- optional associations with email threads or individual messages;
- deletion and recovery semantics.

Editing one Node text box must not rewrite every other text box or the entire Node.

Newest text boxes appear at the top of the Node timeline. Oldest text boxes appear at the bottom.

## Project text boxes

Projects also have multiple independent text boxes. They should use the same Tiptap extensions, collaboration behavior, recovery behavior, and attachment rules as Node text boxes while remaining in Project-specific permanent storage.

Project and Node tables should not be combined simply because their editor UI is shared.

## Logic Gate editor

A Logic Gate normally has one large editor instead of multiple text boxes.

The current preference is to keep the Logic Gate information/projection pattern. Any retained projection should become a current materialized Tiptap representation rather than remain the authoritative legacy HTML synchronization system after cutover.

The large single-document nature of Logic Gates requires explicit performance testing. Removing an arbitrary application limit does not grant a browser infinite memory. Large Logic Gate documents may eventually require internal sections, block-level loading, or another form of logical segmentation while preserving a continuous editing experience.

## Editor experience requirements

The editor must support normal professional rich-text behavior:

- immediate character display;
- reliable background saving;
- correct undo and redo;
- bullet and numbered lists;
- indentation;
- headings and text formatting;
- tables;
- links and Mango `#` links;
- copy and paste;
- file attachments;
- inline pasted images;
- mentions;
- comments and highlighted references;
- navigation between linked entities;
- browser refresh recovery;
- network-disconnection recovery;
- safe navigation and unmounting;
- no silent loss of accepted or locally recoverable work.

Typing must update the local editor immediately and must not wait for a network response.

## Expected scale and loading behavior

Design for Nodes that contain weeks or years of activity.

Opening a Node must not eagerly load and mount:

- every Tiptap editor;
- every complete email body;
- every email message in every thread;
- thousands of chat messages;
- every image original;
- the entire business timeline;
- every collaboration subscription.

The preferred read sequence is:

1. Load the Node shell: name, status, access, GVIC summary, counts, and lightweight layout metadata.
2. Load the first cursor-paginated timeline page.
3. Render visible inactive text boxes with a lightweight static renderer.
4. Activate Tiptap and collaboration only for the text box being edited.
5. Load recent chat messages only for visible or opened text boxes.
6. Load email thread summaries only when the email column is open.
7. Load message bodies only after a thread or message is selected.
8. Load display images when visible and originals only on demand.
9. Fetch later timeline/chat/email pages with stable cursors.

The existing Node/Project row virtualization work remains useful and should be preserved.

## Email requirements

Emails are durable independent records, not editor-document content.

- An email thread may be associated with a Node generally.
- A thread may additionally be associated with one or more Node text boxes.
- A specific email message may be associated with a particular text box.
- The Node email column shows all email associated with the Node.
- Users navigate among threads and messages without opening every body at once.
- Mango should retain provider-independent email snapshots so a temporary provider outage does not erase the Node's working record.
- Email HTML remains email HTML; it should not be converted into Tiptap JSON merely because it is displayed beside a text box.
- Email attachment bytes remain in attachment storage and are referenced by IDs.

Current durable email foundations include:

- `communications_email_threads`
- `communications_email_messages`
- `communications_node_email_threads`

Legacy email association tables also exist and must be audited before removal:

- `communications_email_nodes`
- `communications_email_node_attachments`

The final association model may need to support a Node-level link plus optional text-box and specific-message links. Do not assume the current unique constraints support every required association.

## Chats and comments

Each Node text box has its own chat/comment area.

Expected scale includes thousands of messages across a Node, so chat must use dedicated, cursor-paginated storage rather than loading all `Text block chat` JSON payloads through a general Node projection.

The current implementation stores chat payloads in `node_information` and `node_projection_table` using the `Text block chat` information type. Payload fields include the block ID, parent message ID, author, message, mentions, attachments, selected quote, and legacy selection offsets.

A future normalized model will likely require dedicated message and anchor concepts, for example:

- one row per chat message;
- a parent-message reference for threading;
- a text-box reference;
- optional encoded start/end anchor positions;
- selected quote fallback;
- anchor state such as anchored, unanchored, or deleted-range;
- attachment relationships;
- edit/delete audit fields.

Exact table names and whether thread metadata needs a separate table remain open design work.

## Comments and migration of highlighted text

There are two distinct types of highlighting.

### Formatting highlight

User-applied background highlighting is part of the document and can be represented as a Tiptap highlight mark.

### Comment/chat anchor highlight

The comment or chat message is a separate business record. Its selected range is an anchor into the document and must survive edits when possible.

Existing legacy anchors use flat text offsets and selected quotes. ProseMirror positions and legacy HTML offsets are not interchangeable.

Confirmed migration policy:

- keep every existing comment/chat message;
- attempt to translate its legacy range;
- verify that the translated range resolves to the expected quoted text;
- preserve the quoted text;
- if the range cannot be proven, keep the message as unanchored;
- never silently attach a comment to the wrong text;
- do not block the entire migration merely because an old comment must become unanchored, provided the message and quote are preserved and the result is reported;
- new comments must use the new durable anchor mechanism.

If Yjs is selected, Yjs relative positions are a strong candidate for new anchors because they remain attached through concurrent edits and can resolve to null when the referenced content is deleted.

## Attachments and images

Attachment bytes do not belong in Tiptap JSON or PostgreSQL rich-document rows.

Current durable foundations include:

- `attachments` for permanent metadata and object-storage identity;
- `resource_attachments` for associations;
- `attachment_variants` for derived original/display/thumbnail/email-send variants;
- upload intent and upload part tables for temporary upload processing.

Tiptap nodes should store permanent attachment IDs and safe display metadata only. They must not store base64 image bytes, object URLs, presigned URLs, provider credentials, or transient upload state.

Upload processing rows and delivered/expired operational records require explicit deletion policies. Marking a row expired forever is not a complete retention design.

## Permissions and GVIC

Node, Logic Gate, and Project access remains server-authoritative.

- Editor or collaboration connections must be authorized against current Mango permissions.
- A client cannot grant itself access by knowing a document ID.
- Revocation must stop new updates and disconnect or downgrade active collaboration sessions promptly.
- GVIC and verification are business-domain records and timeline events, not fields hidden inside editor JSON.
- Applying permissions/GVIC to descendants remains separate from editor persistence.

## Correct editor technology terminology

Earlier conversation blurred distinct layers. Future work must use these terms precisely.

### Tiptap

Tiptap is the editor framework and application-facing API.

### ProseMirror

Tiptap is built on ProseMirror. ProseMirror provides the structured document model, transactions, steps, positions, selections, formatting behavior, decorations, undo/history primitives, and an optional centralized collaboration module.

ProseMirror is not merely an alternative to Tiptap, and it is not merely bullet-point formatting. Tiptap uses it.

### JSON

Tiptap/ProseMirror JSON is a structured representation suitable for validation, static rendering, export, indexing, backup materialization, and migration.

JSON alone does not solve concurrent editing.

### Yjs

Yjs is an optional CRDT collaboration data model. It can synchronize changes among tabs in one browser, different browsers, different devices, and different users. It is network-agnostic; providers handle cross-tab, IndexedDB, WebSocket, or other transport/persistence behavior.

Yjs is not only a same-computer sharing feature.

Official references:

- https://tiptap.dev/docs/editor/extensions/functionality/collaboration
- https://docs.yjs.dev/
- https://docs.yjs.dev/api/document-updates
- https://docs.yjs.dev/ecosystem/connection-provider/y-websocket
- https://docs.yjs.dev/ecosystem/database-provider/y-indexeddb
- https://docs.yjs.dev/api/relative-positions
- https://prosemirror.net/docs/guide/#collab

## Synchronization choices

Tiptap and ProseMirror remain the editor in every choice. The open question is how document changes synchronize and persist.

### Choice A: complete snapshots with exact revisions

This resembles the current inactive Tiptap foundation.

- Each batch serializes and sends the complete JSON document.
- The backend accepts it only when `base_revision` equals the current revision.
- A stale writer receives a conflict.
- The user chooses between the complete local or complete canonical document.

Advantages:

- conceptually simple;
- strong stale-write rejection;
- easy canonical snapshot reads.

Problems:

- work grows with total document size instead of edit size;
- complete snapshots consume API bandwidth;
- current storage duplicates the document across multiple tables;
- simultaneous edits do not merge;
- `keep-local` can replace remote work after rebasing only the revision number;
- weak same-browser tab coordination;
- poor fit for long offline editing.

This is not sufficient for the clarified multi-tab product requirement.

### Choice B: ProseMirror collaboration steps

ProseMirror can emit small editing steps. A central authority orders accepted steps, broadcasts them, and clients rebase unconfirmed local steps over remote changes.

Advantages:

- small updates;
- no complete-document request per typing batch;
- centralized authoritative ordering;
- uses ProseMirror-native transforms.

Costs:

- requires a correct collaboration authority;
- requires step retention and compaction;
- long offline rebasing and multi-tab recovery require significant custom engineering;
- the server must validate/apply compatible document steps.

### Choice C: Yjs collaboration updates

Tiptap's collaboration extension can bind the ProseMirror document to a Yjs document.

Advantages:

- small binary incremental updates;
- updates are commutative, associative, and idempotent;
- strong offline support with IndexedDB;
- existing cross-tab provider behavior;
- concurrent edits converge instead of triggering whole-document replacement choices;
- relative positions support robust new comment anchors.

Costs:

- introduces a collaboration component and operational model;
- requires update compaction and snapshot policy;
- consumes browser memory for the collaborative document;
- requires careful schema upgrades, auth, presence, undo-origin, and observability design;
- self-hosting Hocuspocus or another provider adds service/runtime complexity;
- the team must decide whether to self-host or use a managed provider.

Current recommendation: treat Yjs as a serious leading candidate and benchmark it against ProseMirror-step collaboration. Yjs is not yet an approved dependency or implemented architecture.

## Current multi-tab behavior and risk

The existing inactive Tiptap sync code has some important protections:

- each backend commit carries a base revision;
- PostgreSQL locks the current document row;
- stale base revisions are rejected;
- stable operation IDs deduplicate lost acknowledgements;
- pending work is stored in IndexedDB;
- exact document realtime events trigger recovery.

It does not provide complete multi-tab collaboration:

- the browser pending record key contains company/resource/document identity but not a tab identity;
- tabs editing the same document can overwrite the same IndexedDB pending record;
- there is no BroadcastChannel or Web Lock coordinating the Tiptap pending queue;
- the client ID is stored in `sessionStorage`; duplicated tabs may begin with copied session state;
- realtime events with the same client ID are ignored as local;
- concurrent full snapshots are not merged;
- conflict resolution is whole-document `keep-local` or `use-canonical`.

Relevant source:

- `frontend/src/modules/editor/tiptap/mangoTiptapSync.ts`
- `frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx`
- `backend/internal/store/postgres_editor_json.go`

Any new architecture must include real tests with several tabs, several users, network loss, reconnect, refresh, delayed acknowledgements, and edits to the same and different ranges.

## Offline and durability requirements

Required behavior:

1. A transaction appears locally immediately.
2. The local recoverable representation is persisted without waiting for the server.
3. The server acknowledges durable receipt separately from local display.
4. Lost acknowledgements do not duplicate an operation.
5. Reconnect sends or requests only missing work when possible.
6. A refresh restores unacknowledged work.
7. A user is warned if browser recovery storage fails.
8. Navigation cannot falsely claim an unsaved oversized or invalid state was flushed.
9. Two tabs cannot overwrite one shared pending record without coordination.
10. Accepted work cannot silently disappear.

## Undo and redo with collaboration

Undo semantics must be explicitly tested.

Expected behavior is normally origin-aware:

- a user undoes their own recent editing action;
- undo should not unexpectedly remove another user's unrelated remote change;
- remote updates remain visible;
- undo itself becomes a synchronized document update;
- tabs need unique origin identities even when owned by the same user.

If Yjs is used, use the collaboration-aware history/UndoManager path instead of enabling an independent ordinary ProseMirror history stack on the same document.

## No arbitrary two-MiB Tiptap product limit

The clarified product requirement is that Mango should not impose an arbitrary user-facing two-MiB Tiptap document limit.

The current inactive foundation enforces exactly 2,097,152 UTF-8 bytes for one serialized Mango Tiptap JSON envelope in:

- frontend serialization and validation;
- backend validation;
- database constraints on current document, operation, and version JSONB values.

That limit is Mango-specific, not a Tiptap or ProseMirror limit.

The limit does not include image bytes, email bodies, chats, other text boxes, or the entire Node. It applies to one serialized Tiptap document.

Do not simply remove the constant while retaining full-document saves and unbounded full-snapshot history. That would turn the current cap into excessive API bandwidth, database growth, and browser memory pressure.

The desired requirement is:

> Mango imposes no arbitrary product-size ceiling on a document. Persistence and synchronization scale with changes rather than repeated full-document saves, and the product never allows typing that it then silently refuses to preserve.

Physical infrastructure will always have finite memory, request, storage, and execution boundaries. Those must be handled through incremental updates, compaction, streaming, monitoring, progressive loading, and potentially logical sectioning rather than a surprising small content cap.

## Database-read performance: top five priorities

For ordinary scoped reads, the five most important factors are:

1. An index that matches the real `WHERE`, join, and `ORDER BY` pattern.
2. A small bounded result set using cursor pagination.
3. Narrow reads that select only required columns and avoid large bodies until needed.
4. Appropriate physical data organization, including domain-specific tables or partitioning when scale warrants it.
5. Cached or precomputed read projections plus healthy query plans/statistics.

Table size alone does not decide latency. A correctly indexed table with millions of rows can retrieve one Node's newest records quickly. A small table can still be slow if it performs unindexed filtering, expensive sorting, or returns huge payloads.

The reason for separate Node, Project, and Logic Gate permanent tables is primarily cohesive domain ownership, real foreign keys, simpler owner-specific lifecycle, smaller relevant indexes, and isolated workload. It is not because PostgreSQL necessarily scans every resource type in a correctly indexed generic table.

## Search architecture

Normal entity reads and full-text search are different access patterns.

Users generally view or search within a Node, Logic Gate, or Project context. The permanent content should remain domain-specific.

Do not repeatedly search nested Tiptap JSON directly. Maintain a derived search projection containing fields such as:

- company ID;
- source/owner type;
- owner ID;
- text-box/document ID;
- title or label;
- extracted plain text;
- PostgreSQL search vector or external-search document;
- visibility/permission scope;
- updated timestamp.

The search projection is rebuildable and not an authoritative editor store. Start with PostgreSQL full-text search if it meets measured needs; move to an external search service only when justified by actual scale or features.

## API and realtime boundaries

Use REST/HTTP for:

- Node, Project, and Logic Gate shells;
- cursor-paginated timeline pages;
- cursor-paginated chats;
- email thread summaries and message bodies;
- attachment metadata and signed download/upload coordination;
- permissions and GVIC;
- manual snapshots and other business commands;
- initial or materialized document state when required.

Use a document collaboration channel for:

- incremental editor updates;
- synchronization state vectors or missing steps;
- presence/cursors when enabled;
- collaboration-specific acknowledgements and recovery.

Do not send every keystroke through the general business `domain_events` stream or treat each keystroke as a Node timeline event.

Use the general realtime outbox for business-domain changes, not as an indefinite permanent record and not necessarily as the high-frequency document update transport.

## Candidate permanent data boundaries

This is a conceptual target, not an approved exact schema.

### Core business records

- `nodes`
- `logic_gates`
- `projects`
- permissions and GVIC tables
- Node/Logic Gate relationship and placement tables

### Domain-specific editor ownership

- candidate `node_textboxes`
- candidate `project_textboxes`
- retained/adapted Logic Gate information/projection storage

### Chat/comment data

- candidate dedicated text-box chat messages
- candidate dedicated anchor records or Yjs-relative anchor payloads
- compact per-user seen/read state rather than unbounded duplicated content

### Email data

- durable email threads
- durable email messages
- flexible Node-level and optional text-box/message associations

### Attachments

- permanent attachment metadata
- resource associations
- rebuildable display/thumbnail variants

### Business history

- Node timeline ordering/projection
- Logic Gate movement facts
- verification facts
- future intentional Node snapshots

### Derived data

- search projection
- static/renderable document projection
- counts/summaries/read models

### Operational data with explicit expiry

- collaboration updates already included in a compacted checkpoint;
- idempotency keys after their safe retry window;
- delivered realtime outbox rows after a replay window;
- completed, aborted, failed, or expired upload-processing rows;
- automatic recovery checkpoints outside retention policy.

## Current table audit concerns

Before designing migrations, classify every existing table as authoritative, derived/rebuildable, transitional, or operational/expiring.

High-priority concerns already identified:

- `editor_json_documents` represents a useful current-document concept but is a generic polymorphic store that conflicts with the current preference for domain-specific permanent tables.
- `editor_json_operations` currently stores a complete document and annotations for idempotency.
- `editor_json_versions` currently stores another complete document and annotations for every accepted revision.
- `workspace_editor_formats` is an atomic migration gate and should not be mistaken for permanent product data.
- `node_content_changes` and `node_content_change_seen` are legacy/change-visibility structures that must be reconciled with the future document and annotation model.
- `editor_collaboration_documents` and `editor_collaboration_operations` are legacy HTML collaboration structures intended for removal after a successful cutover and rollback period.
- `node_information` and `node_projection_table` currently mix several information types. They cannot be deleted wholesale until each retained type has a permanent home.
- old and new email association structures coexist.
- published realtime outbox records need an explicit retention/deletion policy.
- editor JSON operations and versions currently have no identified pruning policy.
- upload cleanup removes abandoned storage objects but marks database intents expired instead of ultimately deleting every old processing row.

Never drop a table based only on its name. First prove every reader, writer, foreign key, background worker, recovery path, migration path, and production row has been replaced or intentionally retained.

## Why a large number of tables is not itself the problem

The problem is not table count. The problem is unclear authority and duplicated state.

A healthy architecture may legitimately have separate tables for Nodes, text boxes, chats, email messages, attachments, movements, and verifications because those records have different ownership, retention, indexing, and permissions.

Every permanent fact should have one authoritative home. Other copies must be explicitly one of:

- a rebuildable projection;
- an expiring delivery/recovery record;
- an intentional immutable business snapshot.

If two permanent tables both claim to be the current editable document, the architecture is wrong.

## Compute, latency, and API criteria

These are the main decision criteria requested by product.

### Compute

Prefer designs that:

- process the changed portion rather than the complete document;
- avoid parsing email HTML on unrelated editor keystrokes;
- do not mount inactive editors;
- compact updates off the critical typing path;
- do not duplicate complete snapshots on every accepted batch;
- avoid recomputing an entire Node timeline or search document during every read.

### Latency

Prefer designs that:

- render typing entirely locally;
- send small incremental updates;
- synchronize same-browser tabs immediately;
- load only visible or requested data;
- use stable cursor pagination;
- use static previews for inactive content;
- keep email, chat, attachment, and editor fetches independent.

### API usage

Prefer designs that:

- avoid full-document REST saves for ordinary typing;
- avoid one massive Node endpoint;
- batch only where batching reduces requests without increasing payload waste;
- use realtime collaboration for editor deltas;
- use HTTP for business resources and paginated reads;
- do not refetch complete email threads or complete Node projections after an unrelated character edit.

## Performance and durability acceptance scenarios

The future design should be proven against at least these cases:

### Large Node

- dozens of text boxes;
- thousands of chats across multiple text boxes;
- hundreds of email messages across multiple threads;
- many attachment references and inline images;
- long timeline with movements and verifications;
- bounded initial requests and mounted components;
- stable scrolling from newest to oldest.

### Large document

- plain and heavily formatted content at several realistic sizes;
- tables, lists, mentions, links, and attachment image nodes;
- immediate typing latency;
- incremental network bytes proportional to the edit;
- bounded compaction behavior;
- correct static preview and search extraction.

### Same-browser tabs

- six tabs open;
- two or more viewing the same document;
- two tabs editing different ranges;
- two tabs editing the same range;
- duplicated tab identity;
- one tab offline and reconnecting;
- one tab refreshing during unacknowledged work;
- no shared recovery record overwrite;
- deterministic convergence.

### Different users/devices

- simultaneous editing;
- permission differences;
- permission revocation while connected;
- presence and cursor behavior if enabled;
- local undo that does not remove unrelated remote work;
- anchor survival through concurrent insert/delete operations.

### Failure handling

- server unavailable;
- WebSocket reconnect;
- lost acknowledgement;
- duplicated update;
- out-of-order update;
- IndexedDB unavailable or quota failure;
- collaboration worker restart;
- partial compaction failure;
- schema/version mismatch;
- browser close immediately after typing.

Measure at minimum:

- local typing latency;
- React commit time;
- browser CPU and memory;
- bytes sent per edit/minute;
- server CPU;
- database bytes per editing minute;
- initial Node API bytes and request count;
- cross-tab and cross-device propagation latency;
- reconnect/convergence time;
- data retained after each failure.

## Recommended next design work

The next Codex task should not begin by editing migrations. It should first produce a concrete architecture decision record based on this file and current main.

Recommended sequence:

1. Read this document completely.
2. Read `docs/important tasks/!!!FIXEDITORSLOWNESS.md` and identify every earlier decision superseded or still valid.
3. Read `docs/important tasks/realtimechanges.md` for the legacy collaboration history and tests.
4. Read the current Node timeline documentation and current main implementation.
5. Audit the exact current readers/writers and row lifecycles of editor, Node information/projection, chat, email, attachment, domain-event, and realtime-outbox tables.
6. Propose the domain-specific permanent schema for Node text boxes, Project text boxes, and retained Logic Gate storage.
7. Propose the collaboration stream/checkpoint model without committing to table names prematurely.
8. Compare Yjs against ProseMirror-step collaboration using Mango's requirements and a small benchmark/prototype plan.
9. Define JSON's role if Yjs is selected: materialized projection/export rather than per-keystroke authoritative write stream.
10. Define comment anchor storage and old-comment fallback behavior.
11. Define exact retention and compaction rules for every operational table.
12. Define API routes and paginated read models.
13. Define a safe migration/cutover/rollback sequence.
14. Only after review and product approval should implementation work begin.

## Decisions currently considered confirmed

- Mango's core product model is Logic Gates and Nodes, with Projects also using the shared editor behavior.
- Node and Project use multiple independently editable text boxes.
- Logic Gates normally use one large editor.
- Node text boxes, Project text boxes, and Logic Gate content should not be forced into one permanent generic table merely to share editor code.
- A dedicated Node text-box table is desired.
- A dedicated Project text-box table is desired.
- The current Logic Gate information/projection structure is preferred pending detailed review.
- Editor behavior and collaboration protocol should still be shared.
- A Node ties together timeline, text boxes, chats, email associations, attachments, permissions, GVIC, movements, verification, and future snapshots.
- Heavy records remain separate and independently loadable.
- Emails remain durable independent HTML/message records.
- Attachments remain external bytes with permanent IDs and relationships.
- Chats must be paginated and should move away from a general mixed Node projection at the required scale.
- Existing comments must be preserved even if some legacy anchors become unanchored.
- New anchors must survive edits reliably.
- The arbitrary two-MiB Tiptap application limit is not an acceptable final product rule.
- Full-document serialization and full-snapshot persistence on every ordinary save do not meet the target scale.
- Multiple tabs and users must not silently overwrite each other.
- Yjs appears useful and should be seriously evaluated; it is not yet an implemented or final decision.
- Database and API decisions should prioritize lower compute, lower latency, and efficient API usage.
- Search should use a derived search projection rather than dictate one generic authoritative content table.

## Open decisions

- Yjs versus centralized ProseMirror-step collaboration after a measured proof of concept.
- Self-hosted Hocuspocus, another Yjs provider, a custom provider, or no Yjs.
- Exact permanent table and column names.
- Whether collaboration updates are stored in three owner-specific tables or one physically partitioned operational table.
- Where compacted Yjs state lives for each domain-specific document row.
- How frequently automatic compaction occurs.
- How long acknowledged updates and automatic checkpoints remain.
- Whether users receive editor version history beyond intentional Node snapshots.
- Exact normalized chat and comment-anchor tables.
- Exact Node-to-email/text-box/message association constraints.
- How large Logic Gate documents are internally segmented if benchmarks require it.
- Whether `domain_events` becomes the deliberate permanent lightweight event log or is reduced/replaced.
- Whether the existing Node timeline table is authoritative history or a projection of underlying business facts.
- Search technology and indexing cadence.
- Migration handling for legacy HTML documents that expand significantly during conversion.

## Important warning to future agents

Do not mistake the existence of a table, migration, or passing foundation test for product approval of the current architecture.

Do not:

- enable the Tiptap workspace gate;
- convert live data;
- delete old tables;
- remove the two-MiB limit in isolation;
- introduce Yjs/Hocuspocus as an unreviewed dependency;
- replace Node timeline behavior;
- merge comment records into editor JSON;
- convert email HTML to Tiptap;
- create permanent full snapshots for every typing batch;
- build a new generic editor table before resolving the domain-specific storage decision.

First establish the architecture, ownership, lifecycle, migration, rollback, and measurable acceptance criteria.

## Related documents

- `docs/important tasks/!!!FIXEDITORSLOWNESS.md`
- `docs/important tasks/realtimechanges.md`
- `docs/important tasks/speedupnodes.md`
- `docs/important tasks/email nodes.md`
- `docs/important tasks/makeemailsgood.md`
- `docs/backend/mangorts-database.md`
- `docs/backend/node-timeline-verification.md`
- `docs/frontend/src/modules/editor.md`
- `docs/tests/editor.md`
- `docs/tests/nodes.md`
- `docs/tests/attachments.md`

This file is the primary handoff for continuing the Node v2/editor architecture discussion. Where older planning documents conflict with the confirmed decisions listed here, future work must identify the conflict explicitly and obtain product approval rather than silently following the older plan.
