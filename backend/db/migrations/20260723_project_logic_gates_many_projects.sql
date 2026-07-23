drop index if exists idx_project_relationships_one_project_per_resource;

create unique index if not exists idx_project_relationships_one_project_per_node
  on project_relationships(company_id, resource_id)
  where resource_type='node';
