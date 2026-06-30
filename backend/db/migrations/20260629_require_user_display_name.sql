update users
set display_name = coalesce(nullif(btrim(email), ''), user_id::text),
    updated_timestamp = now()
where btrim(display_name) = '';

alter table users
  drop constraint if exists users_display_name_nonblank_chk;

alter table users
  alter column display_name drop default;

alter table users
  add constraint users_display_name_nonblank_chk check (btrim(display_name) <> '');
