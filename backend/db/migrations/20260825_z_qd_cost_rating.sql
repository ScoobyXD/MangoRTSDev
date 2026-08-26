-- Add Cost to the shared daily Process rating row. PostgreSQL 17.x compatible.

alter table qd_ratings
  add column cost_rating text;

alter table qd_ratings
  add constraint qd_ratings_cost_rating_chk
    check (cost_rating is null or cost_rating in ('green','yellow','red'));

alter table qd_ratings
  drop constraint qd_ratings_has_rating_chk,
  add constraint qd_ratings_has_rating_chk
    check (quality_rating is not null or cost_rating is not null or delivery_rating is not null);
