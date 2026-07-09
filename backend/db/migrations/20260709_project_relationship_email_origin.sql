alter table if exists project_relationship_projection
  add column if not exists created_from_email boolean not null default false;

update project_relationship_projection projection
set created_from_email=true
where projection.resource_type='node'
  and exists (
    select 1
    from communications_email_nodes email_node
    where email_node.company_id=projection.company_id
      and email_node.node_id=projection.resource_id
    union all
    select 1
    from node_projection_table node_projection
    where node_projection.company_id=projection.company_id
      and node_projection.node_id=projection.resource_id
      and node_projection.type='Attached email'::information_type
      and node_projection.information like '%"created_from_email":true%'
  );
