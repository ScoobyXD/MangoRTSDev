-- Retire four obsolete operational tables. The migration runner executes this
-- file and records its filename in the same transaction. An unexpected dependency
-- stops the migration instead of removing additional objects.
drop table if exists public.user_logic_gate_shortcuts;
drop table if exists public.workspace_derived_domain_event_projection_checkpoints;
drop table if exists public.process_map_actual_size_layout_recovery_placements;
drop table if exists public.process_map_actual_size_layout_recovery_runs;
