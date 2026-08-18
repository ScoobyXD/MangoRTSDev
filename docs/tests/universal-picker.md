# Current Universal Picker Email Laws

1. Linking a selected email to an existing Node adds or reuses that exact Node-wide thread destination even when the thread is already in another Node.
2. Linking a selected email to a Logic Gate immediately creates its Node there with priority **Not Assigned**.
3. Linking a selected email to a Project requires only the Project Logic Gate choice and creates the Node with priority **Not Assigned**.
4. Reference mode opens the exact selected resource without changing the email.
5. A one-hash email reference saves as the existing typed email chip and opens the existing Triage conversation viewer; it creates no relationship, email route, or second viewer.

Last updated: 2026-08-12

# Process Story: Email linking chooses an exact destination without forcing priority

A user opens the Universal Picker from one selected email
↓
Reference mode opens the exact chosen resource without changing the email
↓
Linking to an existing Node uses that Node; linking to a Logic Gate creates the email Node there immediately; linking to a Project asks only for its Logic Gate
↓
Every newly created email Node starts with priority **Not Assigned** and uses the established typed placement command

Last updated: 2026-08-08

# Process Story: Universal search narrows first and authorizes only the finalists

A non-admin types a nonblank query in the Universal Picker
↓
All searches Nodes, Projects, Logic Gates, then Emails, while a selected tab searches only its matching source
↓
Mango ranks a bounded batch directly from those source tables before performing permission work
↓
The backend resolves the actor's group ancestry once, checks only the candidate resources and their exact typed parent paths, and continues with the next ranked batch only when denied rows leave open result slots
↓
Changing the query aborts stale workspace and email requests, and the search GET performs no folder repair, upsert, backfill, or version-triggering write
↓
GVIC remains separate and never participates in search authorization

Last updated: 2026-08-07

# Process Story: The universal picker references or links an exact typed resource

A user opens the shared universal picker from a Node, Logic Gate, or Project editor, the Node header linker, the Project Logic Gates / Nodes relationship launcher, the Project Attach email action, or a selected My Triage/Shared Triage message
↓
The picker opens above a transparent dismiss layer, focuses one search field, and shows Nodes, Projects, Logic Gates, and Emails as typed categories
↓
Single-hashtag reference mode inserts or opens the chosen exact resource without changing a business relationship
↓
Double-hashtag link mode enables only the destination types supported by the source and submits unchanged canonical identities through the established permission-checked command
↓
The Emails category replaces the workspace list with the connected personal mailbox's Inbox, Starred, Sent, All, or Spam results and enlarges the picker so six or seven message rows remain visible
↓
Mango paints authorized stored matches first, always reconciles Nylas second, merges exact messages without losing durable IDs, and groups threads through the same helper as My Triage and Shared Triage
↓
Choosing an email may use its provider message identity only to ingest it when needed; before an editor stores a reference, the picker replaces that transient identity with the exact durable Mango message/thread IDs and personal-account or shared-inbox authorization scope
↓
The picker creates no generic relationship, translated identity, compose surface, send path, draft path, or compatibility email picker

Last updated: 2026-08-17

# Universal Picker Business Logic Laws

UP1 - Mango has one shared Universal picker implementation. Node, Logic Gate, and Project Tiptap editors, the Node header linker, the selected-email placement toolbar, and Project Attach email must not implement separate picker search, keyboard, category, or mode behavior.

UP2 - Typing `#` with a collapsed caret in an active Node, Logic Gate, or Project Tiptap editor opens the picker at the trigger position and focuses the picker's single search input. The trigger remains owned by that exact document and selection until the picker selects, cancels, or becomes stale.

UP3 - The selected My Triage or Shared Triage email launcher opens the picker in `##` link mode. Project Attach email opens in `##` link mode with Emails selected. The Node header linker opens the same picker in `##` link mode with all legal Node targets, including Emails; the Node header has no separate Attach email button or picker. Ordinary editor hashtag entry starts in `#` reference mode.

UP4 - The picker has exactly two meanings. `#` is reference mode and may insert an inline entity chip or open a selected resource without changing any relationship. `##` is link mode and must complete the source host's documented business relationship before an editor inserts the same target as a reference chip.

UP5 - While the focused search is empty, typing `#` in reference mode changes to link mode only when the host supplied at least one legal link target. While the focused search is empty, Backspace in link mode changes to reference mode. The footer mode control performs the same transition. Every mode transition returns to All, clears the query, and clears workspace results.

UP6 - The ordinary category row is ordered Nodes, Projects, Logic Gates, Emails. A normal Logic Gate's Huddle relationship launcher adds one contextual Huddles category at the end. The matching single-letter shortcuts are N then Tab, A then Tab, L then Tab, E then Tab, and contextual H then Tab. A shortcut changes category and clears the shortcut text; it does not select a result.

UP7 - Clicking an active category selects that exact type and clears the query. Clicking the already active category returns to All. In link mode a category is enabled only if the source host supplied that type as a legal link destination; a disabled category cannot be selected by pointer or keyboard.

UP8 - Reference mode permits the four ordinary exact types: Node, Logic Gate, Project, and email message. A Huddle Logic Gate is available only when a relationship host explicitly supplies `huddle_logic_gate` as a legal link target. Link mode permits only the host's typed destination list and never expands that list because a result happens to be visible or pinned.

UP9 - The legal `##` matrix is exact: Node may link to a Logic Gate, Project, or email message; a Logic Gate editor may link to a Project; the normal Logic Gate Huddle tray may link to a Huddle Logic Gate; Project may link to a Node from its Logic Gates / Nodes launcher or to an email message from Attach email; and a selected email may link to a Node, Logic Gate, or Project. Email-to-email linking is not supported.

UP10 - A blank All, Nodes, Logic Gates, or Projects view reads the current user's complete company-scoped Pinned tree. A blank contextual Huddles view combines visible Huddle Logic Gate pins with the authorized company Huddle Logic Gate list. It preserves stored folder/pin sibling order and indentation, hides empty folders after type filtering, deduplicates exact Huddle identities, and does not invent recency or write recent-use state.

UP11 - A nonblank All query searches allowed Nodes, Projects, Logic Gates, and personal email in that order. A selected Nodes, Projects, Logic Gates, or Emails tab searches only that exact source and does not scan the other resource tables. Matching pinned entities remain first. Results with the same canonical type and ID as a matching pin appear only once.

UP12 - Workspace search waits 120 milliseconds after input and requests at most 30 authorized results. Changing category, mode, or query aborts the old network request, carries that cancellation through the HTTP request into the database query, and retains the response-sequence guard, so an already completed stale response still cannot replace current state. Keyboard selection resets to the first selectable result.

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

UP23 - The same top search input searches the active mailbox. A nonblank email query waits 180 milliseconds; a blank mailbox load starts immediately. Each current request reads Mango's authorized stored messages first and paints them immediately, then always reconciles the same exact account/mailbox/query with Nylas because a nonempty local result does not prove provider coverage is complete. A category or mailbox/query change clears the old page, and a stale local or provider response cannot replace newer state.

UP24 - Stored and provider email requests each ask for 12 messages on the initial page. Provider reconciliation adopts provider order and current metadata, preserves a known Mango `email_message_id`, appends stored-only matches, and deduplicates by exact provider message ID. If thread condensation leaves no scroll range while a provider next token exists, Mango appends one page at a time until the list becomes scrollable or the provider is exhausted; scrolling within two row heights continues pagination. Raw messages merge before thread condensation, and the provider's absence of another token ends pagination.

UP25 - Email results call the same mailbox-scoped thread-condensation helper as My Triage and Shared Triage. One row shows the representative message's unread state, sender, subject, snippet, date/time, and thread count when greater than one; unread/starred/count aggregation follows that shared helper. A missing sender is labeled Unknown sender and a missing subject is labeled `(no subject)`. Display fallback text never replaces stored identity.

UP26 - Arrow keys wrap through loaded email rows and keep the highlighted row in view. Enter, plain Tab, or pointer click chooses the highlighted email only when it has an account scope and the picker is not already completing another action.

UP27 - A chosen email may use its provider message ID only as transient input to the exact authorized ingestion command. Before a reference is inserted, the entity uses the returned durable Mango `email_message_id` as its typed identity and carries the exact durable `email_thread_id`, subject label, and one normalized personal-account or shared-inbox authorization scope; the provider payload remains transient only for the immediate typed host command.

UP28 - An email reference chip is a typed `email_message` atom with the canonical envelope icon. Its durable Tiptap/legacy attributes preserve only the exact Mango `email_message_id`, exact Mango `email_thread_id`, subject label, and one personal-account or shared-inbox authorization scope so copy/paste, JSON persistence, static rendering, remount, and later activation retain the same stored email without provider IDs or mailbox-page identity.

UP29 - One ordinary activation from any supported editor dispatches the exact durable email identity to the shared existing Triage preview host. The host reads only the exact stored thread under its personal-account or shared-inbox authorization scope, selects the referenced row only by durable `email_message_id`, and shows every stored row once in persisted message order. It never checks a surrounding resource relationship or falls back to provider, collaboration, mailbox-page, subject, or quoted-history lookup, and it never invents a route or second viewer.

UP30 - Backspace on or immediately after an inline email entity unwraps it to its stored subject label as ordinary text, exactly like the other entity types. This changes only document markup and never detaches, deletes, sends, moves, or otherwise mutates the email.

UP31 - In editor `##` mode, the host relationship command completes before the picker replaces the unchanged trigger with a durable target-reference chip. If the trigger/document changed after the command completed, Mango reports that the relationship succeeded without inserting into a different document and does not repeat or roll back the relationship implicitly.

UP32 - Node-to-Logic-Gate uses the existing priority-valid assign-or-move command with Requested destination status. Node-to-Project uses the existing atomic typed Node/Project command. Logic-Gate-to-Project creates or reuses the existing Gate/Project row. A normal Logic Gate-to-Huddle-Logic-Gate choice creates or reuses the existing typed `huddle_logic_gate_relationships` row. The picker does not duplicate their authorization, cardinality, idempotency, event, projection, or timeline rules.

UP33 - Linking an email to a Node through the Node header linker uses the existing exact-message Node import/attachment command. Linking an email to a Project or using Project Attach email uses the existing Project exact-message attachment command. Before either typed command, the picker ensures the exact provider message is durably ingested when necessary and supplies its real Mango `email_message_id` plus account/mailbox scope rather than a surrogate picker identity.

UP34 - From a selected email, choosing an existing Node adds or reuses that exact Node-wide thread destination even when the thread already has another Node destination. Choosing a Logic Gate immediately creates the email Node there with priority **Not Assigned**. Choosing a Project requires only a Logic Gate choice and then uses the established typed Project/Logic Gate commands.

UP35 - Reference-mode selection never creates a relationship. In an editor it inserts the typed entity atom; in a selected-email host it opens the exact target. A reference chip remains independent from any existing relationship represented by the same two resources.

UP36 - Removing, unwrapping, undoing, replacing, or deleting a reference chip edits only the source document. It never removes or changes a Node assignment, Project relationship, Logic Gate relationship, or attached-email relationship.

UP37 - While a selection command is running, the search, category controls, folder controls, and result choices are busy and cannot submit a second command. A failed command leaves the picker open, shows its message, clears busy state, and returns focus to the search field for retry.

UP38 - Loading, empty, disconnected-account, search failure, and load-more states are visible inside the current pane. A folder-count failure may leave counts absent but must not prevent message search. A new mailbox/query request owns its own error and must not display an older request's result as current.

UP39 - The Emails pane is a find-and-select surface only. It may switch folders, search, scroll, page, highlight, reference, and attach existing messages. It must not expose Compose, Reply, Reply All, Send, scheduled send, draft-save, Archive mutation, star mutation, spam mutation, delete, or message-body editing.

UP40 - The obsolete node-specific email picker and dedicated Node header Attach email shortcut no longer exist. Node email selection uses the header Universal picker, and Project email selection uses the Universal picker Emails category directly; no compatibility component, alternate modal, shortcut picker, or fallback search path may be restored.

UP41 - The picker never writes a generic edge, central resource registry, translated/surrogate resource identity, or untyped polymorphic relationship. Every `##` action retains the source and destination's unchanged canonical types/IDs and delegates to the established typed command described by `docs/tests/relationships.md`.

UP42 - Universal-picker email reliability adds an authorized stored-message read and idempotent exact-message ingestion command but no database/schema change, new relationship table, generic registry, compatibility identity, or migration.

UP43 - Editor-entity search ranks a bounded candidate batch directly from `nodes`, `projects`, and `logic_gates` before authorization. It never builds a company-wide visible Company Explorer tree and never runs point permission resolution across every company resource before applying the result limit.

UP44 - For a non-admin search batch, direct-user rules, live nested-group rules, and the effective default are evaluated in permission precedence order. The actor's group ancestry is resolved once per batch. GVIC assignments are not read and never grant search visibility.

UP45 - Company Explorer is consulted only for the exact candidate's canonical location rule: a Project or Logic Gate uses its exact placement and folder ancestors; a Node uses exact Logic Gate assignment or Project relationship locations, or no location when it is standalone. Every required location resource and folder ancestor must be accessible, so hidden organization is not leaked.

UP46 - Permission filtering continues through later ranked candidate batches only when inaccessible rows leave result slots open. The response stops once its requested authorized limit is full or matching source rows are exhausted.

UP47 - Every search GET is read-only. It must not open a repair transaction, upsert the three default Company Explorer folders, backfill placement, advance policy or folder versions, or fire write triggers. Creation and migration workflows own required default-state repair.

UP48 - The search architecture in UP43 through UP47 is the rule for Mango free-text resource searches: narrow by company, selected type, text, and bounded rank first; authorize that narrowed set last. A listing endpoint that intentionally returns a complete tree is not a free-text search and retains its separately documented tree-visibility behavior.
UP49 - The Project Logic Gates / Nodes toolbar renders the exact shared My Triage launcher pair. Its `Ready! Open universal linker` control opens the shared Universal picker locked to `##` link mode with Nodes as its only enabled target, and its compact document-plus control creates and links one floating Node without requiring a Logic Gate.

# Scenarios

## Scenario UP-S1: Open, filter, and dismiss the shared picker

Business logic covered:
- UP1 through UP18

Given:
- A user types `#` in a Node, Logic Gate, or Project editor.

Expected:
- The picker focuses search and starts in reference mode.
- Nodes, Projects, Logic Gates, and Emails appear in that order; N/A/L/E followed by Tab selects an enabled category.
- Blank workspace categories show the filtered Pinned tree; nonblank workspace queries show authorized matching pins first and deduplicated workspace results after them.
- Arrow keys, Enter, Tab, Escape, pointer selection, mode switching, and outside-click dismissal follow the same rules in every host.

## Scenario UP-S2: Search and choose an email

Business logic covered:
- UP19 through UP30
- UP37 through UP40

Given:
- A connected personal email account exists.
- The user opens Emails from an editor, the Node header linker, or Project Attach email.

Expected:
- The popup expands and replaces the resource list with Inbox, Starred, Sent, and the All/Spam control plus roughly six or seven visible message rows.
- Stored search results paint first; provider reconciliation always follows, preserves durable Mango IDs, and failure leaves stored rows usable with a sync warning.
- Results and appended pages group threads through the exact helper used by My Triage and Shared Triage; a condensed short page automatically appends one page at a time until the list can scroll or has no next token.
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
- Mango inserts a durable envelope entity atom containing the exact Mango message/thread IDs and one authorized account/shared-inbox scope.
- Activating the chip opens the exact stored My Triage or Shared Triage thread independently of resource relationships and without inventing a resource route or fallback lookup.
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
- A provider-only email is durably ingested first, so Node/Project attachment never receives a missing or provider-substituted `email_message_id`.
- Removing the chip never reverses the relationship.
- No generic edge, registry identity, backend compatibility path, schema change, or migration is introduced by the picker.
