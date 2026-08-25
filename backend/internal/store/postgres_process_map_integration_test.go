package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
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

func openPostgresProcessMapIntegration(t *testing.T) (*sql.DB, *PostgresRepo) {
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
	if config.Host != "127.0.0.1" && !strings.EqualFold(config.Host, "localhost") {
		t.Fatalf("refusing non-local disposable database host %q", config.Host)
	}
	config.RuntimeParams["client_encoding"] = "UTF8"
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	db := stdlib.OpenDB(*config)
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
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
		processMapTestPlacementInput(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0),
		processMapTestPlacementInput(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, processA.LogicGateID, &parentID, 1, 2),
		processMapTestPlacementInput(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, processB.LogicGateID, &parentID, 5, 2),
	}
	for _, input := range placements {
		if _, err := repo.PutProcessMapPlacement(input); err != nil {
			t.Fatalf("PutProcessMapPlacement(%s/%s): %v", input.ResourceType, input.ResourceID, err)
		}
	}
	denied := placements[1]
	denied.ActorUserID = outsider.UserID
	denied.PermissionUserID = outsider.UserID
	if _, err := repo.PutProcessMapPlacement(denied); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unauthorized placement error = %v, want %v", err, ErrNotFound)
	}

	relationshipInput := ResourceOperationalRelationshipCreateInput{
		CompanyID:   company.CompanyID,
		Source:      domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processA.LogicGateID},
		Target:      domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processB.LogicGateID},
		Trace:       &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{{X: 2, Y: 2}, {X: 2, Y: 4}, {X: 5, Y: 4}}},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}
	created, err := repo.CreateResourceOperationalRelationship(relationshipInput)
	if err != nil {
		t.Fatal(err)
	}
	if !created.RelationshipCreated || !created.TraceChanged || created.Trace == nil || created.Trace.Revision != 1 {
		t.Fatalf("created relationship = %+v", created)
	}
	retry, err := repo.CreateResourceOperationalRelationship(relationshipInput)
	if err != nil {
		t.Fatal(err)
	}
	if retry.RelationshipCreated || retry.TraceChanged || retry.Trace == nil || retry.Trace.Revision != 1 || retry.Relationship.ResourceOperationalRelationshipID != created.Relationship.ResourceOperationalRelationshipID {
		t.Fatalf("idempotent relationship retry = %+v", retry)
	}

	layer, err := repo.GetProcessMapLayer(ProcessMapLayerQuery{CompanyID: company.CompanyID, FolderID: folder.FolderID, PermissionUserID: admin.UserID})
	if err != nil || len(layer.Placements) != 2 || len(layer.Traces) != 1 {
		t.Fatalf("folder layer placements=%d traces=%d err=%v", len(layer.Placements), len(layer.Traces), err)
	}
	rootForOutsider, err := repo.GetProcessMapLayer(ProcessMapLayerQuery{CompanyID: company.CompanyID, PermissionUserID: outsider.UserID})
	if err != nil || len(rootForOutsider.Placements) != 1 || len(rootForOutsider.Traces) != 0 {
		t.Fatalf("restricted root placements=%d traces=%d err=%v", len(rootForOutsider.Placements), len(rootForOutsider.Traces), err)
	}
	if _, ok := rootForOutsider.Placements[0].(domain.ProcessMapRestrictedPlacement); !ok {
		t.Fatalf("outsider root placement = %#v, want restricted projection", rootForOutsider.Placements[0])
	}
	if _, err := repo.GetProcessMapLayer(ProcessMapLayerQuery{CompanyID: company.CompanyID, FolderID: folder.FolderID, PermissionUserID: outsider.UserID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restricted folder layer error = %v, want %v", err, ErrNotFound)
	}

	points := []domain.ProcessMapRoutePoint{{X: 1, Y: 2}, {X: 1, Y: 6}, {X: 5, Y: 6}}
	traceInput := ProcessMapTracePutInput{CompanyID: company.CompanyID, ResourceOperationalRelationshipID: created.Relationship.ResourceOperationalRelationshipID, RoutePoints: points, ActorUserID: admin.UserID, PermissionUserID: admin.UserID}
	routed, err := repo.PutProcessMapTrace(traceInput)
	if err != nil || !routed.Changed || routed.Trace.Revision != 2 {
		t.Fatalf("rerouted trace = %+v err=%v", routed, err)
	}
	identical, err := repo.PutProcessMapTrace(traceInput)
	if err != nil || identical.Changed || identical.Trace.Revision != 2 {
		t.Fatalf("identical trace retry = %+v err=%v", identical, err)
	}
	relationships, err := repo.ListResourceOperationalRelationshipsForResource(ResourceOperationalRelationshipQuery{
		CompanyID: company.CompanyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processA.LogicGateID, Direction: "outgoing", PermissionUserID: admin.UserID,
	})
	if err != nil || len(relationships) != 1 || relationships[0].ResourceOperationalRelationshipID != created.Relationship.ResourceOperationalRelationshipID {
		t.Fatalf("bounded relationships = %+v err=%v", relationships, err)
	}

	if _, err := repo.DeleteResourceOperationalRelationship(ResourceOperationalRelationshipDeleteInput{
		CompanyID: company.CompanyID, ResourceOperationalRelationshipID: created.Relationship.ResourceOperationalRelationshipID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
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
	if relationshipCount != 0 || traceCount != 0 || placementCount != 3 {
		t.Fatalf("delete counts relationships=%d traces=%d placements=%d, want 0/0/3", relationshipCount, traceCount, placementCount)
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
