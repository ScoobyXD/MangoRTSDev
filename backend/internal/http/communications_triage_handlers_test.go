package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	nylas := &fakeNylasClient{message: NylasMessage{
		ID:       "http-message-1",
		ThreadID: "http-thread-1",
		Subject:  "HTTP conversion email",
		Snippet:  "Convert me",
		From:     []NylasEmailAddress{{Name: "Customer", Email: "customer@example.com"}},
		Starred:  true,
	}}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: testNylasConfig(),
		NylasClient: nylas,
		EmailQueue:  &recordingEmailQueueSender{},
	})

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
	if nylas.detailCalls != 1 || nylas.lastDetailGrantID != "grant-http" {
		t.Fatalf("explicit import provider reads=%d grant=%q, want one grant-http call", nylas.detailCalls, nylas.lastDetailGrantID)
	}
	var response map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	for _, field := range []string{"board", "cards", "nodes", "assignments", "email_provenance", "deleted_message_ids", "unstarred_message_ids"} {
		if _, ok := response[field]; !ok {
			t.Fatalf("response missing %s: %s", field, rec.Body.String())
		}
	}
	var unstarredMessageIDs []string
	if err := json.Unmarshal(response["unstarred_message_ids"], &unstarredMessageIDs); err != nil {
		t.Fatalf("decode unstarred_message_ids: %v", err)
	}
	if len(unstarredMessageIDs) != 1 || unstarredMessageIDs[0] != "http-message-1" {
		t.Fatalf("unstarred_message_ids = %+v, want http-message-1", unstarredMessageIDs)
	}
	if len(nylas.updateCalls) != 1 {
		t.Fatalf("Nylas update calls = %+v, want one unstar", nylas.updateCalls)
	}
	if nylas.updateCalls[0].GrantID != "grant-http" || nylas.updateCalls[0].MessageID != "http-message-1" || nylas.updateCalls[0].Update.Starred == nil || *nylas.updateCalls[0].Update.Starred {
		t.Fatalf("Nylas unstar update = %+v, want grant-http/http-message-1/starred=false", nylas.updateCalls[0])
	}
	if _, ok := response["events"]; ok {
		t.Fatalf("response leaked hidden committed events: %s", rec.Body.String())
	}

	durable, err := repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, AfterSequence: 0, Limit: 10})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if len(durable) != 5 || durable[0].Type != store.WorkItemEmailConvertedEventType || durable[2].Type != store.WorkItemLogicGateAssignmentSavedEventType {
		t.Fatalf("durable events = %+v, want committed conversion events", durable)
	}
}

func TestCommunicationsTriageConvertUsesSharedInboxConnection(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222202"
	repo.EnsureCompany(companyID, "HTTP Shared Email Conversion Company")
	user, err := repo.UpsertAuthUser("http-shared-email-converter", "shared-converter@example.com", "Shared Converter")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	if _, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
		CompanyID:         companyID,
		Provider:          "google",
		AccountEmail:      "support@example.com",
		GrantID:           "grant-shared-convert",
		Status:            "connected",
		ConnectedByUserID: user.UserID,
	}); err != nil {
		t.Fatalf("UpsertCompanyEmailConnection: %v", err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", "support@example.com")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeSharedInbox,
		EntityID:   folder.FolderID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Shared Support Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	nylas := &fakeNylasClient{message: NylasMessage{
		ID:       "shared-message-1",
		ThreadID: "shared-thread-1",
		Subject:  "Shared conversion email",
		Snippet:  "Convert from shared",
		From:     []NylasEmailAddress{{Name: "Customer", Email: "customer@example.com"}},
		Starred:  true,
	}}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: testNylasConfig(),
		NylasClient: nylas,
		EmailQueue:  &recordingEmailQueueSender{},
	})

	body, _ := json.Marshal(map[string]any{
		"company_id":      companyID,
		"shared_inbox_id": folder.FolderID,
		"logic_gate_id":   logicGate.LogicGateID,
		"message_ids":     []string{"shared-message-1"},
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/communications/triage/convert", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = requestWithActorForTest(req, user, companyID)
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST shared convert status = %d body=%s", rec.Code, rec.Body.String())
	}
	if nylas.detailCalls != 1 || nylas.lastDetailGrantID != "grant-shared-convert" {
		t.Fatalf("explicit shared import provider reads=%d grant=%q, want one grant-shared-convert call", nylas.detailCalls, nylas.lastDetailGrantID)
	}
	var response map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode shared response: %v", err)
	}
	var unstarredMessageIDs []string
	if err := json.Unmarshal(response["unstarred_message_ids"], &unstarredMessageIDs); err != nil {
		t.Fatalf("decode shared unstarred_message_ids: %v", err)
	}
	if len(unstarredMessageIDs) != 1 || unstarredMessageIDs[0] != "shared-message-1" {
		t.Fatalf("shared unstarred_message_ids = %+v, want shared-message-1", unstarredMessageIDs)
	}
	if len(nylas.updateCalls) != 1 {
		t.Fatalf("shared Nylas update calls = %+v, want one unstar", nylas.updateCalls)
	}
	if nylas.updateCalls[0].GrantID != "grant-shared-convert" || nylas.updateCalls[0].MessageID != "shared-message-1" || nylas.updateCalls[0].Update.Starred == nil || *nylas.updateCalls[0].Update.Starred {
		t.Fatalf("shared Nylas unstar update = %+v, want shared grant/starred=false", nylas.updateCalls[0])
	}
	placements, err := repo.ListCommunicationsEmailPlacements(user.UserID, companyID, []string{"shared-message-1"})
	if err != nil {
		t.Fatalf("ListCommunicationsEmailPlacements: %v", err)
	}
	if len(placements) != 1 || placements[0].LogicGateID != logicGate.LogicGateID {
		t.Fatalf("shared conversion placements = %+v, want shared email attached to gate %s", placements, logicGate.LogicGateID)
	}
	projections, err := repo.ListNodeProjections(companyID, placements[0].NodeID)
	if err != nil || len(projections) != 2 || projections[0].Type != "Attached email" || projections[1].Type != "Text box" {
		t.Fatalf("shared conversion projections = %+v err=%v", projections, err)
	}
	var projectionPayload map[string]any
	if err := json.Unmarshal([]byte(projections[0].Information), &projectionPayload); err != nil {
		t.Fatalf("decode shared projection: %v", err)
	}
	if projectionPayload["shared_inbox_id"] != folder.FolderID || projectionPayload["account_email"] != "support@example.com" {
		t.Fatalf("shared projection mailbox provenance = %+v", projectionPayload)
	}
}

func TestCommunicationsTriageConvertSelectsExactOwnedPersonalAccount(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222203"
	repo.EnsureCompany(companyID, "Exact Personal Email Conversion Company")
	user, err := repo.UpsertAuthUser("exact-personal-email-converter", "account-a@example.com", "Exact Converter")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	for _, connection := range []store.UserEmailConnectionInput{
		{UserID: user.UserID, Provider: "google", AccountEmail: "account-a@example.com", GrantID: "grant-convert-account-a", Status: "connected"},
		{UserID: user.UserID, Provider: "microsoft", AccountEmail: "account-b@example.com", GrantID: "grant-convert-account-b", Status: "connected"},
	} {
		if _, err := repo.UpsertUserEmailConnection(connection); err != nil {
			t.Fatalf("UpsertUserEmailConnection: %v", err)
		}
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Exact Account Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	nylas := &fakeNylasClient{message: NylasMessage{
		ID:       "account-b-message",
		ThreadID: "account-b-thread",
		Subject:  "Account B conversion email",
		From:     []NylasEmailAddress{{Email: "customer@example.com"}},
		Starred:  true,
	}}
	server := NewServerWithOptions(repo, ServerOptions{NylasConfig: testNylasConfig(), NylasClient: nylas, EmailQueue: &recordingEmailQueueSender{}})
	body, _ := json.Marshal(map[string]any{
		"company_id":    companyID,
		"logic_gate_id": logicGate.LogicGateID,
		"message_ids":   []string{"account-b-message"},
	})
	path := "/v1/communications/triage/convert?account_email=" + url.QueryEscape("ACCOUNT-B@EXAMPLE.COM")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = requestWithActorForTest(req, user, companyID)
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST exact account convert status = %d body=%s", rec.Code, rec.Body.String())
	}
	if nylas.detailCalls != 1 || nylas.lastDetailGrantID != "grant-convert-account-b" {
		t.Fatalf("explicit exact-account import provider reads=%d grant=%q, want one account B call", nylas.detailCalls, nylas.lastDetailGrantID)
	}
	if len(nylas.updateCalls) != 1 || nylas.updateCalls[0].GrantID != "grant-convert-account-b" {
		t.Fatalf("Nylas update calls = %+v, want exact account B grant", nylas.updateCalls)
	}
	placements, err := repo.ListCommunicationsEmailPlacements(user.UserID, companyID, []string{"account-b-message"})
	if err != nil || len(placements) != 1 {
		t.Fatalf("ListCommunicationsEmailPlacements = %+v err=%v", placements, err)
	}
	projections, err := repo.ListNodeProjections(companyID, placements[0].NodeID)
	if err != nil || len(projections) != 2 || projections[0].Type != "Attached email" || projections[1].Type != "Text box" {
		t.Fatalf("ListNodeProjections = %+v err=%v", projections, err)
	}
	var projectionPayload map[string]any
	if err := json.Unmarshal([]byte(projections[0].Information), &projectionPayload); err != nil {
		t.Fatalf("decode projection: %v", err)
	}
	if projectionPayload["account_email"] != "account-b@example.com" {
		t.Fatalf("projection account email = %+v, want account-b@example.com", projectionPayload)
	}
}
