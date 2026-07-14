package store

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryEmailConversionCommandCreatesAssignedWorkItemWithProvenanceAndEvents(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111101"
	repo.EnsureCompany(companyID, "Email Conversion Company")
	user, logicGate := setupEmailConversionUserAndGate(t, repo, companyID)
	message := domain.EmailMessageSnapshot{
		ID:       "message-1",
		ThreadID: "thread-1",
		Subject:  "Customer escalation",
		Snippet:  "Need help with onboarding",
		Date:     1770000000,
		From:     []domain.EmailAddressSnapshot{{Name: "Customer", Email: "customer@example.com"}},
		Unread:   true,
	}
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatalf("UpsertCommunicationsTriageItem: %v", err)
	}

	result, err := repo.ConvertCommunicationsTriageItems(CommunicationsTriageConversionInput{
		UserID:         user.UserID,
		CompanyID:      companyID,
		SharedInboxID:  "shared-inbox-1",
		AccountEmail:   "support@example.com",
		LogicGateID:    logicGate.LogicGateID,
		Status:         "in_progress",
		MessageIDs:     []string{message.ID},
		ActorUserID:    user.UserID,
		IdempotencyKey: "email-convert-1",
	})
	if err != nil {
		t.Fatalf("ConvertCommunicationsTriageItems: %v", err)
	}
	if result.Target.Mode != CommunicationsEmailConversionTargetExistingLogicGate || result.Target.LogicGateID != logicGate.LogicGateID {
		t.Fatalf("target = %+v, want existing Logic Gate %s", result.Target, logicGate.LogicGateID)
	}
	if len(result.Nodes) != 1 || len(result.Cards) != 1 || len(result.Assignments) != 1 || len(result.EmailPlacements) != 1 || len(result.EmailProvenance) != 1 {
		t.Fatalf("conversion result = nodes %d cards %d assignments %d placements %d provenance %d", len(result.Nodes), len(result.Cards), len(result.Assignments), len(result.EmailPlacements), len(result.EmailProvenance))
	}
	node := result.Nodes[0]
	card := result.Cards[0]
	assignment := result.Assignments[0]
	if node.Title != message.Subject || node.Status == nil || *node.Status != "In Progress" {
		t.Fatalf("node = %+v, want email title and In Progress status", node)
	}
	if node.Priority == nil || *node.Priority != CommunicationsTriageConversionDefaultPriority {
		t.Fatalf("node priority = %+v, want default %d", node.Priority, CommunicationsTriageConversionDefaultPriority)
	}
	if !stringSliceContains(node.LogicGateIDs, logicGate.LogicGateID) {
		t.Fatalf("node logic_gate_ids = %+v, want %s", node.LogicGateIDs, logicGate.LogicGateID)
	}
	if assignment.NodeID != node.NodeID || assignment.LogicGateID != logicGate.LogicGateID || assignment.StatusKey != "in progress" || assignment.ColumnID != card.ColumnID {
		t.Fatalf("assignment = %+v, card = %+v", assignment, card)
	}
	if assignment.CompatibilityBoardID != card.BoardID || assignment.CompatibilityCardID != card.CardID {
		t.Fatalf("assignment compatibility = %+v, card = %+v", assignment, card)
	}
	cards, err := repo.ListKanbanCards(companyID, card.BoardID, KanbanCardQuery{Limit: 10})
	if err != nil || len(cards) != 1 || cards[0].CardID != card.CardID || cards[0].NodeID != node.NodeID {
		t.Fatalf("compatibility cards = %+v err=%v, want converted card", cards, err)
	}
	assignments, err := repo.ListNodeLogicGateAssignments(companyID, node.NodeID)
	if err != nil || len(assignments) != 1 || assignments[0].AssignmentID != assignment.AssignmentID {
		t.Fatalf("assignment source rows = %+v err=%v", assignments, err)
	}
	placements, err := repo.ListCommunicationsEmailPlacements(user.UserID, companyID, []string{message.ID})
	if err != nil || len(placements) != 1 || placements[0].NodeID != node.NodeID || placements[0].LogicGateID != logicGate.LogicGateID {
		t.Fatalf("email placements = %+v err=%v", placements, err)
	}
	provenance := result.EmailProvenance[0]
	if provenance.MessageID != message.ID || provenance.ThreadID != message.ThreadID || provenance.NodeID != node.NodeID || provenance.CardID != card.CardID {
		t.Fatalf("provenance = %+v, want original email/message/thread and created work item IDs", provenance)
	}
	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil || len(projections) != 1 || projections[0].Type != "Attached email" {
		t.Fatalf("email projections = %+v err=%v", projections, err)
	}
	var projectionPayload map[string]any
	if err := json.Unmarshal([]byte(projections[0].Information), &projectionPayload); err != nil {
		t.Fatalf("projection payload json: %v", err)
	}
	if projectionPayload["message_id"] != message.ID || projectionPayload["thread_id"] != message.ThreadID || projectionPayload["shared_inbox_id"] != "shared-inbox-1" || projectionPayload["account_email"] != "support@example.com" {
		t.Fatalf("projection payload = %+v, want message/thread/mailbox provenance", projectionPayload)
	}
	triageItems := communicationsTriageItemsForTest(repo, user.UserID)
	if len(triageItems) != 0 {
		t.Fatalf("triage items after conversion = %+v, want deleted", triageItems)
	}
	durable, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	wantTypes := []string{WorkItemEmailConvertedEventType, "node_created", WorkItemLogicGateAssignmentSavedEventType, "kanban_card_upserted", "node_updated"}
	if gotTypes := domainEventTypes(durable); !reflect.DeepEqual(gotTypes, wantTypes) {
		t.Fatalf("durable event types = %+v, want %+v", gotTypes, wantTypes)
	}
	if durable[0].Payload["message_id"] != message.ID || durable[0].Payload["thread_id"] != message.ThreadID || durable[0].Payload["idempotency_key"] != "email-convert-1" {
		t.Fatalf("email conversion event payload = %+v", durable[0].Payload)
	}
	if durable[0].ActorUserID == nil || *durable[0].ActorUserID != user.UserID {
		t.Fatalf("email conversion actor = %+v, want %s", durable[0].ActorUserID, user.UserID)
	}
}

func TestMemoryEmailConversionCommandCanCreateNewLogicGate(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111102"
	repo.EnsureCompany(companyID, "Email Conversion Company")
	user, _ := setupEmailConversionUserAndGate(t, repo, companyID)
	message := domain.EmailMessageSnapshot{ID: "message-new-gate", ThreadID: "thread-new-gate", Subject: "Create a gate from email"}
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatalf("UpsertCommunicationsTriageItem: %v", err)
	}

	result, err := repo.ConvertCommunicationsTriageItems(CommunicationsTriageConversionInput{
		UserID:    user.UserID,
		CompanyID: companyID,
		Target: CommunicationsTriageConversionTarget{
			Mode:   CommunicationsEmailConversionTargetNewLogicGate,
			Header: "Email Intake Gate",
		},
		MessageIDs: []string{message.ID},
	})
	if err != nil {
		t.Fatalf("ConvertCommunicationsTriageItems new gate: %v", err)
	}
	if !result.CreatedLogicGate || result.LogicGate.LogicGateID == "" || result.LogicGate.Header != "Email Intake Gate" {
		t.Fatalf("logic gate result = created %v gate %+v", result.CreatedLogicGate, result.LogicGate)
	}
	if result.Assignments[0].LogicGateID != result.LogicGate.LogicGateID || result.EmailProvenance[0].LogicGateID != result.LogicGate.LogicGateID {
		t.Fatalf("assignment/provenance not attached to new gate: %+v %+v", result.Assignments[0], result.EmailProvenance[0])
	}
	durable, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if len(durable) == 0 || durable[0].Type != "logic_gate_created" || durable[1].Type != WorkItemEmailConvertedEventType {
		t.Fatalf("durable events = %+v, want logic gate created then email converted", domainEventTypes(durable))
	}
}

func TestMemoryEmailConversionCommandAttachesEmailToExistingNode(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111106"
	repo.EnsureCompany(companyID, "Email Conversion Company")
	user, logicGate := setupEmailConversionUserAndGate(t, repo, companyID)
	node, err := repo.CreateNode(companyID, "Existing customer node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	initialPriority := 4
	assignmentResult, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Priority:    &initialPriority,
		PrioritySet: true,
		Status:      "pending",
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	baselineEvents, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter baseline: %v", err)
	}
	afterSequence := int64(0)
	if len(baselineEvents) > 0 {
		afterSequence = baselineEvents[len(baselineEvents)-1].Sequence
	}
	message := domain.EmailMessageSnapshot{ID: "message-existing-node", ThreadID: "thread-existing-node", Subject: "Attach this email"}
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatalf("UpsertCommunicationsTriageItem: %v", err)
	}

	priority := 2
	result, err := repo.ConvertCommunicationsTriageItems(CommunicationsTriageConversionInput{
		UserID:       user.UserID,
		CompanyID:    companyID,
		AccountEmail: "owner@example.test",
		LogicGateID:  logicGate.LogicGateID,
		NodeID:       node.NodeID,
		Target: CommunicationsTriageConversionTarget{
			Mode:        CommunicationsEmailConversionTargetExistingNode,
			LogicGateID: logicGate.LogicGateID,
			NodeID:      node.NodeID,
		},
		MessageIDs:  []string{message.ID},
		Priority:    &priority,
		PrioritySet: true,
	})
	if err != nil {
		t.Fatalf("ConvertCommunicationsTriageItems existing node: %v", err)
	}
	if result.Target.Mode != CommunicationsEmailConversionTargetExistingNode || result.Target.NodeID != node.NodeID {
		t.Fatalf("target = %+v, want existing node %s", result.Target, node.NodeID)
	}
	if len(result.Nodes) != 1 || result.Nodes[0].NodeID != node.NodeID {
		t.Fatalf("result nodes = %+v, want existing node", result.Nodes)
	}
	if result.Nodes[0].Priority == nil || *result.Nodes[0].Priority != priority {
		t.Fatalf("node priority = %+v, want %d", result.Nodes[0].Priority, priority)
	}
	if len(result.FolderItems) != 0 {
		t.Fatalf("folder items = %+v, want none for existing node attachment", result.FolderItems)
	}
	if len(result.Cards) != 1 || result.Cards[0].CardID != assignmentResult.Card.CardID {
		t.Fatalf("cards = %+v, want existing assignment card %s", result.Cards, assignmentResult.Card.CardID)
	}
	placements, err := repo.ListCommunicationsEmailPlacements(user.UserID, companyID, []string{message.ID})
	if err != nil || len(placements) != 1 || placements[0].NodeID != node.NodeID || placements[0].LogicGateID != logicGate.LogicGateID {
		t.Fatalf("email placements = %+v err=%v", placements, err)
	}
	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil || len(projections) != 1 || projections[0].Type != "Attached email" {
		t.Fatalf("email projections = %+v err=%v", projections, err)
	}
	var projectionPayload map[string]any
	if err := json.Unmarshal([]byte(projections[0].Information), &projectionPayload); err != nil {
		t.Fatalf("projection payload json: %v", err)
	}
	if projectionPayload["message_id"] != message.ID || projectionPayload["thread_id"] != message.ThreadID || projectionPayload["account_email"] != "owner@example.test" {
		t.Fatalf("projection payload = %+v, want message/thread/personal mailbox provenance", projectionPayload)
	}
	nodes, err := repo.ListNodes(companyID)
	if err != nil || len(nodes) != 1 || nodes[0].NodeID != node.NodeID {
		t.Fatalf("nodes after attach = %+v err=%v, want no created node", nodes, err)
	}
	triageItems := communicationsTriageItemsForTest(repo, user.UserID)
	if len(triageItems) != 0 {
		t.Fatalf("triage items after attach = %+v, want deleted", triageItems)
	}
	durable, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: afterSequence, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if gotTypes, wantTypes := domainEventTypes(durable), []string{WorkItemEmailConvertedEventType, "node_updated"}; !reflect.DeepEqual(gotTypes, wantTypes) {
		t.Fatalf("durable event types = %+v, want %+v", gotTypes, wantTypes)
	}
}

func TestMemoryEmailNodeTransferAttachesEmailAndDeletesSourceNode(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111110"
	repo.EnsureCompany(companyID, "Email Conversion Company")
	user, logicGate := setupEmailConversionUserAndGate(t, repo, companyID)
	targetNode, err := repo.CreateNode(companyID, "Target customer node")
	if err != nil {
		t.Fatalf("CreateNode target: %v", err)
	}
	targetPriority := 2
	targetAssignment, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      targetNode.NodeID,
		Priority:    &targetPriority,
		PrioritySet: true,
		Status:      "pending",
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus target: %v", err)
	}
	message := domain.EmailMessageSnapshot{ID: "message-transfer-node", ThreadID: "thread-transfer-node", Subject: "Transfer this email"}
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatalf("UpsertCommunicationsTriageItem: %v", err)
	}
	sourceConversion, err := repo.ConvertCommunicationsTriageItems(CommunicationsTriageConversionInput{
		UserID:      user.UserID,
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		MessageIDs:  []string{message.ID},
	})
	if err != nil {
		t.Fatalf("ConvertCommunicationsTriageItems source: %v", err)
	}
	if len(sourceConversion.Cards) != 1 || !sourceConversion.Cards[0].CreatedFromEmail {
		t.Fatalf("source conversion card = %+v, want created_from_email card", sourceConversion.Cards)
	}
	sourceCard := sourceConversion.Cards[0]
	sourceNodeID := sourceConversion.Nodes[0].NodeID
	listedSourceCard, err := repo.GetKanbanCard(companyID, sourceCard.BoardID, sourceCard.CardID)
	if err != nil || !listedSourceCard.CreatedFromEmail {
		t.Fatalf("GetKanbanCard source = %+v err=%v, want created_from_email", listedSourceCard, err)
	}

	transfer, err := repo.TransferCommunicationsEmailNode(CommunicationsEmailNodeTransferInput{
		CompanyID:     companyID,
		SourceBoardID: sourceCard.BoardID,
		SourceCardID:  sourceCard.CardID,
		TargetBoardID: targetAssignment.Card.BoardID,
		TargetCardID:  targetAssignment.Card.CardID,
	})
	if err != nil {
		t.Fatalf("TransferCommunicationsEmailNode: %v", err)
	}
	if transfer.DeletedNodeID != sourceNodeID || transfer.DeletedCardID != sourceCard.CardID || transfer.SourceBoardID != sourceCard.BoardID {
		t.Fatalf("transfer deleted source = %+v, want node %s card %s board %s", transfer, sourceNodeID, sourceCard.CardID, sourceCard.BoardID)
	}
	if transfer.EmailPlacement.NodeID != targetNode.NodeID || transfer.EmailPlacement.CardID != targetAssignment.Card.CardID || transfer.EmailPlacement.LogicGateID != logicGate.LogicGateID {
		t.Fatalf("transfer placement = %+v, want target node/card/gate", transfer.EmailPlacement)
	}
	if transfer.EmailPlacement.UserID != user.UserID {
		t.Fatalf("transfer placement user_id = %q, want original email owner %q", transfer.EmailPlacement.UserID, user.UserID)
	}
	if _, err := repo.GetKanbanCard(companyID, sourceCard.BoardID, sourceCard.CardID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("source card after transfer err=%v, want ErrNotFound", err)
	}
	if _, err := repo.GetNode(companyID, sourceNodeID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("source node after transfer err=%v, want ErrNotFound", err)
	}
	targetCard, err := repo.GetKanbanCard(companyID, targetAssignment.Card.BoardID, targetAssignment.Card.CardID)
	if err != nil {
		t.Fatalf("GetKanbanCard target: %v", err)
	}
	if targetCard.CreatedFromEmail {
		t.Fatalf("target card created_from_email = true, want false for normal node with attached email")
	}
	placements, err := repo.ListCommunicationsEmailPlacements(user.UserID, companyID, []string{message.ID})
	if err != nil || len(placements) != 1 || placements[0].NodeID != targetNode.NodeID || placements[0].CardID != targetAssignment.Card.CardID {
		t.Fatalf("email placements after transfer = %+v err=%v, want target placement", placements, err)
	}
	projections, err := repo.ListNodeProjections(companyID, targetNode.NodeID)
	if err != nil || len(projections) != 1 || projections[0].Type != "Attached email" {
		t.Fatalf("target email projections = %+v err=%v, want attached email", projections, err)
	}
	nodes, err := repo.ListNodes(companyID)
	if err != nil || len(nodes) != 1 || nodes[0].NodeID != targetNode.NodeID {
		t.Fatalf("nodes after transfer = %+v err=%v, want only target node", nodes, err)
	}
	triageItems := communicationsTriageItemsForTest(repo, user.UserID)
	if len(triageItems) != 0 {
		t.Fatalf("triage items after transfer = %+v, want none", triageItems)
	}
}

func TestMemoryEmailConversionCommandRejectsExplorerFolderTarget(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111107"
	repo.EnsureCompany(companyID, "Email Conversion Company")
	user, _ := setupEmailConversionUserAndGate(t, repo, companyID)
	targetFolder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID:        companyID,
		ParentEntityID:   companyID,
		Name:             "Email Drops",
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder: %v", err)
	}
	baselineEvents, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter baseline: %v", err)
	}
	afterSequence := int64(0)
	if len(baselineEvents) > 0 {
		afterSequence = baselineEvents[len(baselineEvents)-1].Sequence
	}
	message := domain.EmailMessageSnapshot{ID: "message-folder-target", ThreadID: "thread-folder-target", Subject: "Create this in Explorer"}
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatalf("UpsertCommunicationsTriageItem: %v", err)
	}

	_, err = repo.ConvertCommunicationsTriageItems(CommunicationsTriageConversionInput{
		UserID:    user.UserID,
		CompanyID: companyID,
		Target: CommunicationsTriageConversionTarget{
			Mode:           CommunicationsEmailConversionTargetFolder,
			ParentEntityID: targetFolder.EntityID,
		},
		MessageIDs: []string{message.ID},
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("ConvertCommunicationsTriageItems folder target err = %v, want ErrInvalid", err)
	}

	triageItems := communicationsTriageItemsForTest(repo, user.UserID)
	if len(triageItems) != 1 || triageItems[0].MessageID != message.ID {
		t.Fatalf("triage items after rejected folder conversion = %+v, want original message", triageItems)
	}
	nodes, err := repo.ListNodes(companyID)
	if err != nil || len(nodes) != 0 {
		t.Fatalf("nodes after rejected folder conversion = %+v err=%v, want none", nodes, err)
	}
	children, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		ParentEntityID:   targetFolder.EntityID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows: %v", err)
	}
	if len(children.Rows) != 0 {
		t.Fatalf("folder children after rejected folder conversion = %+v, want none", children.Rows)
	}
	durable, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: afterSequence, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if len(durable) != 0 {
		t.Fatalf("durable event types = %+v, want none", domainEventTypes(durable))
	}
}

func TestMemoryEmailConversionCommandCreatesNodeInProjectTarget(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111108"
	repo.EnsureCompany(companyID, "Email Conversion Company")
	user, _ := setupEmailConversionUserAndGate(t, repo, companyID)
	projectResult, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Email Project", Status: "Active", ActorUserID: user.UserID})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if projectResult.Project == nil {
		t.Fatalf("CreateProject returned nil project")
	}
	project := projectResult.Project
	baselineEvents, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter baseline: %v", err)
	}
	afterSequence := int64(0)
	if len(baselineEvents) > 0 {
		afterSequence = baselineEvents[len(baselineEvents)-1].Sequence
	}
	message := domain.EmailMessageSnapshot{ID: "message-project-target", ThreadID: "thread-project-target", Subject: "Create this in project"}
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatalf("UpsertCommunicationsTriageItem: %v", err)
	}

	result, err := repo.ConvertCommunicationsTriageItems(CommunicationsTriageConversionInput{
		UserID:    user.UserID,
		CompanyID: companyID,
		Target: CommunicationsTriageConversionTarget{
			Mode:      CommunicationsEmailConversionTargetProject,
			ProjectID: project.ProjectID,
		},
		MessageIDs: []string{message.ID},
	})
	if err != nil {
		t.Fatalf("ConvertCommunicationsTriageItems project target: %v", err)
	}
	if len(result.Nodes) != 1 || result.Nodes[0].Title != message.Subject {
		t.Fatalf("nodes = %+v, want one created email node", result.Nodes)
	}
	if len(result.ProjectRelationships) != 1 {
		t.Fatalf("project relationships = %+v, want one relationship", result.ProjectRelationships)
	}
	relationship := result.ProjectRelationships[0]
	if relationship.ProjectID != project.ProjectID || relationship.ResourceType != EntityTypeNode || relationship.ResourceID != result.Nodes[0].NodeID || relationship.NodeID == nil || *relationship.NodeID != result.Nodes[0].NodeID {
		t.Fatalf("project relationship = %+v, want node relationship for %s", relationship, result.Nodes[0].NodeID)
	}
	if !relationship.CreatedFromEmail {
		t.Fatalf("project relationship created_from_email = false, want true")
	}
	relationships, err := repo.ListProjectRelationshipProjections(companyID, project.ProjectID)
	if err != nil {
		t.Fatalf("ListProjectRelationshipProjections: %v", err)
	}
	if len(relationships) != 1 || relationships[0].RelationshipID != relationship.RelationshipID {
		t.Fatalf("relationships = %+v, want created relationship %s", relationships, relationship.RelationshipID)
	}
	durable, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: afterSequence, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	wantTypes := []string{WorkItemEmailConvertedEventType, "node_created", "node_updated", "project_relationship_upserted"}
	if gotTypes := domainEventTypes(durable); !reflect.DeepEqual(gotTypes, wantTypes) {
		t.Fatalf("durable event types = %+v, want %+v", gotTypes, wantTypes)
	}
}

func TestMemoryEmailConversionCommandCreatesNodeInProjectLogicGateTarget(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111118"
	repo.EnsureCompany(companyID, "Email Conversion Company")
	user, logicGate := setupEmailConversionUserAndGate(t, repo, companyID)
	projectResult, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Email Project Gate", Status: "Active", ActorUserID: user.UserID})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if projectResult.Project == nil {
		t.Fatalf("CreateProject returned nil project")
	}
	project := projectResult.Project
	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID:    companyID,
		ProjectID:    project.ProjectID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Position:     1,
		ActorUserID:  user.UserID,
	}); err != nil {
		t.Fatalf("UpsertProjectRelationship logic gate: %v", err)
	}
	baselineEvents, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter baseline: %v", err)
	}
	afterSequence := int64(0)
	if len(baselineEvents) > 0 {
		afterSequence = baselineEvents[len(baselineEvents)-1].Sequence
	}
	message := domain.EmailMessageSnapshot{ID: "message-project-gate-target", ThreadID: "thread-project-gate-target", Subject: "Create this in project gate"}
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatalf("UpsertCommunicationsTriageItem: %v", err)
	}

	result, err := repo.ConvertCommunicationsTriageItems(CommunicationsTriageConversionInput{
		UserID:    user.UserID,
		CompanyID: companyID,
		Target: CommunicationsTriageConversionTarget{
			Mode:        CommunicationsEmailConversionTargetExistingLogicGate,
			LogicGateID: logicGate.LogicGateID,
			ProjectID:   project.ProjectID,
		},
		MessageIDs: []string{message.ID},
	})
	if err != nil {
		t.Fatalf("ConvertCommunicationsTriageItems project logic gate target: %v", err)
	}
	if len(result.Nodes) != 1 || len(result.Cards) != 1 || len(result.Assignments) != 1 || len(result.ProjectRelationships) != 1 {
		t.Fatalf("result nodes/cards/assignments/project relationships = %d/%d/%d/%d, want one each", len(result.Nodes), len(result.Cards), len(result.Assignments), len(result.ProjectRelationships))
	}
	node := result.Nodes[0]
	relationship := result.ProjectRelationships[0]
	if relationship.ProjectID != project.ProjectID || relationship.ResourceType != EntityTypeNode || relationship.ResourceID != node.NodeID {
		t.Fatalf("project relationship = %+v, want node relationship for %s", relationship, node.NodeID)
	}
	if relationship.LogicGateID == nil || *relationship.LogicGateID != logicGate.LogicGateID {
		t.Fatalf("project relationship logic gate = %+v, want %s", relationship.LogicGateID, logicGate.LogicGateID)
	}
	if relationship.AssignmentID == nil || *relationship.AssignmentID != result.Assignments[0].AssignmentID {
		t.Fatalf("project relationship assignment = %+v, want %s", relationship.AssignmentID, result.Assignments[0].AssignmentID)
	}
	if !relationship.CreatedFromEmail || !result.Cards[0].CreatedFromEmail {
		t.Fatalf("email origin flags relationship/card = %v/%v, want true/true", relationship.CreatedFromEmail, result.Cards[0].CreatedFromEmail)
	}
	relationships, err := repo.ListProjectRelationshipProjections(companyID, project.ProjectID)
	if err != nil {
		t.Fatalf("ListProjectRelationshipProjections: %v", err)
	}
	if len(relationships) != 2 {
		t.Fatalf("relationships = %+v, want gate and created node", relationships)
	}
	var foundNode bool
	for _, item := range relationships {
		if item.ResourceType == EntityTypeNode && item.ResourceID == node.NodeID && item.CreatedFromEmail {
			foundNode = true
			break
		}
	}
	if !foundNode {
		t.Fatalf("relationships = %+v, want created email node relationship", relationships)
	}
	durable, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: afterSequence, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	wantTypes := []string{WorkItemEmailConvertedEventType, "node_created", WorkItemLogicGateAssignmentSavedEventType, "kanban_card_upserted", "node_updated", "project_relationship_upserted"}
	if gotTypes := domainEventTypes(durable); !reflect.DeepEqual(gotTypes, wantTypes) {
		t.Fatalf("durable event types = %+v, want %+v", gotTypes, wantTypes)
	}
}

func TestMemoryEmailConversionCommandAttachesEmailToStandaloneExistingNode(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111109"
	repo.EnsureCompany(companyID, "Email Conversion Company")
	user, _ := setupEmailConversionUserAndGate(t, repo, companyID)
	node, err := repo.CreateNode(companyID, "Standalone customer node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	baselineEvents, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter baseline: %v", err)
	}
	afterSequence := int64(0)
	if len(baselineEvents) > 0 {
		afterSequence = baselineEvents[len(baselineEvents)-1].Sequence
	}
	message := domain.EmailMessageSnapshot{ID: "message-standalone-node", ThreadID: "thread-standalone-node", Subject: "Attach to standalone"}
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatalf("UpsertCommunicationsTriageItem: %v", err)
	}
	priority := 1

	result, err := repo.ConvertCommunicationsTriageItems(CommunicationsTriageConversionInput{
		UserID:    user.UserID,
		CompanyID: companyID,
		Target: CommunicationsTriageConversionTarget{
			Mode:   CommunicationsEmailConversionTargetExistingNode,
			NodeID: node.NodeID,
		},
		MessageIDs:  []string{message.ID},
		Priority:    &priority,
		PrioritySet: true,
	})
	if err != nil {
		t.Fatalf("ConvertCommunicationsTriageItems standalone node: %v", err)
	}
	if len(result.Nodes) != 1 || result.Nodes[0].NodeID != node.NodeID {
		t.Fatalf("result nodes = %+v, want existing node", result.Nodes)
	}
	if len(result.Cards) != 0 || len(result.Assignments) != 0 || len(result.EmailPlacements) != 0 || len(result.FolderItems) != 0 {
		t.Fatalf("cards/assignments/placements/folder items = %d/%d/%d/%d, want none", len(result.Cards), len(result.Assignments), len(result.EmailPlacements), len(result.FolderItems))
	}
	if result.Nodes[0].Priority == nil || *result.Nodes[0].Priority != priority {
		t.Fatalf("node priority = %+v, want %d", result.Nodes[0].Priority, priority)
	}
	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil || len(projections) != 1 || projections[0].Type != "Attached email" {
		t.Fatalf("email projections = %+v err=%v", projections, err)
	}
	placements, err := repo.ListCommunicationsEmailPlacements(user.UserID, companyID, []string{message.ID})
	if err != nil || len(placements) != 0 {
		t.Fatalf("email placements = %+v err=%v, want none for standalone node", placements, err)
	}
	durable, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: afterSequence, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if gotTypes, wantTypes := domainEventTypes(durable), []string{WorkItemEmailConvertedEventType, "node_updated"}; !reflect.DeepEqual(gotTypes, wantTypes) {
		t.Fatalf("durable event types = %+v, want %+v", gotTypes, wantTypes)
	}
}
func TestMemoryEmailConversionCommandRollsBackPartialWork(t *testing.T) {
	errAppend := errors.New("append failed")

	t.Run("missing selected message", func(t *testing.T) {
		repo := NewMemoryRepo()
		companyID := "11111111-1111-4111-8111-111111111103"
		repo.EnsureCompany(companyID, "Email Conversion Company")
		user, logicGate := setupEmailConversionUserAndGate(t, repo, companyID)
		message := domain.EmailMessageSnapshot{ID: "message-kept", ThreadID: "thread-kept", Subject: "Keep me"}
		if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
			t.Fatalf("UpsertCommunicationsTriageItem: %v", err)
		}
		_, err := repo.ConvertCommunicationsTriageItems(CommunicationsTriageConversionInput{UserID: user.UserID, CompanyID: companyID, LogicGateID: logicGate.LogicGateID, MessageIDs: []string{message.ID, "missing-message"}})
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("err = %v, want ErrNotFound", err)
		}
		assertEmailConversionRolledBack(t, repo, companyID, user.UserID, message.ID)
	})

	t.Run("workspace event append failure", func(t *testing.T) {
		repo := NewMemoryRepo()
		companyID := "11111111-1111-4111-8111-111111111104"
		repo.EnsureCompany(companyID, "Email Conversion Company")
		user, logicGate := setupEmailConversionUserAndGate(t, repo, companyID)
		message := domain.EmailMessageSnapshot{ID: "message-event-fail", ThreadID: "thread-event-fail", Subject: "Rollback me"}
		if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
			t.Fatalf("UpsertCommunicationsTriageItem: %v", err)
		}
		repo.domainEventAppendErr = errAppend
		_, err := repo.ConvertCommunicationsTriageItems(CommunicationsTriageConversionInput{UserID: user.UserID, CompanyID: companyID, LogicGateID: logicGate.LogicGateID, MessageIDs: []string{message.ID}})
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		assertEmailConversionRolledBack(t, repo, companyID, user.UserID, message.ID)
	})
}

func TestMemoryEmailConversionCommandValidatesInputs(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111105"
	repo.EnsureCompany(companyID, "Email Conversion Company")
	user, logicGate := setupEmailConversionUserAndGate(t, repo, companyID)
	message := domain.EmailMessageSnapshot{ID: "message-valid", ThreadID: "thread-valid", Subject: "Validate me"}
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatalf("UpsertCommunicationsTriageItem: %v", err)
	}

	invalidCases := []CommunicationsTriageConversionInput{
		{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, MessageIDs: []string{message.ID}},
		{UserID: user.UserID, LogicGateID: logicGate.LogicGateID, MessageIDs: []string{message.ID}},
		{UserID: user.UserID, CompanyID: companyID, LogicGateID: logicGate.LogicGateID},
		{UserID: user.UserID, CompanyID: companyID, Target: CommunicationsTriageConversionTarget{Mode: "unsupported"}, MessageIDs: []string{message.ID}},
		{UserID: user.UserID, CompanyID: companyID, Target: CommunicationsTriageConversionTarget{Mode: CommunicationsEmailConversionTargetNewLogicGate}, MessageIDs: []string{message.ID}},
		{UserID: user.UserID, CompanyID: companyID, LogicGateID: logicGate.LogicGateID, MessageIDs: []string{message.ID}, Priority: emailConversionPriority(6), PrioritySet: true},
	}
	for _, input := range invalidCases {
		if _, err := repo.ConvertCommunicationsTriageItems(input); !errors.Is(err, ErrInvalid) {
			t.Fatalf("ConvertCommunicationsTriageItems(%+v) err = %v, want ErrInvalid", input, err)
		}
	}
	if _, err := repo.ConvertCommunicationsTriageItems(CommunicationsTriageConversionInput{UserID: user.UserID, CompanyID: companyID, LogicGateID: "missing-gate", MessageIDs: []string{message.ID}}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing logic gate err = %v, want ErrNotFound", err)
	}
	if _, err := repo.ConvertCommunicationsTriageItems(CommunicationsTriageConversionInput{UserID: user.UserID, CompanyID: companyID, LogicGateID: logicGate.LogicGateID, MessageIDs: []string{"missing-message"}}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing message err = %v, want ErrNotFound", err)
	}
	if _, err := repo.ConvertCommunicationsTriageItems(CommunicationsTriageConversionInput{UserID: "missing-user", CompanyID: companyID, LogicGateID: logicGate.LogicGateID, MessageIDs: []string{message.ID}}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing user/message scope err = %v, want ErrNotFound", err)
	}
}

func emailConversionPriority(value int) *int {
	return &value
}

func setupEmailConversionUserAndGate(t *testing.T, repo *MemoryRepo, companyID string) (domain.User, domain.LogicGate) {
	t.Helper()
	suffix := companyID[len(companyID)-4:]
	subject := "email-converter-" + suffix
	user, err := repo.UpsertAuthUser(subject, "converter-"+suffix+"@example.com", "Email Converter")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Support Gate "+suffix)
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: user.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments: %v", err)
	}
	return user, logicGate
}

func assertEmailConversionRolledBack(t *testing.T, repo *MemoryRepo, companyID, userID, messageID string) {
	t.Helper()
	items := communicationsTriageItemsForTest(repo, userID)
	if len(items) != 1 || items[0].MessageID != messageID {
		t.Fatalf("triage after failed conversion = %+v, want original item", items)
	}
	nodes, err := repo.ListNodes(companyID)
	if err != nil || len(nodes) != 0 {
		t.Fatalf("nodes after failed conversion = %+v err=%v, want none", nodes, err)
	}
	assignments, err := repo.ListNodeLogicGateAssignments(companyID, "")
	if err != nil || len(assignments) != 0 {
		t.Fatalf("assignments after failed conversion = %+v err=%v, want none", assignments, err)
	}
	placements, err := repo.ListCommunicationsEmailPlacements(userID, companyID, []string{messageID})
	if err != nil || len(placements) != 0 {
		t.Fatalf("placements after failed conversion = %+v err=%v, want none", placements, err)
	}
	assertNoWorkspaceEvents(t, repo, companyID)
}

func communicationsTriageItemsForTest(repo *MemoryRepo, userID string) []domain.CommunicationsTriageItem {
	repo.mu.RLock()
	defer repo.mu.RUnlock()
	items := make([]domain.CommunicationsTriageItem, 0)
	for _, item := range repo.triageItems {
		if item.UserID == userID {
			items = append(items, item)
		}
	}
	return items
}

func stringSliceContains(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}
