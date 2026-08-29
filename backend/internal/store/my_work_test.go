package store

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestMemoryMyWorkActionItemsUseExactPersonExcludeDoneAndPageByColorThenDate(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000001"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-action-user")
	other := mustCreateMyWorkMember(t, repo, companyID, "my-work-action-other")

	red := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Red later", ActionItemColorRed, "2026-09-02", ActionItemStatusInProgress)
	yellow := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Yellow first", ActionItemColorYellow, "2026-09-01", ActionItemStatusInProgress)
	missing := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "No color", "", "", ActionItemStatusInProgress)
	mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Done", ActionItemColorRed, "2026-08-01", "done")
	mustCreateAssignedActionItem(t, repo, companyID, other.UserID, "Someone else's", ActionItemColorRed, "2026-08-01", ActionItemStatusInProgress)

	first, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if first.ActionItems == nil || len(first.ActionItems.Items) != 2 || !first.ActionItems.HasMore || first.ActionItems.NextCursor == "" {
		t.Fatalf("first action page = %+v", first.ActionItems)
	}
	if first.ActionItems.Items[0].EntityID != red.EntityID || first.ActionItems.Items[1].EntityID != yellow.EntityID {
		t.Fatalf("first action IDs = %+v, want red then yellow", first.ActionItems.Items)
	}
	second, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Limit: 2, Cursor: first.ActionItems.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if second.ActionItems == nil || len(second.ActionItems.Items) != 1 || second.ActionItems.Items[0].EntityID != missing.EntityID || second.ActionItems.HasMore {
		t.Fatalf("second action page = %+v, want no-color item", second.ActionItems)
	}
	if second.ActionItems.Items[0].Color != nil || second.ActionItems.Items[0].CompletionDueDate != nil {
		t.Fatalf("missing action grouping values leaked as non-nil: %+v", second.ActionItems.Items[0])
	}
}

func TestMemoryMyWorkHistoryReturnsOnlyCompletedAssignedWorkNewestFirst(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000012"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-history-user")
	other := mustCreateMyWorkMember(t, repo, companyID, "my-work-history-other")
	firstDoneAt := time.Date(2026, time.August, 26, 9, 0, 0, 0, time.UTC)
	olderAt := time.Date(2026, time.August, 27, 10, 0, 0, 0, time.UTC)
	newerAt := time.Date(2026, time.August, 28, 11, 0, 0, 0, time.UTC)
	laterSameDoneUpdateAt := time.Date(2026, time.August, 29, 12, 0, 0, 0, time.UTC)

	olderAction := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Older completed action", ActionItemColorYellow, "2026-09-03", "done")
	newerAction := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Newer completed action", ActionItemColorRed, "2026-09-04", "done")
	mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Still active", "", "", ActionItemStatusInProgress)
	mustCreateAssignedActionItem(t, repo, companyID, other.UserID, "Other person's completed action", "", "", "done")
	setMemoryMyWorkActionCompletedAt(t, repo, olderAction, olderAt)
	setMemoryMyWorkActionCompletedAt(t, repo, newerAction, newerAt)

	first, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, History: true, Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if first.ActionItems == nil || len(first.ActionItems.Items) != 1 || first.ActionItems.Items[0].EntityID != newerAction.EntityID || !first.ActionItems.HasMore || first.ActionItems.NextCursor == "" {
		t.Fatalf("first Action Item history page = %+v", first.ActionItems)
	}
	if first.ActionItems.Items[0].CompletedTimestamp == nil || !first.ActionItems.Items[0].CompletedTimestamp.Equal(newerAt) || first.ActionItems.Items[0].CompletionDueDateFieldID == "" {
		t.Fatalf("newer Action Item history metadata = %+v", first.ActionItems.Items[0])
	}
	second, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, History: true, Limit: 1, Cursor: first.ActionItems.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if second.ActionItems == nil || len(second.ActionItems.Items) != 1 || second.ActionItems.Items[0].EntityID != olderAction.EntityID || second.ActionItems.HasMore {
		t.Fatalf("second Action Item history page = %+v", second.ActionItems)
	}

	gate, err := repo.CreateLogicGate(companyID, "History process")
	if err != nil {
		t.Fatal(err)
	}
	assignedNode, _, err := repo.CreateNodeWithWorkspaceEvent(companyID, "Assigned completed node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: assignedNode.NodeID, Status: "in progress"}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: assignedNode.NodeID, Status: "done"}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: assignedNode.NodeID, Status: "in progress"}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: assignedNode.NodeID, Status: "done"}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: assignedNode.NodeID, Status: "done", Position: 99}); err != nil {
		t.Fatal(err)
	}
	mustSetMyWorkDirectRACI(t, repo, companyID, EntityTypeNode, assignedNode.NodeID, user.UserID, domain.RACIRoleResponsible)
	setMemoryMyWorkNodeDoneSnapshotTimes(t, repo, assignedNode.NodeID, []time.Time{firstDoneAt, newerAt, laterSameDoneUpdateAt})

	rawNode, err := repo.CreateNode(companyID, "Legacy raw completed node")
	if err != nil {
		t.Fatal(err)
	}
	mustSetMyWorkDirectRACI(t, repo, companyID, EntityTypeNode, rawNode.NodeID, user.UserID, domain.RACIRoleResponsible)
	repo.mu.Lock()
	raw := repo.nodes[key(companyID, rawNode.NodeID)]
	raw.Status = stringPointer("done")
	raw.CreatedTimestamp = olderAt
	repo.nodes[key(companyID, rawNode.NodeID)] = raw
	repo.mu.Unlock()

	nodes, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, History: true})
	if err != nil {
		t.Fatal(err)
	}
	if nodes.Nodes == nil || len(nodes.Nodes.Items) != 2 || nodes.Nodes.Items[0].NodeID != assignedNode.NodeID || nodes.Nodes.Items[1].NodeID != rawNode.NodeID {
		t.Fatalf("Node history = %+v", nodes.Nodes)
	}
	if nodes.Nodes.Items[0].CompletedTimestamp == nil || !nodes.Nodes.Items[0].CompletedTimestamp.Equal(newerAt) {
		t.Fatalf("completed Node transition time = %+v, want %s despite later same-Done update", nodes.Nodes.Items[0], newerAt)
	}
	if nodes.Nodes.Items[1].CompletedTimestamp == nil || !nodes.Nodes.Items[1].CompletedTimestamp.Equal(olderAt) {
		t.Fatalf("raw Node created-time fallback = %+v", nodes.Nodes.Items[1])
	}
}

func TestMemoryMyWorkActionItemsUsePersonInChargeNotCreatorAndExposeNoContext(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000005"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-pic-user")
	other := mustCreateMyWorkMember(t, repo, companyID, "my-work-pic-other")
	mustCreateActionItemForPIC(t, repo, companyID, user.UserID, other.UserID, "Creator only", "", "", ActionItemStatusInProgress)
	assigned := mustCreateActionItemForPIC(t, repo, companyID, other.UserID, user.UserID, "Assigned only", "", "", ActionItemStatusInProgress)
	setMyWorkActionFieldRaw(t, repo, assigned, ActionItemPersonInChargeFieldTypeID, strings.ToUpper(user.UserID))

	response, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems})
	if err != nil {
		t.Fatal(err)
	}
	if response.ActionItems == nil || len(response.ActionItems.Items) != 1 || response.ActionItems.Items[0].EntityID != assigned.EntityID {
		t.Fatalf("action items = %+v, want exact PIC assignment only", response.ActionItems)
	}
	raw, err := json.Marshal(response.ActionItems.Items[0])
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"process", "project", "resource_type", "resource_id", "context"} {
		if _, exists := fields[forbidden]; exists {
			t.Fatalf("action item JSON leaked %q: %s", forbidden, raw)
		}
	}
}

func TestMemoryMyWorkActionItemPerspectivesUseExactPersonAndAssigner(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000013"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-perspective-user")
	other := mustCreateMyWorkMember(t, repo, companyID, "my-work-perspective-other")

	mine := mustCreateActionItemForPIC(t, repo, companyID, other.UserID, user.UserID, "Mine", ActionItemColorYellow, "2026-09-03", ActionItemStatusInProgress)
	setMyWorkActionField(t, repo, mine, ActionItemAssignedBySystemKey, other.UserID)
	selfAssigned := mustCreateActionItemForPIC(t, repo, companyID, user.UserID, user.UserID, "Self assigned", ActionItemColorRed, "2026-09-01", ActionItemStatusInProgress)
	setMyWorkActionField(t, repo, selfAssigned, ActionItemAssignedBySystemKey, user.UserID)
	delegated := mustCreateActionItemForPIC(t, repo, companyID, user.UserID, other.UserID, "Delegated", ActionItemColorRed, "2026-09-02", ActionItemStatusInProgress)
	setMyWorkActionField(t, repo, delegated, ActionItemAssignedBySystemKey, user.UserID)
	unassigned, err := repo.CreateActionItem(ActionItemInput{CompanyID: companyID, Name: "Unassigned", BodyText: "Unassigned", CreatedByUserID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	setMyWorkActionField(t, repo, unassigned, ActionItemAssignedBySystemKey, user.UserID)
	notDelegated := mustCreateActionItemForPIC(t, repo, companyID, other.UserID, other.UserID, "Assigned by other", "", "", ActionItemStatusInProgress)
	setMyWorkActionField(t, repo, notDelegated, ActionItemAssignedBySystemKey, other.UserID)
	doneDelegated := mustCreateActionItemForPIC(t, repo, companyID, user.UserID, other.UserID, "Done delegated", ActionItemColorRed, "2026-08-01", "done")
	setMyWorkActionField(t, repo, doneDelegated, ActionItemAssignedBySystemKey, user.UserID)

	mineResponse, err := repo.GetMyWork(context.Background(), MyWorkQuery{
		CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID,
		Section: MyWorkSectionActionItems,
	})
	if err != nil {
		t.Fatal(err)
	}
	if mineResponse.ActionItems == nil || mineResponse.ActionItems.Perspective != MyWorkActionItemPerspectiveMine {
		t.Fatalf("Mine page = %+v", mineResponse.ActionItems)
	}
	mineIDs := map[string]bool{}
	for _, item := range mineResponse.ActionItems.Items {
		mineIDs[item.EntityID] = true
	}
	if len(mineIDs) != 2 || !mineIDs[mine.EntityID] || !mineIDs[selfAssigned.EntityID] {
		t.Fatalf("Mine IDs = %+v, want exact PIC items including self-assignment", mineResponse.ActionItems.Items)
	}

	delegatedResponse, err := repo.GetMyWork(context.Background(), MyWorkQuery{
		CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID,
		Section: MyWorkSectionActionItems, Perspective: MyWorkActionItemPerspectiveDelegated,
	})
	if err != nil {
		t.Fatal(err)
	}
	if delegatedResponse.ActionItems == nil || delegatedResponse.ActionItems.Perspective != MyWorkActionItemPerspectiveDelegated ||
		len(delegatedResponse.ActionItems.Items) != 1 || delegatedResponse.ActionItems.Items[0].EntityID != delegated.EntityID {
		t.Fatalf("Delegated page = %+v, want exact non-self, nonnull delegated item", delegatedResponse.ActionItems)
	}
}

func TestMemoryMyWorkActionItemsPageByReorderedDescendingGrouping(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000009"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-action-grouping-user")
	red := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Red earliest", ActionItemColorRed, "2026-09-01", ActionItemStatusInProgress)
	redMiddle := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Red middle", ActionItemColorRed, "2026-09-02", ActionItemStatusInProgress)
	yellow := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Yellow later", ActionItemColorYellow, "2026-09-03", ActionItemStatusInProgress)
	missingDate := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Missing date", ActionItemColorRed, "", ActionItemStatusInProgress)
	grouping := "completion_due_date:desc,color:asc"

	first, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Grouping: grouping, Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if first.ActionItems == nil || len(first.ActionItems.Items) != 2 || first.ActionItems.Items[0].EntityID != yellow.EntityID || first.ActionItems.Items[1].EntityID != redMiddle.EntityID || !first.ActionItems.HasMore {
		t.Fatalf("first reordered action page = %+v", first.ActionItems)
	}
	second, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Grouping: grouping, Limit: 2, Cursor: first.ActionItems.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if second.ActionItems == nil || len(second.ActionItems.Items) != 2 || second.ActionItems.Items[0].EntityID != red.EntityID || second.ActionItems.Items[1].EntityID != missingDate.EntityID || second.ActionItems.HasMore {
		t.Fatalf("second reordered action page = %+v", second.ActionItems)
	}
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Limit: 2, Cursor: first.ActionItems.NextCursor}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-grouping cursor error = %v, want ErrInvalid", err)
	}
}

func TestMemoryMyWorkRACIInlineVisibilityAndCompletedExclusion(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000002"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-raci-user")
	parent, err := repo.CreateCompanyUserGroup(companyID, "", "Responsible parent")
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateCompanyUserGroup(companyID, parent.GroupID, "Responsible child")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, child.GroupID, []string{user.UserID}); err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(companyID, "Hidden process context")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, ActorUserID: user.UserID,
		Assignments: []ResourceRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: parent.GroupID}},
	}); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Visible assigned node")
	if err != nil {
		t.Fatal(err)
	}
	priority, due := 2, "2026-09-04"
	if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: node.NodeID, Priority: &priority, PrioritySet: true, DueDate: &due, DueDateSet: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "in progress", Priority: &priority, PrioritySet: true}); err != nil {
		t.Fatal(err)
	}
	mustSetMyWorkRACIInherited(t, repo, companyID, EntityTypeNode, node.NodeID)
	doneNode, err := repo.CreateNode(companyID, "Completed assigned node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: doneNode.NodeID, Status: "done"}); err != nil {
		t.Fatal(err)
	}
	mustSetMyWorkRACIInherited(t, repo, companyID, EntityTypeNode, doneNode.NodeID)
	repo.mu.Lock()
	doneRaw := repo.nodes[key(companyID, doneNode.NodeID)]
	doneRaw.Status = stringPointer("In Progress")
	repo.nodes[key(companyID, doneNode.NodeID)] = doneRaw
	repo.mu.Unlock()
	project, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Hidden project context", Status: "active", Health: "on_track"})
	if err != nil || project.Project == nil {
		t.Fatalf("CreateProject: %+v %v", project, err)
	}
	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{CompanyID: companyID, ProjectID: project.Project.ProjectID, ResourceType: EntityTypeNode, ResourceID: node.NodeID}); err != nil {
		t.Fatal(err)
	}
	setMyWorkDefaultAccess(t, repo, companyID, EntityTypeLogicGate, gate.LogicGateID, user.UserID, EntityPermissionNoAccess)
	setMyWorkDefaultAccess(t, repo, companyID, EntityTypeNode, node.NodeID, user.UserID, EntityPermissionEdit)
	setMyWorkDefaultAccess(t, repo, companyID, EntityTypeProject, project.Project.ProjectID, user.UserID, EntityPermissionNoAccess)
	effective, err := repo.ListResourceRACIEffectiveAssignments(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	if len(effective) != 1 || effective[0].UserID != user.UserID || effective[0].Role != domain.RACIRoleResponsible {
		t.Fatalf("effective node RACI = %+v", effective)
	}
	allowed, err := repo.UserHasEffectiveAccess(companyID, user.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit)
	if err != nil || !allowed {
		t.Fatalf("node access = %t err=%v", allowed, err)
	}

	response, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes})
	if err != nil {
		t.Fatal(err)
	}
	if response.Nodes == nil || len(response.Nodes.Items) != 1 || response.Nodes.Items[0].NodeID != node.NodeID {
		t.Fatalf("nodes = %+v, want visible active node only", response.Nodes)
	}
	if response.Nodes.Items[0].Process != nil || response.Nodes.Items[0].Project != nil {
		t.Fatalf("hidden inline context leaked: %+v", response.Nodes.Items[0])
	}
}

func TestMemoryMyWorkProcessesRoleAndNestedProjectTeamRemainPermissionFiltered(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000003"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-process-user")
	parent, err := repo.CreateCompanyUserGroup(companyID, "", "Project parent")
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateCompanyUserGroup(companyID, parent.GroupID, "Project child")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, child.GroupID, []string{user.UserID}); err != nil {
		t.Fatal(err)
	}
	grandchild, err := repo.CreateCompanyUserGroup(companyID, child.GroupID, "Project grandchild")
	if err != nil {
		t.Fatal(err)
	}
	sibling, err := repo.CreateCompanyUserGroup(companyID, parent.GroupID, "Project sibling")
	if err != nil {
		t.Fatal(err)
	}
	responsibleGate := mustCreateMyWorkGateWithRole(t, repo, companyID, user.UserID, "Responsible", domain.RACIRoleResponsible)
	accountableGate := mustCreateMyWorkGateWithRole(t, repo, companyID, user.UserID, "Accountable", domain.RACIRoleAccountable)
	visibleProject, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Visible nested team", Status: "active", Health: "on_track", TeamIDs: []string{parent.GroupID}, TeamIDsSet: true})
	if err != nil || visibleProject.Project == nil {
		t.Fatal(err)
	}
	hiddenProject, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Hidden nested team", Status: "active", Health: "on_track", TeamIDs: []string{parent.GroupID}, TeamIDsSet: true})
	if err != nil || hiddenProject.Project == nil {
		t.Fatal(err)
	}
	setMyWorkDefaultAccess(t, repo, companyID, EntityTypeProject, hiddenProject.Project.ProjectID, user.UserID, EntityPermissionNoAccess)
	if _, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Ancestor does not qualify", Status: "active", Health: "on_track", TeamIDs: []string{grandchild.GroupID}, TeamIDsSet: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Unrelated team", Status: "active", Health: "on_track", TeamIDs: []string{sibling.GroupID}, TeamIDsSet: true}); err != nil {
		t.Fatal(err)
	}

	responsible, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionProcesses})
	if err != nil {
		t.Fatal(err)
	}
	if responsible.Processes == nil || responsible.Processes.Role != domain.RACIRoleResponsible || len(responsible.Processes.Items) != 1 || responsible.Processes.Items[0].LogicGateID != responsibleGate.LogicGateID {
		t.Fatalf("responsible processes = %+v", responsible.Processes)
	}
	accountable, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionProcesses, Role: domain.RACIRoleAccountable})
	if err != nil {
		t.Fatal(err)
	}
	if accountable.Processes == nil || len(accountable.Processes.Items) != 1 || accountable.Processes.Items[0].LogicGateID != accountableGate.LogicGateID {
		t.Fatalf("accountable processes = %+v", accountable.Processes)
	}
	projects, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionProjects})
	if err != nil {
		t.Fatal(err)
	}
	if projects.Projects == nil || len(projects.Projects.Items) != 1 || projects.Projects.Items[0].ProjectID != visibleProject.Project.ProjectID {
		t.Fatalf("projects = %+v, want nested visible team project only", projects.Projects)
	}
}

func TestMemoryMyWorkUsesWinningRACIRole(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000006"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-winning-user")
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Winning group")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{user.UserID}); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Winning Responsible node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, ActorUserID: user.UserID,
		Assignments: []ResourceRACIAssignmentInput{
			{Role: domain.RACIRoleAccountable, PrincipalType: EntityPermissionSubjectUser, PrincipalID: user.UserID},
			{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID},
		},
	}); err != nil {
		t.Fatal(err)
	}
	response, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes})
	if err != nil {
		t.Fatal(err)
	}
	if response.Nodes == nil || len(response.Nodes.Items) != 1 || response.Nodes.Items[0].NodeID != node.NodeID {
		t.Fatalf("winning-role nodes = %+v", response.Nodes)
	}
}

func TestMemoryMyWorkNodesSelectIndependentEffectiveRACIRoles(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000014"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-node-role-user")
	wantByRole := map[string]string{}
	for _, role := range []string{
		domain.RACIRoleResponsible,
		domain.RACIRoleAccountable,
		domain.RACIRoleConsulted,
		domain.RACIRoleInformed,
	} {
		node, err := repo.CreateNode(companyID, role+" node")
		if err != nil {
			t.Fatal(err)
		}
		mustSetMyWorkDirectRACI(t, repo, companyID, EntityTypeNode, node.NodeID, user.UserID, role)
		wantByRole[role] = node.NodeID
	}

	for role, wantNodeID := range wantByRole {
		response, err := repo.GetMyWork(context.Background(), MyWorkQuery{
			CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID,
			Section: MyWorkSectionNodes, Role: role,
		})
		if err != nil {
			t.Fatalf("role %s: %v", role, err)
		}
		if response.Nodes == nil || response.Nodes.Role != role || len(response.Nodes.Items) != 1 || response.Nodes.Items[0].NodeID != wantNodeID {
			t.Fatalf("role %s nodes = %+v, want %s", role, response.Nodes, wantNodeID)
		}
	}
}

func TestMemoryMyWorkFiltersPermissionBeforeNodeLimit(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000007"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-limit-user")
	hidden, err := repo.CreateNode(companyID, "Hidden first")
	if err != nil {
		t.Fatal(err)
	}
	visible, err := repo.CreateNode(companyID, "Visible second")
	if err != nil {
		t.Fatal(err)
	}
	hiddenPriority, visiblePriority := 1, 2
	if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: hidden.NodeID, Priority: &hiddenPriority, PrioritySet: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: visible.NodeID, Priority: &visiblePriority, PrioritySet: true}); err != nil {
		t.Fatal(err)
	}
	mustSetMyWorkDirectRACI(t, repo, companyID, EntityTypeNode, hidden.NodeID, user.UserID, domain.RACIRoleResponsible)
	mustSetMyWorkDirectRACI(t, repo, companyID, EntityTypeNode, visible.NodeID, user.UserID, domain.RACIRoleResponsible)
	setMyWorkDefaultAccess(t, repo, companyID, EntityTypeNode, hidden.NodeID, user.UserID, EntityPermissionNoAccess)
	response, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if response.Nodes == nil || len(response.Nodes.Items) != 1 || response.Nodes.Items[0].NodeID != visible.NodeID || response.Nodes.HasMore || response.Nodes.NextCursor != "" {
		t.Fatalf("permission-filtered page = %+v, want only visible candidate with no next page", response.Nodes)
	}
}

func TestMemoryMyWorkNodesPageByReorderedDescendingGrouping(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000010"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-node-grouping-user")
	createNode := func(name string, priority *int, due *string) domain.Node {
		t.Helper()
		node, err := repo.CreateNode(companyID, name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: node.NodeID, Priority: priority, PrioritySet: true, DueDate: due, DueDateSet: true}); err != nil {
			t.Fatal(err)
		}
		mustSetMyWorkDirectRACI(t, repo, companyID, EntityTypeNode, node.NodeID, user.UserID, domain.RACIRoleResponsible)
		return node
	}
	priorityOne, priorityFive := 1, 5
	dueEarly, dueMiddle, dueLate := "2026-09-01", "2026-09-02", "2026-09-03"
	early := createNode("Early", &priorityOne, &dueEarly)
	middle := createNode("Middle", &priorityFive, &dueMiddle)
	late := createNode("Late", &priorityOne, &dueLate)
	missingDue := createNode("Missing due", &priorityOne, nil)
	grouping := "due_date:desc,priority:asc"

	first, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Grouping: grouping, Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if first.Nodes == nil || len(first.Nodes.Items) != 2 || first.Nodes.Items[0].NodeID != late.NodeID || first.Nodes.Items[1].NodeID != middle.NodeID || !first.Nodes.HasMore {
		t.Fatalf("first reordered node page = %+v", first.Nodes)
	}
	second, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Grouping: grouping, Limit: 2, Cursor: first.Nodes.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if second.Nodes == nil || len(second.Nodes.Items) != 2 || second.Nodes.Items[0].NodeID != early.NodeID || second.Nodes.Items[1].NodeID != missingDue.NodeID || second.Nodes.HasMore {
		t.Fatalf("second reordered node page = %+v", second.Nodes)
	}
}

func TestMyWorkQueryShapesAndCursorBinding(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000008"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-shape-user")
	all, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	if all.ActionItems == nil || all.Nodes == nil || all.Processes == nil || all.Projects == nil {
		t.Fatalf("initial response pointers = %+v", all)
	}
	nodes, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes})
	if err != nil {
		t.Fatal(err)
	}
	if nodes.Nodes == nil || nodes.ActionItems != nil || nodes.Processes != nil || nodes.Projects != nil {
		t.Fatalf("section response pointers = %+v", nodes)
	}
	resourceID := "40000000-0000-4000-8000-000000000001"
	nodeCursor := encodeMyWorkCursor(myWorkCursor{Section: MyWorkSectionNodes, Role: domain.RACIRoleResponsible, Grouping: MyWorkDefaultNodeGrouping, GroupInt: 1, Date: "2026-09-01", ResourceID: resourceID})
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionProjects, Cursor: nodeCursor}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-section cursor error = %v, want ErrInvalid", err)
	}
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Role: domain.RACIRoleAccountable, Cursor: nodeCursor}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-Node-role cursor error = %v, want ErrInvalid", err)
	}
	processCursor := encodeMyWorkCursor(myWorkCursor{Section: MyWorkSectionProcesses, Role: domain.RACIRoleResponsible, Name: "process", ResourceID: resourceID})
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionProcesses, Role: domain.RACIRoleAccountable, Cursor: processCursor}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-role cursor error = %v, want ErrInvalid", err)
	}
	actionCursor := encodeMyWorkCursor(myWorkCursor{
		Section: MyWorkSectionActionItems, Perspective: MyWorkActionItemPerspectiveDelegated,
		Grouping: MyWorkDefaultActionItemGrouping, GroupNull: true, GroupInt: 3, DateNull: true,
		ResourceID: resourceID,
	})
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Perspective: MyWorkActionItemPerspectiveMine, Cursor: actionCursor}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-perspective cursor error = %v, want ErrInvalid", err)
	}
	badDate := encodeMyWorkCursor(myWorkCursor{Section: MyWorkSectionNodes, Role: domain.RACIRoleResponsible, Grouping: MyWorkDefaultNodeGrouping, GroupInt: 1, Date: "not-a-date", ResourceID: resourceID})
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Cursor: badDate}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("malformed date cursor error = %v, want ErrInvalid", err)
	}
}

func TestMyWorkGroupingValidation(t *testing.T) {
	base := MyWorkQuery{CompanyID: "10000000-0000-4000-8000-000000000011", UserID: "20000000-0000-4000-8000-000000000011", ViewerUserID: "20000000-0000-4000-8000-000000000011", Section: MyWorkSectionActionItems}
	valid := []struct {
		raw       string
		canonical string
	}{
		{"", MyWorkDefaultActionItemGrouping},
		{"none", MyWorkGroupingNone},
		{" COMPLETION_DUE_DATE:DESC , COLOR:ASC ", "completion_due_date:desc,color:asc"},
	}
	for _, test := range valid {
		query := base
		query.Grouping = test.raw
		normalized, _, err := normalizeMyWorkQuery(query)
		if err != nil || normalized.Grouping != test.canonical {
			t.Errorf("grouping %q normalized to %q err=%v, want %q", test.raw, normalized.Grouping, err, test.canonical)
		}
	}
	for _, raw := range []string{"color", "color:up", "color:asc,color:desc", "priority:asc", "none,color:asc"} {
		query := base
		query.Grouping = raw
		if _, _, err := normalizeMyWorkQuery(query); !errors.Is(err, ErrInvalid) {
			t.Errorf("grouping %q error = %v, want ErrInvalid", raw, err)
		}
	}
}

func TestPostgresMyWorkQueriesKeepSubjectAndViewerResolutionSetBased(t *testing.T) {
	raw, err := os.ReadFile("postgres_my_work.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, forbidden := range []string{"mangorts_v2_effective_gvic_assignments", "mangorts_user_can_access_resource"} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("My Work PostgreSQL query must not call per-candidate helper %q", forbidden)
		}
	}
	for _, required := range []string{
		"subject_groups_raw(group_id,depth,path)",
		"viewer_groups_raw(group_id,depth,path)",
		"myWorkSubjectRACIWinnerCTEs",
		"myWorkPermissionAccessCTEs",
		"select distinct source_resource_type,source_resource_id",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("My Work PostgreSQL query missing set-based contract %q", required)
		}
	}
}

func TestMemoryMyWorkPermissionResolutionFailureReturnsNoPartialResponse(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000004"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-error-user")
	sentinel := errors.New("permission resolution failed")
	repo.mu.Lock()
	repo.effectiveAccessErr = sentinel
	repo.mu.Unlock()
	response, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID})
	if !errors.Is(err, sentinel) {
		t.Fatalf("error = %v, want %v", err, sentinel)
	}
	if response.ActionItems != nil || response.Nodes != nil || response.Processes != nil || response.Projects != nil {
		t.Fatalf("partial response returned on permission failure: %+v", response)
	}
}

func mustCreateMyWorkMember(t *testing.T, repo *MemoryRepo, companyID, subject string) domain.User {
	t.Helper()
	repo.EnsureCompany(companyID, "My Work Company")
	user, err := repo.UpsertAuthUser(subject, subject+"@example.com", subject)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	return user
}

func mustCreateAssignedActionItem(t *testing.T, repo *MemoryRepo, companyID, userID, name, color, due, status string) domain.Entity {
	t.Helper()
	return mustCreateActionItemForPIC(t, repo, companyID, userID, userID, name, color, due, status)
}

func mustCreateActionItemForPIC(t *testing.T, repo *MemoryRepo, companyID, creatorUserID, personInChargeUserID, name, color, due, status string) domain.Entity {
	t.Helper()
	item, err := repo.CreateActionItem(ActionItemInput{CompanyID: companyID, Name: name, BodyText: name, CreatedByUserID: creatorUserID})
	if err != nil {
		t.Fatal(err)
	}
	setMyWorkActionField(t, repo, item, ActionItemPersonInChargeSystemKey, personInChargeUserID)
	setMyWorkActionField(t, repo, item, ActionItemStatusSystemKey, status)
	if color != "" {
		setMyWorkActionField(t, repo, item, ActionItemColorSystemKey, color)
	}
	if due != "" {
		setMyWorkActionField(t, repo, item, ActionItemCompletionDueDateSystemKey, due)
	}
	return item
}

func mustSetMyWorkDirectRACI(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID, userID, role string) {
	t.Helper()
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID, ActorUserID: userID,
		Assignments: []ResourceRACIAssignmentInput{{Role: role, PrincipalType: EntityPermissionSubjectUser, PrincipalID: userID}},
	}); err != nil {
		t.Fatal(err)
	}
}

func setMyWorkActionField(t *testing.T, repo *MemoryRepo, item domain.Entity, systemKey string, value string) {
	t.Helper()
	current, err := repo.GetEntity(item.CompanyID, item.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range current.EntityFields {
		if field.SystemKey != systemKey {
			continue
		}
		raw, _ := json.Marshal(value)
		if _, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: item.CompanyID, EntityID: item.EntityID, EntityFieldID: field.EntityFieldID, Value: raw, ValueSet: true}); err != nil {
			t.Fatal(err)
		}
		return
	}
	t.Fatalf("action item field %q not found", systemKey)
}

func setMyWorkActionFieldRaw(t *testing.T, repo *MemoryRepo, item domain.Entity, fieldTypeID, value string) {
	t.Helper()
	raw, _ := json.Marshal(value)
	repo.mu.Lock()
	defer repo.mu.Unlock()
	for fieldKey, field := range repo.entityFields {
		if field.CompanyID == item.CompanyID && field.EntityID == item.EntityID && field.EntityFieldTypeID != nil && *field.EntityFieldTypeID == fieldTypeID {
			field.Value = raw
			repo.entityFields[fieldKey] = field
			return
		}
	}
	t.Fatalf("action item field type %q not found", fieldTypeID)
}

func setMemoryMyWorkActionCompletedAt(t *testing.T, repo *MemoryRepo, item domain.Entity, completedAt time.Time) {
	t.Helper()
	repo.mu.Lock()
	defer repo.mu.Unlock()
	for fieldKey, field := range repo.entityFields {
		if field.CompanyID == item.CompanyID && field.EntityID == item.EntityID && field.EntityFieldTypeID != nil && *field.EntityFieldTypeID == ActionItemStatusFieldTypeID {
			field.UpdatedTimestamp = completedAt
			repo.entityFields[fieldKey] = field
			return
		}
	}
	t.Fatalf("Action Item status field not found")
}

func setMemoryMyWorkNodeDoneSnapshotTimes(t *testing.T, repo *MemoryRepo, nodeID string, timestamps []time.Time) {
	t.Helper()
	repo.mu.Lock()
	defer repo.mu.Unlock()
	type snapshot struct {
		key   string
		event domain.DomainEvent
	}
	snapshots := make([]snapshot, 0, len(timestamps))
	for eventKey, event := range repo.domainEvents {
		node, ok := event.Payload["node"].(domain.Node)
		if !ok || node.NodeID != nodeID || !myWorkStatusDone(myWorkOptionalString(node.Status)) {
			continue
		}
		snapshots = append(snapshots, snapshot{key: eventKey, event: event})
	}
	sort.Slice(snapshots, func(i, j int) bool { return snapshots[i].event.Sequence < snapshots[j].event.Sequence })
	if len(snapshots) != len(timestamps) {
		t.Fatalf("completed Node snapshots = %d, want %d", len(snapshots), len(timestamps))
	}
	for index, snapshot := range snapshots {
		snapshot.event.CreatedTimestamp = timestamps[index]
		repo.domainEvents[snapshot.key] = snapshot.event
	}
}

func mustCreateMyWorkGateWithRole(t *testing.T, repo *MemoryRepo, companyID, userID, name, role string) domain.LogicGate {
	t.Helper()
	gate, err := repo.CreateLogicGate(companyID, name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, ActorUserID: userID,
		Assignments: []ResourceRACIAssignmentInput{{Role: role, PrincipalType: EntityPermissionSubjectUser, PrincipalID: userID}},
	}); err != nil {
		t.Fatal(err)
	}
	return gate
}

func setMyWorkDefaultAccess(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID, actorUserID, access string) {
	t.Helper()
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: resourceType, EntityID: resourceID,
		DefaultAccess: access, DefaultAccessSet: true, ActorUserID: actorUserID,
	}); err != nil {
		t.Fatal(err)
	}
}

func mustSetMyWorkRACIInherited(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID string) {
	t.Helper()
	current, err := repo.GetResourceRACIPolicy(companyID, resourceType, resourceID)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID,
		AssignmentMode: PolicyModeInherited, DescendantAction: PolicyDescendantActionInheritedOnly,
		ExpectedRevision: current.Revision,
	}); err != nil {
		t.Fatal(err)
	}
}
