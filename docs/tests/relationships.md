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

Last updated: 2026-08-11

# Process Story: Live Huddle membership becomes an immutable Huddle Node relationship snapshot

An editor links an existing normal Logic Gate to one Huddle Logic Gate through either surface's locked typed picker
↓
Mango stores one exact typed `huddle_logic_gate_relationships` edge and reads current KPIs through the normal Logic Gate's existing `kpis.logic_gate_id`
↓
Creating a Huddle Node atomically copies only those current Logic Gate and KPI identities into the two Huddle Node relationship tables
↓
Later membership changes do not rewrite that Huddle Node, while current source data is joined on each read and no generic edge or copied display payload is created

# Current Email Relationship Business Logic Laws

1. `email_relationships` is the typed authority that connects one exact internal email message to a Node or Project and optionally to one exact textbox owned by that resource.
2. One stored email thread may have wide relationships in multiple Nodes and Projects, and each Node or Project may have multiple stored email threads.
3. One exact email message may have at most one textbox-specific relationship in each Node or Project.
4. The same exact email message may link to different text boxes in different owning resources.
5. The database enforces semantic-edge uniqueness and one-textbox-per-message-per-owner under concurrent writes.
6. A newly completed message inherits every distinct Node-wide and Project-wide destination already present for its thread.
7. New-message ingestion never creates or copies a textbox-specific relationship, chat, or shared-draft display state.
8. An email-selection chat is valid only when the exact internal email message has an `email_relationships` row for that chat's exact Node or Project and textbox.
9. Opening an email-selection chat preview may stage a new local textbox presentation but creates no email relationship or chat.
10. Sending the first chat from an email-selection preview atomically links the chosen existing textbox or the staged new textbox, then creates the email-to-textbox relationship and chat, or creates neither relationship nor chat.
11. Cancelling an unsent email-selection chat preview requires no relationship deletion because no relationship has been written.
12. A Node-shared email draft belongs directly to one exact Node, one exact email thread, and one exact source message. The reply UI reuses that message's existing Node-local text box or creates the one permitted typed email-to-text-box relationship first; the draft does not own a second text-box identity.
13. The shared draft stores the exact Node, thread, and source-message identities directly and never creates a generic draft edge, resource registry, surrogate identity, participant table, copied permission grant, or separate draft-to-text-box relationship.
14. Removing one Node's email relationship removes only that Node's typed email edge and leaves every other Node, stored thread/message, local shared draft, local text box, chat, and surviving attachment relationship unchanged.
15. Email-to-Node, email-to-textbox, chat, and draft rules do not create a generic resource registry, surrogate identity, or untyped edge.
16. An ordinary root chat or reply in an existing triage grouping uses only the normal Node text-box-chat insert and creates no email, relationship, permission, participant, or collaboration row.
17. A triage command that creates a new email grouping or stores a highlighted-email selection reuses the exact mailbox-scoped stored message when present, fetches only that exact provider message when absent, and never queues thread ingestion or links a thread to a text box.
18. When a highlighted-email chat's exact message has no text-box relationship in the chosen Node, selecting an existing chat grouping atomically links that message to the grouping's exact existing text box and creates the chat without creating another text box.
19. The Node email view uses the same atomic rule when the user chooses an existing text-box chat column; a failed relationship or chat write leaves both absent.
20. The email-draft scope cutover deletes only obsolete draft rows that cannot name their required exact owner or exact Node and source message, and retires only their typed `email_draft` attachment relationships before deletion; it never invents an endpoint or changes a valid email relationship.
21. A stored-thread reader or inline email reference carries the exact internal `email_thread_id`; a provider message ID or provider thread ID never selects a durable Mango thread, and a missing durable ID fails instead of falling back to a provider or collaboration lookup.

Last updated: 2026-08-14

# Process Story: One email thread can appear in several Nodes and Projects while message work stays local

A stored email thread may have exact wide `email_relationships` in several Nodes and Projects
↓
Each newly completed message inherits every distinct Node-wide and Project-wide destination already used by that thread, but never inherits a textbox destination
↓
Inside each Node or Project, one exact message may link to one exact local textbox; the same message may link to a different textbox in another owner
↓
Reply or Reply all remains in that exact resource context, while any Node-shared draft remains keyed directly by the exact Node, thread, and source message
↓
Opening a highlighted-email chat preview creates no relationship or resource
↓
An ordinary root chat or reply appends directly to an existing grouping without creating an email relationship; a highlighted-email chat links its exact message to the chosen grouping when required, and a failed atomic command creates none of its relationship or chat writes
↓
A highlighted-email or new-grouping send reuses the exact stored message or imports only the missing exact provider message; thread completion remains separate background ingestion
↓
Removing one owner's relationship leaves all other local work and the stored email truth intact
↓
Every endpoint keeps its literal typed identity; no registry, surrogate identity, or generic untyped edge is introduced
↓
The forward draft cutover removes only legacy drafts without the exact identities required by this model and retires only their typed draft attachment links

Last updated: 2026-08-14
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

A user opens the universal picker from a resource editor, the Node header's default `##` linker, or a selected My Triage/Shared Triage email
↓
Single-hashtag reference mode opens or inserts the chosen exact Node, Logic Gate, Project, or email message without creating a relationship; an email reference carries its exact internal message and thread identities
↓
Double-hashtag link mode keeps the source and chosen result's unchanged canonical types and IDs and permits only the documented pair
↓
An email-to-Node choice uses the established exact-message import command; an email-to-Logic-Gate or email-to-Project choice creates the email Node and then uses the existing typed Logic Gate/Project assignment commands; a Node-to-email or Project-to-email choice uses that owner's established exact-message attachment command
↓
Node-to-Logic-Gate uses the Logic Gate work-assignment command, while Node-to-Project and Logic-Gate-to-Project use `project_relationships`
↓
Authorization, cardinality, idempotency, timeline stamps, projections, and events remain owned by those commands; the picker creates no generic edge or resource registry, and an editor chip remains only a reference

Last updated: 2026-08-06

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
Deleting a personal pin folder removes only its descendant folder and pin records, never the pinned resources

Last updated: 2026-08-14

# Relationship Business Logic Laws

These laws define how MangoRTS represents relationships. They apply to schema design, backend commands, APIs, events, caches, derived projections, deletion, recycle/restore, tests, and documentation.

## What `resource` means

A **resource** is an identifiable Mango business object that may own data or be one endpoint of a relationship. Resources include Nodes, Logic Gates, Huddle Logic Gates, Huddle Nodes, KPIs, Projects, email messages and threads, textboxes and chats where they have their own identity, attachments, Accounts, Company Explorer folders, Huddle Explorer folders, shared inboxes and folders, and any future business object explicitly added to a relationship contract.

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
- `logic_gate_relationships` for Logic-Gate input and output flow.
- `project_relationships` for a Project's Node and Logic Gate membership.
- `email_relationships` for normalized email messages attached to supported Mango owners.
- `attachment_relationships` for stored files owned or used by supported Mango resources.
- `huddle_logic_gate_relationships` for live Huddle Logic Gate-to-normal-Logic-Gate membership.
- `huddle_node_logic_gate_relationships` and `huddle_node_kpi_relationships` for one Huddle Node's creation-time relationship set.
- `huddle_nodes.huddle_logic_gate_id` for one Huddle Node's fixed owning Huddle Logic Gate.
- `kpis.logic_gate_id` for one KPI's fixed owning normal Logic Gate.
- `huddle_explorer_items` for typed Huddle Logic Gate placement; Huddle Nodes use only their direct owning Huddle Logic Gate relationship.
- Account assignment, permission, and RACI relationship tables for their own distinct meanings.

### Law 5 — Do not split one meaning merely because endpoint types differ

When one relationship meaning has the same behavior and row data for several resource types, it MUST use one relationship table with `resource_type + resource_id`. Mango MUST NOT create a Node-specific, Project-specific, Logic-Gate-specific, and email-specific table solely to obtain separate foreign keys.

Separate tables are correct when the business meaning or required fields differ, not merely because the endpoint type differs. Existing storage that predates this law is not a precedent for adding more type-split tables; consolidating existing storage requires its own explicit migration task.

### Law 6 — Fixed endpoints may keep explicit columns

When a relationship table has a fixed endpoint by definition, that endpoint SHOULD use its direct typed column. `project_relationships.project_id`, for example, is the exact owning Project, while `resource_type + resource_id` identifies the supported related resource.

Same-type structural tables MAY use two explicit typed columns when both sides have one fixed type. `node_relationships.node_id_a/node_id_b` and `logic_gate_relationships.logic_gate_id_a/logic_gate_id_b` are valid because their relationship meanings and endpoint types are fixed. `huddle_nodes.huddle_logic_gate_id` and `kpis.logic_gate_id` are also valid direct owner columns because each relationship has one fixed owner type.

`huddle_logic_gate_relationships.huddle_logic_gate_id/logic_gate_id`, `huddle_node_logic_gate_relationships.huddle_node_id/logic_gate_id`, and `huddle_node_kpi_relationships.huddle_node_id/logic_gate_id/kpi_id` are valid literal typed columns because every endpoint type and relationship meaning is fixed.

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
- A normal Logic Gate may own multiple KPIs, while each KPI has exactly one normal Logic Gate.
- One Huddle Logic Gate has at most one live `huddle_explorer_items` placement, and a Huddle Node has none.
- One RACI resource/principal pair has exactly one direct role; Responsible, Accountable, Consulted, and Informed each permit multiple typed user or group principals, and group edges expand through live nested membership without copied per-user relationship rows.

### Law 13 — Duplicate commands do not create duplicate semantic edges

Each relationship table MUST define the columns that make one semantic relationship unique. Repeating the same create command MUST reuse the existing relationship or succeed idempotently without creating a duplicate edge.

Different relationship meanings, different owners, different resource types, or explicitly different relationship metadata MAY produce separate rows when their subsystem laws allow it.

### Law 14 — Relationship existence does not silently grant unrelated access

A relationship row MUST NOT automatically bypass the normal authorization rules for either endpoint. Reads and writes resolve access through the owning subsystem's explicit contract.

For email and attachment links, knowing an email ID, attachment ID, object key, or relationship ID is never sufficient by itself. Access is checked through the exact owning resource and relationship scope.


The only relationships that define V2 RACI and permission parentage are the exact hierarchy contracts in `docs/importanttasks/v2gvic&permissions.md`: Company Explorer folders parent contained folders, Projects, and Logic Gates; a Logic Gate parents its assigned Nodes; Shared Triage folders parent contained folders and shared inboxes. Project membership, Node-to-Node structure, email, attachment, Account, KPI ownership, Huddle Logic Gate membership, Huddle Node snapshots, Huddle Node ownership, and Huddle Explorer placement do not become policy parents. Huddle Logic Gates and Huddle Nodes use direct typed policies in the first version.

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

Relationship events and invalidation messages MUST carry enough information to identify the exact company, relationship meaning, resource type, and literal resource ID affected. Consumers MUST NOT infer a type from UUID shape, screen location, or cached title.

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

One `email_thread_id` and its exact stored messages MAY have wide `email_relationships` in more than one Node or Project. A wide relationship has canonical `resource_type`, the exact owner ID, and a null `resource_textbox_id`; it exposes the thread in that exact resource but does not make that resource the email owner.

A textbox-specific relationship MUST name one exact `email_message_id`, one exact Node or Project, and one exact textbox in that resource. The same message may be linked to at most one textbox inside each owner. Repeating the same owner/message/textbox command converges, a different textbox in that owner is rejected, and a textbox in a different owner is allowed.

Removing one Node-wide or textbox-specific email relationship deletes only that exact relationship. It MUST NOT delete or rewrite another Node's relationship, the stored thread or message, another Node's textbox or chat, an email chat quote, or any surviving attachment relationship.

### Law 32 — Huddle ownership and placement use exact Huddle identities

`huddle_nodes.huddle_logic_gate_id` MUST equal the exact owning `huddle_logic_gates.huddle_logic_gate_id`. `huddle_explorer_items.resource_huddle_resource_id` MUST equal the exact source `huddle_logic_gates.huddle_logic_gate_id`, and the retained `huddle_type` column MUST equal `huddle_logic_gate`. Huddle Nodes MUST NOT receive Huddle Explorer items.

Converting a normal Logic Gate and creating its required Huddle Logic Gate Explorer item MUST be atomic. Creating, updating, deleting, or restoring a Huddle Node MUST NOT create or restore an Explorer item. Deleting only an Explorer item removes only that Huddle Logic Gate placement. Recycling a Huddle Logic Gate MUST preserve its exact typed placement for restore. These relationships MUST NOT create a central registry, translated ID, untyped edge, access grant, or policy-parent link.

### Law 33 — Huddle membership and Huddle Node snapshots use fixed typed edges

`huddle_logic_gate_relationships` MUST store one exact same-company `huddle_logic_gate_id + logic_gate_id` pair for each live membership. One endpoint may participate in many pairs, repeated creation MUST be idempotent, and removing one pair MUST remove only that edge.

The Huddle Logic Gate page and normal Logic Gate editor MUST read and mutate that same row from opposite directions. A normal Logic Gate editor mutation requires Edit access to that Logic Gate and View access to the selected Huddle Logic Gate; its reverse read MUST omit Huddle Logic Gates the actor cannot view. This reverse UI and API MUST NOT create another table, copied list, policy parent, or relationship authority.

Creating a Huddle Node MUST atomically copy the owner Huddle Logic Gate's current normal Logic Gate identities into `huddle_node_logic_gate_relationships` and the current KPI identities for those Logic Gates into `huddle_node_kpi_relationships`. Those captured relationship sets MUST remain immutable after creation and MUST NOT be rewritten by later live membership or KPI-set changes.

Snapshot reads MUST resolve current data from `logic_gates` and `kpis` through those literal IDs. They MUST NOT store copied labels, editor documents, previews, generic resource types, relationship-only endpoint IDs, or a background synchronization stream. Recycling and restoring any endpoint MUST preserve every promised exact Huddle edge; permanent deletion MUST leave no stale edge.

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
```

No example introduces a translated resource identity. The fixed endpoint and the typed literal endpoint are sufficient.
