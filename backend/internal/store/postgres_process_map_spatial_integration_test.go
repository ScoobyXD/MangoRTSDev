package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"

	"miraeopus/backend/internal/domain"
)

type processMapTileQueryTrace struct {
	statements []string
}

func (trace *processMapTileQueryTrace) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	trace.statements = append(trace.statements, data.SQL)
	return ctx
}

func (*processMapTileQueryTrace) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func TestPostgresProcessMapTileLODMatchesMemoryProjection(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map PostgreSQL LOD parity")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-lod-admin", "process-map-lod@example.com", "LOD Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	viewer, err := repo.UpsertAuthUser("process-map-lod-viewer", "process-map-lod-viewer@example.com", "LOD Viewer")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(viewer.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}

	type fixture struct {
		name                string
		x, y, width, height int
		presentation        domain.ProcessMapPresentation
	}
	fixtures := []fixture{
		{name: "Small", x: 10, y: 10, width: 7, height: 5, presentation: domain.ProcessMapPresentationWhole},
		{name: "Small Target", x: 30, y: 10, width: 7, height: 5, presentation: domain.ProcessMapPresentationWhole},
		{name: "Medium", x: 100, y: 20, width: 100, height: 100, presentation: domain.ProcessMapPresentationNormal},
		{name: "Large", x: 300, y: 200, width: 400, height: 400, presentation: domain.ProcessMapPresentationEditing},
		{name: "Large Target", x: 700, y: 600, width: 400, height: 400, presentation: domain.ProcessMapPresentationEditing},
	}
	processIDs := map[string]string{}
	for _, item := range fixtures {
		process, err := repo.CreateLogicGate(company.CompanyID, item.name)
		if err != nil {
			t.Fatal(err)
		}
		processIDs[item.name] = process.LogicGateID
		if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
			company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, nil,
			item.x, item.y, item.width, item.height,
		)); err != nil {
			t.Fatal(err)
		}
	}
	folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Folder without Process RACI")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
		company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 650, 400, 400,
	)); err != nil {
		t.Fatal(err)
	}
	hidden, err := repo.CreateLogicGate(company.CompanyID, "Denied editing-size Process")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
		company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, hidden.LogicGateID, nil, 800, 10, 400, 400,
	)); err != nil {
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
	accountabilityGroup, err := repo.CreateCompanyUserGroup(company.CompanyID, "", "Accountability Team")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: processIDs["Large"],
		AssignmentMode: PolicyModeCustomized, DescendantAction: PolicyDescendantActionInheritedOnly,
		Assignments: []ResourceRACIAssignmentInput{
			{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: admin.UserID},
			{Role: domain.RACIRoleAccountable, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: accountabilityGroup.GroupID},
		},
	}); err != nil {
		t.Fatal(err)
	}
	green := "green"
	if _, err := repo.PutLogicGateQDRating(QDRatingPutInput{
		CompanyID: company.CompanyID, LogicGateID: processIDs["Large"], Metric: QDRatingMetricQuality,
		Rating: &green, RatedByUserID: admin.UserID, RatedByDisplayName: admin.DisplayName, Now: time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}

	wholeRoute := []domain.ProcessMapRoutePoint{{X: 24, Y: 12}}
	wholeRelationship, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
		CompanyID:   company.CompanyID,
		Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, processIDs["Small"]),
		Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, processIDs["Small Target"]),
		Trace:       &ProcessMapTraceInput{RoutePoints: wholeRoute},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	editingRoute := []domain.ProcessMapRoutePoint{{X: 800, Y: 400}}
	editingRelationship, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
		CompanyID:   company.CompanyID,
		Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, processIDs["Large"]),
		Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, processIDs["Large Target"]),
		Trace:       &ProcessMapTraceInput{RoutePoints: editingRoute},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Fail on entry rather than checking elapsed time: no RACI resolution is
	// allowed for whole/normal LOD, Folders, or denied Process candidates.
	var resolverDefinition string
	if err := db.QueryRow(`select pg_get_functiondef('mangorts_v2_resolve_gvic_policy(uuid,text,uuid)'::regprocedure)`).Scan(&resolverDefinition); err != nil {
		t.Fatal(err)
	}
	bodyStart := strings.Index(resolverDefinition, "AS $function$")
	if bodyStart < 0 {
		t.Fatal("GVIC resolver definition has no function body")
	}
	if _, err := db.Exec(`alter function mangorts_v2_resolve_gvic_policy(uuid,text,uuid) rename to process_map_test_original_gvic_resolver`); err != nil {
		t.Fatal(err)
	}
	guardDefinition := strings.Replace(resolverDefinition[:bodyStart], "LANGUAGE sql", "LANGUAGE plpgsql", 1) + fmt.Sprintf(`AS $function$
begin
  if p_resource_type <> 'logic_gate' or p_resource_id not in ('%s'::uuid,'%s'::uuid) then
    raise exception 'unexpected Process Map RACI resolution for %%/%%', p_resource_type, p_resource_id;
  end if;
  return query select * from process_map_test_original_gvic_resolver(p_company_id,p_resource_type,p_resource_id);
end;
$function$`, processIDs["Large"], processIDs["Large Target"])
	if _, err := db.Exec(guardDefinition); err != nil {
		t.Fatal(err)
	}

	// Trace only the repository read through another connection to this same
	// disposable fixture; BEGIN, COMMIT, and separate payload reads count too.
	connection, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var config *pgx.ConnConfig
	if err := connection.Raw(func(raw any) error {
		config = raw.(*stdlib.Conn).Conn().Config()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := connection.Close(); err != nil {
		t.Fatal(err)
	}
	queryTrace := &processMapTileQueryTrace{}
	config.Tracer = queryTrace
	config.RuntimeParams["default_transaction_read_only"] = "on"
	tracedDB := stdlib.OpenDB(*config)
	t.Cleanup(func() { _ = tracedDB.Close() })
	tracedRepo := NewPostgresRepo(tracedDB)
	query := ProcessMapTileQuery{
		CompanyID: company.CompanyID, PermissionUserID: viewer.UserID, Z: 20, X: 0, Y: 0,
	}
	tile, err := tracedRepo.GetProcessMapTile(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	if len(queryTrace.statements) != 1 {
		t.Fatalf("complete tile executed %d statements, want one", len(queryTrace.statements))
	}
	t.Log("complete tile: 1 SQL statement, including authorization, metadata, placements, and traces")
	if tile.Metadata.ActorRole != domain.RoleCompanyUser || tile.Metadata.ProcessMapVersion != tile.ProcessMapReadVersion ||
		tile.Metadata.ProcessMapVersion != postgresProcessMapVersionForTest(t, repo, company.CompanyID) ||
		tile.Metadata.PermissionGroupVersion != postgresPolicyGroupVersionForTest(t, repo, company.CompanyID) {
		t.Fatalf("tile authorization/version metadata = %+v", tile.Metadata)
	}
	if _, err := time.Parse("2006-01-02", tile.Metadata.BusinessDate); err != nil {
		t.Fatalf("tile business date = %q: %v", tile.Metadata.BusinessDate, err)
	}
	queryTrace.statements = nil
	metadata, err := tracedRepo.GetProcessMapTileMetadata(ctx, query)
	if err != nil || metadata != tile.Metadata || len(queryTrace.statements) != 1 {
		t.Fatalf("lightweight tile metadata = %+v, err=%v, statements=%d; want %+v in one statement", metadata, err, len(queryTrace.statements), tile.Metadata)
	}
	for _, heavyTable := range []string{"process_map_placements", "process_map_traces", "scorecards", "mangorts_v2_resolve_gvic_policy"} {
		if strings.Contains(queryTrace.statements[0], heavyTable) {
			t.Fatalf("lightweight tile metadata ran heavy query branch %q", heavyTable)
		}
	}
	t.Log("conditional metadata check: 1 SQL statement, without heavy tile branches")
	canceledCtx, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := tracedRepo.GetProcessMapTileMetadata(canceledCtx, query); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled tile metadata error = %v, want context.Canceled", err)
	}
	placementsByID := map[string]domain.ProcessMapVisiblePlacement{}
	restrictedCount := 0
	for _, item := range tile.Placements {
		if restricted, ok := item.(domain.ProcessMapRestrictedPlacement); ok {
			restrictedCount++
			if restricted.GridX != 800 || restricted.GridY != 10 {
				t.Fatalf("restricted placement = %+v", restricted)
			}
			continue
		}
		placement, ok := item.(domain.ProcessMapVisiblePlacement)
		if !ok {
			t.Fatalf("LOD placement type = %T", item)
		}
		placementsByID[placement.ResourceID] = placement
	}
	if restrictedCount != 1 || len(placementsByID) != len(fixtures)+1 || placementsByID[folder.FolderID].ResourceType != domain.ProcessMapResourceTypeFolder {
		t.Fatalf("LOD tile omitted ineligible candidates: %d restricted, %d visible", restrictedCount, len(placementsByID))
	}
	for _, item := range fixtures {
		placement, ok := placementsByID[processIDs[item.name]]
		if !ok {
			t.Fatalf("LOD tile missing %s", item.name)
		}
		wantName := item.name
		if item.presentation == domain.ProcessMapPresentationWhole {
			wantName = ""
		}
		if placement.Presentation != item.presentation || placement.Name != wantName {
			t.Fatalf("PostgreSQL %s projection = %s/%q, want memory parity %s/%q", item.name, placement.Presentation, placement.Name, item.presentation, wantName)
		}
	}
	large := placementsByID[processIDs["Large"]]
	if large.ScoreCard == nil || large.ScoreCard.QualityRating == nil || *large.ScoreCard.QualityRating != green ||
		!reflect.DeepEqual(large.ResponsibleNames, []string{admin.DisplayName}) ||
		!reflect.DeepEqual(large.AccountableNames, []string{accountabilityGroup.Name}) {
		t.Fatalf("PostgreSQL editing Process summary = %+v", large)
	}

	traceByID := map[string]domain.ProcessMapTileTrace{}
	for _, trace := range tile.Traces {
		traceByID[trace.ResourceOperationalRelationshipID] = trace
	}
	wholeTrace := traceByID[wholeRelationship.Relationship.ResourceOperationalRelationshipID]
	if wholeTrace.Presentation != domain.ProcessMapPresentationWhole || len(wholeTrace.RoutePoints) != 0 {
		t.Fatalf("whole trace projection = %+v, want omitted route_points", wholeTrace)
	}
	editingTrace := traceByID[editingRelationship.Relationship.ResourceOperationalRelationshipID]
	if editingTrace.Presentation != domain.ProcessMapPresentationEditing || !reflect.DeepEqual(editingTrace.RoutePoints, editingRoute) {
		t.Fatalf("editing trace projection = %+v, want route_points %v", editingTrace, editingRoute)
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
	for _, placement := range payload.Placements {
		resourceID, _ := placement["resource_id"].(string)
		if resourceID == processIDs["Small"] {
			if _, leaked := placement["name"]; leaked {
				t.Fatalf("whole placement leaked coarse name on the wire: %+v", placement)
			}
		}
	}
	if len(tile.Traces) != 2 {
		t.Fatalf("independent placement and trace branches returned %d traces, want 2", len(tile.Traces))
	}

	if _, err := repo.AddCompanyMembership(viewer.CognitoSubject, company.CompanyID, domain.RoleCompanyManager); err != nil {
		t.Fatal(err)
	}
	metadata, err = tracedRepo.GetProcessMapTileMetadata(ctx, query)
	if err != nil || metadata.ActorRole != domain.RoleCompanyManager || metadata.PermissionGroupVersion <= tile.Metadata.PermissionGroupVersion {
		t.Fatalf("fresh role metadata = %+v, err=%v", metadata, err)
	}
	otherCompany, err := repo.CreateCompany("Global Process Map administrator membership")
	if err != nil {
		t.Fatal(err)
	}
	// Keep the user alive while revoking access to the map's company.
	if _, err := repo.AddCompanyMembership(viewer.CognitoSubject, otherCompany.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.DeleteCompanyUser(company.CompanyID, viewer.UserID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := tracedRepo.GetProcessMapTileMetadata(ctx, query); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked metadata read error = %v, want ErrNotFound", err)
	}
	if _, err := tracedRepo.GetProcessMapTile(ctx, query); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked complete tile error = %v, want ErrNotFound", err)
	}
	if _, err := repo.AddCompanyMembership(viewer.CognitoSubject, otherCompany.CompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	metadata, err = tracedRepo.GetProcessMapTileMetadata(ctx, query)
	if err != nil || metadata.ActorRole != domain.RoleDevAdmin {
		t.Fatalf("global administrator metadata = %+v, err=%v", metadata, err)
	}
}

func TestPostgresProcessMapTileRestrictedBoundaryAndParentVisibility(t *testing.T) {
	ctx := context.Background()
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map restricted spatial boundaries")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("map-boundary-admin", "map-boundary-admin@example.com", "Boundary Admin")
	if err != nil {
		t.Fatal(err)
	}
	viewer, err := repo.UpsertAuthUser("map-boundary-viewer", "map-boundary-viewer@example.com", "Boundary Viewer")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(viewer.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	noAccess := ResourceDefaultAccessNoAccess
	visibleIDs := map[string]bool{}
	for _, item := range []struct {
		name             string
		x, y, width      int
		denied, included bool
	}{
		{"small denied crosses left", -2, 10, 1, true, false},
		{"small denied crosses top", 10, -1, 1, true, false},
		{"denied touches left", -4, 30, 1, true, false},
		{"denied real bounds alone cross left", -20, 40, 30, true, false},
		{"visible placeholder alone crosses left", -2, 60, 1, false, false},
		{"visible real bounds cross left", -20, 80, 30, false, true},
	} {
		process, err := repo.CreateLogicGate(company.CompanyID, item.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
			company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, nil, item.x, item.y, item.width, 1,
		)); err != nil {
			t.Fatal(err)
		}
		if item.denied {
			if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
				CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: process.LogicGateID,
				PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess,
				DescendantAction: PolicyDescendantActionInheritedOnly, ActorUserID: admin.UserID,
			}); err != nil {
				t.Fatal(err)
			}
		}
		if item.included {
			visibleIDs[process.LogicGateID] = true
		}
	}
	folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Hidden parent")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
		company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 40, 100, 100, 100,
	)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: company.CompanyID, ResourceType: EntityTypeCompanyExplorerFolder, ResourceID: folder.FolderID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess,
		DescendantAction: PolicyDescendantActionInheritedOnly, ActorUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	for index, inherited := range []bool{false, true} {
		process, err := repo.CreateLogicGate(company.CompanyID, fmt.Sprintf("Child inherited=%t", inherited))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
			company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, &folder.FolderID, 50+index*30, 110, 10, 10,
		)); err != nil {
			t.Fatal(err)
		}
		edit := ResourceDefaultAccessEdit
		policy := ResourcePermissionPolicyUpdateInput{
			CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: process.LogicGateID,
			PermissionMode: PolicyModeCustomized, DefaultAccess: &edit,
			DescendantAction: PolicyDescendantActionInheritedOnly, ActorUserID: admin.UserID,
		}
		if inherited {
			policy.PermissionMode = PolicyModeInherited
			policy.DefaultAccess = nil
		} else {
			visibleIDs[process.LogicGateID] = true
		}
		if _, _, err := repo.PutResourcePermissionPolicy(policy); err != nil {
			t.Fatal(err)
		}
	}
	tile, err := repo.GetProcessMapTile(ctx, ProcessMapTileQuery{
		CompanyID: company.CompanyID, PermissionUserID: viewer.UserID, Z: ProcessMapMaxTileZoom, X: 0, Y: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	wantRestricted := map[[2]int]bool{{-2, 10}: true, {10, -1}: true, {40, 100}: true, {80, 110}: true}
	for _, item := range tile.Placements {
		switch placement := item.(type) {
		case domain.ProcessMapRestrictedPlacement:
			position := [2]int{placement.GridX, placement.GridY}
			if !wantRestricted[position] {
				t.Fatalf("unexpected or duplicate restricted boundary placement: %+v", placement)
			}
			delete(wantRestricted, position)
		case domain.ProcessMapVisiblePlacement:
			if !visibleIDs[placement.ResourceID] || placement.MapParentFolderID != nil {
				t.Fatalf("unexpected, duplicate, or parent-leaking visible placement: %+v", placement)
			}
			delete(visibleIDs, placement.ResourceID)
		default:
			t.Fatalf("unexpected placement type %T", item)
		}
	}
	if len(wantRestricted) != 0 || len(visibleIDs) != 0 {
		t.Fatalf("missing boundary placements: restricted=%v visible=%v", wantRestricted, visibleIDs)
	}
}

func TestPostgresProcessMapTileKeepsOneSnapshotDuringConcurrentChange(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map statement snapshot")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("map-snapshot-admin", "map-snapshot-admin@example.com", "Snapshot Admin")
	if err != nil {
		t.Fatal(err)
	}
	viewer, err := repo.UpsertAuthUser("map-snapshot-viewer", "map-snapshot-viewer@example.com", "Snapshot Viewer")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(viewer.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	source, err := repo.CreateLogicGate(company.CompanyID, "Before snapshot")
	if err != nil {
		t.Fatal(err)
	}
	target, err := repo.CreateLogicGate(company.CompanyID, "Snapshot target")
	if err != nil {
		t.Fatal(err)
	}
	for index, processID := range []string{source.LogicGateID, target.LogicGateID} {
		if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
			company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, processID, nil, 10+index*300, 10, 100, 100,
		)); err != nil {
			t.Fatal(err)
		}
	}
	created, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
		CompanyID:   company.CompanyID,
		Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, source.LogicGateID),
		Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, target.LogicGateID),
		Trace:       &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{{X: 200, Y: 60}}},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	query := ProcessMapTileQuery{CompanyID: company.CompanyID, PermissionUserID: viewer.UserID, Z: 20, X: 0, Y: 0}
	before, err := repo.GetProcessMapTile(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	// Preserve STABLE behavior while pausing permission evaluation after the
	// SELECT has its snapshot. This function exists only in the disposable DB.
	if _, err := db.ExecContext(ctx, `
alter function mangorts_user_can_access_resource(uuid,text,uuid,uuid,text) rename to process_map_test_original_access;
create function mangorts_user_can_access_resource(p_company_id uuid,p_resource_type text,p_resource_id uuid,p_user_id uuid,p_access_level text)
returns boolean language plpgsql stable as $function$
begin
  perform pg_advisory_xact_lock_shared(814921,1);
  return process_map_test_original_access(p_company_id,p_resource_type,p_resource_id,p_user_id,p_access_level);
end;
$function$;`); err != nil {
		t.Fatal(err)
	}
	lockTx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer lockTx.Rollback()
	if _, err := lockTx.ExecContext(ctx, `select pg_advisory_xact_lock(814921,1)`); err != nil {
		t.Fatal(err)
	}
	type tileResult struct {
		tile ProcessMapTileRead
		err  error
	}
	result := make(chan tileResult, 1)
	go func() {
		tile, err := repo.GetProcessMapTile(ctx, query)
		result <- tileResult{tile: tile, err: err}
	}()
	deadline := time.Now().Add(5 * time.Second)
	blocked := false
	for time.Now().Before(deadline) {
		if err := db.QueryRowContext(ctx, `select exists(select 1 from pg_locks where locktype='advisory' and classid=814921 and objid=1 and not granted)`).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !blocked {
		t.Fatal("tile never reached the paused permission function")
	}
	writeTx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer writeTx.Rollback()
	if _, err := writeTx.ExecContext(ctx, `update logic_gates set header='After snapshot' where company_id=$1::uuid and logic_gate_id=$2::uuid`, company.CompanyID, source.LogicGateID); err != nil {
		t.Fatal(err)
	}
	if _, err := writeTx.ExecContext(ctx, `update process_map_placements set grid_x=20,revision=revision+1 where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, company.CompanyID, source.LogicGateID); err != nil {
		t.Fatal(err)
	}
	if _, err := writeTx.ExecContext(ctx, `update process_map_traces set route_points='[{"x":220,"y":90}]'::jsonb,revision=revision+1 where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid`, company.CompanyID, created.Relationship.ResourceOperationalRelationshipID); err != nil {
		t.Fatal(err)
	}
	if _, err := writeTx.ExecContext(ctx, `update company_memberships set role='company_manager' where company_id=$1::uuid and user_id=$2::uuid`, company.CompanyID, viewer.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := writeTx.ExecContext(ctx, `update workspace_read_versions set version=version+1 where company_id=$1::uuid and scope in ('process-map','policy-group-membership') and resource_key=''`, company.CompanyID); err != nil {
		t.Fatal(err)
	}
	if err := writeTx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := lockTx.Rollback(); err != nil {
		t.Fatal(err)
	}
	select {
	case observed := <-result:
		if observed.err != nil || !reflect.DeepEqual(observed.tile, before) {
			t.Fatalf("concurrent change mixed tile snapshots: before=%+v observed=%+v err=%v", before, observed.tile, observed.err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	after, err := repo.GetProcessMapTile(ctx, query)
	if err != nil || after.Metadata.ActorRole != domain.RoleCompanyManager ||
		after.Metadata.ProcessMapVersion <= before.Metadata.ProcessMapVersion ||
		after.Metadata.PermissionGroupVersion <= before.Metadata.PermissionGroupVersion ||
		reflect.DeepEqual(after.Placements, before.Placements) || reflect.DeepEqual(after.Traces, before.Traces) {
		t.Fatalf("fresh tile did not observe committed metadata and payload changes: before=%+v after=%+v err=%v", before, after, err)
	}
	t.Log("concurrent role, versions, placement, name, and trace change: in-flight tile retained one snapshot; next tile saw the committed change")
}

func TestPostgresProcessMapTileUsesSpatialGiSTIndex(t *testing.T) {
	db, _ := openPostgresProcessMapIntegration(t)
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`set local enable_seqscan=off`); err != nil {
		t.Fatal(err)
	}
	rows, err := tx.Query(`
explain (costs off)
select resource_id
from process_map_placements
where box(
  point(grid_x::double precision,grid_y::double precision),
  point((grid_x::bigint+grid_width)::double precision,(grid_y::bigint+grid_height)::double precision)
) && box(point(0::double precision,0::double precision),point(256::double precision,256::double precision))`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	planLines := []string{}
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		planLines = append(planLines, line)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	plan := strings.Join(planLines, "\n")
	if !strings.Contains(plan, "idx_process_map_placements_spatial") {
		t.Fatalf("Process Map tile spatial predicate did not use GiST index:\n%s", plan)
	}
}

func TestPostgresProcessMapTileCancellationReachesPostgreSQL(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map cancellation test")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-cancellation-admin", "process-map-cancellation@example.com", "Cancellation Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}

	lockTx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer lockTx.Rollback()
	if _, err := lockTx.Exec(`lock table process_map_placements in access exclusive mode`); err != nil {
		t.Fatal(err)
	}

	queryCtx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := repo.GetProcessMapTile(queryCtx, ProcessMapTileQuery{
			CompanyID: company.CompanyID, PermissionUserID: admin.UserID, Z: 0, X: 0, Y: 0,
		})
		result <- err
	}()

	deadline := time.Now().Add(5 * time.Second)
	blockedInPostgres := false
	for time.Now().Before(deadline) {
		if err := db.QueryRow(`
select exists(
  select 1 from pg_stat_activity
  where datname=current_database()
    and application_name='mangorts_process_map_test'
    and pid<>pg_backend_pid()
    and state='active'
    and wait_event_type='Lock'
)`).Scan(&blockedInPostgres); err != nil {
			t.Fatal(err)
		}
		if blockedInPostgres {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !blockedInPostgres {
		cancel()
		t.Fatal("Process Map tile query never reached its blocked PostgreSQL spatial read")
	}

	cancel()
	select {
	case queryErr := <-result:
		if !errors.Is(queryErr, context.Canceled) {
			t.Fatalf("canceled Process Map tile error = %v, want context.Canceled", queryErr)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("canceled Process Map tile query did not return")
	}

	deadline = time.Now().Add(3 * time.Second)
	stillActive := true
	for time.Now().Before(deadline) {
		if err := db.QueryRow(`
select exists(
  select 1 from pg_stat_activity
  where datname=current_database()
    and application_name='mangorts_process_map_test'
    and state='active'
    and wait_event_type='Lock'
)`).Scan(&stillActive); err != nil {
			t.Fatal(err)
		}
		if !stillActive {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if stillActive {
		t.Fatal("canceled Process Map tile query remained active in PostgreSQL")
	}
}
