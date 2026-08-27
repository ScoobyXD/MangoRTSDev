package store

import (
	"os"
	"strings"
	"testing"
)

func processMapFunctionBodyForContractTest(t *testing.T, source, signature, nextSignature string) string {
	t.Helper()
	source = strings.ReplaceAll(source, "\r\n", "\n")
	start := strings.Index(source, signature)
	if start < 0 {
		t.Fatalf("missing %q", signature)
	}
	end := len(source)
	if nextSignature != "" {
		relativeEnd := strings.Index(source[start+len(signature):], nextSignature)
		if relativeEnd < 0 {
			t.Fatalf("missing %q after %q", nextSignature, signature)
		}
		end = start + len(signature) + relativeEnd
	}
	return source[start:end]
}

func TestPostgresProcessMapConcurrencyAndPermissionContract(t *testing.T) {
	raw, err := os.ReadFile("postgres_process_map.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, forbidden := range []string{"GetProcessMapLayer", "ProcessMapLayerQuery", "context.Background()", "context.TODO()", "folder.folder_kind", "folder_kind<>'communications'"} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("Postgres Process Map contains obsolete or uncancellable contract %q", forbidden)
		}
	}
	for _, required := range []string{
		"GetProcessMapScene(ctx context.Context",
		"GetProcessMapTile(ctx context.Context",
		"PutProcessMapPlacement(ctx context.Context",
		"DeleteProcessMapPlacement(ctx context.Context",
		"CreateResourceOperationalRelationship(ctx context.Context",
		"PutProcessMapTrace(ctx context.Context",
		"DeleteResourceOperationalRelationship(ctx context.Context",
		"QueryContext(ctx",
		"ExecContext(ctx",
		"pg_advisory_xact_lock(hashtextextended('process-map-parent:' || $1,0))",
		"lockPostgresPolicyGroupMembershipVersionTx(ctx, tx, companyID, false)",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("Postgres Process Map missing contract %q", required)
		}
	}

	for _, signature := range []string{"GetProcessMapScene", "GetProcessMapTile", "PutProcessMapPlacement", "DeleteProcessMapPlacement", "CreateResourceOperationalRelationship", "PutProcessMapTrace", "DeleteResourceOperationalRelationship"} {
		if !strings.Contains(source, "func (r *PostgresRepo) "+signature+"(ctx context.Context") {
			t.Fatalf("%s does not accept authoritative request cancellation", signature)
		}
	}
}

func TestProcessMapPolicyParentAndCompanyMembershipSQLContract(t *testing.T) {
	for _, path := range []string{"../../db/schema.sql", "../../db/migrations/20260824_process_map.sql"} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		source := string(raw)
		if path == "../../db/schema.sql" {
			source = normalizeCanonicalSchemaContract(source)
		}
		for _, required := range []string{
			"new.parent_folder_id is null",
			"before update of parent_folder_id on company_explorer_items",
			"company_actor as",
			"membership.role='dev_admin' or membership.company_id=p_company_id",
			"when not (select allowed from company_actor) then false",
		} {
			if !strings.Contains(source, required) {
				t.Fatalf("%s is missing Process Map policy/access fix %q", path, required)
			}
		}
	}

}

func TestProcessMapRepositoryCoordinateAndBoundedReadContract(t *testing.T) {
	if ProcessMapMaxRoutePoints != 256 || ProcessMapMinCoordinate != -1_000_000_000 || ProcessMapMaxCoordinate != 1_000_000_000 || ProcessMapMaxDimension != 1_000_000 {
		t.Fatalf("unexpected V3 geometry bounds: route=%d coordinate=%d..%d dimension=%d", ProcessMapMaxRoutePoints, ProcessMapMinCoordinate, ProcessMapMaxCoordinate, ProcessMapMaxDimension)
	}
	if _, ok := processMapTileBounds(ProcessMapMaxTileZoom+1, 0, 0); ok {
		t.Fatal("tile bounds accepted zoom above the scene contract")
	}
	if bounds, ok := processMapTileBounds(ProcessMapMaxTileZoom, 3, -2); !ok || bounds.MaxX-bounds.MinX != ProcessMapTileSize || bounds.MaxY-bounds.MinY != ProcessMapTileSize {
		t.Fatalf("maximum-zoom tile bounds = %+v/%t", bounds, ok)
	}
	maxInt := int(^uint(0) >> 1)
	minInt := -maxInt - 1
	for _, coordinate := range []int{minInt, maxInt} {
		if _, ok := processMapTileBounds(ProcessMapMinTileZoom, coordinate, 0); ok {
			t.Fatalf("minimum-zoom tile bounds accepted overflowing x index %d", coordinate)
		}
		if _, ok := processMapTileBounds(ProcessMapMinTileZoom, 0, coordinate); ok {
			t.Fatalf("minimum-zoom tile bounds accepted overflowing y index %d", coordinate)
		}
	}
	for _, coordinate := range []int{-2, 0} {
		if _, ok := processMapTileBounds(ProcessMapMinTileZoom, coordinate, coordinate); !ok {
			t.Fatalf("minimum-zoom tile bounds rejected valid edge index %d", coordinate)
		}
	}
	postgresRaw, err := os.ReadFile("postgres_process_map.go")
	if err != nil {
		t.Fatal(err)
	}
	postgres := string(postgresRaw)
	if strings.Contains(postgres, "GetProcessMapLayer") || strings.Contains(postgres, "map_parent_folder_id is not distinct from nullif($2,'')") {
		t.Fatal("Postgres still contains the obsolete exact-layer reader")
	}
	boundedRelationships := processMapFunctionBodyForContractTest(t, postgres,
		"func (r *PostgresRepo) ListResourceOperationalRelationshipsForResource", "func normalizePostgresProcessMapMutation")
	if !strings.Contains(boundedRelationships, "relationship.source_resource_id=$3::uuid") ||
		!strings.Contains(boundedRelationships, "relationship.target_resource_id=$3::uuid") {
		t.Fatal("relationship read is not bounded to one exact resource")
	}
}

func TestPostgresMappedSourceMutationsAppendBeforeCommit(t *testing.T) {
	logicGateRaw, err := os.ReadFile("postgres_logic_gates.go")
	if err != nil {
		t.Fatal(err)
	}
	deleteGate := processMapFunctionBodyForContractTest(t, string(logicGateRaw),
		"func (r *PostgresRepo) DeleteLogicGate", "func (r *PostgresRepo) AddLogicGateInformation")
	for _, required := range []string{"postgresDeleteLogicGateWithDependentProjectionsTx", "logic_gate_deleted", "appendDomainEventTx", "tx.Commit"} {
		if !strings.Contains(deleteGate, required) {
			t.Fatalf("direct Logic Gate delete missing atomic contract %q", required)
		}
	}
	appendIndex := strings.Index(deleteGate, "appendDomainEventTx")
	deleteIndex := strings.Index(deleteGate, "postgresDeleteLogicGateWithDependentProjectionsTx")
	commitIndex := strings.Index(deleteGate, "tx.Commit")
	if appendIndex < 0 || deleteIndex < 0 || commitIndex < 0 || appendIndex > deleteIndex || deleteIndex > commitIndex {
		t.Fatal("direct Logic Gate delete must snapshot its audience before deleting, then commit both atomically")
	}

	explorerRaw, err := os.ReadFile("postgres_company_explorer_v2.go")
	if err != nil {
		t.Fatal(err)
	}
	explorer := string(explorerRaw)
	for _, signature := range []string{
		"func (r *PostgresRepo) UpsertCompanyExplorerV2Edge",
		"func (r *PostgresRepo) MoveCompanyExplorerV2Edge",
		"func (r *PostgresRepo) DeleteCompanyExplorerV2Edges",
	} {
		body := processMapFunctionBodyForContractTest(t, explorer, signature, "func (r *PostgresRepo)")
		if !strings.Contains(body, "appendDomainEvent") || !strings.Contains(body, "tx.Commit") || strings.Index(body, "appendDomainEvent") > strings.Index(body, "tx.Commit") {
			t.Fatalf("%s does not append its Explorer invalidation before commit", signature)
		}
	}

	for _, path := range []string{"../../db/schema.sql", "../../db/migrations/20260824_process_map.sql"} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		source := string(raw)
		if path == "../../db/schema.sql" {
			source = normalizeCanonicalSchemaContract(source)
		}
		start := strings.Index(source, "'process_map_placement_saved'")
		if start < 0 {
			t.Fatalf("%s is missing Process Map read-version mapping", path)
		}
		endRelative := strings.Index(source[start:], "]::text[])")
		if endRelative < 0 {
			t.Fatalf("%s has malformed Process Map read-version mapping", path)
		}
		mapping := source[start : start+endRelative]
		for _, eventType := range []string{"'company_explorer_item_placed'", "'company_explorer_item_removed'"} {
			if !strings.Contains(mapping, eventType) {
				t.Fatalf("%s Process Map read-version mapping is missing %s", path, eventType)
			}
		}
	}
}

func TestPostgresCompanyExplorerMutationAuthorizationContract(t *testing.T) {
	v2Raw, err := os.ReadFile("postgres_company_explorer_v2.go")
	if err != nil {
		t.Fatal(err)
	}
	v2 := string(v2Raw)
	if strings.Contains(v2, "for key share`, companyID, permissionUserID") {
		t.Fatal("Company Explorer membership validation still uses a role-update-permitting KEY SHARE lock")
	}
	for _, required := range []string{
		"pg_advisory_xact_lock(hashtextextended('company-explorer-mutation:' || $1,0))",
		"from company_memberships",
		"lockPostgresPolicyGroupMembershipVersionTx(ctx, tx, companyID, changesPermissionParent)",
		"mangorts_user_can_access_resource",
		"query += ` for update`",
	} {
		if !strings.Contains(v2, required) {
			t.Fatalf("Postgres Company Explorer authorization is missing %q", required)
		}
	}

	upsert := processMapFunctionBodyForContractTest(t, v2,
		"func (r *PostgresRepo) UpsertCompanyExplorerV2Edge", "func (r *PostgresRepo) MoveCompanyExplorerV2Edge")
	move := processMapFunctionBodyForContractTest(t, v2,
		"func (r *PostgresRepo) MoveCompanyExplorerV2Edge", "func (r *PostgresRepo) DeleteCompanyExplorerV2Edge")
	remove := processMapFunctionBodyForContractTest(t, v2,
		"func (r *PostgresRepo) DeleteCompanyExplorerV2Edges", "func (r *PostgresRepo) GetCompanyExplorerV2EntityWithParent")
	for name, body := range map[string]string{"upsert": upsert, "move": move, "remove": remove} {
		if !strings.Contains(body, "lockPostgresCompanyExplorerMutationTx") ||
			!strings.Contains(body, "lockPostgresCompanyExplorerResourceEditTx") {
			t.Fatalf("Postgres Company Explorer %s does not recheck membership and exact source Edit in its transaction", name)
		}
	}
	if !strings.Contains(upsert, "companyExplorerFinalContainerTarget(ctx, tx") ||
		!strings.Contains(move, "companyExplorerFinalContainerTarget(ctx, tx") {
		t.Fatal("Postgres Company Explorer reparent does not lock and authorize the exact destination in its transaction")
	}
	if !strings.Contains(move, "and item_id=$2::uuid\nfor update") ||
		!strings.Contains(remove, "order by item_id\nfor update") {
		t.Fatal("Postgres Company Explorer move/detach does not lock the exact stored edge")
	}

	folderRaw, err := os.ReadFile("postgres_company_explorer.go")
	if err != nil {
		t.Fatal(err)
	}
	folderSource := string(folderRaw)
	folderMove := processMapFunctionBodyForContractTest(t, folderSource,
		"func (r *PostgresRepo) MoveCompanyExplorerFolder", "func (r *PostgresRepo) RenameCompanyExplorerFolder")
	folderRename := processMapFunctionBodyForContractTest(t, folderSource,
		"func (r *PostgresRepo) RenameCompanyExplorerFolder", "func postgresCompanyHasConnectedEmailAccount")
	for name, body := range map[string]string{"move": folderMove, "rename": folderRename} {
		if !strings.Contains(body, "lockPostgresCompanyExplorerMutationTx") ||
			!strings.Contains(body, "lockPostgresCompanyExplorerResourceEditTx") ||
			!strings.Contains(body, "tx.Commit") {
			t.Fatalf("Postgres Folder %s does not authorize and commit under one transaction", name)
		}
	}
	if strings.Count(folderMove, "lockPostgresCompanyExplorerResourceEditTx") < 2 {
		t.Fatal("Postgres Folder reparent does not separately authorize source and destination")
	}
	helpers := processMapFunctionBodyForContractTest(t, v2,
		"func lockPostgresCompanyExplorerMutationTx", "func lockPostgresCompanyExplorerResourceEditTx")
	fence := strings.Index(helpers, "lockPostgresPolicyGroupMembershipVersionTx")
	membership := strings.Index(helpers, "from company_memberships")
	if fence < 0 || membership < 0 || fence >= membership {
		t.Fatal("Company Explorer does not acquire its policy/group/membership fence before membership validation")
	}
}

func TestPostgresPermissionValidationFenceContract(t *testing.T) {
	policyRaw, err := os.ReadFile("postgres_policy_v2.go")
	if err != nil {
		t.Fatal(err)
	}
	policy := string(policyRaw)
	for _, required := range []string{
		"scope='policy-group-membership' and resource_key=''",
		"lockClause := \" for share\"",
		"lockClause = \" for update\"",
		"set version=workspace_read_versions.version+1",
	} {
		if !strings.Contains(policy, required) {
			t.Fatalf("permission validation fence is missing %q", required)
		}
	}
	putPolicy := processMapFunctionBodyForContractTest(t, policy,
		"func (r *PostgresRepo) PutResourcePermissionPolicy", "func normalizeV2EntityPermissionInputs")
	policyFence := strings.Index(putPolicy, "lockPostgresPolicyGroupMembershipVersionTx(ctx, tx, companyID, true)")
	settingsLock := strings.Index(putPolicy, "select 1 from resource_permission_settings")
	if policyFence < 0 || settingsLock < 0 || policyFence >= settingsLock {
		t.Fatal("permission policy write does not take the exclusive validation fence before settings/rule locks")
	}

	processMapRaw, err := os.ReadFile("postgres_process_map.go")
	if err != nil {
		t.Fatal(err)
	}
	processMap := string(processMapRaw)
	processMapFunctions := []struct{ signature, next string }{
		{"func (r *PostgresRepo) PutProcessMapPlacement", "func (r *PostgresRepo) DeleteProcessMapPlacement"},
		{"func (r *PostgresRepo) DeleteProcessMapPlacement", "func (r *PostgresRepo) CreateResourceOperationalRelationship"},
		{"func (r *PostgresRepo) CreateResourceOperationalRelationship", "func (r *PostgresRepo) PutProcessMapTrace"},
		{"func (r *PostgresRepo) PutProcessMapTrace", "func (r *PostgresRepo) DeleteResourceOperationalRelationship"},
		{"func (r *PostgresRepo) DeleteResourceOperationalRelationship", "func postgresProcessMapFolderCleanupOrderTx"},
	}
	for _, function := range processMapFunctions {
		body := processMapFunctionBodyForContractTest(t, processMap, function.signature, function.next)
		fence := strings.Index(body, "lockPostgresPolicyGroupMembershipVersionTx(ctx, tx, companyID, false)")
		explorerFence := strings.Index(body, "lockPostgresCompanyExplorerMutationTx(ctx, tx, companyID")
		if fence < 0 || (explorerFence >= 0 && explorerFence < fence) {
			fence = explorerFence
		}
		permission := strings.Index(body, "postgresRequireProcessMap")
		if fence < 0 || permission < 0 || fence >= permission {
			t.Fatalf("%s does not hold the shared validation fence before capability evaluation", function.signature)
		}
	}

	authRaw, err := os.ReadFile("postgres_auth.go")
	if err != nil {
		t.Fatal(err)
	}
	auth := string(authRaw)
	companySetHelper := processMapFunctionBodyForContractTest(t, auth,
		"func postgresMembershipAffectedCompanyIDsTx", "func (r *PostgresRepo) UpsertAuthUser")
	companySetLock := strings.Index(companySetHelper, "lockPostgresCompanyMembershipCompanySetTx")
	companyList := strings.Index(companySetHelper, "select company_id::text from companies order by company_id")
	if companySetLock < 0 || companyList < 0 || companySetLock >= companyList || !strings.Contains(auth, "company-membership-company-set") {
		t.Fatal("global membership fanout does not lock the company set before enumerating companies")
	}
	createCompany := processMapFunctionBodyForContractTest(t, auth,
		"func (r *PostgresRepo) CreateCompany", "func (r *PostgresRepo) ListCompanies")
	companySetLock = strings.Index(createCompany, "lockPostgresCompanyMembershipCompanySetTx")
	companyInsert := strings.Index(createCompany, "insert into companies")
	if companySetLock < 0 || companyInsert < 0 || companySetLock >= companyInsert {
		t.Fatal("company creation does not share the global membership company-set lock before insert")
	}
	addMembership := processMapFunctionBodyForContractTest(t, auth,
		"func (r *PostgresRepo) AddCompanyMembership", "func (r *PostgresRepo) CreateCompany")
	advance := strings.Index(addMembership, "advancePostgresPolicyGroupMembershipVersionsTx")
	membershipWrite := strings.Index(addMembership, "insert into company_memberships")
	if advance < 0 || membershipWrite < 0 || advance >= membershipWrite {
		t.Fatal("membership role write does not advance sorted validation fences before its membership row write")
	}
	deleteMembership := processMapFunctionBodyForContractTest(t, auth,
		"func (r *PostgresRepo) DeleteCompanyUser", "func (r *PostgresRepo) CompleteExternalIdentityDeletion")
	advance = strings.Index(deleteMembership, "advancePostgresPolicyGroupMembershipVersionsTx")
	lockedMembership := strings.Index(deleteMembership, "select 1\nfrom company_memberships")
	if advance < 0 || lockedMembership < 0 || advance >= lockedMembership {
		t.Fatal("membership deletion does not advance sorted validation fences before locking its membership row")
	}
	acceptInvitation := processMapFunctionBodyForContractTest(t, auth,
		"func (r *PostgresRepo) AcceptInvitation", "")
	globalFanout := strings.Index(acceptInvitation, "postgresMembershipAffectedCompanyIDsTx")
	advance = strings.Index(acceptInvitation, "advancePostgresPolicyGroupMembershipVersionsTx")
	membershipWrite = strings.Index(acceptInvitation, "insert into company_memberships")
	if globalFanout < 0 || advance < 0 || membershipWrite < 0 || globalFanout >= advance || advance >= membershipWrite || !strings.Contains(acceptInvitation, "hadGlobalAccess != hasGlobalAccess") {
		t.Fatal("invitation acceptance does not fan out a global-role downgrade before its membership upsert")
	}
}
