-- MangoRTS prod schema repair, 2026-07-07.
--
-- Purpose:
--   Repair prod schema objects that are present in dev and historical
--   migrations, but missing from prod even though schema_migrations marks the
--   migrations as applied.
--
-- Scope:
--   - DDL only.
--   - No dev row copy.
--   - No tenant/user/work row inserts.
--   - No deletes.
--   - No schema_migrations changes.
--
-- Run from Jonat's human-only DBeaver connection to prod.

select 'before_missing_objects' as check_name, expected.table_name, to_regclass('public.' || expected.table_name) as actual_regclass
from (
  values
    ('communications_email_node_attachments'),
    ('project_critical_path_steps'),
    ('project_management_timeline_items'),
    ('project_management_timeline_projection')
) as expected(table_name)
order by expected.table_name;

select 'before_projects_health_column' as check_name, column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'projects'
  and column_name = 'health';

begin;

alter table projects
  add column if not exists health text not null default 'On Track';

alter table projects
  drop constraint if exists projects_health_chk;

alter table projects
  add constraint projects_health_chk check (health in ('On Track', 'AT RISK', 'Off Track'));

create table if not exists communications_email_node_attachments (
  company_id uuid not null,
  user_id uuid not null,
  message_id text not null,
  node_id uuid not null,
  board_id text not null default '',
  card_id uuid not null,
  logic_gate_id uuid not null,
  message jsonb not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_email_node_attachments_message_id_nonblank_chk check (btrim(message_id) <> ''),
  primary key (company_id, user_id, message_id, node_id),
  foreign key (user_id) references users (user_id) on delete cascade,
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
);

create index if not exists idx_communications_email_node_attachments_user_message
  on communications_email_node_attachments(user_id, message_id);

create index if not exists idx_communications_email_node_attachments_node
  on communications_email_node_attachments(company_id, node_id, updated_timestamp desc);

create index if not exists idx_communications_email_node_attachments_logic_gate
  on communications_email_node_attachments(company_id, logic_gate_id, updated_timestamp desc);

create table if not exists project_critical_path_steps (
  company_id uuid not null,
  project_id uuid not null,
  step_id uuid not null,
  name text not null default '',
  relationship_id uuid,
  due_date date,
  owner_type text not null default '',
  owner_id uuid,
  position integer not null default 0,
  is_current boolean not null default false,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint project_critical_path_owner_chk check (
    (owner_type = '' and owner_id is null)
    or (owner_type in ('user', 'group') and owner_id is not null)
  ),
  primary key (company_id, project_id, step_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade
);

create index if not exists idx_project_critical_path_project_position
  on project_critical_path_steps(company_id, project_id, position, step_id);

create unique index if not exists idx_project_critical_path_one_current
  on project_critical_path_steps(company_id, project_id)
  where is_current;

create table if not exists project_management_timeline_items (
  company_id uuid not null,
  item_id uuid not null,
  user_id uuid not null,
  node_id uuid,
  logic_gate_id uuid,
  start_date date not null,
  duration_days smallint not null,
  position integer not null default 0,
  created_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, item_id),
  constraint project_management_timeline_item_target_chk check (
    (node_id is not null and logic_gate_id is null)
    or (node_id is null and logic_gate_id is not null)
  ),
  constraint project_management_timeline_duration_chk check (duration_days between 1 and 90),
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade,
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id)
);

create unique index if not exists idx_project_management_timeline_user_node
  on project_management_timeline_items(company_id, user_id, node_id)
  where node_id is not null;

create unique index if not exists idx_project_management_timeline_user_logic_gate
  on project_management_timeline_items(company_id, user_id, logic_gate_id)
  where logic_gate_id is not null;

create index if not exists idx_project_management_timeline_hot_read
  on project_management_timeline_items(company_id, user_id, start_date, position, item_id);

create table if not exists project_management_timeline_projection (
  company_id uuid not null,
  item_id uuid not null,
  user_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  node_id uuid,
  logic_gate_id uuid,
  display_title text not null,
  status text,
  due_date date,
  priority smallint,
  start_date date not null,
  end_date date not null,
  duration_days smallint not null,
  position integer not null default 0,
  resource_created_timestamp timestamptz not null,
  timeline_created_timestamp timestamptz not null,
  timeline_updated_timestamp timestamptz not null,
  projection_updated_timestamp timestamptz not null default now(),
  accounts jsonb not null default '[]'::jsonb,
  primary key (company_id, user_id, item_id),
  constraint project_management_timeline_projection_resource_type_chk check (resource_type in ('node', 'logic_gate')),
  constraint project_management_timeline_projection_title_chk check (btrim(display_title) <> ''),
  constraint project_management_timeline_projection_duration_chk check (duration_days between 1 and 90),
  constraint project_management_timeline_projection_accounts_array_chk check (jsonb_typeof(accounts) = 'array'),
  constraint project_management_timeline_projection_target_chk check (
    (resource_type='node' and node_id is not null and logic_gate_id is null and resource_id=node_id)
    or (resource_type='logic_gate' and logic_gate_id is not null and node_id is null and resource_id=logic_gate_id)
  ),
  foreign key (company_id, item_id) references project_management_timeline_items(company_id, item_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade,
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade
);

alter table if exists project_management_timeline_projection
  add column if not exists accounts jsonb not null default '[]'::jsonb;

alter table if exists project_management_timeline_projection
  drop column if exists status_color,
  drop column if exists assignee_user_id,
  drop column if exists assignee_display_name,
  drop column if exists assignee_email;

alter table if exists project_management_timeline_projection
  drop constraint if exists project_management_timeline_projection_accounts_array_chk;

alter table project_management_timeline_projection
  add constraint project_management_timeline_projection_accounts_array_chk check (jsonb_typeof(accounts) = 'array');

create index if not exists idx_project_management_timeline_projection_hot_read
  on project_management_timeline_projection(company_id, user_id, start_date, position, item_id);

create index if not exists idx_project_management_timeline_projection_node
  on project_management_timeline_projection(company_id, node_id);

create index if not exists idx_project_management_timeline_projection_logic_gate
  on project_management_timeline_projection(company_id, logic_gate_id);

commit;

select 'after_missing_objects' as check_name, expected.table_name, to_regclass('public.' || expected.table_name) as actual_regclass
from (
  values
    ('communications_email_node_attachments'),
    ('project_critical_path_steps'),
    ('project_management_timeline_items'),
    ('project_management_timeline_projection')
) as expected(table_name)
order by expected.table_name;

select 'after_projects_health_column' as check_name, column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'projects'
  and column_name = 'health';

select 'after_repaired_table_counts' as check_name, table_name, row_estimate
from (
  select 'communications_email_node_attachments' as table_name, count(*)::bigint as row_estimate from communications_email_node_attachments
  union all
  select 'project_critical_path_steps', count(*)::bigint from project_critical_path_steps
  union all
  select 'project_management_timeline_items', count(*)::bigint from project_management_timeline_items
  union all
  select 'project_management_timeline_projection', count(*)::bigint from project_management_timeline_projection
) counts
order by table_name;

