drop trigger if exists trg_zz_raci_tabs_assignment_changed on resource_gvic_assignments;
drop trigger if exists trg_zz_raci_tabs_explorer_folder_changed on company_explorer_folders;
drop trigger if exists trg_zz_raci_tabs_explorer_item_changed on company_explorer_items;
drop trigger if exists trg_zz_raci_tabs_group_changed on company_user_groups;
drop trigger if exists trg_zz_raci_tabs_group_member_changed on company_user_group_members;
drop trigger if exists trg_zz_raci_tabs_logic_gate_changed on logic_gates;
drop trigger if exists trg_zz_raci_tabs_membership_changed on company_memberships;
drop trigger if exists trg_zz_raci_tabs_setting_changed on resource_gvic_settings;

drop function if exists mangorts_raci_tabs_explorer_folder_changed();
drop function if exists mangorts_raci_tabs_explorer_item_changed();
drop function if exists mangorts_raci_tabs_group_changed();
drop function if exists mangorts_raci_tabs_group_member_changed();
drop function if exists mangorts_raci_tabs_logic_gate_changed();
drop function if exists mangorts_raci_tabs_membership_added();
drop function if exists mangorts_raci_tabs_policy_changed();
drop function if exists mangorts_sync_raci_tabs_group_ancestors(uuid,uuid[]);
drop function if exists mangorts_sync_raci_tabs_policy_resource(uuid,text,uuid);
drop function if exists mangorts_sync_raci_tabs_explorer_subtree(uuid,uuid);
drop function if exists mangorts_sync_raci_tabs_logic_gate(uuid,uuid);

drop table if exists raci_tabs_items;
drop table if exists raci_tabs_folders;
