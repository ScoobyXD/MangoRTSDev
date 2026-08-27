package store

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"testing"
)

type processMapActualSizeDimension struct {
	resourceType string
	resourceID   string
	width        int
	height       int
	isLeafFolder bool
}

func readProcessMapActualSizeDimensions(t *testing.T, repo *PostgresRepo, companyID string) map[string]processMapActualSizeDimension {
	t.Helper()
	rows, err := repo.db.Query(`
select placement.resource_type,placement.resource_id::text,
       placement.grid_width,placement.grid_height,
       placement.resource_type='company_explorer_folder' and not exists (
         select 1 from process_map_placements child
         where child.company_id=placement.company_id
           and child.map_parent_folder_id=placement.resource_id
       )
from process_map_placements placement
where placement.company_id=$1::uuid
order by placement.resource_type,placement.resource_id`, companyID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	result := map[string]processMapActualSizeDimension{}
	for rows.Next() {
		var item processMapActualSizeDimension
		if err := rows.Scan(&item.resourceType, &item.resourceID, &item.width, &item.height, &item.isLeafFolder); err != nil {
			t.Fatal(err)
		}
		result[item.resourceType+":"+item.resourceID] = item
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return result
}

func extendProcessMapActualSizeLargeDeepFixture(t *testing.T, repo *PostgresRepo, companyID, largeParentID, deepParentID string) {
	t.Helper()
	for index := 0; index < 72; index++ {
		process, err := repo.CreateLogicGate(companyID, fmt.Sprintf("Actual-size large sibling %03d", index+1))
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, largeParentID, EntityTypeLogicGate, process.LogicGateID, 20000+(index+1)*1000); err != nil {
			t.Fatal(err)
		}
	}

	parentID := deepParentID
	for depth := 0; depth < 24; depth++ {
		folder, err := repo.CreateCompanyExplorerFolder(companyID, parentID, "logic_gate", fmt.Sprintf("Actual-size deep continuation %02d", depth+1))
		if err != nil {
			t.Fatal(err)
		}
		process, err := repo.CreateLogicGate(companyID, fmt.Sprintf("Actual-size deep Process %02d", depth+1))
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, folder.FolderID, EntityTypeLogicGate, process.LogicGateID, 1000); err != nil {
			t.Fatal(err)
		}
		parentID = folder.FolderID
	}
}

func TestPostgresProcessMapActualSizeLayoutMigrationPreservesDimensionsAndSupersedesHistory(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	companyID, _, mixedRootID, nestedMixedID, _ := createProcessMapSquareMigrationFixture(t, repo)
	extendProcessMapActualSizeLargeDeepFixture(t, repo, companyID, mixedRootID, nestedMixedID)

	var largeSiblingCount, maximumNestedDepth int
	if err := db.QueryRow(`
with recursive nested(folder_id,depth) as (
  select folder_id,0
  from company_explorer_folders
  where company_id=$1::uuid and folder_id=$3::uuid
  union all
  select child.folder_id,nested.depth+1
  from nested
  join company_explorer_folders child
    on child.company_id=$1::uuid and child.parent_folder_id=nested.folder_id
)
select (
  select count(*) from process_map_placements
  where company_id=$1::uuid and map_parent_folder_id=$2::uuid
),coalesce(max(depth),0)
from nested`, companyID, mixedRootID, nestedMixedID).Scan(&largeSiblingCount, &maximumNestedDepth); err != nil {
		t.Fatal(err)
	}
	if largeSiblingCount < 90 || maximumNestedDepth < 24 {
		t.Fatalf("large/deep fixture has %d siblings and depth %d, want at least 90 and 24", largeSiblingCount, maximumNestedDepth)
	}
	if _, err := db.Exec(`
create table schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
with ranked as (
  select company_id,resource_type,resource_id,
         row_number() over(order by resource_id)::integer item_number
  from process_map_placements
  where company_id=$1::uuid and resource_type='logic_gate'
)
update process_map_placements placement
set grid_width=8+(ranked.item_number%19),
    grid_height=5+(ranked.item_number%13),
    revision=placement.revision+1,
    updated_timestamp=statement_timestamp()
from ranked
where placement.company_id=ranked.company_id
  and placement.resource_type=ranked.resource_type
  and placement.resource_id=ranked.resource_id;
with ranked as (
  select placement.company_id,placement.resource_type,placement.resource_id,
         row_number() over(order by placement.resource_id)::integer item_number
  from process_map_placements placement
  where placement.company_id=$1::uuid
    and placement.resource_type='company_explorer_folder'
    and not exists (
      select 1 from process_map_placements child
      where child.company_id=placement.company_id
        and child.map_parent_folder_id=placement.resource_id
    )
)
update process_map_placements placement
set grid_width=41+(ranked.item_number%7)*5,
    grid_height=29+(ranked.item_number%5)*4,
    revision=placement.revision+1,
    updated_timestamp=statement_timestamp()
from ranked
where placement.company_id=ranked.company_id
  and placement.resource_type=ranked.resource_type
  and placement.resource_id=ranked.resource_id`, companyID); err != nil {
		t.Fatal(err)
	}

	beforeDimensions := readProcessMapActualSizeDimensions(t, repo, companyID)
	before := readProcessMapSquareMigrationSnapshot(t, repo, companyID)
	migration := readProcessMapSquareMigrationFile(t, "20260826_zzzy_process_map_actual_size_square_layout.sql")
	if _, err := db.Exec(migration); err != nil {
		t.Fatalf("apply actual-size Process Map layout migration: %v", err)
	}
	after := readProcessMapSquareMigrationSnapshot(t, repo, companyID)
	afterDimensions := readProcessMapActualSizeDimensions(t, repo, companyID)

	if after.identities != before.identities {
		t.Fatalf("actual-size layout changed placement identity or parentage:\nbefore: %s\nafter:  %s", before.identities, after.identities)
	}
	if after.relationships != before.relationships || after.traces != before.traces {
		t.Fatalf("actual-size layout changed relationships or traces:\nrelationships before=%s after=%s\ntraces before=%s after=%s", before.relationships, after.relationships, before.traces, after.traces)
	}
	for key, wanted := range beforeDimensions {
		got := afterDimensions[key]
		switch wanted.resourceType {
		case "logic_gate":
			if got.width != wanted.width || got.height != wanted.height {
				t.Fatalf("Process %s dimensions = %dx%d, want preserved %dx%d", wanted.resourceID, got.width, got.height, wanted.width, wanted.height)
			}
		case "company_explorer_folder":
			if got.width < wanted.width || got.height < wanted.height {
				t.Fatalf("Folder %s shrank from %dx%d to %dx%d", wanted.resourceID, wanted.width, wanted.height, got.width, got.height)
			}
			if wanted.isLeafFolder && (got.width != wanted.width || got.height != wanted.height) {
				t.Fatalf("empty enlarged Folder %s dimensions = %dx%d, want exact %dx%d", wanted.resourceID, got.width, got.height, wanted.width, wanted.height)
			}
		}
	}
	assertProcessMapSquarePlanIsContainedAndSeparated(t, repo, companyID)

	var rootFolderRight, rootProcessLeft *int
	if err := db.QueryRow(`
select max(grid_x+grid_width) filter(where resource_type='company_explorer_folder'),
       min(grid_x) filter(where resource_type='logic_gate')
from process_map_placements
where company_id=$1::uuid and map_parent_folder_id is null`, companyID).Scan(&rootFolderRight, &rootProcessLeft); err != nil {
		t.Fatal(err)
	}
	if rootFolderRight != nil && rootProcessLeft != nil && *rootFolderRight > *rootProcessLeft {
		t.Fatalf("root Folder section ends at %d after Process section starts at %d", *rootFolderRight, *rootProcessLeft)
	}

	var largeDistinctX, largeDistinctY int
	var largeMinX, largeMinY, largeMaxX, largeMaxY int64
	if err := db.QueryRow(`
select count(distinct grid_x),count(distinct grid_y),
       min(grid_x::bigint),min(grid_y::bigint),
       max(grid_x::bigint+grid_width),max(grid_y::bigint+grid_height)
from process_map_placements
where company_id=$1::uuid
  and map_parent_folder_id=$2::uuid
  and resource_type='logic_gate'`, companyID, mixedRootID).Scan(
		&largeDistinctX, &largeDistinctY, &largeMinX, &largeMinY, &largeMaxX, &largeMaxY,
	); err != nil {
		t.Fatal(err)
	}
	largeWidth, largeHeight := largeMaxX-largeMinX, largeMaxY-largeMinY
	largeAspect := float64(max(largeWidth, largeHeight)) / float64(min(largeWidth, largeHeight))
	if largeDistinctX < 4 || largeDistinctY < 4 || math.IsInf(largeAspect, 0) || largeAspect > 3 {
		t.Fatalf("large irregular Process section is %dx%d positions in %dx%d bounds (aspect %.3f), want a bounded square-biased grid", largeDistinctX, largeDistinctY, largeWidth, largeHeight, largeAspect)
	}

	bounds := readProcessMapSquareRootBounds(t, repo, companyID)
	aspect := float64(max(bounds.width(), bounds.height())) / float64(min(bounds.width(), bounds.height()))
	if math.IsInf(aspect, 0) || aspect > 2.5 {
		t.Fatalf("actual-size root footprint %dx%d has aspect %.3f, want <= 2.5", bounds.width(), bounds.height(), aspect)
	}

	legacyNames := []string{
		"20260826_zzzz_process_map_tidy_initial_layout.sql",
		"20260826_zzzzz_process_map_rectangular_layout.sql",
		"20260826_zzzzzz_process_map_square_layout.sql",
	}
	sort.Strings(legacyNames)
	rows, err := db.Query(`select version from schema_migrations order by version`)
	if err != nil {
		t.Fatal(err)
	}
	var recorded []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		recorded = append(recorded, name)
	}
	rows.Close()
	if fmt.Sprint(recorded) != fmt.Sprint(legacyNames) {
		t.Fatalf("superseded migration ledger rows = %v, want %v", recorded, legacyNames)
	}

	restart := readProcessMapSquareMigrationSnapshot(t, repo, companyID)
	if _, err := db.Exec(migration); err != nil {
		t.Fatalf("restart actual-size Process Map layout migration: %v", err)
	}
	if replayed := readProcessMapSquareMigrationSnapshot(t, repo, companyID); replayed != restart {
		t.Fatalf("actual-size migration replay changed data:\nbefore=%+v\nafter=%+v", restart, replayed)
	}

	var changedProcessID string
	if err := db.QueryRow(`
select resource_id::text from process_map_placements
where company_id=$1::uuid and resource_type='logic_gate'
order by resource_id limit 1`, companyID).Scan(&changedProcessID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
update process_map_placements
set grid_x=grid_x+1,revision=revision+1,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, companyID, changedProcessID); err != nil {
		t.Fatal(err)
	}
	manualSnapshot := readProcessMapSquareMigrationSnapshot(t, repo, companyID)
	connection, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, migrationErr := connection.ExecContext(context.Background(), migration)
	if _, rollbackErr := connection.ExecContext(context.Background(), "rollback"); rollbackErr != nil {
		connection.Close()
		t.Fatalf("rollback actual-size manual-geometry refusal: %v", rollbackErr)
	}
	connection.Close()
	if migrationErr == nil || !strings.Contains(migrationErr.Error(), "already ran") {
		t.Fatalf("actual-size manual-geometry rerun error = %v", migrationErr)
	}
	if refused := readProcessMapSquareMigrationSnapshot(t, repo, companyID); refused != manualSnapshot {
		t.Fatalf("actual-size manual-geometry refusal changed data:\nbefore=%+v\nafter=%+v", manualSnapshot, refused)
	}
}

func TestPostgresProcessMapActualSizeLayoutMigrationRejectsMissingExpectedPlacementsAtomically(t *testing.T) {
	t.Run("Folder", func(t *testing.T) {
		db, repo := openPostgresProcessMapIntegration(t)
		company, err := repo.CreateCompany("Process Map actual-size missing Folder placement")
		if err != nil {
			t.Fatal(err)
		}
		folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Missing placement Folder")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(schemaMigrationsTableSQLForProcessMapTest()); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`
delete from process_map_placements
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`, company.CompanyID, folder.FolderID); err != nil {
			t.Fatal(err)
		}
		assertProcessMapActualSizeMissingPlacementRefusal(t, repo, company.CompanyID, "Folder is missing its Process Map placement")
	})

	t.Run("Process", func(t *testing.T) {
		db, repo := openPostgresProcessMapIntegration(t)
		company, err := repo.CreateCompany("Process Map actual-size missing Process placement")
		if err != nil {
			t.Fatal(err)
		}
		process, err := repo.CreateLogicGate(company.CompanyID, "Missing placement Process")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(schemaMigrationsTableSQLForProcessMapTest()); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`
delete from process_map_placements
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, company.CompanyID, process.LogicGateID); err != nil {
			t.Fatal(err)
		}
		assertProcessMapActualSizeMissingPlacementRefusal(t, repo, company.CompanyID, "Process is missing its Process Map placement")
	})
}

func assertProcessMapActualSizeMissingPlacementRefusal(t *testing.T, repo *PostgresRepo, companyID, wantedError string) {
	t.Helper()
	before := readProcessMapSquareMigrationSnapshot(t, repo, companyID)
	var eventsBefore int
	if err := repo.db.QueryRow(`select count(*) from domain_events where company_id=$1::uuid`, companyID).Scan(&eventsBefore); err != nil {
		t.Fatal(err)
	}
	migration := readProcessMapSquareMigrationFile(t, "20260826_zzzy_process_map_actual_size_square_layout.sql")
	connection, err := repo.db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, migrationErr := connection.ExecContext(context.Background(), migration)
	if _, rollbackErr := connection.ExecContext(context.Background(), "rollback"); rollbackErr != nil {
		connection.Close()
		t.Fatalf("rollback actual-size missing-placement refusal: %v", rollbackErr)
	}
	connection.Close()
	if migrationErr == nil || !strings.Contains(migrationErr.Error(), wantedError) {
		t.Fatalf("actual-size missing-placement error = %v, want %q", migrationErr, wantedError)
	}
	if after := readProcessMapSquareMigrationSnapshot(t, repo, companyID); after != before {
		t.Fatalf("actual-size missing-placement refusal changed data:\nbefore=%+v\nafter=%+v", before, after)
	}
	var ledgerRows, eventsAfter int
	if err := repo.db.QueryRow(`select count(*) from schema_migrations`).Scan(&ledgerRows); err != nil {
		t.Fatal(err)
	}
	if err := repo.db.QueryRow(`select count(*) from domain_events where company_id=$1::uuid`, companyID).Scan(&eventsAfter); err != nil {
		t.Fatal(err)
	}
	if ledgerRows != 0 || eventsAfter != eventsBefore {
		t.Fatalf("missing-placement refusal recorded %d migration rows and changed domain event count from %d to %d", ledgerRows, eventsBefore, eventsAfter)
	}
}

func TestPostgresProcessMapActualSizeLayoutMigrationUsesBoundedDepthTraversalContract(t *testing.T) {
	migration := strings.ToLower(readProcessMapSquareMigrationFile(t, "20260826_zzzy_process_map_actual_size_square_layout.sql"))
	compact := strings.Join(strings.Fields(migration), "")
	if !strings.Contains(compact, "onprocess_map_actual_layout(depth,resource_type,company_id,resource_id)") {
		t.Fatal("actual-size migration is missing its depth-leading traversal index")
	}
	if strings.Contains(compact, "generate_series(") {
		t.Fatal("actual-size migration restored unbounded candidate generation")
	}
	if got := strings.Count(compact, "crossjoin(values(-3),(-2),(-1),(0),(1),(2),(3))candidate(delta)"); got != 2 {
		t.Fatalf("actual-size migration bounded seven-candidate sections = %d, want 2", got)
	}
}

func TestPostgresProcessMapActualSizeLayoutMigrationRejectsUnsafeParentageAtomically(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map actual-size unsafe parent")
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
	if _, err := db.Exec(schemaMigrationsTableSQLForProcessMapTest()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
update process_map_placements
set map_parent_folder_id=$3::uuid
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`,
		company.CompanyID, child.FolderID, rootB.FolderID); err != nil {
		t.Fatal(err)
	}
	before := readProcessMapSquareMigrationSnapshot(t, repo, company.CompanyID)
	migration := readProcessMapSquareMigrationFile(t, "20260826_zzzy_process_map_actual_size_square_layout.sql")
	connection, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, migrationErr := connection.ExecContext(context.Background(), migration)
	if _, rollbackErr := connection.ExecContext(context.Background(), "rollback"); rollbackErr != nil {
		connection.Close()
		t.Fatalf("rollback actual-size parentage refusal: %v", rollbackErr)
	}
	connection.Close()
	if migrationErr == nil || !strings.Contains(migrationErr.Error(), "parentage is not synchronized") {
		t.Fatalf("actual-size unsafe-parentage error = %v", migrationErr)
	}
	if after := readProcessMapSquareMigrationSnapshot(t, repo, company.CompanyID); after != before {
		t.Fatalf("actual-size unsafe-parentage refusal changed data:\nbefore=%+v\nafter=%+v", before, after)
	}
	var ledgerRows int
	if err := db.QueryRow(`select count(*) from schema_migrations`).Scan(&ledgerRows); err != nil {
		t.Fatal(err)
	}
	if ledgerRows != 0 {
		t.Fatalf("unsafe-parentage refusal recorded %d migration rows", ledgerRows)
	}
}

func TestPostgresProcessMapActualSizeLayoutMigrationAfterHistoricalSquarePreservesRemainingDimensions(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map already-square forward repair")
	if err != nil {
		t.Fatal(err)
	}
	root, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root")
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := repo.CreateCompanyExplorerFolder(company.CompanyID, root.FolderID, "logic_gate", "Empty leaf")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.CreateLogicGate(company.CompanyID, "Current-size Process")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(company.CompanyID, root.FolderID, EntityTypeLogicGate, process.LogicGateID, 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(readProcessMapSquareMigrationFile(t, "20260826_zzzzz_process_map_rectangular_layout.sql")); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(readProcessMapSquareMigrationFile(t, "20260826_zzzzzz_process_map_square_layout.sql")); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(schemaMigrationsTableSQLForProcessMapTest()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
insert into schema_migrations(version) values('20260826_zzzzzz_process_map_square_layout.sql');
update process_map_placements set grid_width=27,grid_height=11
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid;
update process_map_placements set grid_width=63,grid_height=37
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$3::uuid`,
		company.CompanyID, process.LogicGateID, leaf.FolderID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(readProcessMapSquareMigrationFile(t, "20260826_zzzy_process_map_actual_size_square_layout.sql")); err != nil {
		t.Fatal(err)
	}
	var processWidth, processHeight, leafWidth, leafHeight int
	if err := db.QueryRow(`
select process.grid_width,process.grid_height,leaf.grid_width,leaf.grid_height
from process_map_placements process
join process_map_placements leaf on leaf.company_id=process.company_id
where process.company_id=$1::uuid
  and process.resource_type='logic_gate' and process.resource_id=$2::uuid
  and leaf.resource_type='company_explorer_folder' and leaf.resource_id=$3::uuid`,
		company.CompanyID, process.LogicGateID, leaf.FolderID).Scan(&processWidth, &processHeight, &leafWidth, &leafHeight); err != nil {
		t.Fatal(err)
	}
	if processWidth != 27 || processHeight != 11 || leafWidth != 63 || leafHeight != 37 {
		t.Fatalf("forward migration dimensions Process=%dx%d leaf=%dx%d", processWidth, processHeight, leafWidth, leafHeight)
	}
}

func schemaMigrationsTableSQLForProcessMapTest() string {
	return `create table schema_migrations(version text primary key,applied_at timestamptz not null default now())`
}
