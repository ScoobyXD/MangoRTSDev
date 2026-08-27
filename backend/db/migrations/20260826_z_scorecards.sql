-- Rename the daily Q/C/D storage table to the product term Score Cards.
-- PostgreSQL 17.x compatible. This migration preserves every existing row.

begin;

do $$
declare
  old_table regclass := to_regclass('public.qd_ratings');
  new_table regclass := to_regclass('public.scorecards');
  expected_new_constraints text[] := array[
    'scorecards_pkey',
    'scorecards_quality_rating_chk',
    'scorecards_cost_rating_chk',
    'scorecards_delivery_rating_chk',
    'scorecards_has_rating_chk',
    'scorecards_display_name_chk',
    'scorecards_timestamps_chk',
    'scorecards_company_id_logic_gate_id_fkey',
    'scorecards_rated_by_user_id_fkey'
  ];
begin
  if old_table is not null and new_table is not null then
    raise exception 'STOP: both qd_ratings and scorecards exist';
  elsif old_table is null and new_table is null then
    raise exception 'STOP: neither qd_ratings nor scorecards exists';
  elsif old_table is not null then
    alter table qd_ratings rename to scorecards;
    alter table scorecards rename constraint qd_ratings_pkey to scorecards_pkey;
    alter table scorecards rename constraint qd_ratings_quality_rating_chk to scorecards_quality_rating_chk;
    alter table scorecards rename constraint qd_ratings_cost_rating_chk to scorecards_cost_rating_chk;
    alter table scorecards rename constraint qd_ratings_delivery_rating_chk to scorecards_delivery_rating_chk;
    alter table scorecards rename constraint qd_ratings_has_rating_chk to scorecards_has_rating_chk;
    alter table scorecards rename constraint qd_ratings_display_name_chk to scorecards_display_name_chk;
    alter table scorecards rename constraint qd_ratings_timestamps_chk to scorecards_timestamps_chk;
    alter table scorecards rename constraint qd_ratings_company_id_logic_gate_id_fkey to scorecards_company_id_logic_gate_id_fkey;
    alter table scorecards rename constraint qd_ratings_rated_by_user_id_fkey to scorecards_rated_by_user_id_fkey;
    alter index uq_qd_ratings_logic_gate_business_day rename to uq_scorecards_logic_gate_business_day;
  elsif (select count(*) from pg_constraint where conrelid=new_table and conname=any(expected_new_constraints))
      <> cardinality(expected_new_constraints)
      or to_regclass('public.uq_scorecards_logic_gate_business_day') is null
      or to_regclass('public.uq_qd_ratings_logic_gate_business_day') is not null then
    raise exception 'STOP: scorecards rename state is incomplete or drifted';
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from recycle_bin_items
    where restore_payload ? 'qd_ratings' and restore_payload ? 'scorecards'
  ) then
    raise exception 'STOP: recycle payload contains both qd_ratings and scorecards';
  end if;
end $$;

update recycle_bin_items
set restore_payload=(restore_payload-'qd_ratings')
  || jsonb_build_object('scorecards',restore_payload->'qd_ratings')
where restore_payload ? 'qd_ratings';

commit;
