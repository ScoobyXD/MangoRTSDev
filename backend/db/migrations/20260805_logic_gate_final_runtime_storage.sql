-- Final Logic Gate editor metadata storage.
--
-- This migration is additive and safe to apply before the application cutover.
-- The separately operated copy/verify and retirement scripts own legacy data
-- reconciliation and destructive table removal.

do $$
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 190000 then
    raise exception 'logic_gate_final_storage_requires_postgresql_17_or_18';
  end if;
end $$;

alter table logic_gate_textboxes
  add column if not exists title text not null default '',
  add column if not exists email_message_id text not null default '',
  add column if not exists email_accent text not null default '',
  add column if not exists metadata_revision bigint not null default 1;

alter table logic_gate_textboxes
  drop constraint if exists logic_gate_textboxes_metadata_revision_chk,
  add constraint logic_gate_textboxes_metadata_revision_chk check (metadata_revision > 0),
  drop constraint if exists logic_gate_textboxes_title_chk,
  add constraint logic_gate_textboxes_title_chk check (length(title) <= 500),
  drop constraint if exists logic_gate_textboxes_email_accent_chk,
  add constraint logic_gate_textboxes_email_accent_chk check (
    email_accent='' or email_accent ~ '^#[0-9A-Fa-f]{6}$'
  );

comment on table logic_gate_textboxes is
  'Final Logic Gate editor documents and projection metadata. Logic Gate has one current editor document and no textbox chat feature.';
