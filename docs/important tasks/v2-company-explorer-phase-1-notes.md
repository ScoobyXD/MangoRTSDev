# V2 Company Explorer Phase 1 Notes

## Folder Shares

Phase 1 preserves `company_explorer_folder_shares`.

Active shares with a resolved `user_id` are also backfilled into `resource_access_grants` as `company_explorer_folder` `edit` grants. This gives V2 folder entities an explicit permission grant path while keeping the existing share records intact.

Pending email-only shares are not converted in Phase 1 because they represent invitation workflow state, not a resolved principal grant. Phase 2 should either keep the share workflow or replace it with a V2 invitation flow before the old share table is removed.

## Default Folder Seeds

`company_explorer_default_folder_seeds` is not copied into a V2 table in Phase 1.

V2 roots are represented by `company`, `user`, and `user_group` explorer entities plus explicit root edges. The old seed table only records idempotent creation of legacy default folders, so it is obsolete for the V2 graph model. The table remains intact until Phase 2 removes the legacy Company Explorer storage.
