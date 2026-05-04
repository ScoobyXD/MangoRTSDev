-- The current Editor has one document surface per node or logic gate.
-- Keep append-only history rows, but collapse hot Text box projections to
-- one current row so UI clients and headless agents read a deterministic value.

with ranked_node_text as (
  select ctid,
         row_number() over (
           partition by company_id, node_id, type
           order by updated_timestamp desc, created_timestamp desc, information_id desc
         ) as rn
  from node_projection_table
  where type = 'Text box'::information_type
)
delete from node_projection_table target
using ranked_node_text ranked
where target.ctid = ranked.ctid
  and ranked.rn > 1;

create unique index if not exists idx_node_projection_table_one_text_box
  on node_projection_table(company_id, node_id, type)
  where type = 'Text box'::information_type;

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

create unique index if not exists idx_logic_gate_projection_table_one_text_box
  on logic_gate_projection_table(company_id, logic_gate_id, type)
  where type = 'Text box'::information_type;
