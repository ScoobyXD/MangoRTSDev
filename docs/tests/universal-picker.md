# Process Story: The universal picker references or links an exact typed resource

A user opens the shared universal picker from a Node, Logic Gate, or Project editor, a Node or Project Attach email action, or a selected My Triage/Shared Triage message
↓
The picker opens above a transparent dismiss layer, focuses one search field, and shows Nodes, Logic Gates, Projects, and Emails as typed categories
↓
Single-hashtag reference mode inserts or opens the chosen exact resource without changing a business relationship
↓
Double-hashtag link mode enables only the destination types supported by the source and submits unchanged canonical identities through the established permission-checked command
↓
The Emails category replaces the workspace list with the connected personal mailbox's Inbox, Starred, Sent, All, or Spam results and enlarges the picker so six or seven message rows remain visible
↓
Choosing an email preserves its provider message identity and mailbox scope; an editor stores a durable email reference chip, while a Node or Project link uses the existing exact-message attachment command
↓
The picker creates no generic relationship, translated identity, compose surface, send path, draft path, or compatibility email picker

Last updated: 2026-08-07

# Universal Picker Business Logic Laws

UP1 - Mango has one shared Universal picker implementation. Node, Logic Gate, and Project Tiptap editors, the selected-email placement toolbar, and Node/Project Attach email actions must not implement separate picker search, keyboard, category, or mode behavior.

UP2 - Typing `#` with a collapsed caret in an active Node, Logic Gate, or Project Tiptap editor opens the picker at the trigger position and focuses the picker's single search input. The trigger remains owned by that exact document and selection until the picker selects, cancels, or becomes stale.

UP3 - The selected My Triage or Shared Triage email launcher opens the picker in `##` link mode. The Node and Project Attach email actions also open in `##` link mode with Emails selected. Ordinary editor hashtag entry starts in `#` reference mode.

UP4 - The picker has exactly two meanings. `#` is reference mode and may insert an inline entity chip or open a selected resource without changing any relationship. `##` is link mode and must complete the source host's documented business relationship before an editor inserts the same target as a reference chip.

UP5 - While the focused search is empty, typing `#` in reference mode changes to link mode only when the host supplied at least one legal link target. While the focused search is empty, Backspace in link mode changes to reference mode. The footer mode control performs the same transition. Every mode transition returns to All, clears the query, and clears workspace results.

UP6 - The category row is ordered Nodes, Logic Gates, Projects, Emails. Emails is immediately to the right of Projects. The matching single-letter shortcuts are N then Tab, L then Tab, A then Tab, and E then Tab. A shortcut changes category and clears the shortcut text; it does not select a result.

UP7 - Clicking an active category selects that exact type and clears the query. Clicking the already active category returns to All. In link mode a category is enabled only if the source host supplied that type as a legal link destination; a disabled category cannot be selected by pointer or keyboard.

UP8 - Reference mode permits all four exact types: Node, Logic Gate, Project, and email message. Link mode permits only the host's typed destination list and never expands that list because a result happens to be visible or pinned.

UP9 - The legal `##` matrix is exact: Node may link to a Logic Gate, Project, or email message; Logic Gate may link to a Project; Project may link to an email message; and a selected email may link to a Node, Logic Gate, or Project. Email-to-email linking is not supported.

UP10 - A blank All, Nodes, Logic Gates, or Projects view reads the current user's complete company-scoped Pinned tree. It preserves stored folder/pin sibling order and indentation, expands the tree for display, hides empty folders after type filtering, and does not invent recency or write recent-use state.

UP11 - A nonblank workspace query searches only allowed Node, Logic Gate, and Project types through the editor-only company-scoped search. Matching pinned entities remain first. Workspace results with the same canonical type and ID as a matching pin appear only once.

UP12 - Workspace search waits 120 milliseconds after input, requests at most 30 results, and ignores any response that is no longer the newest query. Changing category, mode, or query resets keyboard selection to the first selectable result.

UP13 - Workspace search and blank Pinned reads use the current host's authenticated request function and company ID. They must preserve effective-access and visible-location filtering and must not reveal a cross-company, hidden, unsupported, folder-only, or inaccessible resource.

UP14 - Workspace rows carry the canonical resource type, literal canonical resource ID, and display label. Folders are headings and are never selectable relationship endpoints.

UP15 - Enter or plain Tab selects the highlighted result. Arrow Up and Arrow Down wrap among selectable results. Pointer hover changes the highlighted result and pointer click performs the same selection. Escape closes the picker without selecting.

UP16 - Every picker host renders one full-viewport transparent dismiss layer immediately behind the popup. A pointer press on that layer closes the picker without reference insertion, relationship mutation, email attachment, or mailbox action.

UP17 - The picker is portaled into the shared app overlay target. It stays above the dismiss layer and inside the active app-modal layer so a Node popup or other modal cannot hide the picker or steal its input focus.

UP18 - The ordinary resource picker prefers a 430-pixel width and a 470-pixel placement height. It stays at least 12 pixels from viewport edges, shrinks on narrow viewports, and opens above its anchor when the preferred height does not fit below.

UP19 - Selecting Emails completely replaces the Pinned/workspace result area with the mailbox folder controls and email rows. The email view prefers a 720-pixel width and a 650-pixel placement height, with a 360-to-445-pixel result scroller and 66-pixel rows so roughly six or seven emails are visible without paging the whole popup.

UP20 - The Emails category searches the currently connected personal email account. The account email is normalized to lowercase and is sent with the current company ID on every folder and message request. If no personal account is connected, the pane states that the user must connect one and does not search an unrelated or shared grant.

UP21 - The email folder controls reproduce the mailbox order Inbox, Starred, Sent, and All. Inbox and Starred show provider folder counts when valid nonnegative counts are available. Sent retains its sent-arrow cue. The fourth control is a menu that selects All email or Spam folder and displays Spam while Spam is active.

UP22 - Inbox maps to the primary mailbox, Starred to starred, Sent to sent, All email to all, and Spam folder to spam. Changing the mailbox closes the All menu, resets selection and results, and searches only the chosen mailbox.

UP23 - The same top search input searches email subject/provider results in the active mailbox. A nonblank email query waits 180 milliseconds; a blank mailbox load starts immediately. A category or mailbox/query change clears the old page before showing results from the new request, and a stale response cannot replace newer state.

UP24 - An email request asks for 12 messages per page. Scrolling within two row heights of the list bottom requests the provider's next page token. Appended pages retain provider order and deduplicate only by exact provider message ID. The provider's absence of another token ends pagination.

UP25 - An email result row shows unread state, sender, subject, snippet, and date/time when those values exist. A missing sender is labeled Unknown sender and a missing subject is labeled `(no subject)`. Display fallback text never replaces the stored provider identity.

UP26 - Arrow keys wrap through loaded email rows and keep the highlighted row in view. Enter, plain Tab, or pointer click chooses the highlighted email only when it has an account scope and the picker is not already completing another action.

UP27 - A chosen email entity uses the provider message ID as its exact entity ID and stores the subject label, normalized account email, active mailbox, provider thread ID when known, internal Mango `email_message_id` when known, and the selected provider message payload for the immediate host command. Those identities must not be translated through a generic resource registry.

UP28 - An email reference chip is a typed `email_message` atom with the canonical envelope icon. Its durable Tiptap/legacy attributes preserve the provider message ID plus known internal message ID, thread ID, account, shared-inbox scope, and mailbox so copy/paste, JSON persistence, static rendering, remount, and later activation retain the same email.

UP29 - Activating a persisted email reference dispatches the exact stored email identity to Home. Personal scope opens My Triage; shared-inbox scope opens the matching Shared Triage folder. Mango restores the stored mailbox when valid, selects the exact provider message from loaded state when available, or fetches that exact message with the stored company/account/shared scope. It must not invent a fake resource route.

UP30 - Backspace on or immediately after an inline email entity unwraps it to its stored subject label as ordinary text, exactly like the other entity types. This changes only document markup and never detaches, deletes, sends, moves, or otherwise mutates the email.

UP31 - In editor `##` mode, the host relationship command completes before the picker replaces the unchanged trigger with a durable target-reference chip. If the trigger/document changed after the command completed, Mango reports that the relationship succeeded without inserting into a different document and does not repeat or roll back the relationship implicitly.

UP32 - Node-to-Logic-Gate uses the existing priority-valid assign-or-move command with Requested destination status. Node-to-Project uses the existing atomic typed Node/Project command. Logic-Gate-to-Project creates or reuses the existing Gate/Project row. The picker does not duplicate their authorization, cardinality, idempotency, event, projection, or timeline rules.

UP33 - Linking an email to a Node or using a Node Attach email action uses the existing exact-message Node import/attachment command. Linking an email to a Project or using Project Attach email uses the existing Project exact-message attachment command. The commands receive the selected provider message and account/mailbox scope rather than a surrogate picker identity.

UP34 - From a selected email, choosing an existing Node reuses that Node through exact-message import. Choosing a Logic Gate creates the email Node only after valid priority selection and assigns it with the established Logic Gate command. Choosing a Project requires valid priority plus a Logic Gate choice and then uses the established typed Project/Logic Gate commands.

UP35 - Reference-mode selection never creates a relationship. In an editor it inserts the typed entity atom; in a selected-email host it opens the exact target. A reference chip remains independent from any existing relationship represented by the same two resources.

UP36 - Removing, unwrapping, undoing, replacing, or deleting a reference chip edits only the source document. It never removes or changes a Node assignment, Project relationship, Logic Gate relationship, or attached-email relationship.

UP37 - While a selection command is running, the search, category controls, folder controls, and result choices are busy and cannot submit a second command. A failed command leaves the picker open, shows its message, clears busy state, and returns focus to the search field for retry.

UP38 - Loading, empty, disconnected-account, search failure, and load-more states are visible inside the current pane. A folder-count failure may leave counts absent but must not prevent message search. A new mailbox/query request owns its own error and must not display an older request's result as current.

UP39 - The Emails pane is a find-and-select surface only. It may switch folders, search, scroll, page, highlight, reference, and attach existing messages. It must not expose Compose, Reply, Reply All, Send, scheduled send, draft-save, Archive mutation, star mutation, spam mutation, delete, or message-body editing.

UP40 - The obsolete node-specific email picker no longer exists. Node and Project email selection must use the Universal picker Emails category directly; no compatibility component, alternate modal, or fallback search path may be restored.

UP41 - The picker never writes a generic edge, central resource registry, translated/surrogate resource identity, or untyped polymorphic relationship. Every `##` action retains the source and destination's unchanged canonical types/IDs and delegates to the established typed command described by `docs/tests/relationships.md`.

UP42 - The Universal picker is a frontend orchestration and document-reference surface. Adding the Emails category does not itself require a database/schema change, a new backend relationship table, or a migration.

# Scenarios

## Scenario UP-S1: Open, filter, and dismiss the shared picker

Business logic covered:
- UP1 through UP18

Given:
- A user types `#` in a Node, Logic Gate, or Project editor.

Expected:
- The picker focuses search and starts in reference mode.
- Nodes, Logic Gates, Projects, and Emails appear in that order; N/L/A/E followed by Tab selects an enabled category.
- Blank workspace categories show the filtered Pinned tree; nonblank workspace queries show authorized matching pins first and deduplicated workspace results after them.
- Arrow keys, Enter, Tab, Escape, pointer selection, mode switching, and outside-click dismissal follow the same rules in every host.

## Scenario UP-S2: Search and choose an email

Business logic covered:
- UP19 through UP30
- UP37 through UP40

Given:
- A connected personal email account exists.
- The user opens Emails from an editor or a Node/Project Attach email action.

Expected:
- The popup expands and replaces the resource list with Inbox, Starred, Sent, and the All/Spam control plus roughly six or seven visible message rows.
- Search applies to the selected mailbox, stale searches cannot replace the newest query, and scrolling loads deduplicated provider pages.
- E then Tab enters Emails; arrows highlight messages; Enter, Tab, or pointer click chooses the exact provider message and scope.
- The pane contains no compose, send, draft, reply, or mailbox-mutation UI, and the retired node-specific picker is absent.

## Scenario UP-S3: Reference an exact email

Business logic covered:
- UP4
- UP8
- UP27 through UP30
- UP35 and UP36

Given:
- A user selects an email in `#` reference mode inside a unified editor.

Expected:
- Mango inserts a durable envelope entity atom containing the provider message ID and known mailbox scope.
- Activating the chip opens the exact My Triage or Shared Triage message without inventing a resource route.
- Unwrapping or deleting the chip changes only the document and never changes an email or relationship.

## Scenario UP-S4: Link through an established typed command

Business logic covered:
- UP4 through UP9
- UP31 through UP37
- UP41 and UP42

Given:
- A user enters `##` mode from a supported source and chooses an enabled destination.

Expected:
- Only the exact source/destination pairs in UP9 are selectable.
- Mango sends literal canonical identities through the existing permission-checked command, and an editor inserts a reference chip only after that command succeeds.
- Removing the chip never reverses the relationship.
- No generic edge, registry identity, backend compatibility path, schema change, or migration is introduced by the picker.
