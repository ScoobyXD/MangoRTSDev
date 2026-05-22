package httpapi

import (
	"context"
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
	"sync"
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

func TestAuthMiddlewareAllowsCompanyUserGrantedEntityAccess(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const subject = "cognito-company-user-1"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "")
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
	for _, nodeID := range []string{assignedNode.NodeID, unassignedNode.NodeID} {
		if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
			CompanyID:  companyID,
			EntityType: store.EntityTypeNode,
			EntityID:   nodeID,
			Permissions: []store.EntityPermissionInput{{
				SubjectType: store.EntityPermissionSubjectUser,
				SubjectID:   user.UserID,
				AccessLevel: store.EntityPermissionEdit,
			}},
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
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
		t.Fatalf("filtered nodes = %+v, want both granted company nodes", listPayload.Nodes)
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

type countingAuthRepo struct {
	store.Repository
	mu              sync.Mutex
	upsertCalls     int
	membershipCalls int
}

func (r *countingAuthRepo) UpsertAuthUser(cognitoSubject, email, displayName string) (domain.User, error) {
	r.mu.Lock()
	r.upsertCalls++
	r.mu.Unlock()
	return r.Repository.UpsertAuthUser(cognitoSubject, email, displayName)
}

func (r *countingAuthRepo) ListUserMemberships(userID string) ([]domain.CompanyMembership, error) {
	r.mu.Lock()
	r.membershipCalls++
	r.mu.Unlock()
	return r.Repository.ListUserMemberships(userID)
}

func (r *countingAuthRepo) counts() (int, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.upsertCalls, r.membershipCalls
}

type tokenClaimsValidator struct {
	mu     sync.Mutex
	calls  int
	claims map[string]auth.Claims
}

func (v *tokenClaimsValidator) Validate(_ context.Context, token string) (auth.Claims, error) {
	v.mu.Lock()
	v.calls++
	claims, ok := v.claims[token]
	v.mu.Unlock()
	if token == "" {
		return auth.Claims{}, auth.ErrMissingToken
	}
	if !ok {
		return auth.Claims{}, auth.ErrInvalidToken
	}
	return claims, nil
}

func (v *tokenClaimsValidator) count() int {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.calls
}

func TestAuthMembershipCacheReusesContextAfterTokenValidation(t *testing.T) {
	t.Parallel()

	baseRepo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const subject = "cache-user-subject"
	baseRepo.EnsureCompany(companyID, "Cache Company")
	if _, err := baseRepo.UpsertAuthUser(subject, "cache@example.com", "Cache User"); err != nil {
		t.Fatal(err)
	}
	if _, err := baseRepo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	repo := &countingAuthRepo{Repository: baseRepo}
	validator := &tokenClaimsValidator{claims: map[string]auth.Claims{
		"cache-token": {Subject: subject, Email: "cache@example.com", Name: "Cache User"},
	}}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: validator}).Routes()

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
		req.Header.Set("Authorization", "Bearer cache-token")
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("request %d status = %d, want %d, body=%s", i+1, res.Code, http.StatusOK, strings.TrimSpace(res.Body.String()))
		}
	}

	if got := validator.count(); got != 2 {
		t.Fatalf("validator calls = %d, want 2", got)
	}
	upserts, memberships := repo.counts()
	if upserts != 1 || memberships != 1 {
		t.Fatalf("repo auth calls = upserts %d memberships %d, want 1/1", upserts, memberships)
	}
}

func TestAuthMembershipCacheExpires(t *testing.T) {
	t.Parallel()

	baseRepo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const subject = "ttl-user-subject"
	baseRepo.EnsureCompany(companyID, "TTL Company")
	if _, err := baseRepo.UpsertAuthUser(subject, "ttl@example.com", "TTL User"); err != nil {
		t.Fatal(err)
	}
	if _, err := baseRepo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	repo := &countingAuthRepo{Repository: baseRepo}
	validator := &tokenClaimsValidator{claims: map[string]auth.Claims{
		"ttl-token": {Subject: subject, Email: "ttl@example.com", Name: "TTL User"},
	}}
	now := time.Date(2026, 5, 19, 12, 0, 0, 0, time.UTC)
	server := NewServerWithOptions(repo, ServerOptions{
		AuthValidator:          validator,
		AuthMembershipCacheTTL: time.Second,
	})
	server.authCache.now = func() time.Time { return now }
	handler := server.Routes()

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
		req.Header.Set("Authorization", "Bearer ttl-token")
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("request %d status = %d, want %d, body=%s", i+1, res.Code, http.StatusOK, strings.TrimSpace(res.Body.String()))
		}
	}
	now = now.Add(2 * time.Second)
	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	req.Header.Set("Authorization", "Bearer ttl-token")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("post-expiry status = %d, want %d, body=%s", res.Code, http.StatusOK, strings.TrimSpace(res.Body.String()))
	}

	if got := validator.count(); got != 3 {
		t.Fatalf("validator calls = %d, want 3", got)
	}
	upserts, memberships := repo.counts()
	if upserts != 2 || memberships != 2 {
		t.Fatalf("repo auth calls = upserts %d memberships %d, want 2/2", upserts, memberships)
	}
}

func TestAuthMembershipCacheMissesOnChangedIdentityClaims(t *testing.T) {
	t.Parallel()

	baseRepo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const subject = "claim-change-subject"
	baseRepo.EnsureCompany(companyID, "Claims Company")
	if _, err := baseRepo.UpsertAuthUser(subject, "old@example.com", "Old Name"); err != nil {
		t.Fatal(err)
	}
	if _, err := baseRepo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	repo := &countingAuthRepo{Repository: baseRepo}
	validator := &tokenClaimsValidator{claims: map[string]auth.Claims{
		"old-token": {Subject: subject, Email: "old@example.com", Name: "Old Name"},
		"new-token": {Subject: subject, Email: "new@example.com", Name: "New Name"},
	}}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: validator}).Routes()

	oldReq := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	oldReq.Header.Set("Authorization", "Bearer old-token")
	oldRes := httptest.NewRecorder()
	handler.ServeHTTP(oldRes, oldReq)
	if oldRes.Code != http.StatusOK {
		t.Fatalf("old claims status = %d, want %d, body=%s", oldRes.Code, http.StatusOK, strings.TrimSpace(oldRes.Body.String()))
	}

	newReq := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	newReq.Header.Set("Authorization", "Bearer new-token")
	newRes := httptest.NewRecorder()
	handler.ServeHTTP(newRes, newReq)
	if newRes.Code != http.StatusOK {
		t.Fatalf("new claims status = %d, want %d, body=%s", newRes.Code, http.StatusOK, strings.TrimSpace(newRes.Body.String()))
	}
	var payload struct {
		User domain.User `json:"user"`
	}
	if err := json.NewDecoder(newRes.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.User.Email != "new@example.com" || payload.User.DisplayName != "New Name" {
		t.Fatalf("user = %+v, want updated email/display name from claims", payload.User)
	}
	upserts, memberships := repo.counts()
	if upserts != 2 || memberships != 2 {
		t.Fatalf("repo auth calls = upserts %d memberships %d, want 2/2 after changed claims", upserts, memberships)
	}
}

func TestInvitationAcceptInvalidatesCachedMissingMembership(t *testing.T) {
	t.Parallel()

	baseRepo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const adminSubject = "invite-admin-subject"
	const inviteeSubject = "invite-cache-subject"
	const inviteeEmail = "invite-cache@example.com"
	baseRepo.EnsureCompany(companyID, "Invite Company")
	admin, err := baseRepo.UpsertAuthUser(adminSubject, "admin@example.com", "Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := baseRepo.AddCompanyMembership(adminSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := baseRepo.UpsertAuthUser(inviteeSubject, inviteeEmail, "Invitee"); err != nil {
		t.Fatal(err)
	}
	repo := &countingAuthRepo{Repository: baseRepo}
	validator := &tokenClaimsValidator{claims: map[string]auth.Claims{
		"admin-token":   {Subject: adminSubject, Email: admin.Email, Name: "Admin"},
		"invitee-token": {Subject: inviteeSubject, Email: inviteeEmail, Name: "Invitee"},
	}}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: validator}).Routes()

	inviteReq := httptest.NewRequest(http.MethodPost, "/v1/invitations", strings.NewReader(`{"company_id":"`+companyID+`","email":"`+inviteeEmail+`","role":"company_user"}`))
	inviteReq.Header.Set("Authorization", "Bearer admin-token")
	inviteRes := httptest.NewRecorder()
	handler.ServeHTTP(inviteRes, inviteReq)
	if inviteRes.Code != http.StatusCreated {
		t.Fatalf("invite status = %d, want %d, body=%s", inviteRes.Code, http.StatusCreated, strings.TrimSpace(inviteRes.Body.String()))
	}
	var invitePayload struct {
		Invitation struct {
			Token string `json:"token"`
		} `json:"invitation"`
	}
	if err := json.NewDecoder(inviteRes.Body).Decode(&invitePayload); err != nil {
		t.Fatal(err)
	}

	meReq := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	meReq.Header.Set("Authorization", "Bearer invitee-token")
	meRes := httptest.NewRecorder()
	handler.ServeHTTP(meRes, meReq)
	if meRes.Code != http.StatusOK {
		t.Fatalf("pre-accept me status = %d, want %d, body=%s", meRes.Code, http.StatusOK, strings.TrimSpace(meRes.Body.String()))
	}

	acceptReq := httptest.NewRequest(http.MethodPost, "/v1/invitations/accept", strings.NewReader(`{"token":"`+invitePayload.Invitation.Token+`","display_name":"Invitee"}`))
	acceptReq.Header.Set("Authorization", "Bearer invitee-token")
	acceptRes := httptest.NewRecorder()
	handler.ServeHTTP(acceptRes, acceptReq)
	if acceptRes.Code != http.StatusOK {
		t.Fatalf("accept status = %d, want %d, body=%s", acceptRes.Code, http.StatusOK, strings.TrimSpace(acceptRes.Body.String()))
	}

	nodesReq := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id="+companyID, nil)
	nodesReq.Header.Set("Authorization", "Bearer invitee-token")
	nodesRes := httptest.NewRecorder()
	handler.ServeHTTP(nodesRes, nodesReq)
	if nodesRes.Code != http.StatusOK {
		t.Fatalf("post-accept company access status = %d, want %d, body=%s", nodesRes.Code, http.StatusOK, strings.TrimSpace(nodesRes.Body.String()))
	}
}

func TestDeleteCompanyUserInvalidatesCachedCompanyAccess(t *testing.T) {
	t.Parallel()

	baseRepo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const adminSubject = "delete-admin-subject"
	const targetSubject = "delete-target-subject"
	baseRepo.EnsureCompany(companyID, "Delete Company")
	admin, err := baseRepo.UpsertAuthUser(adminSubject, "admin@example.com", "Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := baseRepo.AddCompanyMembership(adminSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	target, err := baseRepo.UpsertAuthUser(targetSubject, "target@example.com", "Target")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := baseRepo.AddCompanyMembership(targetSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	repo := &countingAuthRepo{Repository: baseRepo}
	validator := &tokenClaimsValidator{claims: map[string]auth.Claims{
		"admin-token":  {Subject: adminSubject, Email: admin.Email, Name: "Admin"},
		"target-token": {Subject: targetSubject, Email: target.Email, Name: "Target"},
	}}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: validator}).Routes()

	beforeReq := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id="+companyID, nil)
	beforeReq.Header.Set("Authorization", "Bearer target-token")
	beforeRes := httptest.NewRecorder()
	handler.ServeHTTP(beforeRes, beforeReq)
	if beforeRes.Code != http.StatusOK {
		t.Fatalf("pre-delete target access status = %d, want %d, body=%s", beforeRes.Code, http.StatusOK, strings.TrimSpace(beforeRes.Body.String()))
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/companies/"+companyID+"/users/"+target.UserID, nil)
	deleteReq.Header.Set("Authorization", "Bearer admin-token")
	deleteRes := httptest.NewRecorder()
	handler.ServeHTTP(deleteRes, deleteReq)
	if deleteRes.Code != http.StatusOK {
		t.Fatalf("delete status = %d, want %d, body=%s", deleteRes.Code, http.StatusOK, strings.TrimSpace(deleteRes.Body.String()))
	}

	afterReq := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id="+companyID, nil)
	afterReq.Header.Set("Authorization", "Bearer target-token")
	afterRes := httptest.NewRecorder()
	handler.ServeHTTP(afterRes, afterReq)
	if afterRes.Code != http.StatusForbidden {
		t.Fatalf("post-delete target access status = %d, want %d, body=%s", afterRes.Code, http.StatusForbidden, strings.TrimSpace(afterRes.Body.String()))
	}
}
