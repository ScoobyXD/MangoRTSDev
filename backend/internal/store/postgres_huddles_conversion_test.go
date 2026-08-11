package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func TestPostgresHuddleConversionRemovesExplorerPlacementBeforePolicySettings(t *testing.T) {
	raw, err := os.ReadFile("postgres_huddles.go")
	if err != nil {
		t.Fatal(err)
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	placementDelete := strings.Index(normalized, "delete from company_explorer_items where company_id=$1::uuid and target_type='logic_gate' and target_id=$2::uuid")
	policyCleanup := strings.Index(normalized, "for _, table := range []string")
	if placementDelete < 0 || policyCleanup < 0 {
		t.Fatal("conversion cleanup statements are missing")
	}
	if placementDelete > policyCleanup {
		t.Fatal("conversion must remove the Company Explorer placement before deleting the Logic Gate policy settings")
	}
	if strings.Contains(normalized, "subject_type,subject_id,user_id,access_level") {
		t.Fatal("conversion must use the canonical V2 permission columns without the retired user_id column")
	}
}

func TestPostgresHuddleRACIExistenceChecksUseExactHuddleTables(t *testing.T) {
	raw, err := os.ReadFile("postgres_gvic.go")
	if err != nil {
		t.Fatal(err)
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	for _, required := range []string{
		"case entitytypehuddlelogicgate: sqltext = `select exists(select 1 from huddle_logic_gates where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid)`",
		"case entitytypehuddlenode: sqltext = `select exists(select 1 from huddle_nodes where company_id=$1::uuid and huddle_node_id=$2::uuid)`",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("PostgreSQL RACI existence check is missing %q", required)
		}
	}
}

func TestPostgresHuddleConversionWithCompanyExplorerPlacement(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("MANGORTS_HUDDLE_CONVERSION_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("set MANGORTS_HUDDLE_CONVERSION_TEST_DATABASE_URL to a disposable local PostgreSQL 17 or 18 database")
	}
	if os.Getenv("MANGORTS_HUDDLE_CONVERSION_TEST_RESET_ACK") != "DROP_DISPOSABLE_SCHEMA" {
		t.Fatal("set MANGORTS_HUDDLE_CONVERSION_TEST_RESET_ACK=DROP_DISPOSABLE_SCHEMA for the guarded disposable test")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.Host != "127.0.0.1" && !strings.EqualFold(config.Host, "localhost") {
		t.Fatalf("refusing non-local disposable database host %q", config.Host)
	}
	config.RuntimeParams["client_encoding"] = "UTF8"
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	db := stdlib.OpenDB(*config)
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	defer db.Close()
	var version int
	var databaseName string
	if err := db.QueryRow(`select current_setting('server_version_num')::integer,current_database()`).Scan(&version, &databaseName); err != nil {
		t.Fatal(err)
	}
	if version < 170000 || version >= 190000 || !strings.HasPrefix(databaseName, "mangorts_huddle_conversion_test") {
		t.Fatalf("refusing PostgreSQL version/database %d/%q", version, databaseName)
	}
	if _, err := db.Exec("drop schema public cascade; create schema public"); err != nil {
		t.Fatalf("reset disposable schema: %v", err)
	}
	schema, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(schema)); err != nil {
		t.Fatalf("apply canonical schema: %v", err)
	}

	repo := NewPostgresRepo(db)
	company, err := repo.CreateCompany("Huddle conversion trigger test")
	if err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "folder", "Huddle source folder")
	if err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(company.CompanyID, "Daily Huddle")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into company_explorer_items(
company_id,item_id,parent_folder_id,target_type,target_id,position
) values($1::uuid,$2::uuid,$3::uuid,'logic_gate',$4::uuid,1000)`, company.CompanyID, newUUIDv7String(), folder.FolderID, gate.LogicGateID); err != nil {
		t.Fatalf("place Logic Gate in Company Explorer: %v", err)
	}

	huddle, err := repo.ConvertLogicGateToHuddle(company.CompanyID, gate.LogicGateID, "")
	if err != nil {
		t.Fatalf("ConvertLogicGateToHuddle: %v", err)
	}
	if huddle.HuddleLogicGateID != gate.LogicGateID {
		t.Fatalf("converted Huddle ID = %s, want %s", huddle.HuddleLogicGateID, gate.LogicGateID)
	}
	assertHuddleConversionCount(t, db, `select count(*) from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid`, company.CompanyID, gate.LogicGateID, 0)
	assertHuddleConversionCount(t, db, `select count(*) from company_explorer_items where company_id=$1::uuid and target_type='logic_gate' and target_id=$2::uuid`, company.CompanyID, gate.LogicGateID, 0)
	assertHuddleConversionCount(t, db, `select count(*) from huddle_logic_gates where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid`, company.CompanyID, gate.LogicGateID, 1)
	assertHuddleConversionCount(t, db, `select count(*) from huddle_explorer_items where company_id=$1::uuid and huddle_type='huddle_logic_gate' and resource_huddle_resource_id=$2::uuid`, company.CompanyID, gate.LogicGateID, 1)
	for _, table := range []string{"resource_gvic_settings", "resource_permission_settings"} {
		assertHuddleConversionCount(t, db, `select count(*) from `+table+` where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, company.CompanyID, gate.LogicGateID, 0)
		assertHuddleConversionCount(t, db, `select count(*) from `+table+` where company_id=$1::uuid and resource_type='huddle_logic_gate' and resource_id=$2::uuid`, company.CompanyID, gate.LogicGateID, 1)
	}
	if policy, err := repo.GetResourceRACIPolicy(company.CompanyID, EntityTypeHuddleLogicGate, huddle.HuddleLogicGateID); err != nil {
		t.Fatalf("GetResourceRACIPolicy(huddle_logic_gate): %v", err)
	} else if policy.ResourceType != EntityTypeHuddleLogicGate || policy.ResourceID != huddle.HuddleLogicGateID {
		t.Fatalf("Huddle Logic Gate RACI policy identity = %s/%s", policy.ResourceType, policy.ResourceID)
	}
	node, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: huddle.HuddleLogicGateID, Name: "New Huddle Node"})
	if err != nil {
		t.Fatalf("CreateHuddleNode: %v", err)
	}
	assertHuddleConversionCount(t, db, `select count(*) from huddle_explorer_items where company_id=$1::uuid and huddle_type='huddle_node' and resource_huddle_resource_id=$2::uuid`, company.CompanyID, node.HuddleNodeID, 0)
	if policy, err := repo.GetResourceRACIPolicy(company.CompanyID, EntityTypeHuddleNode, node.HuddleNodeID); err != nil {
		t.Fatalf("GetResourceRACIPolicy(huddle_node): %v", err)
	} else if policy.ResourceType != EntityTypeHuddleNode || policy.ResourceID != node.HuddleNodeID {
		t.Fatalf("Huddle Node RACI policy identity = %s/%s", policy.ResourceType, policy.ResourceID)
	}
}

func assertHuddleConversionCount(t *testing.T, db *sql.DB, query, companyID, resourceID string, want int) {
	t.Helper()
	var got int
	if err := db.QueryRow(query, companyID, resourceID).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("query count = %d, want %d", got, want)
	}
}
