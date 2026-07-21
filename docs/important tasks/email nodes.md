# Email Nodes

Status: implemented and clarified on 2026-07-20

## Product outcome

An email or email thread is imported into one Node-wide email column. The email column is separate real estate from every text box. Users explicitly create text boxes from individual email messages or selections, and each text box owns its directly attached chat. Mango stores the email-message-to-text-box link and matching color so the association survives closing the Node, reloading the page, and opening the Node again.

## Workspace composition

- The Node-wide email column contains every attached email source. A source can be a one-message email or a complete chronological thread.
- Multiple attached sources appear as tabs inside that one email column. The thread is never copied into a text box.
- Text boxes form the normal Node text-box sequence, using the existing creation-time ordering.
- A text box row owns its text editor and directly attached chat. An email-linked row may also open a transient inline preview of its exact source message; the provider body remains email-owned and is never copied into the text-box projection.
- The Node-wide email column, a text box editor, and that text box's chat are independently toggleable. Any one, any pair, or all three can be visible at the same time.
- The email column fills the remaining Node height down to the bottom edge and has a collapse control in its own header.
- One visible surface receives the full available workspace. Two visible surfaces split that workspace into two distinct columns. With all three visible, email remains its own column while the text-box row divides its remaining space between editor and chat.
- Collapsing email never moves the thread into a text box. It only gives the remaining editor and/or chat surface more width.
- An email-linked text box has a durable accent and a “Linked email” marker. Activating it reveals the exact source message in the separate email column.
- Activating a source email message reveals the text boxes linked to that exact message.

## Email-to-node workflows

### Create a node from an email

1. The user chooses **Create node for this email** and selects priority.
2. Mango validates the exact personal account or shared inbox plus provider message/thread.
3. Mango creates or reuses the collaboration Node and one canonical Node-wide `Attached email` projection.
4. If the chat composer is empty, Mango creates no text box. The Node opens with the email column ready, and the user creates text boxes from the desired messages.
5. If the user wrote a chat first, Mango creates or reuses a text box linked to that exact email message, then saves the chat directly against that text box.

### Create a text box from a message

- The user activates the message or highlights a selection in the Node-wide email column and chooses the text-box action.
- Mango creates a normal `Text box` projection with `email_message_id` and `email_accent`.
- Each linked text box references exactly one email message. Repeated explicit actions may create multiple text boxes from the same message; each remains an independent text box and chat.
- The accent is persisted in the text-box projection. It is not inferred from transient component state or browser layout storage.
- The text box is inserted into the normal creation-time sequence. Its header can expand the shared full email conversation card on demand, but no email body is duplicated into text-box content.

### Chat from My Triage or Shared Triage

- Chat submission first resolves the existing same-mailbox collaboration by thread/message identity.
- Mango creates or reuses a text box linked to the exact message being discussed.
- Every new `Text block chat` projection stores the real text-box ID in `block_id`.
- The triage chat and the chat beside that text box read the same projection; there is no copied or synchronized second conversation.
- A root email chat stores the provider message ID. A highlighted selection also stores the quote and offsets.
- Attachments added from the triage chat are linked to the same real text-box ID.

### Import into an existing Node

- Import attaches the durable email/thread once in the Node-wide email column.
- The explicit import action may also create the requested email-linked text box and optional initial chat.
- The linked text box stores the selected message ID and accent, and its chat stores that text-box ID.
- Importing a reply does not copy provider bodies into the text box.

## Persistence and compatibility

- The canonical source `Attached email` projection owns the email/thread reference and cannot be overwritten or deleted through generic Node information operations.
- `Text box` projections own editor content plus `email_message_id` and `email_accent`.
- `Text block chat` projections own chat and point directly to a `Text box` through `block_id`.
- The frontend restores the association and color from durable projections after unmount, reload, and navigation.
- Older chat records that used an Attached-email information ID remain readable beside the linked text box. This is read compatibility only: new chats and attachments are never written to an Attached-email ID.
- Repeated or concurrent collaboration creation reuses one Node using company, exact mailbox, and provider thread/message identity.

## Permissions and normal Node behavior

- Priority is mandatory when a new email collaboration Node must be created.
- The creator receives direct Generated GVIC ownership. The Node starts in Unfiled/Nodes with no Logic Gate.
- Collaboration default access remains `no_access`; accepted chat participants receive the existing direct grants.
- Normal Node title, versions, accounts, Projects, Logic Gates, Kanban, and additional text-box behavior remains available.
- Email-origin work projections preserve `created_from_email=true` and the established email icon.
- Email bodies remain subject to the existing sanitized, sandboxed rendering boundary. Provider credentials, temporary URLs, attachment bytes, and presigned URLs are not stored in Node projections.

## Implementation decisions

- Collaboration ensure creates the Node and canonical `Attached email` projection only. It deliberately does not create a `Text box`.
- The frontend suppresses its normal automatic blank-text-box behavior when a newly opened Node already contains attached email.
- Explicit message/selection actions use the existing conversion endpoint to create linked text boxes.
- Triage chat uses the shared ChatPane and waits for the backend chat acknowledgement before clearing the composer.
- The Node retains one global email column. A linked text box may expose an on-demand email preview below its shared header, but it does not create another persistent email column or a second email data owner.

## Verification contract

Focused automated coverage must prove:

- collaboration creation persists one canonical Attached email and zero automatic text boxes;
- empty **Create node** opens the email-only Node;
- explicit email actions persist `email_message_id` and `email_accent`;
- accents and associations round-trip through projection parsing;
- a text-box row keeps editor/chat headers on one horizontal row and mounts a linked-email preview only after the explicit expansion action;
- new triage chats and chat attachments use the linked text-box ID;
- direct text-box chat wins when both direct and legacy Attached-email chat records exist;
- legacy Attached-email chat remains readable without becoming a new write destination;
- My Triage and Shared Triage use the same persistence path; and
- the frontend build, backend tests, and full repository verification gate pass.

No live database is changed by this implementation. No new migration or human schema rollout is required for this correction.

## Node email/editor/chat layout correction (2026-07-20)

### Visible layout contract

- The left email column has one header: mail icon, column collapse, collapse/expand all threads, and create-folder. When no folders exist, email cards start immediately under that header; Mango must not add an `Attached emails` wrapper.
- The email column's minimum height matches a complete fixed text-box row while element measurement is settling, then grows to the remaining Node viewport. A short initial measurement must never leave a blank lower strip beside the editor rows.
- Editor and Chat labels live in the text-box's single 38-pixel header row. Embedded Node `ChatPane` content is headerless because the shared row already owns that label and toggle.
- New ordinary and email-linked text boxes open editor-only. Chat opens automatically only for a box that already has durable chat messages, or after the user explicitly opens/starts chat.
- The three-dot text-box action menu uses viewport-fixed positioning so the fixed-height row cannot clip it. Delete still requires confirmation and removes only that text-box projection plus chat projections whose `block_id` is that box.

### Chat ownership and legacy compatibility

Older email-created Nodes may have chat rows whose `block_id` is the Attached-email projection ID. That legacy conversation resolves to a stable host in this order:

1. a text box whose persisted `email_message_id` matches the source message;
2. the Attached-email projection's declared `block_id`, when it names a current text box; or
3. the oldest current text box for old records without either association.

Prepending a new text box must never change that host. New chat writes always use the real text-box ID. A brand-new box therefore cannot inherit unrelated email-origin chat merely because it became the first rendered row.

### Linked-email expansion

- An email-linked header uses the exact persisted email accent for its left border, background tint, mail action, and matching card.
- **Email** expands the reusable full conversation card inside the fixed row. It includes subject/sender metadata, sanitized body, attachments, thread disclosure, reply actions, and selection actions under the original mailbox identity.
- **Hide email** collapses the preview and returns the row's space to Editor and Chat. Expansion state is local UI state and is cleared on Node change or text-box deletion.
- The separate left column remains available for scanning and organizing all attached sources; inline expansion is a fast inspection path, not another canonical email copy.

### Optional attachment read failures

The node-wide attachment count is a convenience read. A network failure is displayed in the attachment menu as `Attachments are temporarily unavailable. Retry from the attachment menu.` It does not publish the browser's raw `Failed to fetch` string to the global bottom-left editor error surface. Save, delete, chat, and email failures that affect the user's requested mutation continue to use their normal error reporting.
