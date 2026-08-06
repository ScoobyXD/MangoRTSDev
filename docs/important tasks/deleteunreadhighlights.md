# Process Story: Node change annotations sleep while the old unread-highlight system is removed

A user opens a Node whose textbox JSON already contains one or more persisted annotations with `"kind": "change"`
↓
Mango loads those annotations as dormant editor metadata: it does not paint them, count them, navigate to them, mark them seen, or call an unread-change API
↓
When the user edits the document, the normal ProseMirror transaction mapping keeps each surviving dormant annotation attached to the same changing text range and the revisioned JSON save writes it back with the matching document revision
↓
The old Node unseen-change reader, writer, comparison, UI, endpoints, cache coupling, recycle handling, and database tables no longer exist
↓
Comments, chats, email selections, document content, entity links, attachments, history, and the rest of the Node editor continue working normally
↓
A future purpose-built change feature may deliberately reactivate the dormant `change` annotations as positional seeds, without restoring or consulting any deleted compatibility path

# Delete the old Node unread-highlight feature but preserve dormant JSON anchors

Status: implementation handoff only. This file does not authorize applying a migration to a live database. Repository schema and migration files may be changed, but a human must run the final operator-controlled database rollout.

Last updated: 2026-08-05

## Requested outcome

Remove the current Node feature that records authored additions/deletions, calculates per-user unseen changes, paints those changes in Node textboxes, displays unread counts and `Seen all`, and supports per-change/bulk mark-seen behavior.

The current implementation is being removed so a new system can be designed later from the ground up. Do not preserve old feature APIs, tables, compatibility readers, fallback calculations, dual writes, or alternate copies of its business data.

The one intentional preservation is existing persisted editor annotation entries whose `kind` is `change`. Keep these entries dormant in textbox JSON so a future system may use their stable IDs and ranges as positional seeds.

This is currently a Node-only removal. Project textboxes use the same editor component but explicitly pass `contentChanges={[]}` in `frontend/src/modules/project-management/ProjectSummaryContent.tsx`. Do not invent Project unread-change cleanup or new Project behavior. Logic Gates also do not use this Node unread-change feature.

## Non-negotiable dormant-annotation contract

The word `block` is informal here. A retained change annotation is not a Tiptap document block and is not stored inside `document.content`. It is an entry in the top-level `body_json.annotations` array:

```json
{
  "format": "mango-tiptap-json",
  "schema_version": 1,
  "document": {
    "type": "doc",
    "content": []
  },
  "annotations": [
    {
      "id": "existing-change-identity",
      "kind": "change",
      "from": 12,
      "to": 25
    }
  ]
}
```

During the dormant period:

- Keep `change` in the persisted generic annotation kind accepted by the frontend and backend.
- Load existing change annotations from canonical JSON even though no Node feature owns them.
- Carry their stable `id`, `kind`, `from`, and `to` through normal editor activation, sleep, realtime recovery, conflict handling, IndexedDB recovery, save, reload, manual history, and restore.
- Map `from` and `to` through each ProseMirror document transaction so later edits do not leave the saved range at stale offsets.
- Save the mapped dormant annotations atomically with the exact document revision they describe.
- Do not render a highlight or decoration for a dormant change annotation.
- Do not include dormant changes in unread counts, navigation targets, Node view payloads, notifications, Updates, or any other product surface.
- Do not activate them on click and do not issue a seen command.
- Do not turn them into comments, chats, marks, nodes, relationship rows, or a new temporary table.
- Preserve comment, chat, and email-selection annotation behavior unchanged.
- If the existing generic transaction-mapping rule removes an annotation because its complete anchored range was actually deleted and collapsed to an invalid empty range, keep that normal document-editing rule. The backend currently requires `to > from`. The feature removal itself must not remove a valid change annotation merely because no owner supplies it.

The current editor does not meet this dormant contract automatically. `NodeTextBlockEditor` builds owner annotations from `props.contentChanges`. `MangoTiptapEditor.publishAnnotationPositions` then merges persisted positions only into owner-supplied annotations. If the old feature simply starts passing an empty array, the next document save can persist an empty change-annotation set. Fix this ownership/round-trip behavior before removing the old reader or dropping tables.

A simple implementation should preserve canonical unowned `change` annotations in a dedicated dormant collection, map them with the existing annotation transaction mechanism, omit their decorations and activation behavior, and include them in the durable save payload. Do not add a speculative abstraction for future change semantics.

## What the preserved annotations do and do not contain

Each dormant entry preserves only:

- stable annotation ID;
- annotation kind `change`;
- current ProseMirror `from` position;
- current ProseMirror `to` position.

The annotations do not preserve the old table's author, actor label, timestamp, addition/deletion type, before/after text, or per-user seen state. Existing JSON annotations also must not be treated as a complete history of every old change: the current owner list was derived from the viewing user's unseen rows, so the saved set may be incomplete or reflect whichever valid owner annotations participated in a save.

The future replacement may use these records as anchors only. It must not reconstruct deleted facts by guessing from their IDs or surrounding text.

## Product behavior to remove

Remove all current Node behavior for:

- generating addition/deletion records from textbox writes, projection writes, email-collaboration writes, project-scoped Node creation, saved-version restore, or any other writer;
- calculating differences between the current textbox and a viewer baseline;
- listing unseen Node content changes;
- grouping or displaying unseen changes by textbox;
- colored change highlighting and focused change navigation;
- clicking a change highlight to mark it seen;
- individual mark-seen;
- `Seen all` for Node content changes;
- first-clean-view/`anchor-clean` baseline creation and its retry/cache bookkeeping;
- unread content-change counts and `content_changes` in the consolidated Node view;
- content-change-specific Node view version bumps, ETag invalidation, realtime refresh, and cache invalidation;
- recycling/restoring old change rows and viewer-baseline rows.

Do not remove unrelated features that happen to use the words seen, unread, highlight, change, or annotation. In particular, preserve:

- Home/Updates read state and the Updates `Seen all` control;
- notifications and mention read state;
- email/message read receipts and mailbox unread state;
- timeline verification recipient completion/seen behavior;
- ordinary text highlight formatting;
- comment, chat, and email-selection annotations;
- editor change/revision tracking used for saving, conflicts, realtime recovery, undo, history, or `has changed` save status;
- `node_view_versions` and `node_view_user_versions` unless a separate audit proves a specific column/object is now unused. These tables support the broader consolidated Node view and must not be dropped just because the old unread feature bumped them.

## Current frontend removal map

Start with fresh `rg` results rather than assuming this list is exhaustive.

### Node data loading and cache

- `frontend/src/modules/nodes/nodeRecordStore.ts`
  - Remove `NodeContentChange` imports and the `content_changes` view shape.
  - Remove `contentChangeCache` and `getNodeContentChangesSingleFlight`.
  - Remove all `anchorClean*` success, inflight, retry, timer, and ETag bookkeeping and the POST to `/v1/nodes/{node}/changes/anchor-clean`.
  - Keep the rest of the consolidated Node view cache, authorization generation, ETag behavior, details, projections, and GVIC loading.

### Editor orchestration

- `frontend/src/modules/editor/EditorContent.tsx`
  - Remove Node content-change state, loaded-Node tracking, refresh tokens, loads, optimistic mark-seen logic, individual seen POST, bulk seen POST, and props passed to the Node workspace.
  - Keep unrelated projection, document, relationship, attachment, chat, history, save-state, and GVIC behavior.
- `frontend/src/modules/editor/nodeContentChanges.ts`
  - Delete this feature-specific module when no imports remain.
- `frontend/src/modules/editor/NodeWorkspaceSurface.tsx`
  - Remove `unseenChanges`, grouping by block, change focus resolution, unread count/`Seen all` UI, and mark-seen callbacks.
  - Do not disturb chat/email/block navigation or annotation navigation for surviving kinds.
- `frontend/src/modules/editor/NodeWorkspaceSurfaceShared.tsx`
  - Remove the feature-specific shared props/types only.
- `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx`
  - Stop constructing owner annotations from `props.contentChanges`.
  - Remove the `onAnnotationActivate` branch that calls `onChangeSeen`.
  - Keep chat annotations and pending non-durable chat selections.
  - Add the dormant preservation path described above before the content-change owner input disappears.
- `frontend/src/modules/project-management/ProjectSummaryContent.tsx`
  - Remove the now-obsolete `contentChanges={[]}` prop after the shared component contract no longer declares it. Do not add a Project replacement.

### Generic annotation plumbing that must survive

- `frontend/src/modules/editor/tiptap/mangoTiptapAnnotations.ts`
  - Keep generic position mapping and durable persistence.
  - Keep `change` as a supported persisted kind during dormancy.
  - Ensure dormant changes do not create decorations or activation UI while comment/chat/email-selection annotations still do.
- `frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx`
  - Change the current owner-only merge so valid persisted dormant changes survive without a feature owner.
  - Preserve them through canonical recovery, IndexedDB recovery, save, conflict resolution, sleep/wake, and remount.
- `frontend/src/modules/editor/tiptap/MangoTiptapStaticRenderer.tsx`
  - Confirm dormant changes are not rendered on sleeping/read-only surfaces.

Search CSS and tests for `mango-tiptap-annotation--change`, content-change colors, change-focus attributes, and unread badges. Remove only selectors that have no remaining generic use.

## Current backend removal map

### HTTP and domain shape

- `backend/internal/http/node_handlers.go`
  - Remove routing and handlers under `/v1/nodes/{node}/changes`.
  - The removed endpoints include the list, `anchor-clean`, `seen-all`, and `/{change_id}/seen` forms.
  - Do not retain a compatibility response or empty-success stub. Removed routes should no longer be product APIs.
- `backend/internal/domain/types.go`
  - Remove `NodeContentChange` and `NodeView.ContentChanges` after all consumers are removed.
- `backend/internal/store/consolidated_views.go`
  - Remove `ListUnseenNodeContentChanges` from `nodeViewLoader`, the parallel load, and `content_changes` assembly.
  - Preserve all other Node view sections and their authorization/ETag contract.

### Repository contracts and implementations

- `backend/internal/store/repository.go`
  - Remove `ListUnseenNodeContentChanges`, `MarkNodeContentChangeSeen`, and `AnchorCleanNodeProjections` plus their input types.
- Delete feature-specific production and memory logic from:
  - `backend/internal/store/node_content_changes.go`;
  - `backend/internal/store/postgres_nodes.go`;
  - `backend/internal/store/memory_nodes.go`;
  - `backend/internal/store/postgres_node_view_versions.go`;
  - `backend/internal/store/node_view_versions.go`.
- Remove every `buildNodeContentChanges`, `insertNodeContentChangesTx`, `recordNodeContentChangesLocked`, or equivalent call from all writers, including:
  - JSON textbox create/update/delete and revision/restore paths;
  - legacy/final projection writer paths that remain for other supported behavior;
  - manual saved-version restore;
  - email collaboration atomic writes;
  - project-scoped Node creation and writes;
  - memory-repository equivalents.
- Known files containing calls at the time this handoff was written include:
  - `backend/internal/store/postgres_editor_textboxes.go`;
  - `backend/internal/store/postgres_editor_projection_revisions.go`;
  - `backend/internal/store/postgres_editor_save_versions.go`;
  - `backend/internal/store/postgres_nodes.go`;
  - `backend/internal/store/postgres_project_scoped_creates.go`;
  - `backend/internal/store/email_collaboration_atomic_chat.go`;
  - their memory counterparts.

Remove the old business writes completely. Do not silently rebuild the same changes in a new event, JSON field, log, cache, or temporary table.

### Generic editor JSON validation that must survive

`backend/internal/store/editor_json.go` currently accepts persisted annotation kinds `comment`, `change`, `chat`, and `email-selection`. Keep `change` accepted so old dormant annotations continue to load and save. Do not require a matching `node_content_changes` row. The generic annotation validator should continue to validate stable ID and non-empty positions only.

## Database retirement

Remove the following current feature tables from the canonical schema and through one new forward-only migration:

- `node_content_change_seen`;
- `node_content_changes`;
- `node_textbox_seen_snapshots`.

Remove their indexes, foreign keys, table comments, readiness requirements, and triggers. Known schema objects include:

- `idx_node_content_changes_node_created`;
- `idx_node_content_change_seen_user`;
- `idx_node_textbox_seen_snapshots_user`;
- `node_content_changes_textbox_fk`;
- `trg_node_view_version_content_changes`;
- `trg_node_view_user_version_change_seen_mutation`;
- `trg_node_view_user_version_change_seen_delete`;
- `trg_node_view_user_version_snapshots`;
- `mangorts_trg_bump_node_view_user_from_change_seen()`;
- `mangorts_trg_bump_node_view_user_from_snapshot()` if a fresh reference audit proves no surviving trigger calls it.

Drop child/dependent objects before parent tables. Audit `pg_depend` or exact schema references before dropping a shared function. Do not drop the general `mangorts_trg_bump_node_view_from_direct_node()` function; surviving Node tables and timeline tables use it.

Update `backend/db/schema.sql`, `backend/internal/store/postgres.go` required-table/required-column checks, and current database readiness scripts. Do not rewrite shipped historical migrations. Add a new migration that retires the current objects. Historical migration files remain historical evidence and are not a compatibility path.

The migration and any copy-paste operator preflight must:

- support the development database's PostgreSQL 17.x requirement;
- report `server_version` and `server_version_num` and return STOP before a write script when unsupported;
- use plain PostgreSQL SQL that runs in DBeaver, with no psql backslash commands or `:variables`;
- compare exact unordered column-name sets and exact counts if it validates a table shape;
- never treat physical column order as drift;
- refuse unexpected dependencies instead of using a broad `CASCADE` that could delete unrelated objects;
- never touch `node_textboxes.body_json`, `node_textboxes_history.body_json`, `project_textboxes`, or `logic_gate_textboxes` while dropping the old feature tables.

Agents must not apply this migration to a live database. Provide the final preflight/write/verification SQL for human execution if the implementation task requests operator scripts.

## Recycle Bin handling

`backend/internal/store/postgres_recycle_bin.go` currently snapshots and restores all three retired tables. Remove them from:

- `recycleSnapshotTables`;
- `recycleRestoreTableOrder`;
- Node snapshot capture queries;
- restore and deletion tests that expect their rows.

Old `recycle_bin_items.restore_payload` JSON may contain top-level keys named after the retired tables. Because backward compatibility is not wanted, do not retain restore readers for those keys. The new runtime should ignore/remove unsupported retired keys and restore only surviving current tables.

If the forward migration prunes those obsolete top-level keys from existing recycle payloads, it must preserve the embedded `node_textboxes` and `node_textboxes_history` rows byte-for-byte, including their dormant `body_json.annotations` change entries. Do not confuse the obsolete top-level table keys with annotations nested inside textbox `body_json`.

Update `docs/tests/recycle-bin.md` and its Process Story so Node recycle/restore promises only surviving Node data.

## Required rollout order

Do not combine the rollout in an order that leaves deployed code querying missing tables or lets normal editing erase annotations.

1. Implement and test dormant annotation round-tripping and non-rendering.
2. Remove the frontend feature owner, UI, loads, and commands while retaining dormant anchors.
3. Remove backend readers, writers, APIs, consolidated-view fields, cache/version coupling, and recycle capture/restore references.
4. Update the canonical schema, readiness checks, tests, and documentation.
5. Run the full repository verification against a disposable/local schema that includes the new retirement migration.
6. Deploy code that no longer references the tables.
7. Only then have a human run the approved live-database preflight and forward retirement SQL.
8. Verify live application health and dormant annotation preservation after the human-run migration.

There must be no period where old code runs against dropped tables. There must also be no period where owner annotations are removed before dormant annotations can safely round-trip.

## Required data audit and preservation evidence

Before implementation, record read-only counts for current data without printing document contents:

- active `node_textboxes` rows;
- current Node textbox rows containing at least one `annotations[*].kind == "change"`;
- total valid dormant change annotations in current Node textbox JSON;
- `node_textboxes_history` rows and total change annotations in history JSON;
- row counts in each table being retired;
- recycle items whose payload contains any retired top-level table key;
- recycle payload Node textbox/history rows containing dormant change annotations, if practical with a bounded read-only query.

Do not print textbox text, credentials, or unrelated JSON. Use aggregate counts and hashes/identities needed for preservation proof.

After code/schema verification, prove:

- dropping the three feature tables does not alter current or history textbox JSON;
- a no-op open/sleep/reload does not remove dormant change annotations;
- an ordinary edit before a dormant range maps and persists its positions;
- an ordinary edit inside a dormant range maps and persists its positions;
- saving and reloading preserves the same dormant annotation identity and kind;
- comments, chats, and email selections still persist and render normally;
- dormant changes produce no highlight DOM/CSS state, unread badge, navigation, API request, or mark-seen write;
- Node consolidated views contain no `content_changes` field and do not read any retired table;
- current Node writes and saved-version restores do not attempt to create old change rows;
- Project and Logic Gate editors remain unchanged except for removal of an obsolete empty prop;
- recycle and restore work with surviving rows and do not query missing tables.

## Required automated coverage

Replace tests of the deleted behavior with tests of the new absence and preservation contract. Do not merely delete every test that mentions the feature.

At minimum add or retain coverage for:

1. A canonical Node textbox with one dormant `change`, one comment, and one chat annotation loads successfully.
2. The dormant change creates no decoration/highlight and cannot activate a seen callback.
3. A normal edit maps and saves the dormant change while the other annotation kinds keep their normal behavior.
4. Sleep/wake, remount, realtime canonical recovery, IndexedDB recovery, and save/reload do not erase dormant changes.
5. The backend accepts a `change` annotation without a matching database business row.
6. The consolidated Node view omits `content_changes` and performs no feature read.
7. Removed `/v1/nodes/{node}/changes...` routes are absent rather than compatibility stubs.
8. Every supported Node textbox writer succeeds with the feature tables absent and never issues feature SQL.
9. Recycle/restore succeeds with the tables absent and preserves Node current/history `body_json`.
10. Canonical schema and a disposable PostgreSQL migration contain none of the retired tables, indexes, triggers, or dedicated functions.

Likely test files needing removal or rewriting include:

- `backend/internal/store/node_content_changes_test.go`;
- `backend/internal/store/node_content_changes_sql_test.go`;
- `backend/internal/store/node_view_versions_test.go`;
- `backend/internal/store/node_view_versions_sql_test.go`;
- content-change portions of `backend/internal/store/memory_test.go`;
- content-change/anchor portions of `backend/internal/http/consolidated_view_handlers_test.go`;
- final-storage and recycle schema contract tests that currently require the tables;
- `tests/frontend/modules/editor/mangoTiptapEditorIntegration.test.tsx`;
- `tests/frontend/modules/editor/nodeTextBlockEditorHydration.test.tsx`;
- `tests/frontend/modules/editor/editorRowVirtualizationReact.test.tsx`;
- `tests/frontend/modules/editor/editorTextBlockChatNavigation.test.tsx` where change navigation is mixed with surviving chat navigation.

Run fresh `rg` searches because generated bundles/build caches are not source and because the exact test list may change before implementation.

## Documentation that must change with implementation

This removal changes business logic. Update the Process Story and numbered laws in the appropriate current contract files in the same implementation change, especially:

- `docs/tests/nodes.md`;
- `docs/tests/editor.md`;
- `docs/tests/recycle-bin.md`;
- `docs/tests.md`;
- `docs/frontend/src/modules/nodes.md`;
- `docs/frontend/src/modules/editor.md`;
- `docs/backend/README.md`;
- current production/data-migration inventories that claim the three tables are required.

Read and follow `docs/tests/relationships.md` before changing recycle/permanent-deletion behavior. Preserve exact Node/textbox ownership and do not create a replacement registry, surrogate ID, generic edge, or compatibility identity.

Do not edit old historical task notes merely to pretend they always described the new world. `docs/important tasks/Old Stuff/deletemapandunreadshighlights.md` deliberately documents an older map-retirement job whose scope preserved unread highlights. It is not the current contract for this new removal.

## Repository search checklist

Before declaring completion, run focused source searches excluding generated output and build caches. There should be no production reference to:

```text
node_content_changes
node_content_change_seen
node_textbox_seen_snapshots
ListUnseenNodeContentChanges
MarkNodeContentChangeSeen
AnchorCleanNodeProjections
buildNodeContentChanges
insertNodeContentChangesTx
getNodeContentChangesSingleFlight
nodeContentChangeSeenGroupKey
content_changes
anchor-clean
changes/seen-all
onMarkChangeSeen
onMarkAllChangesSeen
unseenChanges
```

Some historical migrations and old documentation may still contain the retired names. Review every remaining hit and classify it explicitly; do not blindly rewrite historical records.

Production source should still contain the generic persisted kind `change` and the deliberate dormant-preservation implementation/tests. A search with zero `"change"` annotation support is a failure, not success.

## Verification gate

Run proportionate focused tests during implementation, then finish with:

```powershell
cd C:\Users\Jonat\MangoRTSDev
node scripts\run_all_tests.mjs
```

On this Windows machine, follow the repository guidance for Go execution and App Control. Do not weaken Windows Security. Use disposable/local database verification only; never apply the schema change to a live database as part of an agent implementation.

The task is complete only when:

- dormant change annotations survive and stay position-correct without rendering;
- all old unread-highlight product behavior is absent;
- all old feature readers and writers are absent;
- the canonical schema and forward migration remove the three tables and their dedicated objects;
- unrelated seen/read/highlight systems still work;
- Projects and Logic Gates have not acquired new behavior;
- current documentation states that the old system is gone and dormant JSON anchors remain for a future redesign;
- the full verification gate passes.

## Explicit non-goals

- Do not design or implement the replacement change/unread system in this task.
- Do not infer old author, text, timestamp, change type, or seen state from dormant anchors.
- Do not create a temporary replacement table, compatibility API, dual writer, event mirror, or fallback reader.
- Do not remove all annotation infrastructure.
- Do not remove comment/chat/email-selection highlights.
- Do not remove Updates, notification, email, timeline, or other unrelated read/seen features.
- Do not mutate current/history textbox document content while retiring the tables.
- Do not push, merge, or apply a live migration without a separate explicit user request.
