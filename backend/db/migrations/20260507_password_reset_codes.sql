create table if not exists password_reset_codes (
  reset_id uuid not null,
  email text not null,
  code_hash text not null,
  code_salt text not null,
  status text not null default 'pending',
  expires_timestamp timestamptz not null,
  used_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint password_reset_codes_email_nonblank_chk check (btrim(email) <> ''),
  constraint password_reset_codes_email_lowercase_chk check (email = lower(btrim(email))),
  constraint password_reset_codes_code_hash_nonblank_chk check (btrim(code_hash) <> ''),
  constraint password_reset_codes_code_salt_nonblank_chk check (btrim(code_salt) <> ''),
  constraint password_reset_codes_status_chk check (status in ('pending', 'used', 'revoked')),
  primary key (reset_id)
);

create index if not exists idx_password_reset_codes_email_status_created
  on password_reset_codes(email, status, created_timestamp desc);

with ranked_pending_password_resets as (
  select
    reset_id,
    row_number() over (
      partition by email
      order by created_timestamp desc, reset_id desc
    ) as rn
  from password_reset_codes
  where status = 'pending'
)
update password_reset_codes reset
set status = 'revoked',
    updated_timestamp = now()
from ranked_pending_password_resets ranked
where reset.reset_id = ranked.reset_id
  and ranked.rn > 1;

create unique index if not exists idx_password_reset_codes_one_pending_email
  on password_reset_codes(email)
  where status = 'pending';
