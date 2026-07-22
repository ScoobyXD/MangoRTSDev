create extension if not exists pg_trgm;

create index if not exists idx_nodes_name_trgm
  on nodes using gin (lower(name) gin_trgm_ops);

create index if not exists idx_projects_name_trgm
  on projects using gin (lower(name) gin_trgm_ops);

create index if not exists idx_logic_gates_header_trgm
  on logic_gates using gin (lower(header) gin_trgm_ops);
