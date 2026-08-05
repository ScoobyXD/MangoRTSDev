# Process Story: Editor Textboxes and Manual History

A Node or Project user opens a textbox, or a Logic Gate user opens its one document
↓
The current body comes from the exact `node_textboxes`, `project_textboxes`, or `logic_gate_textboxes` row
↓
The existing projection-shaped response is assembled from permanent textbox, attachment, chat where the product supports it, and exact email relationships instead of a stored legacy projection row
↓
Manual saves create one batch in the matching `node_textboxes_history`, `project_textboxes_history`, or `logic_gate_textboxes_history`
↓
Recycle snapshots and restores order the owner before its final textbox/history rows; Node and Project then restore their supported textbox chats, email relationships, and attachment relationships in dependency order

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
- `project_textboxes`, keyed by `company_id`, `project_id`, and `textbox_id`. It also owns the Project textbox title, email display reference/accent, metadata revision, and display order. File metadata remains in final attachment tables.
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

## Projection cutover status

Project runtime storage has completed the next phase:

- `project_textbox_chats` is the only current Project textbox-chat store.
- Exact Project attached-email ownership comes from `email_relationships`.
- Project textbox titles and supported display metadata live on `project_textboxes`.
- Project files come from `attachments` and `attachment_relationships`.
- The backend rebuilds the existing Project projection-shaped API response from those final tables.
- No production Project request reads or writes `project_information` or `project_projection_table`.

The two legacy Project tables are retired and absent from fresh-database schema.
Node now uses the same final-storage rule, while its separate three-table operator
retirement remains gated by copy, no-writer, smoke, soak, and snapshot evidence.

Logic Gate runtime storage has now completed its application cutover:

- `logic_gate_textboxes` is the only current Logic Gate document store.
- `logic_gate_textboxes_history` is the only manual saved-version store.
- The product has one Logic Gate document and no Logic Gate textbox chat feature or chat table.
- Exact Logic Gate attached-email ownership comes from `email_relationships` joined to `email_messages` and `email_threads`.
- Logic Gate files come from `attachments` and `attachment_relationships`.
- The backend rebuilds the existing projection-shaped API response from those final tables.
- No production Logic Gate request reads or writes `logic_gate_information` or `logic_gate_projection_table`.

The two legacy Logic Gate tables are retirement candidates only after the
separately operated PostgreSQL 17 preflight/copy, matching backend deployment,
smoke/recycle checks, reconciliation, soak, snapshot, dependency proof, and
explicit operator approval complete.

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

## Rollout and rollback

1. Apply `20260801_editor_textbox_storage_foundation.sql`. It creates and
   backfills the six permanent tables without deleting old data.
2. Deploy the backend that writes the new current and history tables and includes
   those six tables in Recycle Bin snapshots/restores.
3. From `frontend`, run the converter with the database-enforced read-only role.
   Dry-run is the default; it validates every selected active and recycled
   document, resolves durable attachment metadata, and writes nothing:

   ```powershell
   npm run convert:editor-textbox-history -- --company-id <company-id> --host <host> --port 5432 --database <database> --user mangorts_readonly --sslmode require
   ```

   Interactive runs always ask for the database password without displaying it,
   so a stale `PGPASSWORD` or `DB_PASSWORD` cannot be reused accidentally. The
   entered password is passed only to the converter child process; it is not
   printed, written to a file, or retained in the parent shell. Non-interactive
   automation must provide `PGPASSWORD` in its process environment.

4. Review the counts, then rerun with a human-managed writer connection and the
   explicit write confirmations. Do not give the writer credential to an agent:

   ```powershell
   npm run convert:editor-textbox-history -- --company-id <company-id> --host <host> --port 5432 --database <database> --user <writer-user> --sslmode require --apply --allow-write --confirm-database <database> --confirm-company-id <company-id>
   ```

   Apply is one guarded transaction. It inserts converted manual history, adds
   converted current/history rows to recycle payloads, removes old save rows
   from those payloads, and rolls everything back on any mismatch. It does not
   enable editor JSON mode and does not run the destructive cleanup.
5. Run `scripts/verify_editor_textbox_cutover.sql` with the read-only connection.
   Every `blocker` count must be zero.
6. Only then run `scripts/apply_editor_textbox_cleanup.sql`. It removes obsolete
   current, operation, automatic-version, and legacy save rows, but keeps the
   three phase-2 projection tables.
7. Apply `20260801_z_retire_legacy_editor_storage.sql` through the normal reviewed
   migration workflow. It records the final state when cleanup already ran and
   refuses to continue if any of the nine legacy tables is still nonempty.

Rollback before step 6 is an application rollback. The old storage is still
present. Step 6 is deliberately separate because dropping tables is not a safe
automatic rollback point.
