# V2: Merge Editor Changes Better

Date: August 5, 2026

Status: Investigation and recommended work. This document does not change current editor business logic.

## Executive Summary

Mango does not currently use a CRDT. Mango uses full TipTap JSON snapshots, revision numbers, stable operation IDs, IndexedDB recovery, PostgreSQL transactions, and WebSocket notifications. This makes local typing fast and saves reliable, but it does not provide character-level merging when multiple people edit the same document.

Macro is a useful reference because it combines a structured rich-text editor, a CRDT, local browser storage, WebSockets, and one Cloudflare Durable Object per document. Macro markets its documents as Markdown-native, but its live collaborative state is not a raw Markdown file. It is a structured Lexical document tree stored in Loro CRDT containers. Markdown is an import, export, and agent-friendly representation.

Mango should not replace TipTap JSON with Markdown. Mango's JSON stores important product data that ordinary Markdown cannot preserve reliably, including stable block IDs, annotations, entity links, attachment identities, image metadata, table properties, colors, alignment, and other node attributes.

The first Mango improvement should not be a CRDT rewrite. The first improvement should fix the current stale-save merge behavior. The production backend can silently create a merged document that is different from the document still displayed by the saving browser. The browser then advances to the new revision and may overwrite parts of that server merge on its next save.

Recommended order:

1. Stop silently accepting stale saves until the saving browser can receive and apply the exact committed result.
2. Add two-browser tests for same-block edits, different-block edits, deletions, reconnects, and typing during an in-flight save.
3. Build a true three-way block merge using the original base document.
4. Prototype TipTap with Yjs on one isolated Mango editor surface.
5. Adopt a CRDT only if it preserves every Mango-specific document feature.
6. Consider Cloudflare Durable Objects only after choosing the collaboration model. Durable Objects are a hosting choice, not the feature that performs the merge.

## What Macro Is

Macro is a company workspace that combines documents, email, messages, tasks, calls, CRM, diagrams, pull requests, and AI agents. Its current product is positioned as one place where people and agents can do company work.

Macro began around 2020 as CoParse. Founder Jacob Beckerman had worked on investment logic at Bridgewater. The original product was a PDF reader and editor aimed at legal, finance, and other document-heavy users. CoParse rebranded to Macro near the end of 2022 and expanded from PDF software into a broader work platform.

Known funding history includes:

- A $9.3 million seed round announced in 2023 and led by Andreessen Horowitz.
- A $12 million Series A announced in 2024.
- Macro currently says it has raised approximately $30 million in total.

Macro's business model includes a free personal plan, a hosted paid plan, enterprise deployment options, and commercial licenses for closed-source derivatives. The hosted service is the company's primary product.

Macro made its repository public under AGPLv3 on May 31, 2026. The company describes the repository as the full product rather than an open-core sample.

Primary links:

- Product: https://macro.com/
- Documents: https://macro.com/documents/
- Pricing and company information: https://macro.com/pricing/
- FAQ: https://docs.macro.com/faq
- GitHub repository: https://github.com/macro-inc/macro
- Original a16z investment announcement: https://a16z.com/announcement/investing-in-macro/
- 2023 seed coverage: https://techcrunch.com/2023/02/08/macro-raises-9-3-to-layer-intelligence-on-top-of-digital-documents/

## Macro's Editor Technology

Macro's document system has five main parts:

1. Lexical provides the rich-text editor.
2. Loro provides the CRDT.
3. IndexedDB stores local snapshots and a local update log.
4. WebSockets carry CRDT updates between the browser and the sync service.
5. One Cloudflare Durable Object coordinates each document.

The relevant Macro source areas are:

- Sync service overview: https://github.com/macro-inc/macro/blob/main/services/sync-service/README.md
- Document-to-Durable-Object routing: https://github.com/macro-inc/macro/blob/main/services/sync-service/src/cf_worker.rs
- Durable Object session: https://github.com/macro-inc/macro/blob/main/services/sync-service/src/durable_object.rs
- WebSocket update handling: https://github.com/macro-inc/macro/blob/main/services/sync-service/src/websocket.rs
- Server-side Loro state: https://github.com/macro-inc/macro/blob/main/services/sync-service/src/state.rs
- Durable operation storage: https://github.com/macro-inc/macro/blob/main/services/sync-service/src/storage/backends/durable_kv.rs
- Snapshot storage: https://github.com/macro-inc/macro/blob/main/services/sync-service/src/storage/backends/durable_sql.rs
- Browser collaboration engine: https://github.com/macro-inc/macro/blob/main/packages/collaboration/src/collab/engine.ts
- Browser write-ahead log: https://github.com/macro-inc/macro/blob/main/packages/collaboration/src/collab/wal.ts
- Browser snapshot storage: https://github.com/macro-inc/macro/blob/main/packages/collaboration/src/collab/snapshot-store.ts

### What a CRDT Does

CRDT means Conflict-free Replicated Data Type. It represents changes as small operations with enough identity and history for every replica to calculate the same final result.

If Alice and Bob edit while disconnected, their updates do not need to arrive in the same order. Once both replicas receive the same complete set of operations, deterministic CRDT rules cause them to converge on the same document.

Macro uses Loro, an MIT-licensed CRDT library designed for collaborative and local-first structured data. Loro supports rich text, maps, lists, movable lists, trees, version vectors, snapshots, and incremental updates.

Loro links:

- Repository: https://github.com/loro-dev/loro
- Documentation: https://loro.dev/docs/tutorial/get_started

### What Happens When a Macro User Types

The simplified flow is:

```text
Lexical editor
  -> local Loro operation
  -> local IndexedDB write-ahead log
  -> WebSocket
  -> the document's Durable Object
  -> durable pending-operation storage
  -> acknowledgement to the sender
  -> broadcast to the other connected replicas
```

The local editor applies the change immediately. A keystroke does not wait for the network. This is the main reason the editor feels fast.

The browser records local updates in IndexedDB. If the browser goes offline or the connection fails, it retains the updates and retries later. Macro's current code removes undelivered write-ahead-log records after seven days, so the offline guarantee is not unlimited.

The server applies an incoming update to its Loro document, writes it to pending durable storage, acknowledges the sender after the write, and broadcasts it to the other peers. Periodically, it creates a compact snapshot covering those pending operations.

On reconnect, the browser sends a Loro version vector describing what it has already seen. The server exports only the missing updates. If an update arrives before a causal dependency, Loro can hold it until the missing dependency arrives.

### What the Durable Object Does

Macro derives a deterministic Durable Object name from the document ID. Every active connection for one document therefore reaches the same logical object.

That object owns:

- The live Loro document state.
- Connected WebSockets.
- Presence and cursor awareness.
- Pending CRDT operations.
- Snapshot scheduling.
- Version and synchronization information.

This gives Macro one fast coordination point per document. It removes the need to build and operate a separate consistent-hashing layer for document sessions.

A Durable Object is not immortal and it is not the CRDT. Cloudflare may stop and restart it. The object reloads durable state when required. The CRDT is what makes updates merge correctly; the Durable Object is where live coordination and durable acceptance happen.

Cloudflare describes Durable Objects as globally unique objects with private, strongly consistent storage. Their input and output gates help prevent outgoing messages from escaping before required storage writes complete.

Cloudflare references:

- Rules and storage gates: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Durable Object glossary: https://developers.cloudflare.com/durable-objects/reference/glossary/
- Lifecycle: https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- Limits: https://developers.cloudflare.com/durable-objects/platform/limits/

### What "Edits Merge in Order" Really Means

Macro's marketing wording is simpler than the real behavior.

Cloudflare does not guarantee that network requests arrive in real-world chronological order. A CRDT does not need that guarantee.

Macro combines:

- One live coordination point per document.
- Durable storage before acknowledgement.
- Loro operation IDs and causal history.
- Version vectors for reconnect and gap recovery.
- Deterministic handling of truly concurrent operations.

"Merge in order" therefore means causally dependent operations are respected and concurrent operations have a deterministic result. It does not mean one global wall clock perfectly orders every keystroke.

"Always consistent" means replicas converge once they have the same operations. An offline browser can still display an older state until it reconnects.

### How Macro Uses Markdown

Macro is Markdown-friendly, but its collaborative document is not a raw Markdown string.

Its Loro schema models a recursive Lexical tree. Nodes contain maps for attributes, Loro text containers for text, stable IDs, and movable lists for child nodes.

Relevant source:

- Loro document schema: https://github.com/macro-inc/macro/blob/main/packages/lexical-core/markdown-loro-schema.ts
- Markdown to Loro snapshot: https://github.com/macro-inc/macro/blob/main/packages/lexical-core/markdown-loro-snapshot.ts
- Markdown state conversion: https://github.com/macro-inc/macro/blob/main/packages/lexical-core/utils/markdown-state.ts
- Markdown export endpoint: https://github.com/macro-inc/macro/blob/main/services/lexical-service/src/endpoints/markdown.ts
- Markdown import endpoint: https://github.com/macro-inc/macro/blob/main/services/lexical-service/src/endpoints/markdown-snapshot.ts

The actual relationship is:

```text
Markdown import
  -> Lexical structured document
  -> stable node IDs
  -> Loro CRDT state
  -> collaborative editing
  -> Markdown export when requested
```

This is the correct lesson for Mango: structured state can remain authoritative while Markdown is supported at the boundary.

### How Macro Lets AI Edit Documents

Macro's AI editing worker joins the same document as a real Loro peer. It receives human CRDT updates and produces normal CRDT updates of its own. It does not download a stale document, replace the full document, and hope no human edited at the same time.

Relevant source:

- AI editing architecture: https://github.com/macro-inc/macro/blob/main/services/ai-editing-worker/AI_EDITING.md
- AI editing workspace: https://github.com/macro-inc/macro/blob/main/services/ai-editing-worker/src/editing-workspace.ts

This is a strong long-term model for Mango agents. Human and agent changes should eventually use the same ordered collaboration protocol.

## Mango's Current Editor Architecture

Mango currently uses TipTap and ProseMirror with a structured JSON document.

The active save path is:

```text
TipTap transaction
  -> local editor updates immediately
  -> approximately 500 ms quiet timer or 10 second maximum timer
  -> one complete TipTap JSON snapshot
  -> one latest-unsaved IndexedDB recovery record
  -> HTTP POST with operation ID and base revision
  -> PostgreSQL transaction
  -> current JSONB document and new revision
  -> realtime outbox event
  -> small WebSocket revision notification to other browsers
```

The main implementation and rules are:

- Editor process and rules: `docs/tests/editor.md`
- Browser synchronization: `frontend/src/modules/editor/tiptap/mangoTiptapSync.ts`
- TipTap editor integration: `frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx`
- PostgreSQL editor commit: `backend/internal/store/postgres_editor_textboxes.go`
- HTTP handler: `backend/internal/http/editor_json_handlers.go`
- Canonical JSONB columns: `backend/db/schema.sql`

### What Mango Already Does Well

Mango already has several important collaboration foundations:

- Local typing does not wait for network or storage.
- IndexedDB protects the latest unsaved document.
- Stable operation IDs make retries safe after a lost response.
- A base revision prevents simple accidental overwrites.
- PostgreSQL row locking serializes concurrent commits.
- The document change and realtime outbox entry commit atomically.
- Other browsers receive compact revision notices.
- Stable block IDs provide a basis for comparing document structure.
- Full snapshots remain easy to inspect, back up, search, and render.

These are good foundations. A CRDT would replace or extend the collaboration representation, not erase every part of this system.

### Why Mango Is Not a CRDT

Mango currently sends complete documents rather than character-level or structural operations.

The backend does not receive causal histories or version vectors. Two clients cannot independently apply the same set of updates and calculate the same result. Instead, PostgreSQL accepts one complete snapshot and handles a stale snapshot through revision logic and a custom block merge.

This is revisioned snapshot storage, not replicated operation merging.

## The Current Stale-Merge Problem

The production PostgreSQL implementation currently calls `mergeMangoTiptapDocuments` when `base_revision` is stale.

That function has only:

- The latest server document.
- The incoming local document.

It does not have the exact original base document that both versions started from. This makes it a two-way comparison, not a true three-way merge.

For the same block ID, the current function:

- Keeps the server block.
- Appends the incoming local block with a new block ID when content differs.
- Keeps the server block when it is missing locally, treating the missing block as a conflicted deletion.
- Appends local-only blocks.

Without the base document, the backend cannot reliably tell the difference between:

- A block the local user deliberately deleted.
- A block created on the server after the local document was loaded.
- A block the local user never changed.
- A block changed independently by both users.

### Saving Browser Can Diverge From PostgreSQL

There is a more serious result after a stale merge:

1. PostgreSQL commits the server-generated merged document.
2. The HTTP response returns only `operation_id`, `revision`, `committed_at`, and `deduplicated`.
3. The saving browser advances its base revision and displays Saved.
4. The saving browser still contains its pre-merge local document.
5. The saving browser ignores its own realtime revision event.
6. Its next save can submit that local document at the latest revision and overwrite pieces of the earlier server merge.

The client and PostgreSQL can therefore disagree immediately after Mango reports Saved.

This violates a central lesson from Macro: a replica that receives an acknowledgement must also be able to reach the exact acknowledged shared state.

## Immediate Recommendations

### Priority 0: Stop Silent Stale Merges

Until Mango can apply the exact committed merge to the saving browser, a stale `base_revision` should return an explicit revision conflict before committing a new document.

Mango already has a conflict interface with "Keep my version" and "Use saved version." That interface is less convenient than automatic merging, but it is honest and prevents a hidden browser/server split.

This change should remove the current production-only blind merge path rather than preserve it as a fallback.

Required tests:

- Two browsers edit the same paragraph.
- Two browsers edit different paragraphs.
- One browser deletes a block while another edits it.
- One browser inserts a block while another saves.
- A browser continues typing while an earlier save is in flight.
- A save acknowledgement is lost and retried.
- The saving browser and PostgreSQL contain the same document after every successful save.
- Reconnect and revision-gap recovery produce the canonical document without losing unsaved work.

### Priority 1: Implement a True Three-Way Block Merge

The merge must have:

- Base: the exact document at `base_revision`.
- Local: the user's changed document.
- Server: the latest committed document.

For each stable block ID:

| Base to local | Base to server | Result |
|---|---|---|
| Unchanged | Changed | Use server |
| Changed | Unchanged | Use local |
| Same change | Same change | Use one copy |
| Different change | Different change | Conflict for that block |
| Deleted | Unchanged | Keep deletion |
| Unchanged | Deleted | Keep deletion |
| Deleted | Changed | Conflict for that block |

Block insertion and ordering also need deterministic rules. A successful merge must be returned to and applied by the saving browser before it is marked Saved.

A base hash alone is not enough to perform the merge. The merge service needs access to the actual base content, either from durable revision history or another server-trusted representation.

### Priority 2: Warn About Remote Edits Earlier

When a realtime revision notice arrives while local work is pending, Mango currently protects the local work by not replacing it. That protection is correct.

Mango can still improve the experience by showing an immediate, non-blocking message such as "Another person edited this document" and fetching the latest server metadata in the background. The system should not wait until the next save to reveal that the base revision changed.

This is useful even before automatic merging exists.

## CRDT Recommendation for Mango

If Mango needs Google-Docs-style simultaneous editing, a CRDT is the correct long-term direction.

Because Mango already uses TipTap, the first prototype should use TipTap's official Yjs collaboration extension. Macro's Lexical and Loro implementation is valuable as a reference, but it is not a direct fit for Mango's frontend or Go backend.

TipTap's official collaboration stack uses:

- `Y.Doc` as the shared document.
- `@tiptap/extension-collaboration` to bind TipTap to Yjs.
- A provider such as Hocuspocus or another compatible WebSocket service.
- Yjs updates for persistence and synchronization.

Official references:

- TipTap collaboration overview: https://tiptap.dev/docs/collaboration/getting-started/overview
- TipTap collaboration extension: https://tiptap.dev/docs/editor/extensions/functionality/collaboration
- Installation: https://tiptap.dev/docs/collaboration/getting-started/install
- Hocuspocus: https://tiptap.dev/docs/hocuspocus/introduction

### Required Prototype Scope

The prototype should use one isolated, non-production document surface and prove:

- Two browsers can type in the same paragraph simultaneously.
- Offline edits replay and converge after reconnect.
- Collaborative undo does not undo another user's changes.
- Stable Mango block IDs remain unique.
- Tables and table attributes survive.
- Attachment IDs and image metadata survive.
- Mango entity links survive.
- Annotations and comment ranges remain attached to the correct content.
- Save versions can be created and restored.
- A JSON snapshot can be exported for existing Mango reads and rendering.
- Permission revocation disconnects or blocks an editor immediately.
- Agent edits can use the same update protocol.

### Possible Durable Form

With a CRDT, the canonical collaborative form may become a Yjs or Loro binary update stream plus periodic snapshots. TipTap JSON can remain a projection for search, rendering, version display, export, and other existing Mango features.

There must be one clear authority. Mango should not allow an independently writable JSON document and independently writable CRDT document to become two competing sources of truth.

## Should Mango Use Durable Objects?

Not immediately.

Durable Objects fit this problem well because each document can have one live coordinator with WebSockets and strongly consistent local storage. They would save Mango from building some distributed coordination infrastructure.

Benefits:

- Natural one-object-per-document model.
- WebSocket support and connection hibernation.
- Strong local storage semantics.
- Easy serialization of document coordination.
- Many independent documents can scale as many independent objects.

Costs and risks:

- Mango currently uses AWS and PostgreSQL, so this adds another cloud boundary.
- Authentication and authorization must stay synchronized with Mango permissions.
- Backups, observability, incident response, and data residency become more complex.
- One object is a throughput boundary for one document.
- Business data, attachments, permissions, and relationships still belong in Mango's existing backend.
- A decision is required about whether the Durable Object or PostgreSQL is authoritative for document state.

If Mango eventually uses Durable Objects, they should initially be limited to the collaboration sync plane. Mango's business entities, permission checks, attachment relationships, and other resource data should remain in PostgreSQL. Document snapshots can be projected back to PostgreSQL for normal product reads, search, history, and backup.

PostgreSQL can also support the first CRDT prototype. Mango already has WebSockets, transactional outbox delivery, row locking, authentication, and resource permission checks. Cloudflare is not required to prove whether CRDT editing works for Mango.

## Markdown Versus JSON for Mango

Mango should keep structured TipTap JSON rather than switch its canonical document format to Markdown.

Mango JSON carries information ordinary Markdown does not represent reliably:

- Stable block IDs.
- Annotation and comment ranges.
- Mango entity type, ID, and label metadata.
- Attachment IDs, filenames, MIME types, and accessibility text.
- Image dimensions, position, layout, alignment, and link metadata.
- Table widths, cell alignment, color, and other attributes.
- Font sizes, colors, highlights, and supported rich-text marks.
- Intentional empty paragraphs and hard breaks.
- Custom Mango nodes and marks.

Forcing all of this into Markdown extensions or embedded metadata would produce a custom format that is harder to inspect than JSON and is no longer portable Markdown.

Recommended model:

```text
Canonical structured editor state
  -> deterministic Markdown export for people and agents

Markdown import
  -> validated TipTap document with Mango IDs and metadata
```

Markdown should be generated on demand or tied to an exact document revision. Mango should not maintain writable Markdown and writable JSON copies of the same document.

## Licensing Warning

Macro's application repository is AGPLv3. AGPL includes obligations for modified software made available to users over a network. Mango should not copy Macro's sync service or application code into a closed-source service without legal review.

It is safe to learn from the architecture and independently implement the design with appropriately licensed dependencies.

Loro itself is MIT-licensed. Yjs and Hocuspocus also need their current licenses verified before adoption, along with the licenses of the exact TipTap packages and any commercial features selected.

## Proposed Delivery Layers

### Layer 1: Correctness

- Remove silent stale merge behavior.
- Use the existing explicit conflict path.
- Add real two-browser tests.
- Prove browser state equals committed state after every acknowledgement.

### Layer 2: Better Snapshot Merging

- Retain server-trusted base documents.
- Add a true three-way merge.
- Automatically accept non-overlapping block changes.
- Present only actual conflicting blocks to the user.
- Apply the committed merge to every browser.

### Layer 3: CRDT Prototype

- Add TipTap/Yjs to one isolated editor surface.
- Persist Yjs updates and periodic snapshots.
- Test Mango's custom schema and annotations.
- Test offline, reconnect, undo, and concurrent agents.
- Compare operational complexity with the snapshot architecture.

### Layer 4: Production Collaboration

- Choose PostgreSQL/WebSocket hosting, Hocuspocus, TipTap Collaboration, or Durable Objects.
- Define one document-state authority.
- Cut the approved editor surfaces over without maintaining an obsolete compatibility path.
- Preserve JSON projections and Markdown import/export.
- Add monitoring, backup, recovery, and permission-revocation tests.

## Final Decision

Mango is not currently using a CRDT.

Macro demonstrates a strong long-term editor architecture: local operations, durable acknowledgement, deterministic CRDT convergence, reconnect by version vector, periodic snapshots, and agents participating as normal editing peers.

The fastest meaningful Mango improvement is to fix the stale-save correctness gap and add proper multi-browser tests. A true three-way block merge can then improve ordinary non-overlapping edits without requiring an immediate platform rewrite.

For full live collaboration, Mango should prototype TipTap with Yjs before considering Macro's Loro stack. Mango should keep structured editor data, add Markdown at the import/export boundary, and evaluate Durable Objects only after the collaboration representation is proven.
