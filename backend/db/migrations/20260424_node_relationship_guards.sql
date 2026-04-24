-- Adds invariant guards for node_relationships.
-- Idempotent for environments where constraints may already exist.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'node_relationships_position_pair_chk'
  ) then
    alter table node_relationships
      add constraint node_relationships_position_pair_chk check (
        (a_position = 'Parent' and b_position = 'Child')
        or (a_position = 'Child' and b_position = 'Parent')
        or (a_position = 'Peer' and b_position = 'Peer')
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'node_relationships_not_self_chk'
  ) then
    alter table node_relationships
      add constraint node_relationships_not_self_chk
      check (node_id_a <> node_id_b);
  end if;
end $$;
