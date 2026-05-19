package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestCommunicationsTriageConvertUsesCommittedEmailConversionCommandEvents(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222201"
	repo.EnsureCompany(companyID, "HTTP Email Conversion Company")
	user, err := repo.UpsertAuthUser("http-email-converter", "converter@example.com", "Converter")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("http-email-converter", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{UserID: user.UserID, Provider: "google", AccountEmail: user.Email, GrantID: "grant-http", Status: "connected"}); err != nil {
		t.Fatalf("UpsertUserEmailConnection: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "HTTP Support Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: testNylasConfig(),
		NylasClient: &fakeNylasClient{message: NylasMessage{
			ID:       "http-message-1",
			ThreadID: "http-thread-1",
			Subject:  "HTTP conversion email",
			Snippet:  "Convert me",
			From:     []NylasEmailAddress{{Name: "Customer", Email: "customer@example.com"}},
		}},
	})
	stream := server.hub.subscribe(companyID)
	defer server.hub.unsubscribe(companyID, stream)

	body, _ := json.Marshal(map[string]any{
		"company_id":    companyID,
		"logic_gate_id": logicGate.LogicGateID,
		"status":        "done",
		"message_ids":   []string{"http-message-1"},
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/communications/triage/convert", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "http-email-convert-key")
	req = requestWithActorForTest(req, user, companyID)
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST convert status = %d body=%s", rec.Code, rec.Body.String())
	}
	var response map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	for _, field := range []string{"board", "cards", "nodes", "assignments", "email_provenance", "deleted_message_ids"} {
		if _, ok := response[field]; !ok {
			t.Fatalf("response missing %s: %s", field, rec.Body.String())
		}
	}
	if _, ok := response["events"]; ok {
		t.Fatalf("response leaked hidden committed events: %s", rec.Body.String())
	}

	semantic := readWorkspaceEventForTest(t, stream)
	if semantic.Type != store.WorkItemEmailConvertedEventType || semantic.Data["message_id"] != "http-message-1" || semantic.Data["thread_id"] != "http-thread-1" {
		t.Fatalf("email conversion hub event = %+v", semantic)
	}
	if semantic.Data["actor_user_id"] != user.UserID || semantic.Data["idempotency_key"] != "http-email-convert-key" {
		t.Fatalf("email conversion metadata = %+v", semantic.Data)
	}
	folderEvent := readWorkspaceEventForTest(t, stream)
	nodeCreated := readWorkspaceEventForTest(t, stream)
	assignmentEvent := readWorkspaceEventForTest(t, stream)
	cardEvent := readWorkspaceEventForTest(t, stream)
	nodeUpdated := readWorkspaceEventForTest(t, stream)
	if folderEvent.Type != "company_explorer_folder_item_assigned" || nodeCreated.Type != "node_created" || assignmentEvent.Type != store.WorkItemLogicGateAssignmentSavedEventType || cardEvent.Type != "kanban_card_upserted" || nodeUpdated.Type != "node_updated" {
		t.Fatalf("compatibility hub events = %s / %s / %s / %s / %s", folderEvent.Type, nodeCreated.Type, assignmentEvent.Type, cardEvent.Type, nodeUpdated.Type)
	}
	durable, err := repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, AfterSequence: 0, Limit: 10})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if len(durable) != 6 || durable[0].Type != store.WorkItemEmailConvertedEventType || durable[3].Type != store.WorkItemLogicGateAssignmentSavedEventType {
		t.Fatalf("durable events = %+v, want committed conversion events", durable)
	}
}
