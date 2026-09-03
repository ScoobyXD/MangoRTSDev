-- One-time Process Steps cutover. Run with the application stopped, then deploy
-- the matching application version. Never run against a live database as an agent.
begin;
set local search_path = public, pg_catalog;

select current_setting('server_version') as connected_postgresql_version;
do $$
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 190000 then
    raise exception 'STOP: Process Steps requires PostgreSQL 17 or 18';
  end if;
  if to_regclass('public.process_steps') is not null
     or to_regclass('public.kanban_board_projection') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='node_logic_gate_assignments' and column_name='status_key'
     ) then
    raise exception 'STOP: Process Steps requires the complete pre-cutover schema';
  end if;
  if exists (
    select 1 from node_logic_gate_assignments
    where lower(replace(replace(btrim(status_key),'_',' '),'-',' ')) not in
      ('requested','request','requests','r','backlog','backlogs','b','pending','p','in progress','inprogress','ip','review','done','d')
  ) then
    raise exception 'STOP: an existing Process assignment has an unsupported status';
  end if;
  if exists (
    select 1 from resource_gvic_assignments
    where resource_type not in ('node','logic_gate','project','company_explorer_folder','shared_inbox_folder','shared_inbox','huddle_logic_gate','huddle_node')
  ) then
    raise exception 'STOP: a RACI assignment has a retired or unsupported resource type';
  end if;
  if exists (
    select 1 from recycle_bin_items
    where jsonb_typeof(restore_payload) <> 'object'
       or (restore_payload ? 'nodes' and jsonb_typeof(restore_payload->'nodes') <> 'array')
       or (restore_payload ? 'node_logic_gate_assignments'
           and jsonb_typeof(restore_payload->'node_logic_gate_assignments') <> 'array')
  ) then
    raise exception 'STOP: a recycle payload has an invalid Node or assignment collection';
  end if;
  if exists (
    select 1
    from recycle_bin_items item
    cross join lateral jsonb_array_elements(coalesce(item.restore_payload->'node_logic_gate_assignments','[]'::jsonb)) saved(row_json)
    where jsonb_typeof(saved.row_json) <> 'object'
       or coalesce(lower(replace(replace(btrim(saved.row_json->>'status_key'),'_',' '),'-',' ')),'') not in
          ('requested','request','requests','r','backlog','backlogs','b','pending','p','in progress','inprogress','ip','review','done','d')
  ) then
    raise exception 'STOP: a recycled Process assignment has an unsupported status';
  end if;
end $$;

lock table nodes, node_logic_gate_assignments, kanban_board_projection,
  resource_operational_relationships, process_map_traces, recycle_bin_items in share row exclusive mode;

-- The old assignment owns the underlying status; Issue remains its own flag.
-- No step is guessed, and completion timestamps and Node contents are preserved.
update nodes node
set status = case lower(replace(replace(btrim(assignment.status_key),'_',' '),'-',' '))
  when 'requested' then 'Requested' when 'request' then 'Requested' when 'requests' then 'Requested' when 'r' then 'Requested'
  when 'backlog' then 'Backlogs' when 'backlogs' then 'Backlogs' when 'b' then 'Backlogs'
  when 'pending' then 'Pending' when 'p' then 'Pending'
  when 'in progress' then 'In Progress' when 'inprogress' then 'In Progress' when 'ip' then 'In Progress'
  when 'review' then 'Review' when 'done' then 'Done' when 'd' then 'Done'
end
from node_logic_gate_assignments assignment
where assignment.company_id=node.company_id and assignment.node_id=node.node_id;

-- Convert saved snapshots once as well, so restore uses only the new schema.
with converted as (
  select item.company_id,item.recycle_bin_item_id,
    (item.restore_payload - 'kanban_board_projection')
    || case when item.restore_payload ? 'nodes' then jsonb_build_object('nodes',coalesce((
      select jsonb_agg(
        case when assignment.row_json is null then saved.row_json else
          saved.row_json || jsonb_build_object('status',case lower(replace(replace(btrim(assignment.row_json->>'status_key'),'_',' '),'-',' '))
            when 'requested' then 'Requested' when 'request' then 'Requested' when 'requests' then 'Requested' when 'r' then 'Requested'
            when 'backlog' then 'Backlogs' when 'backlogs' then 'Backlogs' when 'b' then 'Backlogs'
            when 'pending' then 'Pending' when 'p' then 'Pending'
            when 'in progress' then 'In Progress' when 'inprogress' then 'In Progress' when 'ip' then 'In Progress'
            when 'review' then 'Review' when 'done' then 'Done' when 'd' then 'Done'
            else saved.row_json->>'status' end)
        end order by saved.ordinality)
      from jsonb_array_elements(item.restore_payload->'nodes') with ordinality saved(row_json,ordinality)
      left join lateral (
        select old_assignment.row_json
        from jsonb_array_elements(coalesce(item.restore_payload->'node_logic_gate_assignments','[]'::jsonb)) old_assignment(row_json)
        where old_assignment.row_json->>'company_id'=saved.row_json->>'company_id'
          and old_assignment.row_json->>'node_id'=saved.row_json->>'node_id'
      ) assignment on true
    ),'[]'::jsonb)) else '{}'::jsonb end
    || case when item.restore_payload ? 'node_logic_gate_assignments' then jsonb_build_object('node_logic_gate_assignments',coalesce((
      select jsonb_agg((saved.row_json - 'status_key' - 'column_id' - 'compatibility_board_id' - 'compatibility_card_id')
        || jsonb_build_object('process_step_id',null) order by saved.ordinality)
      from jsonb_array_elements(item.restore_payload->'node_logic_gate_assignments') with ordinality saved(row_json,ordinality)
    ),'[]'::jsonb)) else '{}'::jsonb end as payload
  from recycle_bin_items item
  where item.restore_payload ?| array['kanban_board_projection','node_logic_gate_assignments']
)
update recycle_bin_items item set restore_payload=converted.payload
from converted
where converted.company_id=item.company_id and converted.recycle_bin_item_id=item.recycle_bin_item_id;

drop table public.kanban_board_projection;
drop index public.idx_node_logic_gate_assignments_compat_card;
drop index public.idx_node_logic_gate_assignments_logic_gate_position;
alter table public.node_logic_gate_assignments
  drop column status_key,
  drop column column_id,
  drop column compatibility_board_id,
  drop column compatibility_card_id,
  add column process_step_id uuid;

-- BEGIN PROCESS STEP SCHEMA
CREATE TABLE public.process_steps (
    company_id uuid NOT NULL,
    process_step_id uuid NOT NULL,
    logic_gate_id uuid NOT NULL,
    name text NOT NULL,
    position integer NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT process_steps_pkey PRIMARY KEY (company_id, process_step_id),
    CONSTRAINT process_steps_owner_identity_key UNIQUE (company_id, logic_gate_id, process_step_id),
    CONSTRAINT process_steps_owner_fkey FOREIGN KEY (company_id, logic_gate_id) REFERENCES public.logic_gates(company_id, logic_gate_id) ON DELETE CASCADE,
    CONSTRAINT process_steps_name_chk CHECK (length(btrim(name)) BETWEEN 1 AND 500),
    CONSTRAINT process_steps_position_chk CHECK (position >= 0),
    CONSTRAINT process_steps_timestamps_chk CHECK (updated_timestamp >= created_timestamp)
);

CREATE INDEX idx_process_steps_owner_position ON public.process_steps (company_id, logic_gate_id, position, process_step_id);
CREATE INDEX idx_node_logic_gate_assignments_logic_gate_position ON public.node_logic_gate_assignments (company_id, logic_gate_id, process_step_id, position, node_id);
ALTER TABLE public.node_logic_gate_assignments ADD CONSTRAINT node_logic_gate_assignments_step_fkey
  FOREIGN KEY (company_id, logic_gate_id, process_step_id)
  REFERENCES public.process_steps(company_id, logic_gate_id, process_step_id)
  ON DELETE SET NULL (process_step_id);

CREATE FUNCTION public.trg_process_step_owner_immutable() RETURNS trigger
    LANGUAGE plpgsql AS $$
begin
  if (new.company_id,new.process_step_id,new.logic_gate_id)
       is distinct from (old.company_id,old.process_step_id,old.logic_gate_id) then
    raise exception 'process_step_owner_immutable' using errcode='23514';
  end if;
  return new;
end;
$$;

CREATE FUNCTION public.trg_process_step_cleanup() RETURNS trigger
    LANGUAGE plpgsql AS $$
begin
  update node_logic_gate_assignments
  set process_step_id=null,version=version+1,updated_timestamp=statement_timestamp()
  where company_id=old.company_id and process_step_id=old.process_step_id;
  delete from resource_operational_relationships
  where company_id=old.company_id
    and ((source_resource_type='process_step' and source_resource_id=old.process_step_id)
      or (target_resource_type='process_step' and target_resource_id=old.process_step_id));
  return old;
end;
$$;

CREATE FUNCTION public.trg_process_step_relationship_work_version() RETURNS trigger
    LANGUAGE plpgsql AS $$
declare
  source_row jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  owner_id uuid;
begin
  if source_row->>'source_resource_type'='process_step' then
    select logic_gate_id into owner_id from process_steps
    where company_id=(source_row->>'company_id')::uuid
      and process_step_id=(source_row->>'source_resource_id')::uuid;
    if found then
      perform mangorts_bump_logic_gate_work_version((source_row->>'company_id')::uuid,owner_id);
    end if;
  end if;
  return null;
end;
$$;

CREATE FUNCTION public.trg_process_map_trace_endpoint_types() RETURNS trigger
    LANGUAGE plpgsql AS $$
begin
  perform 1 from resource_operational_relationships
  where company_id=new.company_id
    and resource_operational_relationship_id=new.resource_operational_relationship_id
    and source_resource_type in ('company_explorer_folder','logic_gate')
    and target_resource_type in ('company_explorer_folder','logic_gate')
  for key share;
  if not found then
    raise exception 'process_map_trace_endpoint_type_invalid' using errcode='23514';
  end if;
  return new;
end;
$$;

CREATE TRIGGER trg_process_step_owner_immutable BEFORE UPDATE ON public.process_steps
  FOR EACH ROW EXECUTE FUNCTION public.trg_process_step_owner_immutable();
CREATE TRIGGER trg_process_step_cleanup BEFORE DELETE ON public.process_steps
  FOR EACH ROW EXECUTE FUNCTION public.trg_process_step_cleanup();
CREATE TRIGGER trg_logic_gate_work_version_steps AFTER INSERT OR UPDATE OR DELETE ON public.process_steps
  FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_gate_row();
CREATE TRIGGER trg_process_step_relationship_work_version AFTER INSERT OR UPDATE OR DELETE ON public.resource_operational_relationships
  FOR EACH ROW EXECUTE FUNCTION public.trg_process_step_relationship_work_version();
CREATE TRIGGER trg_process_map_trace_endpoint_types BEFORE INSERT OR UPDATE ON public.process_map_traces
  FOR EACH ROW EXECUTE FUNCTION public.trg_process_map_trace_endpoint_types();
-- END PROCESS STEP SCHEMA

alter table public.resource_operational_relationships
  drop constraint resource_operational_relationships_source_type_chk,
  drop constraint resource_operational_relationships_target_type_chk,
  add constraint resource_operational_relationships_source_type_chk check (source_resource_type in ('company_explorer_folder','logic_gate','process_step')),
  add constraint resource_operational_relationships_target_type_chk check (target_resource_type in ('company_explorer_folder','logic_gate','process_step')),
  add constraint resource_operational_relationships_step_pair_chk check ((source_resource_type='process_step')=(target_resource_type='process_step'));

CREATE OR REPLACE FUNCTION public.trg_validate_resource_operational_relationship() RETURNS trigger
    LANGUAGE plpgsql AS $$
declare
  locked_count integer;
  source_owner_id uuid;
  target_owner_id uuid;
begin
  if tg_op='UPDATE' and (
    new.company_id is distinct from old.company_id
    or new.resource_operational_relationship_id is distinct from old.resource_operational_relationship_id
    or new.source_resource_type is distinct from old.source_resource_type
    or new.source_resource_id is distinct from old.source_resource_id
    or new.target_resource_type is distinct from old.target_resource_type
    or new.target_resource_id is distinct from old.target_resource_id
  ) then
    raise exception 'process_map_relationship_endpoints_immutable' using errcode='23514';
  end if;
  if new.source_resource_type not in ('company_explorer_folder','logic_gate','process_step')
     or new.target_resource_type not in ('company_explorer_folder','logic_gate','process_step')
     or (new.source_resource_type='process_step')<>(new.target_resource_type='process_step') then
    raise exception 'invalid_process_map_resource_type' using errcode='23514';
  end if;
  if new.source_resource_type=new.target_resource_type and new.source_resource_id=new.target_resource_id then
    raise exception 'process_map_relationship_self_edge' using errcode='23514';
  end if;
  if new.source_resource_type='process_step' then
    perform 1 from process_steps
    where company_id=new.company_id and process_step_id in (new.source_resource_id,new.target_resource_id)
    order by process_step_id for key share;
    get diagnostics locked_count=row_count;
    if locked_count<>2 then
      raise exception 'process_step_endpoint_not_found' using errcode='23503';
    end if;
    select logic_gate_id into source_owner_id from process_steps
    where company_id=new.company_id and process_step_id=new.source_resource_id;
    select logic_gate_id into target_owner_id from process_steps
    where company_id=new.company_id and process_step_id=new.target_resource_id;
    if source_owner_id<>target_owner_id then
      raise exception 'process_step_relationship_cross_process' using errcode='23514';
    end if;
  elsif new.source_resource_type='company_explorer_folder' and new.target_resource_type='company_explorer_folder' then
    perform 1 from company_explorer_folders
    where company_id=new.company_id and folder_id in (new.source_resource_id,new.target_resource_id)
    order by folder_id for key share;
    get diagnostics locked_count=row_count;
    if locked_count<>2 then
      raise exception 'process_map_endpoint_not_found' using errcode='23503';
    end if;
  elsif new.source_resource_type='logic_gate' and new.target_resource_type='logic_gate' then
    perform 1 from logic_gates
    where company_id=new.company_id and logic_gate_id in (new.source_resource_id,new.target_resource_id)
    order by logic_gate_id for key share;
    get diagnostics locked_count=row_count;
    if locked_count<>2 then
      raise exception 'process_map_endpoint_not_found' using errcode='23503';
    end if;
  else
    perform 1 from company_explorer_folders
    where company_id=new.company_id and folder_id=case when new.source_resource_type='company_explorer_folder' then new.source_resource_id else new.target_resource_id end
    for key share;
    if not found then raise exception 'process_map_endpoint_not_found' using errcode='23503'; end if;
    perform 1 from logic_gates
    where company_id=new.company_id and logic_gate_id=case when new.source_resource_type='logic_gate' then new.source_resource_id else new.target_resource_id end
    for key share;
    if not found then raise exception 'process_map_endpoint_not_found' using errcode='23503'; end if;
  end if;
  return new;
end;
$$;

drop trigger trg_logic_gate_work_version_nodes on public.nodes;
create trigger trg_logic_gate_work_version_nodes after update of name,due_date,priority,status on public.nodes
  for each row execute function public.mangorts_trg_bump_logic_gate_work_from_node();

CREATE OR REPLACE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_resource() RETURNS trigger
    LANGUAGE plpgsql AS $$
begin
  if tg_op<>'INSERT' then
    if old.resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(old.company_id,old.resource_id);
    elsif old.resource_type='node' then
      perform mangorts_bump_logic_gate_work_versions_for_node(old.company_id,old.resource_id);
    elsif old.resource_type='company_explorer_folder' then
      perform mangorts_bump_logic_gate_work_versions_for_folder(old.company_id,old.resource_id);
    end if;
  end if;
  if tg_op='INSERT' or (tg_op='UPDATE' and
      (new.company_id,new.resource_type,new.resource_id) is distinct from (old.company_id,old.resource_type,old.resource_id)) then
    if new.resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(new.company_id,new.resource_id);
    elsif new.resource_type='node' then
      perform mangorts_bump_logic_gate_work_versions_for_node(new.company_id,new.resource_id);
    elsif new.resource_type='company_explorer_folder' then
      perform mangorts_bump_logic_gate_work_versions_for_folder(new.company_id,new.resource_id);
    end if;
  end if;
  return null;
end;
$$;

CREATE TRIGGER trg_logic_gate_work_version_permission_settings AFTER INSERT OR UPDATE OR DELETE ON public.resource_permission_settings
  FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_resource();
CREATE TRIGGER trg_logic_gate_work_version_gvic_settings AFTER INSERT OR UPDATE OR DELETE ON public.resource_gvic_settings
  FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_resource();

-- Match the existing RACI settings types so Process requests can inherit from folders.
alter table public.resource_gvic_assignments
  drop constraint resource_gvic_assignments_resource_type_chk,
  add constraint resource_gvic_assignments_resource_type_chk check (resource_type in (
    'node','logic_gate','project','company_explorer_folder','shared_inbox_folder','shared_inbox','huddle_logic_gate','huddle_node'
  ));

commit;
