package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
)

func processStepsFixture(t *testing.T) (*MemoryRepo, string, domain.LogicGate, domain.Node) {
	t.Helper()
	r := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555401"
	r.EnsureCompany(companyID, "Steps")
	gate, err := r.CreateLogicGate(companyID, "Quote")
	if err != nil {
		t.Fatal(err)
	}
	node, err := r.CreateNode(companyID, "Invoice")
	if err != nil {
		t.Fatal(err)
	}
	return r, companyID, gate, node
}

func TestProcessStepsRequestResolversIncludeEveryEffectiveResponsible(t *testing.T) {
	repo, companyID, _, _ := processStepsFixture(t)
	assertProcessStepsRequestResolvers(t, repo, companyID)
}

func TestProcessStepCreationInsertsImmediatelyAfterSource(t *testing.T) {
	repo, companyID, _, _ := processStepsFixture(t)
	assertProcessStepCreationOrder(t, repo, companyID)
}

func assertProcessStepCreationOrder(t *testing.T, repo Repository, companyID string) {
	t.Helper()
	gate, err := repo.CreateLogicGate(companyID, "Ordered steps")
	if err != nil {
		t.Fatal(err)
	}
	first, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "First"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Second", AfterProcessStepID: &first.Step.ProcessStepID})
	if err != nil {
		t.Fatal(err)
	}
	third, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Third", AfterProcessStepID: &second.Step.ProcessStepID})
	if err != nil {
		t.Fatal(err)
	}
	denseSecond, denseThird := processStepPositionStride+1, processStepPositionStride+2
	if _, err = repo.UpdateProcessStep(ProcessStepUpdateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, ProcessStepID: second.Step.ProcessStepID, Position: &denseSecond}); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.UpdateProcessStep(ProcessStepUpdateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, ProcessStepID: third.Step.ProcessStepID, Position: &denseThird}); err != nil {
		t.Fatal(err)
	}
	inserted, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Inserted", AfterProcessStepID: &first.Step.ProcessStepID})
	if err != nil {
		t.Fatal(err)
	}
	if inserted.PositionUpdates[second.Step.ProcessStepID] != 3*processStepPositionStride || inserted.PositionUpdates[third.Step.ProcessStepID] != 4*processStepPositionStride {
		t.Fatalf("rebalanced positions = %+v", inserted.PositionUpdates)
	}
	newest, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Newest", AfterProcessStepID: &first.Step.ProcessStepID})
	if err != nil {
		t.Fatal(err)
	}
	if newest.Relationship == nil || newest.Relationship.Source.ResourceID != first.Step.ProcessStepID || newest.Relationship.Target.ResourceID != newest.Step.ProcessStepID {
		t.Fatal("Add next must connect the source step to the new step")
	}
	if inserted.Relationship == nil || inserted.Relationship.Source.ResourceID != first.Step.ProcessStepID || inserted.Relationship.Target.ResourceID != inserted.Step.ProcessStepID {
		t.Fatal("Inserted step must keep its exact incoming connection")
	}
	appended, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Appended"})
	if err != nil {
		t.Fatal(err)
	}
	work, err := repo.GetLogicGateWork(companyID, gate.LogicGateID, "")
	if err != nil {
		t.Fatal(err)
	}
	wantNames := []string{"First", "Newest", "Inserted", "Second", "Third", "Appended"}
	if len(work.Steps) != len(wantNames) {
		t.Fatalf("steps = %+v, want %v", work.Steps, wantNames)
	}
	for index, wantName := range wantNames {
		if work.Steps[index].Name != wantName || index > 0 && work.Steps[index-1].Position >= work.Steps[index].Position {
			t.Fatalf("step %d = %+v, want %q in strictly increasing order", index, work.Steps[index], wantName)
		}
	}
	if appended.Step.Position != work.Steps[len(work.Steps)-1].Position {
		t.Fatal("Add step must append at the right edge")
	}
}

func TestPlanProcessStepInsertionRebalancesOnlyWhenRequired(t *testing.T) {
	firstID, secondID := "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
	steps := []domain.ProcessStep{{ProcessStepID: firstID, Position: 1000}, {ProcessStepID: secondID, Position: 1001}}
	position, updates, ok := planProcessStepInsertion(steps, &firstID)
	_, firstChanged := updates[firstID]
	if !ok || position != 2000 || firstChanged || updates[secondID] != 3000 {
		t.Fatalf("dense insertion plan = position %d updates %+v ok %t", position, updates, ok)
	}
	steps[1].Position = 3000
	position, updates, ok = planProcessStepInsertion(steps, &firstID)
	if !ok || position != 2000 || len(updates) != 0 {
		t.Fatalf("sparse insertion plan = position %d updates %+v ok %t", position, updates, ok)
	}
}

func assertProcessStepsRequestResolvers(t *testing.T, repo Repository, companyID string) {
	t.Helper()
	users := []domain.User{}
	for _, name := range []string{"first-responsible", "second-responsible", "group-responsible", "observer"} {
		user, err := repo.UpsertAuthUser(name, name+"@example.com", name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = repo.AddCompanyMembership(name, companyID, domain.RoleCompanyUser); err != nil {
			t.Fatal(err)
		}
		users = append(users, user)
	}
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Reviewers")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{users[2].UserID}); err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(companyID, "Resolve requests")
	if err != nil {
		t.Fatal(err)
	}
	assignments := []ResourceRACIAssignmentInput{
		{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: users[0].UserID},
		{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: users[1].UserID},
		{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID},
		{Role: domain.RACIRoleInformed, PrincipalType: EntityPermissionSubjectUser, PrincipalID: users[3].UserID},
	}
	if _, err = repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, Assignments: assignments}); err != nil {
		t.Fatal(err)
	}
	check := func() {
		t.Helper()
		for index, user := range users {
			work, err := repo.GetLogicGateWork(companyID, gate.LogicGateID, user.UserID)
			if err != nil || work.Permissions.CanResolveRequests != (index < 3) {
				t.Fatalf("Request resolver for %s: %+v %v", user.DisplayName, work.Permissions, err)
			}
		}
	}
	check()
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Request team")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = repo.AssignCompanyExplorerFolderItem(companyID, folder.FolderID, EntityTypeLogicGate, gate.LogicGateID, 1000); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{CompanyID: companyID, ResourceType: EntityTypeCompanyExplorerFolder, ResourceID: folder.FolderID, Assignments: assignments}); err != nil {
		t.Fatal(err)
	}
	if _, _, err = repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, AssignmentMode: PolicyModeInherited, DescendantAction: PolicyDescendantActionInheritedOnly}); err != nil {
		t.Fatal(err)
	}
	check()
}

func TestProcessStepsStatusAndStepMoveIndependently(t *testing.T) {
	r, company, gate, node := processStepsFixture(t)
	first, err := r.CreateProcessStep(ProcessStepCreateInput{CompanyID: company, LogicGateID: gate.LogicGateID, Name: "Prepare"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := r.CreateProcessStep(ProcessStepCreateInput{CompanyID: company, LogicGateID: gate.LogicGateID, Name: "Approve", AfterProcessStepID: &first.Step.ProcessStepID})
	if err != nil {
		t.Fatal(err)
	}
	if second.Relationship == nil || second.Relationship.Source.ResourceID != first.Step.ProcessStepID || second.Relationship.Target.ResourceID != second.Step.ProcessStepID {
		t.Fatal("Add next must connect exact steps")
	}
	assigned, err := r.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: company, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "In Progress", ProcessStepID: &first.Step.ProcessStepID, ProcessStepIDSet: true})
	if err != nil {
		t.Fatal(err)
	}
	moved, err := r.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: company, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, ProcessStepID: &second.Step.ProcessStepID, ProcessStepIDSet: true})
	if err != nil {
		t.Fatal(err)
	}
	if nodeWorkStatus(moved.Node) != "In Progress" || moved.Assignment.AssignmentID != assigned.Assignment.AssignmentID || moved.Assignment.ProcessStepID == nil || *moved.Assignment.ProcessStepID != second.Step.ProcessStepID {
		t.Fatal("Moving must preserve status and assignment identity")
	}
	for _, status := range []string{"Done", "Backlogs", "Pending", "Requested", "In Progress", "Review"} {
		moved, err = r.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: company, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: status})
		if err != nil {
			t.Fatal(err)
		}
		if nodeWorkStatus(moved.Node) != status || moved.Assignment.ProcessStepID == nil || *moved.Assignment.ProcessStepID != second.Step.ProcessStepID {
			t.Fatalf("Status %s must preserve step", status)
		}
	}
	issue, err := r.SetLogicGateNodeAssignmentIssue(LogicGateNodeAssignmentIssueInput{CompanyID: company, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, IsIssue: true})
	if err != nil {
		t.Fatal(err)
	}
	if nodeWorkStatus(issue.Node) != "Review" || !issue.Assignment.IsIssue {
		t.Fatal("Issue flag must not replace status")
	}
}
func TestProcessStepsDeletePreservesNodesAndIncidentEdgesOnly(t *testing.T) {
	r, company, gate, node := processStepsFixture(t)
	first, _ := r.CreateProcessStep(ProcessStepCreateInput{CompanyID: company, LogicGateID: gate.LogicGateID, Name: "First"})
	middle, _ := r.CreateProcessStep(ProcessStepCreateInput{CompanyID: company, LogicGateID: gate.LogicGateID, Name: "Middle", AfterProcessStepID: &first.Step.ProcessStepID})
	last, _ := r.CreateProcessStep(ProcessStepCreateInput{CompanyID: company, LogicGateID: gate.LogicGateID, Name: "Last", AfterProcessStepID: &middle.Step.ProcessStepID})
	branch, err := r.CreateProcessStepRelationship(ProcessStepRelationshipInput{CompanyID: company, LogicGateID: gate.LogicGateID, Source: domain.ProcessMapResourceRef{ResourceType: "process_step", ResourceID: first.Step.ProcessStepID}, Target: domain.ProcessMapResourceRef{ResourceType: "process_step", ResourceID: last.Step.ProcessStepID}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = r.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: company, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "Done", ProcessStepID: &middle.Step.ProcessStepID, ProcessStepIDSet: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.DeleteProcessStep(ProcessStepDeleteInput{CompanyID: company, LogicGateID: gate.LogicGateID, ProcessStepID: middle.Step.ProcessStepID}); err != nil {
		t.Fatal(err)
	}
	work, err := r.GetLogicGateWork(company, gate.LogicGateID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(work.Steps) != 2 || len(work.Relationships) != 1 || work.Relationships[0].ResourceOperationalRelationshipID != branch.Relationship.ResourceOperationalRelationshipID {
		t.Fatal("Delete only incident edges, preserving unrelated branch")
	}
	if len(work.Nodes) != 1 || work.Nodes[0].NodeID != node.NodeID || work.Nodes[0].Status != "Done" || work.Nodes[0].ProcessStepID != nil {
		t.Fatal("Deleting a step must preserve completed Node and Process membership")
	}
}
func TestProcessStepsRejectForeignAssignmentsAndEdges(t *testing.T) {
	r, company, gate, node := processStepsFixture(t)
	other, _ := r.CreateLogicGate(company, "Other")
	first, _ := r.CreateProcessStep(ProcessStepCreateInput{CompanyID: company, LogicGateID: gate.LogicGateID, Name: "First"})
	foreign, _ := r.CreateProcessStep(ProcessStepCreateInput{CompanyID: company, LogicGateID: other.LogicGateID, Name: "Foreign"})
	_, err := r.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: company, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "Pending", ProcessStepID: &foreign.Step.ProcessStepID, ProcessStepIDSet: true})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("foreign assignment: %v", err)
	}
	if rows, _ := r.ListNodeLogicGateAssignments(company, node.NodeID); len(rows) != 0 {
		t.Fatal("Rejected assignment must not mutate")
	}
	source := domain.ProcessMapResourceRef{ResourceType: "process_step", ResourceID: first.Step.ProcessStepID}
	for _, target := range []domain.ProcessMapResourceRef{source, {ResourceType: "process_step", ResourceID: foreign.Step.ProcessStepID}, {ResourceType: "logic_gate", ResourceID: gate.LogicGateID}} {
		if _, err := r.CreateProcessStepRelationship(ProcessStepRelationshipInput{CompanyID: company, LogicGateID: gate.LogicGateID, Source: source, Target: target}); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid edge accepted: %v", err)
		}
	}
	second, _ := r.CreateProcessStep(ProcessStepCreateInput{CompanyID: company, LogicGateID: gate.LogicGateID, Name: "Second"})
	input := ProcessStepRelationshipInput{CompanyID: company, LogicGateID: gate.LogicGateID, Source: source, Target: domain.ProcessMapResourceRef{ResourceType: "process_step", ResourceID: second.Step.ProcessStepID}}
	edge, err := r.CreateProcessStepRelationship(input)
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := r.CreateProcessStepRelationship(input)
	if err != nil || duplicate.Relationship.ResourceOperationalRelationshipID != edge.Relationship.ResourceOperationalRelationshipID {
		t.Fatal("Repeated connection must return same edge")
	}
	_, err = r.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: company, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "Review", ProcessStepID: &first.Step.ProcessStepID, ProcessStepIDSet: true})
	if err != nil {
		t.Fatal(err)
	}
	moved, err := r.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: company, LogicGateID: other.LogicGateID, NodeID: node.NodeID})
	if err != nil {
		t.Fatal(err)
	}
	if moved.Assignment.ProcessStepID != nil || nodeWorkStatus(moved.Node) != "Review" {
		t.Fatal("Cross-Process move must clear old step and preserve status")
	}
}

func TestProcessStepsRestoreNodeAfterStepDeleted(t *testing.T) {
	r, company, gate, node := processStepsFixture(t)
	step, err := r.CreateProcessStep(ProcessStepCreateInput{CompanyID: company, LogicGateID: gate.LogicGateID, Name: "Review"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = r.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: company, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "Done", ProcessStepID: &step.Step.ProcessStepID, ProcessStepIDSet: true})
	if err != nil {
		t.Fatal(err)
	}
	actor := "22222222-2222-4222-8222-222222222222"
	if _, err = r.DeleteCompanyExplorerTargets(company, []CompanyExplorerDeleteTargetInput{{Kind: "node", ID: node.NodeID}}, actor); err != nil {
		t.Fatal(err)
	}
	items, err := r.ListRecycleBinItems(company, actor)
	if err != nil || len(items) != 1 {
		t.Fatalf("Recycle: %v %+v", err, items)
	}
	if _, err = r.DeleteProcessStep(ProcessStepDeleteInput{CompanyID: company, LogicGateID: gate.LogicGateID, ProcessStepID: step.Step.ProcessStepID}); err != nil {
		t.Fatal(err)
	}
	if _, err = r.RestoreRecycleBinItems(company, actor, []string{items[0].RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}
	work, err := r.GetLogicGateWork(company, gate.LogicGateID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(work.Nodes) != 1 || work.Nodes[0].Status != "Done" || work.Nodes[0].ProcessStepID != nil {
		t.Fatalf("Restored Node must preserve completion and clear deleted step: %+v", work)
	}
}

func TestProcessStepsDirectNodeStatusValidation(t *testing.T) {
	r, company, gate, node := processStepsFixture(t)
	custom := "Waiting externally"
	if _, err := r.UpdateNode(UpdateNodeInput{CompanyID: company, NodeID: node.NodeID, Status: &custom, StatusSet: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: company, LogicGateID: gate.LogicGateID, NodeID: node.NodeID}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Assigning custom status requires a Process work status: %v", err)
	}
	_, err := r.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: company, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "Pending"})
	if err != nil {
		t.Fatal(err)
	}
	for _, status := range []*string{&custom, nil, stringPointer("Issue"), stringPointer("")} {
		if _, err := r.UpdateNode(UpdateNodeInput{CompanyID: company, NodeID: node.NodeID, Status: status, StatusSet: true}); !errors.Is(err, ErrInvalid) {
			t.Fatalf("Invalid assigned status accepted: %v", err)
		}
	}
	done := "done"
	updated, err := r.UpdateNode(UpdateNodeInput{CompanyID: company, NodeID: node.NodeID, Status: &done, StatusSet: true})
	if err != nil || nodeWorkStatus(updated) != "Done" {
		t.Fatalf("Canonical status: %+v %v", updated, err)
	}
	if _, err := r.RemoveLogicGateNodeAssignment(LogicGateNodeAssignmentRemoveInput{CompanyID: company, NodeID: node.NodeID, FallbackStatus: stringPointer("Issue")}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Issue cannot become Node status on removal: %v", err)
	}
}

func TestProcessStepsReorderPreservesRequester(t *testing.T) {
	r, company, gate, node := processStepsFixture(t)
	requester := "11111111-1111-4111-8111-111111111101"
	manager := "11111111-1111-4111-8111-111111111102"
	_, err := r.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: company, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "Requested", ActorUserID: requester})
	if err != nil {
		t.Fatal(err)
	}
	step, err := r.CreateProcessStep(ProcessStepCreateInput{CompanyID: company, LogicGateID: gate.LogicGateID, Name: "Review"})
	if err != nil {
		t.Fatal(err)
	}
	moved, err := r.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: company, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Position: 2000, ProcessStepID: &step.Step.ProcessStepID, ProcessStepIDSet: true, ActorUserID: manager})
	if err != nil || moved.Assignment.RequestedByUserID != requester || nodeWorkStatus(moved.Node) != "Requested" {
		t.Fatalf("Moving a request must preserve requester: %+v %v", moved, err)
	}
	accepted, err := r.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: company, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "Pending", ActorUserID: manager})
	if err != nil || accepted.Assignment.RequestedByUserID != "" {
		t.Fatalf("Accepting a request must clear requester metadata: %+v %v", accepted, err)
	}
}

func TestProcessStepsRecycleProcessRestoresExactFlow(t *testing.T) {
	r, company, gate, node := processStepsFixture(t)
	first, err := r.CreateProcessStep(ProcessStepCreateInput{CompanyID: company, LogicGateID: gate.LogicGateID, Name: "Prepare", BodyJSON: processStepSOPBody})
	if err != nil {
		t.Fatal(err)
	}
	second, err := r.CreateProcessStep(ProcessStepCreateInput{CompanyID: company, LogicGateID: gate.LogicGateID, Name: "Review", AfterProcessStepID: &first.Step.ProcessStepID})
	if err != nil {
		t.Fatal(err)
	}
	_, err = r.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: company, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "Pending", ProcessStepID: &second.Step.ProcessStepID, ProcessStepIDSet: true})
	if err != nil {
		t.Fatal(err)
	}
	actor := "22222222-2222-4222-8222-222222222222"
	if _, err = r.DeleteCompanyExplorerTargets(company, []CompanyExplorerDeleteTargetInput{{Kind: "logic_gate", ID: gate.LogicGateID}}, actor); err != nil {
		t.Fatal(err)
	}
	items, err := r.ListRecycleBinItems(company, actor)
	if err != nil || len(items) != 1 {
		t.Fatalf("Recycle: %+v %v", items, err)
	}
	if _, err = r.RestoreRecycleBinItems(company, actor, []string{items[0].RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}
	work, err := r.GetLogicGateWork(company, gate.LogicGateID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(work.Steps) != 2 || len(work.Relationships) != 1 || work.Relationships[0].ResourceOperationalRelationshipID != second.Relationship.ResourceOperationalRelationshipID || len(work.Nodes) != 1 || work.Nodes[0].ProcessStepID == nil || *work.Nodes[0].ProcessStepID != second.Step.ProcessStepID {
		t.Fatalf("Restore must preserve exact flow and assignment: %+v", work)
	}
	if !editorJSONValuesEqual(work.Steps[0].BodyJSON, processStepSOPBody) {
		t.Fatal("Process recycle/restore lost the step SOP")
	}
	if work.Steps[0].Revision <= first.Step.Revision {
		t.Fatal("Process restore must advance the step editor revision")
	}
}
