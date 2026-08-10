begin;

select
  current_setting('server_version') as server_version,
  current_setting('server_version_num')::integer as server_version_num,
  case
    when current_setting('server_version_num')::integer between 170000 and 179999 then 'READY'
    else 'STOP: this script supports PostgreSQL 17.x only'
  end as preflight_status;

do $$
begin
  if current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception 'STOP: this script supports PostgreSQL 17.x only';
  end if;
  if to_regclass('public.node_textboxes') is null then
    raise exception 'STOP: public.node_textboxes does not exist';
  end if;
  if to_regclass('public.email_relationships') is null then
    raise exception 'STOP: public.email_relationships does not exist';
  end if;
  if to_regclass('public.schema_migrations') is null then
    raise exception 'STOP: public.schema_migrations does not exist';
  end if;
end;
$$;

alter table public.node_textboxes
  add column if not exists title text not null default '',
  add column if not exists color text;

alter table public.node_textboxes
  drop constraint if exists node_textboxes_email_accent_chk,
  drop column if exists email_accent,
  alter column color drop default,
  alter column color drop not null;

update public.node_textboxes textbox
set color = null
where not exists (
  select 1
  from public.email_relationships relationship
  where relationship.company_id = textbox.company_id
    and relationship.resource_type = 'node'
    and relationship.resource_id = textbox.node_id
    and relationship.resource_textbox_id = textbox.textbox_id::text
);

update public.node_textboxes textbox
set color = '#0EA5E9'
where textbox.color is null
  and exists (
    select 1
    from public.email_relationships relationship
    where relationship.company_id = textbox.company_id
      and relationship.resource_type = 'node'
      and relationship.resource_id = textbox.node_id
      and relationship.resource_textbox_id = textbox.textbox_id::text
  );

alter table public.node_textboxes
  drop constraint if exists node_textboxes_title_chk,
  add constraint node_textboxes_title_chk check (length(title) <= 500),
  drop constraint if exists node_textboxes_color_chk,
  add constraint node_textboxes_color_chk check (color is null or color in (
    '#0EA5E9', '#14B8A6', '#8B5CF6', '#F59E0B', '#22C55E', '#6366F1',
    '#06B6D4', '#84CC16', '#A855F7', '#10B981', '#EAB308', '#3B82F6'
  ));

comment on column public.node_textboxes.color is
  'Optional non-red RGB color used only when this exact Node text box has an email relationship.';

delete from public.schema_migrations
where version in (
  '20260810_z_remove_node_textbox_email_accent.sql',
  '20260810_zz_node_textbox_color.sql',
  '20260810_zzz_node_textbox_email_only_color.sql'
);

insert into public.schema_migrations(version)
values ('20260810_node_textbox_metadata.sql')
on conflict (version) do nothing;

do $$
begin
  if exists (
    select 1
    from public.node_textboxes textbox
    where textbox.color is not null
      and not exists (
        select 1
        from public.email_relationships relationship
        where relationship.company_id = textbox.company_id
          and relationship.resource_type = 'node'
          and relationship.resource_id = textbox.node_id
          and relationship.resource_textbox_id = textbox.textbox_id::text
      )
  ) then
    raise exception 'Node textbox repair did not clear every ordinary textbox color';
  end if;
  if exists (
    select 1
    from public.node_textboxes textbox
    where textbox.color is null
      and exists (
        select 1
        from public.email_relationships relationship
        where relationship.company_id = textbox.company_id
          and relationship.resource_type = 'node'
          and relationship.resource_id = textbox.node_id
          and relationship.resource_textbox_id = textbox.textbox_id::text
      )
  ) then
    raise exception 'Node textbox repair left an email-linked textbox without a color';
  end if;
end;
$$;

select
  count(*) filter (where textbox.color is null) as uncolored_textboxes,
  count(*) filter (where textbox.color is not null) as email_colored_textboxes,
  '20260810_node_textbox_metadata.sql' as recorded_migration
from public.node_textboxes textbox;

commit;
