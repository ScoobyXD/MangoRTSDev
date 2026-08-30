package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestPostgresMyWorkNodeHistoryUsesLatestDoneTransitionNotLaterDoneUpdate(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Postgres My Work Node completion order")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("postgres-my-work-node-completion", "postgres-my-work-node-completion@example.test", "Node completion")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(company.CompanyID, "Completion process")
	if err != nil {
		t.Fatal(err)
	}

	assign := func(nodeID, status string, position int) LogicGateNodeAssignmentResult {
		t.Helper()
		result, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
			CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, NodeID: nodeID, Status: status, Position: position,
		})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	makeResponsible := func(nodeID string) {
		t.Helper()
		if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
			CompanyID: company.CompanyID, ResourceType: EntityTypeNode, ResourceID: nodeID, ActorUserID: user.UserID,
			Assignments: []ResourceRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: user.UserID}},
		}); err != nil {
			t.Fatal(err)
		}
	}
	nodeEventTime := func(result LogicGateNodeAssignmentResult) time.Time {
		t.Helper()
		for _, event := range result.Events {
			if event.Type == "node_updated" {
				return event.CreatedTimestamp
			}
		}
		t.Fatal("assignment result did not include a Node snapshot event")
		return time.Time{}
	}
	assertTransition := func(nodeID string, want *time.Time) {
		t.Helper()
		var got sql.NullTime
		if err := db.QueryRow(`select completion_transition_timestamp from nodes where company_id=$1::uuid and node_id=$2::uuid`, company.CompanyID, nodeID).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if want == nil {
			if got.Valid {
				t.Fatalf("Node %s completion transition = %s, want null", nodeID, got.Time)
			}
			return
		}
		if !got.Valid || !got.Time.Equal(*want) {
			t.Fatalf("Node %s completion transition = %v, want %s", nodeID, got, *want)
		}
	}

	older, err := repo.CreateNode(company.CompanyID, "Older completion")
	if err != nil {
		t.Fatal(err)
	}
	makeResponsible(older.NodeID)
	assign(older.NodeID, "in progress", 1)
	firstOlderDone := assign(older.NodeID, "done", 1)
	firstOlderDoneAt := nodeEventTime(firstOlderDone)
	assertTransition(older.NodeID, &firstOlderDoneAt)
	staleCompletionInput := nodeUpdatedWorkspaceEventInput(firstOlderDone.Node)
	staleCompletionInput.IdempotencyKey = "postgres-my-work-stale-completion"
	if _, err := repo.AppendDomainEvent(staleCompletionInput); err != nil {
		t.Fatal(err)
	}
	laterFirstDoneUpdate := assign(older.NodeID, "done", 99)
	nodeEventTime(laterFirstDoneUpdate)
	assertTransition(older.NodeID, &firstOlderDoneAt)
	assign(older.NodeID, "in progress", 1)
	assertTransition(older.NodeID, nil)
	if _, err := repo.AppendDomainEvent(staleCompletionInput); err != nil {
		t.Fatal(err)
	}
	assertTransition(older.NodeID, nil)
	reopenedHistory, err := repo.GetMyWork(context.Background(), MyWorkQuery{
		CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, History: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if reopenedHistory.Nodes == nil || len(reopenedHistory.Nodes.Items) != 0 {
		t.Fatalf("reopened Node remained in History: %+v", reopenedHistory.Nodes)
	}
	latestOlderDone := assign(older.NodeID, "done", 1)
	olderDoneAt := nodeEventTime(latestOlderDone)
	assertTransition(older.NodeID, &olderDoneAt)

	newer, err := repo.CreateNode(company.CompanyID, "Newer completion")
	if err != nil {
		t.Fatal(err)
	}
	makeResponsible(newer.NodeID)
	assign(newer.NodeID, "in progress", 1)
	newerDone := assign(newer.NodeID, "done", 1)
	newerDoneAt := nodeEventTime(newerDone)
	assertTransition(newer.NodeID, &newerDoneAt)

	fixedOlderDoneAt := newerDoneAt.Add(-time.Hour)
	if _, err := db.Exec(`update nodes set completion_transition_timestamp=$3 where company_id=$1::uuid and node_id=$2::uuid`, company.CompanyID, older.NodeID, fixedOlderDoneAt); err != nil {
		t.Fatal(err)
	}
	assertTransition(older.NodeID, &fixedOlderDoneAt)
	laterOlderUpdate := assign(older.NodeID, "done", 100)
	nodeEventTime(laterOlderUpdate)
	assertTransition(older.NodeID, &fixedOlderDoneAt)

	history, err := repo.GetMyWork(context.Background(), MyWorkQuery{
		CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, History: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if history.Nodes == nil || len(history.Nodes.Items) != 2 || history.Nodes.Items[0].NodeID != newer.NodeID || history.Nodes.Items[1].NodeID != older.NodeID {
		t.Fatalf("Node History order = %+v, want newer true completion before later-updated older completion", history.Nodes)
	}
	if history.Nodes.Items[0].CompletedTimestamp == nil || !history.Nodes.Items[0].CompletedTimestamp.Equal(newerDoneAt) || history.Nodes.Items[1].CompletedTimestamp == nil || !history.Nodes.Items[1].CompletedTimestamp.Equal(fixedOlderDoneAt) {
		t.Fatalf("Node History completion timestamps = %+v, want %s then %s", history.Nodes.Items, newerDoneAt, fixedOlderDoneAt)
	}
}

func TestPostgresMyWorkNodeCompletionTransitionMigrationBackfillsProjection(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Postgres My Work completion migration")
	if err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(company.CompanyID, "Completion migration process")
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(company.CompanyID, "Completion migration Node")
	if err != nil {
		t.Fatal(err)
	}
	assign := func(status string) LogicGateNodeAssignmentResult {
		t.Helper()
		result, assignErr := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
			CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: status,
		})
		if assignErr != nil {
			t.Fatal(assignErr)
		}
		return result
	}
	nodeEventTime := func(result LogicGateNodeAssignmentResult) time.Time {
		t.Helper()
		for _, event := range result.Events {
			if event.Type == "node_updated" {
				return event.CreatedTimestamp
			}
		}
		t.Fatal("assignment result did not include a Node snapshot event")
		return time.Time{}
	}
	assertTransition := func(want *time.Time) {
		t.Helper()
		var got sql.NullTime
		if scanErr := db.QueryRow(`select completion_transition_timestamp from nodes where company_id=$1::uuid and node_id=$2::uuid`, company.CompanyID, node.NodeID).Scan(&got); scanErr != nil {
			t.Fatal(scanErr)
		}
		if want == nil {
			if got.Valid {
				t.Fatalf("completion transition = %s, want null", got.Time)
			}
			return
		}
		if !got.Valid || !got.Time.Equal(*want) {
			t.Fatalf("completion transition = %v, want %s", got, *want)
		}
	}

	assign("in progress")
	doneAt := nodeEventTime(assign("done"))
	if _, err := db.Exec(`update nodes set completion_transition_timestamp=null where company_id=$1::uuid and node_id=$2::uuid`, company.CompanyID, node.NodeID); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260829_my_work_node_completion_transition.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatal(err)
	}
	assertTransition(&doneAt)

	var beforeReplayXID, afterReplayXID string
	if err := db.QueryRow(`select xmin::text from nodes where company_id=$1::uuid and node_id=$2::uuid`, company.CompanyID, node.NodeID).Scan(&beforeReplayXID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select xmin::text from nodes where company_id=$1::uuid and node_id=$2::uuid`, company.CompanyID, node.NodeID).Scan(&afterReplayXID); err != nil {
		t.Fatal(err)
	}
	if afterReplayXID != beforeReplayXID {
		t.Fatalf("idempotent backfill rewrote the Node row: xmin %s -> %s", beforeReplayXID, afterReplayXID)
	}

	assign("in progress")
	if _, err := db.Exec(`update nodes set completion_transition_timestamp=$3 where company_id=$1::uuid and node_id=$2::uuid`, company.CompanyID, node.NodeID, doneAt); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatal(err)
	}
	assertTransition(nil)
}

func TestPostgresMyWorkAndStaleRACIQueriesExecuteAgainstCanonicalSchema(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Postgres My Work")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("postgres-my-work-user", "postgres-my-work@example.test", "Postgres My Work")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	other, err := repo.UpsertAuthUser("postgres-my-work-other", "postgres-my-work-other@example.test", "Postgres My Work Other")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(other.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}

	gate, err := repo.CreateLogicGate(company.CompanyID, "Postgres Process")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, ActorUserID: user.UserID,
		Assignments: []ResourceRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: user.UserID}},
	}); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(company.CompanyID, "Postgres active node")
	if err != nil {
		t.Fatal(err)
	}
	priority := 2
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "in progress", Priority: &priority, PrioritySet: true}); err != nil {
		t.Fatal(err)
	}
	mustSetPostgresMyWorkRACIInherited(t, repo, company.CompanyID, EntityTypeNode, node.NodeID)
	doneNode, err := repo.CreateNode(company.CompanyID, "Postgres completed node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, NodeID: doneNode.NodeID, Status: "done"}); err != nil {
		t.Fatal(err)
	}
	mustSetPostgresMyWorkRACIInherited(t, repo, company.CompanyID, EntityTypeNode, doneNode.NodeID)
	if _, err := db.Exec(`update nodes set status='In Progress' where company_id=$1::uuid and node_id=$2::uuid`, company.CompanyID, doneNode.NodeID); err != nil {
		t.Fatal(err)
	}

	actionItem, err := repo.CreateActionItem(ActionItemInput{CompanyID: company.CompanyID, Name: "Uppercase PIC", BodyText: "Uppercase PIC", CreatedByUserID: other.UserID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
update entity_fields
set value_jsonb=to_jsonb($3::text)
where company_id=$1::uuid and entity_id=$2::uuid and entity_field_type_id=$4::uuid`,
		company.CompanyID, actionItem.EntityID, strings.ToUpper(user.UserID), ActionItemPersonInChargeFieldTypeID); err != nil {
		t.Fatal(err)
	}
	completedAction := mustCreatePostgresMyWorkActionItem(t, repo, company.CompanyID, user.UserID, "Postgres completed action", ActionItemColorYellow, "2026-09-05")
	mustSetPostgresMyWorkActionField(t, repo, completedAction, ActionItemStatusSystemKey, "done")

	parent, err := repo.CreateCompanyUserGroup(company.CompanyID, "", "Postgres Team Parent")
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateCompanyUserGroup(company.CompanyID, parent.GroupID, "Postgres Team Child")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(company.CompanyID, child.GroupID, []string{user.UserID}); err != nil {
		t.Fatal(err)
	}
	projectResult, err := repo.CreateProject(ProjectInput{CompanyID: company.CompanyID, Name: "Postgres nested team project", Status: "active", Health: "on_track", TeamIDs: []string{parent.GroupID}, TeamIDsSet: true, ActorUserID: user.UserID})
	if err != nil || projectResult.Project == nil {
		t.Fatalf("CreateProject = %+v err=%v", projectResult, err)
	}

	response, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	if response.ActionItems == nil || len(response.ActionItems.Items) != 1 || response.ActionItems.Items[0].EntityID != actionItem.EntityID {
		t.Fatalf("Postgres action items = %+v", response.ActionItems)
	}
	if response.Nodes == nil || len(response.Nodes.Items) != 1 || response.Nodes.Items[0].NodeID != node.NodeID {
		t.Fatalf("Postgres nodes = %+v, want active node only", response.Nodes)
	}
	if response.Processes == nil || len(response.Processes.Items) != 1 || response.Processes.Items[0].LogicGateID != gate.LogicGateID {
		t.Fatalf("Postgres processes = %+v", response.Processes)
	}
	if counts := response.Processes.Items[0].StatusCounts; counts != (domain.RACITabStatusCounts{InProgress: 1}) {
		t.Fatalf("Postgres process counts = %+v, want only the active In Progress Node", counts)
	}
	if response.Projects == nil || len(response.Projects.Items) != 1 || response.Projects.Items[0].ProjectID != projectResult.Project.ProjectID {
		t.Fatalf("Postgres projects = %+v", response.Projects)
	}
	historyActions, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, History: true})
	if err != nil {
		t.Fatal(err)
	}
	if historyActions.ActionItems == nil || len(historyActions.ActionItems.Items) != 1 || historyActions.ActionItems.Items[0].EntityID != completedAction.EntityID || historyActions.ActionItems.Items[0].CompletedTimestamp == nil || historyActions.ActionItems.Items[0].CompletionDueDateFieldID == "" {
		t.Fatalf("Postgres Action Item history = %+v", historyActions.ActionItems)
	}
	historyNodes, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, History: true})
	if err != nil {
		t.Fatal(err)
	}
	if historyNodes.Nodes == nil || len(historyNodes.Nodes.Items) != 1 || historyNodes.Nodes.Items[0].NodeID != doneNode.NodeID || historyNodes.Nodes.Items[0].CompletedTimestamp == nil {
		t.Fatalf("Postgres Node history = %+v", historyNodes.Nodes)
	}

	hiddenCandidate, err := repo.CreateNode(company.CompanyID, "Hidden candidate sorts first")
	if err != nil {
		t.Fatal(err)
	}
	hiddenPriority := 1
	if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: company.CompanyID, NodeID: hiddenCandidate.NodeID, Priority: &hiddenPriority, PrioritySet: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: company.CompanyID, ResourceType: EntityTypeNode, ResourceID: hiddenCandidate.NodeID, ActorUserID: user.UserID,
		Assignments: []ResourceRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: user.UserID}},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{CompanyID: company.CompanyID, EntityType: EntityTypeNode, EntityID: hiddenCandidate.NodeID, DefaultAccess: EntityPermissionNoAccess, DefaultAccessSet: true, ActorUserID: user.UserID}); err != nil {
		t.Fatal(err)
	}
	hiddenContextProject, err := repo.CreateProject(ProjectInput{CompanyID: company.CompanyID, Name: "Hidden inline project", Status: "active", Health: "on_track", ActorUserID: user.UserID})
	if err != nil || hiddenContextProject.Project == nil {
		t.Fatalf("CreateProject hidden context = %+v err=%v", hiddenContextProject, err)
	}
	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{CompanyID: company.CompanyID, ProjectID: hiddenContextProject.Project.ProjectID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, ActorUserID: user.UserID}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{CompanyID: company.CompanyID, EntityType: EntityTypeProject, EntityID: hiddenContextProject.Project.ProjectID, DefaultAccess: EntityPermissionNoAccess, DefaultAccessSet: true, ActorUserID: user.UserID}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{CompanyID: company.CompanyID, EntityType: EntityTypeLogicGate, EntityID: gate.LogicGateID, DefaultAccess: EntityPermissionNoAccess, DefaultAccessSet: true, ActorUserID: user.UserID}); err != nil {
		t.Fatal(err)
	}
	permissionPage, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if permissionPage.Nodes == nil || len(permissionPage.Nodes.Items) != 1 || permissionPage.Nodes.Items[0].NodeID != node.NodeID || permissionPage.Nodes.HasMore || permissionPage.Nodes.NextCursor != "" {
		t.Fatalf("permission-before-limit Postgres page = %+v", permissionPage.Nodes)
	}
	if permissionPage.Nodes.Items[0].Process != nil || permissionPage.Nodes.Items[0].Project != nil {
		t.Fatalf("hidden Postgres inline context leaked: %+v", permissionPage.Nodes.Items[0])
	}

	legacyNodes, err := repo.ListResponsibleInboxNodes(WorkItemInboxQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Limit: 20})
	if err != nil {
		t.Fatalf("stale responsible inbox SQL did not execute: %v", err)
	}
	if !postgresMyWorkContainsNode(legacyNodes, node.NodeID) {
		t.Fatalf("legacy responsible nodes = %+v", legacyNodes)
	}
	projectionRows, err := repo.ListRACIMatrixProjectionRowsForUser(WorkItemInboxQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Limit: 20})
	if err != nil {
		t.Fatalf("stale RACI projection SQL did not execute: %v", err)
	}
	if len(projectionRows) == 0 {
		t.Fatal("stale RACI projection query returned no rows")
	}
}

func TestPostgresMyWorkNamedKeysetUsesExactDatabaseSortKey(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Postgres My Work Cursor")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("postgres-my-work-cursor", "postgres-my-work-cursor@example.test", "Cursor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	gateIDs := map[string]bool{}
	for index := 0; index < 2; index++ {
		gate, err := repo.CreateLogicGate(company.CompanyID, "Éclair")
		if err != nil {
			t.Fatal(err)
		}
		gateIDs[gate.LogicGateID] = true
		if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
			CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, ActorUserID: user.UserID,
			Assignments: []ResourceRACIAssignmentInput{{Role: domain.RACIRoleAccountable, PrincipalType: EntityPermissionSubjectUser, PrincipalID: user.UserID}},
		}); err != nil {
			t.Fatal(err)
		}
	}
	first, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionProcesses, Role: domain.RACIRoleAccountable, Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if first.Processes == nil || len(first.Processes.Items) != 1 || !first.Processes.HasMore || first.Processes.NextCursor == "" {
		t.Fatalf("first process page = %+v", first.Processes)
	}
	delete(gateIDs, first.Processes.Items[0].LogicGateID)
	second, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionProcesses, Role: domain.RACIRoleAccountable, Limit: 1, Cursor: first.Processes.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if second.Processes == nil || len(second.Processes.Items) != 1 || second.Processes.HasMore || !gateIDs[second.Processes.Items[0].LogicGateID] {
		t.Fatalf("second process page = %+v remaining=%v", second.Processes, gateIDs)
	}
}

func TestPostgresMyWorkGroupingKeysetsExecuteAcrossPages(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Postgres My Work Grouping")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("postgres-my-work-grouping", "postgres-my-work-grouping@example.test", "Grouping")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	red := mustCreatePostgresMyWorkActionItem(t, repo, company.CompanyID, user.UserID, "Red", ActionItemColorRed, "2026-09-01")
	redMiddle := mustCreatePostgresMyWorkActionItem(t, repo, company.CompanyID, user.UserID, "Red middle", ActionItemColorRed, "2026-09-02")
	yellow := mustCreatePostgresMyWorkActionItem(t, repo, company.CompanyID, user.UserID, "Yellow", ActionItemColorYellow, "2026-09-03")
	noColor := mustCreatePostgresMyWorkActionItem(t, repo, company.CompanyID, user.UserID, "No color or date", "", "")
	grouping := "completion_due_date:desc,color:asc"

	first, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Grouping: grouping, Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if first.ActionItems == nil || len(first.ActionItems.Items) != 2 || first.ActionItems.Items[0].EntityID != yellow.EntityID || first.ActionItems.Items[1].EntityID != redMiddle.EntityID || !first.ActionItems.HasMore {
		t.Fatalf("first Postgres grouped page = %+v", first.ActionItems)
	}
	second, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Grouping: grouping, Limit: 2, Cursor: first.ActionItems.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if second.ActionItems == nil || len(second.ActionItems.Items) != 2 || second.ActionItems.Items[0].EntityID != red.EntityID || second.ActionItems.Items[1].EntityID != noColor.EntityID || second.ActionItems.HasMore {
		t.Fatalf("second Postgres grouped page = %+v", second.ActionItems)
	}

	colorFirst, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Grouping: "color:desc", Limit: 3})
	if err != nil {
		t.Fatal(err)
	}
	if colorFirst.ActionItems == nil || len(colorFirst.ActionItems.Items) != 3 || colorFirst.ActionItems.Items[0].EntityID != yellow.EntityID || !postgresMyWorkActionIDsEqual(colorFirst.ActionItems.Items[1:], red.EntityID, redMiddle.EntityID) || !colorFirst.ActionItems.HasMore {
		t.Fatalf("single-field Postgres grouped page = %+v", colorFirst.ActionItems)
	}
	colorLast, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Grouping: "color:desc", Limit: 3, Cursor: colorFirst.ActionItems.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if colorLast.ActionItems == nil || len(colorLast.ActionItems.Items) != 1 || colorLast.ActionItems.Items[0].EntityID != noColor.EntityID || colorLast.ActionItems.HasMore {
		t.Fatalf("single-field missing-last Postgres page = %+v", colorLast.ActionItems)
	}
}

func TestPostgresMyWorkHuddleProcessGroupingAndSourcePermissionExecute(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Postgres My Work Huddle grouping")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("postgres-my-work-huddle-grouping", "postgres-my-work-huddle-grouping@example.test", "Huddle Grouping")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	alpha, err := repo.CreateHuddleLogicGate(HuddleCreateInput{CompanyID: company.CompanyID, Name: "Alpha Process"})
	if err != nil {
		t.Fatal(err)
	}
	zulu, err := repo.CreateHuddleLogicGate(HuddleCreateInput{CompanyID: company.CompanyID, Name: "Zulu Process"})
	if err != nil {
		t.Fatal(err)
	}
	alphaNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: alpha.HuddleLogicGateID, Name: "Alpha Node"})
	if err != nil {
		t.Fatal(err)
	}
	zuluNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: zulu.HuddleLogicGateID, Name: "Zulu Node"})
	if err != nil {
		t.Fatal(err)
	}
	alphaItem := mustCreatePostgresSourcedMyWorkActionItem(t, repo, company.CompanyID, user.UserID, "Alpha", EntityTypeHuddleNode, alphaNode.HuddleNodeID, "2026-09-01")
	zuluItem := mustCreatePostgresSourcedMyWorkActionItem(t, repo, company.CompanyID, user.UserID, "Zulu", EntityTypeHuddleNode, zuluNode.HuddleNodeID, "2026-09-01")
	neutralItem := mustCreatePostgresMyWorkActionItem(t, repo, company.CompanyID, user.UserID, "Neutral", ActionItemColorRed, "2026-09-01")

	query := MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Limit: 2}
	first, err := repo.GetMyWork(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	if first.ActionItems == nil || len(first.ActionItems.Items) != 2 || !first.ActionItems.HasMore || first.ActionItems.Items[0].EntityID != alphaItem.EntityID || first.ActionItems.Items[1].EntityID != zuluItem.EntityID {
		t.Fatalf("first Postgres Huddle page = %+v", first.ActionItems)
	}
	if first.ActionItems.Items[0].Source == nil || first.ActionItems.Items[0].Source.ResourceID != alphaNode.HuddleNodeID || first.ActionItems.Items[0].HuddleProcess == nil || first.ActionItems.Items[0].HuddleProcess.HuddleLogicGateID != alpha.HuddleLogicGateID {
		t.Fatalf("Postgres Huddle context = %+v", first.ActionItems.Items[0])
	}
	query.Cursor = first.ActionItems.NextCursor
	second, err := repo.GetMyWork(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	if second.ActionItems == nil || len(second.ActionItems.Items) != 1 || second.ActionItems.Items[0].EntityID != neutralItem.EntityID || second.ActionItems.Items[0].HuddleProcess != nil {
		t.Fatalf("second Postgres Huddle page = %+v", second.ActionItems)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: company.CompanyID, EntityType: EntityTypeHuddleNode, EntityID: alphaNode.HuddleNodeID,
		DefaultAccess: EntityPermissionNoAccess, DefaultAccessSet: true, ActorUserID: user.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	hidden, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range hidden.ActionItems.Items {
		if item.EntityID == alphaItem.EntityID && (item.Source != nil || item.HuddleProcess != nil) {
			t.Fatalf("Postgres hidden source leaked Huddle context: %+v", item)
		}
	}
}

func TestPostgresMyWorkDelegatedPersonGroupingPagesByAuthoritativeNameAndUser(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Postgres My Work Delegated Person Grouping")
	if err != nil {
		t.Fatal(err)
	}
	createMember := func(subject, displayName string) domain.User {
		t.Helper()
		user, err := repo.UpsertAuthUser(subject, subject+"@example.test", displayName)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
			t.Fatal(err)
		}
		return user
	}
	delegator := createMember("postgres-my-work-delegated-person-owner", "Delegator")
	alphaFirst := createMember("postgres-my-work-delegated-person-alpha-first", "alpha")
	alphaSecond := createMember("postgres-my-work-delegated-person-alpha-second", "ALPHA")
	zulu := createMember("postgres-my-work-delegated-person-zulu", "Zulu")
	if _, err := db.Exec(`update users set display_name='  alpha  ' where user_id=$1::uuid`, alphaFirst.UserID); err != nil {
		t.Fatal(err)
	}

	alphaFirstOne := mustCreatePostgresMyWorkDelegatedActionItem(t, repo, company.CompanyID, delegator.UserID, alphaFirst.UserID, "Alpha first one", ActionItemColorRed, "2026-09-01")
	alphaFirstTwo := mustCreatePostgresMyWorkDelegatedActionItem(t, repo, company.CompanyID, delegator.UserID, alphaFirst.UserID, "Alpha first two", ActionItemColorRed, "2026-09-01")
	alphaSecondItem := mustCreatePostgresMyWorkDelegatedActionItem(t, repo, company.CompanyID, delegator.UserID, alphaSecond.UserID, "Alpha second", ActionItemColorRed, "2026-09-01")
	zuluItem := mustCreatePostgresMyWorkDelegatedActionItem(t, repo, company.CompanyID, delegator.UserID, zulu.UserID, "Zulu", ActionItemColorRed, "2026-09-01")

	query := MyWorkQuery{
		CompanyID: company.CompanyID, UserID: delegator.UserID, ViewerUserID: delegator.UserID,
		Section: MyWorkSectionActionItems, Perspective: MyWorkActionItemPerspectiveDelegated, Limit: 2,
	}
	first, err := repo.GetMyWork(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	if first.ActionItems == nil || len(first.ActionItems.Items) != 2 || !first.ActionItems.HasMore || first.ActionItems.NextCursor == "" ||
		first.ActionItems.Items[0].EntityID != alphaFirstOne.EntityID || first.ActionItems.Items[1].EntityID != alphaFirstTwo.EntityID {
		t.Fatalf("first ascending Postgres delegated page = %+v", first.ActionItems)
	}
	for _, item := range first.ActionItems.Items {
		if item.PersonInChargeUserID != alphaFirst.UserID || item.PersonInChargeName != "alpha" {
			t.Fatalf("first ascending Postgres delegated identity = %+v", item)
		}
	}
	query.Cursor = first.ActionItems.NextCursor
	second, err := repo.GetMyWork(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	if second.ActionItems == nil || len(second.ActionItems.Items) != 2 || second.ActionItems.HasMore ||
		second.ActionItems.Items[0].EntityID != alphaSecondItem.EntityID || second.ActionItems.Items[1].EntityID != zuluItem.EntityID ||
		second.ActionItems.Items[0].PersonInChargeUserID != alphaSecond.UserID || second.ActionItems.Items[0].PersonInChargeName != "ALPHA" ||
		second.ActionItems.Items[1].PersonInChargeUserID != zulu.UserID || second.ActionItems.Items[1].PersonInChargeName != "Zulu" {
		t.Fatalf("second ascending Postgres delegated page = %+v", second.ActionItems)
	}

	descendingQuery := MyWorkQuery{
		CompanyID: company.CompanyID, UserID: delegator.UserID, ViewerUserID: delegator.UserID,
		Section: MyWorkSectionActionItems, Perspective: MyWorkActionItemPerspectiveDelegated,
		Grouping: MyWorkDefaultDelegatedActionItemGrouping, Ordering: "person_in_charge:desc", Limit: 2,
	}
	descendingFirst, err := repo.GetMyWork(context.Background(), descendingQuery)
	if err != nil {
		t.Fatal(err)
	}
	if descendingFirst.ActionItems == nil || len(descendingFirst.ActionItems.Items) != 2 || !descendingFirst.ActionItems.HasMore ||
		descendingFirst.ActionItems.Items[0].EntityID != zuluItem.EntityID || descendingFirst.ActionItems.Items[1].EntityID != alphaSecondItem.EntityID {
		t.Fatalf("first descending Postgres delegated page = %+v", descendingFirst.ActionItems)
	}
	descendingQuery.Cursor = descendingFirst.ActionItems.NextCursor
	descendingSecond, err := repo.GetMyWork(context.Background(), descendingQuery)
	if err != nil {
		t.Fatal(err)
	}
	if descendingSecond.ActionItems == nil || len(descendingSecond.ActionItems.Items) != 2 || descendingSecond.ActionItems.HasMore ||
		descendingSecond.ActionItems.Items[0].EntityID != alphaFirstOne.EntityID || descendingSecond.ActionItems.Items[1].EntityID != alphaFirstTwo.EntityID {
		t.Fatalf("second descending Postgres delegated page = %+v", descendingSecond.ActionItems)
	}

	eAcute := createMember("postgres-my-work-delegated-person-e-acute", "Éclair")
	eCircumflex := createMember("postgres-my-work-delegated-person-e-circumflex", "Êclair")
	eAcuteItem := mustCreatePostgresMyWorkDelegatedActionItem(t, repo, company.CompanyID, delegator.UserID, eAcute.UserID, "E acute", ActionItemColorYellow, "2026-09-01")
	eCircumflexItem := mustCreatePostgresMyWorkDelegatedActionItem(t, repo, company.CompanyID, delegator.UserID, eCircumflex.UserID, "E circumflex", ActionItemColorYellow, "2026-09-01")
	unicodeQuery := MyWorkQuery{
		CompanyID: company.CompanyID, UserID: delegator.UserID, ViewerUserID: delegator.UserID,
		Section: MyWorkSectionActionItems, Perspective: MyWorkActionItemPerspectiveDelegated,
		Grouping: "color:desc", Ordering: "person_in_charge:asc", Limit: 1,
	}
	unicodeFirst, err := repo.GetMyWork(context.Background(), unicodeQuery)
	if err != nil {
		t.Fatal(err)
	}
	if unicodeFirst.ActionItems == nil || len(unicodeFirst.ActionItems.Items) != 1 || !unicodeFirst.ActionItems.HasMore ||
		unicodeFirst.ActionItems.Items[0].EntityID != eAcuteItem.EntityID {
		t.Fatalf("first Unicode Postgres delegated page = %+v", unicodeFirst.ActionItems)
	}
	unicodeQuery.Cursor = unicodeFirst.ActionItems.NextCursor
	unicodeSecond, err := repo.GetMyWork(context.Background(), unicodeQuery)
	if err != nil {
		t.Fatal(err)
	}
	if unicodeSecond.ActionItems == nil || len(unicodeSecond.ActionItems.Items) != 1 || !unicodeSecond.ActionItems.HasMore ||
		unicodeSecond.ActionItems.Items[0].EntityID != eCircumflexItem.EntityID {
		t.Fatalf("second Unicode Postgres delegated page = %+v", unicodeSecond.ActionItems)
	}
}

func TestPostgresMyWorkNodeGroupingKeysetsAndEmptyStackExecute(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Postgres My Work Node Grouping")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("postgres-my-work-node-grouping", "postgres-my-work-node-grouping@example.test", "Node Grouping")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	createNode := func(name string, priority *int, due *string) domain.Node {
		t.Helper()
		node, err := repo.CreateNode(company.CompanyID, name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: company.CompanyID, NodeID: node.NodeID, Priority: priority, PrioritySet: true, DueDate: due, DueDateSet: true}); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
			CompanyID: company.CompanyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, ActorUserID: user.UserID,
			Assignments: []ResourceRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: user.UserID}},
		}); err != nil {
			t.Fatal(err)
		}
		return node
	}
	priorityOne, priorityFive := 1, 5
	dueEarly, dueMiddle, dueLate := "2026-09-01", "2026-09-02", "2026-09-03"
	early := createNode("Early", &priorityOne, &dueEarly)
	middle := createNode("Middle", &priorityFive, &dueMiddle)
	late := createNode("Late", &priorityOne, &dueLate)
	missing := createNode("Missing", nil, nil)
	grouping := "due_date:desc,priority:asc"

	first, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Grouping: grouping, Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if first.Nodes == nil || len(first.Nodes.Items) != 2 || first.Nodes.Items[0].NodeID != late.NodeID || first.Nodes.Items[1].NodeID != middle.NodeID || !first.Nodes.HasMore {
		t.Fatalf("first Postgres Node grouping page = %+v", first.Nodes)
	}
	second, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Grouping: grouping, Limit: 2, Cursor: first.Nodes.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if second.Nodes == nil || len(second.Nodes.Items) != 2 || second.Nodes.Items[0].NodeID != early.NodeID || second.Nodes.Items[1].NodeID != missing.NodeID || second.Nodes.HasMore {
		t.Fatalf("second Postgres Node grouping page = %+v", second.Nodes)
	}

	noneFirst, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Grouping: MyWorkGroupingNone, Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if noneFirst.Nodes == nil || len(noneFirst.Nodes.Items) != 2 || !noneFirst.Nodes.HasMore || noneFirst.Nodes.Items[0].NodeID >= noneFirst.Nodes.Items[1].NodeID {
		t.Fatalf("first Postgres ungrouped Node page = %+v", noneFirst.Nodes)
	}
	noneSecond, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Grouping: MyWorkGroupingNone, Limit: 2, Cursor: noneFirst.Nodes.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if noneSecond.Nodes == nil || len(noneSecond.Nodes.Items) != 2 || noneSecond.Nodes.HasMore || noneSecond.Nodes.Items[0].NodeID >= noneSecond.Nodes.Items[1].NodeID || noneFirst.Nodes.Items[1].NodeID >= noneSecond.Nodes.Items[0].NodeID {
		t.Fatalf("second Postgres ungrouped Node page = %+v first=%+v", noneSecond.Nodes, noneFirst.Nodes)
	}
}

func TestPostgresMyWorkSetBasedRACIAndPermissionWinnersMatchCanonicalRules(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Postgres My Work Winner Equivalence")
	if err != nil {
		t.Fatal(err)
	}
	subject, err := repo.UpsertAuthUser("postgres-my-work-winner-subject", "postgres-my-work-winner-subject@example.test", "Winner Subject")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("postgres-my-work-winner-admin", "postgres-my-work-winner-admin@example.test", "Winner Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	parent, err := repo.CreateCompanyUserGroup(company.CompanyID, "", "Winner parent")
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateCompanyUserGroup(company.CompanyID, parent.GroupID, "Winner child")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(company.CompanyID, child.GroupID, []string{subject.UserID}); err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(company.CompanyID, "Winner process")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, ActorUserID: admin.UserID,
		Assignments: []ResourceRACIAssignmentInput{
			{Role: domain.RACIRoleAccountable, PrincipalType: EntityPermissionSubjectUser, PrincipalID: subject.UserID},
			{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: parent.GroupID},
			{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: admin.UserID},
		},
	}); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(company.CompanyID, "Winner inherited node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "in progress"}); err != nil {
		t.Fatal(err)
	}
	mustSetPostgresMyWorkRACIInherited(t, repo, company.CompanyID, EntityTypeNode, node.NodeID)

	responsible, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: subject.UserID, ViewerUserID: subject.UserID, Section: MyWorkSectionProcesses, Role: domain.RACIRoleResponsible})
	if err != nil {
		t.Fatal(err)
	}
	if responsible.Processes == nil || len(responsible.Processes.Items) != 1 || responsible.Processes.Items[0].LogicGateID != gate.LogicGateID {
		t.Fatalf("Responsible winner process page = %+v", responsible.Processes)
	}
	accountable, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: subject.UserID, ViewerUserID: subject.UserID, Section: MyWorkSectionProcesses, Role: domain.RACIRoleAccountable})
	if err != nil {
		t.Fatal(err)
	}
	if accountable.Processes == nil || len(accountable.Processes.Items) != 0 {
		t.Fatalf("losing Accountable process page = %+v", accountable.Processes)
	}
	beforePermissionOverride, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: subject.UserID, ViewerUserID: subject.UserID, Section: MyWorkSectionNodes})
	if err != nil {
		t.Fatal(err)
	}
	if beforePermissionOverride.Nodes == nil || len(beforePermissionOverride.Nodes.Items) != 1 || beforePermissionOverride.Nodes.Items[0].NodeID != node.NodeID {
		t.Fatalf("inherited Responsible Node page = %+v", beforePermissionOverride.Nodes)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: company.CompanyID, EntityType: EntityTypeNode, EntityID: node.NodeID,
		DefaultAccess: EntityPermissionNoAccess, DefaultAccessSet: true, ActorUserID: admin.UserID,
		Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectGroup, SubjectID: parent.GroupID, AccessLevel: EntityPermissionEdit},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: subject.UserID, AccessLevel: EntityPermissionNoAccess},
		},
	}); err != nil {
		t.Fatal(err)
	}
	hidden, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: subject.UserID, ViewerUserID: subject.UserID, Section: MyWorkSectionNodes})
	if err != nil {
		t.Fatal(err)
	}
	if hidden.Nodes == nil || len(hidden.Nodes.Items) != 0 {
		t.Fatalf("direct No Access did not override nested-group Edit: %+v", hidden.Nodes)
	}
	adminVisible, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: company.CompanyID, UserID: admin.UserID, ViewerUserID: admin.UserID, Section: MyWorkSectionNodes})
	if err != nil {
		t.Fatal(err)
	}
	if adminVisible.Nodes == nil || len(adminVisible.Nodes.Items) != 1 || adminVisible.Nodes.Items[0].NodeID != node.NodeID {
		t.Fatalf("company admin did not bypass resource No Access: %+v", adminVisible.Nodes)
	}
}

func postgresMyWorkActionIDsEqual(items []domain.MyWorkActionItem, firstID, secondID string) bool {
	if len(items) != 2 {
		return false
	}
	return (items[0].EntityID == firstID && items[1].EntityID == secondID) ||
		(items[0].EntityID == secondID && items[1].EntityID == firstID)
}

func TestPostgresMyWorkPersonInChargePlan(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Postgres My Work Plan")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("postgres-my-work-plan", "postgres-my-work-plan@example.test", "Plan")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	other, err := repo.UpsertAuthUser("postgres-my-work-plan-other", "postgres-my-work-plan-other@example.test", "Plan Other")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(other.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateActionItem(ActionItemInput{CompanyID: company.CompanyID, BodyText: "Seed definitions", CreatedByUserID: user.UserID}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
insert into entities(company_id,entity_id,entity_type_id,name,position,created_by_user_id)
select $1::uuid,md5('my-work-entity-' || value::text)::uuid,$2::uuid,'Plan item ' || value::text,value,$3::uuid
from generate_series(1,12000) value`, company.CompanyID, ActionItemEntityTypeID, other.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
insert into entity_fields(company_id,entity_field_id,entity_id,entity_field_type_id,name,field_type,value_jsonb,position)
select $1::uuid,md5('my-work-field-' || value::text)::uuid,md5('my-work-entity-' || value::text)::uuid,$2::uuid,'Person in charge','person',to_jsonb($3::text),0
from generate_series(1,12000) value`, company.CompanyID, ActionItemPersonInChargeFieldTypeID, other.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`analyze entity_fields`); err != nil {
		t.Fatal(err)
	}
	var planJSON []byte
	if err := db.QueryRow(`
explain (analyze, buffers, format json)
select entity_id
from entity_fields
where company_id=$1::uuid
  and entity_field_type_id='a17e0000-0000-4000-8000-000000000101'::uuid
  and mangorts_try_uuid(value_jsonb #>> '{}')=$2::uuid`, company.CompanyID, user.UserID).Scan(&planJSON); err != nil {
		t.Fatal(err)
	}
	if !json.Valid(planJSON) {
		t.Fatalf("invalid EXPLAIN JSON: %s", planJSON)
	}
	if !strings.Contains(string(planJSON), "idx_entity_fields_action_item_person_in_charge") {
		t.Fatalf("Person-in-charge plan did not use targeted index: %s", planJSON)
	}
}

func mustCreatePostgresMyWorkActionItem(t *testing.T, repo *PostgresRepo, companyID, userID, name, color, due string) domain.Entity {
	t.Helper()
	item, err := repo.CreateActionItem(ActionItemInput{CompanyID: companyID, Name: name, BodyText: name, CreatedByUserID: userID})
	if err != nil {
		t.Fatal(err)
	}
	mustSetPostgresMyWorkActionField(t, repo, item, ActionItemPersonInChargeSystemKey, userID)
	mustSetPostgresMyWorkActionField(t, repo, item, ActionItemStatusSystemKey, ActionItemStatusInProgress)
	if color != "" {
		mustSetPostgresMyWorkActionField(t, repo, item, ActionItemColorSystemKey, color)
	}
	if due != "" {
		mustSetPostgresMyWorkActionField(t, repo, item, ActionItemCompletionDueDateSystemKey, due)
	}
	return item
}

func mustCreatePostgresMyWorkDelegatedActionItem(t *testing.T, repo *PostgresRepo, companyID, delegatorUserID, personInChargeUserID, name, color, due string) domain.Entity {
	t.Helper()
	item := mustCreatePostgresMyWorkActionItem(t, repo, companyID, delegatorUserID, name, color, due)
	mustSetPostgresMyWorkActionField(t, repo, item, ActionItemPersonInChargeSystemKey, personInChargeUserID)
	mustSetPostgresMyWorkActionField(t, repo, item, ActionItemAssignedBySystemKey, delegatorUserID)
	return item
}

func mustCreatePostgresSourcedMyWorkActionItem(t *testing.T, repo *PostgresRepo, companyID, userID, name, sourceType, sourceID, due string) domain.Entity {
	t.Helper()
	color := ActionItemColorRed
	item, err := repo.CreateActionItem(ActionItemInput{
		CompanyID: companyID, Name: name, BodyText: name, Color: &color, CreatedByUserID: userID,
		SourceResourceType: sourceType, SourceResourceID: sourceID,
	})
	if err != nil {
		t.Fatal(err)
	}
	mustSetPostgresMyWorkActionField(t, repo, item, ActionItemPersonInChargeSystemKey, userID)
	mustSetPostgresMyWorkActionField(t, repo, item, ActionItemAssignedBySystemKey, userID)
	mustSetPostgresMyWorkActionField(t, repo, item, ActionItemAnalysisDueDateSystemKey, "2026-08-31")
	mustSetPostgresMyWorkActionField(t, repo, item, ActionItemCompletionDueDateSystemKey, due)
	mustSetPostgresMyWorkActionField(t, repo, item, ActionItemStatusSystemKey, ActionItemStatusInProgress)
	return item
}

func mustSetPostgresMyWorkActionField(t *testing.T, repo *PostgresRepo, item domain.Entity, systemKey, value string) {
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
	t.Fatalf("Postgres action item field %q not found", systemKey)
}

func mustSetPostgresMyWorkRACIInherited(t *testing.T, repo *PostgresRepo, companyID, resourceType, resourceID string) {
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

func postgresMyWorkContainsNode(nodes []domain.Node, nodeID string) bool {
	for _, node := range nodes {
		if node.NodeID == nodeID {
			return true
		}
	}
	return false
}
