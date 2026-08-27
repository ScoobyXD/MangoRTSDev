package store

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type processMapActualSizeRollbackFixture struct {
	companyID       string
	firstRootID     string
	secondRootID    string
	processID       string
	before          processMapSquareMigrationSnapshot
	preexistingRows map[string]string
}

func readProcessMapActualSizeRollbackFile(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "scripts", "rollback_process_map_actual_size_layout.sql"))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func createProcessMapActualSizeRollbackFixture(t *testing.T, repo *PostgresRepo) processMapActualSizeRollbackFixture {
	t.Helper()
	company, err := repo.CreateCompany("Process Map actual-size rollback")
	if err != nil {
		t.Fatal(err)
	}
	firstRoot, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Rollback root A")
	if err != nil {
		t.Fatal(err)
	}
	secondRoot, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Rollback root B")
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateCompanyExplorerFolder(company.CompanyID, firstRoot.FolderID, "logic_gate", "Rollback child")
	if err != nil {
		t.Fatal(err)
	}
	firstProcess, err := repo.CreateLogicGate(company.CompanyID, "Rollback Process A")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(company.CompanyID, firstRoot.FolderID, EntityTypeLogicGate, firstProcess.LogicGateID, 1000); err != nil {
		t.Fatal(err)
	}
	secondProcess, err := repo.CreateLogicGate(company.CompanyID, "Rollback Process B")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(company.CompanyID, child.FolderID, EntityTypeLogicGate, secondProcess.LogicGateID, 1000); err != nil {
		t.Fatal(err)
	}

	if _, err := repo.db.Exec(schemaMigrationsTableSQLForProcessMapTest()); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.db.Exec(`
insert into schema_migrations(version,applied_at) values
  ('20260826_zzzz_process_map_tidy_initial_layout.sql','2026-01-02 03:04:05+00'::timestamptz),
  ('20260826_zzzzzz_process_map_square_layout.sql','2026-02-03 04:05:06+00'::timestamptz);
with ranked as (
  select company_id,resource_type,resource_id,
         row_number() over(order by resource_type,resource_id)::integer item_number
  from process_map_placements
  where company_id=$1::uuid
)
update process_map_placements placement
set grid_x=-180+ranked.item_number*31,
    grid_y=-120+ranked.item_number*19,
    grid_width=11+(ranked.item_number%4)*7,
    grid_height=7+(ranked.item_number%3)*5,
    revision=placement.revision+1,
    updated_timestamp=statement_timestamp()
from ranked
where placement.company_id=ranked.company_id
  and placement.resource_type=ranked.resource_type
  and placement.resource_id=ranked.resource_id`, company.CompanyID); err != nil {
		t.Fatal(err)
	}

	preexistingRows := map[string]string{}
	rows, err := repo.db.Query(`
select version,applied_at::text
from schema_migrations
order by version`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var version, appliedAt string
		if err := rows.Scan(&version, &appliedAt); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		preexistingRows[version] = appliedAt
	}
	rows.Close()

	fixture := processMapActualSizeRollbackFixture{
		companyID:       company.CompanyID,
		firstRootID:     firstRoot.FolderID,
		secondRootID:    secondRoot.FolderID,
		processID:       firstProcess.LogicGateID,
		before:          readProcessMapSquareMigrationSnapshot(t, repo, company.CompanyID),
		preexistingRows: preexistingRows,
	}
	if _, err := repo.db.Exec(readProcessMapSquareMigrationFile(t, "20260826_zzzy_process_map_actual_size_square_layout.sql")); err != nil {
		t.Fatalf("apply actual-size migration for rollback fixture: %v", err)
	}
	var changed int
	if err := repo.db.QueryRow(`
select count(*) from process_map_actual_size_layout_recovery_placements
where company_id=$1::uuid and changed_by_migration`, company.CompanyID).Scan(&changed); err != nil {
		t.Fatal(err)
	}
	if changed < 2 {
		t.Fatalf("rollback fixture changed placements = %d, want at least 2", changed)
	}
	return fixture
}

func executeProcessMapActualSizeSQLExpectingFailure(t *testing.T, repo *PostgresRepo, sqlText, wanted string) {
	t.Helper()
	connection, err := repo.db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, executionErr := connection.ExecContext(context.Background(), sqlText)
	if _, rollbackErr := connection.ExecContext(context.Background(), "rollback"); rollbackErr != nil {
		connection.Close()
		t.Fatalf("rollback refused operator SQL: %v", rollbackErr)
	}
	connection.Close()
	if executionErr == nil || !strings.Contains(executionErr.Error(), wanted) {
		t.Fatalf("operator SQL error = %v, want %q", executionErr, wanted)
	}
}

func assertProcessMapActualSizeRollbackRefusedAtomically(t *testing.T, repo *PostgresRepo, fixture processMapActualSizeRollbackFixture, wanted string) {
	t.Helper()
	before := readProcessMapSquareMigrationSnapshot(t, repo, fixture.companyID)
	var eventsBefore, ledgerBefore int
	var readVersionBefore string
	if err := repo.db.QueryRow(`select count(*) from domain_events where company_id=$1::uuid`, fixture.companyID).Scan(&eventsBefore); err != nil {
		t.Fatal(err)
	}
	if err := repo.db.QueryRow(`select count(*) from schema_migrations`).Scan(&ledgerBefore); err != nil {
		t.Fatal(err)
	}
	if err := repo.db.QueryRow(`
select coalesce((
  select jsonb_agg(to_jsonb(read_version) order by read_version.scope)::text
  from workspace_read_versions read_version
  where company_id=$1::uuid
    and scope in ('process-map','workspace-snapshot:full')
    and resource_key=''
),'null')`, fixture.companyID).Scan(&readVersionBefore); err != nil {
		t.Fatal(err)
	}
	executeProcessMapActualSizeSQLExpectingFailure(t, repo, readProcessMapActualSizeRollbackFile(t), wanted)
	if after := readProcessMapSquareMigrationSnapshot(t, repo, fixture.companyID); after != before {
		t.Fatalf("refused rollback changed Process Map state:\nbefore=%+v\nafter=%+v", before, after)
	}
	var eventsAfter, ledgerAfter int
	var status, readVersionAfter string
	if err := repo.db.QueryRow(`select count(*) from domain_events where company_id=$1::uuid`, fixture.companyID).Scan(&eventsAfter); err != nil {
		t.Fatal(err)
	}
	if err := repo.db.QueryRow(`select count(*) from schema_migrations`).Scan(&ledgerAfter); err != nil {
		t.Fatal(err)
	}
	if err := repo.db.QueryRow(`
select status from process_map_actual_size_layout_recovery_runs
where company_id=$1::uuid`, fixture.companyID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if err := repo.db.QueryRow(`
select coalesce((
  select jsonb_agg(to_jsonb(read_version) order by read_version.scope)::text
  from workspace_read_versions read_version
  where company_id=$1::uuid
    and scope in ('process-map','workspace-snapshot:full')
    and resource_key=''
),'null')`, fixture.companyID).Scan(&readVersionAfter); err != nil {
		t.Fatal(err)
	}
	if eventsAfter != eventsBefore || ledgerAfter != ledgerBefore || status != "applied" || readVersionAfter != readVersionBefore {
		t.Fatalf("refused rollback events %d->%d ledger %d->%d status=%q read version %s->%s", eventsBefore, eventsAfter, ledgerBefore, ledgerAfter, status, readVersionBefore, readVersionAfter)
	}
}

func TestPostgresProcessMapActualSizeLayoutRollbackRestoresGeometryWithForwardHistory(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	fixture := createProcessMapActualSizeRollbackFixture(t, repo)
	afterForward := readProcessMapSquareMigrationSnapshot(t, repo, fixture.companyID)
	var processVersionAfterForward, fullVersionAfterForward int64
	if err := db.QueryRow(`
select max(version) filter(where scope='process-map'),
       max(version) filter(where scope='workspace-snapshot:full')
from workspace_read_versions
where company_id=$1::uuid and resource_key=''`, fixture.companyID).Scan(&processVersionAfterForward, &fullVersionAfterForward); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
insert into domain_events(event_id,company_id,stream_type,stream_id,sequence,event_type,idempotency_key,payload)
select gen_random_uuid(),$1::uuid,'workspace',$1::text,coalesce(max(sequence),0)+1,
       'unrelated_test_event','test:unrelated-workspace-event','{}'::jsonb
from domain_events
where company_id=$1::uuid and stream_type='workspace' and stream_id=$1::text`, fixture.companyID); err != nil {
		t.Fatal(err)
	}
	var processVersionBeforeRollback, fullVersionBeforeRollback int64
	if err := db.QueryRow(`
select max(version) filter(where scope='process-map'),
       max(version) filter(where scope='workspace-snapshot:full')
from workspace_read_versions
where company_id=$1::uuid and resource_key=''`, fixture.companyID).Scan(&processVersionBeforeRollback, &fullVersionBeforeRollback); err != nil {
		t.Fatal(err)
	}
	if processVersionBeforeRollback != processVersionAfterForward || fullVersionBeforeRollback <= fullVersionAfterForward {
		t.Fatalf("unrelated workspace event read versions=%d/%d, before=%d/%d", processVersionBeforeRollback, fullVersionBeforeRollback, processVersionAfterForward, fullVersionAfterForward)
	}
	if _, err := db.Exec(readProcessMapActualSizeRollbackFile(t)); err != nil {
		t.Fatalf("execute actual-size rollback: %v", err)
	}

	var mismatchCount int
	if err := db.QueryRow(`
select count(*)
from process_map_actual_size_layout_recovery_placements snapshot
join process_map_placements placement
  on placement.company_id=snapshot.company_id
 and placement.resource_type=snapshot.resource_type
 and placement.resource_id=snapshot.resource_id
where snapshot.company_id=$1::uuid
  and (placement.placement_incarnation_token is distinct from snapshot.placement_incarnation_token
    or placement.map_parent_folder_id is distinct from snapshot.map_parent_folder_id
    or placement.grid_x is distinct from snapshot.before_grid_x
    or placement.grid_y is distinct from snapshot.before_grid_y
    or placement.grid_width is distinct from snapshot.before_grid_width
    or placement.grid_height is distinct from snapshot.before_grid_height
    or placement.created_timestamp is distinct from snapshot.before_created_timestamp
    or (snapshot.changed_by_migration and placement.revision<>snapshot.expected_revision+1)
    or (snapshot.changed_by_migration and placement.updated_timestamp<=snapshot.expected_updated_timestamp)
    or (not snapshot.changed_by_migration and placement.revision<>snapshot.expected_revision)
    or (not snapshot.changed_by_migration and placement.updated_timestamp is distinct from snapshot.expected_updated_timestamp))`, fixture.companyID).Scan(&mismatchCount); err != nil {
		t.Fatal(err)
	}
	if mismatchCount != 0 {
		t.Fatalf("compensating rollback placement mismatches = %d", mismatchCount)
	}
	afterRollback := readProcessMapSquareMigrationSnapshot(t, repo, fixture.companyID)
	if afterRollback.identities != fixture.before.identities {
		t.Fatalf("rollback changed identity or parentage:\nbefore=%s\nafter=%s", fixture.before.identities, afterRollback.identities)
	}
	if afterRollback.relationships != fixture.before.relationships || afterRollback.traces != fixture.before.traces {
		t.Fatal("rollback changed operational relationships or traces")
	}
	if afterRollback.geometry == afterForward.geometry {
		t.Fatal("rollback did not compensate the forward geometry")
	}

	var status string
	var originalMarkers, rollbackMarkers, ledgerRows int
	var rollbackSequence, processVersionAfterRollback, fullVersionAfterRollback int64
	if err := db.QueryRow(`
select status,rollback_sequence from process_map_actual_size_layout_recovery_runs
where company_id=$1::uuid`, fixture.companyID).Scan(&status, &rollbackSequence); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`
select count(*) filter(where idempotency_key='migration:20260826-process-map-actual-size-square-layout'),
       count(*) filter(where idempotency_key='migration:20260826-process-map-actual-size-square-layout:rollback')
from domain_events where company_id=$1::uuid`, fixture.companyID).Scan(&originalMarkers, &rollbackMarkers); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select count(*) from schema_migrations`).Scan(&ledgerRows); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`
select max(version) filter(where scope='process-map'),
       max(version) filter(where scope='workspace-snapshot:full')
from workspace_read_versions
where company_id=$1::uuid and resource_key=''`, fixture.companyID).Scan(&processVersionAfterRollback, &fullVersionAfterRollback); err != nil {
		t.Fatal(err)
	}
	if status != "rolled_back" || originalMarkers != 1 || rollbackMarkers != 1 || ledgerRows != 4 ||
		processVersionAfterRollback != rollbackSequence || fullVersionAfterRollback != rollbackSequence ||
		processVersionAfterRollback <= processVersionBeforeRollback || fullVersionAfterRollback <= fullVersionBeforeRollback {
		t.Fatalf("rollback audit status=%q markers=%d/%d ledger=%d sequence=%d read versions=%d/%d->%d/%d", status, originalMarkers, rollbackMarkers, ledgerRows, rollbackSequence, processVersionBeforeRollback, fullVersionBeforeRollback, processVersionAfterRollback, fullVersionAfterRollback)
	}
	for version, beforeAppliedAt := range fixture.preexistingRows {
		var afterAppliedAt string
		if err := db.QueryRow(`select applied_at::text from schema_migrations where version=$1`, version).Scan(&afterAppliedAt); err != nil {
			t.Fatal(err)
		}
		if afterAppliedAt != beforeAppliedAt {
			t.Fatalf("pre-existing ledger %s applied_at = %s, want %s", version, afterAppliedAt, beforeAppliedAt)
		}
	}

	executeProcessMapActualSizeSQLExpectingFailure(t, repo, readProcessMapActualSizeRollbackFile(t), "already ran")
	executeProcessMapActualSizeSQLExpectingFailure(t, repo, readProcessMapSquareMigrationFile(t, "20260826_zzzy_process_map_actual_size_square_layout.sql"), "already rolled back")
}

func TestPostgresProcessMapActualSizeLayoutRollbackRejectsMissingOrCorruptRecovery(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		wanted string
		mutate func(t *testing.T, repo *PostgresRepo, fixture processMapActualSizeRollbackFixture)
	}{
		{name: "missing snapshot row", wanted: "snapshot", mutate: func(t *testing.T, repo *PostgresRepo, fixture processMapActualSizeRollbackFixture) {
			if _, err := repo.db.Exec(`
delete from process_map_actual_size_layout_recovery_placements
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, fixture.companyID, fixture.processID); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "corrupt before image", wanted: "snapshot", mutate: func(t *testing.T, repo *PostgresRepo, fixture processMapActualSizeRollbackFixture) {
			if _, err := repo.db.Exec(`
update process_map_actual_size_layout_recovery_placements
set before_grid_x=before_grid_x+1
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, fixture.companyID, fixture.processID); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "recovery constraint drift", wanted: "recovery table structure is unsafe", mutate: func(t *testing.T, repo *PostgresRepo, _ processMapActualSizeRollbackFixture) {
			if _, err := repo.db.Exec(`
alter table process_map_actual_size_layout_recovery_runs
drop constraint pm_actual_size_recovery_runs_counts_chk`); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, repo := openPostgresProcessMapIntegration(t)
			fixture := createProcessMapActualSizeRollbackFixture(t, repo)
			testCase.mutate(t, repo, fixture)
			assertProcessMapActualSizeRollbackRefusedAtomically(t, repo, fixture, testCase.wanted)
		})
	}
}

func TestPostgresProcessMapActualSizeLayoutRollbackRejectsLaterProcessMapChanges(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		wanted string
		mutate func(t *testing.T, repo *PostgresRepo, fixture processMapActualSizeRollbackFixture)
	}{
		{name: "manual geometry", wanted: "placement membership", mutate: func(t *testing.T, repo *PostgresRepo, fixture processMapActualSizeRollbackFixture) {
			if _, err := repo.db.Exec(`
update process_map_placements set grid_x=grid_x+1,revision=revision+1,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, fixture.companyID, fixture.processID); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "Explorer reparent", wanted: "placement membership", mutate: func(t *testing.T, repo *PostgresRepo, fixture processMapActualSizeRollbackFixture) {
			if _, _, err := repo.AssignCompanyExplorerFolderItem(fixture.companyID, fixture.secondRootID, EntityTypeLogicGate, fixture.processID, 1000); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "new placement", wanted: "placement membership", mutate: func(t *testing.T, repo *PostgresRepo, fixture processMapActualSizeRollbackFixture) {
			if _, err := repo.CreateLogicGate(fixture.companyID, "Later Process"); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "deleted placement", wanted: "placement membership", mutate: func(t *testing.T, repo *PostgresRepo, fixture processMapActualSizeRollbackFixture) {
			if _, err := repo.db.Exec(`
delete from process_map_placements
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, fixture.companyID, fixture.processID); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "later Process Map event", wanted: "relevant event", mutate: func(t *testing.T, repo *PostgresRepo, fixture processMapActualSizeRollbackFixture) {
			if _, err := repo.db.Exec(`
insert into domain_events(event_id,company_id,stream_type,stream_id,sequence,event_type,idempotency_key,payload)
select gen_random_uuid(),$1::uuid,'workspace',$1::text,coalesce(max(sequence),0)+1,
       'process_map_trace_saved','test:later-process-map-event','{}'::jsonb
from domain_events
where company_id=$1::uuid and stream_type='workspace' and stream_id=$1::text`, fixture.companyID); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "ahead Process Map read version", wanted: "read version", mutate: func(t *testing.T, repo *PostgresRepo, fixture processMapActualSizeRollbackFixture) {
			if _, err := repo.db.Exec(`
update workspace_read_versions
set version=version+100,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and scope='process-map' and resource_key=''`, fixture.companyID); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "missing Process Map read version", wanted: "read version", mutate: func(t *testing.T, repo *PostgresRepo, fixture processMapActualSizeRollbackFixture) {
			if _, err := repo.db.Exec(`
delete from workspace_read_versions
where company_id=$1::uuid and scope='process-map' and resource_key=''`, fixture.companyID); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "maximum workspace event sequence", wanted: "maximum workspace event sequence", mutate: func(t *testing.T, repo *PostgresRepo, fixture processMapActualSizeRollbackFixture) {
			if _, err := repo.db.Exec(`
insert into domain_events(event_id,company_id,stream_type,stream_id,sequence,event_type,idempotency_key,payload)
values(gen_random_uuid(),$1::uuid,'workspace',$1::text,9223372036854775807,
       'unrelated_test_event','test:maximum-workspace-sequence','{}'::jsonb)`, fixture.companyID); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "disabled read-version trigger", wanted: "enabled read-version trigger", mutate: func(t *testing.T, repo *PostgresRepo, _ processMapActualSizeRollbackFixture) {
			if _, err := repo.db.Exec(`alter table domain_events disable trigger trg_update_workspace_read_versions`); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, repo := openPostgresProcessMapIntegration(t)
			fixture := createProcessMapActualSizeRollbackFixture(t, repo)
			testCase.mutate(t, repo, fixture)
			assertProcessMapActualSizeRollbackRefusedAtomically(t, repo, fixture, testCase.wanted)
		})
	}
}
