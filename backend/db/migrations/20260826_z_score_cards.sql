-- Rename the daily Q/C/D storage table to the product term Score Cards.
-- PostgreSQL 17.x compatible. This migration preserves every existing row.

begin;

do $$
declare
  old_table regclass := to_regclass('public.qd_ratings');
  new_table regclass := to_regclass('public.score_cards');
  expected_new_constraints text[] := array[
    'score_cards_pkey',
    'score_cards_quality_rating_chk',
    'score_cards_cost_rating_chk',
    'score_cards_delivery_rating_chk',
    'score_cards_has_rating_chk',
    'score_cards_display_name_chk',
    'score_cards_timestamps_chk',
    'score_cards_company_id_logic_gate_id_fkey',
    'score_cards_rated_by_user_id_fkey'
  ];
begin
  if old_table is not null and new_table is not null then
    raise exception 'STOP: both qd_ratings and score_cards exist';
  elsif old_table is null and new_table is null then
    raise exception 'STOP: neither qd_ratings nor score_cards exists';
  elsif old_table is not null then
    alter table qd_ratings rename to score_cards;
    alter table score_cards rename constraint qd_ratings_pkey to score_cards_pkey;
    alter table score_cards rename constraint qd_ratings_quality_rating_chk to score_cards_quality_rating_chk;
    alter table score_cards rename constraint qd_ratings_cost_rating_chk to score_cards_cost_rating_chk;
    alter table score_cards rename constraint qd_ratings_delivery_rating_chk to score_cards_delivery_rating_chk;
    alter table score_cards rename constraint qd_ratings_has_rating_chk to score_cards_has_rating_chk;
    alter table score_cards rename constraint qd_ratings_display_name_chk to score_cards_display_name_chk;
    alter table score_cards rename constraint qd_ratings_timestamps_chk to score_cards_timestamps_chk;
    alter table score_cards rename constraint qd_ratings_company_id_logic_gate_id_fkey to score_cards_company_id_logic_gate_id_fkey;
    alter table score_cards rename constraint qd_ratings_rated_by_user_id_fkey to score_cards_rated_by_user_id_fkey;
    alter index uq_qd_ratings_logic_gate_business_day rename to uq_score_cards_logic_gate_business_day;
  elsif (select count(*) from pg_constraint where conrelid=new_table and conname=any(expected_new_constraints))
      <> cardinality(expected_new_constraints)
      or to_regclass('public.uq_score_cards_logic_gate_business_day') is null
      or to_regclass('public.uq_qd_ratings_logic_gate_business_day') is not null then
    raise exception 'STOP: score_cards rename state is incomplete or drifted';
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from recycle_bin_items
    where restore_payload ? 'qd_ratings' and restore_payload ? 'score_cards'
  ) then
    raise exception 'STOP: recycle payload contains both qd_ratings and score_cards';
  end if;
end $$;

update recycle_bin_items
set restore_payload=(restore_payload-'qd_ratings')
  || jsonb_build_object('score_cards',restore_payload->'qd_ratings')
where restore_payload ? 'qd_ratings';

commit;
