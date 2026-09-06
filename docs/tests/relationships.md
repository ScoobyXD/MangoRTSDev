# Current Signup Company Membership Business Logic Laws

1. The first authenticated user context with no company membership creates one company and its exact `company_memberships` edge atomically with the existing company defaults.
2. Ordinary initial-company creation grants only `company_admin` in that company; only the existing restricted developer bootstrap may grant `dev_admin`.
3. Existing memberships prevent initial-company creation, and retries or concurrent requests create no duplicate company or membership.
4. Initial-company creation records the existing membership events and advances only that company's permission versions unless the restricted developer bootstrap grants global access.
5. Ordinary company-member removal rejects removal of a user's final company membership before changing the user, assignments, permissions, or events.
6. Explicit developer-authorized identity deletion retains the existing complete identity and membership cleanup behavior.

## Signup Company Membership Story

After verified sign-in, Mango resolves the existing user identity and company memberships. A user with none receives one company and a company-admin membership in the same transaction as its default setup. An accepted invitation already supplies its target membership. Later ordinary removals preserve at least one membership; explicit identity deletion follows the established complete cleanup path.

# Current AI Inspection Ownership Business Logic Laws

1. `public.ai_runs` records the exact authenticated company and user accepted by the existing Send authorization rules and uses that owner's existing request UUID as `ai_runs_id`.
2. One company, user, and request UUID has at most one immutable inspection archive; repeated saves never overwrite it.
3. Membership changes preserve historical archives and allow an already admitted Send to save its final inspection; existing global administrator access requires no new company membership.
4. Permanently deleting the exact company or user cascades its dependent archives and preserves unrelated owners' archives.
5. Captured resource identities and contents remain historical diagnostic data; they grant no permission, create no live resource relationship, and never become business truth.
6. Recycling, editing, or deleting a business resource does not rewrite the historical inspection snapshot or create an archive restore relationship.

## AI Inspection Ownership Story

A foreground Send captures the existing inspection events under its authenticated company and user. When the Send ends, one archive stores that same request UUID and ordered timestamped event array, even if membership changed while it ran. Later membership or business-resource changes leave the snapshot historical. Deleting its exact company or user removes the dependent archives; no captured resource is deleted or restored through the archive.

# Current Process Step Relationship Business Logic Laws

1. `process_steps.logic_gate_id` is the exact same-company owning Process identity, and every step has one immutable Process owner.
2. `node_logic_gate_assignments.process_step_id` is nullable and names one exact step in that assignment's existing same-company Process.
3. Node-to-Process membership and Node-to-step placement are separate facts; clearing a step never detaches or deletes a Node.
4. `resource_operational_relationships` stores every step-to-step flow edge using canonical `process_step` types and exact source step IDs.
5. Both step endpoints must belong to the same Process; mixed step/Folder/Process edges and self-edges are rejected.
6. Repeated creation of an exact directed step pair reuses one edge; branching uses several pairwise edges.
7. Add next step inserts the new step immediately to the right of its exact source and creates that incoming edge atomically.
8. Deleting a step clears its Node step assignments and deletes its exact incident edges while preserving Node statuses, Process assignments, and unrelated resources.
9. Step deletion does not infer replacement connections, delete Nodes, or modify permission ancestry.
10. Steps have no Company Explorer placement, company Process Map placement, company-map trace, resource registry, or translated identity.
11. Step commands check access through their exact owning Process and existing Node access rules; flow edges grant no access.
12. Process and Node recycle/restore preserve their promised exact step identities and assignments in dependency order; restoring a Node whose step was permanently deleted clears that step reference.
13. Node status lives only in `nodes.status`; status-list membership and the removed Kanban projection never become relationship authority.
14. `process_step_map_layouts` stores presentation for one exact same-company Process, with Step boxes keyed by `process_step_id` and routes keyed by existing `resource_operational_relationship_id`.
15. Layout never creates, replaces, or changes a Step owner, operational endpoint, Explorer parent, Node assignment, policy, or Board order.
16. Step and edge deletion prune their dependent layout entries in the same transaction; Process deletion cascades its layout, and recycle/restore preserves exact surviving references in dependency order.
17. Creating a Process in a chosen Folder checks current destination Edit access inside the same transaction that creates its one Explorer placement.
18. A Process AI text write, chat, or move requires the exact expected Process, Step, Node status, and assignment version inside the mutation transaction; a mismatch saves no text, chat, or placement change.
19. Save Process atomically creates its exact Process, chosen Explorer Folder placement, company-map placement, Steps, directed Step edges, layout, chosen RACI assignments, SOP document, and committed events through the existing workspace batch command.
20. Process creation accepts only one new Process in an existing editable Folder and only Step endpoints listed in that creation request.
21. Process creation allocates each Process, Step, and edge UUID once; an existing identity rejects the entire save without updating records or creating another Process.
22. New Process RACI uses only the existing typed policy settings and assignments.
23. Omitted new Process assignments or assignments equal to the current Folder policy keep live inheritance.
24. New Process assignments that differ from the current Folder policy customize that exact Process.
25. A new Process SOP uses the existing canonical `logic-gate-overview` editor document under that exact Process ID and the normal editor JSON validation rules.
26. No new Process, policy, editor document, placement, Step, or edge is stored before Save Process.
27. Leaving Process creation discards its unsaved contents.
28. A Step's canonical SOP body and editor revision live on its exact `process_steps` row; the editor uses `process_step` and that exact Step UUID without a second textbox or translated identity.
29. Step editor access follows the Step's existing immutable Process owner; editor content creates no new policy or permission ancestry.
30. Images and selection-created resources in a Step editor use the existing owning Process attachment and source rules, without a Step attachment or source relationship.
31. Recycling and restoring a Process preserves its exact Step bodies; permanently deleting a Step removes its live body without recreating it through the editor API.
32. Process history distinguishes overview and Step snapshots by their canonical type and exact identity; historical Step content grants no access, and restoring text never recreates a deleted Step or changes its owner.

## Process Step Relationship Story

A user starts creating a Process from the company map, chooses its Folder, arranges its Steps, sets RACI, and writes the overview and Step SOPs before Save Process. One transaction stores the exact Process, Steps with their bodies, connections, layout, placements, policy, and overview document. Untouched RACI follows the Folder live. Board, Editor, and Map edit those same records; Step editor access follows the existing Process owner. Leaving before Save stores nothing. AI Process text writes, chats, and moves recheck the tracked Node's exact work state inside their mutation transaction. Deleting a Step removes its body, incident edges, and geometry while Nodes retain their Process and status. Process recycle restores exact Steps, bodies, and edges before layout; restoring a historical text version changes only surviving text and never recreates a Step.

# Current Huddle Relationship Business Logic Laws

1. `huddle_logic_gate_relationships` is the only live authority for a Huddle Logic Gate's related normal Logic Gates.
2. Each live Huddle relationship stores the exact same-company `huddle_logic_gate_id` and `logic_gate_id`, with no relationship ID, resource registry, resource type column, or translated identity.
3. One Huddle Logic Gate may relate to many normal Logic Gates, and one normal Logic Gate may relate to many Huddle Logic Gates.
4. One exact Huddle Logic Gate and normal Logic Gate pair has one semantic edge, and repeated creation is idempotent.
5. A live Huddle Logic Gate relationship grants no permission, RACI role, policy parentage, or ownership over the normal Logic Gate or its KPIs.
6. `huddle_node_logic_gate_relationships` stores the exact Logic Gate identities captured from the owner Huddle Logic Gate when a Huddle Node is created.
7. `huddle_node_kpi_relationships` stores the exact KPI identities owned by those captured Logic Gates when the Huddle Node is created.
8. Huddle Node snapshot relationship sets are immutable after creation and are not rewritten when live Huddle Logic Gate links or KPI ownership sets later change.
9. Huddle Node snapshot reads join captured identities to current source rows and never store copied source labels, editor documents, previews, or generic resource payloads.
10. Recycling a Huddle Logic Gate, Huddle Node, normal Logic Gate, or KPI captures every affected Huddle relationship promised for restoration before foreign-key cleanup removes the live row.
11. Restoring a recycled endpoint restores its exact captured Huddle relationships in dependency-safe order; permanent deletion leaves no stale relationship or placeholder.
12. Removing one live Huddle Logic Gate relationship deletes only that edge and never deletes either endpoint, any KPI, or any existing Huddle Node snapshot.
13. The Huddle Logic Gate surface and the normal Logic Gate surface create, read, and remove the same `huddle_logic_gate_relationships` rows; neither surface owns a second relationship list.
14. The normal Logic Gate relationship tray may change an edge only when the actor can edit that normal Logic Gate and view the selected Huddle Logic Gate.
15. Reading relationships from a normal Logic Gate returns only related Huddle Logic Gates that the actor may currently view.
16. `entity_relationships` is the only live authority that connects an Entity to a supported exact resource; its supported resource types are exactly `huddle_node` and `huddle_logic_gate`.
17. Each row stores the exact same-company `entities.entity_id`, canonical `resource_type`, and exact source `resource_id`; `entity_id` already determines the Entity Type, so no `entity_type_id` is stored.
18. One exact Entity and typed Huddle resource pair has one semantic edge. Repeating the relationship or placing the same Entity reference several times in one Huddle resource creates no duplicate row.
19. Saving or deleting a Huddle editor document or Huddle Node chat atomically derives that exact resource's Action Item edges from all live editor and saved chat references. Removing the final reference removes only the edge and preserves the Entity.
20. A Huddle Board Action Item rollup unions the exact Huddle Logic Gate's direct edges with every edge from its owned Huddle Nodes, filters Entities whose Entity Type system key is `action_item`, and deduplicates each Entity once.
21. A surviving direct Huddle Logic Gate reference or sibling Huddle Node reference keeps the Action Item in that Board rollup. The same Action Item may have edges in several Huddle resources and several Huddle Boards.
22. A Huddle Node's **Created in this Huddle Node** section derives only from immutable Action Item Source equal to that exact Huddle Node; it does not derive from `entity_relationships` and includes completed items.
23. A Huddle Node's **Due or Overdue** section filters its owning Huddle Board's current live rollup to incomplete items whose Completion due date is on or before the temporary viewing date, excludes created-section IDs, and never copies an edge.
24. An Entity relationship grants no permission, RACI role, policy parentage, Entity access, or Huddle access. Reading or changing a Huddle Node's Action Item relationships requires Edit access to that Huddle Node, and reading a Huddle Board rollup directly requires Edit access to that exact Huddle Logic Gate.
25. Permanent endpoint deletion leaves no stale edge, and recycle/restore preserves every promised exact edge. The table uses no relationship ID, resource registry, copied label, copied body, translated identity, or compatibility identity.
26. Direct Huddle Logic Gate creation atomically stores the exact resource, its same-ID root Huddle Explorer placement, and its direct policies; typed Huddle Logic Gate attachment relationships use that same exact resource ID and follow its recycle, restore, and permanent-delete lifecycle.
27. The required Action Item `source` / `Source` / `resource` system Entity Field is the only authority for one Action Item's optional creation provenance and is separate from live inline-reference `entity_relationships`.
28. One nonnull Source field value contains exactly a canonical `node`, `logic_gate`, `project`, `huddle_node`, `huddle_logic_gate`, or `kpi` `resource_type` and the exact same-company `resource_id`, with no copied label, text anchor, registry, translated identity, or fallback.
29. Creating an editor or chat Action Item validates the exact live owning resource and the actor's current Edit access, then commits the Entity and all seven required fields, including Source, atomically. Direct Entities-page creation leaves the required Source field value null.
30. Source is immutable after creation and grants no access. Reads resolve the current endpoint name and disclose its typed identity only to a currently authorized viewer; every unavailable case returns a neutral state without hidden identity.
31. Inline chip insertion or removal changes only editor or chat content and any derived live Huddle Entity edge. It never creates, rewrites, or clears the Action Item Source field.
32. Recycling a source endpoint preserves its exact Source field value while reads project it as unavailable, and restoring that exact endpoint makes it resolvable again. Permanent endpoint deletion atomically clears matching Source field values so no stale typed reference remains; this lifecycle cleanup is the only allowed post-creation Source mutation.
33. My Work derives one optional Huddle Board only from immutable Source: an exact `huddle_logic_gate` Source identifies itself, while an exact `huddle_node` Source follows only its required `huddle_nodes.huddle_logic_gate_id`. The projection requires current access to both endpoints, returns one neutral unavailable/no-Board state otherwise, and never consults `entity_relationships`.
34. Deleting an Action Item uses existing company-authorized permanent Entity deletion, removes its exact fields and live Entity relationships, and preserves every Huddle resource.
35. Huddle restore skips a captured Entity relationship when that exact same-company Entity has since been permanently deleted.

Last updated: 2026-09-01

# Process Story: Huddle snapshots stay fixed while Action Item references roll up live

An editor links an existing normal Logic Gate to one Huddle Logic Gate through either surface's locked typed picker
↓
Mango stores one exact typed `huddle_logic_gate_relationships` edge and reads current KPIs through the normal Logic Gate's existing `kpis.logic_gate_id`
↓
Creating a Huddle Node atomically copies only those current Logic Gate and KPI identities into the two Huddle Node relationship tables
↓
Later membership changes do not rewrite that Huddle Node, while current source data is joined on each read and no generic edge or copied display payload is created
↓
Saving an inline Action Item reference in a Huddle editor or Huddle Node chat stores one exact typed `entity_relationships` edge in the same transaction; all live editor and saved chat references in that resource share the same edge
↓
Editing or deleting a chat, chat reply tree, or text box removes only references that no longer survive; the final removal deletes only that resource edge, while the Huddle Board rollup remains the current deduplicated union of direct Board edges and live child-Node edges

↓

When that Action Item was created from highlighted text, immutable Source keeps the exact creation resource through chip removal; the Node's created section uses that provenance, its due section filters the current Board rollup, and My Work follows an exact Huddle Node Source's required owner only when both endpoints remain accessible

Deleting an Action Item permanently removes its fields and live edges while its Huddle resources survive; restoring a previously recycled Huddle resource skips that deleted Entity's captured edges.

# Current Email Relationship Business Logic Laws

1. `email_relationships` is the typed authority that connects one exact internal email message to a Node or Project and optionally to one exact textbox owned by that resource.
2. One stored email thread may have wide relationships in multiple Nodes and Projects, and a textbox-specific edge is allowed only after that exact owner has a wide relationship for the same internal thread.
3. One exact email message may have at most one textbox-specific relationship in each Node or Project, while several exact messages may point to the same textbox.
4. The same exact email message may link to different text boxes in different owning resources.
5. The database enforces semantic-edge uniqueness and one-textbox-per-message-per-owner under concurrent writes.
6. A newly completed message inherits every distinct Node-wide and Project-wide destination already present for its thread.
7. New-message ingestion never creates or copies a textbox-specific relationship, chat, or draft.
8. An email-selection chat is valid only when the exact internal email message has an `email_relationships` row for that chat's exact Node or Project and textbox.
9. Opening an email-selection chat preview may stage a new local textbox presentation but creates no email relationship or chat.
10. Sending the first chat from an email-selection preview atomically links the chosen existing textbox or the staged new textbox, then creates the email-to-textbox relationship and chat, or creates neither relationship nor chat.
11. Cancelling an unsent email-selection chat preview requires no relationship deletion because no relationship has been written.
12. An exact-message personal Reply keeps its owner and mailbox identity. A resource-shared Reply instead stores the literal `shared_resource_type + shared_resource_id` pair and is identified by company, that exact Node or Project, and the internal source message; its creator is audit metadata, and both drafts may coexist. Reply defaults to the personal draft; checking **Shared Draft** creates or opens the shared draft, first creation seeds the current persisted personal body and attachment links, an existing shared draft is never overwritten, and unchecking switches back without deleting either. Neither draft creates an `email_relationships` edge, draft-to-text-box edge, sender grant, collaboration participant, generic registry entry, or permission row; successful send still applies normal wide Node/Project destination inheritance.
13. Removing a Node-wide or Project-wide email relationship is allowed only when that exact owner and thread have no textbox relationship or email-selection chat; otherwise the command returns `email_removal_has_node_work` or `email_removal_has_project_work` and changes nothing.
14. Removing one owner's textbox-specific email relationship removes only that exact edge and leaves its wide relationship, every other owner, stored thread/message, local textbox, and surviving attachment relationship unchanged; removal is rejected while that exact message anchors a chat in that textbox.
15. Email-to-Node, email-to-textbox, and chat rules do not create a generic resource registry, surrogate identity, or untyped edge.
16. An ordinary root chat or chat reply in an existing triage grouping uses only the normal Node text-box-chat insert and creates no email, relationship, permission, participant, or collaboration row.
17. A triage command that creates a new email grouping or stores a highlighted-email selection reuses the exact mailbox-scoped stored message when present, fetches only that exact provider message when absent, and never queues thread ingestion or links a thread to a text box.
18. When a highlighted-email chat's exact message has no text-box relationship in the chosen Node, selecting an existing chat grouping atomically links that message to the grouping's exact existing text box and creates the chat without creating another text box.
19. The Node email view uses the same atomic rule when the user chooses an existing text-box chat column; a failed relationship or chat write leaves both absent.
20. A personal mailbox draft is not owned by a Node or Project and survives removal or deletion of that resource. A resource-shared draft is owned by its one exact Node or Project, so an allowed wide email unlink or owner removal retires that draft and its `email_draft` attachment relationships; attachments with another live owner survive, and the existing textbox/chat dependency guard still controls whether unlink is allowed. Recycling captures those exact shared rows and links, and restoring the same Node or Project revives them after their typed owner and wide email relationships with a fresh revision; a direct unlink or permanent deletion has no restore.
21. A stored-thread reader uses the exact internal `email_thread_id`; an inline email reference stores that thread ID, its exact internal `email_message_id`, and only its personal-account or shared-inbox authorization scope. The reference opens independently of every Node, Project, Logic Gate, Huddle, or other resource relationship, and a missing durable row fails instead of falling back to provider, collaboration, relationship, mailbox-page, subject, or quoted-history lookup.
22. Completing a Mango-originated Sent message keeps its original exact `email_message` attachment links and retires only redundant imported links for that same internal message; an attachment with another live owner remains live.
23. A Node or Project textbox projection exposes its complete ordered `email_message_ids` only as a value derived from canonical `email_relationships`; a client never saves that list or a singular representative as textbox-owned relationship metadata, and it renders that backend order without scanning thread cards to infer or reorder membership.
24. Dragging the noninteractive header of one exact Node email message onto a textbox may create only that exact textbox relationship without creating a chat; a drag never starts from message body content, selected text, a button, a link, or an input.
25. The ordered email list inside a Node or Project textbox gives each exact message an explicit remove control that may remove only that textbox relationship; the command must atomically reject removal while that exact message anchors a chat in that textbox, and removing the last textbox relationship also returns that textbox to its neutral no-color state.
26. A textbox's stored color may decorate every exact message card linked to it, but never its parent thread container; the textbox email control lists every linked exact message oldest-to-newest by stored message timestamp.
27. Every email/textbox relationship and email-selection chat command uses Mango's exact internal `email_message_id`; provider message and thread IDs are display/provider context only and never relationship authority.
28. A Project's permanent document, whose `textbox_id` equals its `project_id`, is never an email/textbox relationship or chat destination.
29. A Node or Project textbox stores one approved non-red `color` while it has exact email relationships; all linked message cards share that color, and no relationship row or client hash owns another color.
30. Reading a Node- or Project-attached stored thread or exact message requires View access to that exact owner and its durable email relationship. Saved mailbox provenance grants no viewing authority or mailbox access: a missing, disconnected, or different personal account may restrict mailbox-only actions but never blocks or replaces the stored resource view.

Last updated: 2026-08-19

# Process Story: One email thread can appear in several Nodes and Projects while message work stays local

A stored email thread may have exact wide `email_relationships` in several Nodes and Projects
↓
Each newly completed message inherits every distinct Node-wide and Project-wide destination already used by that thread, but never inherits a textbox destination
↓
Opening an attached stored message requires View access to that exact Node or Project and its durable email relationship; saved mailbox provenance neither blocks that resource view nor grants mailbox or draft access
↓
Inside each Node or Project, one exact message may link to one exact local textbox; the same message may link to a different textbox in another owner
↓
My Triage and Shared Triage keep personal owner-only drafts; Node and Project Reply starts personal, while the **Shared Draft** checkbox selects the one resource-shared Reply stored under its literal typed owner pair without overwriting an existing shared draft
↓
Completing a Mango-originated Sent message keeps its original exact attachment links and removes only redundant imported links for that same internal message
↓
Opening a highlighted-email chat preview creates no relationship or resource
↓
Opening an inline email reference reads its exact durable message and thread under its saved mailbox scope without consulting a surrounding resource relationship or fallback lookup
↓
An ordinary root chat or reply appends directly to an existing grouping without creating an email relationship; a highlighted-email chat links its exact message to the chosen grouping when required, and a failed atomic command creates none of its relationship or chat writes
↓
A direct exact-message header drop may create the same typed textbox edge without a chat; the textbox projection then derives every linked message ID, and its email control renders those exact messages directly in backend stored-timestamp order without changing thread membership
↓
The explicit remove control beside a linked message removes only that textbox edge when no chat in the textbox is anchored to that message; otherwise the server rejects the removal atomically
↓
A highlighted-email or new-grouping send reuses the exact stored message or imports only the missing exact provider message; thread completion remains separate background ingestion
↓
An accidental Node or Project email relationship with no work in that exact owner may be removed, while a wide relationship with a textbox link or email-selection chat in its thread is preserved; every other owner's local work and stored email truth remain intact
↓
Every endpoint keeps its literal typed identity; no registry, surrogate identity, or generic untyped edge is introduced
↓
Node email viewing creates no draft or send-specific relationship; Reply opens the exact personal draft, checking **Shared Draft** creates or opens the exact shared Reply from persisted personal content only on first creation, and unchecking switches back without deletion, after which authorized send uses the existing persistence path and wide-destination inheritance

Last updated: 2026-08-19
# Process Story: Policy inheritance follows typed parents without moving permissions into Explorer

A permission or RACI resolver receives one exact resource type and ID
↓
It follows only that resource type's canonical immediate-parent relationship: Explorer folder placement for folders, Projects, and Logic Gates; Logic Gate assignment for Nodes; or the typed Shared Inbox hierarchy
↓
Company Explorer contributes only its folder and placement edges; permission and RACI settings and assignments remain in their four dedicated policy tables
↓
Inherited policies point through the live typed parent chain, while customized policies keep complete rows at the exact resource
↓
Automatic inherited/customized comparison changes only policy state and never creates a duplicate relationship, generic resource registry, or translated identity

Last updated: 2026-08-07

# Process Story: RACI labels keep exact identity without exposing internal IDs

A user opens a Node or Logic Gate through Editor, Updates, or another supported surface
↓
Mango keeps each direct RACI edge keyed by its unchanged typed user or group principal ID
↓
The shared RACI header resolves the visible name from assignment metadata and then the current company user/group directory
↓
The four equal-width role cards pair resolved names where two are available, while a single or final odd name spans its complete row; a temporarily unresolved principal uses a neutral unknown label instead of displaying its internal ID
↓
This presentation rule does not translate the principal ID, copy an assignment, or change RACI cardinality, inheritance, permissions, or relationship authority

Last updated: 2026-08-07

# Process Story: A Node header links through exact relationship commands

A user opens the Node header's double-hash picker and chooses a Logic Gate, Project, or Email
↓
Mango carries the unchanged Node type/ID and chosen target type/ID into the established typed command
↓
A Logic Gate choice creates the first assignment or moves the current assignment, a Project choice creates the one allowed Node `project_relationships` row and creates or reuses a Project/Logic-Gate relationship only when the Node currently has a Logic Gate, and an Email choice attaches the exact stored message
↓
The first exact Project relationship atomically snapshots one durable Node timeline stamp; an idempotent repeat creates no duplicate stamp
↓
The picker and clickable header chips remain presentation only and never become generic edges, surrogate identities, or permission authority

Last updated: 2026-08-07

# Process Story: A completed email message inherits exact Node-wide and Project-wide destinations

A qualifying Inbox arrival reconciles a stored email thread
↓
Mango identifies the exact newly completed `email_messages.email_message_id`
↓
Inside that message transaction, Mango reads the distinct current Node-wide and Project-wide `email_relationships` destinations for the same company/thread
↓
Only missing typed Node and Project relationships are inserted idempotently for the new message
↓
No endpoint is guessed, no access is granted, no textbox placement is copied, and an unplaced thread remains unplaced

Last updated: 2026-08-14

# Process Story: RACI groups remain typed live relationships

An editor assigns a person or group to Responsible, Accountable, Consulted, or Informed on a resource
↓
Mango stores the exact resource type and ID with the exact user or group principal type and ID
↓
One direct principal occupies one role on that resource, while every role permits multiple direct people and groups
↓
A group remains one source edge; current members and nested subgroups expand only when Mango resolves effective RACI
↓
Membership changes alter effective assignments without translated identities, generic edges, or copied per-user policy rows

Last updated: 2026-08-06

# Process Story: Node location derives from typed organization

A user searches for a Node in Company Explorer or Editor
↓
Mango reads the Node from `nodes` and follows the exact `node_logic_gate_assignments` and `project_relationships` rows without creating a placement copy
↓
A fully visible Logic Gate and its Company Explorer folder ancestry supply the path first; otherwise a fully visible Project path supplies it; otherwise a directly accessible Node has no path
↓
If any location resource or folder ancestor is hidden, Mango returns only the directly accessible Node and omits the whole location; deleting a Company Explorer folder still cannot delete a Node through a historical placement row
↓
`company_explorer_items` remains a typed placement table only for Projects and Logic Gates

Last updated: 2026-08-06

# Process Story: The universal picker references or links exact typed resources

A user opens the universal picker from a resource editor, the Node header's default `##` linker, the Project Logic Gates / Nodes launcher, or a selected My Triage/Shared Triage email
↓
Single-hashtag reference mode opens or inserts the chosen exact Node, Logic Gate, Project, Entity, or email message without creating a relationship; an Entity reference opens only its exact current Entity by canonical ID, while an email reference carries its exact internal message and thread identities plus one mailbox authorization scope and opens the stored thread independently of surrounding resource relationships and without fallback lookup
↓
Double-hashtag link mode keeps the source and chosen result's unchanged canonical types and IDs and permits only the documented pair
↓
An email-to-Node choice uses the established exact-message import command; an email-to-Logic-Gate or email-to-Project choice creates the email Node and then uses the existing typed Logic Gate/Project assignment commands; a Node-to-email or Project-to-email choice uses that owner's established exact-message attachment command
↓
Node-to-Logic-Gate uses the Logic Gate work-assignment command, while Node-to-Project, Logic-Gate-to-Project, and Project-to-Node use `project_relationships`; Project-to-Node also creates or reuses the selected Node's current Project/Logic-Gate relationship when that assignment exists
↓
Authorization, cardinality, idempotency, timeline stamps, projections, and events remain owned by those commands; the picker creates no generic edge or resource registry, and an editor chip remains only a reference

Last updated: 2026-08-27

# Process Story: Mango relates resources by their exact identities

A user relates or personally pins an existing Node, Logic Gate, Huddle Logic Gate, Huddle Node, Project, email, attachment, Account, or other supported Mango resource
↓
The command carries the resource's existing canonical ID unchanged from its source record
↓
For a move, Mango re-reads the existing canonical edge and authorizes its actual source instead of trusting a stale browser source hint
↓
Moving a Node between Logic Gates changes only that canonical assignment and its projections; email and attachment relationships stay attached to the exact Node and are neither required nor rewritten
↓
The relationship subsystem stores that literal ID in a direct typed column when the endpoint type is fixed, or together with its canonical `resource_type` when the endpoint type can vary
↓
The relationship remains in the table for its business meaning, such as Node structure, Logic Gate flow, Huddle ownership and placement, Project membership, personal pin organization, email attachment, file ownership, Account assignment, permission, or RACI assignment; only the documented Company Explorer, Logic Gate-to-Node, and Shared Triage parent links also define immediate V2 policy ancestry
↓
Reads, events, projections, recycle/restore, and permanent deletion use the same company, endpoint type, and literal resource ID; no resource registry, translated ID, or replacement identity is consulted
↓
Removing one relationship removes only that edge unless the owning subsystem has a separate, explicit deletion rule; deleting a resource removes its policies without treating cascading assignment removal as a surviving-resource detach
↓
Attachment owner retirement and permanent recycle purge wake the committing process's cleanup consumer; startup and finite daily recovery drain the same durable pending markers without idle polling, while live owners and recycle snapshots retain their files
↓
Deleting a personal pin folder removes only its descendant folder and pin records, never the pinned resources

Last updated: 2026-08-14

# Process Story: Process Map keeps operational truth separate from trace geometry

Company Explorer creates or moves one exact Folder row or Logic Gate placement edge
↓
Mango synchronizes exactly one Process Map placement under the same exact Folder or root, while `process_map_placements` owns only snapped geometry, dimensions, revision, and timestamps
↓
Moving within that Explorer parent changes only map geometry; moving a Folder translates its subtree and internal trace points, resizing it proportionally scales that subtree and those internal trace points, neither action changes an operational relationship, crossing a Folder boundary uses the canonical Explorer move, and removing a Process from the map removes only its Explorer edge
↓
Automatic placement creates, infers, changes, and deletes no operational edge; the manual company-map trace command creates or reuses an exact directed Folder/Process `resource_operational_relationships` edge and stores its route in `process_map_traces`
↓
Deleting a selected trace still removes its exact operational edge and dependent geometry without deleting either endpoint, while endpoint deletion and recycle continue to follow their exact typed lifecycle contracts

An explicitly invoked company-map operator reset validates a fresh layout from Explorer, checks Edit access across the affected resources, and commits that layout together with removal of the company's Folder/Process operational edges and dependent traces; it preserves source resources, Explorer organization, policies, and other relationship meanings.

Within a Process, each Node keeps its Process assignment and optionally names one exact step. Step moves preserve status. Add next step stores its new step immediately after the selected source and creates the exact incoming connection in the same mutation. Same-Process step connections use the operational relationship table without map geometry. Deleting a step clears only its Node step references and incident connections; Nodes keep their Process membership and status. The company-map reset preserves these step connections.

When AI works on its newly created Node, ordinary assignment and editor commands check that Node's expected Process, Step, status, and assignment version in the same transaction as the write. A concurrent human move stops the AI action without restoring the old placement or adding text after the move.

Last updated: 2026-09-03

# Relationship Business Logic Laws

These laws define how MangoRTS represents relationships. They apply to schema design, backend commands, APIs, events, caches, derived projections, deletion, recycle/restore, tests, and documentation.

## What `resource` means

A **resource** is an identifiable Mango business object that may own data or be one endpoint of a relationship. Resources include Nodes, Logic Gates, Huddle Logic Gates, Huddle Nodes, KPIs, Projects, Entities, email messages and threads, textboxes and chats where they have their own identity, attachments, Accounts, Entity folders, Company Explorer folders, Huddle Explorer folders, shared inboxes and folders, and any future business object explicitly added to a relationship contract.

A user or group is normally a **principal** when it receives a permission or RACI role. A relationship row and a derived projection row are records about resources; they are not automatically resources themselves.

## Iron laws

### Law 1 — Store the real resource ID

`resource_id` MUST be the exact canonical ID already used by the resource's source table or source system. A Node relationship stores the exact `nodes.node_id`; a Logic Gate relationship stores the exact `logic_gates.logic_gate_id`; a Project relationship stores the exact `projects.project_id`; an email relationship stores the exact internal Mango email identity required by that subsystem.

Mango MUST NOT generate a second relationship-only ID, translate through a key/value mapping, or require a central resource-registry lookup to discover the real ID.

### Law 2 — A generic resource reference is always typed

A cross-resource reference MUST contain both `resource_type` and `resource_id`. Neither value is complete without the other. Code MUST compare, cache, publish, restore, and delete the pair together with `company_id`.

A bare `resource_id` MUST NOT be treated as globally meaningful across different resource types, even when UUID collision is unlikely.

### Law 3 — Resource types are canonical business values

Every relationship subsystem MUST define and validate the exact resource types it supports. Callers MUST use the canonical stored value, such as `node`, `logic_gate`, `project`, or `email_message`; display labels and casual aliases are not stored resource types.

Adding a resource type requires updating that subsystem's validation, authorization, cleanup, indexes, events, projections, tests, and this document where the business rule changes.

### Law 4 — Relationship tables are separated by business meaning

Mango MUST NOT put every edge into one universal graph table. Different relationship meanings remain separate because they have different rules and fields.

Examples include:

- `node_relationships` for Node-to-Node parent, child, and peer structure.
- `resource_operational_relationships` for directed Folder/Process operational flow and same-Process step-to-step flow.
- `project_relationships` for a Project's Node and Logic Gate membership.
- `email_relationships` for normalized email messages attached to supported Mango owners.
- `attachment_relationships` for stored files owned or used by supported Mango resources.
- `huddle_logic_gate_relationships` for live Huddle Logic Gate-to-normal-Logic-Gate membership.
- `huddle_node_logic_gate_relationships` and `huddle_node_kpi_relationships` for one Huddle Node's creation-time relationship set.
- `entity_relationships` for one exact Entity linked to one exact Huddle Node or Huddle Logic Gate.
- `huddle_nodes.huddle_logic_gate_id` for one Huddle Node's fixed owning Huddle Logic Gate.
- `kpis.logic_gate_id` for one KPI's fixed owning normal Logic Gate.
- `entities.entity_type_id` and optional `entities.entity_folder_id` for one Entity's fixed type and current organizational folder.
- `entity_folders.parent_entity_folder_id` for the same-Entity-Type folder tree; this organization never creates a generic edge or permission ancestor.
- `huddle_explorer_items` for typed Huddle Logic Gate placement; Huddle Nodes use only their direct owning Huddle Logic Gate relationship.
- Account assignment, permission, and RACI relationship tables for their own distinct meanings.

### Law 5 — Do not split one meaning merely because endpoint types differ

When one relationship meaning has the same behavior and row data for several resource types, it MUST use one relationship table with `resource_type + resource_id`. Mango MUST NOT create a Node-specific, Project-specific, Logic-Gate-specific, and email-specific table solely to obtain separate foreign keys.

Separate tables are correct when the business meaning or required fields differ, not merely because the endpoint type differs. Existing storage that predates this law is not a precedent for adding more type-split tables; consolidating existing storage requires its own explicit migration task.

### Law 6 — Fixed endpoints may keep explicit columns

When a relationship table has a fixed endpoint by definition, that endpoint SHOULD use its direct typed column. `project_relationships.project_id`, for example, is the exact owning Project, while `resource_type + resource_id` identifies the supported related resource.

Same-type structural tables MAY use two explicit typed columns when both sides have one fixed type. `node_relationships.node_id_a/node_id_b` is valid because its relationship meaning and endpoint types are fixed. `huddle_nodes.huddle_logic_gate_id` and `kpis.logic_gate_id` are also valid direct owner columns because each relationship has one fixed owner type.

`huddle_logic_gate_relationships.huddle_logic_gate_id/logic_gate_id`, `huddle_node_logic_gate_relationships.huddle_node_id/logic_gate_id`, and `huddle_node_kpi_relationships.huddle_node_id/logic_gate_id/kpi_id` are valid literal typed columns because every endpoint type and relationship meaning is fixed. `entity_relationships.entity_id` is the exact fixed Entity endpoint, while `resource_type + resource_id` identifies the supported related resource without an Entity Type ID. Entity ownership and organization likewise use direct `entity_type_id`, `entity_folder_id`, `parent_entity_folder_id`, and `entity_field_type_id` columns because their types and meanings are fixed.

### Law 7 — Fully generic edges type both endpoints

If a future relationship meaning truly permits multiple resource types on both sides, it MUST use:

```text
source_resource_type + source_resource_id
target_resource_type + target_resource_id
```

Both IDs remain the literal IDs of their source records. Direction, symmetry, and allowed type combinations MUST be explicit business rules for that relationship meaning.

### Law 8 — Relationship-specific data stays with its relationship

Fields such as parent/child position, input/output position, display order, relationship kind, textbox origin, role, principal, or assignment status belong in the table whose business meaning requires them. They MUST NOT be moved into a central resource registry or an unrelated universal edge payload.

### Law 9 — Relationship IDs identify edges, not resources

A table MAY have a stable `relationship_id` for addressing, ordering, events, or idempotency. That edge ID does not replace either endpoint ID and MUST NOT be used as a resource-identity translation layer.

### Law 10 — Never invent or guess an endpoint

Every create command MUST carry the actual endpoint ID from the authoritative source selection, stored row, or provider-to-Mango normalization result. It MUST NOT fabricate a UUID, infer an endpoint from a title, or silently substitute a different resource when the requested endpoint is missing.

The write path MUST establish that the endpoint belongs to the same company, is an allowed type, exists for the operation, and is usable by the actor. This may be enforced with a normal foreign key, a validation query in the command transaction, or a database trigger; the enforcement method MUST NOT change the literal ID.

For a mutation of an existing relationship, including a cross-Logic-Gate Node move, the server MUST read the canonical current edge and authorize its actual endpoints. A caller-supplied previous/source endpoint may assist presentation or concurrency diagnostics, but it MUST NOT select relationship authority, replace the canonical edge, or make a valid relationship appear missing merely because the hint is stale. Moving the canonical Logic Gate assignment MUST NOT require, rewrite, or remove an independent email or attachment relationship; those relationships remain attached to their exact Node identity.

### Law 11 — Company scope is part of identity

Every company-owned relationship operation MUST include `company_id`. A resource in one company MUST NOT be related to a resource, Account, attachment, principal, or normalized email record in another company.

Foreign keys, validation queries, uniqueness rules, and cleanup queries MUST use company scope where the related tables are company-scoped.

### Law 12 — Cardinality belongs to the relationship meaning

Using `resource_type + resource_id` does not decide how many relationships are allowed. Each subsystem MUST state and enforce its own cardinality.

Current examples include:

- A Node may have multiple Account assignments.
- An Account may be assigned to multiple resources.
- A Node may have at most one active Logic Gate work assignment.
- A Node may be directly related to at most one Project.
- A Logic Gate may be related to multiple Projects.
- One Project/Logic-Gate pair has one stable semantic edge whether it is created directly from the Logic Gate editor or implicitly while adding an assigned Node.
- An attachment may have multiple active owner relationships.
- A Huddle Logic Gate may own multiple Huddle Nodes, while each Huddle Node has exactly one Huddle Logic Gate.
- A Huddle Logic Gate may link to multiple normal Logic Gates, a normal Logic Gate may link to multiple Huddle Logic Gates, and one exact pair has at most one live relationship.
- A Huddle Node may capture multiple Logic Gates and KPIs at creation, and each exact captured tuple has at most one snapshot relationship.
- An Action Item Entity may be referenced by many Huddle Nodes and appear in many Huddle Board rollups; each exact Entity and Huddle Node pair has at most one live edge.
- A normal Logic Gate may own multiple KPIs, while each KPI has exactly one normal Logic Gate.
- One Huddle Logic Gate has at most one live `huddle_explorer_items` placement, and a Huddle Node has none.
- One RACI resource/principal pair has exactly one direct role; Responsible, Accountable, Consulted, and Informed each permit multiple typed user or group principals, and group edges expand through live nested membership without copied per-user relationship rows.

### Law 13 — Duplicate commands do not create duplicate semantic edges

Each relationship table MUST define the columns that make one semantic relationship unique. Repeating the same create command MUST reuse the existing relationship or succeed idempotently without creating a duplicate edge.

Different relationship meanings, different owners, different resource types, or explicitly different relationship metadata MAY produce separate rows when their subsystem laws allow it.

### Law 14 — Relationship existence does not silently grant unrelated access

A relationship row MUST NOT automatically bypass the normal authorization rules for either endpoint. Reads and writes resolve access through the owning subsystem's explicit contract.

For email and attachment links, knowing an email ID, attachment ID, object key, or relationship ID is never sufficient by itself. Access is checked through the exact owning resource and relationship scope.


The only relationships that define V2 RACI and permission parentage are the exact hierarchy contracts in `docs/importanttasks/v2gvic&permissions.md`: Company Explorer folders parent contained folders, Projects, and Logic Gates; a Logic Gate parents its assigned Nodes; Shared Triage folders parent contained folders and shared inboxes. Project membership, Node-to-Node structure, email, attachment, Account, KPI ownership, Huddle Logic Gate membership, Huddle Node snapshots, Huddle Node ownership, Entity relationships, and Huddle Explorer placement do not become policy parents. Huddle Logic Gates and Huddle Nodes use direct typed policies in the first version.

Creating or moving one of those parent links advances separate RACI and permission parent-link sequences. The relationship does not copy policy rows or grant access by itself; an inherited child resolves its current parent policy, while a customized child remains independent. Removing the only Node-to-Logic-Gate parent materializes an inherited Node's current effective policies before detach so a root never remains inherited.

A relationship reader or writer MUST NOT translate resource identity, use an untyped generic edge, or consult a central registry to resolve policy ancestry. The canonical relationship rows and literal typed resource IDs are the hierarchy authority.
### Law 15 — Relationship creation is atomic with its command

When a business command creates a resource and its required relationships together, those writes MUST commit or roll back as one transaction. The system MUST NOT expose a successful resource creation while silently losing a required relationship, or expose a relationship whose newly created endpoint rolled back.

### Law 16 — Permanent deletion cleans literal typed references

Permanently deleting a resource MUST remove or retire every relationship owned by that resource and every generic reference to the exact tuple:

```text
company_id + resource_type + resource_id
```

Cleanup MUST include `resource_type`; deleting rows by UUID alone is forbidden. Cleanup and permanent deletion MUST run in the same transaction unless a subsystem, such as S3 attachment cleanup, documents a safer retryable boundary.

### Law 17 — Every deletion path follows the same cleanup law

Single deletion, batch deletion, company deletion, retention cleanup, and any background permanent-deletion worker MUST apply the same relationship cleanup rules. Adding a new deletion entry point without its relationship cleanup and regression tests is forbidden.

Attachment owner retirement and removal of recycle protection MUST wake cleanup after their successful commit in every producing process. Cleanup MUST preserve durable pending markers and keys through failures, drain known backlog without starving later attachments, and stop querying when settled. Startup and a finite daily recovery task MUST recover missed wakes; [attachment-deletion.md](attachment-deletion.md) defines this retryable storage boundary.

Normal foreign-key cascades MAY perform cleanup for fixed typed columns. Generic typed references MAY use explicit transactional deletes or validated database triggers. The result, not one particular mechanism, is mandatory.

When deleting a relationship endpoint causes an assignment or parent-link cascade, trigger logic MUST distinguish that endpoint deletion from detaching a surviving resource. Policy materialization or parent advancement runs for a surviving detached resource, but MUST NOT run against an endpoint that is already being deleted. The endpoint deletion still removes its exact RACI and permission settings in the same transaction.

### Law 18 — Recycling preserves restorable relationships

Moving a resource to the Recycle Bin MUST capture the relationships that the product promises to restore before deleting their live rows. Restore MUST recreate the exact original company, resource types, literal endpoint IDs, relationship meaning, and required relationship metadata in dependency-safe order.

Recycle behavior MUST NOT translate resource IDs, invent replacement endpoints, or restore a relationship across companies.

### Law 19 — Removing an edge does not delete its endpoints

Deleting a relationship normally deletes only that relationship. Removing a Node from a Project does not delete the Node or Project. Removing a Huddle Explorer item does not delete its Huddle Logic Gate. Removing an email relationship does not delete the normalized email message or thread. Removing one attachment relationship does not delete the file while another valid active owner relationship survives.

Any endpoint-deletion behavior must be an explicit separately documented business rule. Attachment last-owner cleanup is one such explicit rule.

### Law 20 — Source tables own truth; projections only derive it

The canonical relationship or assignment table is the write authority for its business meaning. A projection, cache, search document, Kanban view, Company Explorer view, or API shape MUST derive from source relationships and MUST NOT become a second relationship authority.

Deleting or rebuilding a projection MUST NOT delete or rewrite the source relationship.

### Law 21 — Events preserve typed literal identity

Durable relationship events MUST identify the exact company and relationship meaning plus every affected endpoint's canonical stored resource type and literal resource ID. Permission-safe invalidation hints MAY carry only their documented exact scope when consumers perform a canonical read instead of reconstructing a relationship from the hint. Consumers MUST NOT infer a type from UUID shape, screen location, or cached title.

### Law 22 — Generic relationship lookups are indexed by the typed identity

A generic relationship table MUST have an index beginning with the fields used for owner lookup and cleanup, normally:

```text
company_id, resource_type, resource_id
```

Additional reverse indexes MUST follow the subsystem's actual reads. An implementation MUST NOT justify a translated resource ID merely to obtain acceptable lookup performance.

### Law 23 — No resource registry or compatibility identity layer

MangoRTS MUST NOT introduce a central resource-ID registry, surrogate resource identity, compatibility mapping, dual-write identity, or fallback lookup to relate existing business resources. Relationships use the IDs the resources already have.

If a future product requirement genuinely needs a registry, changing this law requires an explicit architecture decision, migration plan, updated Process Story, updated numbered laws, and full relationship regression coverage. It MUST NOT arrive incidentally inside another feature.

### Law 24 — Storage changes are forward-only and complete

When relationship storage is consolidated or replaced, the forward migration MUST preserve every valid semantic edge and required field, then production code MUST use only the new authority. Mango MUST NOT retain compatibility readers, fallbacks, dual writes, or a second live relationship authority.

Shipped historical migrations remain historical records and are not rewritten.

### Law 25 — Tests prove relationship meaning, not just row insertion

Every new or changed relationship subsystem MUST test, as applicable:

- The stored `resource_id` exactly equals the source resource's real ID.
- The canonical `resource_type` is retained and a wrong or unsupported type is rejected.
- Cross-company relationships are rejected.
- Repeated creation does not duplicate the semantic edge.
- Reads and derived projections resolve the correct typed endpoint.
- Single and batch permanent deletion leave no matching typed relationship behind.
- Recycle/restore retains the exact promised relationships.
- Removing one edge does not delete unrelated endpoints or surviving shared ownership.
- Authorization is checked through the exact owner and does not leak across resources.

### Law 26 — Documentation changes with business behavior

Any change to relationship meaning, supported resource types, cardinality, identity, ownership, deletion, recycle/restore, authorization, or source-of-truth storage MUST update this file in the same change. The Process Story at the top must remain an accurate end-to-end description, and any more specific `docs/tests/*.md` contract must be updated as well.

### Law 27 — Personal pin folders contain pin edges, not resources

`pins.resource_type + pins.resource_id` stores the exact typed identity of the pinned Node, Logic Gate, Huddle Logic Gate, Huddle Node, or Project. `pin_folders` is a separate user-and-company-scoped organization tree, and `pins.parent_folder_id` points directly to a folder owned by that same user and company. Folder parent links must reject cycles and cross-owner IDs.

Deleting a pin, pin folder, or pin folder subtree deletes only personal organization rows. It MUST NOT delete, recycle, rename, move, permission-change, or otherwise mutate the underlying pinned resources. Grouping two pins into a new folder and changing mixed folder/pin layout are atomic personal-organization commands; they do not create another resource identity or access relationship.

### Law 28 — Company Explorer placement excludes Nodes

`company_explorer_items` may contain only Project and Logic Gate placement edges. No Node creation, email collaboration, chat, repair, deferred projection, or ordinary Explorer command may insert a Node placement or create a deterministic Unfiled/Nodes folder.

Node search location derives only from exact source relationships: a fully visible Logic Gate assignment and that Logic Gate's fully visible Company Explorer ancestry first, a fully visible Project relationship and that Project's ancestry second, otherwise an empty path for a directly accessible Node. A Node with only hidden organizational paths remains searchable through its own permission, but the entire hidden path is omitted so no ancestor identity or name leaks.

Removing historical Node placement rows or their now-empty deterministic folder MUST NOT delete a Node, Logic Gate assignment, Project relationship, email relationship, attachment relationship, chat ownership, RACI assignment, permission, or any other endpoint or typed edge.

### Law 29 — New email messages inherit exact Node-wide and Project-wide thread destinations

When a provider message becomes completely stored under an existing `email_thread_id`, Mango MUST atomically create only the missing `email_relationships` rows for distinct current destinations where the same company/thread has `resource_type in ('node','project')` and `resource_textbox_id is null`. Each relationship uses the exact stored `email_message_id`, exact owner ID, exact company, and canonical owner type.

This propagation is idempotent and MUST NOT invent an owner for an unplaced thread, copy Logic-Gate or textbox destinations, grant permissions or RACI, create a chat/draft, or treat a relationship as provider-thread membership authority. The message upsert and its missing wide relationships commit or roll back together.

### Law 30 — Policy parentage reuses canonical typed relationships

Policy settings and assignments MUST remain in `resource_gvic_settings`, `resource_gvic_assignments`, `resource_permission_settings`, and `resource_permissions`. Company Explorer and Huddle Explorer store no permission or RACI rows. Company Explorer contributes only the exact folder-parent and Project/Logic-Gate placement edges already owned by Explorer; Node policy parentage uses the exact Logic Gate assignment, and Shared Inbox policy parentage uses its own typed hierarchy. Huddle Explorer placement and Huddle Node ownership are not policy-parent edges in the first version.

Inherited resolution may follow those live typed parent edges, but it MUST NOT copy them into policy tables, invent a generic resource edge, or make Company Explorer a second policy authority. Comparing a saved raw policy with its immediate parent's raw policy may change the policy mode to inherited or customized; it MUST NOT change resource placement, assignment, ownership, or endpoint identity.

### Law 31 — Email threads may span Nodes and Projects, while textbox links remain exact and owner-local

One `email_thread_id` and its exact stored messages MAY have wide `email_relationships` in more than one Node or Project. A wide relationship has canonical `resource_type`, the exact owner ID, and a null `resource_textbox_id`; it exposes the thread in that exact resource but does not make that resource the stored email owner.

A textbox-specific relationship MUST name one exact `email_message_id`, one exact Node or Project, and one exact textbox in that resource. The same message may be linked to at most one textbox inside each owner, while several exact messages may link to one textbox. Repeating the same owner/message/textbox command converges, a different textbox in that owner is rejected, and a textbox in a different owner is allowed.

Removing a Node-wide or Project-wide email relationship is permitted only when that exact owner and thread have no textbox-specific relationship or email-selection chat. A blocked command MUST change nothing and return the owner-specific `email_removal_has_node_work` or `email_removal_has_project_work` error.

A resource-shared Reply is identified by company, literal `shared_resource_type + shared_resource_id`, and exact source message; creator is audit metadata, and no generic registry or `email_relationships` draft edge is created. Checking **Shared Draft** MUST create or open that exact row, seed the current persisted personal body and attachment links only on first creation, and never overwrite an existing shared draft; unchecking MUST switch back without deleting either draft. An allowed wide unlink or owner removal MUST retire only that exact shared draft and its links. Recycling MUST capture them, and restoring the same Node or Project MUST revive them after its owner and wide relationships with a fresh revision that rejects stale pre-delete saves. Every personal draft, another owner's shared draft, stored message, and attachment with another live owner MUST survive.

Removing one textbox-specific email relationship deletes only that exact edge and is rejected only while its exact message anchors a chat in that textbox. Deleting a Node or Project textbox atomically removes that textbox's owned chats and textbox-specific email relationships while preserving its owner-wide email relationships and drafts. It MUST NOT delete or rewrite another owner's relationship, the stored thread or message, another owner's textbox or chat, a personal draft, an email chat quote, or any surviving attachment relationship.

### Law 32 — Huddle ownership and placement use exact Huddle identities

`huddle_nodes.huddle_logic_gate_id` MUST equal the exact owning `huddle_logic_gates.huddle_logic_gate_id`. `huddle_explorer_items.resource_huddle_resource_id` MUST equal the exact source `huddle_logic_gates.huddle_logic_gate_id`, and the retained `huddle_type` column MUST equal `huddle_logic_gate`. Huddle Nodes MUST NOT receive Huddle Explorer items.

Directly creating a Huddle Logic Gate MUST atomically create its same-ID root Huddle Explorer item and direct policies. Converting a normal Logic Gate and creating its required Huddle Logic Gate Explorer item MUST also be atomic. Creating, updating, deleting, or restoring a Huddle Node MUST NOT create or restore an Explorer item. Deleting only an Explorer item removes only that Huddle Logic Gate placement. Recycling a Huddle Logic Gate MUST preserve its exact typed placement for restore. These relationships MUST NOT create a central registry, translated ID, untyped edge, access grant, or policy-parent link.

### Law 33 — Huddle membership and Huddle Node snapshots use fixed typed edges

`huddle_logic_gate_relationships` MUST store one exact same-company `huddle_logic_gate_id + logic_gate_id` pair for each live membership. One endpoint may participate in many pairs, repeated creation MUST be idempotent, and removing one pair MUST remove only that edge.

The Huddle Logic Gate page and normal Logic Gate editor MUST read and mutate that same row from opposite directions. A normal Logic Gate editor mutation requires Edit access to that Logic Gate and View access to the selected Huddle Logic Gate; its reverse read MUST omit Huddle Logic Gates the actor cannot view. This reverse UI and API MUST NOT create another table, copied list, policy parent, or relationship authority.

Creating a Huddle Node MUST atomically copy the owner Huddle Logic Gate's current normal Logic Gate identities into `huddle_node_logic_gate_relationships` and the current KPI identities for those Logic Gates into `huddle_node_kpi_relationships`. Those captured relationship sets MUST remain immutable after creation and MUST NOT be rewritten by later live membership or KPI-set changes.

Snapshot reads MUST resolve current data from `logic_gates` and `kpis` through those literal IDs. They MUST NOT store copied labels, editor documents, previews, generic resource types, relationship-only endpoint IDs, or a background synchronization stream. Recycling and restoring any endpoint MUST preserve every promised exact Huddle edge; permanent deletion MUST leave no stale edge.

### Law 34 — Process Map placement uses exact typed source identities

Company Explorer MUST be the sole structural authority for Process Map placement. Every exact same-company `company_explorer_folder` row and every exact `company_explorer_items` row with `target_type='logic_gate'` MUST have exactly one Process Map placement under the same direct Folder or root; Projects, Nodes, and every other type MUST have none. `process_map_placements` MUST store the exact typed source reference and Explorer-mirrored parent only to own snapped global integer geometry, positive dimensions, revision, and timestamps, and MUST NOT copy names, permissions, payloads, RACI assignments, score cards, spatial tile membership, or resource identity.

Explorer structural create, move, removal, deletion, recycle, and restore commands MUST synchronize this projection atomically; same-parent Explorer reordering MUST preserve existing Process Map geometry. A same-parent map move or resize MUST change only geometry; crossing a Folder boundary MUST use the canonical Explorer move. Removing a Process from Process Map MUST remove only its Explorer edge and matching placement, while Folder deletion MUST use the canonical Company Explorer target-deletion command. Runtime placement synchronization MUST preserve every operational relationship and MUST never create, infer, change, or delete operational flow. Moving or resizing a Folder MUST preserve each saved trace row and its exact operational relationship: movement translates route points only when both endpoints move with the Folder subtree, resizing proportionally transforms route points only when both endpoints are in that subtree, and route points for traces crossing the subtree boundary remain unchanged. Folder geometry changes and internal trace transformations retain their exact revision rules, while placement removal MAY perform the existing dependent trace-geometry cleanup. One append-only migration MUST non-destructively backfill missing supported placements from Explorer and synchronize their Explorer parent projection while preserving existing geometry, traces, and operational relationships.

### Law 35 — Resource operational relationships are exact directed pairwise edges

`resource_operational_relationships` MUST be the sole canonical authority for directed Folder-to-Folder, Folder-to-Process, Process-to-Folder, Process-to-Process, and same-Process step-to-step operational flow. Step edges MUST use canonical `process_step` endpoints whose literal IDs exist in `process_steps` under the same Process. A step MUST NOT connect directly to a Folder, Process, or step in another Process. Every row stores the exact same-company typed source and target IDs, rejects a self-edge, and has one semantic edge for one exact directed endpoint pair; repeating the same creation command returns or reuses that edge instead of inserting a duplicate. Every create transport MUST carry `source` and `target` as objects containing exactly `{resource_type, resource_id}` and MUST NOT carry a placement, label, geometry, permission, or alternate endpoint identity.

The source and target of an operational relationship are immutable. Changing either endpoint or reversing direction deletes the old edge and its trace before creating a new edge and trace. The Process-to-Process meaning formerly owned by `logic_gate_relationships` MUST move through one forward-only cutover before `resource_operational_relationships` becomes live authority, with no dual writer, compatibility reader, fallback, or second live Process-flow authority afterward. Removing one operational edge deletes neither endpoint, placement, permission, RACI assignment, nor organizational parent.

An explicitly invoked operator reset MAY delete all Folder/Process operational edges for one exact company, including unrouted edges and edges with unmapped endpoints, in the same transaction as replacing that company's map geometry. It MUST validate a current read-only preview and Edit access to every mapped resource and deleted edge endpoint, preserve every source resource, Explorer parent, permission, assignment, and other relationship meaning, and publish the existing typed deletion events. Process Step edges MUST be preserved by this company-map reset. Ordinary automatic placement, deployment, and restart MUST NOT invoke this operation.

### Law 36 — Process Map traces are dependent geometry, not relationship authority

`process_map_traces` MUST identify one exact `resource_operational_relationships` row and store only one ordered JSONB array of at most 256 snapped global company-world integer route points, revision, and timestamps. Every route point MUST contain exactly `x` and `y`; repeating an identical ordered array MUST not advance the trace revision or timestamps. Every Folder and Process has exactly one input anchor and one output anchor derived by presentation rules from its current saved bounds; the trace source always uses the source output and the trace target always uses the target input, so trace storage MUST NOT contain anchor columns, endpoint coordinates, endpoint identities, or endpoint payloads. Trace geometry MUST NOT invent a junction resource or become another operational relationship authority.

One Folder/Process operational relationship has at most one company-map trace, and a relationship may exist without a trace. A step-to-step operational relationship MUST have no company-map trace or placement; its connections belong only to its owning Process work view. Deleting a selected Process Map trace MUST delete its operational relationship and dependent geometry in one transaction while preserving both endpoint resources; Process Map exposes no user command that deletes only trace geometry. Fan-out and fan-in use several pairwise relationships whose routes may share points, traces MAY cross map parents and derived spatial tile boundaries, and hidden endpoints suppress every incident relationship and trace. Permanent deletion and recycle/restore MUST preserve or clean the exact dependent geometry through every required path.

### Law 37 — Entity relationships use exact Entity-to-resource edges

`entity_relationships` MUST store the exact same-company `entities.entity_id`, canonical `resource_type`, and exact source `resource_id`. The Entity's own row determines its Entity Type, so the relationship MUST NOT store `entity_type_id`. The supported resource types are exactly `huddle_node`, whose ID MUST equal `huddle_nodes.huddle_node_id`, and `huddle_logic_gate`, whose ID MUST equal `huddle_logic_gates.huddle_logic_gate_id`. One exact typed endpoint pair is one semantic edge, and repeating it MUST converge on that row.

Saving an Action Item reference in a Huddle Node or Huddle Logic Gate MUST derive that exact resource edge in the same transaction as the editor document or Huddle Node chat. Huddle Node derivation MUST union live editor references with canonical `entity_type='entity'` and exact `entity_id` references in saved `huddle_node_textbox_chats.entity_links`; deleted chats and chats in deleted text boxes MUST contribute no reference. Chat create, edit, delete, reply-tree removal, and text-box deletion MUST reconcile that same set while holding the existing Huddle owner lock. Several references to the same Entity in one resource MUST share one edge; removing one MUST retain it while another survives, and removing the final reference MUST remove only that edge. An Action Item MAY have edges in sibling Huddle Nodes, directly in Huddle Logic Gates, or in resources owned by different Huddle Boards.

The Huddle Board rollup MUST union its exact direct Huddle Logic Gate edges with Huddle Node edges joined through `huddle_nodes.huddle_logic_gate_id`, include only Entities whose Entity Type system key is `action_item`, and deduplicate each Entity once. A Huddle Node's created section MUST instead use immutable exact-Node Source provenance. Its due section MUST filter the current Board rollup to incomplete items with a Completion due date on or before the temporary viewing date and exclude created-section IDs. No rollup edge is copied into Huddle Node snapshot tables, editor JSON, or another projection.

Removing an edge MUST preserve both endpoints. Action Item deletion MUST reuse company-authorized permanent Entity deletion, remove its exact fields and live edges, and preserve every Huddle resource. Recycling and restoring a Huddle endpoint MUST preserve and recreate every promised exact edge whose Entity still exists; restore MUST skip an edge to a permanently deleted Entity. The relationship grants no Entity, Huddle, permission, RACI, or policy-parent access, and its storage MUST NOT add a relationship ID, resource registry, copied display data, translated identity, fallback, or second live authority.

### Law 38 — Action Item Source is one exact immutable creation endpoint

The required protected Action Item Entity Field Type and linked Entity Field with system key `source`, label `Source`, and kind `resource` MUST be the only Source authority. Its nullable `value_jsonb` MUST be either null or an object containing only canonical `resource_type` and exact UUID `resource_id`. Supported types are exactly `node`, `logic_gate`, `project`, `huddle_node`, `huddle_logic_gate`, and `kpi`. Source MUST NOT store a copied name, text selection, textbox ID, document ID, timeline identity, relationship ID, central registry identity, translated identity, or fallback.

Creating an Action Item from highlighted editor text MUST validate the exact live same-company endpoint and the actor's current Edit access and write Source in the same transaction as the Action Item and its other required fields. Direct Entities-page creation and existing Action Items MUST have the required linked Source field with a null value. User and ordinary Entity Field APIs MUST reject every post-creation Source update, and Source MUST remain unchanged when an inline chip or derived `entity_relationships` edge is added or removed.

Source MUST grant no access. A read MAY disclose the current endpoint type, ID, name, and canonical icon only after the viewer's current access is rechecked. An unset, missing, inaccessible, recycled, or permanently deleted source MUST return one neutral unavailable state without disclosing hidden identity. A live source rename MUST appear through current endpoint resolution and MUST NOT rewrite Source.

My Work MAY derive an Action Item's Huddle Board only when Source is exactly `huddle_logic_gate`, or when Source is exactly `huddle_node` and that current Huddle Node's required `huddle_logic_gate_id` identifies its owner. It MUST recheck current access to both endpoints before disclosing or sorting by the Board ID or current name. Missing or denied access yields one neutral no-Board value, and `entity_relationships` MUST NOT participate.

Recycling a source endpoint MUST preserve the exact Source value while making its projection unavailable. Restoring that exact endpoint MUST make the preserved value resolvable again. Permanent endpoint deletion MUST atomically clear every matching Source field value so no stale typed reference remains; that system lifecycle cleanup is the only permitted post-creation mutation.

### Law 39 — Entity person fields store exact company principals

A nonnull `person` Entity Field value MUST equal one exact current `company_memberships.user_id` in the Entity's company. A display name, email, label, index, or Huddle grouping key MUST NOT replace that user ID as assignment authority.

Removing one company membership MUST clear only `person` values containing that exact company and user identity. `entities.created_by_user_id` is nullable audit metadata tied to the same exact company membership and becomes null when that membership is deleted; neither cleanup may target another company's assignment or change any other Entity content.

### Law 40 — Personal Logic Gate lists have no manual shortcut relationship

Home's My Processes list MUST derive only from the acting user's current effective Logic Gate RACI. A manual user-to-Logic-Gate shortcut edge, shortcut API, compatibility identity, or `user_logic_gate_shortcuts` table MUST NOT exist.

## Required design examples

These examples show the required identity pattern; they do not replace each subsystem's detailed schema.

```text
Project membership:
  company_id   = C
  project_id   = exact projects.project_id
  resource_type = node
  resource_id   = exact nodes.node_id

Direct existing Logic Gate Project membership:
  company_id    = C
  project_id    = exact projects.project_id
  resource_type = logic_gate
  resource_id   = exact logic_gates.logic_gate_id

Email attachment to a Project:
  company_id        = C
  email_message_id  = exact internal email_messages.email_message_id
  resource_type     = project
  resource_id       = exact projects.project_id

Stored file used by a Node:
  company_id    = C
  attachment_id = exact attachments.attachment_id
  resource_type = node
  resource_id   = exact nodes.node_id

Account assignment:
  company_id    = C
  account_id    = exact accounts.account_id
  resource_type = logic_gate
  resource_id   = exact logic_gates.logic_gate_id

Action Item collected by a Huddle Board:
  company_id    = C
  entity_id     = exact action-item entities.entity_id
  resource_type = huddle_node
  resource_id   = exact huddle_nodes.huddle_node_id

Action Item person in charge:
  company_id    = C
  value_jsonb   = exact current company_memberships.user_id as a JSON string

Action Item Source:
  company_id    = C
  system_key    = source
  value_jsonb   = {"resource_type":"node","resource_id": exact nodes.node_id}
```

No example introduces a translated resource identity. The fixed endpoint and the typed literal endpoint are sufficient.
