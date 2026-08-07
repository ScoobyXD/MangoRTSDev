package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"os"
	"strings"
	"testing"
)

func TestNodeVerificationRequestSnapshotsMultipleAccountableUsersAndCompletesPerPerson(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "62626262-6262-4262-8262-626262626201"
	repo.EnsureCompany(companyID, "Timeline Verification Co")
	actor := mustCreateRACIMembershipUser(t, repo, "timeline-actor", companyID)
	first := mustCreateRACIMembershipUser(t, repo, "timeline-first-accountable", companyID)
	second := mustCreateRACIMembershipUser(t, repo, "timeline-second-accountable", companyID)
	later := mustCreateRACIMembershipUser(t, repo, "timeline-later-accountable", companyID)
	node := mustCreateRACIMembershipNode(t, repo, companyID, "Verification packet")

	_, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		Assignments: []ResourceRACIAssignmentInput{
			{Role: domain.RACIRoleAccountable, PrincipalType: EntityPermissionSubjectUser, PrincipalID: first.UserID},
			{Role: domain.RACIRoleAccountable, PrincipalType: EntityPermissionSubjectUser, PrincipalID: second.UserID},
		},
	})
	if err != nil {
		t.Fatalf("SetResourceRACIAssignments multiple accountable: %v", err)
	}

	created, err := repo.CreateNodeVerificationRequest(NodeVerificationRequestInput{
		CompanyID: companyID, NodeID: node.NodeID, ActorUserID: actor.UserID, IdempotencyKey: "verification-request-one",
	})
	if err != nil {
		t.Fatalf("CreateNodeVerificationRequest: %v", err)
	}
	if created.TimelineEvent.Type != domain.NodeTimelineEventVerificationRequest || len(created.TimelineEvent.VerificationRecipients) != 2 || len(created.Events) != 1 {
		t.Fatalf("created = %+v", created)
	}
	if created.Events[0].Type != NodeVerificationRequestedWorkspaceEventType {
		t.Fatalf("domain event type = %q", created.Events[0].Type)
	}

	replayed, err := repo.CreateNodeVerificationRequest(NodeVerificationRequestInput{
		CompanyID: companyID, NodeID: node.NodeID, ActorUserID: actor.UserID, IdempotencyKey: "verification-request-one",
	})
	if err != nil || replayed.TimelineEvent.EventID != created.TimelineEvent.EventID || len(replayed.Events) != 0 {
		t.Fatalf("idempotent replay = %+v err=%v", replayed, err)
	}

	_, err = repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		Assignments: []ResourceRACIAssignmentInput{{Role: domain.RACIRoleAccountable, PrincipalType: EntityPermissionSubjectUser, PrincipalID: later.UserID}},
	})
	if err != nil {
		t.Fatalf("replace accountable after snapshot: %v", err)
	}
	listed, err := repo.ListNodeTimelineEvents(companyID, node.NodeID)
	if err != nil || len(listed) != 1 || len(listed[0].VerificationRecipients) != 2 {
		t.Fatalf("historical snapshot changed: %+v err=%v", listed, err)
	}
	for _, recipient := range listed[0].VerificationRecipients {
		if recipient.UserID == later.UserID {
			t.Fatalf("later accountable leaked into historical snapshot: %+v", listed[0])
		}
	}

	if _, err := repo.CompleteNodeVerificationRequest(NodeVerificationCompletionInput{CompanyID: companyID, NodeID: node.NodeID, EventID: created.TimelineEvent.EventID, UserID: later.UserID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-recipient completion err=%v, want ErrNotFound", err)
	}
	completed, err := repo.CompleteNodeVerificationRequest(NodeVerificationCompletionInput{CompanyID: companyID, NodeID: node.NodeID, EventID: created.TimelineEvent.EventID, UserID: first.UserID})
	if err != nil {
		t.Fatalf("recipient completion: %v", err)
	}
	var completedTimestamp string
	for _, recipient := range completed.VerificationRecipients {
		if recipient.UserID == first.UserID && recipient.CompletedTimestamp != nil {
			completedTimestamp = recipient.CompletedTimestamp.String()
		}
		if recipient.UserID == second.UserID && recipient.CompletedTimestamp != nil {
			t.Fatalf("second recipient completed with first: %+v", completed)
		}
	}
	if completedTimestamp == "" {
		t.Fatalf("first recipient was not completed: %+v", completed)
	}
	repeated, err := repo.CompleteNodeVerificationRequest(NodeVerificationCompletionInput{CompanyID: companyID, NodeID: node.NodeID, EventID: created.TimelineEvent.EventID, UserID: first.UserID})
	if err != nil || repeated.VerificationRecipients[0].CompletedTimestamp == nil {
		t.Fatalf("idempotent completion = %+v err=%v", repeated, err)
	}
}

func TestNodeTimelineRecordsOnlyCrossLogicGateTransfersWithSnapshots(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "62626262-6262-4262-8262-626262626202"
	repo.EnsureCompany(companyID, "Timeline Transfer Co")
	actor := mustCreateRACIMembershipUser(t, repo, "timeline-transfer-actor", companyID)
	source, err := repo.CreateLogicGate(companyID, "Intake")
	if err != nil {
		t.Fatalf("CreateLogicGate source: %v", err)
	}
	target, err := repo.CreateLogicGate(companyID, "Review")
	if err != nil {
		t.Fatalf("CreateLogicGate target: %v", err)
	}
	node := mustCreateRACIMembershipNode(t, repo, companyID, "Transfer packet")
	priority := 3
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: source.LogicGateID, NodeID: node.NodeID, Status: LogicGateWorkStatusPending, Priority: &priority, PrioritySet: true, ActorUserID: actor.UserID}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if events, err := repo.ListNodeTimelineEvents(companyID, node.NodeID); err != nil || len(events) != 0 {
		t.Fatalf("initial assignment timeline = %+v err=%v", events, err)
	}
	if _, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: companyID, LogicGateID: source.LogicGateID, FromLogicGateID: source.LogicGateID, NodeID: node.NodeID, Status: LogicGateWorkStatusInProgress, ActorUserID: actor.UserID}); err != nil {
		t.Fatalf("same gate status move: %v", err)
	}
	if events, err := repo.ListNodeTimelineEvents(companyID, node.NodeID); err != nil || len(events) != 0 {
		t.Fatalf("same-gate move timeline = %+v err=%v", events, err)
	}
	if _, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: companyID, LogicGateID: target.LogicGateID, FromLogicGateID: source.LogicGateID, NodeID: node.NodeID, Status: LogicGateWorkStatusPending, ActorUserID: actor.UserID}); err != nil {
		t.Fatalf("cross-gate move: %v", err)
	}
	events, err := repo.ListNodeTimelineEvents(companyID, node.NodeID)
	if err != nil || len(events) != 1 {
		t.Fatalf("cross-gate timeline = %+v err=%v", events, err)
	}
	item := events[0]
	if item.Type != domain.NodeTimelineEventLogicGateTransfer || item.ActorDisplayName != actor.DisplayName || item.FromLogicGateName != "Intake" || item.ToLogicGateName != "Review" {
		t.Fatalf("transfer snapshot = %+v", item)
	}
	repo.mu.Lock()
	changed := repo.logicGates[key(companyID, source.LogicGateID)]
	changed.Header = "Renamed Intake"
	repo.logicGates[key(companyID, source.LogicGateID)] = changed
	repo.mu.Unlock()
	events, _ = repo.ListNodeTimelineEvents(companyID, node.NodeID)
	if events[0].FromLogicGateName != "Intake" {
		t.Fatalf("historical gate name was rewritten: %+v", events[0])
	}
}

func TestNodeTimelineRecordsProjectAssignmentOnceWithSnapshots(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "62626262-6262-4262-8262-626262626204"
	repo.EnsureCompany(companyID, "Timeline Project Co")
	actor := mustCreateRACIMembershipUser(t, repo, "timeline-project-actor", companyID)
	projectResult, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Launch", Status: ProjectDefaultStatus})
	if err != nil || projectResult.Project == nil {
		t.Fatalf("CreateProject = %+v err=%v", projectResult, err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Delivery")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node := mustCreateRACIMembershipNode(t, repo, companyID, "Launch packet")
	priority := 2
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID,
		Priority: &priority, PrioritySet: true, ActorUserID: actor.UserID,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	input := ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: projectResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: node.NodeID, ActorUserID: actor.UserID,
	}
	if _, err := repo.UpsertProjectRelationship(input); err != nil {
		t.Fatalf("UpsertProjectRelationship: %v", err)
	}
	if _, err := repo.UpsertProjectRelationship(input); err != nil {
		t.Fatalf("idempotent UpsertProjectRelationship: %v", err)
	}
	events, err := repo.ListNodeTimelineEvents(companyID, node.NodeID)
	if err != nil || len(events) != 1 {
		t.Fatalf("project assignment timeline = %+v err=%v", events, err)
	}
	item := events[0]
	if item.Type != domain.NodeTimelineEventProjectAssignment || item.ActorDisplayName != actor.DisplayName || item.ProjectID != projectResult.Project.ProjectID || item.ProjectName != "Launch" {
		t.Fatalf("project assignment snapshot = %+v", item)
	}
	repo.mu.Lock()
	changed := repo.projects[key(companyID, projectResult.Project.ProjectID)]
	changed.Name = "Renamed Launch"
	repo.projects[key(companyID, projectResult.Project.ProjectID)] = changed
	repo.mu.Unlock()
	events, _ = repo.ListNodeTimelineEvents(companyID, node.NodeID)
	if events[0].ProjectName != "Launch" {
		t.Fatalf("historical project name was rewritten: %+v", events[0])
	}
}

func TestAccountableRACIAllowsManyUsersAndGroups(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "62626262-6262-4262-8262-626262626203"
	repo.EnsureCompany(companyID, "Accountable Rule Co")
	first := mustCreateRACIMembershipUser(t, repo, "accountable-rule-first", companyID)
	second := mustCreateRACIMembershipUser(t, repo, "accountable-rule-second", companyID)
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Accountable Team")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{first.UserID, second.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers: %v", err)
	}
	node := mustCreateRACIMembershipNode(t, repo, companyID, "Accountable rule node")
	result, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		Assignments: []ResourceRACIAssignmentInput{{Role: domain.RACIRoleAccountable, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID}},
	})
	if err != nil {
		t.Fatalf("Accountable group assignment rejected: %v", err)
	}
	if len(result.EffectiveAssignments) != 2 {
		t.Fatalf("Accountable effective assignments = %+v, want both group members", result.EffectiveAssignments)
	}
	for _, assignment := range result.EffectiveAssignments {
		if assignment.Role != domain.RACIRoleAccountable || (assignment.UserID != first.UserID && assignment.UserID != second.UserID) {
			t.Fatalf("unexpected Accountable effective assignment: %+v", assignment)
		}
	}
}

func TestNodeTimelineSchemaAndMigrationContract(t *testing.T) {
	checks := map[string][]string{
		"../../db/schema.sql": {
			"create table if not exists node_timeline_events",
			"create table if not exists node_timeline_verification_recipients",
			"idx_node_timeline_events_idempotency",
			"event_type in ('logic_gate_transfer', 'project_assignment', 'verification_request')",
			"project_id uuid",
			"project_name text not null default ''",
			"trg_node_view_version_timeline_events",
			"trg_node_view_version_timeline_recipients",
		},
		"../../db/migrations/20260722_node_timeline_verification_events.sql": {
			"create table if not exists node_timeline_events",
			"create table if not exists node_timeline_verification_recipients",
			"completed_timestamp timestamptz",
		},
		"../../db/migrations/20260807_node_project_assignment_timeline.sql": {
			"add column if not exists project_id uuid",
			"add column if not exists project_name text not null default ''",
			"node_timeline_events_payload_chk",
			"event_type='project_assignment'",
		},
	}
	for path, markers := range checks {
		payload, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", path, err)
		}
		source := strings.ToLower(string(payload))
		for _, marker := range markers {
			if !strings.Contains(source, marker) {
				t.Fatalf("%s missing %q", path, marker)
			}
		}
	}
}
