package store

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"os"
	"strings"
	"testing"
)

func TestMemoryLogicGateWorkReadsAssignmentsWithoutKanbanCards(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555401"
	repo.EnsureCompany(companyID, "Logic Gate Work Store Co")

	logicGate, err := repo.CreateLogicGate(companyID, "Release Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	firstNode, err := repo.CreateNode(companyID, "Pending work")
	if err != nil {
		t.Fatalf("CreateNode first: %v", err)
	}
	secondNode, err := repo.CreateNode(companyID, "Progress work")
	if err != nil {
		t.Fatalf("CreateNode second: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      secondNode.NodeID,
		Status:      "in_progress",
		Position:    20,
		Priority:    testPriority(4),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus second: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      firstNode.NodeID,
		Status:      "pending",
		Position:    10,
		Priority:    testPriority(2),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus first: %v", err)
	}

	repo.mu.Lock()
	delete(repo.kanbanCards, boardKey(companyID, LogicGateKanbanBoardID(logicGate.LogicGateID)))
	repo.mu.Unlock()

	work, err := repo.GetLogicGateWork(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateWork: %v", err)
	}
	if len(work.Cards) != 2 ||
		work.Cards[0].NodeID != firstNode.NodeID ||
		work.Cards[0].ColumnID != LogicGateWorkStatusPending ||
		work.Cards[1].NodeID != secondNode.NodeID ||
		work.Cards[1].ColumnID != LogicGateWorkStatusInProgress {
		t.Fatalf("synthesized cards = %+v, want canonical in_progress card", work.Cards)
	}
	if work.Cards[0].Priority == nil || *work.Cards[0].Priority != 2 || work.Cards[1].Priority == nil || *work.Cards[1].Priority != 4 {
		t.Fatalf("synthesized card priorities = %+v, want node priorities 2 and 4", work.Cards)
	}
}

func TestLogicGateWorkJSONContractIsKanbanSpecificAndNonRedundant(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555404"
	repo.EnsureCompany(companyID, "Logic Gate Work Contract Co")
	owner := mustCreateGVICMembershipUser(t, repo, "logic-gate-contract-owner", companyID)
	logicGate, err := repo.CreateLogicGate(companyID, "Contract Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: owner.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Contract card")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 2
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusRequested,
		Priority:    &priority,
		PrioritySet: true,
		ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	work, err := repo.GetLogicGateWork(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateWork: %v", err)
	}
	payload, err := json.Marshal(work)
	if err != nil {
		t.Fatalf("Marshal LogicGateWorkView: %v", err)
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(payload, &top); err != nil {
		t.Fatalf("Unmarshal LogicGateWorkView: %v", err)
	}
	for _, required := range []string{"logic_gate", "permissions", "board", "columns", "cards"} {
		if _, ok := top[required]; !ok {
			t.Fatalf("work JSON missing %q: %s", required, payload)
		}
	}
	if len(top) != 5 {
		t.Fatalf("work JSON top-level keys = %v, want exactly five Kanban keys", top)
	}
	for _, forbidden := range []string{"company_id", "logic_gate_id", "statuses", "assignments", "nodes", "cards_limit"} {
		if _, ok := top[forbidden]; ok {
			t.Fatalf("work JSON retained redundant %q: %s", forbidden, payload)
		}
	}
	var header map[string]json.RawMessage
	if err := json.Unmarshal(top["logic_gate"], &header); err != nil {
		t.Fatalf("Unmarshal logic_gate: %v", err)
	}
	var requestOwnerUserID string
	if err := json.Unmarshal(header["request_owner_user_id"], &requestOwnerUserID); err != nil {
		t.Fatalf("Unmarshal request_owner_user_id: %v", err)
	}
	if len(header) != 4 || requestOwnerUserID != owner.UserID {
		t.Fatalf("logic_gate header = %s, want id/header/default/request owner only", top["logic_gate"])
	}
	var cards []map[string]json.RawMessage
	if err := json.Unmarshal(top["cards"], &cards); err != nil || len(cards) != 1 {
		t.Fatalf("cards = %s err=%v, want one card", top["cards"], err)
	}
	for _, forbidden := range []string{"company_id", "board_id", "logic_gate_id", "description_snapshot", "updated_timestamp"} {
		if _, ok := cards[0][forbidden]; ok {
			t.Fatalf("minimal card retained %q: %s", forbidden, top["cards"])
		}
	}
}

func TestMemoryLogicGateWorkVersionInvalidatesEveryResponseDependency(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555405"
	repo.EnsureCompany(companyID, "Logic Gate Work Version Co")
	logicGate, err := repo.CreateLogicGate(companyID, "Version Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Version Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusPending,
		Priority:    testPriority(2),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	boardID := LogicGateKanbanBoardID(logicGate.LogicGateID)
	assertBump := func(name string, mutate func() error) {
		t.Helper()
		before, err := repo.CurrentLogicGateWorkVersion(companyID, logicGate.LogicGateID)
		if err != nil {
			t.Fatalf("%s version before: %v", name, err)
		}
		if err := mutate(); err != nil {
			t.Fatalf("%s mutate: %v", name, err)
		}
		after, err := repo.CurrentLogicGateWorkVersion(companyID, logicGate.LogicGateID)
		if err != nil {
			t.Fatalf("%s version after: %v", name, err)
		}
		if after <= before {
			t.Fatalf("%s version = %d after %d, want independent increment", name, after, before)
		}
	}
	appendEvent := func(eventType string, payload map[string]any) func() error {
		return func() error {
			_, err := repo.AppendDomainEvent(DomainEventInput{
				CompanyID:  companyID,
				StreamType: workspaceDomainStreamType,
				StreamID:   companyID,
				Type:       eventType,
				Payload:    payload,
			})
			return err
		}
	}
	for _, item := range []struct {
		name      string
		eventType string
		payload   map[string]any
	}{
		{name: "gate header", eventType: "logic_gate_updated", payload: map[string]any{"logic_gate_id": logicGate.LogicGateID}},
		{name: "gate permission", eventType: "logic_gate_permissions_updated", payload: map[string]any{"logic_gate_id": logicGate.LogicGateID}},
		{name: "gate GVIC/request owner", eventType: "logic_gate_gvic_updated", payload: map[string]any{"logic_gate_id": logicGate.LogicGateID}},
		{name: "inherited permission policy", eventType: "company_explorer_folder_permissions_updated", payload: map[string]any{}},
		{name: "board", eventType: "kanban_board_updated", payload: map[string]any{"board_id": boardID}},
		{name: "column/status", eventType: "kanban_column_updated", payload: map[string]any{"board_id": boardID}},
		{name: "card and email origin", eventType: "kanban_card_upserted", payload: map[string]any{"board_id": boardID}},
		{name: "node", eventType: "node_updated", payload: map[string]any{"node_id": node.NodeID}},
		{name: "assignment", eventType: WorkItemLogicGateAssignmentMovedEventType, payload: map[string]any{"logic_gate_id": logicGate.LogicGateID, "node_id": node.NodeID, "board_id": boardID}},
	} {
		assertBump(item.name, appendEvent(item.eventType, item.payload))
	}
}

func TestMemoryLogicGateRequestedAssignmentsTrackRequester(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555402"
	repo.EnsureCompany(companyID, "Logic Gate Request Store Co")

	requester := mustCreateGVICMembershipUser(t, repo, "logic-gate-requester", companyID)
	responsible := mustCreateGVICMembershipUser(t, repo, "logic-gate-responsible", companyID)
	logicGate, err := repo.CreateLogicGate(companyID, "Request Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: responsible.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Requested work")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 3
	requested, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusRequested,
		Priority:    &priority,
		PrioritySet: true,
		ActorUserID: requester.UserID,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus requested: %v", err)
	}
	if requested.Card.RequestedByUserID != requester.UserID || requested.Assignment.RequestedByUserID != requester.UserID {
		t.Fatalf("requested sender card=%q assignment=%q, want %q", requested.Card.RequestedByUserID, requested.Assignment.RequestedByUserID, requester.UserID)
	}

	accepted, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusPending,
		ActorUserID: responsible.UserID,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment accept: %v", err)
	}
	if accepted.Card.ColumnID != LogicGateWorkStatusPending || accepted.Card.RequestedByUserID != "" || accepted.Assignment.RequestedByUserID != "" {
		t.Fatalf("accepted card=%+v assignment=%+v, want pending with cleared requester", accepted.Card, accepted.Assignment)
	}

	requestedAgain, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusRequested,
		ActorUserID: requester.UserID,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment request again: %v", err)
	}
	if requestedAgain.Card.RequestedByUserID != requester.UserID {
		t.Fatalf("requested again sender = %q, want %q", requestedAgain.Card.RequestedByUserID, requester.UserID)
	}
	denied, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusBacklog,
		ActorUserID: responsible.UserID,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment deny: %v", err)
	}
	if denied.Card.ColumnID != LogicGateWorkStatusBacklog || denied.Card.RequestedByUserID != "" || denied.Assignment.RequestedByUserID != "" {
		t.Fatalf("denied card=%+v assignment=%+v, want backlog with cleared requester", denied.Card, denied.Assignment)
	}
}

func TestMemoryLogicGateAssignmentsTrackPlacedByUser(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555403"
	repo.EnsureCompany(companyID, "Logic Gate Placement Store Co")

	creator := mustCreateGVICMembershipUser(t, repo, "logic-gate-placement-creator", companyID)
	transferActor := mustCreateGVICMembershipUser(t, repo, "logic-gate-placement-transfer", companyID)
	sourceGate, err := repo.CreateLogicGate(companyID, "Placement Source")
	if err != nil {
		t.Fatalf("CreateLogicGate source: %v", err)
	}
	targetGate, err := repo.CreateLogicGate(companyID, "Placement Target")
	if err != nil {
		t.Fatalf("CreateLogicGate target: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Placed work")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 2
	assigned, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: sourceGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusPending,
		Priority:    &priority,
		PrioritySet: true,
		ActorUserID: creator.UserID,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if assigned.Card.PlacedByUserID != creator.UserID || assigned.Assignment.PlacedByUserID != creator.UserID {
		t.Fatalf("assigned placed_by card=%q assignment=%q, want %q", assigned.Card.PlacedByUserID, assigned.Assignment.PlacedByUserID, creator.UserID)
	}

	sameGateMove, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: sourceGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusInProgress,
		ActorUserID: transferActor.UserID,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment same gate: %v", err)
	}
	if sameGateMove.Card.PlacedByUserID != creator.UserID || sameGateMove.Assignment.PlacedByUserID != creator.UserID {
		t.Fatalf("same-gate placed_by card=%q assignment=%q, want original %q", sameGateMove.Card.PlacedByUserID, sameGateMove.Assignment.PlacedByUserID, creator.UserID)
	}

	crossGateMove, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:       companyID,
		LogicGateID:     targetGate.LogicGateID,
		FromLogicGateID: sourceGate.LogicGateID,
		NodeID:          node.NodeID,
		Status:          LogicGateWorkStatusPending,
		ActorUserID:     transferActor.UserID,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment cross gate: %v", err)
	}
	if crossGateMove.Card.PlacedByUserID != transferActor.UserID || crossGateMove.Assignment.PlacedByUserID != transferActor.UserID {
		t.Fatalf("cross-gate placed_by card=%q assignment=%q, want transfer actor %q", crossGateMove.Card.PlacedByUserID, crossGateMove.Assignment.PlacedByUserID, transferActor.UserID)
	}

	work, err := repo.GetLogicGateWork(companyID, targetGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateWork: %v", err)
	}
	if len(work.Cards) != 1 || work.Cards[0].PlacedByUserID != transferActor.UserID {
		t.Fatalf("target work cards = %+v, want placed_by transfer actor", work.Cards)
	}
}

func TestPhase4LogicGateWorkSourceShape(t *testing.T) {
	postgresSource := readPhase4SourceForTest(t, "postgres_logic_gate_work.go")
	getWorkEnd := strings.Index(postgresSource, "func (r *PostgresRepo) LogicGateWorkAccessFlags")
	if getWorkEnd < 0 {
		t.Fatalf("postgres logic gate access function boundary not found")
	}
	normalizedPostgres := strings.ToLower(postgresSource[:getWorkEnd])
	if !strings.Contains(normalizedPostgres, "join kanban_board_projection projection") {
		t.Fatalf("postgres logic gate work read does not select from kanban_board_projection")
	}
	if !strings.Contains(normalizedPostgres, "projection.priority") {
		t.Fatalf("postgres logic gate work read does not select projection priority")
	}
	for _, required := range []string{
		"email_relationships",
		"mangorts_v2_effective_gvic_assignments",
		"mangorts_v2_resolve_permission_policy",
		"projection.status_rank",
	} {
		if !strings.Contains(normalizedPostgres, required) {
			t.Fatalf("postgres logic gate work read missing consolidated source %q", required)
		}
	}
	for _, forbidden := range []string{
		"from kanban_boards",
		"from kanban_columns",
		"from kanban_cards",
		"join nodes",
		"join kanban_boards",
		"join kanban_columns",
		"join kanban_cards",
		"join node_logic_gate_assignments",
		"left join lateral",
		"listaccessibleentityids",
		"mangorts_user_can_access_resource",
	} {
		if strings.Contains(normalizedPostgres, forbidden) {
			t.Fatalf("postgres logic gate work read contains forbidden source %q", forbidden)
		}
	}

	handlerSource := strings.ToLower(readPhase4SourceForTest(t, "../http/logic_gate_work_handlers.go"))
	for _, forbidden := range []string{
		"listaccessibleentityids",
		"mangorts_user_can_access_resource",
		"usercanaccessentity",
		"requireentityview",
		"requireentityedit",
		"requirekanbanboardview",
		"requirekanbancardview",
		"recordkanbanstatenotification",
		"kanbancardnotificationsnapshot",
	} {
		if strings.Contains(handlerSource, forbidden) {
			t.Fatalf("v2 logic gate work handler contains forbidden access path %q", forbidden)
		}
	}

	workItemHandlerSource := strings.ToLower(readPhase4SourceForTest(t, "../http/work_item_handlers.go"))
	for _, forbidden := range []string{
		"recordkanbanstatenotification",
		"logicgateassignmentnotificationsnapshot",
		"kanbancardnotificationsnapshot",
	} {
		if strings.Contains(workItemHandlerSource, forbidden) {
			t.Fatalf("work item assignment handler contains replaced notification helper %q", forbidden)
		}
	}
}

func TestPostgresKanbanProjectionCardListSelectsCardMetadata(t *testing.T) {
	source := strings.ToLower(readPhase4SourceForTest(t, "postgres_kanban_projection.go"))
	functionIndex := strings.Index(source, "func listkanbanboardprojectioncardstx")
	if functionIndex < 0 {
		t.Fatalf("postgres kanban projection card list function not found")
	}
	functionSource := source[functionIndex:]
	fromProjectedIndex := strings.Index(functionSource, "from projected")
	if fromProjectedIndex < 0 {
		t.Fatalf("postgres kanban projection card list does not select from projected CTE")
	}
	outerSelectSource := functionSource[:fromProjectedIndex]
	outerSelectIndex := strings.LastIndex(outerSelectSource, "select")
	if outerSelectIndex < 0 {
		t.Fatalf("postgres kanban projection card list outer select not found")
	}
	outerSelect := outerSelectSource[outerSelectIndex:]
	for _, required := range []string{
		"due_date",
		"priority",
	} {
		if !strings.Contains(outerSelect, required) {
			t.Fatalf("postgres kanban projection card list outer select missing %s", required)
		}
	}
	for _, removed := range []string{
		"assignee_user_id",
		"assignee_display_name",
		"assignee_email",
	} {
		if strings.Contains(outerSelect, removed) {
			t.Fatalf("postgres kanban projection card list outer select still contains removed %s", removed)
		}
	}
}

func TestLogicGateWorkFastPathMigrationMatchesCanonicalSchema(t *testing.T) {
	for _, path := range []string{
		"../../db/migrations/20260711_logic_gate_work_fast_path.sql",
		"../../db/schema.sql",
	} {
		source, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", path, err)
		}
		normalized := strings.ToLower(string(source))
		for _, required := range []string{
			"status_rank smallint generated always as",
			"company_id, logic_gate_id, status_rank, position",
			"assignment_created_timestamp, assignment_id",
			"create table if not exists logic_gate_work_versions",
			"primary key (company_id, logic_gate_id)",
			"logic_gate_work_versions_board_key unique (company_id, board_id)",
			"trg_logic_gate_work_version_gate",
			"trg_logic_gate_work_version_permissions",
			"trg_logic_gate_work_version_permission_applications",
			"trg_logic_gate_work_version_gvic",
			"trg_logic_gate_work_version_explorer_items",
			"trg_logic_gate_work_version_explorer_folder_update",
			"trg_logic_gate_work_version_memberships",
			"trg_logic_gate_work_version_group_members",
			"trg_logic_gate_work_version_assignments",
			"trg_logic_gate_work_version_projection",
			"trg_logic_gate_work_version_nodes",
		} {
			if !strings.Contains(normalized, required) {
				t.Fatalf("%s missing Logic Gate fast-path contract %q", path, required)
			}
		}
	}
}

func readPhase4SourceForTest(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile %s: %v", path, err)
	}
	return string(content)
}
