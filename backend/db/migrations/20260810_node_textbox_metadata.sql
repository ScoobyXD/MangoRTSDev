begin;

alter table node_textboxes
  add column if not exists title text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'node_textboxes'::regclass
      and conname = 'node_textboxes_title_chk'
  ) then
    alter table node_textboxes
      add constraint node_textboxes_title_chk check (length(title) <= 500);
  end if;
end;
$$;

commit;
