do $$
begin
  if exists (
    select 1
    from email_relationships relationship
    where relationship.resource_type='node'
    group by relationship.company_id,relationship.email_thread_id
    having count(distinct relationship.resource_id)>1
  ) then
    raise exception 'email_thread_already_linked_to_multiple_nodes';
  end if;
end;
$$;

drop trigger if exists trg_node_logic_gate_assignment_priority on node_logic_gate_assignments;
drop function if exists enforce_node_logic_gate_assignment_priority();

create or replace function mangorts_enforce_one_node_per_email_thread()
returns trigger language plpgsql as $$
begin
  if new.resource_type <> 'node' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text || ':' || new.email_thread_id::text, 0));
  if exists (
    select 1
    from email_relationships relationship
    where relationship.company_id=new.company_id
      and relationship.email_thread_id=new.email_thread_id
      and relationship.resource_type='node'
      and relationship.resource_id<>new.resource_id
      and relationship.email_relationship_id<>new.email_relationship_id
  ) then
    raise exception 'email_thread_already_linked_to_another_node' using errcode='23505';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_email_relationships_one_node_per_thread on email_relationships;
create trigger trg_email_relationships_one_node_per_thread
before insert or update of company_id,email_thread_id,resource_type,resource_id
on email_relationships
for each row execute function mangorts_enforce_one_node_per_email_thread();
