# Email Nodes Prototype

Status: implemented prototype on 2026-07-16

## Product outcome

An email conversation can become a real Mango Node from either My Triage or Shared Triage. The user comments on an exact reply, optionally after highlighting text. The first submit asks for priority, then creates one email-derived Node and saves the comment only after the backend acknowledges it. Triage and the Node show the same chat records; there is no copied or synchronized second conversation.

## User journey

1. Open a conversation in My Triage or Shared Triage.
2. On an exact reply, choose **Comment**, or highlight text and use the existing chat action.
3. Type the comment and press Enter. Mango opens the existing priority choices (1 through 5).
4. Choose priority. Mango validates the exact mailbox and provider message/thread, creates or reuses the Node, assigns the creator Generated GVIC, and then commits the first chat message.
5. After acknowledgement, the comment appears in the triage rail. The reply and triage row show a Node indicator.
6. Open the indicator to navigate to the existing Node. The left email pane opens at that reply; a stored quote is activated in the same thread, the middle contains the normal editor/text boxes, and the right contains the same chat.

## Business rules

- Identity is company plus exact personal account or shared inbox plus provider thread ID, with exact message ID fallback. Repeated or concurrent creates reuse one Node.
- The Node represents the whole provider conversation, not a copied single reply. A one-message conversation simply has one message.
- Priority is mandatory for first-comment creation. Invalid or missing priority is rejected before provider reads or durable creation.
- The creator is the direct Generated GVIC owner. The Node starts with no Logic Gate and is placed once in Unfiled/Nodes.
- The first comment, later comments, replies, attachments, @mentions, urgent !mentions, links, and existing version-reference text all use the normal Node `Text block chat` model and shared ChatPane.
- A root comment stores the target provider message ID. When text is highlighted it also stores the trimmed quote and offsets. Node text selections additionally store the originating text-box ID.
- Mentioned same-company users become durable Node-chat participants through the existing atomic chat/participant write. Existing Node mention/comment events drive Updates.
- A mention never adds a provider recipient, never changes To/Cc/Bcc, never subscribes the person to provider delivery, and never makes the person an email participant.
- Collaboration default access remains `no_access`. Creator and accepted mention participants receive direct edit grants. Generic permission replacement remains blocked, so a company role or folder policy cannot leak the source thread.
- Authorized participants may read the complete source thread through the collaboration adapter even without source-mailbox credentials. Nonparticipants cannot discover or read it by guessing Node, collaboration, message, draft, or attachment IDs.
- The canonical source `Attached email` projection cannot be overwritten or deleted. The Node itself remains protected from generic deletion while the collaboration owns it.
- Normal Node work behavior is available after creation: title, text boxes, saved versions, GVIC/account changes, Project relationships, and later Logic Gate/Kanban assignment.
- Every primary-email-origin Node uses the three-column layout, including Nodes created through existing email drag/conversion paths: email left, editor middle, chat right.
- Every later Logic Gate/Kanban/Project projection of an email-origin Node preserves `created_from_email=true` and uses the established email icon. Immediate mutation responses preserve the flag as well as canonical reads.
- Additional attached email sources use the existing attachment identity/reference path and appear as browser-style tabs in the left pane. Switching a tab changes the visible full thread without copying provider bodies or bytes.

## What is shared and what is per text box

- Node-wide: source email tabs, the canonical Triage/email conversation in the primary right pane, participant access, priority, GVIC, work relationships, and the Node identity.
- Per text box: editor document, title, structured collaboration revision, save state, and the existing per-text-box chat context on additional text-box rows.
- A selection from the primary middle editor can be written into the canonical email chat with `selection_block_id`, so navigation returns to that editor. Additional text boxes keep their normal block chat instead of being silently merged into the Triage conversation.
- An email selection comment is written into that same chat with provider message ID, quote, and offsets. Navigation returns to the exact reply/quote in the active email tab.

## Implementation decisions

- Reused `communications_email_collaborations`, the canonical `Attached email` projection, `Text block chat`, `ChatPane`, Node information endpoints, atomic mention participant writes, existing Updates events, existing provider-thread loader, existing attachment references, normal Node saved versions/work relationships, and established email-card icon fields.
- Added mandatory `priority` to collaboration ensure. Memory and PostgreSQL creation set Node priority and direct creator Generated GVIC in the same creation transaction.
- Marked the canonical attached-email payload `created_from_email=true`; Kanban, Logic Gate work, and Project projections recognize collaboration-backed Nodes as email origin.
- Relaxed the old protected-shell exclusions for ordinary Node work paths while retaining canonical email, collaboration permission, Explorer placement, and delete safety.
- The frontend waits for the chat POST before adding the message to visible history or clearing the composer.
- The Triage row/reply Node indicator opens the existing Node and carries the clicked provider message ID. The Node expands/scrolls the reply and activates the matching anchored chat when present.

## Prototype limitations and follow-ups

- **Create Shared Draft** still uses its existing explicit path and currently supplies priority 3 when it must lazily ensure a collaboration. The mandatory selector is implemented for first-comment creation; a future shared-draft design can add its own explicit priority chooser.
- The Node chat header shows compact durable authors/direct mention history. Triage retains the richer immutable direct-user/group-provenance roster; the Node header does not yet reproduce the full group-history popover.
- Unfiled/Nodes placement is intentionally collaboration-owned and cannot be moved or removed independently, even though the Node can participate in Projects, Logic Gates, and Kanban.
- Existing version-reference text behavior is reused unchanged; this prototype does not add a new parser or UI for version syntax.
- No live database was changed. The repository already contains the required collaboration, participant, Node, projection, permission, GVIC, work, and attachment tables, so this prototype requires no new migration or human schema rollout.

## Verification

Focused automated coverage includes:

- collaboration create/reuse, full thread identity, provider-truth validation, and invalid/missing priority before provider reads;
- creator priority and Generated GVIC, normal Node work paths, canonical email protection, Unfiled placement, and email-origin Logic Gate cards;
- atomic mention participation, authorization, attachment privacy, and shared chat information writes;
- frontend priority payloads, no false optimistic saved chat, exact reply Node marker/focus, source tabs, three-column origin layout, projection parsing, and text-box/email selection context;
- frontend production build plus the repository full verification gate recorded in the implementation commit handoff.