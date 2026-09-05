-- Process Step SOP storage. Plain PostgreSQL SQL for a human operator in DBeaver.
BEGIN;
SELECT current_setting('server_version') AS connected_postgresql_version;
DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 170000
     OR current_setting('server_version_num')::integer >= 190000 THEN
    RAISE EXCEPTION 'STOP: Process Step SOPs require PostgreSQL 17 or 18';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='process_steps') <> 7
     OR (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='process_steps'
           AND column_name = ANY (ARRAY['company_id','process_step_id','logic_gate_id','name','position','created_timestamp','updated_timestamp'])) <> 7 THEN
    RAISE EXCEPTION 'STOP: process_steps has unexpected columns or this change already ran';
  END IF;
END;
$$;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE public.process_steps
  ADD COLUMN body_json jsonb NOT NULL DEFAULT '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb,
  ADD COLUMN revision bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT process_steps_revision_chk CHECK (revision >= 0),
  ADD CONSTRAINT process_steps_body_json_chk CHECK ((
    body_json->>'format' = 'mango-tiptap-json'
    AND body_json->>'schema_version' = '1'
    AND body_json->'document'->>'type' = 'doc'
    AND jsonb_typeof(body_json->'annotations') = 'array'
  ) IS TRUE);

ALTER TABLE public.logic_gate_textboxes_history
  ADD COLUMN resource_type text NOT NULL DEFAULT 'logic_gate',
  ADD CONSTRAINT logic_gate_textboxes_history_resource_type_chk CHECK (resource_type IN ('logic_gate','process_step')),
  DROP CONSTRAINT logic_gate_textboxes_history_pkey,
  ADD CONSTRAINT logic_gate_textboxes_history_pkey PRIMARY KEY (company_id,logic_gate_id,batch_id,resource_type,textbox_id);

-- Convert previously captured Step rows once, so restore uses the current row
-- shape directly and does not need a runtime compatibility reader.
UPDATE public.recycle_bin_items item
SET restore_payload = jsonb_set(item.restore_payload, '{process_steps}', (
  SELECT coalesce(jsonb_agg(saved.step || jsonb_build_object(
    'body_json', '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb,
    'revision', 0
  )), '[]'::jsonb)
  FROM jsonb_array_elements(item.restore_payload->'process_steps') saved(step)
))
WHERE jsonb_typeof(item.restore_payload->'process_steps') = 'array';

UPDATE public.recycle_bin_items item
SET restore_payload = jsonb_set(item.restore_payload, '{logic_gate_textboxes_history}', (
  SELECT coalesce(jsonb_agg(saved.history || jsonb_build_object('resource_type','logic_gate')), '[]'::jsonb)
  FROM jsonb_array_elements(item.restore_payload->'logic_gate_textboxes_history') saved(history)
))
WHERE jsonb_typeof(item.restore_payload->'logic_gate_textboxes_history') = 'array';

CREATE OR REPLACE FUNCTION public.mangorts_enforce_logic_gate_editor_text_limit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  total_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'editor-owner-text:' || new.company_id::text || ':logic_gate:' || new.logic_gate_id::text, 0
  ));
  select coalesce(sum(octet_length(textbox.body_json::text)),0)
    into total_bytes
    from logic_gate_textboxes textbox
   where textbox.company_id=new.company_id
     and textbox.logic_gate_id=new.logic_gate_id
     and textbox.deleted_timestamp is null
     and textbox.textbox_id<>new.textbox_id;
  total_bytes := total_bytes + (
    select coalesce(sum(octet_length(step.body_json::text)),0)
    from process_steps step
    where step.company_id=new.company_id and step.logic_gate_id=new.logic_gate_id
  );
  if new.deleted_timestamp is null then
    total_bytes := total_bytes + octet_length(new.body_json::text);
  end if;
  if total_bytes > 1073741824 then
    raise exception 'editor_owner_text_limit_exceeded'
      using errcode='P0001',
            detail='The one-GiB limit counts current editor text documents only; attachment object bytes are excluded.';
  end if;
  return new;
end;
$$;

CREATE FUNCTION public.mangorts_enforce_process_step_editor_text_limit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  total_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'editor-owner-text:' || new.company_id::text || ':logic_gate:' || new.logic_gate_id::text, 0
  ));
  select coalesce(sum(octet_length(step.body_json::text)),0)
    into total_bytes
    from process_steps step
   where step.company_id=new.company_id and step.logic_gate_id=new.logic_gate_id
     and step.process_step_id<>new.process_step_id;
  total_bytes := total_bytes + octet_length(new.body_json::text) + (
    select coalesce(sum(octet_length(textbox.body_json::text)),0)
    from logic_gate_textboxes textbox
    where textbox.company_id=new.company_id and textbox.logic_gate_id=new.logic_gate_id
      and textbox.deleted_timestamp is null
  );
  if total_bytes > 1073741824 then
    raise exception 'editor_owner_text_limit_exceeded'
      using errcode='P0001',
            detail='The one-GiB limit counts current editor text documents only; attachment object bytes are excluded.';
  end if;
  return new;
end;
$$;

CREATE TRIGGER trg_process_step_editor_text_limit BEFORE INSERT OR UPDATE OF body_json ON public.process_steps
  FOR EACH ROW EXECUTE FUNCTION public.mangorts_enforce_process_step_editor_text_limit();

DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    INSERT INTO public.schema_migrations(version) VALUES ('20260905_process_step_sop_bodies.sql')
    ON CONFLICT (version) DO NOTHING;
  END IF;
END;
$$;
COMMIT;
