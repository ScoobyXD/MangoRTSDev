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

The permanent current tables are:

- `node_textboxes`, keyed by `company_id`, `node_id`, and `textbox_id`.
- `project_textboxes`, keyed by `company_id`, `project_id`, and `textbox_id`.
- `logic_gate_textboxes`, keyed by `company_id`, `logic_gate_id`, and
  `textbox_id`.

`body_json` contains the Tiptap document and its `annotations` array. Node and
Project rows have `display_order`. Logic Gate rows do not.

## UUID identity rule

Node IDs and Node textbox IDs are stored in PostgreSQL `uuid` columns. The
foundation migration accepts every value PostgreSQL recognizes as a UUID,
including Mango's UUIDv7 IDs. A UUID version describes how an ID was generated;
it is not an editor schema version and is not a reason to rewrite or reject an
existing identity. The migration stops only when a legacy Node resource or
document ID cannot be stored as a PostgreSQL UUID at all.

## Missing parent Node rule

The generic legacy document table did not require a Node document to have a
matching row in `nodes`. The foundation migration copies only documents whose
parent Node exists. A document without its parent stays unchanged in
`editor_json_documents`; it is not silently deleted and no fake Node is made.

The read-only verification script reports each missing-parent document as a
blocker. The cleanup script refuses to drop legacy storage while any remain. A
human must decide whether the Node should be restored or whether its unreachable
legacy document is truly disposable before cleanup can continue.

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

## Kept for phase 2

`node_projection_table`, `project_projection_table`, and
`logic_gate_projection_table` remain in use for titles, attachments, timeline
ordering, chat/email view data, and other metadata. Search keyword columns are
also deferred. Those projections must not be removed by this cutover.

## Rollout and rollback

1. Apply `20260801_editor_textbox_storage_foundation.sql`. It creates and
   backfills the six permanent tables without deleting old data.
2. Deploy the backend that writes the new current and history tables.
3. Run `scripts/verify_editor_textbox_cutover.sql` with a read-only connection.
   Every `blocker` count must be zero.
4. Only then run the guarded cleanup script that removes the obsolete current,
   operation, and automatic-version tables. Do not remove the three projection
   tables.

Rollback before step 4 is an application rollback. The old storage is still
present. Step 4 is deliberately separate because dropping tables is not a safe
automatic rollback point.
