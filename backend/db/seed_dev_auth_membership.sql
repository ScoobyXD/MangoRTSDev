\set ON_ERROR_STOP on

begin;

insert into companies (company_id, name, created_timestamp, updated_timestamp)
values (:'company_id'::uuid, :'company_name', now(), now())
on conflict (company_id) do update set
  name = excluded.name,
  updated_timestamp = now();

with existing_user as (
  select user_id
  from users
  where cognito_subject = :'cognito_subject'
),
upserted_user as (
  insert into users (user_id, cognito_subject, email, created_timestamp, updated_timestamp)
  values (
    coalesce((select user_id from existing_user), md5(random()::text || clock_timestamp()::text)::uuid),
    :'cognito_subject',
    lower(btrim(:'user_email')),
    now(),
    now()
  )
  on conflict (cognito_subject) do update set
    email = case when excluded.email <> '' then excluded.email else users.email end,
    updated_timestamp = now()
  returning user_id
)
insert into company_memberships (company_id, user_id, role, created_timestamp, updated_timestamp)
select
  :'company_id'::uuid,
  user_id,
  case :'membership_role'
    when 'owner' then 'company_admin'
    when 'admin' then 'company_admin'
    when 'member' then 'company_user'
    when 'agent' then 'company_user'
    else :'membership_role'
  end,
  now(),
  now()
from upserted_user
on conflict (company_id, user_id) do update set
  role = excluded.role,
  updated_timestamp = now();

commit;
