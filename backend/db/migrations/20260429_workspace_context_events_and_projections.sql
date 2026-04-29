-- Workspace context event log + projection tables
-- Apply in DBeaver against your target Aurora PostgreSQL database.

create table if not exists workspace_context_events (
  company_id uuid not null,
  workspace_id uuid not null,
  context_id text not null,
  source_module_id text not null,
  sequence bigint not null,
  user_action_type text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_timestamp timestamptz not null default now(),
  primary key (company_id, workspace_id, context_id, sequence)
);

create index if not exists idx_workspace_context_events_company_workspace_context_sequence
  on workspace_context_events (company_id, workspace_id, context_id, sequence desc);

create table if not exists workspace_context_projections (
  company_id uuid not null,
  workspace_id uuid not null,
  context_id text not null,
  last_sequence bigint not null,
  last_event_timestamp timestamptz not null,
  last_payload_json jsonb not null default '{}'::jsonb,
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, workspace_id, context_id)
);

create index if not exists idx_workspace_context_projections_company_workspace_context
  on workspace_context_projections (company_id, workspace_id, context_id);
