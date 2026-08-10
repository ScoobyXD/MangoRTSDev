begin;

alter table node_textboxes
  add column if not exists title text not null default '',
  add column if not exists color text;

alter table node_textboxes
  drop constraint if exists node_textboxes_email_accent_chk,
  drop column if exists email_accent,
  alter column color drop default,
  alter column color drop not null;

update node_textboxes textbox
set color = null
where not exists (
  select 1
  from email_relationships relationship
  where relationship.company_id = textbox.company_id
    and relationship.resource_type = 'node'
    and relationship.resource_id = textbox.node_id
    and relationship.resource_textbox_id = textbox.textbox_id::text
);

update node_textboxes textbox
set color = '#0EA5E9'
where textbox.color is null
  and exists (
    select 1
    from email_relationships relationship
    where relationship.company_id = textbox.company_id
      and relationship.resource_type = 'node'
      and relationship.resource_id = textbox.node_id
      and relationship.resource_textbox_id = textbox.textbox_id::text
  );

alter table node_textboxes
  drop constraint if exists node_textboxes_title_chk,
  add constraint node_textboxes_title_chk check (length(title) <= 500),
  drop constraint if exists node_textboxes_color_chk,
  add constraint node_textboxes_color_chk check (color is null or color in (
    '#0EA5E9', '#14B8A6', '#8B5CF6', '#F59E0B', '#22C55E', '#6366F1',
    '#06B6D4', '#84CC16', '#A855F7', '#10B981', '#EAB308', '#3B82F6'
  ));

comment on column node_textboxes.color is
  'Optional non-red RGB color used only when this exact Node text box has an email relationship.';

commit;
