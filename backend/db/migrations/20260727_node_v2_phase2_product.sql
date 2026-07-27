-- Node v2 Phase 2 product metadata. This remains additive and does not cut
-- over, backfill, or delete any legacy editor data.
begin;

alter table node_textboxes
  add column if not exists display_order bigint not null default 0,
  add column if not exists creation_idempotency_key text;

alter table node_textboxes
  drop constraint if exists node_textboxes_creation_idempotency_chk,
  add constraint node_textboxes_creation_idempotency_chk check (
    creation_idempotency_key is null
    or (btrim(creation_idempotency_key) <> '' and octet_length(creation_idempotency_key) <= 160)
  );

create unique index if not exists idx_node_textboxes_creation_idempotency
  on node_textboxes(company_id, node_id, creation_idempotency_key)
  where creation_idempotency_key is not null;

create index if not exists idx_node_textboxes_node_order
  on node_textboxes(company_id, node_id, display_order, textbox_id)
  where deleted_timestamp is null;

alter table node_textbox_comment_threads
  add column if not exists idempotency_key text;

alter table node_textbox_comment_threads
  drop constraint if exists node_textbox_comment_threads_idempotency_chk,
  add constraint node_textbox_comment_threads_idempotency_chk check (
    idempotency_key is null
    or (btrim(idempotency_key) <> '' and octet_length(idempotency_key) <= 160)
  );

create unique index if not exists idx_node_textbox_comment_threads_idempotency
  on node_textbox_comment_threads(company_id, node_id, textbox_id, idempotency_key)
  where idempotency_key is not null;

alter table node_textbox_comments
  add column if not exists idempotency_key text;

alter table node_textbox_comments
  drop constraint if exists node_textbox_comments_idempotency_chk,
  add constraint node_textbox_comments_idempotency_chk check (
    idempotency_key is null
    or (btrim(idempotency_key) <> '' and octet_length(idempotency_key) <= 160)
  );

create unique index if not exists idx_node_textbox_comments_idempotency
  on node_textbox_comments(company_id, node_id, textbox_id, idempotency_key)
  where idempotency_key is not null;

comment on column node_textboxes.display_order is
  'User-controlled Node workspace order. Timeline order remains immutable creation/event order.';
comment on column node_textboxes.creation_idempotency_key is
  'Stable create-command key; retries return the originally committed text box and timeline item.';

commit;
