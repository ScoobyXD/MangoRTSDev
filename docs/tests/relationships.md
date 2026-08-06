# Process Story: Mango relates resources by their exact identities

A user relates or personally pins an existing Node, Logic Gate, Project, email, attachment, Account, or other supported Mango resource
↓
The command carries the resource's existing canonical ID unchanged from its source record
↓
For a move, Mango re-reads the existing canonical edge and authorizes its actual source instead of trusting a stale browser source hint
↓
Moving a Node between Logic Gates changes only that canonical assignment and its projections; email and attachment relationships stay attached to the exact Node and are neither required nor rewritten
↓
The relationship subsystem stores that literal ID in a direct typed column when the endpoint type is fixed, or together with its canonical `resource_type` when the endpoint type can vary
↓
The relationship remains in the table for its business meaning, such as Node structure, Logic Gate flow, Project membership, personal pin organization, email attachment, file ownership, Account assignment, permission, or GVIC assignment; only the documented Company Explorer, Logic Gate-to-Node, and Shared Triage parent links also define immediate V2 policy ancestry
↓
Reads, events, projections, recycle/restore, and permanent deletion use the same company, endpoint type, and literal resource ID; no resource registry, translated ID, or replacement identity is consulted
↓
Removing one relationship removes only that edge unless the owning subsystem has a separate, explicit deletion rule; deleting a personal pin folder removes only its descendant folder and pin records, never the pinned resources

Last updated: 2026-08-05

# Relationship Business Logic Laws

These laws define how MangoRTS represents relationships. They apply to schema design, backend commands, APIs, events, caches, derived projections, deletion, recycle/restore, tests, and documentation.

## What `resource` means

A **resource** is an identifiable Mango business object that may own data or be one endpoint of a relationship. Resources include Nodes, Logic Gates, Projects, email messages and threads, textboxes and chats where they have their own identity, attachments, Accounts, Company Explorer folders, shared inboxes and folders, and any future business object explicitly added to a relationship contract.

A user or group is normally a **principal** when it receives a permission or GVIC role. A relationship row and a derived projection row are records about resources; they are not automatically resources themselves.

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
- Account assignment, permission, and GVIC relationship tables for their own distinct meanings.

### Law 5 — Do not split one meaning merely because endpoint types differ

When one relationship meaning has the same behavior and row data for several resource types, it MUST use one relationship table with `resource_type + resource_id`. Mango MUST NOT create a Node-specific, Project-specific, Logic-Gate-specific, and email-specific table solely to obtain separate foreign keys.

Separate tables are correct when the business meaning or required fields differ, not merely because the endpoint type differs. Existing storage that predates this law is not a precedent for adding more type-split tables; consolidating existing storage requires its own explicit migration task.

### Law 6 — Fixed endpoints may keep explicit columns

When a relationship table has a fixed endpoint by definition, that endpoint SHOULD use its direct typed column. `project_relationships.project_id`, for example, is the exact owning Project, while `resource_type + resource_id` identifies the supported related resource.

Same-type structural tables MAY use two explicit typed columns when both sides have one fixed type. `node_relationships.node_id_a/node_id_b` and `logic_gate_relationships.logic_gate_id_a/logic_gate_id_b` are valid because their relationship meanings and endpoint types are fixed.

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
- An attachment may have multiple active owner relationships.

### Law 13 — Duplicate commands do not create duplicate semantic edges

Each relationship table MUST define the columns that make one semantic relationship unique. Repeating the same create command MUST reuse the existing relationship or succeed idempotently without creating a duplicate edge.

Different relationship meanings, different owners, different resource types, or explicitly different relationship metadata MAY produce separate rows when their subsystem laws allow it.

### Law 14 — Relationship existence does not silently grant unrelated access

A relationship row MUST NOT automatically bypass the normal authorization rules for either endpoint. Reads and writes resolve access through the owning subsystem's explicit contract.

For email and attachment links, knowing an email ID, attachment ID, object key, or relationship ID is never sufficient by itself. Access is checked through the exact owning resource and relationship scope.


The only relationships that define V2 GVIC and permission parentage are the exact hierarchy contracts in `docs/importanttasks/v2gvic&permissions.md`: Company Explorer folders parent contained folders, Projects, and Logic Gates; a Logic Gate parents its assigned Nodes; Shared Triage folders parent contained folders and shared inboxes. Project membership, Node-to-Node structure, email, attachment, Account, and other relationships do not become policy parents.

Creating or moving one of those parent links advances separate GVIC and permission parent-link sequences. The relationship does not copy policy rows or grant access by itself; an inherited child resolves its current parent policy, while a customized child remains independent. Removing the only Node-to-Logic-Gate parent materializes an inherited Node's current effective policies before detach so a root never remains inherited.

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

### Law 18 — Recycling preserves restorable relationships

Moving a resource to the Recycle Bin MUST capture the relationships that the product promises to restore before deleting their live rows. Restore MUST recreate the exact original company, resource types, literal endpoint IDs, relationship meaning, and required relationship metadata in dependency-safe order.

Recycle behavior MUST NOT translate resource IDs, invent replacement endpoints, or restore a relationship across companies.

### Law 19 — Removing an edge does not delete its endpoints

Deleting a relationship normally deletes only that relationship. Removing a Node from a Project does not delete the Node or Project. Removing an email relationship does not delete the normalized email message or thread. Removing one attachment relationship does not delete the file while another valid active owner relationship survives.

Any endpoint-deletion behavior must be an explicit separately documented business rule. Attachment last-owner cleanup is one such explicit rule.

### Law 20 — Source tables own truth; projections only derive it

The canonical relationship or assignment table is the write authority for its business meaning. A projection, cache, search document, Kanban view, Company Explorer view, My Work row, or API compatibility shape MUST derive from source relationships and MUST NOT become a second relationship authority.

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

`pins.resource_type + pins.resource_id` stores the exact typed identity of the pinned Node, Logic Gate, or Project. `pin_folders` is a separate user-and-company-scoped organization tree, and `pins.parent_folder_id` points directly to a folder owned by that same user and company. Folder parent links must reject cycles and cross-owner IDs.

Deleting a pin, pin folder, or pin folder subtree deletes only personal organization rows. It MUST NOT delete, recycle, rename, move, permission-change, or otherwise mutate the underlying pinned resources. Grouping two pins into a new folder and changing mixed folder/pin layout are atomic personal-organization commands; they do not create another resource identity or access relationship.

## Required design examples

These examples show the required identity pattern; they do not replace each subsystem's detailed schema.

```text
Project membership:
  company_id   = C
  project_id   = exact projects.project_id
  resource_type = node
  resource_id   = exact nodes.node_id

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
