# Shared Triage Access Tasks

## Business Logic Guardrails

- Shared Triage folder listing must work for `company_user` and `company_manager` roles. Do not rely on the dev-admin/company-admin bypass path to prove this surface works.
- Admin roles may bypass resource permissions, but managers and users must resolve access through Shared Triage resource policy: default access, direct user grants, and group grants.
- GVIC assignments are notification/My Work/update routing data. They must not grant Shared Triage view/edit access, elevate view to edit, or participate in delete/mutation authorization.
- Shared Triage folder and mailbox permissions use the `shared_inbox_folder` and `shared_inbox` resource types. `shared_triage_folder` may appear only as a legacy resource-type alias, not as a table name.
- Loading the Shared Triage folder tree must not depend on GVIC projection tables such as `resource_gvic_effective_assignments`. GVIC projection rebuilds or drift must not make the folder list fail for non-admin users.
- If required Shared Triage storage tables are missing, the API should return `shared_inbox_storage_unavailable`, not the generic `failed_to_list_shared_inboxes` error.

## Regression Tasks

- Add or preserve backend coverage that exercises `/v1/communications/shared-inboxes?company_id=...` as a `company_user` with view access.
- Add or preserve backend coverage that exercises the same endpoint as a `company_manager`; manager role alone is not an admin bypass.
- Keep a Postgres SQL-shape regression around `ListVisibleCommunicationsSharedInboxFolders` so it continues to use `mangorts_user_can_access_resource` and does not depend on GVIC projection tables.
- Verify view-only permission reports `effective_access_level = "view"` and edit permission reports `effective_access_level = "edit"`. GVIC generated or verified alone must not change the effective permission level.
- When changing Shared Triage permissions, run the Shared Triage backend tests plus the visible-query store tests before shipping.
