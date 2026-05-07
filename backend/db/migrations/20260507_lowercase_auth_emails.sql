update users
set email = lower(btrim(email)),
    updated_timestamp = now()
where email <> lower(btrim(email));

update invitations
set email = lower(btrim(email)),
    updated_timestamp = now()
where email <> lower(btrim(email));

alter table users
  drop constraint if exists users_email_lowercase_chk;

alter table users
  add constraint users_email_lowercase_chk
  check (email = lower(btrim(email)));

alter table invitations
  drop constraint if exists invitations_email_lowercase_chk;

alter table invitations
  add constraint invitations_email_lowercase_chk
  check (email = lower(btrim(email)));
