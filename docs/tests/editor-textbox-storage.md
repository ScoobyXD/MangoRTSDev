# Process Story: Editor Textboxes and Manual History

## What the user does

The user types in a Node, Project, or Logic Gate textbox. Ordinary typing saves
the latest JSON document and its annotations. The user can also press the manual
save-history button and later restore that saved batch.

## Ordinary save

1. The backend reads the current textbox row and locks it during the save.
2. If the submitted revision is current, the backend replaces `body_json` and
   increases `revision` by one.
3. The same transaction inserts one `realtime_outbox` event so other connected
   editors reload the new snapshot.
4. The save does not insert an operation row or an automatic version row.
5. PostgreSQL supplies the commit timestamp. A row's `updated_timestamp` is
   never earlier than its `created_timestamp`.

The permanent current tables are:

- `node_textboxes`, keyed by `company_id`, `node_id`, and `textbox_id`.
- `project_textboxes`, keyed by `company_id`, `project_id`, and `textbox_id`.
- `logic_gate_textboxes`, keyed by `company_id`, `logic_gate_id`, and
  `textbox_id`.

`body_json` contains the Tiptap document and its `annotations` array. Node and
Project rows have `display_order`. Logic Gate rows do not.

## Retired legacy storage

The current schema does not create these superseded tables:

- `editor_json_documents`, `editor_json_operations`, and
  `editor_json_versions`.
- `project_editor_documents`, `project_editor_document_operations`, and
  `project_editor_document_versions`.
- `logic_gate_editor_documents`,
  `logic_gate_editor_document_operations`, and
  `logic_gate_editor_document_versions`.

The backend current-document methods use only the three permanent textbox
tables. PostgreSQL rejects the retirement migration if any legacy table still
has rows, so a database that has not completed conversion cannot silently lose
documents. Historical conversion and verification tools remain available for
that pre-retirement work.

## UUID identity rule

Node IDs and Node textbox IDs are stored in PostgreSQL `uuid` columns. The
foundation migration accepts every value PostgreSQL recognizes as a UUID,
including Mango's UUIDv7 IDs. A UUID version describes how an ID was generated;
it is not an editor schema version and is not a reason to rewrite or reject an
existing identity. The migration stops only when a legacy Node resource or
document ID cannot be stored as a PostgreSQL UUID at all.

## Deleted and recycled resource rule

The generic legacy document table did not require a Node document to have a
matching live row in `nodes`. That is normal while a deleted Node is waiting in
the Recycle Bin: the old JSON document stayed outside the recycle payload and
became reachable again after restore.

The cutover converter fixes that old behavior without adding an editor table. It
puts converted `node_textboxes` rows inside the existing recycle payload. It
also converts current Node, Project, and Logic Gate textbox projections and
manual history already stored in old recycle payloads. A future delete snapshots
the six permanent current/history tables directly. Restore recreates the owner
first and then restores those textbox rows.

Verification and cleanup block when a recyclable document or old recycled
textbox/history row has not been converted. A legacy document with neither a
live owner nor a recycle payload is unreachable and may be discarded by the
cleanup; the verification script reports that count separately.

## Simple conflict rule

When the submitted revision is stale, the backend compares top-level Tiptap
block IDs:

- A server-only block stays. This means a conflicted deletion does not delete it.
- A user-only block is appended.
- If the same block ID has two different bodies, the server block stays and a
  copy of the user's block is appended with a new block ID.
- Existing server annotations stay during this emergency merge. Local absolute
  annotation positions are not copied because the appended blocks change those
  positions. The returned snapshot lets the client reload the merged result.

This is intentionally a small safety rule. It avoids silently throwing away
text; it is not a full collaborative editing engine.

## Manual history

The permanent manual history tables are:

- `node_textboxes_history`
- `project_textboxes_history`
- `logic_gate_textboxes_history`

One press of the history button creates one `batch_id`. Every active textbox is
copied into a separate history row with that same batch ID. History rows do not
have a user-entered save name. `saved_by_user_id` records who pressed save when
that ID is available.

Project history keeps the textbox title and attachment metadata inside the
historical JSON so restoring an old batch does not lose that batch's view data.
The project name shown in the history response is read from the Project table;
the submitted snapshot name is not stored.

Old rows marked `auto` came from a disabled automatic snapshot feature. They are
not button-pressed history, and the new history tables intentionally have no
`save_kind` column. The converter and cleanup discard those rows instead of
mislabeling them as manual saves.

## Final V3 Node storage

`node_textboxes` is the only current Node textbox body store. It also owns user-controlled display order and has no title column. `node_textbox_chats` stores Node textbox comments/replies, `node_textbox_seen_snapshots` stores exact per-user baselines, and `node_content_changes.textbox_id` points to the permanent textbox.

The V3 cutover removes `node_information`, `node_projection_table`, and `node_projection_seen_snapshots`. No current Node body, title, attachment array, chat payload, or attached-email payload is composed from those tables. Project and Logic Gate information/projection tables remain unchanged because this cutover does not replace them.
## Read-only development evidence

The 2026-08-01 database-enforced read-only audit found:

- 640 active Node manual history rows and 26 active Logic Gate manual history
  rows. All passed the production HTML-to-Tiptap converter.
- 15 more Node manual history rows inside recycle payloads.
- 58 Node, 3 Project, and 4 Logic Gate current textbox projections inside
  recycle payloads.
- 20 missing-parent Node JSON documents. Every one matched a recycle payload;
  none was unexplained or disposable orphan data.
- 43 disabled automatic snapshots: 24 active and 19 inside recycle payloads.
  These are intentionally excluded.

No document body or credential was printed or stored during the audit.

## V3 rollout and rollback

1. Back up the target database and stop old application writers during the reviewed maintenance window.
2. Run `scripts/verify_editor_textbox_cutover.sql` with the database-enforced read-only role. Every reported blocker must be zero and every required V3-readiness assumption must be understood before a writer is used.
3. Have a human operator apply `20260802_zz_v3_database_table_cutover.sql` through the normal migration workflow. The migration asserts the exact legacy schema, repairs only missing email rows from unambiguous fallback snapshots, validates every mapping, rewrites attachment identities, and drops all retired tables in one transaction.
4. Deploy the V3 backend and frontend together. Old binaries must not run after the retired tables are dropped.
5. Run the read-only verifier again, then run the application smoke tests for Node textbox create/edit/delete/reorder, comments, seen state, saved history, related email, drafts, attachments, permissions, realtime updates, and Recycle Bin restore.

`apply_editor_textbox_cleanup.sql` is deliberately retired and always aborts. Running it could otherwise create a partial state outside the strict V3 transaction.

Rollback before the migration commits is the transaction rollback. After commit, rollback requires restoring the backup and the compatible pre-V3 application together; recreating retired tables by hand is not a supported rollback.