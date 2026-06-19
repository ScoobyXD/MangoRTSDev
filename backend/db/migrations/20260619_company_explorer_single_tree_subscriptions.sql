-- Company Explorer V2 is now a strict single-parent tree. The All view is the
-- real tree; Me and Team are subscription views over entity anchors.

create table if not exists company_explorer_subscriptions (
  company_id uuid not null,
  subscription_id uuid not null,
  owner_type text not null,
  owner_id uuid not null,
  anchor_entity_id uuid not null,
  position integer not null default 1000,
  created_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint company_explorer_subscriptions_owner_type_chk check (owner_type in ('user', 'team')),
  primary key (company_id, subscription_id),
  unique (company_id, owner_type, owner_id, anchor_entity_id),
  foreign key (company_id, anchor_entity_id) references company_explorer_entities (company_id, entity_id) on delete cascade,
  foreign key (created_by_user_id) references users (user_id) on delete set null
);

with scoped_edges as (
  select edge.company_id,
         case
           when parent.entity_type = 'user' then 'user'
           when parent.entity_type = 'user_group' then 'team'
         end as owner_type,
         parent.resource_id as owner_id,
         edge.child_entity_id as anchor_entity_id,
         edge.position,
         edge.created_timestamp,
         edge.updated_timestamp
  from company_explorer_edges edge
  join company_explorer_entities parent
    on parent.company_id=edge.company_id
   and parent.entity_id=edge.parent_entity_id
   and parent.entity_type in ('user', 'user_group')
)
insert into company_explorer_subscriptions (
  company_id,
  subscription_id,
  owner_type,
  owner_id,
  anchor_entity_id,
  position,
  created_timestamp,
  updated_timestamp
)
select scoped.company_id,
       md5(scoped.company_id::text || ':company_explorer_v2_subscription:' || scoped.owner_type || ':' || scoped.owner_id::text || ':' || scoped.anchor_entity_id::text)::uuid,
       scoped.owner_type,
       scoped.owner_id,
       scoped.anchor_entity_id,
       scoped.position,
       scoped.created_timestamp,
       scoped.updated_timestamp
from scoped_edges scoped
on conflict (company_id, owner_type, owner_id, anchor_entity_id) do update set
  position = excluded.position,
  updated_timestamp = greatest(company_explorer_subscriptions.updated_timestamp, excluded.updated_timestamp);

with ranked_scoped_edges as (
  select edge.ctid,
         edge.company_id,
         edge.child_entity_id,
         row_number() over (
           partition by edge.company_id, edge.child_entity_id
           order by edge.created_timestamp asc, edge.position asc, edge.edge_id asc
         ) as row_number
  from company_explorer_edges edge
  join company_explorer_entities parent
    on parent.company_id=edge.company_id
   and parent.entity_id=edge.parent_entity_id
   and parent.entity_type in ('user', 'user_group')
)
delete from company_explorer_edges edge
using ranked_scoped_edges ranked
where edge.ctid = ranked.ctid
  and ranked.row_number > 1;

with scoped_edges as (
  select edge.ctid,
         edge.company_id,
         edge.child_entity_id,
         company_root.entity_id as company_root_entity_id
  from company_explorer_edges edge
  join company_explorer_entities parent
    on parent.company_id=edge.company_id
   and parent.entity_id=edge.parent_entity_id
   and parent.entity_type in ('user', 'user_group')
  join company_explorer_entities company_root
    on company_root.company_id=edge.company_id
   and company_root.entity_type='company'
   and company_root.resource_id=edge.company_id
)
delete from company_explorer_edges edge
using scoped_edges scoped
where edge.ctid = scoped.ctid
  and exists (
    select 1
    from company_explorer_edges company_edge
    where company_edge.company_id=scoped.company_id
      and company_edge.parent_entity_id=scoped.company_root_entity_id
      and company_edge.child_entity_id=scoped.child_entity_id
  );

with scoped_edges as (
  select edge.ctid,
         edge.company_id,
         edge.child_entity_id,
         company_root.entity_id as company_root_entity_id
  from company_explorer_edges edge
  join company_explorer_entities parent
    on parent.company_id=edge.company_id
   and parent.entity_id=edge.parent_entity_id
   and parent.entity_type in ('user', 'user_group')
  join company_explorer_entities company_root
    on company_root.company_id=edge.company_id
   and company_root.entity_type='company'
   and company_root.resource_id=edge.company_id
)
update company_explorer_edges edge
set parent_entity_id = scoped.company_root_entity_id,
    edge_id = mangorts_company_explorer_v2_edge_id(scoped.company_id, scoped.company_root_entity_id, scoped.child_entity_id),
    updated_timestamp = now()
from scoped_edges scoped
where edge.ctid = scoped.ctid;
with ranked_edges as (
  select ctid,
         row_number() over (
           partition by company_id, child_entity_id
           order by created_timestamp asc, position asc, edge_id asc
         ) as row_number
  from company_explorer_edges
)
delete from company_explorer_edges edge
using ranked_edges ranked
where edge.ctid = ranked.ctid
  and ranked.row_number > 1;

create unique index if not exists idx_company_explorer_edges_one_parent_per_child
  on company_explorer_edges(company_id, child_entity_id);


create index if not exists idx_company_explorer_subscriptions_owner_position
  on company_explorer_subscriptions(company_id, owner_type, owner_id, position, created_timestamp, subscription_id);

create index if not exists idx_company_explorer_subscriptions_anchor
  on company_explorer_subscriptions(company_id, anchor_entity_id, owner_type, owner_id);

with ranked_relationships as (
  select ctid,
         row_number() over (
           partition by company_id, resource_type, resource_id
           order by created_timestamp asc, position asc, relationship_id asc
         ) as row_number
  from project_relationships
)
delete from project_relationships relationship
using ranked_relationships ranked
where relationship.ctid = ranked.ctid
  and ranked.row_number > 1;

create unique index if not exists idx_project_relationships_one_project_per_resource
  on project_relationships(company_id, resource_type, resource_id);