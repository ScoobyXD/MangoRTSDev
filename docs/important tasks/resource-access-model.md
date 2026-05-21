# Resource Access Model

This is the working contract for MangoRTS resource access: one grant table, one access-level hierarchy, and the same verbs across nodes, Logic Gates, and Shared Triage folders.

## Objective

MangoRTS is built for millions of companies, users, UI elements, backend operations, and future headless AI-agent API callers. Permission checks must be explicit, indexable, cacheable, and reusable. Keep the model simple unless a real use case forces more structure.

## Covered Resources

Resource access answers whether a principal can see, change, or administer an object.

Covered resource types:

- `node`
- `logic_gate`
- `shared_triage_folder`

RACI remains workflow metadata. RACI can drive responsibility views, but it should not decide whether a resource exists for a user.

## Access Levels

Access levels are ordered:

- `no_access`: the user cannot access the resource.
- `view`: the user can see that the resource exists and read it.
- `edit`: includes `view`; the user can mutate normal content or mail state.
- `admin`: includes `edit`; the user can delete/administer the resource.

No grant means no access for plain company users and AI agents. Company admins and dev admins bypass resource grants and keep admin access. For now, only company admins and dev admins can change resource grants.

Direct user grants beat group grants at the same resource. Child Shared Triage folder grants beat inherited parent grants. Between grants at the same specificity, the highest access level wins.

## Database Shape

The canonical table is `resource_access_grants`:

```sql
(company_id, resource_type, resource_id, principal_type, principal_id) -> access_level
```

`principal_type` is `user` or `group`. Group grants include descendant groups through `company_user_groups.parent_group_id`, so a grant on a parent group covers child groups.

The permission check entrypoint is:

```sql
mangorts_user_can_access_resource(company_id, resource_type, resource_id, user_id, access_level)
```

The compatibility wrapper remains:

```sql
mangorts_user_can_view_entity(company_id, entity_type, entity_id, user_id)
```

## Shared Triage

Shared Triage folder names and tree structure live in `company_explorer_folders` with `folder_kind = 'communications'`. Nylas stores provider mailbox folders and messages; it does not own the MangoRTS Shared Triage tree.

Shared Triage access uses `resource_access_grants` with `resource_type = 'shared_triage_folder'`.

Folder grants inherit downward. A child folder can override an inherited parent grant with a direct grant for the same principal. Saving grants on a top-level parent applies that saved grant set to descendants; saving grants on a child stays local and can override the inherited parent behavior for that child.

Mail behavior:

- `no_access`: folder/mail is not accessible.
- `view`: list/read Shared Triage mail through the assigned connected account.
- `edit`: archive, unarchive, update, move, rename, or otherwise mutate mail/folder state.
- `admin`: delete/administer the Shared Triage folder.

If a Shared Triage folder has no assigned account email, the mail list stays blank and shows an assign-email action.

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
    { "subject_type": "group", "subject_id": "...", "access_level": "no_access" }
  ]
}
```

`permission` is accepted as a compatibility alias for `access_level`.

## Developer Rules

Use resource access for read/write/admin checks. Do not add resource-specific permission tables unless a new use case cannot be represented by resource type, principal, and access level.

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