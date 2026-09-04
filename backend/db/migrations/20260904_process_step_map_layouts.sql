-- Human-run forward migration. Supports PostgreSQL 17 and 18.
-- Adds only internal Process presentation; existing Steps, Nodes and company map stay intact.
BEGIN;
SELECT current_setting('server_version') AS connected_postgresql_version;
DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 170000
     OR current_setting('server_version_num')::integer >= 190000 THEN
    RAISE EXCEPTION 'STOP: Process Step map requires PostgreSQL 17 or 18';
  END IF;
  IF to_regclass('public.process_steps') IS NULL
     OR to_regclass('public.resource_operational_relationships') IS NULL THEN
    RAISE EXCEPTION 'STOP: apply the Process Steps schema before this migration';
  END IF;
END;
$$;

-- Storage begins
CREATE SEQUENCE public.process_step_map_revision_sequence AS bigint;

CREATE TABLE public.process_step_map_layouts (
    company_id uuid NOT NULL,
    logic_gate_id uuid NOT NULL,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    routes jsonb DEFAULT '[]'::jsonb NOT NULL,
    revision bigint NOT NULL,
    updated_timestamp timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT process_step_map_layouts_pkey PRIMARY KEY (company_id,logic_gate_id),
    CONSTRAINT process_step_map_layouts_owner_fkey FOREIGN KEY (company_id,logic_gate_id)
      REFERENCES public.logic_gates(company_id,logic_gate_id) ON DELETE CASCADE,
    CONSTRAINT process_step_map_layouts_steps_chk CHECK (jsonb_typeof(steps)='array' AND jsonb_array_length(steps)<=10000),
    CONSTRAINT process_step_map_layouts_routes_chk CHECK (jsonb_typeof(routes)='array' AND jsonb_array_length(routes)<=20000),
    CONSTRAINT process_step_map_layouts_revision_chk CHECK (revision>0)
);

CREATE FUNCTION public.trg_process_step_map_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Always fresh, including restoring a row with its old saved revision.
  NEW.revision := nextval('public.process_step_map_revision_sequence');
  NEW.updated_timestamp := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_process_step_map_revision BEFORE INSERT OR UPDATE
ON public.process_step_map_layouts FOR EACH ROW EXECUTE FUNCTION public.trg_process_step_map_revision();

CREATE FUNCTION public.trg_process_step_map_prune_step() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.process_step_map_layouts layout
  SET steps=coalesce((SELECT jsonb_agg(rectangle) FROM jsonb_array_elements(layout.steps) rectangle
                     WHERE rectangle->>'process_step_id'<>OLD.process_step_id::text),'[]'::jsonb)
  WHERE layout.company_id=OLD.company_id AND layout.logic_gate_id=OLD.logic_gate_id
    AND layout.steps @> jsonb_build_array(jsonb_build_object('process_step_id',OLD.process_step_id::text));
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_process_step_map_prune_step AFTER DELETE ON public.process_steps
FOR EACH ROW EXECUTE FUNCTION public.trg_process_step_map_prune_step();

CREATE FUNCTION public.trg_process_step_map_prune_route() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source_resource_type='process_step' AND OLD.target_resource_type='process_step' THEN
    UPDATE public.process_step_map_layouts layout
    SET routes=coalesce((SELECT jsonb_agg(route) FROM jsonb_array_elements(layout.routes) route
                         WHERE route->>'resource_operational_relationship_id'<>OLD.resource_operational_relationship_id::text),'[]'::jsonb)
    WHERE layout.company_id=OLD.company_id
      AND layout.routes @> jsonb_build_array(jsonb_build_object('resource_operational_relationship_id',OLD.resource_operational_relationship_id::text));
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_process_step_map_prune_route AFTER DELETE ON public.resource_operational_relationships
FOR EACH ROW EXECUTE FUNCTION public.trg_process_step_map_prune_route();
-- Storage ends
COMMIT;
