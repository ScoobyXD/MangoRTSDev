package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"reflect"
	"sync"
	"testing"
)

func TestMemoryProcessStepMapLifecycle(t *testing.T) {
	repo := NewMemoryRepo()
	company, err := repo.CreateCompany("Step map")
	if err != nil {
		t.Fatal(err)
	}
	assertProcessStepMapLifecycle(t, repo, company.CompanyID)
}

func assertProcessStepMapLifecycle(t *testing.T, repo Repository, companyID string) {
	gate, err := repo.CreateLogicGate(companyID, "Map ownership")
	if err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "folder", "Operations")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = repo.AssignCompanyExplorerFolderItem(companyID, folder.FolderID, EntityTypeLogicGate, gate.LogicGateID, 1000); err != nil {
		t.Fatal(err)
	}
	first, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Prepare"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Approve", AfterProcessStepID: &first.Step.ProcessStepID})
	if err != nil {
		t.Fatal(err)
	}
	initial, err := repo.GetProcessStepMap(companyID, gate.LogicGateID)
	if err != nil || initial.Revision != 0 || initial.Steps == nil || initial.Routes == nil {
		t.Fatalf("empty map: %+v %v", initial, err)
	}
	input := ProcessStepMapPutInput{CompanyID: companyID, LogicGateID: gate.LogicGateID,
		Steps:  []domain.ProcessStepMapRectangle{{ProcessStepID: first.Step.ProcessStepID, X: -130, Y: 82, Width: 200, Height: 100}, {ProcessStepID: second.Step.ProcessStepID, X: 402, Y: 165, Width: 240, Height: 120}},
		Routes: []domain.ProcessStepMapRoute{{ResourceOperationalRelationshipID: second.Relationship.ResourceOperationalRelationshipID, Points: []domain.ProcessMapRoutePoint{{X: 222, Y: 62}, {X: 222, Y: 225}}}},
	}
	saved, err := repo.PutProcessStepMap(input)
	if err != nil || saved.Revision <= 0 || len(saved.Events) != 1 {
		t.Fatalf("save: %+v %v", saved, err)
	}
	loaded, err := repo.GetProcessStepMap(companyID, gate.LogicGateID)
	if err != nil || !reflect.DeepEqual(loaded, saved.ProcessStepMapLayout) {
		t.Fatalf("reload: %+v %v", loaded, err)
	}
	// A caller modifying a returned rectangle/route must not mutate stored state.
	loaded.Steps[0].X = 999
	loaded.Routes[0].Points[0].Y = 999
	loaded, _ = repo.GetProcessStepMap(companyID, gate.LogicGateID)
	if !reflect.DeepEqual(loaded, saved.ProcessStepMapLayout) {
		t.Fatal("layout leaked mutable storage")
	}
	if _, err = repo.PutProcessStepMap(input); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale save: %v", err)
	}
	input.BaseRevision = saved.Revision
	foreignGate, _ := repo.CreateLogicGate(companyID, "Foreign")
	foreignStep, _ := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: foreignGate.LogicGateID, Name: "Foreign step"})
	invalid := input
	invalid.Steps = []domain.ProcessStepMapRectangle{{ProcessStepID: foreignStep.Step.ProcessStepID, Width: 100, Height: 100}}
	if _, err = repo.PutProcessStepMap(invalid); !errors.Is(err, ErrInvalid) {
		t.Fatalf("foreign Step accepted: %v", err)
	}
	invalid = input
	invalid.Routes = []domain.ProcessStepMapRoute{{ResourceOperationalRelationshipID: newUUIDv7String(), Points: []domain.ProcessMapRoutePoint{}}}
	if _, err = repo.PutProcessStepMap(invalid); !errors.Is(err, ErrInvalid) {
		t.Fatalf("nonexistent edge accepted: %v", err)
	}
	blocked, err := repo.UpsertAuthUser("step-map-blocked-"+companyID, "blocked-step-map@example.test", "Blocked map editor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = repo.AddCompanyMembership(blocked.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.SetEntityPermissions(EntityPermissionUpdateInput{CompanyID: companyID, EntityType: EntityTypeLogicGate, EntityID: gate.LogicGateID, Permissions: []EntityPermissionInput{{SubjectType: EntityPermissionSubjectUser, SubjectID: blocked.UserID, AccessLevel: EntityPermissionNoAccess}}}); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, Assignments: []ResourceRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: blocked.UserID}}}); err != nil {
		t.Fatal(err)
	}
	savedPermissions, err := repo.ListEntityPermissions(companyID, EntityTypeLogicGate, gate.LogicGateID)
	if err != nil {
		t.Fatal(err)
	}
	savedRACI, err := repo.ListResourceRACIAssignments(companyID, EntityTypeLogicGate, gate.LogicGateID)
	if err != nil {
		t.Fatal(err)
	}
	denied := input
	denied.ActorUserID = blocked.UserID
	if _, err = repo.PutProcessStepMap(denied); !errors.Is(err, ErrNotFound) {
		t.Fatalf("store allowed revoked Process access: %v", err)
	}
	// Two editors using one revision cannot overwrite each other.
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := repo.PutProcessStepMap(input); results <- err }()
	}
	wg.Wait()
	close(results)
	wins, conflicts := 0, 0
	for err := range results {
		if err == nil {
			wins++
		} else if errors.Is(err, ErrVersionConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("concurrent saves: wins=%d conflicts=%d", wins, conflicts)
	}
	work, err := repo.GetLogicGateWork(companyID, gate.LogicGateID, "")
	if err != nil || len(work.Steps) != 2 || len(work.Nodes) != 0 || len(work.Relationships) != 1 || work.Steps[0].Position != first.Step.Position || work.Steps[1].Position != second.Step.Position {
		t.Fatalf("geometry changed authored/runtime work: %+v %v", work, err)
	}
	beforeRecycle, _ := repo.GetProcessStepMap(companyID, gate.LogicGateID)
	// Recycle stores presentation with the exact definition, restoring a fresh revision.
	user, err := repo.UpsertAuthUser("step-map-admin-"+companyID, "step-map@example.test", "Step Map Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	actor := user.UserID
	if _, err = repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: EntityTypeLogicGate, ID: gate.LogicGateID}}, actor); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.GetProcessStepMap(companyID, gate.LogicGateID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted owner read: %v", err)
	}
	items, err := repo.ListRecycleBinItems(companyID, actor)
	if err != nil || len(items) != 1 {
		t.Fatalf("recycle: %+v %v", items, err)
	}
	if _, err = repo.RestoreRecycleBinItems(companyID, actor, []string{items[0].RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}
	restored, err := repo.GetProcessStepMap(companyID, gate.LogicGateID)
	if err != nil || restored.Revision <= beforeRecycle.Revision || !reflect.DeepEqual(restored.Steps, beforeRecycle.Steps) || !reflect.DeepEqual(restored.Routes, beforeRecycle.Routes) {
		t.Fatalf("restore: %+v %v", restored, err)
	}
	if allowed, err := repo.UserHasEffectiveAccess(companyID, blocked.UserID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("restore lost explicit deny policy: %v %v", allowed, err)
	}
	restoredPermissions, err := repo.ListEntityPermissions(companyID, EntityTypeLogicGate, gate.LogicGateID)
	if err != nil || !reflect.DeepEqual(restoredPermissions, savedPermissions) {
		t.Fatalf("restore changed exact permission rows: %+v %v", restoredPermissions, err)
	}
	restoredRACI, err := repo.ListResourceRACIAssignments(companyID, EntityTypeLogicGate, gate.LogicGateID)
	if err != nil || !reflect.DeepEqual(restoredRACI, savedRACI) {
		t.Fatalf("restore changed exact RACI rows: %+v %v", restoredRACI, err)
	}
	folderItems, err := repo.ListCompanyExplorerFolderItems(companyID, folder.FolderID, EntityTypeLogicGate)
	if err != nil || len(folderItems) != 1 || folderItems[0].ItemID != gate.LogicGateID {
		t.Fatalf("restore lost exact Folder placement: %+v %v", folderItems, err)
	}
	if _, err = repo.PutProcessStepMap(ProcessStepMapPutInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, BaseRevision: beforeRecycle.Revision, Steps: beforeRecycle.Steps, Routes: beforeRecycle.Routes}); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("pre-recycle stale save: %v", err)
	}
	if _, err = repo.DeleteProcessStep(ProcessStepDeleteInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, ProcessStepID: second.Step.ProcessStepID}); err != nil {
		t.Fatal(err)
	}
	pruned, err := repo.GetProcessStepMap(companyID, gate.LogicGateID)
	if err != nil || len(pruned.Steps) != 1 || len(pruned.Routes) != 0 || pruned.Revision <= restored.Revision {
		t.Fatalf("delete cleanup: %+v %v", pruned, err)
	}
}

func TestProcessStepMapGeometryValidation(t *testing.T) {
	base := ProcessStepMapPutInput{CompanyID: newUUIDv7String(), LogicGateID: newUUIDv7String(), Steps: []domain.ProcessStepMapRectangle{{ProcessStepID: newUUIDv7String(), Width: 200, Height: 100}}}
	for _, mutate := range []func(*ProcessStepMapPutInput){
		func(p *ProcessStepMapPutInput) { p.BaseRevision = -1 },
		func(p *ProcessStepMapPutInput) { p.Steps[0].X = 1000001 },
		func(p *ProcessStepMapPutInput) { p.Steps[0].Width = 0 },
		func(p *ProcessStepMapPutInput) { p.Steps = append(p.Steps, p.Steps[0]) },
		func(p *ProcessStepMapPutInput) {
			p.Routes = []domain.ProcessStepMapRoute{{ResourceOperationalRelationshipID: newUUIDv7String(), Points: make([]domain.ProcessMapRoutePoint, 257)}}
		},
	} {
		input := base
		input.Steps = append([]domain.ProcessStepMapRectangle{}, base.Steps...)
		mutate(&input)
		if _, err := normalizeProcessStepMap(input); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid geometry accepted: %+v %v", input, err)
		}
	}
}

func TestMemoryProcessStepMapEventFailureIsAtomic(t *testing.T) {
	repo := NewMemoryRepo()
	company, _ := repo.CreateCompany("Atomic layout")
	gate, _ := repo.CreateLogicGate(company.CompanyID, "Process")
	repo.realtimeOutboxErr = errors.New("forced outbox failure")
	_, err := repo.PutProcessStepMap(ProcessStepMapPutInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID})
	if !errors.Is(err, repo.realtimeOutboxErr) {
		t.Fatalf("save error: %v", err)
	}
	layout, err := repo.GetProcessStepMap(company.CompanyID, gate.LogicGateID)
	if err != nil || layout.Revision != 0 {
		t.Fatalf("failed save leaked layout: %+v %v", layout, err)
	}
}
