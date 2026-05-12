package httpapi

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAuthMiddlewareRejectsMissingToken(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", mustRSAKey(t)),
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id=11111111-1111-1111-1111-111111111111", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusUnauthorized)
	}
}

func TestAuthMiddlewareAllowsCompanyMember(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const subject = "cognito-user-1"
	_, err := repo.UpsertAuthUser(subject, "dev@example.com", "")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(companyID, "MangoRTS Dev")
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}

	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()
	req := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id="+companyID, nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, "dev@example.com"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", res.Code, http.StatusOK, strings.TrimSpace(res.Body.String()))
	}
}

func TestAuthMiddlewareRejectsNonMemberCompany(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const subject = "cognito-user-1"
	_, err := repo.UpsertAuthUser(subject, "dev@example.com", "")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(companyID, "MangoRTS Dev")

	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()
	req := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id="+companyID, nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, "dev@example.com"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusForbidden)
	}
}

func TestAuthMiddlewareAllowsDevAdminAcrossCompanies(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const adminCompanyID = "11111111-1111-1111-1111-111111111111"
	const targetCompanyID = "22222222-2222-2222-2222-222222222222"
	const subject = "cognito-dev-admin-1"
	_, err := repo.UpsertAuthUser(subject, "dev@example.com", "")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(adminCompanyID, "MangoRTS Dev")
	repo.EnsureCompany(targetCompanyID, "Customer")
	if _, err := repo.AddCompanyMembership(subject, adminCompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateNode(targetCompanyID, "target company node"); err != nil {
		t.Fatal(err)
	}

	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()
	req := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id="+targetCompanyID, nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, "dev@example.com"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", res.Code, http.StatusOK, strings.TrimSpace(res.Body.String()))
	}
}

func TestAuthMiddlewareAllowsCompanyAdminInsideCompanyOnly(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const allowedCompanyID = "11111111-1111-1111-1111-111111111111"
	const deniedCompanyID = "22222222-2222-2222-2222-222222222222"
	const subject = "cognito-company-admin-1"
	_, err := repo.UpsertAuthUser(subject, "admin@example.com", "")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(allowedCompanyID, "Allowed")
	repo.EnsureCompany(deniedCompanyID, "Denied")
	if _, err := repo.AddCompanyMembership(subject, allowedCompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateNode(allowedCompanyID, "allowed node"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateNode(deniedCompanyID, "denied node"); err != nil {
		t.Fatal(err)
	}

	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()
	allowedReq := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id="+allowedCompanyID, nil)
	allowedReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, "admin@example.com"))
	allowedRes := httptest.NewRecorder()
	handler.ServeHTTP(allowedRes, allowedReq)
	if allowedRes.Code != http.StatusOK {
		t.Fatalf("allowed status = %d, want %d, body=%s", allowedRes.Code, http.StatusOK, strings.TrimSpace(allowedRes.Body.String()))
	}

	deniedReq := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id="+deniedCompanyID, nil)
	deniedReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, "admin@example.com"))
	deniedRes := httptest.NewRecorder()
	handler.ServeHTTP(deniedRes, deniedReq)
	if deniedRes.Code != http.StatusForbidden {
		t.Fatalf("denied status = %d, want %d", deniedRes.Code, http.StatusForbidden)
	}
}

func TestAuthMiddlewareAllowsCompanyUserFullCompanyAccess(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const subject = "cognito-company-user-1"
	_, err := repo.UpsertAuthUser(subject, "user@example.com", "")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(companyID, "Customer")
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	assignedNode, err := repo.CreateNode(companyID, "assigned node")
	if err != nil {
		t.Fatal(err)
	}
	unassignedNode, err := repo.CreateNode(companyID, "unassigned node")
	if err != nil {
		t.Fatal(err)
	}

	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, "user@example.com")

	listReq := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id="+companyID, nil)
	listReq.Header.Set("Authorization", token)
	listRes := httptest.NewRecorder()
	handler.ServeHTTP(listRes, listReq)
	if listRes.Code != http.StatusOK {
		t.Fatalf("list status = %d, want %d, body=%s", listRes.Code, http.StatusOK, strings.TrimSpace(listRes.Body.String()))
	}
	var listPayload struct {
		Nodes []struct {
			NodeID string `json:"node_id"`
		} `json:"nodes"`
	}
	if err := json.NewDecoder(listRes.Body).Decode(&listPayload); err != nil {
		t.Fatal(err)
	}
	if len(listPayload.Nodes) != 2 {
		t.Fatalf("filtered nodes = %+v, want both company nodes", listPayload.Nodes)
	}

	assignedReq := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+assignedNode.NodeID+"?company_id="+companyID, nil)
	assignedReq.Header.Set("Authorization", token)
	assignedRes := httptest.NewRecorder()
	handler.ServeHTTP(assignedRes, assignedReq)
	if assignedRes.Code != http.StatusOK {
		t.Fatalf("assigned status = %d, want %d, body=%s", assignedRes.Code, http.StatusOK, strings.TrimSpace(assignedRes.Body.String()))
	}

	unassignedReq := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+unassignedNode.NodeID+"?company_id="+companyID, nil)
	unassignedReq.Header.Set("Authorization", token)
	unassignedRes := httptest.NewRecorder()
	handler.ServeHTTP(unassignedRes, unassignedReq)
	if unassignedRes.Code != http.StatusOK {
		t.Fatalf("unassigned status = %d, want %d, body=%s", unassignedRes.Code, http.StatusOK, strings.TrimSpace(unassignedRes.Body.String()))
	}

	writeReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+assignedNode.NodeID, strings.NewReader(`{"company_id":"`+companyID+`","title":"allowed"}`))
	writeReq.Header.Set("Authorization", token)
	writeRes := httptest.NewRecorder()
	handler.ServeHTTP(writeRes, writeReq)
	if writeRes.Code != http.StatusOK {
		t.Fatalf("write status = %d, want %d, body=%s", writeRes.Code, http.StatusOK, strings.TrimSpace(writeRes.Body.String()))
	}
}

func TestAuthMiddlewareChecksBodyCompanyBeforeQueryCompany(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const allowedCompanyID = "11111111-1111-1111-1111-111111111111"
	const deniedCompanyID = "22222222-2222-2222-2222-222222222222"
	const subject = "cognito-user-1"
	_, err := repo.UpsertAuthUser(subject, "dev@example.com", "")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(allowedCompanyID, "MangoRTS Dev")
	if _, err := repo.AddCompanyMembership(subject, allowedCompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}

	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()
	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/nodes?company_id="+allowedCompanyID,
		strings.NewReader(`{"company_id":"`+deniedCompanyID+`","title":"blocked"}`),
	)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, "dev@example.com"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusForbidden)
	}
}

func TestAuthMiddlewareAllowsLargeJSONBodyCompanyID(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const subject = "cognito-user-1"
	_, err := repo.UpsertAuthUser(subject, "dev@example.com", "")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(companyID, "MangoRTS Dev")
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "image node")
	if err != nil {
		t.Fatal(err)
	}

	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()
	largeInformation := strings.Repeat("x", (1<<20)+1024)
	body := `{"company_id":"` + companyID + `","type":"Text box","information":"` + largeInformation + `","information_id":"large-info"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/information", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, "dev@example.com"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body=%s", res.Code, http.StatusCreated, strings.TrimSpace(res.Body.String()))
	}
}

func TestAuthMiddlewareRejectsMalformedJSONBodySafely(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "cognito-user-1"
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()
	req := httptest.NewRequest(http.MethodPost, "/v1/nodes?company_id=11111111-1111-1111-1111-111111111111", strings.NewReader(`{"company_id":`))
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, "dev@example.com"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusBadRequest)
	}
}

func TestAuthMiddlewareBypassesOptionsPreflight(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", mustRSAKey(t)),
	}).Routes()
	req := httptest.NewRequest(http.MethodOptions, "/v1/nodes?company_id=11111111-1111-1111-1111-111111111111", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusNoContent)
	}
}

func mustRSAKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func testValidator(t *testing.T, kid string, key *rsa.PrivateKey) *auth.Validator {
	t.Helper()
	return auth.NewValidator(auth.ValidatorConfig{
		Issuer:   "https://cognito-idp.us-west-1.amazonaws.com/us-west-1_test",
		ClientID: "test-client",
		TokenUse: "access",
	}, auth.StaticKeySource{kid: &key.PublicKey})
}

func testJWT(t *testing.T, key *rsa.PrivateKey, kid, subject, email string) string {
	t.Helper()
	header := map[string]string{"alg": "RS256", "kid": kid, "typ": "JWT"}
	claims := map[string]any{
		"iss":       "https://cognito-idp.us-west-1.amazonaws.com/us-west-1_test",
		"sub":       subject,
		"email":     email,
		"client_id": "test-client",
		"token_use": "access",
		"exp":       time.Now().Add(time.Hour).Unix(),
		"iat":       time.Now().Add(-time.Minute).Unix(),
	}
	unsigned := encodeJSONSegment(t, header) + "." + encodeJSONSegment(t, claims)
	sum := sha256.Sum256([]byte(unsigned))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		t.Fatal(err)
	}
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func encodeJSONSegment(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}
