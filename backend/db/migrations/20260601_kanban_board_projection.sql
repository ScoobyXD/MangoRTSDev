-- Disposable Logic Gate Kanban read model. Source truth remains nodes,
-- logic_gates, node_logic_gate_assignments, and access/RACI tables.
create table if not exists kanban_board_projection (
  company_id uuid not null,
  logic_gate_id uuid not null,
  node_id uuid not null,
  status text not null,
  column_id uuid not null,
  position integer not null,
  title text not null,
  assignee_user_id uuid,
  priority smallint,
  is_issue boolean not null default false,
  due_date date,
  node_created_timestamp timestamptz not null,
  node_updated_timestamp timestamptz not null,
  assignment_id uuid not null,
  assignment_created_timestamp timestamptz not null,
  assignment_updated_timestamp timestamptz not null,
  compatibility_board_id text not null,
  compatibility_card_id uuid not null,
  projection_updated_timestamp timestamptz not null default now(),
  constraint kanban_board_projection_status_nonblank_chk check (btrim(status) <> ''),
  constraint kanban_board_projection_title_nonblank_chk check (btrim(title) <> ''),
  constraint kanban_board_projection_priority_chk check (priority is null or priority between 1 and 5),
  primary key (company_id, logic_gate_id, node_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade,
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (assignee_user_id) references users (user_id)
);

create index if not exists idx_kanban_board_projection_hot_read
  on kanban_board_projection(company_id, logic_gate_id, status, position, node_id);

create index if not exists idx_kanban_board_projection_node
  on kanban_board_projection(company_id, node_id);

create index if not exists idx_kanban_board_projection_updated
  on kanban_board_projection(company_id, logic_gate_id, projection_updated_timestamp desc, node_id);

insert into kanban_board_projection (
  company_id,
  logic_gate_id,
  node_id,
  status,
  column_id,
  position,
  title,
  assignee_user_id,
  priority,
  is_issue,
  due_date,
  node_created_timestamp,
  node_updated_timestamp,
  assignment_id,
  assignment_created_timestamp,
  assignment_updated_timestamp,
  compatibility_board_id,
  compatibility_card_id,
  projection_updated_timestamp
)
select
  assignment.company_id,
  assignment.logic_gate_id,
  assignment.node_id,
  assignment.status_key,
  assignment.column_id,
  assignment.position,
  node_row.title,
  node_row.assignee_user_id,
  node_row.priority,
  assignment.is_issue,
  node_row.due_date,
  node_row.created_timestamp,
  greatest(node_row.created_timestamp, assignment.updated_timestamp),
  assignment.assignment_id,
  assignment.created_timestamp,
  assignment.updated_timestamp,
  assignment.compatibility_board_id,
  assignment.compatibility_card_id,
  now()
from node_logic_gate_assignments assignment
join nodes node_row
  on node_row.company_id = assignment.company_id
 and node_row.node_id = assignment.node_id
join logic_gates logic_gate
  on logic_gate.company_id = assignment.company_id
 and logic_gate.logic_gate_id = assignment.logic_gate_id
on conflict (company_id, logic_gate_id, node_id)
do update set
  status = excluded.status,
  column_id = excluded.column_id,
  position = excluded.position,
  title = excluded.title,
  assignee_user_id = excluded.assignee_user_id,
  priority = excluded.priority,
  is_issue = excluded.is_issue,
  due_date = excluded.due_date,
  node_created_timestamp = excluded.node_created_timestamp,
  node_updated_timestamp = excluded.node_updated_timestamp,
  assignment_id = excluded.assignment_id,
  assignment_created_timestamp = excluded.assignment_created_timestamp,
  assignment_updated_timestamp = excluded.assignment_updated_timestamp,
  compatibility_board_id = excluded.compatibility_board_id,
  compatibility_card_id = excluded.compatibility_card_id,
  projection_updated_timestamp = now();
