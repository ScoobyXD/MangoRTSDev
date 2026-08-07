# Process Story: RACI names responsibility and expands teams live

A manager or editor assigns Responsible, Accountable, Consulted, or Informed to people or groups on a resource
↓
The policy stores each direct user or group once, and the editor shows each direct assignee's full display name
↓
Nested group membership expands live for effective RACI, My Work, and notifications without creating permanent per-user copies
↓
A changed effective role notifies that non-actor user even when the user was already assigned before the policy replacement
↓
A company manager with Edit access can manage regular-user, group, and peer-manager permission rules, while admin identities remain protected
↓
RACI and permissions remain separate, and the permission PUT has no documented 1,000-assignment product cap

Last updated: 2026-08-06

# Process Story

A Mango company organizes work as a resource tree. A Company Explorer folder can contain subfolders, Projects, and Logic Gates; a Logic Gate can contain assigned Nodes. Shared Triage folders can contain subfolders and shared inboxes. Every resource has a RACI assignment mode and a permission mode. Each mode is either `inherited` or `customized`.

An inherited resource points to its immediate parent's effective policy. Inheritance continues one parent at a time until Mango reaches the nearest active customized policy. A customized resource remains a child in the resource tree, but it owns a complete policy and blocks ordinary inheritance through that branch. Descendants that remain inherited use that customized resource as their policy source.

A parent has two descendant actions. `Apply to inherited descendants` changes the policy seen by inherited branches and stops at active customized boundaries. It requires no descendant writes because inherited descendants already resolve through their immediate parents. `Overwrite all descendants, including customized` is the explicit force action. It records one monotonic reset sequence at the parent instead of rewriting every descendant. The reset makes older customized policies beneath that parent inactive. A descendant customized after the reset becomes independent again. A subtree created or moved beneath the parent after an older reset is not retroactively overwritten by that reset.

RACI and permissions remain separate systems. `resource_gvic_assignments` stores customized RACI edges from a resource to a user or user group. `resource_permissions` stores customized permission edges from a resource to a user or user group. RACI never grants resource access. Permission authorization first selects one effective permission policy through the inheritance rules, then resolves direct user, nested group, and default access inside that policy. Group membership is live source data and is never copied into permanent per-user policy rows.

The final product model has exactly four policy tables: `resource_gvic_settings`, `resource_gvic_assignments`, `resource_permission_settings`, and `resource_permissions`. The settings tables distinguish inherited from intentionally empty customized policies and hold the sequence values needed for scalable force-overwrite behavior. The assignment tables hold the actual customized user/group edges. There is no permanent effective-assignment table, descendant fan-out table, policy-application history table, or duplicated default-access authority.

# V2 RACI and Permissions (technical `gvic` storage/API namespace)

## Purpose and status

This document is the authoritative product, database, API, migration, and verification contract for the V2 RACI and permission system.

It replaces the current pointer/application design after the three separately completed steps below:

1. Create and populate the V2 storage without changing current application readers or writers.
2. Cut application reads and writes over to the four final tables.
3. Complete testing, soak, snapshot, and separately approved retirement of old storage.

This document does not authorize an agent to apply SQL to a live database. Repository agents may create schema, migration, preflight, copy, verification, and retirement files, but a human controls every live-database operation.
## August 6, 2026 RACI conversion

The product roles are Responsible, Accountable, Consulted, and Informed. Existing technical table, API, and helper names keep the `gvic` namespace; that namespace is not a fifth role or a separate policy authority.

Existing databases require the reviewed forward migration `backend/db/migrations/20260806_zzz_raci_roles.sql`. It converts active Generated rows to Responsible and active Verified or Verifier rows to Accountable, updates notification and projection role values, updates restorable Recycle Bin policy JSON, removes the legacy Generated/Verified user-only and single-Generated restrictions, and installs live nested-group effective resolution for every RACI role. Agents must not apply it to a live database.

Fresh disposable databases receive the same final contract from the marked RACI block at the end of `backend/db/schema.sql`. That file is also a replayable history and still contains the earlier Step 1 staging and Step 2 rename/cutover construction before the final RACI block. Runtime code reads and writes only the final four V2 policy tables. This RACI change does not rewrite the historical construction into a new direct-create-only schema.

## Final decisions

The following decisions are not open implementation choices:

1. Use the words `inherited` and `customized`. Do not use `local` for the product or database mode.
2. RACI and permissions have separate settings tables, separate assignment tables, separate sequences, separate APIs, and separate business rules.
3. A resource inherits one complete policy from its immediate parent chain. Policies from multiple resource levels are not merged.
4. A customized resource is still a normal child in the resource tree. Only its policy becomes independent.
5. Ordinary parent changes affect inherited branches and stop at active customized boundaries.
6. The force action crosses customized boundaries by recording one reset sequence at the selected parent. It never performs descendant fan-out writes.
7. A later descendant customization wins over an older force reset.
8. A force reset applies only across parent links that existed when that reset was recorded. A resource or subtree moved under the parent later is not affected by the older reset.
9. Group assignments remain group edges. Effective users are resolved from current group hierarchy and membership.
10. RACI never grants view or edit permission.
11. Current policy resolution does not depend on audit history, timestamps, a projection table, or old application rows.
12. Database timestamps are audit/display fields. Monotonic sequences decide overwrite ordering.
13. The final policy schema contains exactly four tables. PostgreSQL sequences, indexes, constraint functions, and triggers are not additional product-state tables.
14. No compatibility reader, fallback reader, dual writer, or request-time schema repair remains after Step 3.

## Terminology

### Stored mode

The value physically stored in a settings row:

- `inherited`: the resource has no active customized policy of its own.
- `customized`: the resource has a complete customized policy stored in its assignment table and settings row.

### Active customized policy

A stored customized policy that has not been invalidated by a newer eligible ancestor force reset.

A settings row may still say `customized` after a force reset. In that case its old assignment rows remain dormant until the user customizes that resource again. The API must expose that it is currently inherited because an ancestor overwrite superseded the stored customization.

### Effective policy

The one complete RACI or permission policy selected after walking the immediate-parent chain and applying force-reset rules.

### Immediate parent

The direct parent supplied by the canonical resource hierarchy. Policy tables do not duplicate parent IDs.

### Inherited-only apply

The user action labeled `Apply to inherited descendants`. Because inheritance is live, this changes no descendant policy rows. It confirms that inherited branches use the selected resource's effective policy and that customized boundaries remain protected.

### Force overwrite

The user action labeled `Overwrite all descendants, including customized`. It advances the selected resource's descendant reset sequence and invalidates older customized policies beneath it.

## Supported resource hierarchy

The final policy resource types are:

```text
node
logic_gate
project
company_explorer_folder
shared_inbox_folder
shared_inbox
```

The old RACI spelling `shared_triage_folder` is not a final resource type. Step 1 converts it to `shared_inbox_folder`.

Immediate parents are resolved only from canonical hierarchy tables:

| Child resource | Immediate policy parent |
| --- | --- |
| Company Explorer subfolder | Its `company_explorer_folders.parent_folder_id` folder |
| Company Explorer root folder | None |
| Logic Gate | Its containing Company Explorer folder |
| Project | Its containing Company Explorer folder |
| Node assigned to a Logic Gate | Its current Logic Gate from `node_logic_gate_assignments` |
| Node without a Logic Gate | None |
| Shared Inbox subfolder | Its `shared_inbox_folders.parent_folder_id` folder |
| Shared Inbox root folder | None |
| Shared inbox/mailbox | Its containing Shared Inbox folder |

Hierarchy ownership remains in the existing resource tables. Do not add `parent_resource_type` or `parent_resource_id` to the four policy tables.

Resource-tree cycles must be rejected before policy resolution. A root resource cannot remain inherited because it has no parent; roots must have a customized policy, even when that customized policy is empty.

## Final database schema

The final clean database creates two sequences and exactly four policy tables.

### Sequences

```sql
create sequence if not exists resource_gvic_change_sequence;
create sequence if not exists resource_permission_change_sequence;
```

Each policy mutation obtains its sequence inside the same transaction as its state change. Rolled-back transactions may leave gaps. Gaps are harmless. Sequence ordering, not timestamps, controls force-overwrite precedence.

### `resource_gvic_settings`

One row exists for every RACI-capable resource.

```sql
create table resource_gvic_settings (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  assignment_mode text not null,
  customized_sequence bigint,
  parent_link_sequence bigint not null,
  descendant_reset_sequence bigint not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, resource_type, resource_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  check (resource_type in (
    'node',
    'logic_gate',
    'project',
    'company_explorer_folder',
    'shared_inbox_folder',
    'shared_inbox'
  )),
  check (assignment_mode in ('inherited', 'customized')),
  check (
    (assignment_mode = 'inherited' and customized_sequence is null)
    or
    (assignment_mode = 'customized' and customized_sequence is not null and customized_sequence > 0)
  ),
  check (parent_link_sequence >= 0),
  check (descendant_reset_sequence >= 0)
);
```

Field meaning:

- `assignment_mode`: stored `inherited` or `customized` choice.
- `customized_sequence`: sequence of the last explicit customization. It is null while stored mode is inherited.
- `parent_link_sequence`: sequence allocated when the current immediate-parent link was created. It is zero for a root.
- `descendant_reset_sequence`: sequence of the latest force overwrite initiated at this resource. It applies only to proper descendants, never to this row itself.

Required indexes:

```sql
create index on resource_gvic_settings
  (company_id, resource_type, resource_id, customized_sequence);

create index on resource_gvic_settings
  (company_id, resource_type, resource_id, descendant_reset_sequence)
  where descendant_reset_sequence > 0;
```

### `resource_gvic_assignments`

This is the customized RACI graph. It contains no inherited copies and no expanded group-member rows.

```sql
create table resource_gvic_assignments (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  role text not null,
  principal_type text not null,
  principal_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (
    company_id,
    resource_type,
    resource_id,
    role,
    principal_type,
    principal_id
  ),
  foreign key (company_id, resource_type, resource_id)
    references resource_gvic_settings(company_id, resource_type, resource_id)
    on delete cascade,
  check (role in ('responsible', 'accountable', 'consulted', 'informed')),
  check (principal_type in ('user', 'group'))
);
```

Additional required constraints and indexes:

```sql
create unique index on resource_gvic_assignments
  (company_id, resource_type, resource_id, principal_type, principal_id);


create index on resource_gvic_assignments
  (company_id, principal_type, principal_id, role, resource_type, resource_id);
```

Uniform RACI validation applies to every supported resource type so a folder policy can be inherited by a Logic Gate or Node without becoming invalid:

- Responsible, Accountable, Consulted, and Informed each allow multiple users or groups.
- One direct principal may have only one source role in one customized resource policy.
- Effective users from overlapping direct and group paths resolve in Responsible, Accountable, Consulted, Informed priority order.

### `resource_permission_settings`

One row exists for every permission-capable resource.

```sql
create table resource_permission_settings (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  permission_mode text not null,
  default_access text,
  customized_sequence bigint,
  parent_link_sequence bigint not null,
  descendant_reset_sequence bigint not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, resource_type, resource_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  check (resource_type in (
    'node',
    'logic_gate',
    'project',
    'company_explorer_folder',
    'shared_inbox_folder',
    'shared_inbox'
  )),
  check (permission_mode in ('inherited', 'customized')),
  check (default_access is null or default_access in ('edit', 'no_access')),
  check (
    (
      permission_mode = 'inherited'
      and customized_sequence is null
      and default_access is null
    )
    or
    (
      permission_mode = 'customized'
      and customized_sequence is not null
      and customized_sequence > 0
      and default_access in ('edit', 'no_access')
    )
  ),
  check (parent_link_sequence >= 0),
  check (descendant_reset_sequence >= 0)
);
```

`resource_permission_settings.default_access` becomes the only permission-default authority. After Step 3, old `default_access` columns on resource tables must be removed if repository inspection proves they have no separate non-permission meaning.

Required indexes:

```sql
create index on resource_permission_settings
  (company_id, resource_type, resource_id, customized_sequence);

create index on resource_permission_settings
  (company_id, resource_type, resource_id, descendant_reset_sequence)
  where descendant_reset_sequence > 0;
```

### `resource_permissions`

This is the customized permission graph. It contains no inherited copies and no expanded group-member rows.

```sql
create table resource_permissions (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  subject_type text not null,
  subject_id uuid not null,
  access_level text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (
    company_id,
    resource_type,
    resource_id,
    subject_type,
    subject_id
  ),
  foreign key (company_id, resource_type, resource_id)
    references resource_permission_settings(company_id, resource_type, resource_id)
    on delete cascade,
  check (subject_type in ('user', 'group')),
  check (access_level in ('edit', 'no_access'))
);
```

Required reverse lookup index:

```sql
create index on resource_permissions
  (company_id, subject_type, subject_id, access_level, resource_type, resource_id);
```

The old redundant `resource_permissions.user_id` column is not part of V2.

### Database-enforced integrity

Because resource and principal identities are polymorphic, ordinary foreign keys cannot enforce every target. Final schema constraint triggers must reject:

- a resource settings row whose company/resource does not exist;
- a user principal without membership in the same company;
- a group principal without a group in the same company;
- assignment rows while the stored settings mode is inherited;
- an inherited root resource;
- a resource-tree cycle;
- a negative or malformed sequence;
- an unsupported legacy resource type such as `shared_triage_folder`.

Resource deletion must delete both settings rows. Cascades then delete assignment edges. No orphan policy, revision, application, or effective rows may survive.

## Effective-policy resolution

RACI and permissions use the same traversal algorithm but read their separate settings, assignment, and sequence domains.

### Base rule without force overwrite

Starting at the requested resource:

1. If its stored mode is inherited, move to its immediate parent.
2. If its stored mode is customized and active, use that complete policy.
3. Continue until a customized policy is found.
4. A root must provide the final customized policy.

The nearest active customized resource wins. A newer ordinary write at a distant ancestor does not cross a customized boundary.

### Eligible force overwrite

A force overwrite at ancestor A with sequence S is eligible for descendant T only when:

1. A is a strict ancestor of T.
2. Every parent link on the path from A to T existed at sequence S; equivalently, every corresponding `parent_link_sequence` is less than or equal to S.

If any path edge has a newer `parent_link_sequence`, that subtree entered A after the overwrite and the old overwrite cannot cross that edge.

When several force overwrites are eligible, the one with the greatest reset sequence is authoritative.

### Resolution with force overwrite

Let A/S be the newest eligible force overwrite for target T.

1. Walk from T toward A, excluding A.
2. A customized policy below A remains active only when its `customized_sequence` is greater than S.
3. Use the nearest such later customization if one exists.
4. Otherwise resolve A's own effective policy. A's reset never invalidates A itself.
5. Resolving A may itself be subject to a newer eligible overwrite from an ancestor above A.

This provides the intended limited latest-write rule:

- a force overwrite beats older descendant customizations;
- a later descendant customization beats that force overwrite;
- ordinary parent edits never beat a customized child merely because their sequence is newer;
- immediate-parent proximity chooses between active customized policies.

### Intentionally empty customized policies

An empty assignment table does not mean inherited.

- RACI `customized` plus zero RACI rows means intentionally nobody is assigned.
- Permission `customized` plus zero permission rows means the customized `default_access` applies to everyone without exceptions.

The settings row is therefore required even when the graph table contains no rows.

## The two descendant actions

### Action 1: Apply to inherited descendants

User-facing label:

```text
Apply to inherited descendants
```

Rules:

1. Save the selected resource's policy if it changed.
2. Do not update descendant settings or assignment rows.
3. Every inherited branch already resolves through its immediate parents and sees the new effective policy.
4. Stop at every active customized boundary.
5. Descendants below that boundary continue inheriting from the customized resource, not from the selected ancestor.
6. An unchanged inherited-only Apply may write an audit event, but it must not manufacture policy state or fan out descendant writes.

Example:

```text
Folder A: customized
  Folder B: inherited          receives Folder A changes
    Logic Gate C: customized   protected boundary
      Node D: inherited        continues using Logic Gate C
```

### Action 2: Overwrite all descendants, including customized

User-facing label:

```text
Overwrite all descendants, including customized
```

Rules:

1. Resolve and validate the selected parent's current effective policy.
2. Allocate one new sequence.
3. Set only the selected parent's `descendant_reset_sequence` for that policy type.
4. Do not rewrite descendant settings or graph rows.
5. Every eligible older customization below the parent becomes inactive.
6. Descendants effectively inherit through the selected parent again.
7. A descendant customized later receives a newer sequence and becomes independent again.
8. A subtree attached after the reset is protected by its newer `parent_link_sequence` until a later force overwrite occurs.
9. The old customized rows remain dormant. Customizing the resource again must replace them with a fresh copy of the then-current parent policy before applying edits; it must not silently resurrect the dormant policy.

Example:

```text
Folder customization                 sequence 100
Logic Gate customization             sequence 120
Folder ordinary save                 sequence 130
```

The Logic Gate remains customized. The ordinary save does not cross it.

```text
Folder force overwrite               sequence 140
```

The older Logic Gate customization becomes inactive.

```text
Logic Gate customized again          sequence 150
```

The Logic Gate becomes independent again.

## Create, customize, inherit, move, detach, and delete

### Create

1. A resource with an immediate parent starts inherited unless a creation workflow explicitly requires a customized rule.
2. A root starts customized with a complete valid policy, even when that policy contains no edges.
3. Allocate `parent_link_sequence` when the parent relationship is created.
4. An inherited child receives no copied graph rows.
5. A workflow that must assign a creator directly, such as an email-derived Node Responsible assignment, first customizes from the current effective parent policy and then applies the creator rule.

### Customize

1. Resolve the current effective parent policy.
2. Replace the resource's RACI or permission graph rows with a complete copy of that policy.
3. Apply the user's changes to the copied policy.
4. Set stored mode to customized.
5. Allocate a new `customized_sequence`.
6. Perform all steps in one transaction.

Customization is copy-on-customize for one resource only. It is never descendant fan-out copying.

### Return one resource to inherited

1. Delete that resource's customized graph rows for the selected policy type.
2. Set its stored mode to inherited.
3. Set `customized_sequence` to null.
4. Retain its descendant reset sequence because that row records an explicit past force action initiated at this resource. A separate product action may clear that reset only if later product requirements explicitly define it.
5. The resource immediately resolves through its current immediate parent.

### Move within the resource tree

1. The canonical hierarchy writer changes the parent relationship.
2. Allocate a new `parent_link_sequence` for RACI and permissions on the moved resource.
3. Do not rewrite the moved resource's descendants.
4. An inherited moved resource immediately uses its new parent chain.
5. A customized moved resource remains customized.
6. The new parent-link sequence blocks force overwrites that happened before the move from retroactively invalidating the moved subtree.
7. A later force overwrite from the new ancestry may cross the new link.

### Node Logic Gate assignment and detach

1. Assigning or moving a Node to a Logic Gate changes its immediate parent and advances both parent-link sequences.
2. An inherited Node uses the new Logic Gate immediately.
3. A customized Node remains customized after the move.
4. Detaching a Node removes its immediate parent. An inherited Node cannot remain inherited without a parent, so detach must convert its currently effective RACI and permission policies into customized policies in the same transaction.

### Delete

1. Delete the resource's two settings rows through the shared resource-deletion lifecycle.
2. Assignment rows cascade from the settings rows.
3. Deleting a parent follows the resource tree's existing child move/delete rules before policy cleanup.
4. No policy row may retain a missing resource, user, or group identity.

## RACI-specific rules

1. Roles are Responsible, Accountable, Consulted, and Informed, displayed in that order.
2. Every role allows multiple direct users or groups.
3. One direct principal has only one role in one customized policy.
4. Nested groups expand from `company_user_groups` and `company_user_group_members` at read time.
5. If one effective user reaches several roles through overlapping groups, the effective role is selected deterministically in this order: Responsible, Accountable, Consulted, Informed.
6. The editor colors are Responsible orange (`#f97316`), Accountable green (`#16a34a`), Consulted blue (`#2563eb`), and Informed purple (`#7c3aed`).
7. The editor shows direct person and group names in each role card; names wrap instead of collapsing to `People (n)`.
8. A group membership or group-parent change changes effective RACI immediately without rewriting policy rows.
9. RACI controls assignment, My Work, update routing, and notification targeting only. It never grants resource access.
10. My Work must still require effective Edit permission to the returned resource.

## Permission-specific rules

After selecting one effective permission policy through inheritance:

1. Dev admins and company admins receive the existing administrative bypass.
2. Company managers do not receive that bypass.
3. A direct user rule beats every group rule and the default.
4. A matching group rule beats the default.
5. Among matching nested groups, the nearest group membership depth wins.
6. At equal group depth, `no_access` beats `edit`.
7. If no user or group rule applies, use `resource_permission_settings.default_access` from the effective customized policy.
8. RACI assignments are never considered by permission authorization.
9. Permission-setting reads and writes retain the manager/admin authorization boundary. Managers with effective Edit access may change regular-user, group, and peer-manager rules; company-admin and dev-admin identities remain protected, and admins retain their bypass.
10. Runtime authorization resolves current group hierarchy from source group tables. It does not depend on `company_user_group_closure` or another required derived table.
11. The canonical V2 permission PUT has no documented 1,000-assignment product cap.

## Group changes

1. Adding or removing a user from a group changes effective RACI and permission results immediately.
2. Moving a group under another group changes nested membership immediately.
3. Deleting a group removes direct graph edges referencing that group from both graph tables.
4. Group deletion must not leave blank-label or stale UUID policy assignments.
5. Group changes do not allocate resource policy customization sequences because the resource policy itself was not edited.
6. Cache fingerprints must include the company group-membership version so stale authorization or My Work data cannot survive a group change.

## API and JSON contract

V2 removes legacy specialized RACI writers and uses one resource-shaped JSON contract per domain.

### RACI read response

```json
{
  "company_id": "uuid",
  "resource_type": "logic_gate",
  "resource_id": "uuid",
  "assignment_mode": "customized",
  "effective_assignment_mode": "customized",
  "effective_source": {
    "resource_type": "logic_gate",
    "resource_id": "uuid"
  },
  "overwritten_by_ancestor": null,
  "gvic_assignments": [
    {
      "role": "responsible",
      "principal_type": "user",
      "principal_id": "uuid"
    }
  ],
  "effective_assignments": [
    {
      "role": "responsible",
      "user_id": "uuid",
      "source_principal_type": "user",
      "source_principal_id": "uuid"
    }
  ]
}
```

`gvic_assignments` contains stored customized edges only. It is empty for stored inherited mode. `effective_assignments` contains the resolved user-level result for the current request and is not read from a permanent effective table.

### RACI write request

```json
{
  "company_id": "uuid",
  "assignment_mode": "customized",
  "gvic_assignments": [
    {
      "role": "consulted",
      "principal_type": "group",
      "principal_id": "uuid"
    }
  ],
  "descendant_action": "inherited_only"
}
```

`descendant_action` is optional and accepts only:

```text
inherited_only
including_customized
```

When `assignment_mode` is inherited, the request must omit assignments or send an empty array.

### Permission read response

```json
{
  "company_id": "uuid",
  "resource_type": "company_explorer_folder",
  "resource_id": "uuid",
  "permission_mode": "customized",
  "effective_permission_mode": "customized",
  "effective_source": {
    "resource_type": "company_explorer_folder",
    "resource_id": "uuid"
  },
  "overwritten_by_ancestor": null,
  "default_access": "edit",
  "permissions": [
    {
      "subject_type": "group",
      "subject_id": "uuid",
      "access_level": "no_access"
    }
  ]
}
```

### Permission write request

```json
{
  "company_id": "uuid",
  "permission_mode": "customized",
  "default_access": "edit",
  "permissions": [
    {
      "subject_type": "user",
      "subject_id": "uuid",
      "access_level": "no_access"
    }
  ],
  "descendant_action": "including_customized"
}
```

When `permission_mode` is inherited, `default_access` must be null/omitted and `permissions` must be omitted or empty.

### Write response and concurrency

Every write returns the canonical stored and effective response plus an ETag/revision fingerprint. Mutations must reject a stale expected revision instead of silently interleaving two complete-policy replacements.

Within a transaction:

1. Lock the resource settings row.
2. Validate company, resource, principal, and authorization.
3. Allocate the sequence.
4. Replace graph rows precisely.
5. Update settings.
6. Append the normal audit/domain event.
7. Commit before publishing any external/realtime signal.

Idempotency keys must deduplicate the command itself, not only its notification event.

## Scale and performance contract

The design must work when a folder has 100,000 or 10,000,000 descendants.

### Write complexity

- Parent policy save: O(number of rules on that parent).
- Apply to inherited descendants: O(number of rules on that parent), with zero descendant policy writes.
- Force overwrite including customized: O(1) settings update plus audit event.
- Customize one child: O(number of rules in the one copied policy).
- Move one subtree: O(1) policy-settings updates at the moved root; no descendant policy writes.
- Group membership change: O(group source change); no resource-policy fan-out.

No synchronous request may enumerate every descendant merely to change policy state.

### Point authorization

Permission checks perform work proportional to:

- resource ancestry depth;
- number of rules in the selected customized policy;
- relevant nested group depth.

They must not perform work proportional to the total number of descendants.

### My Work and reverse RACI lookup

My Work reads from canonical RACI settings/assignments, canonical hierarchy, current group membership, and current permissions.

Requirements:

1. Results are paginated and deterministically ordered.
2. Queries start from user/group assignment roots and indexed hierarchy relationships rather than scanning every company resource.
3. Active customized boundaries and eligible force resets are applied during scope resolution.
4. My Work never requires synchronous descendant materialization after a policy write.
5. If a disposable search cache is later proven necessary, it must be rebuildable from the four tables and hierarchy, clearly named as a cache, and never used as policy authority.

### Cache and ETag behavior

Do not bump millions of Node or Logic Gate version rows after a parent change.

The authorization/read fingerprint for one resource must include:

- effective customized source resource identity;
- effective customized sequence;
- authoritative eligible reset resource identity and sequence, when present;
- relevant parent-link sequence boundary;
- company group-membership version;
- actor identity and effective edit result where the response exposes edit capability.

Authorization is evaluated before returning HTTP 304.

### Notifications and realtime

1. A parent save or force overwrite must not synchronously create one notification/event per descendant.
2. Emit one committed resource-scoped policy event containing the parent, policy type, action, and sequence.
3. Clients invalidate and reread affected scopes through the compact event.
4. If product later requires descendant notifications, use an explicitly bounded background aggregation job, not the policy write transaction.
5. RACI notification recipients are newly assigned users or users whose highest effective role changed, excluding the actor. Removed users do not receive an assignment notification.

## Three-step implementation and rollout

The three steps are separate work items and separate release gates. Do not combine schema expansion, application cutover, and destructive retirement into one automatic migration.

## Step 1: create V2 storage and copy required data

### Goal

Create the V2 destination, build repeatable read-only preflight/reconciliation, and copy every required current effective policy without changing deployed readers or writers.

### Required repository work

1. Add V2 schema expansion and clean-database schema support for the two settings tables, two sequences, validation functions/triggers, and migration staging needed for the two graph tables.
2. Because `resource_gvic_assignments` and `resource_permissions` already exist under their final names, use clearly named migration-only staging tables while the old application remains deployed. Do not mutate old source meaning during the additive phase.
3. Build a DBeaver-compatible PostgreSQL 17.x read-only preflight. It must use plain SQL, report server version, and return STOP on unsupported version or schema drift.
4. Build a separately operated, restartable copy/reconciliation script. Do not apply it to a live database from an agent task.
5. Update the canonical schema in the phase-appropriate form needed for fresh database tests. Step 3 must leave the canonical schema creating only the final four tables.
6. Add schema contract and disposable PostgreSQL integration tests for first run, rerun, drift refusal, and rollback on mismatch. Static SQL-string tests alone are insufficient.

### Source-of-truth copy rule

The Step 1 copy must resolve the current effective policy from the old source, revision, and subtree-application system. It must not blindly copy `resource_gvic_effective_assignments`, because that table is derived and the old PostgreSQL materialization path may disagree with the latest snapshot boundary.

For every resource and both policy types:

1. Resolve old current policy with the correct latest-snapshot and direct-revision rules.
2. Compare that result with old materialized/read responses.
3. Treat any disagreement as a reported blocker until classified.
4. Copy the resolved complete policy into V2 staging graph rows.
5. Copy the resolved permission default into V2 permission settings.
6. Normalize `shared_triage_folder` RACI identities to `shared_inbox_folder`.
7. Validate every resource and principal identity.
8. Report orphans and invalid role shapes; do not guess replacement resources or principals.

### Initial mode decision

Existing storage does not reliably prove whether an equal-looking child policy was intentionally customized or merely captured from a parent. Equality is not proof of inheritance.

Therefore the safe initial conversion is:

- every existing resource with a policy becomes `customized` in V2;
- roots are customized;
- current effective rows are materialized into that resource's V2 graph rows;
- all initial `descendant_reset_sequence` values are zero;
- all initial parent links receive the migration baseline sequence;
- new V2 sequences start strictly above the migration baseline.

This preserves visible behavior without inventing inheritance. After cutover, users can explicitly return resources to inherited mode or use the force-overwrite action to reset a subtree.

### Preflight requirements

The read-only preflight must report at least:

- PostgreSQL server version and exact schema shape;
- counts by resource type for both old policy systems;
- every resource with source, revision, subtree-application, effective, or projection rows;
- missing resources, users, groups, company memberships, or parent relationships;
- current inherited/resolved permission default and edge counts;
- current resolved RACI role/principal counts;
- historical legacy Generated/Verified group rows or multiple legacy Generated users before the RACI conversion;
- one-principal/multiple-role conflicts;
- old application snapshot/tombstone usage;
- old source versus resolved versus effective-table disagreements;
- old shared-triage resource-type aliases;
- current projection rows that cannot be reproduced from canonical policy and hierarchy;
- the exact proposed V2 disposition for every source identity;
- READY or STOP as a clear final row.

### Step 1 exit gate

Step 1 is complete only when:

- schema and integration tests pass;
- copy is restartable and exact-conflict safe;
- every source identity has one disposition;
- source-to-V2 counts and fingerprints reconcile;
- no current application reader or writer has been switched;
- no old table has been dropped;
- the work reports the human-run order but does not operate on a live database.

### Step 1 implementation and operator record

Step 1 repository implementation was completed and accountable on August 5, 2026. It is additive only: the old RACI and permission tables, functions, triggers, readers, and writers remain active and unchanged. No SQL was applied to a live database, and no application cutover was performed.

Apply these repository migrations in filename order:

1. `backend/db/migrations/20260805_zzz_v2_gvic_permissions_step1.sql`
2. `backend/db/migrations/20260805_zzza_v2_gvic_permissions_step1_resolvers.sql`
3. `backend/db/migrations/20260805_zzzb_v2_gvic_permissions_step1_preflight_report.sql`

Then operate these scripts separately and in this order:

1. `scripts/v2_gvic_permissions_step1_preflight.sql`
2. `scripts/v2_gvic_permissions_step1_copy_reconcile.sql`

The production target is PostgreSQL 17.x. The SQL also accepts PostgreSQL 18.x so the same artifacts can run against the repository's disposable local test server. Other major versions return or raise `STOP`. The scripts are plain PostgreSQL SQL that runs directly in DBeaver and does not use psql commands or variables.

#### Human-run order

1. Confirm the intended database, current PostgreSQL server version, normal backup policy, and deployment change record.
2. Apply the three additive migrations with the normal migration runner. Do not paste only part of a migration. Each migration must commit fully or roll back fully.
3. In DBeaver, run `scripts/v2_gvic_permissions_step1_preflight.sql` as a script. It opens a read-only transaction. Review all `STOP` rows and the last `FINAL` row.
4. Do not run the copy unless the final preflight row is `READY`. A source/effective/projection disagreement is a blocker that must be classified; do not edit the SQL to ignore it.
5. Run `scripts/v2_gvic_permissions_step1_copy_reconcile.sql` separately. It writes only the V2 settings tables, V2 staging graph tables, and two V2 sequences. It does not update or delete old policy storage.
6. Confirm the copy's final row is `READY`, review each resource-type count and fingerprint, and rerun the read-only preflight.
7. Rerun the copy whenever a later exact delta is needed. The copy is restartable and replaces the V2 baseline with the policy resolved from one repeatable-read source snapshot.
8. If DBeaver reports an exception during the copy, run `rollback;` on that connection before retrying. Fix or classify the reported source/schema mismatch first.
9. Stop after Step 1. Do not rename graph tables, switch application readers or writers, or retire old storage. Those actions require the separately approved Step 2 and Step 3 work.

#### Baseline conversion

Step 1 never guesses that equal parent and child policies were inherited. Every existing supported resource receives:

- stored mode `customized`;
- its fully resolved current policy in V2 staging;
- `descendant_reset_sequence = 0`;
- `parent_link_sequence` equal to the migration baseline for children and zero for roots;
- a customization sequence equal to the migration baseline;
- separate RACI and permission sequences whose next values are strictly above the baseline.

The copy normalizes old RACI `shared_triage_folder` identities to `shared_inbox_folder`. Missing resources or principals, invalid RACI role shapes, hierarchy cycles, unresolved permission defaults, old effective-table disagreements, and My Work projection disagreements stop the copy instead of being guessed or silently repaired.

#### Verification record

The schema contract and disposable-PostgreSQL integration tests cover first application, restartable rerun, schema-drift refusal, and transactional rollback. The copy was accountable against one repeatable-read source snapshot, including latest snapshot and direct-revision boundaries, exact counts, and policy fingerprints. The complete repository verification gate passed with the real disposable PostgreSQL path enabled.

## Step 2: application cutover to the four final tables

### Goal

Change backend and frontend behavior so every policy read, write, authorization decision, My Work query, notification decision, cache fingerprint, create/move/delete workflow, and group-change workflow uses only the V2 contract.

### Required cutover order

1. Complete Step 1 and review its evidence.
2. Pause policy, hierarchy, group, Node-placement, and resource-deletion writers for the shortest practical maintenance window.
3. Rerun the final Step 1 delta copy and reconciliation.
4. Atomically place the V2 graph tables under the final canonical names while retaining old tables under explicit temporary legacy names for rollback evidence.
5. Deploy the matching Step 2 backend and frontend.
6. Run readiness and smoke tests before resuming writers.
7. Resume writers only after all new reads and writes are proven to use the four final tables.

### Backend scope

Step 2 must replace:

- generic RACI source/effective readers and writers;
- old Logic Gate RACI command handlers and repository methods;
- old Shared Inbox RACI writers;
- permission authorization SQL and settings CRUD;
- Node Logic Gate placement, cross-gate move, and detach behavior;
- Company Explorer and Shared Triage create/move/delete behavior;
- group membership and group hierarchy effects;
- My Work RACI queries;
- notification target resolution;
- Logic Gate and Node read fingerprints/ETags;
- workspace version/event behavior;
- any compatibility or no-op effective-access helpers.

No old reader, fallback, or dual writer may remain in the deployed Step 2 application.

### Frontend scope

Step 2 must provide:

- clear `Inherited` and `Customized` controls for both RACI and permissions;
- the effective source resource name/type;
- an explanation when a stored customization is inactive because an ancestor force-overwrite superseded it;
- `Apply to inherited descendants`;
- a separately styled and confirmed `Overwrite all descendants, including customized` action;
- canonical response reconciliation and stale-request protection;
- no optimistic UI that pretends millions of descendants were individually rewritten.

### Step 2 exit gate

Step 2 is complete only when:

- every application read and write uses the V2 tables;
- the old table names have zero deployed readers and writers;
- point authorization and My Work return correct results;
- force overwrite performs constant-size policy writes;
- smoke tests cover create, customize, inherit, both overwrite options, move, detach, group change, delete, My Work, notifications, and ETags;
- old storage remains frozen only as rollback/audit evidence.

### Step 2 implementation and operator record

Step 2 repository implementation was completed and accountable on August 5, 2026. No SQL was applied to a live database, no production secret or database writer credential was accessed, and no cloud resource was changed. Step 3 retirement was not performed.

The Step 2 database artifacts are:

- `backend/db/migrations/20260805_zzzc_v2_gvic_permissions_step2_cutover.sql`: the one atomic cutover transaction;
- the `V2_RACI_PERMISSIONS_STEP2_BEGIN/END` block in `backend/db/schema.sql`: the matching fresh-database schema state;
- `scripts/v2_gvic_permissions_step2_preflight.sql`: DBeaver-safe read-only pre-cutover validation;
- `scripts/v2_gvic_permissions_step2_readiness.sql`: DBeaver-safe read-only post-deploy readiness validation.

The cutover migration locks the old final-name graph tables, the two staging graph tables, and both settings tables. In one transaction it:

1. verifies PostgreSQL 17.x/18.x and exact unordered table shapes;
2. requires the final Step 1 reconciliation report to be READY;
3. renames old `resource_gvic_assignments` to `resource_gvic_assignments_step2_legacy`;
4. renames old `resource_permissions` to `resource_permissions_step2_legacy`;
5. renames the two reconciled V2 staging graph tables to `resource_gvic_assignments` and `resource_permissions`;
6. installs the V2 resolvers, authorization, fingerprints, initialization, hierarchy-parent, detach, deletion, and group-version/cleanup functions and triggers;
7. checks settings coverage and commits as one unit.

The temporarily renamed legacy graph tables and all other Step 1 legacy policy storage remain frozen rollback/audit evidence. The migration does not drop them. The two staging names disappear only because those exact tables become the canonical final graph tables.

#### Human-run operator order

Use a designated database operator and ordinary DBeaver PostgreSQL SQL execution. Do not use an application agent or any request-time repair path.

1. Review the completed Step 1 evidence and confirm a tested rollback plan.
2. Pause policy, hierarchy, group, Node-placement, and resource-deletion writers.
3. Rerun the Step 1 read-only preflight, final delta copy, and exact reconciliation until each final result is READY.
4. Run `scripts/v2_gvic_permissions_step2_preflight.sql`. It reports the connected server version, compares exact unordered column-name sets plus counts, includes the Step 1 final reconciliation, and must return `FINAL / READY`. STOP means do not run the cutover.
5. Run `backend/db/migrations/20260805_zzzc_v2_gvic_permissions_step2_cutover.sql` once. Any error rolls back the entire rename and V2 runtime installation.
6. Deploy the matching Step 2 backend and frontend while writers remain paused.
7. Run `scripts/v2_gvic_permissions_step2_readiness.sql`. It must return READY for server version, the four final exact table shapes, both temporary legacy graph tables, absence of the old staging names, and complete settings coverage.
8. Run smoke checks for create, customize, inherit, both descendant actions, move, Node detach, group membership/hierarchy/delete, point authorization, My Work, notifications, and actor-safe ETags.
9. Resume writers only after readiness and smoke checks pass.
10. Keep the temporary legacy tables and remaining legacy functions/triggers/columns untouched until the separately approved Step 3 soak, snapshot, retirement preflight, and retirement SQL.

#### Implemented runtime behavior

The deployed Step 2 build reads and writes only the four canonical policy tables. It resolves inherited/customized policies, inactive overwritten customizations, parent-link reset boundaries, live nested groups, exact RACI/permission separation, Node detach materialization, final-parent creator rules, current My Work, current notification targets, and actor-safe policy fingerprints. Legacy readers are excluded from the deployed build and no fallback, compatibility reader, dual writer, or request-time schema repair was added.

On August 5, 2026, the first post-cutover smoke check exposed a backend-only default-access reader defect: `postgresResourceDefaultAccess` selected a nonexistent `default_access` column from `mangorts_v2_resolve_permission_policy`. The resolver contract returns the effective source identity, so the reader now joins that identity to `resource_permission_settings` and reads the selected source row's `default_access`. A guarded disposable-PostgreSQL assertion exercises this exact runtime reader after cutover. This correction changes no business rule or database object, requires no SQL, and requires only deployment/restart of the corrected backend. The Step 2 readiness result remains valid and all temporary legacy evidence remains untouched.

The same smoke session exposed a separate historical Node final-storage conversion defect in 10 current textboxes: a blank legacy body became a TipTap document with `document.content=[]`, which the backend correctly rejects. This is not a V2 policy failure and does not require rerunning the V2 cutover. The forward-only repair is `backend/db/migrations/20260805_zzzd_repair_empty_node_textbox_documents.sql`; a human operator first runs `scripts/repair_empty_node_textbox_documents_preflight.sql` read-only in DBeaver, reviews `READY_TO_REPAIR`, and then applies the reviewed migration through the normal migration process. It repairs only that exact body in current, history, seen, and Recycle Bin copies, preserves revisions and all relationship/restore metadata, is a no-op on fresh databases and reruns, and leaves the shipped Node cutover plus all Step 2 legacy evidence unchanged. Agents must not apply this SQL to a live database.

The frontend uses only the canonical `/v1/resources/{resource_type}/{resource_id}/gvic` and `/permissions` endpoints. The obsolete Node, Logic Gate, Project, and Company Explorer permission URL shapes are no longer routed. RACI and permission surfaces expose Inherited/Customized mode, effective source, overwritten-customization explanation, inherited-only Apply, separately confirmed overwrite-all, If-Match stale-write protection, and canonical response reconciliation. Selecting Customized without an explicit RACI replacement asks the backend to copy the raw effective source policy once, preserving group pointers; an explicit empty array remains an intentionally empty customization.

#### Verification evidence

The guarded disposable PostgreSQL integration test upgraded a realistic Step 1 fixture through the atomic cutover, exercised inheritance, force reset, move-after-reset protection, Node detach materialization, permission authorization, group cleanup, final/legacy table names, and then reset and created a fresh database from the canonical Step 2 schema. It passed on isolated PostgreSQL 18; the SQL itself accepts supported PostgreSQL 17.x and 18.x and uses no PostgreSQL 18-only requirement.

Focused backend store, HTTP, and notification suites passed. The frontend TypeScript and production build passed. The complete repository verification gate passed after the final diff review and formatting checks.

Fresh databases create the four final policy tables directly in their Step 2 state while retaining the broader legacy objects required only for Step 3 rollback evidence. Step 3 must remove that retained evidence only after soak, restorable snapshot, and a separately reviewed retirement operation.

## Step 3: test, soak, snapshot, and retire old storage

### Goal

Prove the V2 runtime is authoritative, then remove every old policy table, column, trigger, function, code path, test assumption, and migration-only staging object.

### Post-retirement save incident

After the one-transaction retirement script was run on August 5, 2026, the operator reported that RACI and permission edits would not save and that an editable permission dialog could not close while its close-with-save write failed. The same failure reproduced on a freshly recreated local database and produced no backend handler log. Browser evidence identified the shared cause: every V2 policy PUT sends `If-Match` for stale-write protection, but the API CORS allow-list omitted `If-Match`. The browser therefore rejected the preflight before sending either the RACI or permission PUT to Go. The retirement SQL and the four canonical policy tables were not the cause.

The API CORS contract now allows `If-Match`, with a regression assertion in the API preflight test. This restores all canonical RACI and permission write call sites without removing stale-write protection or adding a fallback. Permission dialogs retain the documented close-with-save rule: X, Escape, and modal dismissal save pending editable changes before closing; denied, read-only, unchanged, and already-saved dialogs close without a write; a successful explicit Save prevents a duplicate close write. Focused frontend contract coverage enforces that behavior.

No database repair, legacy-table restoration, migration rerun, or schema change is required. Deploy/restart the corrected backend so browsers receive the updated preflight response; the frontend close behavior ships with the matching frontend build.

### Required verification

1. Run the complete repository gate.
2. Run disposable PostgreSQL integration tests against a fresh schema and a realistic converted schema.
3. Reconcile every V2 effective result with the expected hierarchy rules.
4. Prove no deployed SQL references old tables.
5. Exercise large responsible trees and verify write counts do not grow with descendant count.
6. Complete the agreed soak period.
7. Take and verify the agreed restorable database snapshot.
8. Run a separately reviewed read-only retirement preflight.
9. Run separately approved DBeaver retirement SQL without `CASCADE`.

### Retirement candidates

The final retirement set is expected to include:

```text
resource_gvic_effective_assignments
resource_gvic_policy_revisions
resource_gvic_subtree_applications
resource_permission_policy_revisions
resource_permission_subtree_applications
company_user_group_closure
gvic_matrix_projection_table
resource_policy_sequence
all migration-only V2 staging and legacy-renamed policy tables
old resource default_access columns after exact reader proof
```

Repository inspection during Steps 1-3 may add obsolete policy triggers, functions, indexes, handlers, and helpers to the retirement set. It may not silently add unrelated product tables.

### Step 3 final state

After retirement:

- replaying `backend/db/schema.sql` runs the recorded Step 1 staging construction, Step 2 rename/cutover, and final RACI role block, and ends with only the four final policy tables and two sequences;
- the historical construction remains visible in the canonical schema file, but no staging or legacy policy table remains in the replayed final database state;
- no old reader, writer, fallback, compatibility alias, or dual write remains;
- no permanent effective, projection, closure, revision, or subtree-application table is required for correctness;
- all current behavior is reproducible from the four policy tables, canonical hierarchy, canonical group source tables, and ordinary audit/version infrastructure.

## Required business scenarios and automated tests

The implementation must map these scenarios into `docs/tests/gvic.md`, `docs/tests/permissions.md`, and automated tests during the corresponding behavior-changing step.

### Inheritance scenarios

1. Root customized → child inherited → grandchild inherited: all use root policy.
2. Root customized → child customized → grandchild inherited: child and grandchild use child policy.
3. Ordinary root save changes inherited branches but not the customized child branch.
4. An intentionally empty customized RACI policy blocks inheritance.
5. An intentionally empty customized permission exception set still uses its customized default.
6. A root cannot be inherited.

### Overwrite scenarios

1. Inherited-only Apply performs no descendant policy writes.
2. Inherited-only Apply stops at customized boundaries.
3. Force overwrite invalidates older customized descendants with one parent settings update.
4. Force overwrite reaches descendants beneath an invalidated customized boundary.
5. A later child customization becomes active again.
6. An ordinary parent save after the child re-customizes does not cross that boundary.
7. Nested force overwrites select the greatest eligible reset sequence.
8. A reset never invalidates the resource that owns the reset.

### Create and move scenarios

1. New child defaults to inherited.
2. New root defaults to a valid customized policy.
3. Customizing copies the current effective parent policy once.
4. Returning to inherited removes current customized edges.
5. Moving an inherited resource changes its effective parent immediately.
6. Moving a customized resource preserves its customized policy.
7. A subtree moved after an older force reset is protected by its newer parent-link sequence.
8. A later force reset from the new parent crosses that link.
9. Detaching an inherited Node materializes its current effective policy as customized.
10. Moving a Node between Logic Gates follows inherited/customized mode instead of unconditionally replacing both policies.

### RACI scenarios

1. Responsible, Accountable, Consulted, and Informed each accept multiple users or groups.
2. One direct principal cannot occupy more than one role on the same resource.
3. Overlapping groups resolve one effective user role using Responsible, Accountable, Consulted, Informed priority.
4. Role cards show direct assignee names and wrap long name lists.
5. Group membership changes affect effective users without resource-policy writes.
6. RACI does not grant resource access.
7. My Work includes only resources where the user has both effective RACI and effective Edit permission.

### Permission scenarios

1. Direct user beats group and default.
2. Nearest matching group beats more distant matching groups.
3. Equal-depth `no_access` beats `edit`.
4. Default applies when no direct or group rule matches.
5. Admin bypass and manager non-bypass remain correct.
6. Authorization occurs before HTTP 304.
7. Group changes invalidate permission fingerprints without descendant policy writes.
8. A company manager with Edit access can change peer-manager rules but cannot change company-admin or dev-admin identities.
9. Policies above 1,000 explicit rows are not rejected by a product-specific assignment cap.

### Scale and concurrency scenarios

1. Apply to inherited descendants performs a constant number of policy writes for 1, 100,000, and 10,000,000 modeled descendants.
2. Force overwrite performs a constant number of policy writes regardless of descendant count.
3. Point authorization cost depends on ancestry/rule depth, not descendant count.
4. Concurrent complete-policy writes reject stale expected revisions.
5. Command idempotency prevents repeated force sequences for one retried request.
6. A committed event is never published for a rolled-back policy transaction.
7. My Work pagination is stable under concurrent policy changes.

## Documentation requirements

Step 2 changes business behavior and must update the business-rule files with a distinct Process Story at the top:

- `docs/tests/gvic.md`
- `docs/tests/permissions.md`
- `docs/tests/my-work.md`
- `docs/tests/nodes.md`
- `docs/tests/users-and-user-groups.md`
- any Company Explorer or Shared Triage process document whose inheritance behavior changes

Stale rules saying a Node always snapshots a Logic Gate on entry, a linked Node always uses live gate RACI regardless of mode, or a generic Apply physically replaces every child must be removed rather than preserved as compatibility wording.

## Step 1 worker boundary

The worker assigned Step 1 must:

- read this entire document before inspecting implementation details;
- implement Step 1 only;
- not change runtime readers or writers;
- not drop or retire old storage;
- not apply SQL to a live database;
- provide read-only preflight, additive/restartable copy, exact reconciliation, schema tests, and disposable PostgreSQL integration tests;
- document every discovered source-shape discrepancy instead of guessing;
- commit all intended repository changes on its worker branch;
- stop without merging, pushing, or opening a pull request.
