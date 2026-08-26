-- Daily Process quality and delivery ratings. PostgreSQL 17.x compatible.

create table qd_ratings (
  company_id uuid not null,
  qd_rating_id uuid not null,
  logic_gate_id uuid not null,
  quality_rating text,
  delivery_rating text,
  rated_by_user_id uuid,
  rated_by_display_name text not null,
  rated_created_timestamp timestamptz not null default now(),
  rated_updated_timestamp timestamptz not null default now(),
  primary key (company_id,qd_rating_id),
  foreign key (company_id,logic_gate_id)
    references logic_gates(company_id,logic_gate_id) on delete cascade,
  foreign key (rated_by_user_id) references users(user_id) on delete set null,
  constraint qd_ratings_quality_rating_chk
    check (quality_rating is null or quality_rating in ('green','yellow','red')),
  constraint qd_ratings_delivery_rating_chk
    check (delivery_rating is null or delivery_rating in ('green','yellow','red')),
  constraint qd_ratings_has_rating_chk check (quality_rating is not null or delivery_rating is not null),
  constraint qd_ratings_display_name_chk check (btrim(rated_by_display_name) <> ''),
  constraint qd_ratings_timestamps_chk check (rated_updated_timestamp >= rated_created_timestamp)
);

create unique index uq_qd_ratings_logic_gate_business_day
  on qd_ratings (
    company_id,
    logic_gate_id,
    ((rated_created_timestamp at time zone 'America/Los_Angeles')::date)
  );
