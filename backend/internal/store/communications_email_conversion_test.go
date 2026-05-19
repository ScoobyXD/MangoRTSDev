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
	if node.AssigneeUserID == nil || *node.AssigneeUserID != user.UserID {
		t.Fatalf("node assignee = %+v, want responsible user %s", node.AssigneeUserID, user.UserID)
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
	if projectionPayload["message_id"] != message.ID || projectionPayload["thread_id"] != message.ThreadID {
		t.Fatalf("projection payload = %+v, want message/thread provenance", projectionPayload)
	}
	triageItems, err := repo.ListCommunicationsTriageItems(user.UserID)
	if err != nil || len(triageItems) != 0 {
		t.Fatalf("triage items after conversion = %+v err=%v, want deleted", triageItems, err)
	}
	durable, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	wantTypes := []string{WorkItemEmailConvertedEventType, "company_explorer_folder_item_assigned", "node_created", WorkItemLogicGateAssignmentSavedEventType, "kanban_card_upserted", "node_updated"}
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
	if _, err := repo.SetLogicGateRaciAssignments(LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{Role: domain.LogicGateRaciRoleResponsible, UserID: user.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments: %v", err)
	}
	return user, logicGate
}

func assertEmailConversionRolledBack(t *testing.T, repo *MemoryRepo, companyID, userID, messageID string) {
	t.Helper()
	items, err := repo.ListCommunicationsTriageItems(userID)
	if err != nil || len(items) != 1 || items[0].MessageID != messageID {
		t.Fatalf("triage after failed conversion = %+v err=%v, want original item", items, err)
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

func stringSliceContains(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}
