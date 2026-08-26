package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func qdRatingRequestWithActor(req *http.Request, user domain.User, companyID, role string) *http.Request {
	actor := ActorContext{
		User:        user,
		Memberships: []domain.CompanyMembership{{CompanyID: companyID, UserID: user.UserID, Role: role}},
		CompanyID:   companyID, CompanyRole: role,
	}
	return req.WithContext(context.WithValue(req.Context(), actorContextKey{}, actor))
}

func TestLogicGateQDRatingHTTPContract(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-320000000001"
	user := domain.User{UserID: "22222222-2222-4222-8222-320000000001", DisplayName: "Quality Rater"}
	gate, err := repo.CreateLogicGate(companyID, "Rated Process")
	if err != nil {
		t.Fatal(err)
	}
	server := NewServerWithOptions(repo, ServerOptions{
		DisableRealtimeSpine: true, DisableNotificationCleanup: true, DisableAttachmentUploadCleanup: true,
	})
	defer server.Close()
	handler := server.Routes()
	put := func(metric, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPut, "/v1/logic-gates/"+gate.LogicGateID+"/qd-ratings/"+metric, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, requestWithActorForTest(req, user, companyID))
		return response
	}

	quality := put("quality", `{"company_id":"`+companyID+`","rating":"green"}`)
	if quality.Code != http.StatusOK {
		t.Fatalf("PUT quality status=%d body=%s", quality.Code, quality.Body.String())
	}
	var qualityPayload struct {
		QDRating *domain.QDRating `json:"qd_rating"`
	}
	if err := json.NewDecoder(quality.Body).Decode(&qualityPayload); err != nil || qualityPayload.QDRating == nil {
		t.Fatalf("PUT quality payload=%+v err=%v", qualityPayload, err)
	}
	if qualityPayload.QDRating.QualityRating == nil || *qualityPayload.QDRating.QualityRating != "green" || qualityPayload.QDRating.CostRating != nil || qualityPayload.QDRating.DeliveryRating != nil {
		t.Fatalf("PUT quality row=%+v", qualityPayload.QDRating)
	}
	if qualityPayload.QDRating.RatedByUserID == nil || *qualityPayload.QDRating.RatedByUserID != user.UserID || qualityPayload.QDRating.RatedByDisplayName != user.DisplayName {
		t.Fatalf("PUT quality attribution=%+v", qualityPayload.QDRating)
	}

	delivery := put("delivery", `{"company_id":"`+companyID+`","rating":"yellow"}`)
	if delivery.Code != http.StatusOK {
		t.Fatalf("PUT delivery status=%d body=%s", delivery.Code, delivery.Body.String())
	}
	cost := put("cost", `{"company_id":"`+companyID+`","rating":"red"}`)
	if cost.Code != http.StatusOK {
		t.Fatalf("PUT cost status=%d body=%s", cost.Code, cost.Body.String())
	}

	location, err := time.LoadLocation(store.QDRatingBusinessTimeZone)
	if err != nil {
		t.Fatal(err)
	}
	month := qualityPayload.QDRating.RatedCreatedTimestamp.In(location).Format("2006-01")
	getPath := "/v1/logic-gates/" + gate.LogicGateID + "/qd-ratings?company_id=" + url.QueryEscape(companyID) + "&month=" + month
	getRequest := requestWithActorForTest(httptest.NewRequest(http.MethodGet, getPath, nil), user, companyID)
	getResponse := httptest.NewRecorder()
	handler.ServeHTTP(getResponse, getRequest)
	if getResponse.Code != http.StatusOK {
		t.Fatalf("GET status=%d body=%s", getResponse.Code, getResponse.Body.String())
	}
	var listPayload struct {
		QDRatings []domain.QDRating `json:"qd_ratings"`
	}
	if err := json.NewDecoder(getResponse.Body).Decode(&listPayload); err != nil || len(listPayload.QDRatings) != 1 {
		t.Fatalf("GET payload=%+v err=%v", listPayload, err)
	}
	if listPayload.QDRatings[0].QualityRating == nil || listPayload.QDRatings[0].CostRating == nil || listPayload.QDRatings[0].DeliveryRating == nil {
		t.Fatalf("GET combined row=%+v", listPayload.QDRatings[0])
	}

	if response := put("quality", `{"company_id":"`+companyID+`","rating":null}`); response.Code != http.StatusOK {
		t.Fatalf("clear quality status=%d body=%s", response.Code, response.Body.String())
	}
	cleared := put("delivery", `{"company_id":"`+companyID+`","rating":null}`)
	if cleared.Code != http.StatusOK {
		t.Fatalf("clear delivery status=%d body=%s", cleared.Code, cleared.Body.String())
	}
	cleared = put("cost", `{"company_id":"`+companyID+`","rating":null}`)
	if cleared.Code != http.StatusOK {
		t.Fatalf("clear cost status=%d body=%s", cleared.Code, cleared.Body.String())
	}
	var clearedPayload struct {
		QDRating *domain.QDRating `json:"qd_rating"`
	}
	if err := json.NewDecoder(cleared.Body).Decode(&clearedPayload); err != nil || clearedPayload.QDRating != nil {
		t.Fatalf("clear payload=%+v err=%v", clearedPayload, err)
	}

	invalid := put("speed", `{"company_id":"`+companyID+`","rating":"green"}`)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid metric status=%d body=%s", invalid.Code, invalid.Body.String())
	}
}

func TestLogicGateQDRatingsKeepNoAccessHidden(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-320000000002"
	gate, err := repo.CreateLogicGate(companyID, "Hidden Rated Process")
	if err != nil {
		t.Fatal(err)
	}
	noAccess := store.ResourceDefaultAccessNoAccess
	if _, _, err := repo.PutResourcePermissionPolicy(store.ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: store.EntityTypeLogicGate, ResourceID: gate.LogicGateID,
		PermissionMode: store.PolicyModeCustomized, DefaultAccess: &noAccess,
		DescendantAction: store.PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatal(err)
	}
	server := NewServerWithOptions(repo, ServerOptions{
		DisableRealtimeSpine: true, DisableNotificationCleanup: true, DisableAttachmentUploadCleanup: true,
	})
	defer server.Close()
	user := domain.User{UserID: "22222222-2222-4222-8222-320000000002", DisplayName: "No Access User"}
	request := httptest.NewRequest(http.MethodGet, "/v1/logic-gates/"+gate.LogicGateID+"/qd-ratings?company_id="+companyID+"&month=2026-08", nil)
	request = qdRatingRequestWithActor(request, user, companyID, domain.RoleCompanyUser)
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("no-access GET status=%d body=%s", response.Code, response.Body.String())
	}
}
