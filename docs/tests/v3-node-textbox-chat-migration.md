# Process Story: copy Node textbox chats, then switch the backend authority

A user can open a Node textbox and see its current comments
↓
Before cutover, the current comment authority is the active `Text block chat` row in `node_projection_table`; `node_information` is event/history storage and may contain older or stale rows
↓
With Node chat writers paused, the operator-controlled Step 2 transaction creates `node_textbox_chats`, classifies the legacy rows, copies every safe row, links existing attachments through `resource_attachments`, and verifies the result
↓
Invalid JSON and invalid identities are classified before casts. The projection `information_id` becomes `chat_id`, payload `block_id` becomes `textbox_id`, and exactly resolved provider message selections become permanent internal email-message IDs
↓
The backend is then deployed and reads, creates, edits, and deletes Node comments through `node_textbox_chats`; it rebuilds the existing frontend payload shape without writing new legacy chat rows
↓
A valid chat whose user account was deleted keeps its message and captured author name while `author_user_id` becomes null. A reply whose same-textbox parent cannot survive becomes a top-level comment
↓
A chat whose permanent textbox does not exist is recorded as `discarded_deleted_host` but is not deleted from legacy storage. Invalid, ambiguous, or conflicting content is recorded as `needs_human_mapping` and prevents Step 2 from committing
↓
Deleting a Node textbox deletes every chat owned by that textbox, including chats that quote an email, and tombstones their chat-attachment links. The normalized email message, thread, and email attachments remain
↓
Legacy chat rows remain untouched as rollback evidence. Rerunning Step 2 leaves exact targets unchanged and an unexpected mismatch rolls back the transaction

## Required scenarios

V3CHAT1 - The operator-controlled expansion component creates the final `node_textbox_chats` columns, keys, checks, indexes, shared classifier, and migration ledgers without copying a chat or changing a legacy table. It is not placed in the automatic backend migration folder.

V3CHAT2 - The classifier reads `Text block chat` rows from `node_projection_table`, never treats `node_information` as current chat authority, and validates JSON and every castable identity before conversion.

V3CHAT3 - A current chat with a surviving `(company_id, node_id, textbox_id)` copies with the old projection `information_id` as `chat_id` and the JSON `block_id` as `textbox_id`.

V3CHAT4 - A valid author ID that no longer exists copies as null `author_user_id` while preserving `author_display_name` and message content.

V3CHAT5 - A same-textbox surviving parent is linked after both comments exist. A missing, wrong-textbox, hostless, malformed, or otherwise uncopyable parent leaves the child as a top-level comment.

V3CHAT6 - A text selection keeps its textbox identity, quote, and valid offsets. An email selection copies only when its provider message ID resolves to exactly one current internal email-message ID in the same company; zero or multiple matches require human review.

V3CHAT7 - Missing-host rows are recorded as `discarded_deleted_host`, invalid or ambiguous rows are recorded as `needs_human_mapping`, and neither category is deleted or rewritten in legacy storage.

V3CHAT8 - The first copy records `copied`; a safe rerun records `already_copied`, inserts no duplicate, and can copy a later source delta.

V3CHAT9 - A pre-existing target that differs from the classified source is a review item. The copy never overwrites it.

V3CHAT10 - The inspection query separates heap, index, and TOAST storage from live row counts so a large physical `node_information` relation is not mistaken for current chat volume.

V3CHAT11 - After cutover, Node chat create, edit, read, and delete operations use `node_textbox_chats`; active legacy `Text block chat` projections are excluded from Node reads and no new legacy chat projection or information row is written.

V3CHAT12 - An email selection may retain both its owning/selected textbox ID and its resolved internal email-message ID. The public payload continues to expose the provider message ID expected by the frontend.

V3CHAT13 - Chat attachment content remains in `attachments`; chat ownership is represented by active `resource_attachments` rows using `resource_type = 'node_chat_message'`, `resource_id = chat_id`, and `relationship_kind = 'chat_attachment'`.

V3CHAT14 - Deleting a chat also deletes reply descendants and tombstones their chat-attachment links. Deleting a textbox deletes every chat in that textbox and tombstones those links, while the associated email message/thread and email attachments remain.

V3CHAT15 - The live rollout order is: pause Node chat writers, rerun Step 1, run and commit Step 2 only at zero review/missing-host counts, deploy the backend cutover, smoke-test chat behavior, and resume writers. The backend cutover must not be deployed before Step 2.
