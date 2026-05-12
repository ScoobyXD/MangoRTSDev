-- Canonical Aurora PostgreSQL schema for MVP.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'node_relationship_position') then
    create type node_relationship_position as enum ('Parent', 'Child', 'Peer');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'logic_gate_relationship_position') then
    create type logic_gate_relationship_position as enum ('Input', 'Output');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'information_type') then
    create type information_type as enum (
      'Text box',
      'Checklist',
      'Status',
      'Due date',
      'Employee name',
      'PDF',
      'PNG',
      'MOV',
      'Hyperlink',
      'Text block chat',
      'Attached email'
    );
  end if;
end $$;

alter type information_type add value if not exists 'Text block chat';
alter type information_type add value if not exists 'Attached email';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'operation_status') then
    create type operation_status as enum ('In Progress', 'Success', 'Failed');
  end if;
end $$;

create table if not exists users (
  user_id uuid not null,
  cognito_subject text not null,
  email text not null default '',
  display_name text not null default '',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint users_cognito_subject_nonblank_chk check (btrim(cognito_subject) <> ''),
  constraint users_email_lowercase_chk check (email = lower(btrim(email))),
  primary key (user_id),
  unique (cognito_subject)
);

create table if not exists companies (
  company_id uuid not null,
  name text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint companies_name_nonblank_chk check (btrim(name) <> ''),
  primary key (company_id)
);

create table if not exists company_memberships (
  company_id uuid not null,
  user_id uuid not null,
  role text not null default 'company_user',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint company_memberships_role_chk check (role in ('dev_admin', 'company_admin', 'company_user')),
  primary key (company_id, user_id),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (user_id) references users (user_id) on delete cascade
);

create index if not exists idx_company_memberships_user_company
  on company_memberships(user_id, company_id);

create table if not exists invitations (
  invitation_id uuid not null,
  company_id uuid not null,
  email text not null,
  role text not null,
  token_hash text not null,
  status text not null default 'pending',
  invited_by_user_id uuid not null,
  accepted_by_user_id uuid,
  expires_timestamp timestamptz not null,
  accepted_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint invitations_email_nonblank_chk check (btrim(email) <> ''),
  constraint invitations_email_lowercase_chk check (email = lower(btrim(email))),
  constraint invitations_token_hash_nonblank_chk check (btrim(token_hash) <> ''),
  constraint invitations_role_chk check (role in ('company_admin', 'company_user')),
  constraint invitations_status_chk check (status in ('pending', 'accepted', 'revoked')),
  primary key (invitation_id),
  unique (token_hash),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (invited_by_user_id) references users (user_id),
  foreign key (accepted_by_user_id) references users (user_id)
);

create index if not exists idx_invitations_company_email_status
  on invitations(company_id, email, status, created_timestamp desc);

create unique index if not exists idx_invitations_one_pending_company_email
  on invitations(company_id, email)
  where status = 'pending';

create table if not exists user_email_connections (
  user_id uuid not null,
  provider text not null,
  account_email text not null,
  grant_id text not null,
  status text not null default 'connected',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint user_email_connections_provider_chk check (provider in ('google', 'microsoft')),
  constraint user_email_connections_account_email_chk check (btrim(account_email) <> '' and account_email = lower(btrim(account_email))),
  constraint user_email_connections_grant_id_nonblank_chk check (btrim(grant_id) <> ''),
  constraint user_email_connections_status_chk check (status in ('connected', 'disconnected', 'reauth_required')),
  primary key (user_id),
  foreign key (user_id) references users (user_id) on delete cascade
);

create unique index if not exists idx_user_email_connections_grant_id
  on user_email_connections(grant_id);

create table if not exists nodes (
  company_id uuid not null,
  node_id uuid not null,
  title text not null,
  status text,
  status_color text,
  due_date date,
  priority smallint,
  assignee_user_id uuid,
  created_timestamp timestamptz not null,
  constraint nodes_priority_chk check (priority is null or priority between 1 and 5),
  primary key (company_id, node_id),
  foreign key (assignee_user_id) references users (user_id)
);

create table if not exists node_relationships (
  company_id uuid not null,
  node_relationship_id uuid not null,
  node_id_a uuid not null,
  node_id_b uuid not null,
  a_position node_relationship_position not null,
  b_position node_relationship_position not null,
  created_timestamp timestamptz not null,
  constraint node_relationships_position_pair_chk check (
    (a_position = 'Parent' and b_position = 'Child')
    or (a_position = 'Child' and b_position = 'Parent')
    or (a_position = 'Peer' and b_position = 'Peer')
  ),
  constraint node_relationships_not_self_chk check (node_id_a <> node_id_b),
  primary key (company_id, node_relationship_id),
  foreign key (company_id, node_id_a) references nodes (company_id, node_id),
  foreign key (company_id, node_id_b) references nodes (company_id, node_id)
);

create table if not exists node_information (
  company_id uuid not null,
  information_id uuid not null,
  node_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint node_information_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, information_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id)
);

create table if not exists node_projection_table (
  company_id uuid not null,
  node_id uuid not null,
  information_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint node_projection_table_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, node_id, information_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id)
);

create table if not exists node_map_positions (
  company_id uuid not null,
  node_id uuid not null,
  x double precision not null,
  y double precision not null,
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, node_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade
);

create table if not exists logic_gates (
  company_id uuid not null,
  logic_gate_id uuid not null,
  header text not null,
  created_timestamp timestamptz not null,
  primary key (company_id, logic_gate_id)
);

create table if not exists logic_gate_relationships (
  company_id uuid not null,
  logic_gate_relationship_id uuid not null,
  logic_gate_id_a uuid not null,
  logic_gate_id_b uuid not null,
  a_position logic_gate_relationship_position not null,
  b_position logic_gate_relationship_position not null,
  created_timestamp timestamptz not null,
  constraint logic_gate_relationships_position_pair_chk check (
    (a_position = 'Input' and b_position = 'Output')
    or (a_position = 'Output' and b_position = 'Input')
  ),
  constraint logic_gate_relationships_not_self_chk check (logic_gate_id_a <> logic_gate_id_b),
  primary key (company_id, logic_gate_relationship_id),
  foreign key (company_id, logic_gate_id_a) references logic_gates (company_id, logic_gate_id),
  foreign key (company_id, logic_gate_id_b) references logic_gates (company_id, logic_gate_id)
);

create table if not exists logic_gate_information (
  company_id uuid not null,
  information_id uuid not null,
  logic_gate_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint logic_gate_information_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, information_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id)
);

create table if not exists logic_gate_projection_table (
  company_id uuid not null,
  logic_gate_id uuid not null,
  information_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint logic_gate_projection_table_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, logic_gate_id, information_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id)
);

create table if not exists logic_gate_map_positions (
  company_id uuid not null,
  logic_gate_id uuid not null,
  x double precision not null,
  y double precision not null,
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, logic_gate_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
);

-- Existing deployments may already have current-value logic_gate_information rows.
-- Seed the projection table once so the new hot read path can serve those rows too.
insert into logic_gate_projection_table (
  company_id,
  logic_gate_id,
  information_id,
  type,
  information,
  created_timestamp,
  updated_timestamp
)
select distinct on (company_id, logic_gate_id, information_id)
  company_id,
  logic_gate_id,
  information_id,
  type,
  information,
  created_timestamp,
  updated_timestamp
from logic_gate_information
where btrim(information) <> ''
order by company_id, logic_gate_id, information_id, updated_timestamp desc
on conflict (company_id, logic_gate_id, information_id)
do update set
  type = excluded.type,
  information = excluded.information,
  updated_timestamp = excluded.updated_timestamp
where logic_gate_projection_table.updated_timestamp <= excluded.updated_timestamp;

create table if not exists operations (
  company_id uuid not null,
  operation_id uuid not null,
  node_id uuid,
  logic_gate_id uuid,
  status operation_status not null,
  start_timestamp timestamptz not null,
  end_timestamp timestamptz,
  primary key (company_id, operation_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id)
);

create table if not exists kanban_boards (
  company_id uuid not null,
  board_id text not null,
  logic_gate_id uuid,
  title text not null,
  position integer not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint kanban_boards_title_nonblank_chk check (btrim(title) <> ''),
  primary key (company_id, board_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
);

create table if not exists kanban_columns (
  company_id uuid not null,
  board_id text not null,
  column_id uuid not null,
  title text not null,
  position integer not null,
  width_px integer not null default 260,
  height_px integer not null default 240,
  item_color text not null default '#fbb152',
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint kanban_columns_title_nonblank_chk check (btrim(title) <> ''),
  constraint kanban_columns_width_px_chk check (width_px between 180 and 2000),
  constraint kanban_columns_height_px_chk check (height_px between 160 and 10000),
  constraint kanban_columns_item_color_chk check (item_color ~ '^#[0-9A-Fa-f]{6}$'),
  primary key (company_id, board_id, column_id)
);

create table if not exists kanban_cards (
  company_id uuid not null,
  board_id text not null,
  card_id uuid not null,
  column_id uuid not null,
  node_id uuid not null,
  logic_gate_id uuid,
  node_title text not null,
  description_snapshot text not null default '',
  is_issue boolean not null default false,
  position integer not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint kanban_cards_node_title_nonblank_chk check (btrim(node_title) <> ''),
  primary key (company_id, board_id, card_id),
  foreign key (company_id, board_id, column_id) references kanban_columns (company_id, board_id, column_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade,
  constraint kanban_cards_company_id_node_id_fkey foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade
);

insert into kanban_boards (
  company_id,
  board_id,
  logic_gate_id,
  title,
  position,
  created_timestamp,
  updated_timestamp
)
select
  lg.company_id,
  'logic-gate:' || lg.logic_gate_id::text,
  lg.logic_gate_id,
  coalesce(nullif(btrim(lg.header), ''), 'Logic Gate Kanban'),
  coalesce((
    select max(existing.position)
    from kanban_boards existing
    where existing.company_id = lg.company_id
  ), 0) + row_number() over (partition by lg.company_id order by lg.created_timestamp, lg.logic_gate_id) * 1000,
  now(),
  now()
from logic_gates lg
on conflict (company_id, board_id)
do update set
  logic_gate_id = excluded.logic_gate_id,
  title = excluded.title,
  updated_timestamp = now();

insert into kanban_columns (
  company_id,
  board_id,
  column_id,
  title,
  position,
  width_px,
  height_px,
  item_color,
  created_timestamp,
  updated_timestamp
)
select
  lg.company_id,
  'logic-gate:' || lg.logic_gate_id::text,
  md5((lg.company_id::text || ':logic-gate:' || lg.logic_gate_id::text || ':' || defaults.title))::uuid,
  defaults.title,
  defaults.position,
  260,
  240,
  defaults.color,
  now(),
  now()
from logic_gates lg
cross join (
  values
    ('Pending', 1000, '#808080'),
    ('In Progress', 2000, '#ff9500'),
    ('Done', 3000, '#39ff14')
) as defaults(title, position, color)
where exists (
  select 1
  from kanban_boards kb
  where kb.company_id = lg.company_id
    and kb.board_id = 'logic-gate:' || lg.logic_gate_id::text
)
on conflict (company_id, board_id, column_id) do nothing;

update kanban_cards card
set logic_gate_id = board.logic_gate_id
from kanban_boards board
where card.company_id = board.company_id
  and card.board_id = board.board_id
  and board.logic_gate_id is not null
  and card.logic_gate_id is distinct from board.logic_gate_id;

with ranked_logic_gate_cards as (
  select
    ctid,
    row_number() over (
      partition by company_id, node_id
      order by updated_timestamp desc, created_timestamp desc, card_id desc
    ) as rn
  from kanban_cards
  where logic_gate_id is not null
)
delete from kanban_cards target
using ranked_logic_gate_cards ranked
where target.ctid = ranked.ctid
  and ranked.rn > 1;

create index if not exists idx_node_information_node on node_information(company_id, node_id);
create index if not exists idx_node_projection_table_node_updated on node_projection_table(company_id, node_id, updated_timestamp desc);
drop index if exists idx_node_projection_table_one_text_box;
create index if not exists idx_node_projection_table_node_type_created
  on node_projection_table(company_id, node_id, type, created_timestamp, information_id);
create index if not exists idx_node_map_positions_company_updated on node_map_positions(company_id, updated_timestamp desc);
create index if not exists idx_node_relationships_a on node_relationships(company_id, node_id_a);
create index if not exists idx_node_relationships_b on node_relationships(company_id, node_id_b);
create index if not exists idx_logic_gate_information_logic_gate on logic_gate_information(company_id, logic_gate_id);
create index if not exists idx_logic_gate_projection_table_logic_gate_updated on logic_gate_projection_table(company_id, logic_gate_id, updated_timestamp desc);
with ranked_logic_gate_text as (
  select ctid,
         row_number() over (
           partition by company_id, logic_gate_id, type
           order by updated_timestamp desc, created_timestamp desc, information_id desc
         ) as rn
  from logic_gate_projection_table
  where type = 'Text box'::information_type
)
delete from logic_gate_projection_table target
using ranked_logic_gate_text ranked
where target.ctid = ranked.ctid
  and ranked.rn > 1;
create unique index if not exists idx_logic_gate_projection_table_one_text_box on logic_gate_projection_table(company_id, logic_gate_id, type) where type = 'Text box'::information_type;
create index if not exists idx_logic_gate_map_positions_company_updated on logic_gate_map_positions(company_id, updated_timestamp desc);
create index if not exists idx_logic_gate_relationships_a on logic_gate_relationships(company_id, logic_gate_id_a);
create index if not exists idx_logic_gate_relationships_b on logic_gate_relationships(company_id, logic_gate_id_b);
create index if not exists idx_operations_node on operations(company_id, node_id);
create index if not exists idx_operations_logic_gate on operations(company_id, logic_gate_id);
create index if not exists idx_kanban_boards_company_position on kanban_boards(company_id, position, board_id);
create unique index if not exists idx_kanban_boards_logic_gate
  on kanban_boards(company_id, logic_gate_id)
  where logic_gate_id is not null;
create index if not exists idx_kanban_columns_board_position on kanban_columns(company_id, board_id, position);
create index if not exists idx_kanban_cards_column_position on kanban_cards(company_id, board_id, column_id, position);
create unique index if not exists idx_kanban_cards_unique_node on kanban_cards(company_id, board_id, node_id);
create unique index if not exists idx_kanban_cards_one_logic_gate_card_per_node
  on kanban_cards(company_id, node_id)
  where logic_gate_id is not null;

create table if not exists company_explorer_folders (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  folder_kind text not null,
  system_key text,
  name text not null,
  position integer not null default 1000,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint company_explorer_folders_kind_chk check (folder_kind in ('node', 'logic_gate')),
  constraint company_explorer_folders_system_key_nonblank_chk check (system_key is null or btrim(system_key) <> ''),
  constraint company_explorer_folders_name_nonblank_chk check (btrim(name) <> ''),
  constraint company_explorer_folders_parent_not_self_chk check (parent_folder_id is null or parent_folder_id <> folder_id),
  primary key (company_id, folder_id),
  foreign key (company_id, parent_folder_id) references company_explorer_folders (company_id, folder_id) on delete cascade
);

create unique index if not exists idx_company_explorer_folders_system_key
  on company_explorer_folders(company_id, system_key)
  where system_key is not null;

create index if not exists idx_company_explorer_folders_parent_kind
  on company_explorer_folders(company_id, folder_kind, parent_folder_id, position, created_timestamp);

create table if not exists company_explorer_default_folder_seeds (
  company_id uuid not null,
  seed_key text not null,
  created_timestamp timestamptz not null default now(),
  constraint company_explorer_default_folder_seeds_key_nonblank_chk check (btrim(seed_key) <> ''),
  primary key (company_id, seed_key)
);

create table if not exists company_explorer_folder_items (
  company_id uuid not null,
  folder_id uuid not null,
  item_type text not null,
  item_id text not null,
  position integer not null default 1000,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint company_explorer_folder_items_type_chk check (item_type in ('node', 'logic_gate', 'kanban')),
  primary key (company_id, item_type, item_id),
  foreign key (company_id, folder_id) references company_explorer_folders (company_id, folder_id) on delete cascade
);

create index if not exists idx_company_explorer_folder_items_folder_type
  on company_explorer_folder_items(company_id, folder_id, item_type, position, created_timestamp);

create table if not exists company_explorer_folder_shares (
  company_id uuid not null,
  folder_id uuid not null,
  email text not null,
  user_id uuid,
  status text not null default 'pending',
  invited_by_user_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint company_explorer_folder_shares_email_nonblank_chk check (btrim(email) <> ''),
  constraint company_explorer_folder_shares_email_lowercase_chk check (email = lower(btrim(email))),
  constraint company_explorer_folder_shares_status_chk check (status in ('pending', 'active')),
  constraint company_explorer_folder_shares_status_user_chk check (
    (status = 'pending' and user_id is null) or
    (status = 'active' and user_id is not null)
  ),
  primary key (company_id, folder_id, email),
  foreign key (company_id, folder_id) references company_explorer_folders (company_id, folder_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade,
  foreign key (invited_by_user_id) references users (user_id) on delete cascade
);

create index if not exists idx_company_explorer_folder_shares_user
  on company_explorer_folder_shares(company_id, user_id, folder_id)
  where user_id is not null;

create index if not exists idx_company_explorer_folder_shares_email_status
  on company_explorer_folder_shares(company_id, email, status);
