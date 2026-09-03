-- Emergency rollback for backend/db/migrations/20260903_process_steps.sql.
-- Run only with the application stopped and only after taking a database backup.
-- Paste this entire file into DBeaver and execute it as one script.
--
-- This restores the pre-Process-Steps database shape. The forward migration
-- permanently removed the original compatibility card IDs, so this rollback
-- deterministically uses assignment_id as compatibility_card_id. It archives
-- all Process Step rows, placements, edges, and affected recycle payloads in
-- the mangorts_process_steps_rollback_20260903 schema before removing them from
-- the live public schema.

BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '5s';

SELECT current_setting('server_version') AS connected_postgresql_version;

DO $$
DECLARE
  assignment_column_count integer;
  process_step_column_count integer;
BEGIN
  IF current_setting('server_version_num')::integer < 170000
     OR current_setting('server_version_num')::integer >= 190000 THEN
    RAISE EXCEPTION 'STOP: this rollback supports PostgreSQL 17 and 18 only';
  END IF;

  IF to_regclass('public.process_steps') IS NULL
     AND to_regclass('public.kanban_board_projection') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='node_logic_gate_assignments'
         AND column_name='status_key'
     ) THEN
    RAISE EXCEPTION 'STOP: the database is already rolled back';
  END IF;

  IF to_regclass('public.process_steps') IS NULL
     OR to_regclass('public.kanban_board_projection') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: database is not in the complete Process Steps cutover shape';
  END IF;

  SELECT count(*) INTO process_step_column_count
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='process_steps';
  IF process_step_column_count <> 7 OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='process_steps'
      AND column_name NOT IN (
        'company_id','process_step_id','logic_gate_id','name','position',
        'created_timestamp','updated_timestamp'
      )
  ) THEN
    RAISE EXCEPTION 'STOP: process_steps has unexpected schema drift';
  END IF;

  SELECT count(*) INTO assignment_column_count
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='node_logic_gate_assignments';
  IF assignment_column_count <> 12 OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='node_logic_gate_assignments'
      AND column_name NOT IN (
        'assignment_id','company_id','node_id','logic_gate_id','process_step_id',
        'is_issue','position','version','created_timestamp','updated_timestamp',
        'requested_by_user_id','placed_by_user_id'
      )
  ) THEN
    RAISE EXCEPTION 'STOP: node_logic_gate_assignments has unexpected schema drift';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.node_logic_gate_assignments'::regclass
      AND conname='node_logic_gate_assignments_step_fkey'
  ) THEN
    RAISE EXCEPTION 'STOP: Process Steps assignment foreign key is missing';
  END IF;

  IF to_regnamespace('mangorts_process_steps_rollback_20260903') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: rollback archive schema already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM node_logic_gate_assignments assignment
    JOIN nodes node
      ON node.company_id=assignment.company_id AND node.node_id=assignment.node_id
    WHERE lower(replace(replace(btrim(coalesce(node.status,'')),'_',' '),'-',' ')) NOT IN
      ('requested','request','requests','r','backlog','backlogs','b','pending','p',
       'in progress','inprogress','ip','review','done','d')
  ) THEN
    RAISE EXCEPTION 'STOP: an assigned Node has a status that cannot be converted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM resource_gvic_assignments
    WHERE resource_type NOT IN (
      'node','logic_gate','project','shared_triage_folder','shared_inbox',
      'huddle_logic_gate','huddle_node'
    )
  ) THEN
    RAISE EXCEPTION 'STOP: a RACI row uses a resource type unsupported by the old schema';
  END IF;

  IF EXISTS (
    SELECT 1 FROM recycle_bin_items
    WHERE jsonb_typeof(restore_payload) <> 'object'
       OR (restore_payload ? 'nodes' AND jsonb_typeof(restore_payload->'nodes') <> 'array')
       OR (restore_payload ? 'node_logic_gate_assignments'
           AND jsonb_typeof(restore_payload->'node_logic_gate_assignments') <> 'array')
       OR (restore_payload ? 'resource_operational_relationships'
           AND jsonb_typeof(restore_payload->'resource_operational_relationships') <> 'array')
  ) THEN
    RAISE EXCEPTION 'STOP: a recycle payload has an invalid affected collection';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM recycle_bin_items item
    CROSS JOIN LATERAL jsonb_array_elements(
      coalesce(item.restore_payload->'node_logic_gate_assignments','[]'::jsonb)
    ) assignment(row_json)
    WHERE jsonb_typeof(assignment.row_json) <> 'object'
       OR NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(coalesce(item.restore_payload->'nodes','[]'::jsonb)) node(row_json)
         WHERE node.row_json->>'company_id'=assignment.row_json->>'company_id'
           AND node.row_json->>'node_id'=assignment.row_json->>'node_id'
           AND lower(replace(replace(btrim(coalesce(node.row_json->>'status','')),'_',' '),'-',' ')) IN
             ('requested','request','requests','r','backlog','backlogs','b','pending','p',
              'in progress','inprogress','ip','review','done','d')
       )
  ) THEN
    RAISE EXCEPTION 'STOP: a recycled assignment lacks a matching Node with a convertible status';
  END IF;
END $$;

LOCK TABLE nodes, node_logic_gate_assignments, process_steps,
  resource_operational_relationships, process_map_traces, recycle_bin_items,
  resource_gvic_assignments, resource_permission_settings, resource_gvic_settings
  IN SHARE ROW EXCLUSIVE MODE;

CREATE SCHEMA mangorts_process_steps_rollback_20260903;

CREATE TABLE mangorts_process_steps_rollback_20260903.process_steps AS
SELECT * FROM public.process_steps;

CREATE TABLE mangorts_process_steps_rollback_20260903.node_step_placements AS
SELECT company_id, assignment_id, node_id, logic_gate_id, process_step_id
FROM public.node_logic_gate_assignments
WHERE process_step_id IS NOT NULL;

CREATE TABLE mangorts_process_steps_rollback_20260903.step_relationships AS
SELECT *
FROM public.resource_operational_relationships
WHERE source_resource_type='process_step' OR target_resource_type='process_step';

CREATE TABLE mangorts_process_steps_rollback_20260903.recycle_payloads AS
SELECT company_id, recycle_bin_item_id, restore_payload
FROM public.recycle_bin_items
WHERE restore_payload ?| ARRAY[
  'process_steps','node_logic_gate_assignments','kanban_board_projection',
  'resource_operational_relationships'
];

-- Rebuild the old assignment fields from the current canonical Node status.
ALTER TABLE public.node_logic_gate_assignments
  DROP CONSTRAINT node_logic_gate_assignments_step_fkey;
DROP INDEX public.idx_node_logic_gate_assignments_logic_gate_position;

ALTER TABLE public.node_logic_gate_assignments
  ADD COLUMN status_key text,
  ADD COLUMN column_id text,
  ADD COLUMN compatibility_board_id text,
  ADD COLUMN compatibility_card_id uuid;

UPDATE public.node_logic_gate_assignments assignment
SET status_key = CASE lower(replace(replace(btrim(node.status),'_',' '),'-',' '))
      WHEN 'requested' THEN 'requested' WHEN 'request' THEN 'requested'
      WHEN 'requests' THEN 'requested' WHEN 'r' THEN 'requested'
      WHEN 'backlog' THEN 'backlog' WHEN 'backlogs' THEN 'backlog' WHEN 'b' THEN 'backlog'
      WHEN 'pending' THEN 'pending' WHEN 'p' THEN 'pending'
      WHEN 'in progress' THEN 'in_progress' WHEN 'inprogress' THEN 'in_progress' WHEN 'ip' THEN 'in_progress'
      WHEN 'review' THEN 'review'
      WHEN 'done' THEN 'done' WHEN 'd' THEN 'done'
    END,
    column_id = CASE lower(replace(replace(btrim(node.status),'_',' '),'-',' '))
      WHEN 'requested' THEN 'requested' WHEN 'request' THEN 'requested'
      WHEN 'requests' THEN 'requested' WHEN 'r' THEN 'requested'
      WHEN 'backlog' THEN 'backlog' WHEN 'backlogs' THEN 'backlog' WHEN 'b' THEN 'backlog'
      WHEN 'pending' THEN 'pending' WHEN 'p' THEN 'pending'
      WHEN 'in progress' THEN 'in_progress' WHEN 'inprogress' THEN 'in_progress' WHEN 'ip' THEN 'in_progress'
      WHEN 'review' THEN 'review'
      WHEN 'done' THEN 'done' WHEN 'd' THEN 'done'
    END,
    compatibility_board_id = 'logic-gate:' || assignment.logic_gate_id::text,
    compatibility_card_id = assignment.assignment_id
FROM public.nodes node
WHERE node.company_id=assignment.company_id AND node.node_id=assignment.node_id;

ALTER TABLE public.node_logic_gate_assignments
  ALTER COLUMN status_key SET NOT NULL,
  ALTER COLUMN column_id SET NOT NULL,
  ALTER COLUMN compatibility_board_id SET NOT NULL,
  ALTER COLUMN compatibility_card_id SET NOT NULL,
  ADD CONSTRAINT node_logic_gate_assignments_status_key_chk CHECK (btrim(status_key)<>''),
  DROP COLUMN process_step_id;

CREATE UNIQUE INDEX idx_node_logic_gate_assignments_compat_card
  ON public.node_logic_gate_assignments(company_id,compatibility_board_id,compatibility_card_id);
CREATE INDEX idx_node_logic_gate_assignments_logic_gate_position
  ON public.node_logic_gate_assignments(company_id,logic_gate_id,column_id,position,updated_timestamp DESC);

-- Convert affected recycle payloads for the old restore code.
UPDATE public.recycle_bin_items item
SET restore_payload =
  (item.restore_payload - 'process_steps' - 'node_logic_gate_assignments'
    - 'kanban_board_projection' - 'resource_operational_relationships')
  || CASE WHEN item.restore_payload ? 'node_logic_gate_assignments' THEN
    jsonb_build_object('node_logic_gate_assignments',coalesce((
      SELECT jsonb_agg(
        (assignment.row_json - 'process_step_id') || jsonb_build_object(
          'status_key', status_values.status_key,
          'column_id', status_values.status_key,
          'compatibility_board_id', concat('logic-gate:',assignment.row_json->>'logic_gate_id'),
          'compatibility_card_id', assignment.row_json->>'assignment_id'
        ) ORDER BY assignment.ordinality
      )
      FROM jsonb_array_elements(item.restore_payload->'node_logic_gate_assignments')
        WITH ORDINALITY assignment(row_json,ordinality)
      JOIN LATERAL (
        SELECT CASE lower(replace(replace(btrim(node.row_json->>'status'),'_',' '),'-',' '))
          WHEN 'requested' THEN 'requested' WHEN 'request' THEN 'requested'
          WHEN 'requests' THEN 'requested' WHEN 'r' THEN 'requested'
          WHEN 'backlog' THEN 'backlog' WHEN 'backlogs' THEN 'backlog' WHEN 'b' THEN 'backlog'
          WHEN 'pending' THEN 'pending' WHEN 'p' THEN 'pending'
          WHEN 'in progress' THEN 'in_progress' WHEN 'inprogress' THEN 'in_progress' WHEN 'ip' THEN 'in_progress'
          WHEN 'review' THEN 'review'
          WHEN 'done' THEN 'done' WHEN 'd' THEN 'done'
        END AS status_key
        FROM jsonb_array_elements(item.restore_payload->'nodes') node(row_json)
        WHERE node.row_json->>'company_id'=assignment.row_json->>'company_id'
          AND node.row_json->>'node_id'=assignment.row_json->>'node_id'
        LIMIT 1
      ) status_values ON true
    ),'[]'::jsonb))
  ELSE '{}'::jsonb END
  || CASE WHEN item.restore_payload ? 'node_logic_gate_assignments' THEN
    jsonb_build_object('kanban_board_projection',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'company_id', assignment.row_json->'company_id',
        'logic_gate_id', assignment.row_json->'logic_gate_id',
        'node_id', assignment.row_json->'node_id',
        'status', status_values.status_key,
        'column_id', status_values.status_key,
        'position', assignment.row_json->'position',
        'title', node.row_json->'name',
        'priority', node.row_json->'priority',
        'is_issue', assignment.row_json->'is_issue',
        'due_date', node.row_json->'due_date',
        'node_created_timestamp', node.row_json->'created_timestamp',
        'node_updated_timestamp', coalesce(node.row_json->'updated_timestamp',assignment.row_json->'updated_timestamp'),
        'assignment_id', assignment.row_json->'assignment_id',
        'assignment_created_timestamp', assignment.row_json->'created_timestamp',
        'assignment_updated_timestamp', assignment.row_json->'updated_timestamp',
        'compatibility_board_id', concat('logic-gate:',assignment.row_json->>'logic_gate_id'),
        'compatibility_card_id', assignment.row_json->>'assignment_id',
        'projection_updated_timestamp', assignment.row_json->'updated_timestamp',
        'accounts', '[]'::jsonb,
        'requested_by_user_id', assignment.row_json->'requested_by_user_id',
        'placed_by_user_id', assignment.row_json->'placed_by_user_id'
      ) ORDER BY assignment.ordinality)
      FROM jsonb_array_elements(item.restore_payload->'node_logic_gate_assignments')
        WITH ORDINALITY assignment(row_json,ordinality)
      JOIN LATERAL (
        SELECT saved_node.row_json
        FROM jsonb_array_elements(item.restore_payload->'nodes') saved_node(row_json)
        WHERE saved_node.row_json->>'company_id'=assignment.row_json->>'company_id'
          AND saved_node.row_json->>'node_id'=assignment.row_json->>'node_id'
        LIMIT 1
      ) node ON true
      JOIN LATERAL (
        SELECT CASE lower(replace(replace(btrim(node.row_json->>'status'),'_',' '),'-',' '))
          WHEN 'requested' THEN 'requested' WHEN 'request' THEN 'requested'
          WHEN 'requests' THEN 'requested' WHEN 'r' THEN 'requested'
          WHEN 'backlog' THEN 'backlog' WHEN 'backlogs' THEN 'backlog' WHEN 'b' THEN 'backlog'
          WHEN 'pending' THEN 'pending' WHEN 'p' THEN 'pending'
          WHEN 'in progress' THEN 'in_progress' WHEN 'inprogress' THEN 'in_progress' WHEN 'ip' THEN 'in_progress'
          WHEN 'review' THEN 'review'
          WHEN 'done' THEN 'done' WHEN 'd' THEN 'done'
        END AS status_key
      ) status_values ON true
    ),'[]'::jsonb))
  ELSE '{}'::jsonb END
  || CASE WHEN item.restore_payload ? 'resource_operational_relationships' THEN
    jsonb_build_object('resource_operational_relationships',coalesce((
      SELECT jsonb_agg(relationship.row_json ORDER BY relationship.ordinality)
      FROM jsonb_array_elements(item.restore_payload->'resource_operational_relationships')
        WITH ORDINALITY relationship(row_json,ordinality)
      WHERE relationship.row_json->>'source_resource_type'<>'process_step'
        AND relationship.row_json->>'target_resource_type'<>'process_step'
    ),'[]'::jsonb))
  ELSE '{}'::jsonb END
WHERE item.restore_payload ?| ARRAY[
  'process_steps','node_logic_gate_assignments','kanban_board_projection',
  'resource_operational_relationships'
];

-- Remove Process Step-only live objects after archiving them.
DROP TRIGGER trg_process_step_relationship_work_version ON public.resource_operational_relationships;
DROP TRIGGER trg_process_map_trace_endpoint_types ON public.process_map_traces;

DELETE FROM public.resource_operational_relationships
WHERE source_resource_type='process_step' OR target_resource_type='process_step';

DROP TABLE public.process_steps;
DROP FUNCTION public.trg_process_step_owner_immutable();
DROP FUNCTION public.trg_process_step_cleanup();
DROP FUNCTION public.trg_process_step_relationship_work_version();
DROP FUNCTION public.trg_process_map_trace_endpoint_types();

ALTER TABLE public.resource_operational_relationships
  DROP CONSTRAINT resource_operational_relationships_step_pair_chk,
  DROP CONSTRAINT resource_operational_relationships_source_type_chk,
  DROP CONSTRAINT resource_operational_relationships_target_type_chk,
  ADD CONSTRAINT resource_operational_relationships_source_type_chk
    CHECK (source_resource_type IN ('company_explorer_folder','logic_gate')),
  ADD CONSTRAINT resource_operational_relationships_target_type_chk
    CHECK (target_resource_type IN ('company_explorer_folder','logic_gate'));

CREATE OR REPLACE FUNCTION public.trg_validate_resource_operational_relationship() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  locked_count integer;
BEGIN
  IF tg_op='UPDATE' AND (
    new.company_id IS DISTINCT FROM old.company_id
    OR new.resource_operational_relationship_id IS DISTINCT FROM old.resource_operational_relationship_id
    OR new.source_resource_type IS DISTINCT FROM old.source_resource_type
    OR new.source_resource_id IS DISTINCT FROM old.source_resource_id
    OR new.target_resource_type IS DISTINCT FROM old.target_resource_type
    OR new.target_resource_id IS DISTINCT FROM old.target_resource_id
  ) THEN
    RAISE EXCEPTION 'process_map_relationship_endpoints_immutable' USING errcode='23514';
  END IF;
  IF new.source_resource_type NOT IN ('company_explorer_folder','logic_gate')
     OR new.target_resource_type NOT IN ('company_explorer_folder','logic_gate') THEN
    RAISE EXCEPTION 'invalid_process_map_resource_type' USING errcode='23514';
  END IF;
  IF new.source_resource_type=new.target_resource_type
     AND new.source_resource_id=new.target_resource_id THEN
    RAISE EXCEPTION 'process_map_relationship_self_edge' USING errcode='23514';
  END IF;
  IF new.source_resource_type='company_explorer_folder'
     AND new.target_resource_type='company_explorer_folder' THEN
    PERFORM 1 FROM public.company_explorer_folders
    WHERE company_id=new.company_id
      AND folder_id IN (new.source_resource_id,new.target_resource_id)
    ORDER BY folder_id FOR KEY SHARE;
    GET DIAGNOSTICS locked_count=ROW_COUNT;
    IF locked_count<>2 THEN
      RAISE EXCEPTION 'process_map_endpoint_not_found' USING errcode='23503';
    END IF;
  ELSIF new.source_resource_type='logic_gate' AND new.target_resource_type='logic_gate' THEN
    PERFORM 1 FROM public.logic_gates
    WHERE company_id=new.company_id
      AND logic_gate_id IN (new.source_resource_id,new.target_resource_id)
    ORDER BY logic_gate_id FOR KEY SHARE;
    GET DIAGNOSTICS locked_count=ROW_COUNT;
    IF locked_count<>2 THEN
      RAISE EXCEPTION 'process_map_endpoint_not_found' USING errcode='23503';
    END IF;
  ELSE
    PERFORM 1 FROM public.company_explorer_folders
    WHERE company_id=new.company_id
      AND folder_id=CASE WHEN new.source_resource_type='company_explorer_folder'
        THEN new.source_resource_id ELSE new.target_resource_id END
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'process_map_endpoint_not_found' USING errcode='23503';
    END IF;
    PERFORM 1 FROM public.logic_gates
    WHERE company_id=new.company_id
      AND logic_gate_id=CASE WHEN new.source_resource_type='logic_gate'
        THEN new.source_resource_id ELSE new.target_resource_id END
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'process_map_endpoint_not_found' USING errcode='23503';
    END IF;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER trg_logic_gate_work_version_nodes ON public.nodes;
CREATE TRIGGER trg_logic_gate_work_version_nodes
AFTER UPDATE OF name,due_date,priority ON public.nodes
FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_node();

DROP TRIGGER trg_logic_gate_work_version_permission_settings ON public.resource_permission_settings;
DROP TRIGGER trg_logic_gate_work_version_gvic_settings ON public.resource_gvic_settings;

CREATE OR REPLACE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_resource() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF tg_op='INSERT' THEN
    IF new.resource_type='logic_gate' THEN
      PERFORM public.mangorts_bump_logic_gate_work_version(new.company_id,new.resource_id);
    END IF;
    RETURN new;
  ELSIF tg_op='DELETE' THEN
    IF old.resource_type='logic_gate' THEN
      PERFORM public.mangorts_bump_logic_gate_work_version(old.company_id,old.resource_id);
    END IF;
    RETURN old;
  END IF;
  IF old.resource_type='logic_gate' THEN
    PERFORM public.mangorts_bump_logic_gate_work_version(old.company_id,old.resource_id);
  END IF;
  IF (new.company_id,new.resource_type,new.resource_id)
       IS DISTINCT FROM (old.company_id,old.resource_type,old.resource_id)
     AND new.resource_type='logic_gate' THEN
    PERFORM public.mangorts_bump_logic_gate_work_version(new.company_id,new.resource_id);
  END IF;
  RETURN new;
END;
$$;

ALTER TABLE public.resource_gvic_assignments
  DROP CONSTRAINT resource_gvic_assignments_resource_type_chk,
  ADD CONSTRAINT resource_gvic_assignments_resource_type_chk CHECK (resource_type IN (
    'node','logic_gate','project','shared_triage_folder','shared_inbox',
    'huddle_logic_gate','huddle_node'
  ));

-- Restore and rebuild the old Kanban read projection.
CREATE TABLE public.kanban_board_projection (
  company_id uuid NOT NULL,
  logic_gate_id uuid NOT NULL,
  node_id uuid NOT NULL,
  status text NOT NULL,
  column_id text NOT NULL,
  position integer NOT NULL,
  title text NOT NULL,
  priority smallint,
  is_issue boolean DEFAULT false NOT NULL,
  due_date date,
  node_created_timestamp timestamp with time zone NOT NULL,
  node_updated_timestamp timestamp with time zone NOT NULL,
  assignment_id uuid NOT NULL,
  assignment_created_timestamp timestamp with time zone NOT NULL,
  assignment_updated_timestamp timestamp with time zone NOT NULL,
  compatibility_board_id text NOT NULL,
  compatibility_card_id uuid NOT NULL,
  projection_updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
  accounts jsonb DEFAULT '[]'::jsonb NOT NULL,
  requested_by_user_id uuid,
  placed_by_user_id uuid,
  status_rank smallint GENERATED ALWAYS AS (
    CASE
      WHEN lower(replace(replace(btrim(status),'_',' '),'-',' ')) IN ('requested','request','requests','r') THEN 0
      WHEN lower(replace(replace(btrim(status),'_',' '),'-',' ')) IN ('backlog','backlogs','b') THEN 1
      WHEN lower(replace(replace(btrim(status),'_',' '),'-',' ')) IN ('pending','p') THEN 2
      WHEN lower(replace(replace(btrim(status),'_',' '),'-',' ')) IN ('in progress','inprogress','ip') THEN 3
      WHEN lower(replace(replace(btrim(status),'_',' '),'-',' '))='review' THEN 4
      WHEN lower(replace(replace(btrim(status),'_',' '),'-',' ')) IN ('done','d') THEN 5
      ELSE 2
    END
  ) STORED,
  CONSTRAINT kanban_board_projection_pkey PRIMARY KEY (company_id,logic_gate_id,node_id),
  CONSTRAINT kanban_board_projection_accounts_array_chk CHECK (jsonb_typeof(accounts)='array'),
  CONSTRAINT kanban_board_projection_priority_chk CHECK (priority IS NULL OR (priority>=1 AND priority<=5)),
  CONSTRAINT kanban_board_projection_status_nonblank_chk CHECK (btrim(status)<>''),
  CONSTRAINT kanban_board_projection_title_nonblank_chk CHECK (btrim(title)<>''),
  CONSTRAINT kanban_board_projection_company_id_logic_gate_id_fkey
    FOREIGN KEY (company_id,logic_gate_id) REFERENCES public.logic_gates(company_id,logic_gate_id) ON DELETE CASCADE,
  CONSTRAINT kanban_board_projection_company_id_node_id_fkey
    FOREIGN KEY (company_id,node_id) REFERENCES public.nodes(company_id,node_id) ON DELETE CASCADE
);

CREATE INDEX idx_kanban_board_projection_hot_read
  ON public.kanban_board_projection(company_id,logic_gate_id,status_rank,position,assignment_created_timestamp,assignment_id);
CREATE INDEX idx_kanban_board_projection_node
  ON public.kanban_board_projection(company_id,node_id);
CREATE INDEX idx_kanban_board_projection_updated
  ON public.kanban_board_projection(company_id,logic_gate_id,projection_updated_timestamp DESC,node_id);

INSERT INTO public.kanban_board_projection (
  company_id,logic_gate_id,node_id,status,column_id,position,title,priority,is_issue,due_date,
  node_created_timestamp,node_updated_timestamp,assignment_id,assignment_created_timestamp,
  assignment_updated_timestamp,compatibility_board_id,compatibility_card_id,
  projection_updated_timestamp,accounts,requested_by_user_id,placed_by_user_id
)
SELECT
  assignment.company_id,
  assignment.logic_gate_id,
  assignment.node_id,
  assignment.status_key,
  assignment.column_id,
  assignment.position,
  node.name,
  node.priority,
  assignment.is_issue,
  node.due_date,
  node.created_timestamp,
  greatest(node.created_timestamp,assignment.updated_timestamp),
  assignment.assignment_id,
  assignment.created_timestamp,
  assignment.updated_timestamp,
  assignment.compatibility_board_id,
  assignment.compatibility_card_id,
  now(),
  coalesce(account_snapshot.accounts_json,'[]'::jsonb),
  assignment.requested_by_user_id,
  assignment.placed_by_user_id
FROM public.node_logic_gate_assignments assignment
JOIN public.nodes node
  ON node.company_id=assignment.company_id AND node.node_id=assignment.node_id
JOIN public.logic_gates gate
  ON gate.company_id=assignment.company_id AND gate.logic_gate_id=assignment.logic_gate_id
LEFT JOIN LATERAL (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'company_id',account.company_id::text,
    'account_id',account.account_id::text,
    'name',account.name,
    'folder_id',account.folder_id::text,
    'position',account.position,
    'created_timestamp',account.created_timestamp,
    'updated_timestamp',account.updated_timestamp
  ) ORDER BY account.position,lower(account.name),account.account_id::text),'[]'::jsonb) AS accounts_json
  FROM public.node_account_assignments node_account
  JOIN public.accounts account
    ON account.company_id=node_account.company_id AND account.account_id=node_account.account_id
  WHERE node_account.company_id=assignment.company_id AND node_account.node_id=assignment.node_id
) account_snapshot ON true;

CREATE TRIGGER trg_logic_gate_work_version_projection
AFTER INSERT OR UPDATE OR DELETE ON public.kanban_board_projection
FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_gate_row();

DO $$
DECLARE
  assignment_count bigint;
  projection_count bigint;
BEGIN
  IF to_regclass('public.process_steps') IS NOT NULL
     OR to_regclass('public.kanban_board_projection') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: table shape is incorrect';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='node_logic_gate_assignments'
      AND column_name='process_step_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='node_logic_gate_assignments'
      AND column_name='status_key'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: assignment shape is incorrect';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.resource_operational_relationships
    WHERE source_resource_type='process_step' OR target_resource_type='process_step'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: Process Step edge remains';
  END IF;
  SELECT count(*) INTO assignment_count FROM public.node_logic_gate_assignments;
  SELECT count(*) INTO projection_count FROM public.kanban_board_projection;
  IF projection_count<>assignment_count THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: projection count % does not match assignment count %',
      projection_count,assignment_count;
  END IF;
END $$;

COMMIT;

SELECT
  (SELECT count(*) FROM public.node_logic_gate_assignments) AS restored_assignments,
  (SELECT count(*) FROM public.kanban_board_projection) AS rebuilt_projection_rows,
  (SELECT count(*) FROM mangorts_process_steps_rollback_20260903.process_steps) AS archived_process_steps,
  (SELECT count(*) FROM mangorts_process_steps_rollback_20260903.step_relationships) AS archived_step_edges;
