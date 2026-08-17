package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

type nodeEmailRelationshipFailureRepo struct {
	store.Repository
	addErr    error
	deleteErr error
}

func (r *nodeEmailRelationshipFailureRepo) AddNodeInformationWithActor(store.NodeInformationInput) (domain.NodeInformation, error) {
	return domain.NodeInformation{}, r.addErr
}

func (r *nodeEmailRelationshipFailureRepo) DeleteNodeProjectionWithActor(store.NodeProjectionDeleteInput) error {
	return r.deleteErr
}

func TestNodeEmailRelationshipMutationErrorsAreSpecific4xxResponses(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"invalid internal identity", store.ErrEmailMessageIdentityInvalid, http.StatusBadRequest, "invalid_email_message_identity"},
		{"missing Node-wide relationship", store.ErrEmailMessageNotAttachedToNode, http.StatusConflict, "email_message_not_attached_to_node"},
		{"already linked to another textbox", store.ErrEmailMessageTextboxConflict, http.StatusConflict, "email_message_already_linked_to_another_textbox"},
		{"anchored chat blocks removal", store.ErrEmailRelationshipRequiredByChat, http.StatusConflict, "email_relationship_required_by_chat"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			if !writeNodeEmailRelationshipMutationError(recorder, errors.Join(errors.New("wrapped"), test.err)) {
				t.Fatal("email relationship error was not handled")
			}
			if recorder.Code != test.status {
				t.Fatalf("status=%d body=%s, want %d", recorder.Code, recorder.Body.String(), test.status)
			}
			var body map[string]string
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body["error"] != test.code {
				t.Fatalf("error=%q, want %q", body["error"], test.code)
			}
		})
	}
}

func TestNodeEmailRelationshipRoutesReturnSpecific4xxResponses(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		method string
		status int
		code   string
	}{
		{"provider identity", store.ErrEmailMessageIdentityInvalid, http.MethodPost, http.StatusBadRequest, "invalid_email_message_identity"},
		{"message missing from Node", store.ErrEmailMessageNotAttachedToNode, http.MethodPost, http.StatusConflict, "email_message_not_attached_to_node"},
		{"message already in another textbox", store.ErrEmailMessageTextboxConflict, http.MethodPost, http.StatusConflict, "email_message_already_linked_to_another_textbox"},
		{"anchored chat blocks delete", store.ErrEmailRelationshipRequiredByChat, http.MethodDelete, http.StatusConflict, "email_relationship_required_by_chat"},
		{"Node-wide relationship has local work", store.ErrEmailRelationshipHasNodeWork, http.MethodDelete, http.StatusConflict, "email_removal_has_node_work"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			base := store.NewMemoryRepo()
			companyID := "11111111-1111-4111-8111-701300000211"
			base.EnsureCompany(companyID, "Node email relationship error company")
			actor, err := base.UpsertAuthUser("node-email-relationship-error-admin", "node-email-relationship-error@example.test", "Node Email Relationship Admin")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := base.AddCompanyMembership("node-email-relationship-error-admin", companyID, domain.RoleCompanyAdmin); err != nil {
				t.Fatal(err)
			}
			node, err := base.CreateNode(companyID, "Node email relationship error")
			if err != nil {
				t.Fatal(err)
			}
			repo := &nodeEmailRelationshipFailureRepo{Repository: base}
			var request *http.Request
			if test.method == http.MethodDelete {
				repo.deleteErr = test.err
				request = httptest.NewRequest(http.MethodDelete,
					"/v1/nodes/"+node.NodeID+"/projection/00000000-0000-4000-8000-000000000212?company_id="+companyID, nil)
			} else {
				repo.addErr = test.err
				body, _ := json.Marshal(map[string]any{
					"company_id": companyID, "type": "Attached email", "information": `{}`,
				})
				request = httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/information", bytes.NewReader(body))
			}
			request = attachmentRequestWithActor(request, actor, companyID, domain.RoleCompanyAdmin)
			recorder := httptest.NewRecorder()
			NewServerWithOptions(repo, ServerOptions{}).Routes().ServeHTTP(recorder, request)
			if recorder.Code != test.status {
				t.Fatalf("status=%d body=%s, want %d", recorder.Code, recorder.Body.String(), test.status)
			}
			var response map[string]string
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response["error"] != test.code {
				t.Fatalf("error=%q, want %q", response["error"], test.code)
			}
		})
	}
}
