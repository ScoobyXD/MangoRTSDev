# Nodes Frontend Module

Last updated: 2026-08-05

## Purpose

Nodes remain first-class workspace records with a full Editor, relationship structure, authored-change highlighting, unread counts, manual saved versions, permissions, attachments, exact email ownership, chats, recycle, and restore behavior.

## Module ownership

- `frontend/src/modules/nodes/types.ts` owns the shared Node record, projection, relationship, details, and permission types.
- `frontend/src/modules/nodes/nodeRecordStore.ts` owns coalesced Node detail, projection, GVIC, and missing-resource reads. Its authored-change and unread fields are part of the protected Node contract.
- `frontend/src/modules/nodes/nodeRelationshipGraph.ts` owns the in-memory full-workspace Node and relationship snapshot used by Editor, Home, project, and title-reconciliation consumers.
- `frontend/src/modules/nodes/nodeRelationshipStructure.ts` derives connected structures and parent/peer/child rows without owning persistence.
- `frontend/src/modules/nodes/relationshipRules.ts` owns the write semantics for parent, peer, and child relationship creation.
- `frontend/src/modules/nodes/selectionNodeCreation.ts` and `TextSelectionNodeCreator.tsx` create a durable Node from selected Editor text and optionally create its relationship and Explorer placement in the same entity batch.

## API and cache contracts

- Node lists, details, updates, permissions, GVIC assignments, relationships, deletion, recycle, and restore use their existing Node APIs.
- `/v1/workspace/entity-batches` creates Nodes, relationships, folder items, GVIC assignments, and entity mappings. Items contain identity, title, and optional Explorer position only.
- Workspace snapshots use `full`, `company_explorer`, or `kanban` scopes. Node relationship snapshots contain Nodes and `node_relationships` only.
- Committed title updates patch or invalidate Node record, relationship graph, Kanban, Home, Explorer, Project, and dock/pin caches without overwriting an active title draft.
- Generic live selection connects Explorer, Editor, and Kanban frames. Selection is not persisted as entity geometry.

## Relationship rules

- Parent creation writes `(a=Child, b=Parent)` because the newly created Node is the parent of the source Node.
- Child creation writes `(a=Parent, b=Child)`.
- Peer creation writes `(a=Peer, b=Peer)`.
- `node_relationships` remains canonical storage. Folder movement and entity deletion keep their existing relationship cleanup rules.

## Authored changes and unread behavior

This removal does not change Node highlighting or seen behavior:

- `node_content_changes` stores authored additions and deletions against the stable textbox ID.
- `node_content_change_seen` and `node_textbox_seen_snapshots` preserve per-user seen state and baselines.
- `node_view_user_versions` preserves Node-view unread/seen versions and ETags.
- `/v1/nodes/{node}/changes` routes remain the read and mark-seen contract.
- TipTap `change` annotations, author labels, addition/deletion highlights, unread badges, mark-seen commands, backend validation, frontend caches, and tests remain active.

## Editor, history, and restore

- Current Node documents live in `node_textboxes` and use the authenticated JSON Editor contract.
- Manual Save appends one saved batch to `node_textboxes_history`, including saving-user identity.
- History listing and Restore keep the current stable textbox identities and authored-change behavior.
- Attachments, exact email relationships, chats, permissions, collaboration, deletion, recycle, and restore keep their existing non-canvas ownership rules.

## Verification

Focused coverage lives in:

- `tests/frontend/modules/nodes/nodeRecordStore.test.ts`
- `tests/frontend/modules/nodes/nodeRelationshipStructure.test.ts`
- `tests/frontend/modules/nodes/relationshipRules.test.ts`
- `tests/frontend/modules/editor/nodeContentChanges.test.ts`
- `backend/internal/http/server_test.go`
- the Node storage, history, authored-change, unread, recycle, relationship, and permission suites under `backend/internal`.