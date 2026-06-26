delete from company_explorer_items
where target_type='node';

delete from company_explorer_folders folder
where folder.folder_id = (
  md5(folder.company_id::text || ':company_explorer_default_folder:unfiled_nodes')::uuid
);

alter table company_explorer_items
  drop constraint if exists company_explorer_items_target_type_chk;

alter table company_explorer_items
  add constraint company_explorer_items_target_type_chk
  check (target_type in ('project', 'logic_gate'));

create or replace view company_explorer_final_backfill_verification as
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'manual_references_have_existing_targets'::text as check_name,
         (select count(*) from company_explorer_items)::bigint as expected_count,
         (
           select count(*)
           from company_explorer_items item
           left join projects project
             on item.target_type='project'
            and project.company_id=item.company_id
            and project.project_id=item.target_id
           left join logic_gates logic_gate
             on item.target_type='logic_gate'
            and logic_gate.company_id=item.company_id
            and logic_gate.logic_gate_id=item.target_id
           where (item.target_type='project' and project.project_id is not null)
              or (item.target_type='logic_gate' and logic_gate.logic_gate_id is not null)
         )::bigint as actual_count
) check_row
union all
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'folders_have_valid_parents'::text as check_name,
         (select count(*) from company_explorer_folders where parent_folder_id is not null)::bigint as expected_count,
         (
           select count(*)
           from company_explorer_folders child
           join company_explorer_folders parent
             on parent.company_id=child.company_id
            and parent.folder_id=child.parent_folder_id
           where child.parent_folder_id is not null
         )::bigint as actual_count
) check_row;
