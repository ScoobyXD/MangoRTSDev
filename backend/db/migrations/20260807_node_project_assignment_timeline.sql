begin;

alter table node_timeline_events
  add column if not exists project_id uuid,
  add column if not exists project_name text not null default '';

alter table node_timeline_events
  drop constraint if exists node_timeline_events_type_chk,
  drop constraint if exists node_timeline_events_transfer_chk,
  drop constraint if exists node_timeline_events_payload_chk;

alter table node_timeline_events
  add constraint node_timeline_events_type_chk
    check (event_type in ('logic_gate_transfer', 'project_assignment', 'verification_request')),
  add constraint node_timeline_events_payload_chk check (
    (event_type='logic_gate_transfer' and from_logic_gate_id is not null and to_logic_gate_id is not null and from_logic_gate_id<>to_logic_gate_id and btrim(from_logic_gate_name)<>'' and btrim(to_logic_gate_name)<>'' and project_id is null and btrim(project_name)='')
    or (event_type='project_assignment' and from_logic_gate_id is null and btrim(from_logic_gate_name)='' and to_logic_gate_id is null and btrim(to_logic_gate_name)='' and project_id is not null and btrim(project_name)<>'')
    or (event_type='verification_request' and from_logic_gate_id is null and btrim(from_logic_gate_name)='' and to_logic_gate_id is null and btrim(to_logic_gate_name)='' and project_id is null and btrim(project_name)='')
  );

commit;
