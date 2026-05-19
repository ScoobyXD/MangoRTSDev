# This event branch does not add a new migration; this wrapper applies pending remediation migrations and verifies required DB prerequisites.
param(
  [switch]$ApplyCanonicalSchema,
  [switch]$DryRun,
  [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"

$requiredEnv = @("DB_HOST", "DB_NAME", "DB_USER", "PGPASSWORD")
foreach ($name in $requiredEnv) {
  if (-not [Environment]::GetEnvironmentVariable($name)) {
    throw "Set $name first"
  }
}

if (-not $env:DB_PORT) { $env:DB_PORT = "5432" }
if (-not $env:PGSSLMODE) { $env:PGSSLMODE = "require" }

$repoRoot = Split-Path -Parent $PSScriptRoot
$dbHost = $env:DB_HOST.Trim()
if ($dbHost.StartsWith("host=")) {
  $dbHost = $dbHost.Substring(5)
}

function Invoke-RepoScript {
  param(
    [Parameter(Mandatory=$true)][string]$RelativePath,
    [string[]]$Arguments = @()
  )

  $scriptPath = Join-Path $repoRoot $RelativePath
  if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "Missing script: $scriptPath"
  }

  & $scriptPath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$RelativePath failed with exit code $LASTEXITCODE"
  }
}

function Invoke-PsqlQuery {
  param([Parameter(Mandatory=$true)][string]$Query)

  & psql -h $dbHost -p $env:DB_PORT -U $env:DB_USER -d $env:DB_NAME -v ON_ERROR_STOP=1 -c $Query
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed with exit code $LASTEXITCODE"
  }
}

if ($ApplyCanonicalSchema) {
  Write-Host "Applying canonical schema from backend/db/schema.sql..."
  Invoke-RepoScript -RelativePath "scripts/apply_canonical_schema.ps1"
}

Write-Host "Applying pending backend DB migrations..."
$migrationArgs = @()
if ($DryRun) { $migrationArgs += "-DryRun" }
Invoke-RepoScript -RelativePath "scripts/apply_db_migrations.ps1" -Arguments $migrationArgs

if ($DryRun) {
  Write-Host "Dry run complete; verification skipped because migrations were not applied."
  exit 0
}

if ($SkipVerify) {
  Write-Host "Skipped architecture remediation DB verification."
  exit 0
}

$verifyQuery = @'
select current_database() as db, current_user as role, now() as verified_at;

select to_regclass('public.domain_events') as domain_events,
       to_regclass('public.node_logic_gate_assignments') as node_logic_gate_assignments,
       to_regclass('public.work_item_inbox_entries') as work_item_inbox_entries,
       to_regclass('public.kanban_cards') as kanban_cards,
       to_regclass('public.nodes') as nodes,
       to_regclass('public.logic_gate_raci_assignments') as logic_gate_raci_assignments;

select proname
from pg_proc
where proname in (
  'sync_node_logic_gate_assignment_from_kanban_card',
  'rebuild_work_item_inbox_entries_for_company',
  'rebuild_work_item_inbox_entries_for_node',
  'rebuild_work_item_inbox_entries_for_logic_gate'
)
order by proname;

do $$
begin
  if to_regclass('public.domain_events') is null then
    raise exception 'missing domain_events; run backend/db/migrations/20260519_domain_events_outbox.sql';
  end if;
  if to_regclass('public.node_logic_gate_assignments') is null then
    raise exception 'missing node_logic_gate_assignments; run backend/db/migrations/20260519_node_logic_gate_assignments.sql';
  end if;
  if to_regclass('public.work_item_inbox_entries') is null then
    raise exception 'missing work_item_inbox_entries; run backend/db/migrations/20260519_work_item_inbox_entries.sql';
  end if;
  if not exists (
    select 1
    from pg_proc
    where proname = 'sync_node_logic_gate_assignment_from_kanban_card'
  ) then
    raise exception 'missing sync_node_logic_gate_assignment_from_kanban_card()';
  end if;
  if not exists (
    select 1
    from pg_proc
    where proname = 'rebuild_work_item_inbox_entries_for_company'
  ) then
    raise exception 'missing rebuild_work_item_inbox_entries_for_company()';
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_sync_node_logic_gate_assignment_from_kanban_card'
      and tgrelid = 'public.kanban_cards'::regclass
      and not tgisinternal
  ) then
    raise exception 'missing trg_sync_node_logic_gate_assignment_from_kanban_card on kanban_cards';
  end if;
end $$;
'@

Write-Host "Verifying architecture remediation DB prerequisites..."
Invoke-PsqlQuery -Query $verifyQuery
Write-Host "Architecture remediation DB migrations and prerequisites verified."
