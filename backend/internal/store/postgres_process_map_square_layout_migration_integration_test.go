package store

import (
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
)

type processMapSquareMigrationBounds struct {
	minX, minY, maxX, maxY int64
}

func (bounds processMapSquareMigrationBounds) width() int64 {
	return bounds.maxX - bounds.minX
}

func (bounds processMapSquareMigrationBounds) height() int64 {
	return bounds.maxY - bounds.minY
}

type processMapSquareMigrationSnapshot struct {
	identities    string
	geometry      string
	relationships string
	traces        string
}

func readProcessMapSquareMigrationFile(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func readProcessMapSquareMigrationSnapshot(t *testing.T, repo *PostgresRepo, companyID string) processMapSquareMigrationSnapshot {
	t.Helper()
	result := processMapSquareMigrationSnapshot{}
	queries := []struct {
		destination *string
		query       string
	}{
		{&result.identities, `
select coalesce(jsonb_agg(jsonb_build_array(
  company_id,resource_type,resource_id,map_parent_folder_id,
  placement_incarnation_token,created_timestamp
) order by resource_type,resource_id),'[]'::jsonb)::text
from process_map_placements
where company_id=$1::uuid`},
		{&result.geometry, `
select coalesce(jsonb_agg(jsonb_build_array(
  resource_type,resource_id,map_parent_folder_id,
  grid_x,grid_y,grid_width,grid_height,revision,updated_timestamp
) order by resource_type,resource_id),'[]'::jsonb)::text
from process_map_placements
where company_id=$1::uuid`},
		{&result.relationships, `
select coalesce(jsonb_agg(to_jsonb(relationship)
  order by resource_operational_relationship_id),'[]'::jsonb)::text
from resource_operational_relationships relationship
where company_id=$1::uuid`},
		{&result.traces, `
select coalesce(jsonb_agg(to_jsonb(trace)
  order by resource_operational_relationship_id),'[]'::jsonb)::text
from process_map_traces trace
where company_id=$1::uuid`},
	}
	for _, item := range queries {
		if err := repo.db.QueryRow(item.query, companyID).Scan(item.destination); err != nil {
			t.Fatal(err)
		}
	}
	return result
}

func readProcessMapSquareRootBounds(t *testing.T, repo *PostgresRepo, companyID string) processMapSquareMigrationBounds {
	t.Helper()
	var result processMapSquareMigrationBounds
	if err := repo.db.QueryRow(`
select min(grid_x::bigint),min(grid_y::bigint),
       max(grid_x::bigint+grid_width),max(grid_y::bigint+grid_height)
from process_map_placements
where company_id=$1::uuid and map_parent_folder_id is null`, companyID).Scan(
		&result.minX, &result.minY, &result.maxX, &result.maxY,
	); err != nil {
		t.Fatal(err)
	}
	return result
}

func assertProcessMapSquarePlanIsContainedAndSeparated(t *testing.T, repo *PostgresRepo, companyID string) {
	t.Helper()
	var containmentFailures int
	if err := repo.db.QueryRow(`
select count(*)
from process_map_placements child
join process_map_placements parent
  on parent.company_id=child.company_id
 and parent.resource_type='company_explorer_folder'
 and parent.resource_id=child.map_parent_folder_id
where child.company_id=$1::uuid
  and (child.grid_x<parent.grid_x+2
    or child.grid_y<parent.grid_y+6
    or child.grid_x::bigint+child.grid_width>parent.grid_x::bigint+parent.grid_width-2
    or child.grid_y::bigint+child.grid_height>parent.grid_y::bigint+parent.grid_height-2)`, companyID).Scan(&containmentFailures); err != nil {
		t.Fatal(err)
	}
	if containmentFailures != 0 {
		t.Fatalf("square layout containment failures = %d", containmentFailures)
	}

	var overlapFailures int
	if err := repo.db.QueryRow(`
select count(*)
from process_map_placements first_item
join process_map_placements second_item
  on second_item.company_id=first_item.company_id
 and second_item.map_parent_folder_id is not distinct from first_item.map_parent_folder_id
 and (second_item.resource_type,second_item.resource_id)>(first_item.resource_type,first_item.resource_id)
where first_item.company_id=$1::uuid
  and first_item.grid_x<second_item.grid_x+second_item.grid_width
  and first_item.grid_x+first_item.grid_width>second_item.grid_x
  and first_item.grid_y<second_item.grid_y+second_item.grid_height
  and first_item.grid_y+first_item.grid_height>second_item.grid_y`, companyID).Scan(&overlapFailures); err != nil {
		t.Fatal(err)
	}
	if overlapFailures != 0 {
		t.Fatalf("square layout sibling overlap failures = %d", overlapFailures)
	}

	var sectionFailures int
	if err := repo.db.QueryRow(`
with sections as (
  select parent.resource_id,
         max(child.grid_x+child.grid_width) filter(where child.resource_type='company_explorer_folder') folder_right,
         min(child.grid_x) filter(where child.resource_type='logic_gate') process_left
  from process_map_placements parent
  join process_map_placements child
    on child.company_id=parent.company_id and child.map_parent_folder_id=parent.resource_id
  where parent.company_id=$1::uuid and parent.resource_type='company_explorer_folder'
  group by parent.resource_id
)
select count(*)
from sections
where folder_right is not null and process_left is not null and folder_right+4>process_left`, companyID).Scan(&sectionFailures); err != nil {
		t.Fatal(err)
	}
	if sectionFailures != 0 {
		t.Fatalf("square layout Folder-left/Process-right failures = %d", sectionFailures)
	}
}

func createProcessMapSquareMigrationFixture(t *testing.T, repo *PostgresRepo) (companyID, adminID, mixedRootID, nestedMixedID, manualProcessID string) {
	t.Helper()
	company, err := repo.CreateCompany("Process Map square migration")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-square-admin", "process-map-square@example.com", "Square Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}

	rootIDs := make([]string, 0, 7)
	for index := 0; index < 7; index++ {
		root, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", fmt.Sprintf("Square Root %02d", index+1))
		if err != nil {
			t.Fatal(err)
		}
		rootIDs = append(rootIDs, root.FolderID)
	}

	createProcess := func(parentID, name string, position int) string {
		t.Helper()
		process, err := repo.CreateLogicGate(company.CompanyID, name)
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := repo.AssignCompanyExplorerFolderItem(company.CompanyID, parentID, EntityTypeLogicGate, process.LogicGateID, position); err != nil {
			t.Fatal(err)
		}
		return process.LogicGateID
	}

	mixedRootID = rootIDs[0]
	mixedChildren := make([]string, 0, 8)
	for index := 0; index < 8; index++ {
		child, err := repo.CreateCompanyExplorerFolder(company.CompanyID, mixedRootID, "logic_gate", fmt.Sprintf("Mixed Child %02d", index+1))
		if err != nil {
			t.Fatal(err)
		}
		mixedChildren = append(mixedChildren, child.FolderID)
	}
	mixedProcesses := make([]string, 0, 10)
	for index := 0; index < 10; index++ {
		mixedProcesses = append(mixedProcesses, createProcess(mixedRootID, fmt.Sprintf("Mixed Process %02d", index+1), (index+1)*1000))
	}

	nestedMixedID = mixedChildren[0]
	for index := 0; index < 7; index++ {
		if _, err := repo.CreateCompanyExplorerFolder(company.CompanyID, nestedMixedID, "logic_gate", fmt.Sprintf("Nested Grid Folder %02d", index+1)); err != nil {
			t.Fatal(err)
		}
	}
	nestedProcesses := make([]string, 0, 9)
	for index := 0; index < 9; index++ {
		nestedProcesses = append(nestedProcesses, createProcess(nestedMixedID, fmt.Sprintf("Nested Grid Process %02d", index+1), (index+1)*1000))
	}

	deepParentID := mixedChildren[1]
	for depth := 0; depth < 5; depth++ {
		for sibling := 0; sibling < 3; sibling++ {
			if _, err := repo.CreateCompanyExplorerFolder(company.CompanyID, deepParentID, "logic_gate", fmt.Sprintf("Depth %02d Sibling %02d", depth+1, sibling+1)); err != nil {
				t.Fatal(err)
			}
		}
		for processIndex := 0; processIndex < 4; processIndex++ {
			createProcess(deepParentID, fmt.Sprintf("Depth %02d Process %02d", depth+1, processIndex+1), (processIndex+1)*1000)
		}
		deep, err := repo.CreateCompanyExplorerFolder(company.CompanyID, deepParentID, "logic_gate", fmt.Sprintf("Depth %02d Continuation", depth+1))
		if err != nil {
			t.Fatal(err)
		}
		deepParentID = deep.FolderID
	}

	for index := 0; index < 13; index++ {
		createProcess(rootIDs[1], fmt.Sprintf("Process-only %02d", index+1), (index+1)*1000)
	}
	for index := 0; index < 9; index++ {
		child, err := repo.CreateCompanyExplorerFolder(company.CompanyID, rootIDs[2], "logic_gate", fmt.Sprintf("Folder-only %02d", index+1))
		if err != nil {
			t.Fatal(err)
		}
		if index < 4 {
			for processIndex := 0; processIndex < index+1; processIndex++ {
				createProcess(child.FolderID, fmt.Sprintf("Folder-only %02d Process %02d", index+1, processIndex+1), (processIndex+1)*1000)
			}
		}
	}
	for index := 0; index < 5; index++ {
		createProcess(rootIDs[3], fmt.Sprintf("Small mixed Process %02d", index+1), (index+1)*1000)
	}
	for index := 0; index < 3; index++ {
		if _, err := repo.CreateCompanyExplorerFolder(company.CompanyID, rootIDs[3], "logic_gate", fmt.Sprintf("Small mixed Folder %02d", index+1)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := repo.CreateCompanyExplorerFolder(company.CompanyID, rootIDs[5], "logic_gate", "Single child"); err != nil {
		t.Fatal(err)
	}

	rootProcess, err := repo.CreateLogicGate(company.CompanyID, "Company-root Process")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.db.Exec(`
update company_explorer_items
set parent_folder_id=null,position=8500,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and target_type='logic_gate' and target_id=$2::uuid;
update process_map_placements
set map_parent_folder_id=null,grid_x=0,grid_y=0,grid_width=14,grid_height=8,
    revision=revision+1,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`,
		company.CompanyID, rootProcess.LogicGateID); err != nil {
		t.Fatalf("create root Process fixture: %v", err)
	}

	created, err := repo.CreateResourceOperationalRelationship(context.Background(), ResourceOperationalRelationshipCreateInput{
		CompanyID: company.CompanyID,
		Source:    processMapTestRef(domain.ProcessMapResourceTypeProcess, mixedProcesses[0]),
		Target:    processMapTestRef(domain.ProcessMapResourceTypeProcess, nestedProcesses[0]),
		Trace: &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{
			{X: 9, Y: 11}, {X: 31, Y: 11}, {X: 31, Y: 41},
		}},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil || created.Relationship == nil {
		t.Fatalf("create relationship fixture = %+v, err=%v", created, err)
	}

	return company.CompanyID, admin.UserID, mixedRootID, nestedMixedID, mixedProcesses[0]
}

func TestPostgresProcessMapSquareLayoutMigrationPacksActualRectanglesAndIsRestartSafe(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	companyID, _, mixedRootID, nestedMixedID, manualProcessID := createProcessMapSquareMigrationFixture(t, repo)

	rectangularMigration := readProcessMapSquareMigrationFile(t, "20260826_zzzzz_process_map_rectangular_layout.sql")
	if _, err := db.Exec(rectangularMigration); err != nil {
		t.Fatalf("seed historical rectangular Process Map layout: %v", err)
	}
	before := readProcessMapSquareMigrationSnapshot(t, repo, companyID)
	oldBounds := readProcessMapSquareRootBounds(t, repo, companyID)
	versionBefore := postgresProcessMapVersionForTest(t, repo, companyID)

	squareMigration := readProcessMapSquareMigrationFile(t, "20260826_zzzzzz_process_map_square_layout.sql")
	if _, err := db.Exec(squareMigration); err != nil {
		t.Fatalf("apply Process Map square layout migration: %v", err)
	}
	after := readProcessMapSquareMigrationSnapshot(t, repo, companyID)
	newBounds := readProcessMapSquareRootBounds(t, repo, companyID)
	versionAfter := postgresProcessMapVersionForTest(t, repo, companyID)

	if after.identities != before.identities {
		t.Fatalf("square layout changed placement identity or parentage:\nbefore: %s\nafter:  %s", before.identities, after.identities)
	}
	if after.relationships != before.relationships || after.traces != before.traces {
		t.Fatalf("square layout changed relationships or traces:\nrelationships before=%s after=%s\ntraces before=%s after=%s", before.relationships, after.relationships, before.traces, after.traces)
	}
	if after.geometry == before.geometry {
		t.Fatal("square layout did not change the historical rectangular geometry")
	}
	if versionAfter <= versionBefore {
		t.Fatalf("square layout Process Map version = %d, want > %d", versionAfter, versionBefore)
	}
	if newBounds.width() <= 0 || newBounds.height() <= 0 {
		t.Fatalf("square layout root bounds = %+v", newBounds)
	}
	aspect := float64(max(newBounds.width(), newBounds.height())) / float64(min(newBounds.width(), newBounds.height()))
	if aspect > 1.8 {
		t.Fatalf("square layout root footprint %dx%d has aspect %.3f, want <= 1.8", newBounds.width(), newBounds.height(), aspect)
	}
	if newBounds.height() >= oldBounds.height() || newBounds.height()*5 > oldBounds.height()*4 {
		t.Fatalf("square layout height %d did not materially reduce historical height %d", newBounds.height(), oldBounds.height())
	}
	assertProcessMapSquarePlanIsContainedAndSeparated(t, repo, companyID)

	for _, parentID := range []string{mixedRootID, nestedMixedID} {
		var folderXs, folderYs, processXs, processYs int
		if err := db.QueryRow(`
select count(distinct grid_x) filter(where resource_type='company_explorer_folder'),
       count(distinct grid_y) filter(where resource_type='company_explorer_folder'),
       count(distinct grid_x) filter(where resource_type='logic_gate'),
       count(distinct grid_y) filter(where resource_type='logic_gate')
from process_map_placements
where company_id=$1::uuid and map_parent_folder_id=$2::uuid`, companyID, parentID).Scan(
			&folderXs, &folderYs, &processXs, &processYs,
		); err != nil {
			t.Fatal(err)
		}
		if folderXs < 2 || folderYs < 2 || processXs < 2 || processYs < 2 {
			t.Fatalf("parent %s did not grow both sections in both directions: Folder %dx%d Process %dx%d", parentID, folderXs, folderYs, processXs, processYs)
		}
	}

	rows, err := db.Query(`
select parent.resource_id::text,parent.grid_width,parent.grid_height,count(child.resource_id)
from process_map_placements parent
join process_map_placements child
  on child.company_id=parent.company_id and child.map_parent_folder_id=parent.resource_id
where parent.company_id=$1::uuid and parent.resource_type='company_explorer_folder'
group by parent.resource_id,parent.grid_width,parent.grid_height
having count(child.resource_id)>=6
order by parent.resource_id`, companyID)
	if err != nil {
		t.Fatal(err)
	}
	denseFolders := 0
	for rows.Next() {
		var parentID string
		var width, height, childCount int
		if err := rows.Scan(&parentID, &width, &height, &childCount); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		denseFolders++
		folderAspect := float64(max(width, height)) / float64(min(width, height))
		if math.IsInf(folderAspect, 0) || folderAspect > 2.5 {
			rows.Close()
			t.Fatalf("dense Folder %s with %d unequal children is still a tower: %dx%d aspect %.3f", parentID, childCount, width, height, folderAspect)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		t.Fatal(err)
	}
	rows.Close()
	if denseFolders < 4 {
		t.Fatalf("dense Folder fixtures checked = %d, want at least 4", denseFolders)
	}

	processRows, err := db.Query(`
select parent.resource_id::text,
       max(child.grid_x+child.grid_width)-min(child.grid_x),
       max(child.grid_y+child.grid_height)-min(child.grid_y),
       count(child.resource_id)
from process_map_placements parent
join process_map_placements child
  on child.company_id=parent.company_id and child.map_parent_folder_id=parent.resource_id
where parent.company_id=$1::uuid and parent.resource_type='company_explorer_folder'
  and child.resource_type='logic_gate'
group by parent.resource_id
having count(child.resource_id)>=4
order by parent.resource_id`, companyID)
	if err != nil {
		t.Fatal(err)
	}
	denseProcessSections := 0
	for processRows.Next() {
		var parentID string
		var width, height, processCount int
		if err := processRows.Scan(&parentID, &width, &height, &processCount); err != nil {
			processRows.Close()
			t.Fatal(err)
		}
		denseProcessSections++
		sectionAspect := float64(max(width, height)) / float64(min(width, height))
		if math.IsInf(sectionAspect, 0) || sectionAspect > 2.01 {
			processRows.Close()
			t.Fatalf("Process section %s with %d cards is still a tower: %dx%d aspect %.3f", parentID, processCount, width, height, sectionAspect)
		}
	}
	if err := processRows.Err(); err != nil {
		processRows.Close()
		t.Fatal(err)
	}
	processRows.Close()
	if denseProcessSections < 6 {
		t.Fatalf("dense Process sections checked = %d, want at least 6", denseProcessSections)
	}

	var rootProcessCount int
	if err := db.QueryRow(`
select count(*)
from process_map_placements placement
join company_explorer_items item
  on item.company_id=placement.company_id and item.target_type='logic_gate' and item.target_id=placement.resource_id
where placement.company_id=$1::uuid and placement.resource_type='logic_gate'
  and placement.map_parent_folder_id is null and item.parent_folder_id is null`, companyID).Scan(&rootProcessCount); err != nil {
		t.Fatal(err)
	}
	if rootProcessCount != 1 {
		t.Fatalf("root Process count after square migration = %d, want 1", rootProcessCount)
	}

	var markerCount int
	if err := db.QueryRow(`
select count(*)
from domain_events
where company_id=$1::uuid and idempotency_key='migration:20260826-process-map-square-layout'`, companyID).Scan(&markerCount); err != nil {
		t.Fatal(err)
	}
	if markerCount != 1 {
		t.Fatalf("square layout marker count = %d, want 1", markerCount)
	}

	restartSnapshot := readProcessMapSquareMigrationSnapshot(t, repo, companyID)
	if _, err := db.Exec(squareMigration); err != nil {
		t.Fatalf("restart Process Map square layout migration: %v", err)
	}
	if replayed := readProcessMapSquareMigrationSnapshot(t, repo, companyID); replayed != restartSnapshot {
		t.Fatalf("square migration replay changed data:\nbefore=%+v\nafter=%+v", restartSnapshot, replayed)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyID); got != versionAfter {
		t.Fatalf("square migration replay version = %d, want %d", got, versionAfter)
	}

	if _, err := db.Exec(`
update process_map_placements
set grid_x=grid_x+1,revision=revision+1,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, companyID, manualProcessID); err != nil {
		t.Fatal(err)
	}
	manualSnapshot := readProcessMapSquareMigrationSnapshot(t, repo, companyID)
	manualVersion := postgresProcessMapVersionForTest(t, repo, companyID)
	connection, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, migrationErr := connection.ExecContext(context.Background(), squareMigration)
	if _, rollbackErr := connection.ExecContext(context.Background(), "rollback"); rollbackErr != nil {
		connection.Close()
		t.Fatalf("rollback square layout manual-geometry refusal: %v", rollbackErr)
	}
	connection.Close()
	if migrationErr == nil || !strings.Contains(migrationErr.Error(), "already ran") {
		t.Fatalf("square layout manual-geometry rerun error = %v", migrationErr)
	}
	if refused := readProcessMapSquareMigrationSnapshot(t, repo, companyID); refused != manualSnapshot {
		t.Fatalf("square layout refusal changed data:\nbefore=%+v\nafter=%+v", manualSnapshot, refused)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyID); got != manualVersion {
		t.Fatalf("square layout refusal version = %d, want %d", got, manualVersion)
	}
}

func TestPostgresProcessMapSquareLayoutMigrationRejectsUnsafeParentageAndMarkerConflictAtomically(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map square migration preflight")
	if err != nil {
		t.Fatal(err)
	}
	rootA, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root A")
	if err != nil {
		t.Fatal(err)
	}
	rootB, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root B")
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateCompanyExplorerFolder(company.CompanyID, rootA.FolderID, "logic_gate", "Child")
	if err != nil {
		t.Fatal(err)
	}

	rectangularMigration := readProcessMapSquareMigrationFile(t, "20260826_zzzzz_process_map_rectangular_layout.sql")
	if _, err := db.Exec(rectangularMigration); err != nil {
		t.Fatalf("seed historical rectangular layout: %v", err)
	}
	squareMigration := readProcessMapSquareMigrationFile(t, "20260826_zzzzzz_process_map_square_layout.sql")

	if _, err := db.Exec(`
update process_map_placements
set map_parent_folder_id=$3::uuid
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`,
		company.CompanyID, child.FolderID, rootB.FolderID); err != nil {
		t.Fatal(err)
	}
	mismatchSnapshot := readProcessMapSquareMigrationSnapshot(t, repo, company.CompanyID)
	connection, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, migrationErr := connection.ExecContext(context.Background(), squareMigration)
	if _, rollbackErr := connection.ExecContext(context.Background(), "rollback"); rollbackErr != nil {
		connection.Close()
		t.Fatalf("rollback square layout parentage refusal: %v", rollbackErr)
	}
	connection.Close()
	if migrationErr == nil || !strings.Contains(migrationErr.Error(), "parentage is not synchronized") {
		t.Fatalf("square layout unsafe-parentage error = %v", migrationErr)
	}
	if after := readProcessMapSquareMigrationSnapshot(t, repo, company.CompanyID); after != mismatchSnapshot {
		t.Fatalf("unsafe-parentage refusal changed data:\nbefore=%+v\nafter=%+v", mismatchSnapshot, after)
	}

	if _, err := db.Exec(`
update process_map_placements
set map_parent_folder_id=$3::uuid
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`,
		company.CompanyID, child.FolderID, rootA.FolderID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
insert into domain_events(
  event_id,company_id,stream_type,stream_id,sequence,event_type,
  actor_user_id,idempotency_key,payload,created_timestamp
)
select gen_random_uuid(),$1::uuid,'test','square-layout-marker-conflict',
       coalesce(max(sequence),0)+1,'test_marker',null,
       'migration:20260826-process-map-square-layout','{}'::jsonb,statement_timestamp()
from domain_events
where company_id=$1::uuid and stream_type='test' and stream_id='square-layout-marker-conflict'`, company.CompanyID); err != nil {
		t.Fatal(err)
	}
	conflictSnapshot := readProcessMapSquareMigrationSnapshot(t, repo, company.CompanyID)
	connection, err = db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, migrationErr = connection.ExecContext(context.Background(), squareMigration)
	if _, rollbackErr := connection.ExecContext(context.Background(), "rollback"); rollbackErr != nil {
		connection.Close()
		t.Fatalf("rollback square layout marker-conflict refusal: %v", rollbackErr)
	}
	connection.Close()
	if migrationErr == nil || !strings.Contains(migrationErr.Error(), "marker key is already used") {
		t.Fatalf("square layout marker-conflict error = %v", migrationErr)
	}
	if after := readProcessMapSquareMigrationSnapshot(t, repo, company.CompanyID); after != conflictSnapshot {
		t.Fatalf("marker-conflict refusal changed data:\nbefore=%+v\nafter=%+v", conflictSnapshot, after)
	}
}
