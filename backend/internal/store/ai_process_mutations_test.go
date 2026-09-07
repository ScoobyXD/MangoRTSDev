package store

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestMemoryAIProcessMutations(t *testing.T) {
	testAIProcessMutations(t, NewMemoryRepo())
}

func TestPostgresAIProcessMutations(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	testAIProcessMutations(t, repo)
}

func testAIProcessMutations(t *testing.T, repo Repository) {
	t.Helper()
	ctx := context.Background()
	run := newAIActionReceiptRun(t, repo)
	run, err := repo.BindAIRun(ctx, run.CompanyID, run.UserID, run.RunID, "native-process-tools")
	if err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{CompanyID: run.CompanyID, ParentEntityID: run.CompanyID, Name: "Operations", ActorUserID: run.UserID, PermissionUserID: run.UserID})
	if err != nil {
		t.Fatal(err)
	}
	created, err := repo.AICreateProcess(ctx, run, "default", "", "Default Process")
	if err != nil || len(created.LogicGates) != 1 || len(created.FolderItems) != 1 || created.FolderItems[0].FolderID != companyExplorerDefaultFolderIDs(run.CompanyID).LogicGatesFolderID {
		t.Fatalf("canonical default placement: %+v %v", created, err)
	}
	created, err = repo.AICreateProcess(ctx, run, "selected", folder.EntityID, "Invoice Review")
	if err != nil || len(created.LogicGates) != 1 || len(created.Events) != 2 || len(created.FolderItems) != 1 || created.FolderItems[0].FolderID != folder.EntityID {
		t.Fatalf("selected folder creation: %+v %v", created, err)
	}
	processID := created.LogicGates[0].LogicGateID
	if created.FolderItems[0].ItemType != EntityTypeLogicGate || created.FolderItems[0].ItemID != processID {
		t.Fatal("Explorer placement replaced the canonical Process identity")
	}
	replay, err := repo.AICreateProcess(ctx, run, "selected", folder.EntityID, "Invoice Review")
	if err != nil || len(replay.LogicGates) != 1 || replay.LogicGates[0].LogicGateID != processID {
		t.Fatalf("create receipt duplicated the Process: %+v %v", replay, err)
	}
	updated, err := repo.AIUpdateProcess(ctx, run, "rename", processID, "Invoice Approval")
	if err != nil || updated.Process.LogicGateID != processID || updated.Process.Header != "Invoice Approval" || updated.Event.Type != "logic_gate_updated" {
		t.Fatalf("rename existing Process: %+v %v", updated, err)
	}
	if _, _, err := repo.UpdateLogicGateHeaderWithWorkspaceEvent(run.CompanyID, processID, "Manual name"); err != nil {
		t.Fatal(err)
	}
	if replay, err := repo.AIUpdateProcess(ctx, run, "rename", processID, "Invoice Approval"); err != nil || replay.Process.Header != updated.Process.Header {
		t.Fatalf("rename historical receipt: %+v %v", replay, err)
	}
	if current, err := repo.GetLogicGate(run.CompanyID, processID); err != nil || current.Header != "Manual name" {
		t.Fatalf("rename replay overwrote a later edit: %+v %v", current, err)
	}
	first, err := repo.AICreateProcessStep(ctx, run, "step-one", ProcessStepCreateInput{LogicGateID: processID, Name: "Review"})
	if err != nil || first.Step == nil || first.Step.LogicGateID != processID {
		t.Fatalf("first Step: %+v %v", first, err)
	}
	nextInput := ProcessStepCreateInput{LogicGateID: processID, Name: "Approve", AfterProcessStepID: &first.Step.ProcessStepID}
	next, err := repo.AICreateProcessStep(ctx, run, "step-two", nextInput)
	if err != nil || next.Step == nil || next.Relationship == nil || next.Relationship.Source.ResourceType != EntityTypeProcessStep || next.Relationship.Source.ResourceID != first.Step.ProcessStepID || next.Relationship.Target.ResourceID != next.Step.ProcessStepID {
		t.Fatalf("add next Step exact edge: %+v %v", next, err)
	}
	if replay, err := repo.AICreateProcessStep(ctx, run, "step-two", nextInput); err != nil || replay.Step.ProcessStepID != next.Step.ProcessStepID || replay.Relationship.ResourceOperationalRelationshipID != next.Relationship.ResourceOperationalRelationshipID {
		t.Fatalf("Step retry duplicated a Step or edge: %+v %v", replay, err)
	}
	missingStep := NewUUIDv7String()
	nextInput.AfterProcessStepID = &missingStep
	if _, err := repo.AICreateProcessStep(ctx, run, "missing-step", nextInput); err == nil {
		t.Fatal("missing predecessor was accepted")
	}
	moved, err := repo.AIMoveProcess(ctx, run, "root", processID, "")
	if err != nil || moved.ResourceID != processID || (moved.ParentEntityID != "" && moved.ParentEntityID != run.CompanyID) {
		t.Fatalf("root move: %+v %v", moved, err)
	}
	moved, err = repo.AIMoveProcess(ctx, run, "folder", processID, folder.EntityID)
	if err != nil || moved.ResourceID != processID || moved.ParentEntityID != folder.EntityID {
		t.Fatalf("folder move: %+v %v", moved, err)
	}
	if _, err := repo.AIMoveProcess(ctx, run, "root", processID, ""); err != nil {
		t.Fatal(err)
	}
	assertAIProcessMapParent(t, repo, run, processID, folder.EntityID)

	// A history failure occurs after the existing command executes. All business
	// rows, placements and events must still roll back with its shared receipt.
	forceConflict := func(action, key string) {
		t.Helper()
		_, err := repo.AppendAIHistoryEvent(ctx, run.CompanyID, run.UserID, run.RunID, AIHistoryEvent{ID: "action:" + action + ":" + key, Type: "fixture-conflict", CreatedAt: time.Now().UTC(), Data: json.RawMessage(`{}`)})
		if err != nil {
			t.Fatal(err)
		}
	}
	forceConflict("mango_create_process", "rollback-create")
	if _, err := repo.AICreateProcess(ctx, run, "rollback-create", folder.EntityID, "Must roll back"); !errors.Is(err, ErrConflict) {
		t.Fatalf("Process create history failure: %v", err)
	}
	processes, err := repo.ListLogicGates(run.CompanyID)
	if err != nil || len(processes) != 2 {
		t.Fatalf("failed create left a Process: %+v %v", processes, err)
	}
	forceConflict("mango_create_step", "rollback-step")
	if _, err := repo.AICreateProcessStep(ctx, run, "rollback-step", ProcessStepCreateInput{LogicGateID: processID, Name: "Must roll back", AfterProcessStepID: &first.Step.ProcessStepID}); !errors.Is(err, ErrConflict) {
		t.Fatalf("Step create history failure: %v", err)
	}
	work, err := repo.GetLogicGateWork(run.CompanyID, processID, run.UserID)
	if err != nil || len(work.Steps) != 2 || len(work.Relationships) != 1 {
		t.Fatalf("failed Step left rows or edges: %+v %v", work, err)
	}
	forceConflict("mango_update_process", "rollback-rename")
	if _, err := repo.AIUpdateProcess(ctx, run, "rollback-rename", processID, "Must roll back"); !errors.Is(err, ErrConflict) {
		t.Fatalf("rename history failure: %v", err)
	}
	if current, err := repo.GetLogicGate(run.CompanyID, processID); err != nil || current.Header != "Manual name" {
		t.Fatalf("failed rename changed Process: %+v %v", current, err)
	}
	forceConflict("mango_move_process", "rollback-move")
	if _, err := repo.AIMoveProcess(ctx, run, "rollback-move", processID, ""); !errors.Is(err, ErrConflict) {
		t.Fatalf("move history failure: %v", err)
	}
	assertAIProcessMapParent(t, repo, run, processID, folder.EntityID)

	deny := ResourceDefaultAccessNoAccess
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{CompanyID: run.CompanyID, ResourceType: EntityTypeCompanyExplorerFolder, ResourceID: folder.EntityID, PermissionMode: PolicyModeCustomized, DefaultAccess: &deny, DescendantAction: PolicyDescendantActionInheritedOnly}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AICreateProcess(ctx, run, "selected", folder.EntityID, "Invoice Review"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked destination replay disclosed receipt: %v", err)
	}
	if _, err := repo.AIMoveProcess(ctx, run, "denied-move", created.LogicGates[0].LogicGateID, folder.EntityID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("denied destination accepted move: %v", err)
	}
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{CompanyID: run.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: processID, PermissionMode: PolicyModeCustomized, DefaultAccess: &deny, DescendantAction: PolicyDescendantActionInheritedOnly}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AIUpdateProcess(ctx, run, "rename", processID, "Invoice Approval"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked Process edit returned receipt: %v", err)
	}
	if _, err := repo.AICreateProcessStep(ctx, run, "denied-step", ProcessStepCreateInput{LogicGateID: processID, Name: "Hidden"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("denied Process accepted Step: %v", err)
	}
	if _, err := repo.SetAIRunStatus(ctx, run.CompanyID, run.UserID, run.RunID, "stopping"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AICreateProcess(ctx, run, "default", "", "Default Process"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stopped run returned Process receipt: %v", err)
	}
}

func assertAIProcessMapParent(t *testing.T, repo Repository, run AIRun, processID, parentID string) {
	t.Helper()
	var mapParent, explorerParent string
	switch repo := repo.(type) {
	case *MemoryRepo:
		repo.mu.RLock()
		defer repo.mu.RUnlock()
		placement := repo.processMapPlacements[processMapPlacementMemoryKey(run.CompanyID, domain.ProcessMapResourceTypeProcess, processID)]
		if placement.MapParentFolderID != nil {
			mapParent = *placement.MapParentFolderID
		}
		explorerParent = repo.folderItems[folderItemKey(run.CompanyID, EntityTypeLogicGate, processID)].FolderID
	case *PostgresRepo:
		err := repo.db.QueryRow(`select coalesce(placement.map_parent_folder_id::text,''),coalesce(item.parent_folder_id::text,'')
from process_map_placements placement join company_explorer_items item
on item.company_id=placement.company_id and item.target_type=placement.resource_type and item.target_id=placement.resource_id
where placement.company_id=$1::uuid and placement.resource_type='logic_gate' and placement.resource_id=$2::uuid`, run.CompanyID, processID).Scan(&mapParent, &explorerParent)
		if err != nil {
			t.Fatal(err)
		}
	}
	if mapParent != parentID || explorerParent != parentID {
		t.Fatalf("canonical Process placement: map=%q Explorer=%q want=%q", mapParent, explorerParent, parentID)
	}
}
