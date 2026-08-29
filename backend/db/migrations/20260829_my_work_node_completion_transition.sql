alter table nodes
  add column if not exists completion_transition_timestamp timestamptz;

with node_snapshots as (
  select event.company_id,
         event.payload #>> '{node,node_id}' as node_id,
         event.sequence,
         event.created_timestamp,
         lower(btrim(coalesce(event.payload #>> '{node,status}', ''))) as status
  from domain_events event
  where event.stream_type = 'workspace'
    and event.stream_id = event.company_id::text
    and event.event_type in ('node_created', 'node_updated')
    and jsonb_typeof(event.payload -> 'node') = 'object'
    and (event.payload -> 'node') ? 'status'
    and btrim(coalesce(event.payload #>> '{node,node_id}', '')) <> ''
), sequenced_node_snapshots as (
  select snapshot.*,
         lag(snapshot.status) over (
           partition by snapshot.company_id, snapshot.node_id
           order by snapshot.sequence
         ) as previous_status
  from node_snapshots snapshot
), latest_node_completions as (
  select distinct on (snapshot.company_id, snapshot.node_id)
         snapshot.company_id,
         snapshot.node_id,
         snapshot.created_timestamp
  from sequenced_node_snapshots snapshot
  where snapshot.status in ('done', 'complete', 'completed')
    and snapshot.previous_status is not null
    and snapshot.previous_status not in ('done', 'complete', 'completed')
  order by snapshot.company_id, snapshot.node_id, snapshot.sequence desc
), projected as (
  select node.company_id,
         node.node_id,
         case
           when lower(btrim(coalesce(node.status, ''))) in ('done', 'complete', 'completed')
             then coalesce(completion.created_timestamp, node.created_timestamp)
           else null
         end as transition_timestamp
  from nodes node
  left join latest_node_completions completion
    on completion.company_id = node.company_id
   and completion.node_id = node.node_id::text
)
update nodes node
set completion_transition_timestamp = projected.transition_timestamp
from projected
where node.company_id = projected.company_id
  and node.node_id = projected.node_id
  and node.completion_transition_timestamp is distinct from projected.transition_timestamp;

create index if not exists idx_nodes_completion_transition
  on nodes(company_id, completion_transition_timestamp desc, node_id)
  where completion_transition_timestamp is not null;
