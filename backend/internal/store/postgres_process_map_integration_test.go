package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"net"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func postgresProcessMapVersionForTest(t *testing.T, repo *PostgresRepo, companyID string) int64 {
	t.Helper()
	version, found, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, Scope: "process-map"})
	if err != nil || !found {
		t.Fatalf("Process Map read version for %s = %d/%t err=%v", companyID, version, found, err)
	}
	return version
}

func postgresPolicyGroupVersionForTest(t *testing.T, repo *PostgresRepo, companyID string) int64 {
	t.Helper()
	version, found, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, Scope: "policy-group-membership"})
	if err != nil || !found {
		t.Fatalf("policy/group read version for %s = %d/%t err=%v", companyID, version, found, err)
	}
	return version
}

func openPostgresProcessMapTestDatabase(t *testing.T) *sql.DB {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("MANGORTS_PROCESS_MAP_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("set MANGORTS_PROCESS_MAP_TEST_DATABASE_URL to a disposable local PostgreSQL 17 or 18 database")
	}
	if os.Getenv("MANGORTS_PROCESS_MAP_TEST_RESET_ACK") != "DROP_DISPOSABLE_SCHEMA" {
		t.Fatal("set MANGORTS_PROCESS_MAP_TEST_RESET_ACK=DROP_DISPOSABLE_SCHEMA for the guarded disposable test")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	privateHostAck := strings.TrimSpace(os.Getenv("MANGORTS_PROCESS_MAP_TEST_PRIVATE_HOST_ACK"))
	privateHostIP := net.ParseIP(config.Host)
	isLoopback := config.Host == "127.0.0.1" || strings.EqualFold(config.Host, "localhost")
	isAcknowledgedPrivateHost := privateHostAck != "" && config.Host == privateHostAck && privateHostIP != nil && privateHostIP.IsPrivate()
	if !isLoopback && !isAcknowledgedPrivateHost {
		t.Fatalf("refusing non-local disposable database host %q", config.Host)
	}
	config.RuntimeParams["client_encoding"] = "UTF8"
	config.RuntimeParams["application_name"] = "mangorts_process_map_test"
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	db := stdlib.OpenDB(*config)
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	t.Cleanup(func() { _ = db.Close() })

	var version int
	var databaseName string
	if err := db.QueryRow(`select current_setting('server_version_num')::integer,current_database()`).Scan(&version, &databaseName); err != nil {
		t.Fatal(err)
	}
	if version < 170000 || version >= 190000 || !strings.HasPrefix(databaseName, "mangorts_process_map_test") {
		t.Fatalf("refusing PostgreSQL version/database %d/%q", version, databaseName)
	}
	if _, err := db.Exec("drop schema public cascade; create schema public"); err != nil {
		t.Fatalf("reset disposable schema: %v", err)
	}
	return db
}

func openPostgresProcessMapIntegration(t *testing.T) (*sql.DB, *PostgresRepo) {
	t.Helper()
	db := openPostgresProcessMapTestDatabase(t)
	schema, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(schema)); err != nil {
		t.Fatalf("apply canonical schema: %v", err)
	}
	return db, NewPostgresRepo(db)
}

func TestPostgresProcessMapRepositoryLifecycle(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map repository test")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-postgres-admin", "process-map-admin@example.com", "Process Map Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	outsider, err := repo.UpsertAuthUser("process-map-postgres-outsider", "process-map-outsider@example.com", "Process Map Outsider")
	if err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Operations")
	if err != nil {
		t.Fatal(err)
	}
	processA, err := repo.CreateLogicGate(company.CompanyID, "Receive")
	if err != nil {
		t.Fatal(err)
	}
	processB, err := repo.CreateLogicGate(company.CompanyID, "Ship")
	if err != nil {
		t.Fatal(err)
	}
	parentID := folder.FolderID
	placements := []ProcessMapPlacementPutInput{
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 80, 40),
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, processA.LogicGateID, &parentID, 10, 10, 10, 6),
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, processB.LogicGateID, &parentID, 30, 10, 10, 6),
	}
	for _, input := range placements {
		if _, err := repo.PutProcessMapPlacement(ctx, input); err != nil {
			t.Fatalf("PutProcessMapPlacement(%s/%s): %v", input.ResourceType, input.ResourceID, err)
		}
	}
	denied := placements[1]
	denied.ActorUserID = outsider.UserID
	denied.PermissionUserID = outsider.UserID
	if _, err := repo.PutProcessMapPlacement(ctx, denied); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unauthorized placement error = %v, want %v", err, ErrNotFound)
	}

	relationshipInput := ResourceOperationalRelationshipCreateInput{
		CompanyID:   company.CompanyID,
		Source:      domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processA.LogicGateID},
		Target:      domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processB.LogicGateID},
		Trace:       &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{{X: 2, Y: 2}, {X: 2, Y: 4}, {X: 5, Y: 4}}},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}
	created, err := repo.CreateResourceOperationalRelationship(ctx, relationshipInput)
	if err != nil {
		t.Fatal(err)
	}
	if !created.Created || !created.Changed || created.Relationship == nil || len(created.Traces) != 1 || created.Traces[0].Revision != 1 {
		t.Fatalf("created relationship = %+v", created)
	}
	requireProcessMapRelationshipEventIdentities(t, created.Events, *created.Relationship)
	retry, err := repo.CreateResourceOperationalRelationship(ctx, relationshipInput)
	if err != nil {
		t.Fatal(err)
	}
	if retry.Created || retry.Changed || retry.Relationship == nil || len(retry.Traces) != 1 || retry.Traces[0].Revision != 1 || retry.Relationship.ResourceOperationalRelationshipID != created.Relationship.ResourceOperationalRelationshipID {
		t.Fatalf("idempotent relationship retry = %+v", retry)
	}

	scene, err := repo.GetProcessMapScene(ctx, ProcessMapSceneQuery{CompanyID: company.CompanyID, PermissionUserID: admin.UserID})
	if err != nil || scene.Bounds == nil || *scene.Bounds != (domain.ProcessMapBounds{MinX: 0, MinY: 0, MaxX: 80, MaxY: 40}) {
		t.Fatalf("global scene = %+v err=%v", scene, err)
	}
	tile, err := repo.GetProcessMapTile(ctx, ProcessMapTileQuery{CompanyID: company.CompanyID, PermissionUserID: admin.UserID, Z: 0, X: 0, Y: 0})
	if err != nil || len(tile.Placements) != 3 || len(tile.Traces) != 1 || len(tile.Traces[0].PathFragments) == 0 {
		t.Fatalf("global tile = %+v err=%v", tile, err)
	}
	if _, err := repo.GetProcessMapScene(ctx, ProcessMapSceneQuery{CompanyID: company.CompanyID, PermissionUserID: outsider.UserID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member scene error = %v, want %v", err, ErrNotFound)
	}

	points := []domain.ProcessMapRoutePoint{{X: 1, Y: 2}, {X: 1, Y: 6}, {X: 5, Y: 6}}
	traceInput := ProcessMapTracePutInput{CompanyID: company.CompanyID, ResourceOperationalRelationshipID: created.Relationship.ResourceOperationalRelationshipID, RoutePoints: points, ActorUserID: admin.UserID, PermissionUserID: admin.UserID}
	routed, err := repo.PutProcessMapTrace(ctx, traceInput)
	if err != nil || !routed.Changed || len(routed.Traces) != 1 || routed.Traces[0].Revision != 2 {
		t.Fatalf("rerouted trace = %+v err=%v", routed, err)
	}
	requireProcessMapRelationshipEventIdentities(t, routed.Events, *created.Relationship)
	identical, err := repo.PutProcessMapTrace(ctx, traceInput)
	if err != nil || identical.Changed || len(identical.Traces) != 1 || identical.Traces[0].Revision != 2 {
		t.Fatalf("identical trace retry = %+v err=%v", identical, err)
	}
	relationships, err := repo.ListResourceOperationalRelationshipsForResource(ctx, ResourceOperationalRelationshipQuery{
		CompanyID: company.CompanyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processA.LogicGateID, Direction: "outgoing", PermissionUserID: admin.UserID,
	})
	if err != nil || len(relationships) != 1 || relationships[0].ResourceOperationalRelationshipID != created.Relationship.ResourceOperationalRelationshipID {
		t.Fatalf("bounded relationships = %+v err=%v", relationships, err)
	}

	deletedPlacement, err := repo.DeleteProcessMapPlacement(ctx, ProcessMapPlacementDeleteInput{
		CompanyID: company.CompanyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processB.LogicGateID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil || len(deletedPlacement.DeletedTraceIDs) != 1 || deletedPlacement.DeletedTraceIDs[0] != created.Relationship.ResourceOperationalRelationshipID {
		t.Fatalf("placement delete envelope = %+v err=%v", deletedPlacement, err)
	}
	deletedRelationship, err := repo.DeleteResourceOperationalRelationship(ctx, ResourceOperationalRelationshipDeleteInput{
		CompanyID: company.CompanyID, ResourceOperationalRelationshipID: created.Relationship.ResourceOperationalRelationshipID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	requireProcessMapRelationshipEventIdentities(t, deletedRelationship.Events, *created.Relationship)
	var relationshipCount, traceCount, placementCount int
	if err := db.QueryRow(`select count(*) from resource_operational_relationships where company_id=$1::uuid`, company.CompanyID).Scan(&relationshipCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select count(*) from process_map_traces where company_id=$1::uuid`, company.CompanyID).Scan(&traceCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select count(*) from process_map_placements where company_id=$1::uuid`, company.CompanyID).Scan(&placementCount); err != nil {
		t.Fatal(err)
	}
	if relationshipCount != 0 || traceCount != 0 || placementCount != 2 {
		t.Fatalf("delete counts relationships=%d traces=%d placements=%d, want 0/0/2", relationshipCount, traceCount, placementCount)
	}
}

func TestPostgresProcessMapFolderResizeDoesNotRequireUnmovedDescendantAccess(t *testing.T) {
	ctx := context.Background()
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map Folder resize permission test")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-resize-admin", "process-map-resize-admin@example.com", "Resize Admin")
	if err != nil {
		t.Fatal(err)
	}
	viewer, err := repo.UpsertAuthUser("process-map-resize-viewer", "process-map-resize-viewer@example.com", "Resize Viewer")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(viewer.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Visible Folder")
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateLogicGate(company.CompanyID, "Restricted Child")
	if err != nil {
		t.Fatal(err)
	}
	parentID := folder.FolderID
	for _, input := range []ProcessMapPlacementPutInput{
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 50, 40),
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, child.LogicGateID, &parentID, 10, 10, 10, 6),
	} {
		if _, err := repo.PutProcessMapPlacement(ctx, input); err != nil {
			t.Fatal(err)
		}
	}
	noAccess := ResourceDefaultAccessNoAccess
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: child.LogicGateID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess, DescendantAction: PolicyDescendantActionInheritedOnly,
		ActorUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}

	resized, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
		company.CompanyID, viewer.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 60, 50,
	))
	if err != nil || len(resized.Placements) != 1 || resized.Placements[0].GridWidth != 60 {
		t.Fatalf("Folder resize with restricted unmoved child = %+v, err=%v", resized, err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
		company.CompanyID, viewer.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 1, 0, 60, 50,
	)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Folder group move with restricted child error = %v, want %v", err, ErrNotFound)
	}
}

func TestPostgresProcessMapSceneTilePrivacyMatchesMemory(t *testing.T) {
	ctx := context.Background()
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map privacy test")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-privacy-admin", "process-map-privacy-admin@example.com", "Privacy Admin")
	if err != nil {
		t.Fatal(err)
	}
	viewer, err := repo.UpsertAuthUser("process-map-privacy-viewer", "process-map-privacy-viewer@example.com", "Privacy Viewer")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(viewer.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	visible, _ := repo.CreateLogicGate(company.CompanyID, "Visible")
	hidden, _ := repo.CreateLogicGate(company.CompanyID, "Hidden")
	for _, input := range []ProcessMapPlacementPutInput{
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, visible.LogicGateID, nil, 0, 0, 10, 8),
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, hidden.LogicGateID, nil, 100, 20, 90, 70),
	} {
		if _, err := repo.PutProcessMapPlacement(ctx, input); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
		CompanyID:   company.CompanyID,
		Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, visible.LogicGateID),
		Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, hidden.LogicGateID),
		Trace:       &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{{X: 50, Y: 4}}},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	noAccess := ResourceDefaultAccessNoAccess
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: hidden.LogicGateID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess, DescendantAction: PolicyDescendantActionInheritedOnly,
		ActorUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	scene, err := repo.GetProcessMapScene(ctx, ProcessMapSceneQuery{CompanyID: company.CompanyID, PermissionUserID: viewer.UserID})
	if err != nil || scene.Bounds == nil || *scene.Bounds != (domain.ProcessMapBounds{MinX: 0, MinY: 0, MaxX: 104, MaxY: 23}) {
		t.Fatalf("permission-safe scene = %+v err=%v", scene, err)
	}
	tile, err := repo.GetProcessMapTile(ctx, ProcessMapTileQuery{CompanyID: company.CompanyID, PermissionUserID: viewer.UserID, Z: 0, X: 0, Y: 0})
	if err != nil || len(tile.Placements) != 2 || len(tile.Traces) != 0 {
		t.Fatalf("permission-safe tile = %+v err=%v", tile, err)
	}
	wire, err := json.Marshal(tile)
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Placements []map[string]any `json:"placements"`
	}
	if err := json.Unmarshal(wire, &payload); err != nil {
		t.Fatal(err)
	}
	for _, item := range payload.Placements {
		if restricted, _ := item["restricted"].(bool); restricted && len(item) != 3 {
			t.Fatalf("restricted placeholder leaked fields: %+v", item)
		}
	}
}

func TestPostgresCompanyMembershipProcessMapInvalidationLifecycle(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	companyA, err := repo.CreateCompany("Membership Process Map A")
	if err != nil {
		t.Fatal(err)
	}
	companyB, err := repo.CreateCompany("Membership Process Map B")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("postgres-membership-process-map", "postgres-membership-process-map@example.com", "Postgres Membership")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyB.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	created, err := repo.AddCompanyMembership(user.CognitoSubject, companyA.CompanyID, domain.RoleCompanyUser)
	if err != nil {
		t.Fatal(err)
	}
	versionBeforeRetry := postgresProcessMapVersionForTest(t, repo, companyA.CompanyID)
	policyGroupVersionBeforeRetry := postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID)
	var eventCountBeforeRetry int
	if err := db.QueryRow(`select count(*) from domain_events where event_type=$1`, CompanyMembershipSavedEventType).Scan(&eventCountBeforeRetry); err != nil {
		t.Fatal(err)
	}
	retry, err := repo.AddCompanyMembership(user.CognitoSubject, companyA.CompanyID, domain.RoleCompanyUser)
	if err != nil {
		t.Fatal(err)
	}
	if !retry.UpdatedTimestamp.Equal(created.UpdatedTimestamp) {
		t.Fatalf("same-role PostgreSQL retry changed timestamp: %s != %s", retry.UpdatedTimestamp, created.UpdatedTimestamp)
	}
	var eventCountAfterRetry int
	if err := db.QueryRow(`select count(*) from domain_events where event_type=$1`, CompanyMembershipSavedEventType).Scan(&eventCountAfterRetry); err != nil {
		t.Fatal(err)
	}
	if eventCountAfterRetry != eventCountBeforeRetry || postgresProcessMapVersionForTest(t, repo, companyA.CompanyID) != versionBeforeRetry || postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID) != policyGroupVersionBeforeRetry {
		t.Fatalf("same-role retry changed event/version: events %d->%d Process Map %d->%d policy/group %d->%d", eventCountBeforeRetry, eventCountAfterRetry, versionBeforeRetry, postgresProcessMapVersionForTest(t, repo, companyA.CompanyID), policyGroupVersionBeforeRetry, postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID))
	}

	versionABeforeGrant := postgresProcessMapVersionForTest(t, repo, companyA.CompanyID)
	versionBBeforeGrant := postgresProcessMapVersionForTest(t, repo, companyB.CompanyID)
	policyGroupABeforeGrant := postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID)
	policyGroupBBeforeGrant := postgresPolicyGroupVersionForTest(t, repo, companyB.CompanyID)
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyA.CompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyA.CompanyID); got <= versionABeforeGrant {
		t.Fatalf("dev-admin grant did not advance company A Process Map version: %d <= %d", got, versionABeforeGrant)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyB.CompanyID); got <= versionBBeforeGrant {
		t.Fatalf("dev-admin grant did not advance company B Process Map version: %d <= %d", got, versionBBeforeGrant)
	}
	if got := postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID); got <= policyGroupABeforeGrant {
		t.Fatalf("dev-admin grant did not advance company A policy/group version: %d <= %d", got, policyGroupABeforeGrant)
	}
	if got := postgresPolicyGroupVersionForTest(t, repo, companyB.CompanyID); got <= policyGroupBBeforeGrant {
		t.Fatalf("dev-admin grant did not advance company B policy/group version: %d <= %d", got, policyGroupBBeforeGrant)
	}

	versionABeforeDelete := postgresProcessMapVersionForTest(t, repo, companyA.CompanyID)
	versionBBeforeDelete := postgresProcessMapVersionForTest(t, repo, companyB.CompanyID)
	policyGroupABeforeDelete := postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID)
	policyGroupBBeforeDelete := postgresPolicyGroupVersionForTest(t, repo, companyB.CompanyID)
	if _, err := repo.DeleteCompanyUser(companyA.CompanyID, user.UserID, false); err != nil {
		t.Fatal(err)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyA.CompanyID); got <= versionABeforeDelete {
		t.Fatalf("dev-admin deletion did not advance company A Process Map version: %d <= %d", got, versionABeforeDelete)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyB.CompanyID); got <= versionBBeforeDelete {
		t.Fatalf("dev-admin deletion did not advance company B Process Map version: %d <= %d", got, versionBBeforeDelete)
	}
	if got := postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID); got <= policyGroupABeforeDelete {
		t.Fatalf("dev-admin deletion did not advance company A policy/group version: %d <= %d", got, policyGroupABeforeDelete)
	}
	if got := postgresPolicyGroupVersionForTest(t, repo, companyB.CompanyID); got <= policyGroupBBeforeDelete {
		t.Fatalf("dev-admin deletion did not advance company B policy/group version: %d <= %d", got, policyGroupBBeforeDelete)
	}
	for _, companyID := range []string{companyA.CompanyID, companyB.CompanyID} {
		var allowedJSON []byte
		if err := db.QueryRow(`
select allowed_user_ids
from realtime_outbox
where company_id=$1::uuid
  and scope='process-map:company'
  and event_type='process_map.changed'
order by outbox_sequence desc
limit 1`, companyID).Scan(&allowedJSON); err != nil {
			t.Fatal(err)
		}
		var allowed []string
		if err := json.Unmarshal(allowedJSON, &allowed); err != nil {
			t.Fatal(err)
		}
		if !slices.Contains(allowed, user.UserID) {
			t.Fatalf("revoked user missing from PostgreSQL invalidation audience for %s: %v", companyID, allowed)
		}
	}
}

func TestPostgresPendingInvitationDowngradeInvalidatesGlobalDevAdmin(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	companyA, err := repo.CreateCompany("Postgres invitation A")
	if err != nil {
		t.Fatal(err)
	}
	companyB, err := repo.CreateCompany("Postgres invitation B")
	if err != nil {
		t.Fatal(err)
	}
	inviter, err := repo.UpsertAuthUser("postgres-invitation-fence-admin", "postgres-invitation-fence-admin@example.com", "Invitation Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(inviter.CognitoSubject, companyA.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	invitation, err := repo.CreateInvitation(CreateInvitationInput{
		CompanyID: companyA.CompanyID, Email: "postgres-pending-global@example.com",
		Role: domain.RoleCompanyUser, InvitedByUserID: inviter.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	invitee, err := repo.UpsertAuthUser("postgres-pending-global-user", "postgres-pending-global@example.com", "Pending Global")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(invitee.CognitoSubject, companyA.CompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	processBefore := map[string]int64{
		companyA.CompanyID: postgresProcessMapVersionForTest(t, repo, companyA.CompanyID),
		companyB.CompanyID: postgresProcessMapVersionForTest(t, repo, companyB.CompanyID),
	}
	policyBefore := map[string]int64{
		companyA.CompanyID: postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID),
		companyB.CompanyID: postgresPolicyGroupVersionForTest(t, repo, companyB.CompanyID),
	}
	if _, err := repo.AcceptInvitation(invitation.Token, invitee.CognitoSubject, invitee.Email, invitee.DisplayName); err != nil {
		t.Fatal(err)
	}
	membership, err := repo.GetCompanyUser(companyA.CompanyID, invitee.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if membership.Role != domain.RoleCompanyUser {
		t.Fatalf("accepted invitation role = %q, want %q", membership.Role, domain.RoleCompanyUser)
	}
	for _, companyID := range []string{companyA.CompanyID, companyB.CompanyID} {
		if got := postgresProcessMapVersionForTest(t, repo, companyID); got <= processBefore[companyID] {
			t.Fatalf("invitation downgrade Process Map version for %s = %d, want > %d", companyID, got, processBefore[companyID])
		}
		if got := postgresPolicyGroupVersionForTest(t, repo, companyID); got <= policyBefore[companyID] {
			t.Fatalf("invitation downgrade policy/group version for %s = %d, want > %d", companyID, got, policyBefore[companyID])
		}
	}
}

func TestPostgresProcessMapRecycleFolderRestoreDoesNotReclaimRecreatedCleanupChild(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map cleanup incarnation fence")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-cleanup-incarnation-admin", "process-map-cleanup-incarnation@example.com", "Cleanup Incarnation Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Map perimeter")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.CreateLogicGate(company.CompanyID, "Surviving Process")
	if err != nil {
		t.Fatal(err)
	}
	parentID := folder.FolderID
	for _, input := range []ProcessMapPlacementPutInput{
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 80, 60),
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, &parentID, 11, 13, 9, 6),
	} {
		if _, err := repo.PutProcessMapPlacement(ctx, input); err != nil {
			t.Fatal(err)
		}
	}

	placementState := func() (string, string) {
		t.Helper()
		var token, state string
		if err := db.QueryRow(`
select placement_incarnation_token::text,
       jsonb_build_object(
         'map_parent_folder_id',map_parent_folder_id,
         'revision',revision,
         'created_timestamp',created_timestamp,
         'updated_timestamp',updated_timestamp,
         'grid_x',grid_x,'grid_y',grid_y,'grid_width',grid_width,'grid_height',grid_height
       )::text
from process_map_placements
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, company.CompanyID, process.LogicGateID).Scan(&token, &state); err != nil {
			t.Fatal(err)
		}
		return token, state
	}
	originalToken, _ := placementState()
	if _, err := repo.DeleteCompanyExplorerTargets(company.CompanyID, []CompanyExplorerDeleteTargetInput{{Kind: "folder", ID: folder.FolderID}}, admin.UserID); err != nil {
		t.Fatal(err)
	}
	cleanupToken, cleanupState := placementState()
	if cleanupToken != originalToken {
		t.Fatalf("Folder cleanup changed placement incarnation token: %s -> %s", originalToken, cleanupToken)
	}

	items, err := repo.ListRecycleBinItems(company.CompanyID, admin.UserID)
	if err != nil || len(items) != 1 {
		t.Fatalf("Folder recycle items = %+v, err=%v", items, err)
	}
	folderRecycleID := items[0].RecycleBinItemID
	var claimedToken string
	if err := db.QueryRow(`
select claim->>'placement_incarnation_token'
from recycle_bin_items item
cross join lateral jsonb_array_elements(coalesce(item.restore_payload->'process_map_cleanup_child_reparents','[]'::jsonb)) claim
where item.company_id=$1::uuid and item.recycle_bin_item_id=$2::uuid
  and claim->>'resource_id'=$3`, company.CompanyID, folderRecycleID, process.LogicGateID).Scan(&claimedToken); err != nil {
		t.Fatal(err)
	}
	if claimedToken != cleanupToken {
		t.Fatalf("cleanup claim token = %q, want %q", claimedToken, cleanupToken)
	}

	var placementPayload []byte
	if err := db.QueryRow(`
select jsonb_agg(to_jsonb(placement))
from process_map_placements placement
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, company.CompanyID, process.LogicGateID).Scan(&placementPayload); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `delete from process_map_placements where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, company.CompanyID, process.LogicGateID); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := postgresRestoreProcessMapPlacementsTx(ctx, tx, json.RawMessage(placementPayload)); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	recreatedToken, recreatedState := placementState()
	if recreatedToken == cleanupToken {
		t.Fatalf("restored placement reused incarnation token %s", recreatedToken)
	}
	if recreatedState != cleanupState {
		t.Fatalf("restored placement claim fields changed:\ncleanup:   %s\nrecreated: %s", cleanupState, recreatedState)
	}

	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, admin.UserID, []string{folderRecycleID}); err != nil {
		t.Fatal(err)
	}
	finalToken, finalState := placementState()
	if finalToken != recreatedToken || finalState != recreatedState {
		t.Fatalf("Folder restore reclaimed recreated cleanup child:\nbefore: %s %s\nafter:  %s %s", recreatedToken, recreatedState, finalToken, finalState)
	}
}
