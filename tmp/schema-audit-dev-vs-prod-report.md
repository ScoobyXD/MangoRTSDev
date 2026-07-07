# Schema Inventory Diff

- Status: FAIL
- Expected inventory: `dev` (1232 compared objects)
- Actual inventory: `prod` (1230 compared objects)
- Missing in actual: 9
- Extra in actual: 7
- Different definitions: 92
- Grants compared: no
- schema_migrations compared: no

## Missing In Actual

- `constraint` `public.company_memberships.company_memberships_company_id_fkey`
- `constraint` `public.invitations.invitations_company_id_fkey`
- `constraint` `public.node_logic_gate_assignments.node_logic_gate_assignments_placed_by_user_id_fkey`
- `constraint` `public.node_logic_gate_assignments.node_logic_gate_assignments_requested_by_user_id_fkey`
- `constraint` `public.resource_permissions.resource_access_company_id_fkey`
- `constraint` `public.resource_permissions.resource_access_user_id_fkey`
- `constraint` `public.shared_inboxes.shared_inboxes_company_email_connection_fkey`
- `index` `public.idx_resource_gvic_assignments_one_role_per_principal`
- `index` `public.idx_resource_permissions_resource_user`

## Extra In Actual

- `constraint` `public.node_logic_gate_assignments.node_logic_gate_assignments_company_id_placed_by_user_id_fkey`
- `constraint` `public.node_logic_gate_assignments.node_logic_gate_assignments_company_id_requested_by_user_i_fkey`
- `constraint` `public.project_relationships.project_relationships_company_id_resource_type_resource_id_key`
- `constraint` `public.resource_permissions.resource_permissions_company_id_fkey`
- `constraint` `public.resource_permissions.resource_permissions_user_id_fkey`
- `constraint` `public.shared_inboxes.shared_inboxes_company_id_company_email_connection_id_fkey`
- `index` `public.project_relationships_company_id_resource_type_resource_id_key`

## Different Definitions

### `column` `public.company_explorer_folders.created_by_user_id`

Expected:

```json
{
  "collation": null,
  "column": "created_by_user_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 14,
  "relation": "company_explorer_folders",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "created_by_user_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 7,
  "relation": "company_explorer_folders",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.company_explorer_folders.created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 6,
  "relation": "company_explorer_folders",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "company_explorer_folders",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.company_explorer_folders.default_access`

Expected:

```json
{
  "collation": null,
  "column": "default_access",
  "data_type": "text",
  "default": "'edit'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 11,
  "relation": "company_explorer_folders",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "default_access",
  "data_type": "text",
  "default": "'edit'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 5,
  "relation": "company_explorer_folders",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.company_explorer_folders.name`

Expected:

```json
{
  "collation": null,
  "column": "name",
  "data_type": "text",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 5,
  "relation": "company_explorer_folders",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "name",
  "data_type": "text",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 4,
  "relation": "company_explorer_folders",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.company_explorer_folders.position`

Expected:

```json
{
  "collation": null,
  "column": "position",
  "data_type": "integer",
  "default": "1000",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "company_explorer_folders",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "position",
  "data_type": "integer",
  "default": "1000",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 6,
  "relation": "company_explorer_folders",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.company_explorer_folders.updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 7,
  "relation": "company_explorer_folders",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 9,
  "relation": "company_explorer_folders",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.company_memberships.role`

Expected:

```json
{
  "collation": null,
  "column": "role",
  "data_type": "text",
  "default": "'member'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 3,
  "relation": "company_memberships",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "role",
  "data_type": "text",
  "default": "'company_user'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 3,
  "relation": "company_memberships",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.company_projection_sequences.projection_scope`

Expected:

```json
{
  "collation": null,
  "column": "projection_scope",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 5,
  "relation": "company_projection_sequences",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "projection_scope",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 3,
  "relation": "company_projection_sequences",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.company_projection_sequences.sequence`

Expected:

```json
{
  "collation": null,
  "column": "sequence",
  "data_type": "bigint",
  "default": "0",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 3,
  "relation": "company_projection_sequences",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "sequence",
  "data_type": "bigint",
  "default": "0",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 4,
  "relation": "company_projection_sequences",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.company_projection_sequences.updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 4,
  "relation": "company_projection_sequences",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 5,
  "relation": "company_projection_sequences",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.invitations.accepted_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "accepted_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 10,
  "relation": "invitations",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "accepted_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 15,
  "relation": "invitations",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.invitations.cognito_error`

Expected:

```json
{
  "collation": null,
  "column": "cognito_error",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 14,
  "relation": "invitations",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "cognito_error",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 10,
  "relation": "invitations",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.invitations.cognito_status`

Expected:

```json
{
  "collation": null,
  "column": "cognito_status",
  "data_type": "text",
  "default": "'not_started'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 13,
  "relation": "invitations",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "cognito_status",
  "data_type": "text",
  "default": "'not_started'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 9,
  "relation": "invitations",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.invitations.created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 11,
  "relation": "invitations",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 16,
  "relation": "invitations",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.invitations.expires_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "expires_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 9,
  "relation": "invitations",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "expires_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 14,
  "relation": "invitations",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.invitations.invite_email_error`

Expected:

```json
{
  "collation": null,
  "column": "invite_email_error",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 16,
  "relation": "invitations",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "invite_email_error",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 12,
  "relation": "invitations",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.invitations.invite_email_sent_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "invite_email_sent_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 17,
  "relation": "invitations",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "invite_email_sent_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 13,
  "relation": "invitations",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.invitations.invite_email_status`

Expected:

```json
{
  "collation": null,
  "column": "invite_email_status",
  "data_type": "text",
  "default": "'not_started'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 15,
  "relation": "invitations",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "invite_email_status",
  "data_type": "text",
  "default": "'not_started'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 11,
  "relation": "invitations",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.invitations.updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 12,
  "relation": "invitations",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 17,
  "relation": "invitations",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.kanban_board_projection.assignment_created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "assignment_created_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 15,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "assignment_created_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 14,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.kanban_board_projection.assignment_id`

Expected:

```json
{
  "collation": null,
  "column": "assignment_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 14,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "assignment_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 13,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.kanban_board_projection.assignment_updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "assignment_updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 16,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "assignment_updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 15,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.kanban_board_projection.compatibility_board_id`

Expected:

```json
{
  "collation": null,
  "column": "compatibility_board_id",
  "data_type": "text",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 17,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "compatibility_board_id",
  "data_type": "text",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 16,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.kanban_board_projection.compatibility_card_id`

Expected:

```json
{
  "collation": null,
  "column": "compatibility_card_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 18,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "compatibility_card_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 17,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.kanban_board_projection.due_date`

Expected:

```json
{
  "collation": null,
  "column": "due_date",
  "data_type": "date",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 11,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "due_date",
  "data_type": "date",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 10,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.kanban_board_projection.is_issue`

Expected:

```json
{
  "collation": null,
  "column": "is_issue",
  "data_type": "boolean",
  "default": "false",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 10,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "is_issue",
  "data_type": "boolean",
  "default": "false",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 9,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.kanban_board_projection.node_created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "node_created_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 12,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "node_created_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 11,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.kanban_board_projection.node_updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "node_updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 13,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "node_updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 12,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.kanban_board_projection.placed_by_user_id`

Expected:

```json
{
  "collation": null,
  "column": "placed_by_user_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 22,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "placed_by_user_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 19,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.kanban_board_projection.priority`

Expected:

```json
{
  "collation": null,
  "column": "priority",
  "data_type": "smallint",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 9,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "priority",
  "data_type": "smallint",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 8,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.kanban_board_projection.projection_updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "projection_updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 19,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "projection_updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 21,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.kanban_board_projection.requested_by_user_id`

Expected:

```json
{
  "collation": null,
  "column": "requested_by_user_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 21,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "requested_by_user_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 18,
  "relation": "kanban_board_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.logic_gates.created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 4,
  "relation": "logic_gates",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 5,
  "relation": "logic_gates",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.logic_gates.default_access`

Expected:

```json
{
  "collation": null,
  "column": "default_access",
  "data_type": "text",
  "default": "'edit'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 5,
  "relation": "logic_gates",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "default_access",
  "data_type": "text",
  "default": "'edit'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 4,
  "relation": "logic_gates",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.node_logic_gate_assignments.created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 12,
  "relation": "node_logic_gate_assignments",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 14,
  "relation": "node_logic_gate_assignments",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.node_logic_gate_assignments.placed_by_user_id`

Expected:

```json
{
  "collation": null,
  "column": "placed_by_user_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 15,
  "relation": "node_logic_gate_assignments",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "placed_by_user_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 12,
  "relation": "node_logic_gate_assignments",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.node_logic_gate_assignments.requested_by_user_id`

Expected:

```json
{
  "collation": null,
  "column": "requested_by_user_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 14,
  "relation": "node_logic_gate_assignments",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "requested_by_user_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 11,
  "relation": "node_logic_gate_assignments",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.node_logic_gate_assignments.updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 13,
  "relation": "node_logic_gate_assignments",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 15,
  "relation": "node_logic_gate_assignments",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.node_logic_gate_assignments.version`

Expected:

```json
{
  "collation": null,
  "column": "version",
  "data_type": "bigint",
  "default": "1",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 11,
  "relation": "node_logic_gate_assignments",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "version",
  "data_type": "bigint",
  "default": "1",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 13,
  "relation": "node_logic_gate_assignments",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.nodes.created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 4,
  "relation": "nodes",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "nodes",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.nodes.default_access`

Expected:

```json
{
  "collation": null,
  "column": "default_access",
  "data_type": "text",
  "default": "'edit'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 10,
  "relation": "nodes",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "default_access",
  "data_type": "text",
  "default": "'edit'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 7,
  "relation": "nodes",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.nodes.status`

Expected:

```json
{
  "collation": null,
  "column": "status",
  "data_type": "text",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 8,
  "relation": "nodes",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "status",
  "data_type": "text",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 4,
  "relation": "nodes",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.notifications.created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 12,
  "relation": "notifications",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 17,
  "relation": "notifications",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.notifications.information_id`

Expected:

```json
{
  "collation": null,
  "column": "information_id",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 17,
  "relation": "notifications",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "information_id",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 15,
  "relation": "notifications",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.notifications.logic_gate_id`

Expected:

```json
{
  "collation": null,
  "column": "logic_gate_id",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 15,
  "relation": "notifications",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "logic_gate_id",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 13,
  "relation": "notifications",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.notifications.node_id`

Expected:

```json
{
  "collation": null,
  "column": "node_id",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 16,
  "relation": "notifications",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "node_id",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 14,
  "relation": "notifications",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.notifications.read_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "read_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 11,
  "relation": "notifications",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "read_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 16,
  "relation": "notifications",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.notifications.role`

Expected:

```json
{
  "collation": null,
  "column": "role",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 14,
  "relation": "notifications",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "role",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 12,
  "relation": "notifications",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.notifications.surface`

Expected:

```json
{
  "collation": null,
  "column": "surface",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 13,
  "relation": "notifications",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "surface",
  "data_type": "text",
  "default": "''::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 11,
  "relation": "notifications",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.project_management_timeline_projection.accounts`

Expected:

```json
{
  "collation": null,
  "column": "accounts",
  "data_type": "jsonb",
  "default": "'[]'::jsonb",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 24,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "accounts",
  "data_type": "jsonb",
  "default": "'[]'::jsonb",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 20,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.project_management_timeline_projection.due_date`

Expected:

```json
{
  "collation": null,
  "column": "due_date",
  "data_type": "date",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 11,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "due_date",
  "data_type": "date",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 10,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.project_management_timeline_projection.duration_days`

Expected:

```json
{
  "collation": null,
  "column": "duration_days",
  "data_type": "smallint",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 18,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "duration_days",
  "data_type": "smallint",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 14,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.project_management_timeline_projection.end_date`

Expected:

```json
{
  "collation": null,
  "column": "end_date",
  "data_type": "date",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 17,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "end_date",
  "data_type": "date",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 13,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.project_management_timeline_projection.position`

Expected:

```json
{
  "collation": null,
  "column": "position",
  "data_type": "integer",
  "default": "0",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 19,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "position",
  "data_type": "integer",
  "default": "0",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 15,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.project_management_timeline_projection.priority`

Expected:

```json
{
  "collation": null,
  "column": "priority",
  "data_type": "smallint",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 12,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "priority",
  "data_type": "smallint",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 11,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.project_management_timeline_projection.projection_updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "projection_updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 23,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "projection_updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 19,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.project_management_timeline_projection.resource_created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "resource_created_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 20,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "resource_created_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 16,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.project_management_timeline_projection.start_date`

Expected:

```json
{
  "collation": null,
  "column": "start_date",
  "data_type": "date",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 16,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "start_date",
  "data_type": "date",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 12,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.project_management_timeline_projection.timeline_created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "timeline_created_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 21,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "timeline_created_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 17,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.project_management_timeline_projection.timeline_updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "timeline_updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 22,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "timeline_updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 18,
  "relation": "project_management_timeline_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.project_relationship_projection.assignment_id`

Expected:

```json
{
  "collation": null,
  "column": "assignment_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 16,
  "relation": "project_relationship_projection",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "assignment_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 8,
  "relation": "project_relationship_projection",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.project_relationship_projection.display_title`

Expected:

```json
{
  "collation": null,
  "column": "display_title",
  "data_type": "text",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "project_relationship_projection",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "display_title",
  "data_type": "text",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 9,
  "relation": "project_relationship_projection",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.project_relationship_projection.status`

Expected:

```json
{
  "collation": null,
  "column": "status",
  "data_type": "text",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 9,
  "relation": "project_relationship_projection",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "status",
  "data_type": "text",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 10,
  "relation": "project_relationship_projection",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.projects.created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "projects",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 6,
  "relation": "projects",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.projects.default_access`

Expected:

```json
{
  "collation": null,
  "column": "default_access",
  "data_type": "text",
  "default": "'edit'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 7,
  "relation": "projects",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "default_access",
  "data_type": "text",
  "default": "'edit'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 5,
  "relation": "projects",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.projects.health`

Expected:

```json
{
  "collation": null,
  "column": "health",
  "data_type": "text",
  "default": "'On Track'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 10,
  "relation": "projects",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "health",
  "data_type": "text",
  "default": "'On Track'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "projects",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.projects.updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 9,
  "relation": "projects",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 7,
  "relation": "projects",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.resource_permissions.access_level`

Expected:

```json
{
  "collation": null,
  "column": "access_level",
  "data_type": "text",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 9,
  "relation": "resource_permissions",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "access_level",
  "data_type": "text",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 7,
  "relation": "resource_permissions",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.resource_permissions.created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 5,
  "relation": "resource_permissions",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "resource_permissions",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.resource_permissions.subject_id`

Expected:

```json
{
  "collation": null,
  "column": "subject_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "resource_permissions",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "subject_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 5,
  "relation": "resource_permissions",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.resource_permissions.subject_type`

Expected:

```json
{
  "collation": null,
  "column": "subject_type",
  "data_type": "text",
  "default": "'user'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 7,
  "relation": "resource_permissions",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "subject_type",
  "data_type": "text",
  "default": "'user'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 4,
  "relation": "resource_permissions",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.resource_permissions.updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 6,
  "relation": "resource_permissions",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 9,
  "relation": "resource_permissions",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.resource_permissions.user_id`

Expected:

```json
{
  "collation": null,
  "column": "user_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 4,
  "relation": "resource_permissions",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "user_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 6,
  "relation": "resource_permissions",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.saved_views.created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 9,
  "relation": "saved_views",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 10,
  "relation": "saved_views",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.saved_views.position`

Expected:

```json
{
  "collation": null,
  "column": "position",
  "data_type": "integer",
  "default": "0",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "saved_views",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "position",
  "data_type": "integer",
  "default": "0",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 9,
  "relation": "saved_views",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.saved_views.settings`

Expected:

```json
{
  "collation": null,
  "column": "settings",
  "data_type": "jsonb",
  "default": "'{}'::jsonb",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 11,
  "relation": "saved_views",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "settings",
  "data_type": "jsonb",
  "default": "'{}'::jsonb",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "saved_views",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.saved_views.updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 10,
  "relation": "saved_views",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 11,
  "relation": "saved_views",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.shared_inboxes.company_email_connection_id`

Expected:

```json
{
  "collation": null,
  "column": "company_email_connection_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 10,
  "relation": "shared_inboxes",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "company_email_connection_id",
  "data_type": "uuid",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": false,
  "ordinal_position": 6,
  "relation": "shared_inboxes",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.shared_inboxes.created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "shared_inboxes",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 9,
  "relation": "shared_inboxes",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.shared_inboxes.default_access`

Expected:

```json
{
  "collation": null,
  "column": "default_access",
  "data_type": "text",
  "default": "'edit'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 6,
  "relation": "shared_inboxes",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "default_access",
  "data_type": "text",
  "default": "'edit'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 7,
  "relation": "shared_inboxes",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.shared_inboxes.position`

Expected:

```json
{
  "collation": null,
  "column": "position",
  "data_type": "integer",
  "default": "0",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 7,
  "relation": "shared_inboxes",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "position",
  "data_type": "integer",
  "default": "0",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "shared_inboxes",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.shared_inboxes.updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 9,
  "relation": "shared_inboxes",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 10,
  "relation": "shared_inboxes",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.users.created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 4,
  "relation": "users",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 5,
  "relation": "users",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.users.display_name`

Expected:

```json
{
  "collation": null,
  "column": "display_name",
  "data_type": "text",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 6,
  "relation": "users",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "display_name",
  "data_type": "text",
  "default": null,
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 4,
  "relation": "users",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.users.updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 5,
  "relation": "users",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 6,
  "relation": "users",
  "schema": "public",
  "storage": "p"
}
```

### `constraint` `public.logic_gate_information.logic_gate_information_nonblank_chk`

Expected:

```json
{
  "constraint_type": "check",
  "deferrable": false,
  "definition": "CHECK ((btrim(information) <> ''::text)) NOT VALID",
  "initially_deferred": false,
  "name": "logic_gate_information_nonblank_chk",
  "relation": "public.logic_gate_information",
  "type": null,
  "validated": false
}
```

Actual:

```json
{
  "constraint_type": "check",
  "deferrable": false,
  "definition": "CHECK ((btrim(information) <> ''::text))",
  "initially_deferred": false,
  "name": "logic_gate_information_nonblank_chk",
  "relation": "public.logic_gate_information",
  "type": null,
  "validated": true
}
```

### `constraint` `public.logic_gate_relationships.logic_gate_relationships_not_self_chk`

Expected:

```json
{
  "constraint_type": "check",
  "deferrable": false,
  "definition": "CHECK ((logic_gate_id_a <> logic_gate_id_b)) NOT VALID",
  "initially_deferred": false,
  "name": "logic_gate_relationships_not_self_chk",
  "relation": "public.logic_gate_relationships",
  "type": null,
  "validated": false
}
```

Actual:

```json
{
  "constraint_type": "check",
  "deferrable": false,
  "definition": "CHECK ((logic_gate_id_a <> logic_gate_id_b))",
  "initially_deferred": false,
  "name": "logic_gate_relationships_not_self_chk",
  "relation": "public.logic_gate_relationships",
  "type": null,
  "validated": true
}
```

### `constraint` `public.logic_gate_relationships.logic_gate_relationships_position_pair_chk`

Expected:

```json
{
  "constraint_type": "check",
  "deferrable": false,
  "definition": "CHECK ((((a_position = 'Input'::logic_gate_relationship_position) AND (b_position = 'Output'::logic_gate_relationship_position)) OR ((a_position = 'Output'::logic_gate_relationship_position) AND (b_position = 'Input'::logic_gate_relationship_position)))) NOT VALID",
  "initially_deferred": false,
  "name": "logic_gate_relationships_position_pair_chk",
  "relation": "public.logic_gate_relationships",
  "type": null,
  "validated": false
}
```

Actual:

```json
{
  "constraint_type": "check",
  "deferrable": false,
  "definition": "CHECK ((((a_position = 'Input'::logic_gate_relationship_position) AND (b_position = 'Output'::logic_gate_relationship_position)) OR ((a_position = 'Output'::logic_gate_relationship_position) AND (b_position = 'Input'::logic_gate_relationship_position))))",
  "initially_deferred": false,
  "name": "logic_gate_relationships_position_pair_chk",
  "relation": "public.logic_gate_relationships",
  "type": null,
  "validated": true
}
```

### `constraint` `public.node_information.node_information_nonblank_chk`

Expected:

```json
{
  "constraint_type": "check",
  "deferrable": false,
  "definition": "CHECK ((btrim(information) <> ''::text)) NOT VALID",
  "initially_deferred": false,
  "name": "node_information_nonblank_chk",
  "relation": "public.node_information",
  "type": null,
  "validated": false
}
```

Actual:

```json
{
  "constraint_type": "check",
  "deferrable": false,
  "definition": "CHECK ((btrim(information) <> ''::text))",
  "initially_deferred": false,
  "name": "node_information_nonblank_chk",
  "relation": "public.node_information",
  "type": null,
  "validated": true
}
```

### `constraint` `public.node_projection_table.node_projection_table_nonblank_chk`

Expected:

```json
{
  "constraint_type": "check",
  "deferrable": false,
  "definition": "CHECK ((btrim(information) <> ''::text)) NOT VALID",
  "initially_deferred": false,
  "name": "node_projection_table_nonblank_chk",
  "relation": "public.node_projection_table",
  "type": null,
  "validated": false
}
```

Actual:

```json
{
  "constraint_type": "check",
  "deferrable": false,
  "definition": "CHECK ((btrim(information) <> ''::text))",
  "initially_deferred": false,
  "name": "node_projection_table_nonblank_chk",
  "relation": "public.node_projection_table",
  "type": null,
  "validated": true
}
```

### `function` `public.workspace_read_version_keys_for_domain_event(p_event_type text, p_payload jsonb)`

Expected:

```json
{
  "arguments": "p_event_type text, p_payload jsonb",
  "definition": "CREATE OR REPLACE FUNCTION public.workspace_read_version_keys_for_domain_event(p_event_type text, p_payload jsonb)\n RETURNS TABLE(scope text, resource_key text)\n LANGUAGE plpgsql\n IMMUTABLE\nAS $function$\r\ndeclare\r\n  board_id text := btrim(coalesce(p_payload->>'board_id', ''));\r\n  folder_kind text := btrim(coalesce(p_payload->>'folder_kind', ''));\r\n  item_type text := btrim(coalesce(p_payload->>'item_type', ''));\r\nbegin\r\n  return query select v.scope, v.resource_key from (values\r\n    ('workspace-snapshot:full', '')\r\n  ) as v(scope, resource_key);\r\n\r\n  if p_event_type = any(array[\r\n    'node_created',\r\n    'node_updated',\r\n    'node_deleted',\r\n    'kanban_card_upserted',\r\n    'kanban_card_moved',\r\n    'kanban_card_deleted',\r\n    'work_item.logic_gate_assignment_saved',\r\n    'work_item.logic_gate_assignment_moved',\r\n    'work_item.logic_gate_assignment_removed',\r\n    'work_item.logic_gate_issue_toggled',\r\n    'kanban_column_deleted',\r\n    'kanban_board_deleted',\r\n    'node_permissions_updated'\r\n  ]::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('nodes', ''),\r\n      ('workspace-snapshot:node_map', ''),\r\n      ('workspace-snapshot:node_map_window', ''),\r\n      ('workspace-snapshot:company_explorer', ''),\r\n      ('workspace-snapshot:company_explorer', 'folder_kind:node')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = any(array['node_deleted', 'node_permissions_updated']::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('company-explorer-folder-items', ''),\r\n      ('company-explorer-folder-items', 'item_type:node')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = any(array['relationship_created', 'relationship_deleted', 'node_deleted']::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('node-relationships', ''),\r\n      ('workspace-snapshot:node_map', ''),\r\n      ('workspace-snapshot:node_map_window', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = 'node_map_positions_updated' then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('map-layout:node', ''),\r\n      ('map-layout:node-window', ''),\r\n      ('workspace-snapshot:node_map', ''),\r\n      ('workspace-snapshot:node_map_window', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = 'node_deleted' then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('map-layout:node', ''),\r\n      ('map-layout:node-window', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = any(array['logic_gate_created', 'logic_gate_updated', 'logic_gate_deleted', 'logic_gate_raci_updated', 'logic_gate_permissions_updated']::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('logic-gates', ''),\r\n      ('workspace-snapshot:logic_gate_map', ''),\r\n      ('workspace-snapshot:logic_gate_map_window', ''),\r\n      ('workspace-snapshot:company_explorer', ''),\r\n      ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = any(array['logic_gate_deleted', 'logic_gate_permissions_updated']::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('company-explorer-folder-items', ''),\r\n      ('company-explorer-folder-items', 'item_type:logic_gate')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = any(array[\r\n    'project_created',\r\n    'project_updated',\r\n    'project_deleted',\r\n    'project_information_created',\r\n    'project_information_deleted',\r\n    'project_relationship_upserted',\r\n    'project_relationship_deleted',\r\n    'project_permissions_updated'\r\n  ]::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('projects', ''),\r\n      ('workspace-snapshot:company_explorer', ''),\r\n      ('workspace-snapshot:company_explorer', 'folder_kind:project')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = any(array['project_deleted', 'project_permissions_updated']::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('company-explorer-folder-items', ''),\r\n      ('company-explorer-folder-items', 'item_type:project')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = any(array['logic_gate_relationship_created', 'logic_gate_relationship_deleted', 'logic_gate_deleted']::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('logic-gate-relationships', ''),\r\n      ('workspace-snapshot:logic_gate_map', ''),\r\n      ('workspace-snapshot:logic_gate_map_window', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = 'logic_gate_map_positions_updated' then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('map-layout:logic_gate', ''),\r\n      ('map-layout:logic_gate-window', ''),\r\n      ('workspace-snapshot:logic_gate_map', ''),\r\n      ('workspace-snapshot:logic_gate_map_window', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = 'logic_gate_deleted' then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('map-layout:logic_gate', ''),\r\n      ('map-layout:logic_gate-window', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = any(array[\r\n    'company_explorer_folder_created',\r\n    'company_explorer_folder_updated',\r\n    'company_explorer_folder_deleted',\r\n    'communications_shared_inbox_raci_updated',\r\n    'shared_triage_access_updated'\r\n  ]::text[]) then\r\n    if folder_kind = 'node' then\r\n      return query select v.scope, v.resource_key from (values\r\n        ('workspace-snapshot:node_map', ''),\r\n        ('workspace-snapshot:node_map_window', ''),\r\n        ('map-layout:node-window', ''),\r\n        ('workspace-snapshot:company_explorer', ''),\r\n        ('workspace-snapshot:company_explorer', 'folder_kind:node'),\r\n        ('company-explorer-folder-items', ''),\r\n        ('company-explorer-folder-items', 'item_type:node')\r\n      ) as v(scope, resource_key);\r\n    elsif folder_kind = 'logic_gate' then\r\n      return query select v.scope, v.resource_key from (values\r\n        ('workspace-snapshot:logic_gate_map', ''),\r\n        ('workspace-snapshot:logic_gate_map_window', ''),\r\n        ('map-layout:logic_gate-window', ''),\r\n        ('workspace-snapshot:company_explorer', ''),\r\n        ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate'),\r\n        ('company-explorer-folder-items', ''),\r\n        ('company-explorer-folder-items', 'item_type:logic_gate')\r\n      ) as v(scope, resource_key);\r\n    elsif folder_kind = 'project' then\r\n      return query select v.scope, v.resource_key from (values\r\n        ('workspace-snapshot:company_explorer', ''),\r\n        ('workspace-snapshot:company_explorer', 'folder_kind:project'),\r\n        ('company-explorer-folder-items', ''),\r\n        ('company-explorer-folder-items', 'item_type:project')\r\n      ) as v(scope, resource_key);\r\n    elsif folder_kind = 'communications' then\r\n      return query select v.scope, v.resource_key from (values\r\n        ('workspace-snapshot:company_explorer', 'folder_kind:communications')\r\n      ) as v(scope, resource_key);\r\n    end if;\r\n  end if;\r\n\r\n  if p_event_type = any(array['company_explorer_folder_item_assigned', 'company_explorer_folder_item_removed']::text[]) then\r\n    if item_type = 'node' then\r\n      return query select v.scope, v.resource_key from (values\r\n        ('workspace-snapshot:node_map', ''),\r\n        ('workspace-snapshot:node_map_window', ''),\r\n        ('map-layout:node-window', ''),\r\n        ('workspace-snapshot:company_explorer', ''),\r\n        ('workspace-snapshot:company_explorer', 'folder_kind:node'),\r\n        ('company-explorer-folder-items', ''),\r\n        ('company-explorer-folder-items', 'item_type:node')\r\n      ) as v(scope, resource_key);\r\n    elsif item_type = 'logic_gate' then\r\n      return query select v.scope, v.resource_key from (values\r\n        ('workspace-snapshot:logic_gate_map', ''),\r\n        ('workspace-snapshot:logic_gate_map_window', ''),\r\n        ('map-layout:logic_gate-window', ''),\r\n        ('workspace-snapshot:company_explorer', ''),\r\n        ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate'),\r\n        ('company-explorer-folder-items', ''),\r\n        ('company-explorer-folder-items', 'item_type:logic_gate')\r\n      ) as v(scope, resource_key);\r\n    elsif item_type = 'project' then\r\n      return query select v.scope, v.resource_key from (values\r\n        ('workspace-snapshot:company_explorer', ''),\r\n        ('workspace-snapshot:company_explorer', 'folder_kind:project'),\r\n        ('company-explorer-folder-items', ''),\r\n        ('company-explorer-folder-items', 'item_type:project')\r\n      ) as v(scope, resource_key);\r\n    end if;\r\n  end if;\r\n\r\n  if p_event_type = any(array['kanban_board_saved', 'kanban_board_updated', 'kanban_board_deleted', 'logic_gate_deleted']::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('kanban-boards', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if board_id <> '' and p_event_type = any(array[\r\n    'kanban_column_created',\r\n    'kanban_column_updated',\r\n    'kanban_column_deleted',\r\n    'kanban_board_deleted',\r\n    'logic_gate_deleted'\r\n  ]::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('kanban-columns', 'board_id:' || board_id),\r\n      ('workspace-snapshot:kanban', 'board_id:' || board_id)\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if board_id <> '' and p_event_type = any(array[\r\n    'kanban_card_upserted',\r\n    'kanban_card_moved',\r\n    'kanban_card_deleted',\r\n    'work_item.logic_gate_assignment_saved',\r\n    'work_item.logic_gate_assignment_moved',\r\n    'work_item.logic_gate_assignment_removed',\r\n    'work_item.logic_gate_issue_toggled',\r\n    'kanban_column_deleted',\r\n    'kanban_board_deleted',\r\n    'node_deleted',\r\n    'logic_gate_deleted'\r\n  ]::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('kanban-cards', 'board_id:' || board_id),\r\n      ('workspace-snapshot:kanban', 'board_id:' || board_id)\r\n    ) as v(scope, resource_key);\r\n  end if;\r\nend;\r\n$function$\n",
  "identity_arguments": "p_event_type text, p_payload jsonb",
  "kind": "function",
  "language": "plpgsql",
  "name": "workspace_read_version_keys_for_domain_event",
  "parallel": "u",
  "result_type": "TABLE(scope text, resource_key text)",
  "schema": "public",
  "security_definer": false,
  "strict": false,
  "volatility": "immutable"
}
```

Actual:

```json
{
  "arguments": "p_event_type text, p_payload jsonb",
  "definition": "CREATE OR REPLACE FUNCTION public.workspace_read_version_keys_for_domain_event(p_event_type text, p_payload jsonb)\n RETURNS TABLE(scope text, resource_key text)\n LANGUAGE plpgsql\n IMMUTABLE\nAS $function$\r\ndeclare\r\n  board_id text := btrim(coalesce(p_payload->>'board_id', ''));\r\nbegin\r\n  return query select v.scope, v.resource_key from (values\r\n    ('workspace-snapshot:full', '')\r\n  ) as v(scope, resource_key);\r\n\r\n  if p_event_type = any(array[\r\n    'node_created',\r\n    'node_updated',\r\n    'node_deleted',\r\n    'kanban_card_upserted',\r\n    'kanban_card_moved',\r\n    'kanban_card_deleted',\r\n    'work_item.logic_gate_assignment_saved',\r\n    'work_item.logic_gate_assignment_moved',\r\n    'work_item.logic_gate_assignment_removed',\r\n    'work_item.logic_gate_issue_toggled',\r\n    'kanban_column_deleted',\r\n    'kanban_board_deleted',\r\n    'node_permissions_updated'\r\n  ]::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('nodes', ''),\r\n      ('workspace-snapshot:node_map', ''),\r\n      ('workspace-snapshot:node_map_window', ''),\r\n      ('workspace-snapshot:company_explorer', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = any(array['relationship_created', 'relationship_deleted', 'node_deleted']::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('node-relationships', ''),\r\n      ('workspace-snapshot:node_map', ''),\r\n      ('workspace-snapshot:node_map_window', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = 'node_map_positions_updated' then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('map-layout:node', ''),\r\n      ('map-layout:node-window', ''),\r\n      ('workspace-snapshot:node_map', ''),\r\n      ('workspace-snapshot:node_map_window', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = 'node_deleted' then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('map-layout:node', ''),\r\n      ('map-layout:node-window', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = any(array['logic_gate_created', 'logic_gate_updated', 'logic_gate_deleted', 'logic_gate_gvic_updated', 'logic_gate_permissions_updated']::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('logic-gates', ''),\r\n      ('workspace-snapshot:logic_gate_map', ''),\r\n      ('workspace-snapshot:logic_gate_map_window', ''),\r\n      ('workspace-snapshot:company_explorer', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = any(array['logic_gate_relationship_created', 'logic_gate_relationship_deleted', 'logic_gate_deleted']::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('logic-gate-relationships', ''),\r\n      ('workspace-snapshot:logic_gate_map', ''),\r\n      ('workspace-snapshot:logic_gate_map_window', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = 'logic_gate_map_positions_updated' then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('map-layout:logic_gate', ''),\r\n      ('map-layout:logic_gate-window', ''),\r\n      ('workspace-snapshot:logic_gate_map', ''),\r\n      ('workspace-snapshot:logic_gate_map_window', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = 'logic_gate_deleted' then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('map-layout:logic_gate', ''),\r\n      ('map-layout:logic_gate-window', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = any(array[\r\n    'project_created',\r\n    'project_updated',\r\n    'project_deleted',\r\n    'project_information_created',\r\n    'project_information_deleted',\r\n    'project_relationship_upserted',\r\n    'project_relationship_deleted',\r\n    'project_permissions_updated'\r\n  ]::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('projects', ''),\r\n      ('workspace-snapshot:company_explorer', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = any(array[\r\n    'company_explorer_folder_created',\r\n    'company_explorer_folder_updated',\r\n    'company_explorer_folder_deleted',\r\n    'company_explorer_folder_permissions_updated',\r\n    'company_explorer_item_placed',\r\n    'company_explorer_item_removed'\r\n  ]::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('workspace-snapshot:company_explorer', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = any(array['communications_shared_inbox_gvic_updated', 'shared_triage_access_updated']::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('workspace-snapshot:shared_triage', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if p_event_type = any(array['kanban_board_saved', 'kanban_board_updated', 'kanban_board_deleted', 'logic_gate_deleted']::text[]) then\r\n    return query select v.scope, v.resource_key from (values\r\n      ('kanban-boards', '')\r\n    ) as v(scope, resource_key);\r\n  end if;\r\n\r\n  if board_id <> '' and p_event_type = any(array[\r\n    'kanban_column_created',\r\n    'kanban_column_updated',\r\n    'kanban_column_deleted',\r\n    'kanban_card_upserted',\r\n    'kanban_card_moved',\r\n    'kanban_card_deleted'\r\n  ]::text[]) then\r\n    return query select 'kanban-board'::text, board_id;\r\n  end if;\r\nend;\r\n$function$\n",
  "identity_arguments": "p_event_type text, p_payload jsonb",
  "kind": "function",
  "language": "plpgsql",
  "name": "workspace_read_version_keys_for_domain_event",
  "parallel": "u",
  "result_type": "TABLE(scope text, resource_key text)",
  "schema": "public",
  "security_definer": false,
  "strict": false,
  "volatility": "immutable"
}
```

### `function` `public.workspace_static_read_version_keys()`

Expected:

```json
{
  "arguments": "",
  "definition": "CREATE OR REPLACE FUNCTION public.workspace_static_read_version_keys()\n RETURNS TABLE(scope text, resource_key text)\n LANGUAGE sql\n IMMUTABLE\nAS $function$\r\n  select *\r\n  from (values\r\n    ('workspace-snapshot:full', ''),\r\n    ('workspace-snapshot:node_map', ''),\r\n    ('workspace-snapshot:node_map_window', ''),\r\n    ('workspace-snapshot:logic_gate_map', ''),\r\n    ('workspace-snapshot:logic_gate_map_window', ''),\r\n    ('workspace-snapshot:company_explorer', ''),\r\n    ('workspace-snapshot:company_explorer', 'folder_kind:node'),\r\n    ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate'),\r\n    ('workspace-snapshot:company_explorer', 'folder_kind:communications'),\r\n    ('company-explorer-folder-items', ''),\r\n    ('company-explorer-folder-items', 'item_type:node'),\r\n    ('company-explorer-folder-items', 'item_type:logic_gate'),\r\n    ('nodes', ''),\r\n    ('node-relationships', ''),\r\n    ('logic-gates', ''),\r\n    ('logic-gate-relationships', ''),\r\n    ('map-layout:node', ''),\r\n    ('map-layout:node-window', ''),\r\n    ('map-layout:logic_gate', ''),\r\n    ('map-layout:logic_gate-window', ''),\r\n    ('kanban-boards', '')\r\n  ) as keys(scope, resource_key)\r\n$function$\n",
  "identity_arguments": "",
  "kind": "function",
  "language": "sql",
  "name": "workspace_static_read_version_keys",
  "parallel": "u",
  "result_type": "TABLE(scope text, resource_key text)",
  "schema": "public",
  "security_definer": false,
  "strict": false,
  "volatility": "immutable"
}
```

Actual:

```json
{
  "arguments": "",
  "definition": "CREATE OR REPLACE FUNCTION public.workspace_static_read_version_keys()\n RETURNS TABLE(scope text, resource_key text)\n LANGUAGE sql\n IMMUTABLE\nAS $function$\r\n  select *\r\n  from (values\r\n    ('workspace-snapshot:full', ''),\r\n    ('workspace-snapshot:node_map', ''),\r\n    ('workspace-snapshot:node_map_window', ''),\r\n    ('workspace-snapshot:logic_gate_map', ''),\r\n    ('workspace-snapshot:logic_gate_map_window', ''),\r\n    ('workspace-snapshot:company_explorer', ''),\r\n    ('workspace-snapshot:shared_triage', ''),\r\n    ('nodes', ''),\r\n    ('projects', ''),\r\n    ('node-relationships', ''),\r\n    ('logic-gates', ''),\r\n    ('logic-gate-relationships', ''),\r\n    ('map-layout:node', ''),\r\n    ('map-layout:node-window', ''),\r\n    ('map-layout:logic_gate', ''),\r\n    ('map-layout:logic_gate-window', ''),\r\n    ('kanban-boards', '')\r\n  ) as keys(scope, resource_key)\r\n$function$\n",
  "identity_arguments": "",
  "kind": "function",
  "language": "sql",
  "name": "workspace_static_read_version_keys",
  "parallel": "u",
  "result_type": "TABLE(scope text, resource_key text)",
  "schema": "public",
  "security_definer": false,
  "strict": false,
  "volatility": "immutable"
}
```
