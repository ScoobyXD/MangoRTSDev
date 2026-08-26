update process_map_placements
set grid_width=10000,grid_height=8000
where company_id='10000000-0000-4000-8000-000000000001'
  and resource_type='company_explorer_folder'
  and resource_id='20000000-0000-4000-8000-000000000001';

insert into logic_gates(company_id,logic_gate_id,header,created_timestamp)
values (
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000004',
  'Far Process',
  '2026-08-02T00:00:00Z'
);

insert into process_map_placements(
  company_id,resource_type,resource_id,map_parent_folder_id,
  grid_x,grid_y,grid_width,grid_height,revision,
  created_timestamp,updated_timestamp
) values (
  '10000000-0000-4000-8000-000000000001','logic_gate',
  '30000000-0000-4000-8000-000000000004',null,
  25000,30000,7,5,1,
  '2026-08-02T00:00:01Z','2026-08-02T00:00:01Z'
);

insert into resource_operational_relationships(
  company_id,resource_operational_relationship_id,
  source_resource_type,source_resource_id,target_resource_type,target_resource_id,
  created_timestamp
) values (
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  'logic_gate','30000000-0000-4000-8000-000000000001',
  'logic_gate','30000000-0000-4000-8000-000000000004',
  '2026-08-02T00:00:02Z'
);

insert into process_map_traces(
  company_id,resource_operational_relationship_id,route_points,revision,
  created_timestamp,updated_timestamp
) values (
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  '[{"x":5000,"y":205},{"x":20000,"y":30002}]'::jsonb,3,
  '2026-08-02T00:00:03Z','2026-08-02T00:00:03Z'
);

insert into companies(company_id,name)
values ('10000000-0000-4000-8000-000000000002','Independent compact company');

insert into logic_gates(company_id,logic_gate_id,header,created_timestamp) values
  ('10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000011','Second A','2026-08-02T00:01:00Z'),
  ('10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000012','Second B','2026-08-02T00:01:01Z');

insert into process_map_placements(
  company_id,resource_type,resource_id,map_parent_folder_id,
  grid_x,grid_y,grid_width,grid_height,revision,
  created_timestamp,updated_timestamp
) values
  ('10000000-0000-4000-8000-000000000002','logic_gate','30000000-0000-4000-8000-000000000011',null,
   1000,500,7,5,11,'2026-08-02T00:01:02Z','2026-08-02T00:01:02Z'),
  ('10000000-0000-4000-8000-000000000002','logic_gate','30000000-0000-4000-8000-000000000012',null,
   10000,5000,7,5,12,'2026-08-02T00:01:03Z','2026-08-02T00:01:03Z');

insert into workspace_read_versions(company_id,scope,resource_key,version,updated_timestamp)
values (
  '10000000-0000-4000-8000-000000000002','process-map','',4,
  '2026-08-02T00:01:04Z'
);

insert into recycle_bin_items(
  company_id,recycle_bin_item_id,object_kind,object_id,object_label,
  restore_payload,deleted_timestamp
)
select
  '10000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
  'folder','20000000-0000-4000-8000-000000000001','Compaction snapshot',
  jsonb_build_object(
    'process_map_placements',(
      select jsonb_agg(to_jsonb(placement) order by resource_type,resource_id)
      from process_map_placements placement
      where placement.company_id='10000000-0000-4000-8000-000000000001'
    ),
    'resource_operational_relationships',(
      select jsonb_agg(to_jsonb(relationship) order by resource_operational_relationship_id)
      from resource_operational_relationships relationship
      where relationship.company_id='10000000-0000-4000-8000-000000000001'
    ),
    'process_map_traces',(
      select jsonb_agg(to_jsonb(trace) order by resource_operational_relationship_id)
      from process_map_traces trace
      where trace.company_id='10000000-0000-4000-8000-000000000001'
    ),
    'process_map_cleanup_child_reparents',(
      select jsonb_agg(claim order by claim->>'resource_id')
      from (
        select jsonb_build_object(
          'company_id',placement.company_id,
          'resource_type',placement.resource_type,
          'resource_id',placement.resource_id,
          'placement_incarnation_token',placement.placement_incarnation_token,
          'original_parent_folder_id','20000000-0000-4000-8000-000000000001'::uuid,
          'cleanup_parent_folder_id',placement.map_parent_folder_id,
          'cleanup_revision',placement.revision,
          'created_timestamp',placement.created_timestamp,
          'grid_x',placement.grid_x,'grid_y',placement.grid_y,
          'grid_width',placement.grid_width,'grid_height',placement.grid_height
        ) claim
        from process_map_placements placement
        where placement.company_id='10000000-0000-4000-8000-000000000001'
          and placement.resource_type='logic_gate'
          and placement.resource_id='30000000-0000-4000-8000-000000000004'
        union all
        select jsonb_build_object(
          'company_id',placement.company_id,
          'resource_type',placement.resource_type,
          'resource_id',placement.resource_id,
          'placement_incarnation_token',placement.placement_incarnation_token,
          'original_parent_folder_id','20000000-0000-4000-8000-000000000003'::uuid,
          'cleanup_parent_folder_id',placement.map_parent_folder_id,
          'cleanup_revision',placement.revision-1,
          'created_timestamp',placement.created_timestamp,
          'grid_x',placement.grid_x,'grid_y',placement.grid_y,
          'grid_width',placement.grid_width,'grid_height',placement.grid_height
        ) claim
        from process_map_placements placement
        where placement.company_id='10000000-0000-4000-8000-000000000001'
          and placement.resource_type='logic_gate'
          and placement.resource_id='30000000-0000-4000-8000-000000000001'
      ) claims
    )
  ),
  '2026-08-02T00:01:05Z'::timestamptz;
