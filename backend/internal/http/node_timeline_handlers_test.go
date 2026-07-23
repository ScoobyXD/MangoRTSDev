package httpapi

import (
	"bytes"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNodeVerificationRequestAPIIsIdempotentAndRecipientScoped(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "64646464-6464-4464-8464-646464646401"
	repo.EnsureCompany(companyID, "Verification API Co")
	actor := mustLogicGateWorkHTTPUser(t, repo, companyID, "verification-api-actor")
	first := mustLogicGateWorkHTTPUser(t, repo, companyID, "verification-api-first")
	second := mustLogicGateWorkHTTPUser(t, repo, companyID, "verification-api-second")
	outsider := mustLogicGateWorkHTTPUser(t, repo, companyID, "verification-api-outsider")
	node, err := repo.CreateNode(companyID, "Verification API node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetResourceGVICAssignments(store.ResourceGVICAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: store.EntityTypeNode, ResourceID: node.NodeID,
		Assignments: []store.ResourceGVICAssignmentInput{
			{Role: domain.GVICRoleVerified, PrincipalType: store.EntityPermissionSubjectUser, PrincipalID: first.UserID},
			{Role: domain.GVICRoleVerified, PrincipalType: store.EntityPermissionSubjectUser, PrincipalID: second.UserID},
		},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments: %v", err)
	}

	create := func() (int, domain.NodeTimelineEvent) {
		body, _ := json.Marshal(map[string]string{"company_id": companyID})
		req := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/verification-requests", bytes.NewReader(body))
		req.Header.Set("Idempotency-Key", "verification-api-key")
		req = requestWithActorForTest(req, actor, companyID)
		recorder := httptest.NewRecorder()
		server.Routes().ServeHTTP(recorder, req)
		var payload struct {
			TimelineEvent domain.NodeTimelineEvent `json:"timeline_event"`
		}
		if recorder.Code == http.StatusCreated {
			if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode create response: %v body=%s", err, recorder.Body.String())
			}
		}
		return recorder.Code, payload.TimelineEvent
	}
	status, created := create()
	if status != http.StatusCreated || created.EventID == "" || len(created.VerificationRecipients) != 2 {
		t.Fatalf("create status=%d event=%+v", status, created)
	}
	status, replayed := create()
	if status != http.StatusCreated || replayed.EventID != created.EventID {
		t.Fatalf("idempotent create status=%d event=%+v", status, replayed)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+node.NodeID+"/timeline-events?company_id="+companyID, nil)
	listReq = requestWithActorForTest(listReq, actor, companyID)
	listRecorder := httptest.NewRecorder()
	server.Routes().ServeHTTP(listRecorder, listReq)
	if listRecorder.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", listRecorder.Code, listRecorder.Body.String())
	}

	complete := func(user domain.User) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"company_id": companyID})
		req := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/verification-requests/"+created.EventID+"/complete", bytes.NewReader(body))
		req = requestWithActorForTest(req, user, companyID)
		recorder := httptest.NewRecorder()
		server.Routes().ServeHTTP(recorder, req)
		return recorder
	}
	if recorder := complete(outsider); recorder.Code != http.StatusNotFound {
		t.Fatalf("outsider completion status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	firstCompletion := complete(first)
	if firstCompletion.Code != http.StatusOK {
		t.Fatalf("recipient completion status=%d body=%s", firstCompletion.Code, firstCompletion.Body.String())
	}
	var completionPayload struct {
		TimelineEvent domain.NodeTimelineEvent `json:"timeline_event"`
	}
	if err := json.Unmarshal(firstCompletion.Body.Bytes(), &completionPayload); err != nil {
		t.Fatalf("decode completion: %v", err)
	}
	completedByUser := map[string]bool{}
	for _, recipient := range completionPayload.TimelineEvent.VerificationRecipients {
		completedByUser[recipient.UserID] = recipient.CompletedTimestamp != nil
	}
	if !completedByUser[first.UserID] || completedByUser[second.UserID] {
		t.Fatalf("completion state = %v", completedByUser)
	}
}
