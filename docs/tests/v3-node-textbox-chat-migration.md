# Process Story: current Node textbox chats copy without touching legacy rows

A user can open a Node textbox and see its current comments
↓
The current comment authority is the active `Text block chat` row in `node_projection_table`; `node_information` is event/history storage and may contain older or stale rows
↓
During the operator-controlled Step 2 transaction, the additive expansion component creates `node_textbox_chats`, a versioned shared classifier, and migration ledgers without deleting data or changing the application
↓
The inventory, copy, and verification scripts all consume that same classifier. Invalid JSON and invalid identities are classified before casts; exact source and target identities are preserved
↓
The copy script inserts safely mapped projections in a short transaction. The projection `information_id` becomes `chat_id`, payload `block_id` becomes `textbox_id`, and exactly resolved provider message selections become permanent internal email-message IDs
↓
A valid chat whose user account was deleted keeps its message and captured author name while `author_user_id` becomes null. A reply whose same-textbox parent cannot survive becomes a top-level comment
↓
A chat whose permanent textbox does not exist is recorded as `discarded_deleted_host` but is not deleted from legacy storage. Invalid, ambiguous, or conflicting content is recorded as `needs_human_mapping` and is not copied
↓
Rerunning the script leaves exact targets unchanged, copies only a later delta, and records `already_copied`. An unexpected target mismatch rolls back the current transaction
↓
The application continues to read and write the legacy tables until a later maintenance-window cutover. No legacy table or row is removed by this baby phase

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
