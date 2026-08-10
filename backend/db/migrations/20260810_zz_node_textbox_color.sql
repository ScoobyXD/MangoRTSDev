alter table node_textboxes
  drop constraint if exists node_textboxes_email_accent_chk,
  drop column if exists email_accent;

alter table node_textboxes
  add column if not exists color text not null default '#0EA5E9';

alter table node_textboxes
  drop constraint if exists node_textboxes_color_chk,
  add constraint node_textboxes_color_chk check (color in (
    '#0EA5E9', '#14B8A6', '#8B5CF6', '#F59E0B', '#22C55E', '#6366F1',
    '#06B6D4', '#84CC16', '#A855F7', '#10B981', '#EAB308', '#3B82F6'
  ));

comment on column node_textboxes.color is
  'Explicit non-red RGB color used by this exact Node text box.';
