package store

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"reflect"
	"testing"
)

func authoredProcessBatch(companyID, folderID string) WorkspaceEntityBatchInput {
	first, second, edge := newUUIDv7String(), newUUIDv7String(), newUUIDv7String()
	return WorkspaceEntityBatchInput{
		CompanyID: companyID, EntityKind: EntityTypeLogicGate, FolderID: folderID, MutationOrigin: MutationOriginCompanyExplorer,
		Items: []WorkspaceEntityBatchItemInput{{ClientID: "new-process", Title: "Authored Process"}},
		ProcessDefinition: &WorkspaceProcessDefinitionInput{
			LogicGateID:   newUUIDv7String(),
			Steps:         []WorkspaceProcessDefinitionStep{{ProcessStepID: first, Name: "Prepare"}, {ProcessStepID: second, Name: "Approve"}},
			Relationships: []WorkspaceProcessDefinitionRelationship{{ResourceOperationalRelationshipID: edge, Source: domain.ProcessMapResourceRef{ResourceType: "process_step", ResourceID: first}, Target: domain.ProcessMapResourceRef{ResourceType: "process_step", ResourceID: second}}},
			Layout: &WorkspaceProcessDefinitionLayout{
				Steps:  []domain.ProcessStepMapRectangle{{ProcessStepID: first, X: 410, Y: 200, Width: 220, Height: 100}, {ProcessStepID: second, X: 80, Y: 50, Width: 220, Height: 100}},
				Routes: []domain.ProcessStepMapRoute{{ResourceOperationalRelationshipID: edge, Points: []domain.ProcessMapRoutePoint{{X: 350, Y: 170}}}},
			},
		},
	}
}

func TestMemoryProcessStepMapAuthoredBatch(t *testing.T) {
	repo := NewMemoryRepo()
	assertProcessStepMapAuthoredBatch(t, repo)
}

func assertProcessStepMapAuthoredBatch(t *testing.T, repo Repository) {
	t.Helper()
	company, err := repo.CreateCompany("Process authoring")
	if err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "folder", "Operations")
	if err != nil {
		t.Fatal(err)
	}
	input := authoredProcessBatch(company.CompanyID, folder.FolderID)
	input.ProcessDefinition.Steps[0].BodyJSON = processStepSOPBody
	definition := input.ProcessDefinition
	saved, err := repo.CreateWorkspaceEntityBatch(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.LogicGates) != 1 || saved.LogicGates[0].LogicGateID != definition.LogicGateID || saved.EntityMappings[0].EntityID != definition.LogicGateID || len(saved.FolderItems) != 1 || saved.FolderItems[0].FolderID != folder.FolderID || len(saved.ProcessSteps) != 2 || len(saved.StepRelationships) != 1 || saved.StepMap == nil || saved.StepMap.Revision <= 0 || len(saved.Events) != 3 {
		t.Fatalf("incomplete authored save: %+v", saved)
	}
	work, err := repo.GetLogicGateWork(company.CompanyID, definition.LogicGateID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(work.Nodes) != 0 || len(work.Steps) != 2 || work.Steps[0].ProcessStepID != definition.Steps[0].ProcessStepID || work.Steps[1].ProcessStepID != definition.Steps[1].ProcessStepID || work.Steps[0].Position != 1000 || work.Steps[1].Position != 2000 {
		t.Fatalf("creation order or runtime separation lost: %+v", work)
	}
	if !editorJSONValuesEqual(work.Steps[0].BodyJSON, processStepSOPBody) || !editorJSONValuesEqual(work.Steps[1].BodyJSON, emptyEditorTextboxBody()) {
		t.Fatalf("authored Process lost step SOPs: %+v", work.Steps)
	}
	if saved.StepRelationships[0].ResourceOperationalRelationshipID != definition.Relationships[0].ResourceOperationalRelationshipID || saved.StepRelationships[0].Source != definition.Relationships[0].Source || saved.StepRelationships[0].Target != definition.Relationships[0].Target {
		t.Fatalf("operational identity changed: %+v", saved.StepRelationships)
	}
	layout, err := repo.GetProcessStepMap(company.CompanyID, definition.LogicGateID)
	if err != nil || !reflect.DeepEqual(layout, *saved.StepMap) {
		t.Fatalf("layout reload: %+v %v", layout, err)
	}
	// A second save with the same creation IDs must never overwrite or create a
	// second Process, even if the response to the first save was lost.
	input.Items[0].Title = "Retry must not replace the saved Process"
	if _, err := repo.CreateWorkspaceEntityBatch(input); !errors.Is(err, ErrConflict) {
		t.Fatalf("retry: %v", err)
	}
	gate, err := repo.GetLogicGate(company.CompanyID, definition.LogicGateID)
	if err != nil || gate.Header != "Authored Process" {
		t.Fatalf("collision changed Process: %+v %v", gate, err)
	}

	for _, collision := range []string{"step", "edge"} {
		other := authoredProcessBatch(company.CompanyID, folder.FolderID)
		if collision == "step" {
			other.ProcessDefinition.Steps[0].ProcessStepID = definition.Steps[0].ProcessStepID
			other.ProcessDefinition.Relationships[0].Source.ResourceID = definition.Steps[0].ProcessStepID
			other.ProcessDefinition.Layout.Steps[0].ProcessStepID = definition.Steps[0].ProcessStepID
		} else {
			other.ProcessDefinition.Relationships[0].ResourceOperationalRelationshipID = definition.Relationships[0].ResourceOperationalRelationshipID
			other.ProcessDefinition.Layout.Routes[0].ResourceOperationalRelationshipID = definition.Relationships[0].ResourceOperationalRelationshipID
		}
		if _, err := repo.CreateWorkspaceEntityBatch(other); !errors.Is(err, ErrConflict) {
			t.Fatalf("%s collision: %v", collision, err)
		}
		if _, err := repo.GetLogicGate(company.CompanyID, other.ProcessDefinition.LogicGateID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("%s collision leaked Process: %v", collision, err)
		}
	}
	empty := authoredProcessBatch(company.CompanyID, folder.FolderID)
	empty.ProcessDefinition.Steps = []WorkspaceProcessDefinitionStep{}
	empty.ProcessDefinition.Relationships = []WorkspaceProcessDefinitionRelationship{}
	empty.ProcessDefinition.Layout = &WorkspaceProcessDefinitionLayout{Steps: []domain.ProcessStepMapRectangle{}, Routes: []domain.ProcessStepMapRoute{}}
	emptySaved, err := repo.CreateWorkspaceEntityBatch(empty)
	if err != nil || emptySaved.StepMap == nil || emptySaved.StepMap.Revision <= 0 {
		t.Fatalf("empty Process save: %+v %v", emptySaved, err)
	}
	if _, err := repo.CreateWorkspaceEntityBatch(empty); !errors.Is(err, ErrConflict) {
		t.Fatalf("empty retry: %v", err)
	}
	processes, err := repo.ListLogicGates(company.CompanyID)
	if err != nil || len(processes) != 2 {
		t.Fatalf("failed saves leaked Process records: %+v %v", processes, err)
	}

	for _, scenario := range []string{"foreign rectangle", "foreign route", "foreign endpoint", "mixed endpoint", "self edge", "duplicate edge", "missing layout", "missing array", "no folder"} {
		t.Run(scenario, func(t *testing.T) {
			bad := authoredProcessBatch(company.CompanyID, folder.FolderID)
			switch scenario {
			case "foreign rectangle":
				bad.ProcessDefinition.Layout.Steps[0].ProcessStepID = definition.Steps[0].ProcessStepID
			case "foreign route":
				bad.ProcessDefinition.Layout.Routes[0].ResourceOperationalRelationshipID = definition.Relationships[0].ResourceOperationalRelationshipID
			case "foreign endpoint":
				bad.ProcessDefinition.Relationships[0].Source.ResourceID = definition.Steps[0].ProcessStepID
			case "mixed endpoint":
				bad.ProcessDefinition.Relationships[0].Source.ResourceType = "logic_gate"
			case "self edge":
				bad.ProcessDefinition.Relationships[0].Target = bad.ProcessDefinition.Relationships[0].Source
			case "duplicate edge":
				bad.ProcessDefinition.Relationships = append(bad.ProcessDefinition.Relationships, bad.ProcessDefinition.Relationships[0])
			case "missing layout":
				bad.ProcessDefinition.Layout = nil
			case "missing array":
				bad.ProcessDefinition.Steps = nil
			case "no folder":
				bad.FolderID = ""
			}
			if _, err := repo.CreateWorkspaceEntityBatch(bad); !errors.Is(err, ErrInvalid) {
				t.Fatalf("invalid definition accepted: %v", err)
			}
			if _, err := repo.GetLogicGate(company.CompanyID, bad.ProcessDefinition.LogicGateID); !errors.Is(err, ErrNotFound) {
				t.Fatalf("invalid save leaked Process: %v", err)
			}
		})
	}
}

func TestMemoryProcessStepMapAuthoredBatchEventFailureIsAtomic(t *testing.T) {
	repo := NewMemoryRepo()
	company, _ := repo.CreateCompany("Atomic authored Process")
	folder, _ := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "folder", "Destination")
	input := authoredProcessBatch(company.CompanyID, folder.FolderID)
	input.ProcessDefinition.EditorDocument = authoredProcessEditorDocument()
	before := repo.snapshotProcessMapMutationLocked()
	repo.realtimeOutboxErr = errors.New("forced outbox failure")
	if _, err := repo.CreateWorkspaceEntityBatch(input); !errors.Is(err, repo.realtimeOutboxErr) {
		t.Fatalf("save error: %v", err)
	}
	if after := repo.snapshotProcessMapMutationLocked(); !reflect.DeepEqual(before, after) {
		t.Fatal("failed authored save changed Process, Explorer, map, policies, or events")
	}
	if len(repo.processSteps) != 0 || len(repo.processStepMaps) != 0 || len(repo.editorJSONDocuments) != 0 {
		t.Fatal("failed authored save leaked Steps, layout, or SOP")
	}
}

func authoredProcessEditorDocument() json.RawMessage {
	return json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","attrs":{"blockId":"sop-introduction"},"content":[{"type":"text","text":"Check the order before approval."}]}]}}`)
}

func TestMemoryProcessCreationRACIAndEditor(t *testing.T) {
	assertProcessCreationRACIAndEditor(t, NewMemoryRepo())
}

func assertProcessCreationRACIAndEditor(t *testing.T, repo Repository) {
	t.Helper()
	company, err := repo.CreateCompany("Process details")
	if err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "folder", "Operations")
	if err != nil {
		t.Fatal(err)
	}
	group, err := repo.CreateCompanyUserGroup(company.CompanyID, "", "Operations team")
	if err != nil {
		t.Fatal(err)
	}
	subject := "process-author-" + newUUIDv7String()
	user, err := repo.UpsertAuthUser(subject, subject+"@example.com", "Author")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	parentAssignments := []ResourceRACIAssignmentInput{{Role: domain.RACIRoleConsulted, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID}}
	putParent := func(assignments []ResourceRACIAssignmentInput) {
		t.Helper()
		if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{CompanyID: company.CompanyID, ResourceType: EntityTypeCompanyExplorerFolder, ResourceID: folder.FolderID, AssignmentMode: PolicyModeCustomized, DescendantAction: PolicyDescendantActionInheritedOnly, Assignments: assignments}); err != nil {
			t.Fatal(err)
		}
	}
	putParent(parentAssignments)
	created := map[string]string{}
	for _, scenario := range []string{"untouched", "same as parent", "customized", "cleared"} {
		input := authoredProcessBatch(company.CompanyID, folder.FolderID)
		input.CreatorUserID = user.UserID
		input.ProcessDefinition.EditorDocument = authoredProcessEditorDocument()
		switch scenario {
		case "same as parent":
			input.ProcessDefinition.RACIAssignments = parentAssignments
		case "customized":
			input.ProcessDefinition.RACIAssignments = []ResourceRACIAssignmentInput{
				{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: user.UserID},
				{Role: domain.RACIRoleAccountable, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID},
			}
		case "cleared":
			input.ProcessDefinition.RACIAssignments = []ResourceRACIAssignmentInput{}
		}
		if _, err := repo.CreateWorkspaceEntityBatch(input); err != nil {
			t.Fatalf("%s: %v", scenario, err)
		}
		processID := input.ProcessDefinition.LogicGateID
		created[scenario] = processID
		policy, err := repo.GetResourceRACIPolicy(company.CompanyID, EntityTypeLogicGate, processID)
		if err != nil {
			t.Fatal(err)
		}
		wantMode, wantDirect := PolicyModeInherited, 0
		if scenario == "customized" {
			wantMode, wantDirect = PolicyModeCustomized, 2
		} else if scenario == "cleared" {
			wantMode = PolicyModeCustomized
		}
		if policy.AssignmentMode != wantMode || len(policy.RACIAssignments) != wantDirect {
			t.Fatalf("%s policy = %+v", scenario, policy)
		}
		if scenario == "customized" {
			normalized, _ := normalizeResourceRACIAssignmentInputs(input.ProcessDefinition.RACIAssignments)
			if !normalizedRACIAssignmentsMatch(normalized, policy.RACIAssignments) {
				t.Fatalf("typed assignment identities changed: %+v", policy.RACIAssignments)
			}
		}
		ref := EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: processID, DocumentID: "logic-gate-overview"}
		snapshot, err := repo.GetEditorJSONSnapshot(ref)
		if err != nil || snapshot.Revision != 1 || !editorJSONValuesEqual(snapshot.JSONDocument, input.ProcessDefinition.EditorDocument) {
			t.Fatalf("%s canonical SOP = %+v, %v", scenario, snapshot, err)
		}
		input.Items[0].Title = "Do not replace"
		input.ProcessDefinition.EditorDocument = append(json.RawMessage{}, emptyMangoTiptapDocument...)
		if _, err := repo.CreateWorkspaceEntityBatch(input); !errors.Is(err, ErrConflict) {
			t.Fatalf("retry accepted: %v", err)
		}
		after, err := repo.GetEditorJSONSnapshot(ref)
		if err != nil || !editorJSONValuesEqual(after.JSONDocument, snapshot.JSONDocument) || after.Revision != 1 {
			t.Fatalf("retry changed SOP: %+v %v", after, err)
		}
	}
	putParent([]ResourceRACIAssignmentInput{})
	for scenario, processID := range created {
		assignments, err := repo.ListResourceRACIAssignments(company.CompanyID, EntityTypeLogicGate, processID)
		wantCount := 0
		if scenario == "customized" {
			wantCount = 2
		}
		if err != nil || len(assignments) != wantCount {
			t.Fatalf("%s did not keep correct live policy: %+v %v", scenario, assignments, err)
		}
	}
	empty := authoredProcessBatch(company.CompanyID, folder.FolderID)
	empty.ProcessDefinition.RACIAssignments = []ResourceRACIAssignmentInput{}
	if _, err := repo.CreateWorkspaceEntityBatch(empty); err != nil {
		t.Fatal(err)
	}
	policy, err := repo.GetResourceRACIPolicy(company.CompanyID, EntityTypeLogicGate, empty.ProcessDefinition.LogicGateID)
	if err != nil || policy.AssignmentMode != PolicyModeInherited {
		t.Fatalf("empty parent match must inherit: %+v %v", policy, err)
	}
	for _, scenario := range []string{"foreign principal", "conflicting roles", "invalid SOP", "duplicate block IDs"} {
		input := authoredProcessBatch(company.CompanyID, folder.FolderID)
		input.ProcessDefinition.EditorDocument = authoredProcessEditorDocument()
		switch scenario {
		case "foreign principal":
			input.ProcessDefinition.RACIAssignments = []ResourceRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: newUUIDv7String()}}
		case "conflicting roles":
			input.ProcessDefinition.RACIAssignments = []ResourceRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: user.UserID}, {Role: domain.RACIRoleAccountable, PrincipalType: EntityPermissionSubjectUser, PrincipalID: user.UserID}}
		case "invalid SOP":
			input.ProcessDefinition.EditorDocument = json.RawMessage(`{"text":"not an editor document"}`)
		case "duplicate block IDs":
			input.ProcessDefinition.EditorDocument = json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","attrs":{"blockId":"same"}},{"type":"paragraph","attrs":{"blockId":"same"}}]}}`)
		}
		if _, err := repo.CreateWorkspaceEntityBatch(input); err == nil {
			t.Fatalf("%s saved", scenario)
		}
		if _, err := repo.GetLogicGate(company.CompanyID, input.ProcessDefinition.LogicGateID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("%s leaked Process: %v", scenario, err)
		}
	}
}
