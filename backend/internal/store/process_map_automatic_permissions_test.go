package store

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryAutomaticProcessMapFitRequiresDescendantEditAndRollsBackExplorer(t *testing.T) {
	for _, command := range []string{"create folder", "reparent folder"} {
		t.Run(command, func(t *testing.T) {
			ctx := context.Background()
			repo, companyID, admin, member, _ := newV2PolicyTestRepo(t)
			parent, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Parent")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID,
				domain.ProcessMapResourceTypeFolder, parent.FolderID, nil, 0, 0, 1000, 500)); err != nil {
				t.Fatal(err)
			}
			occupied, err := repo.CreateCompanyExplorerFolder(companyID, parent.FolderID, "logic_gate", "Occupied")
			if err != nil {
				t.Fatal(err)
			}
			hidden, err := repo.CreateLogicGate(companyID, "Restricted descendant")
			if err != nil {
				t.Fatal(err)
			}
			if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, occupied.FolderID, EntityTypeLogicGate, hidden.LogicGateID, 0); err != nil {
				t.Fatal(err)
			}
			if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID,
				domain.ProcessMapResourceTypeFolder, occupied.FolderID, &parent.FolderID, 15, 62, 970, 400)); err != nil {
				t.Fatal(err)
			}
			noAccess := ResourceDefaultAccessNoAccess
			putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
				CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: hidden.LogicGateID,
				PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess,
				DescendantAction: PolicyDescendantActionInheritedOnly,
			})
			if !repo.processMapResourceAllowedLocked(companyID, member.UserID, domain.ProcessMapResourceTypeFolder, parent.FolderID) ||
				!repo.processMapResourceAllowedLocked(companyID, member.UserID, domain.ProcessMapResourceTypeFolder, occupied.FolderID) ||
				repo.processMapResourceAllowedLocked(companyID, member.UserID, domain.ProcessMapResourceTypeProcess, hidden.LogicGateID) {
				t.Fatal("fixture must allow the parent and direct sibling but deny its descendant")
			}
			var moving domain.CompanyExplorerFolder
			if command == "reparent folder" {
				moving, err = repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Moving")
				if err != nil {
					t.Fatal(err)
				}
			}
			run := func(userID string) error {
				if command == "reparent folder" {
					_, err := repo.MoveCompanyExplorerFolder(companyID, moving.FolderID, &parent.FolderID, 0, userID, userID)
					return err
				}
				_, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
					CompanyID: companyID, ParentEntityID: parent.FolderID, Name: "New folder",
					ActorUserID: userID, PermissionUserID: userID,
				})
				return err
			}
			before := repo.snapshotProcessMapMutationLocked()
			if err := run(member.UserID); !errors.Is(err, ErrNotFound) {
				t.Fatalf("fitting a denied descendant returned %v, want ErrNotFound", err)
			}
			if !reflect.DeepEqual(before, repo.snapshotProcessMapMutationLocked()) {
				t.Fatal("denied automatic fit changed Explorer, geometry, policies, traces, events, or read versions")
			}
			if err := run(admin.UserID); err != nil {
				t.Fatalf("authorized fit failed: %v", err)
			}
			hiddenKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, hidden.LogicGateID)
			if processMapAutomaticGeometryEqual(before.placements[hiddenKey], repo.processMapPlacements[hiddenKey]) {
				t.Fatal("fixture did not require changing the denied descendant's geometry")
			}
		})
	}
}

func TestMemoryAutomaticProcessMapInsertionAllowsUnchangedDeniedSibling(t *testing.T) {
	repo, companyID, _, member, _ := newV2PolicyTestRepo(t)
	parent, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Parent")
	if err != nil {
		t.Fatal(err)
	}
	hidden, err := repo.CreateCompanyExplorerFolder(companyID, parent.FolderID, "logic_gate", "Unchanged sibling")
	if err != nil {
		t.Fatal(err)
	}
	noAccess := ResourceDefaultAccessNoAccess
	putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeCompanyExplorerFolder, ResourceID: hidden.FolderID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess,
		DescendantAction: PolicyDescendantActionInheritedOnly,
	})
	placementKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, hidden.FolderID)
	before := repo.processMapPlacements[placementKey]
	if _, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID: companyID, ParentEntityID: parent.FolderID, Name: "Fits without changing sibling",
		ActorUserID: member.UserID, PermissionUserID: member.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, repo.processMapPlacements[placementKey]) {
		t.Fatal("insertion that fits changed the denied sibling")
	}
}

func TestMemoryAutomaticProcessMapReparentAuthorizesBeforeInheritanceChanges(t *testing.T) {
	for _, command := range []string{"legacy folder", "v2 folder"} {
		t.Run(command, func(t *testing.T) {
			repo, companyID, _, member, _ := newV2PolicyTestRepo(t)
			source, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Source")
			if err != nil {
				t.Fatal(err)
			}
			target, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Target")
			if err != nil {
				t.Fatal(err)
			}
			moving, err := repo.CreateCompanyExplorerFolder(companyID, source.FolderID, "logic_gate", "Moving")
			if err != nil {
				t.Fatal(err)
			}
			descendant, err := repo.CreateCompanyExplorerFolder(companyID, moving.FolderID, "logic_gate", "Descendant")
			if err != nil {
				t.Fatal(err)
			}
			noAccess, edit := ResourceDefaultAccessNoAccess, ResourceDefaultAccessEdit
			putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
				CompanyID: companyID, ResourceType: EntityTypeCompanyExplorerFolder, ResourceID: descendant.FolderID,
				PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess,
				DescendantAction: PolicyDescendantActionInheritedOnly,
			})
			putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
				CompanyID: companyID, ResourceType: EntityTypeCompanyExplorerFolder, ResourceID: source.FolderID,
				PermissionMode: PolicyModeCustomized, DefaultAccess: &edit,
				DescendantAction: PolicyDescendantActionIncludingCustomized,
			})
			if !repo.processMapResourceAllowedLocked(companyID, member.UserID, domain.ProcessMapResourceTypeFolder, descendant.FolderID) {
				t.Fatal("source ancestor must currently grant descendant edit")
			}
			if command == "legacy folder" {
				_, err = repo.MoveCompanyExplorerFolder(companyID, moving.FolderID, &target.FolderID, 0, member.UserID, member.UserID)
			} else {
				_, err = repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
					CompanyID: companyID, EdgeID: companyExplorerV2EdgeID(companyID, source.FolderID, moving.FolderID),
					ParentEntityID: target.FolderID, ActorUserID: member.UserID, PermissionUserID: member.UserID,
				})
			}
			if err != nil {
				t.Fatalf("move must use current permissions before changing inheritance: %v", err)
			}
			if repo.processMapResourceAllowedLocked(companyID, member.UserID, domain.ProcessMapResourceTypeFolder, descendant.FolderID) {
				t.Fatal("moving away must restore the descendant's customized deny policy")
			}
		})
	}
}

func TestMemoryAutomaticProcessMapGateCreateRequiresSiblingEditAndRollsBack(t *testing.T) {
	repo, companyID, admin, member, _ := newV2PolicyTestRepo(t)
	hidden, err := repo.CreateLogicGate(companyID, "Restricted default-folder sibling")
	if err != nil {
		t.Fatal(err)
	}
	parentID := repo.folderItems[folderItemKey(companyID, EntityTypeLogicGate, hidden.LogicGateID)].FolderID
	parent := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, parentID)]
	ctx := context.Background()
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID,
		domain.ProcessMapResourceTypeFolder, parentID, parent.MapParentFolderID, parent.GridX, parent.GridY, 1000, 500)); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID,
		domain.ProcessMapResourceTypeProcess, hidden.LogicGateID, &parentID, parent.GridX+15, parent.GridY+62, 970, 400)); err != nil {
		t.Fatal(err)
	}
	noAccess := ResourceDefaultAccessNoAccess
	putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: hidden.LogicGateID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess,
		DescendantAction: PolicyDescendantActionInheritedOnly,
	})
	before := repo.snapshotProcessMapMutationLocked()
	if _, _, err := repo.CreateLogicGateWithWorkspaceEvent(companyID, "Denied fit", member.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unauthorized gate creation fit returned %v, want ErrNotFound", err)
	}
	if !reflect.DeepEqual(before, repo.snapshotProcessMapMutationLocked()) {
		t.Fatal("denied gate creation changed geometry, resources, policies, or events")
	}
	if _, _, err := repo.CreateLogicGateWithWorkspaceEvent(companyID, "Authorized fit", admin.UserID); err != nil {
		t.Fatalf("authorized gate creation failed: %v", err)
	}
}

func TestPostgresProcessMapAutomaticFitRequiresSiblingEditAndRollsBackExplorer(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Automatic fit permissions")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("fit-admin", "fit-admin@example.com", "Fit Admin")
	if err != nil {
		t.Fatal(err)
	}
	member, err := repo.UpsertAuthUser("fit-member", "fit-member@example.com", "Fit Member")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		user domain.User
		role string
	}{{admin, domain.RoleCompanyAdmin}, {member, domain.RoleCompanyUser}} {
		if _, err := repo.AddCompanyMembership(entry.user.CognitoSubject, company.CompanyID, entry.role); err != nil {
			t.Fatal(err)
		}
	}
	parent, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Parent")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(company.CompanyID, admin.UserID,
		domain.ProcessMapResourceTypeFolder, parent.FolderID, nil, 0, 0, 1000, 500)); err != nil {
		t.Fatal(err)
	}
	hidden, err := repo.CreateCompanyExplorerFolder(company.CompanyID, parent.FolderID, "logic_gate", "Restricted sibling")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(company.CompanyID, admin.UserID,
		domain.ProcessMapResourceTypeFolder, hidden.FolderID, &parent.FolderID, 15, 62, 970, 400)); err != nil {
		t.Fatal(err)
	}
	noAccess := ResourceDefaultAccessNoAccess
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: company.CompanyID, ResourceType: EntityTypeCompanyExplorerFolder, ResourceID: hidden.FolderID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess,
		DescendantAction: PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatal(err)
	}
	readState := func() string {
		t.Helper()
		var result string
		if err := db.QueryRow(`select jsonb_build_object(
  'folders',(select jsonb_agg(to_jsonb(folder) order by folder_id) from company_explorer_folders folder where company_id=$1::uuid),
  'gates',(select jsonb_agg(to_jsonb(gate) order by logic_gate_id) from logic_gates gate where company_id=$1::uuid),
  'placements',(select jsonb_agg(to_jsonb(placement) order by resource_type,resource_id) from process_map_placements placement where company_id=$1::uuid),
  'versions',(select jsonb_agg(to_jsonb(version) order by scope,resource_key) from workspace_read_versions version where company_id=$1::uuid)
)::text`, company.CompanyID).Scan(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	before := readState()
	_, err = repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID: company.CompanyID, ParentEntityID: parent.FolderID, Name: "Denied fit",
		ActorUserID: member.UserID, PermissionUserID: member.UserID,
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("unauthorized fit returned %v, want ErrNotFound", err)
	}
	if after := readState(); after != before {
		t.Fatalf("denied fit changed committed state:\nbefore=%s\nafter=%s", before, after)
	}
	if _, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID: company.CompanyID, ParentEntityID: parent.FolderID, Name: "Authorized fit",
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}); err != nil {
		t.Fatalf("authorized fit failed: %v", err)
	}
	hiddenGate, err := repo.CreateLogicGate(company.CompanyID, "Restricted default-folder sibling")
	if err != nil {
		t.Fatal(err)
	}
	var defaultParentID, defaultAncestorID string
	var defaultParentX, defaultParentY int
	if err := db.QueryRow(`select item.parent_folder_id::text,coalesce(placement.map_parent_folder_id::text,''),placement.grid_x,placement.grid_y
from company_explorer_items item
join process_map_placements placement on placement.company_id=item.company_id
  and placement.resource_type='company_explorer_folder' and placement.resource_id=item.parent_folder_id
where item.company_id=$1::uuid and item.target_type='logic_gate' and item.target_id=$2::uuid`, company.CompanyID, hiddenGate.LogicGateID).Scan(
		&defaultParentID, &defaultAncestorID, &defaultParentX, &defaultParentY); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(company.CompanyID, admin.UserID,
		domain.ProcessMapResourceTypeFolder, defaultParentID, processMapParentPointer(defaultAncestorID), defaultParentX, defaultParentY, 1000, 500)); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(company.CompanyID, admin.UserID,
		domain.ProcessMapResourceTypeProcess, hiddenGate.LogicGateID, &defaultParentID, defaultParentX+15, defaultParentY+62, 970, 400)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: hiddenGate.LogicGateID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess,
		DescendantAction: PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatal(err)
	}
	before = readState()
	if _, _, err := repo.CreateLogicGateWithWorkspaceEvent(company.CompanyID, "Denied gate fit", member.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unauthorized gate creation fit returned %v, want ErrNotFound", err)
	}
	if after := readState(); after != before {
		t.Fatalf("denied gate creation changed committed state:\nbefore=%s\nafter=%s", before, after)
	}
	if _, _, err := repo.CreateLogicGateWithWorkspaceEvent(company.CompanyID, "Authorized gate fit", admin.UserID); err != nil {
		t.Fatalf("authorized gate creation failed: %v", err)
	}
	source, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Source with inherited edit")
	if err != nil {
		t.Fatal(err)
	}
	target, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Move target")
	if err != nil {
		t.Fatal(err)
	}
	moving, err := repo.CreateCompanyExplorerFolder(company.CompanyID, source.FolderID, "logic_gate", "Moving folder")
	if err != nil {
		t.Fatal(err)
	}
	descendant, err := repo.CreateCompanyExplorerFolder(company.CompanyID, moving.FolderID, "logic_gate", "Descendant")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: company.CompanyID, ResourceType: EntityTypeCompanyExplorerFolder, ResourceID: descendant.FolderID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess,
		DescendantAction: PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatal(err)
	}
	edit := ResourceDefaultAccessEdit
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: company.CompanyID, ResourceType: EntityTypeCompanyExplorerFolder, ResourceID: source.FolderID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &edit,
		DescendantAction: PolicyDescendantActionIncludingCustomized,
	}); err != nil {
		t.Fatal(err)
	}
	if allowed, err := repo.UserHasEffectiveAccess(company.CompanyID, member.UserID, EntityTypeCompanyExplorerFolder, descendant.FolderID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("source ancestor must currently grant descendant edit: allowed=%v err=%v", allowed, err)
	}
	if _, err := repo.MoveCompanyExplorerFolder(company.CompanyID, moving.FolderID, &target.FolderID, 0, member.UserID, member.UserID); err != nil {
		t.Fatalf("move must use current permissions before changing inheritance: %v", err)
	}
	if allowed, err := repo.UserHasEffectiveAccess(company.CompanyID, member.UserID, EntityTypeCompanyExplorerFolder, descendant.FolderID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("move must restore descendant's customized deny policy: allowed=%v err=%v", allowed, err)
	}
}
