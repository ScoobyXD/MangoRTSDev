# Resource Access Model

This document is the working contract for MangoRTS resource access. It intentionally stays small: one access-grant table, one hierarchy, and one set of verbs across nodes, Logic Gates, and Shared Triage folders.

## Objective

MangoRTS is built for millions of companies, users, and AI agents, with APIs becoming the primary interface. Permission checks must be boring, indexable, and reusable across UI and headless clients. The default rule is still: keep the simplest solution that lets many engineers and agents work in parallel without inventing competing mechanisms.

## What This Model Controls

Resource access answers: can this principal see, change, or administer this object?

It covers:

- `node`
- `logic_gate`
- `shared_triage_folder`

It does not replace RACI. RACI is responsibility metadata for workflow views like R Nodes, ACIO Nodes, and Logic Gate assignment matrices. RACI should not decide whether a resource exists for a user.

## Access Levels

Access levels are hierarchical:

- `view`: the user can see that the resource exists and read it.
- `edit`: includes `view`; the user can mutate normal content or mail state.
- `admin`: includes `edit`; the user can set access grants and delete/administer the resource.

Company admins and dev admins bypass resource grants. Plain company users and AI agents need grants unless the resource has no grants at all.

The default no-grant rule is deliberately conservative:

- If a resource has no grants, all company users may `view` it.
- `edit` and `admin` still require an explicit grant or admin override.

## Database Shape

The canonical table is `resource_access_grants`:

```sql
(company_id, resource_type, resource_id, principal_type, principal_id) -> access_level
```

`principal_type` is `user` or `group`. Group grants include descendant groups through `company_user_groups.parent_group_id`, so a grant on Supply Chain can cover child groups without copying rows.

The permission check entrypoint is:

```sql
mangorts_user_can_access_resource(company_id, resource_type, resource_id, user_id, access_level)
```

The old `mangorts_user_can_view_entity(...)` wrapper remains for compatibility and delegates to `view`.

## Shared Triage

Shared Triage folder names and tree structure live in `company_explorer_folders` with `folder_kind = 'communications'`. Nylas stores provider mailbox folders and messages; it does not own MangoRTS Shared Triage folder structure.

Shared Triage access uses `resource_access_grants` with `resource_type = 'shared_triage_folder'`.

Folder grants inherit downward for reads from the API response: a child folder includes grants from its ancestor folders unless the child has a direct grant for the same principal. This keeps the UI fast and predictable without duplicating inherited grants in the database.

Mail behavior:

- `view`: list/read Shared Triage mail through the assigned connected account.
- `edit`: archive, unarchive, update, delete, move, rename, or otherwise mutate mail/folder state.
- `admin`: change access grants or delete the Shared Triage folder.

## API Contract

Generic entity permissions:

- `GET /v1/nodes/{id}/permissions?company_id=...`
- `PUT /v1/nodes/{id}/permissions`
- `GET /v1/logic-gates/{id}/permissions?company_id=...`
- `PUT /v1/logic-gates/{id}/permissions`

Shared Triage access:

- `GET /v1/communications/shared-inboxes/{folder_id}/access?company_id=...`
- `PUT /v1/communications/shared-inboxes/{folder_id}/access`

Request grants use this shape:

```json
{
  "company_id": "...",
  "permissions": [
    { "subject_type": "user", "subject_id": "...", "access_level": "edit" },
    { "subject_type": "group", "subject_id": "...", "access_level": "view" }
  ]
}
```

`permission` is accepted as a compatibility alias for `access_level`.

## Developer Rules

Use resource access for existence/read/write/admin checks. Do not add resource-specific permission tables unless a new use case cannot be represented by resource type, principal, and access level.

Keep RACI separate. RACI can drive inboxes and responsibility views, but it should not hide or reveal resources.

Prefer one indexed query or one preloaded grant set. Avoid per-row permission calls in list endpoints when the response already contains grants that can be filtered in memory.

When adding a resource type, update all of these together:

- `NormalizeEntityType`
- database `resource_access_grants_resource_type_chk`
- `postgresEntityExists` and `postgresEntityExistsTx`
- frontend `PermissionEntityType`
- this document

When adding an access level, update all of these together:

- `NormalizeEntityPermission`
- `EntityPermissionRank`
- database `resource_access_grants_access_level_chk`
- `mangorts_access_level_rank`
- frontend access-level selectors
- this document