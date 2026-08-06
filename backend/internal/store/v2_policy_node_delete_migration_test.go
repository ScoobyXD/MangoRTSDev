package store

import (
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

const (
	v2PolicyNodeDeleteSchemaBegin = "-- BEGIN V2 NODE DELETE POLICY CASCADE FIX"
	v2PolicyNodeDeleteSchemaEnd   = "-- END V2 NODE DELETE POLICY CASCADE FIX"
	v2PolicyNodeDeleteMigration   = "20260806_node_delete_policy_cascade.sql"
)

func TestV2PolicyNodeDeleteSchemaAndMigrationContract(t *testing.T) {
	schema := readV2PolicyStep1File(t, "..", "..", "db", "schema.sql")
	migration := readV2PolicyStep1File(t, "..", "..", "db", "migrations", v2PolicyNodeDeleteMigration)
	start := strings.Index(schema, v2PolicyNodeDeleteSchemaBegin)
	end := strings.Index(schema, v2PolicyNodeDeleteSchemaEnd)
	if start < 0 || end <= start {
		t.Fatal("canonical schema is missing the marked V2 policy Node-delete fix")
	}
	if strings.TrimSpace(schema[start+len(v2PolicyNodeDeleteSchemaBegin):end]) != strings.TrimSpace(migration) {
		t.Fatal("canonical V2 policy Node-delete fix drifted from the forward migration")
	}

	lower := strings.ToLower(migration)
	for _, required := range []string{
		"deleted_resource_type text := tg_argv[0]",
		"resource_gvic_settings.company_id=deleted_company_id",
		"resource_permission_settings.company_id=deleted_company_id",
		"from nodes",
		"where company_id=old.company_id and node_id=old.node_id",
		"mangorts_v2_materialize_detached_policy",
		"mangorts_v2_advance_parent_link",
	} {
		if !strings.Contains(lower, required) {
			t.Errorf("Node-delete policy migration is missing %q", required)
		}
	}
	for _, forbidden := range []string{"\\set", "\\i", "\\copy", "\\echo", ":variable"} {
		if strings.Contains(lower, forbidden) {
			t.Errorf("Node-delete policy migration contains forbidden %q", forbidden)
		}
	}
}

func TestV2PolicyNodeDeleteDisposablePostgres(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("MANGORTS_V2_POLICY_NODE_DELETE_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("set MANGORTS_V2_POLICY_NODE_DELETE_TEST_DATABASE_URL to a disposable local PostgreSQL 17 or 18 database")
	}
	if os.Getenv("MANGORTS_V2_POLICY_NODE_DELETE_TEST_RESET_ACK") != "DROP_DISPOSABLE_SCHEMA" {
		t.Fatal("set MANGORTS_V2_POLICY_NODE_DELETE_TEST_RESET_ACK=DROP_DISPOSABLE_SCHEMA for the guarded disposable test")
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
	defer db.Close()
	var version int
	var databaseName string
	if err := db.QueryRow(`select current_setting('server_version_num')::integer,current_database()`).Scan(&version, &databaseName); err != nil {
		t.Fatal(err)
	}
	if version < 170000 || version >= 190000 || !strings.HasPrefix(databaseName, "mangorts_v2_policy_node_delete_test") {
		t.Fatalf("refusing PostgreSQL version/database %d/%q", version, databaseName)
	}
	if _, err := db.Exec("drop schema public cascade; create schema public"); err != nil {
		t.Fatalf("reset disposable schema: %v", err)
	}

	schema := readV2PolicyStep1File(t, "..", "..", "db", "schema.sql")
	legacySchema := removeV2PolicyNodeDeleteSchemaBlock(t, schema)
	if _, err := db.Exec(legacySchema); err != nil {
		t.Fatalf("apply pre-fix canonical schema: %v", err)
	}
	if _, err := db.Exec(readV2PolicyStep1File(t, "..", "..", "db", "migrations", v2PolicyNodeDeleteMigration)); err != nil {
		t.Fatalf("apply Node-delete policy migration: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	config.DefaultQueryExecMode = pgx.QueryExecModeCacheStatement
	db = stdlib.OpenDB(*config)
	defer db.Close()

	repo := NewPostgresRepo(db)
	company, err := repo.CreateCompany("Node delete policy test")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("node-delete-policy-user", "node-delete-policy@example.test", "Node Delete Policy User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("node-delete-policy-user", company.CompanyID, "company_admin"); err != nil {
		t.Fatal(err)
	}
	logicGate, err := repo.CreateLogicGate(company.CompanyID, "Node delete policy gate")
	if err != nil {
		t.Fatal(err)
	}

	deletedNode := createAssignedNodeForPolicyDeleteTest(t, repo, company.CompanyID, logicGate.LogicGateID, user.UserID, "Deleted Node")
	result, err := repo.DeleteCompanyExplorerTargets(company.CompanyID, []CompanyExplorerDeleteTargetInput{{
		Kind: EntityTypeNode,
		ID:   deletedNode,
	}}, user.UserID)
	if err != nil {
		t.Fatalf("delete assigned Node: %v", err)
	}
	requireDeletedTarget(t, result.Targets, EntityTypeNode, deletedNode)
	if _, err := repo.GetNode(company.CompanyID, deletedNode); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetNode after delete error = %v, want ErrNotFound", err)
	}
	assertPolicyDeleteCount(t, db, `select count(*) from node_logic_gate_assignments where company_id=$1::uuid and node_id=$2::uuid`, company.CompanyID, deletedNode, 0)
	assertPolicyDeleteCount(t, db, `select count(*) from resource_gvic_settings where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid`, company.CompanyID, deletedNode, 0)
	assertPolicyDeleteCount(t, db, `select count(*) from resource_permission_settings where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid`, company.CompanyID, deletedNode, 0)
	assertPolicyDeleteCount(t, db, `select count(*) from recycle_bin_items where company_id=$1::uuid and object_kind='node' and object_id=$2`, company.CompanyID, deletedNode, 1)

	detachedNode := createAssignedNodeForPolicyDeleteTest(t, repo, company.CompanyID, logicGate.LogicGateID, user.UserID, "Detached Node")
	if _, err := db.Exec(`delete from node_logic_gate_assignments where company_id=$1::uuid and node_id=$2::uuid`, company.CompanyID, detachedNode); err != nil {
		t.Fatalf("detach surviving Node: %v", err)
	}
	var gvicMode, permissionMode string
	var gvicParentLink, permissionParentLink int64
	if err := db.QueryRow(`select assignment_mode,parent_link_sequence from resource_gvic_settings where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid`, company.CompanyID, detachedNode).Scan(&gvicMode, &gvicParentLink); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select permission_mode,parent_link_sequence from resource_permission_settings where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid`, company.CompanyID, detachedNode).Scan(&permissionMode, &permissionParentLink); err != nil {
		t.Fatal(err)
	}
	if gvicMode != "customized" || permissionMode != "customized" || gvicParentLink != 0 || permissionParentLink != 0 {
		t.Fatalf("surviving detached Node policy = %s/%d %s/%d, want customized roots", gvicMode, gvicParentLink, permissionMode, permissionParentLink)
	}
}

func removeV2PolicyNodeDeleteSchemaBlock(t *testing.T, schema string) string {
	t.Helper()
	start := strings.Index(schema, v2PolicyNodeDeleteSchemaBegin)
	end := strings.Index(schema, v2PolicyNodeDeleteSchemaEnd)
	if start < 0 || end <= start {
		t.Fatal("canonical schema is missing the marked V2 policy Node-delete fix")
	}
	return schema[:start] + schema[end+len(v2PolicyNodeDeleteSchemaEnd):]
}

func createAssignedNodeForPolicyDeleteTest(t *testing.T, repo *PostgresRepo, companyID, logicGateID, actorUserID, title string) string {
	t.Helper()
	node, err := repo.CreateNode(companyID, title)
	if err != nil {
		t.Fatal(err)
	}
	priority := 3
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:      companyID,
		LogicGateID:    logicGateID,
		NodeID:         node.NodeID,
		Status:         LogicGateWorkStatusPending,
		Priority:       &priority,
		PrioritySet:    true,
		MutationOrigin: "test",
		ActorUserID:    actorUserID,
	}); err != nil {
		t.Fatal(err)
	}
	return node.NodeID
}

func assertPolicyDeleteCount(t *testing.T, db *sql.DB, query string, companyID, nodeID string, want int) {
	t.Helper()
	var got int
	if err := db.QueryRow(query, companyID, nodeID).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("query count = %d, want %d", got, want)
	}
}
