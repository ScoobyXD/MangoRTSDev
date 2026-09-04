package httpapi

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
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

func TestAuthMiddlewareBootstrapsAllowedDevAdmin(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "first-dev-admin-subject"
	const allowlistedEmail = "First-Admin@Example.COM"
	const claimEmail = "FIRST-ADMIN@example.com"

	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		BootstrapDevAdmin: BootstrapDevAdminConfig{
			Emails:      []string{allowlistedEmail},
			CompanyName: "MangoRTS Bootstrap",
		},
	}).Routes()
	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, claimEmail))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", res.Code, http.StatusOK, strings.TrimSpace(res.Body.String()))
	}
	var payload struct {
		User        domain.User                `json:"user"`
		IsDevAdmin  bool                       `json:"is_dev_admin"`
		Memberships []domain.CompanyMembership `json:"memberships"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.User.Email != "first-admin@example.com" {
		t.Fatalf("user email = %q, want lowercased email", payload.User.Email)
	}
	if !payload.IsDevAdmin {
		t.Fatal("is_dev_admin = false, want true")
	}
	if len(payload.Memberships) != 1 || payload.Memberships[0].Role != domain.RoleDevAdmin {
		t.Fatalf("memberships = %+v, want one dev_admin membership", payload.Memberships)
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

	writeReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+assignedNode.NodeID, strings.NewReader(`{"company_id":"`+companyID+`","name":"allowed"}`))
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
		strings.NewReader(`{"company_id":"`+deniedCompanyID+`","name":"blocked"}`),
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
	return testJWTWithIssuedAt(t, key, kid, subject, email, time.Now().Add(-time.Minute))
}

func testJWTWithIssuedAt(t *testing.T, key *rsa.PrivateKey, kid, subject, email string, issuedAt time.Time) string {
	t.Helper()
	header := map[string]string{"alg": "RS256", "kid": kid, "typ": "JWT"}
	claims := map[string]any{
		"iss":       "https://cognito-idp.us-west-1.amazonaws.com/us-west-1_test",
		"sub":       subject,
		"email":     email,
		"client_id": "test-client",
		"token_use": "access",
		"exp":       time.Now().Add(time.Hour).Unix(),
		"iat":       issuedAt.Unix(),
	}
	unsigned := encodeJSONSegment(t, header) + "." + encodeJSONSegment(t, claims)
	sum := sha256.Sum256([]byte(unsigned))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		t.Fatal(err)
	}
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func TestAuthValidatorReturnsVerifiedTokenIssueTime(t *testing.T) {
	t.Parallel()
	key := mustRSAKey(t)
	claims, err := testValidator(t, "kid", key).Validate(context.Background(), testJWT(t, key, "kid", "issued-at-subject", "issued-at@example.com"))
	if err != nil {
		t.Fatal(err)
	}
	if claims.IssuedAt.IsZero() || claims.IssuedAt.After(time.Now()) {
		t.Fatalf("issued at = %s, want verified past token issue time", claims.IssuedAt)
	}
}

func TestAuthValidatorAllowsSmallIssuerClockSkewInTokenIssueTime(t *testing.T) {
	t.Parallel()
	key := mustRSAKey(t)
	issuedAt := time.Now().Add(time.Second).Truncate(time.Second)
	claims, err := testValidator(t, "kid", key).Validate(context.Background(), testJWTWithIssuedAt(t, key, "kid", "clock-skew-subject", "clock-skew@example.com", issuedAt))
	if err != nil {
		t.Fatal(err)
	}
	if !claims.IssuedAt.Equal(issuedAt) {
		t.Fatalf("issued at = %s, want %s", claims.IssuedAt, issuedAt)
	}
}

func TestAuthValidatorRejectsFarFutureTokenIssueTime(t *testing.T) {
	t.Parallel()
	key := mustRSAKey(t)
	issuedAt := time.Now().Add(10 * time.Minute).Truncate(time.Second)
	_, err := testValidator(t, "kid", key).Validate(context.Background(), testJWTWithIssuedAt(t, key, "kid", "future-subject", "future@example.com", issuedAt))
	if !errors.Is(err, auth.ErrInvalidToken) {
		t.Fatalf("far-future issued-at error = %v, want %v", err, auth.ErrInvalidToken)
	}
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
	resolutionCalls int
	membershipCalls int
}

func (r *countingAuthRepo) ResolveAuthUserContext(ctx context.Context, cognitoSubject, email, displayName string, claimsIssuedAt time.Time) (domain.User, error) {
	r.mu.Lock()
	r.resolutionCalls++
	r.mu.Unlock()
	return r.Repository.ResolveAuthUserContext(ctx, cognitoSubject, email, displayName, claimsIssuedAt)
}

func (r *countingAuthRepo) ListUserMembershipsContext(ctx context.Context, userID string) ([]domain.CompanyMembership, error) {
	r.mu.Lock()
	r.membershipCalls++
	r.mu.Unlock()
	return r.Repository.ListUserMembershipsContext(ctx, userID)
}

func (r *countingAuthRepo) counts() (int, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.resolutionCalls, r.membershipCalls
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
	resolutions, memberships := repo.counts()
	if resolutions != 1 || memberships != 1 {
		t.Fatalf("repo auth calls = resolutions %d memberships %d, want 1/1", resolutions, memberships)
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
	resolutions, memberships := repo.counts()
	if resolutions != 2 || memberships != 2 {
		t.Fatalf("repo auth calls = resolutions %d memberships %d, want 2/2", resolutions, memberships)
	}
}

func TestAuthMembershipCachePrunesExpiredTokenVariants(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 19, 12, 0, 0, 0, time.UTC)
	cache := newAuthMembershipCache(time.Second, 10)
	cache.now = func() time.Time { return now }
	oldClaims := auth.Claims{Subject: "pruned-subject", Email: "old@example.com", IssuedAt: now}
	if !cache.setIfGeneration(oldClaims, ActorContext{User: domain.User{UserID: "pruned-user"}}, cache.snapshotGeneration()) {
		t.Fatal("initial cache set was rejected")
	}

	now = now.Add(2 * time.Second)
	newClaims := auth.Claims{Subject: oldClaims.Subject, Email: "new@example.com", IssuedAt: now}
	if !cache.setIfGeneration(newClaims, ActorContext{User: domain.User{UserID: "pruned-user"}}, cache.snapshotGeneration()) {
		t.Fatal("replacement cache set was rejected")
	}
	if len(cache.entries) != 1 {
		t.Fatalf("cache entries = %d, want only the current token variant", len(cache.entries))
	}
	if _, ok := cache.entries[cacheKeyForClaims(newClaims)]; !ok {
		t.Fatal("current token variant is missing from cache")
	}
}

func TestAuthMembershipCacheMissesOnChangedIdentityClaims(t *testing.T) {
	t.Parallel()

	baseRepo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const subject = "claim-change-subject"
	baseRepo.EnsureCompany(companyID, "Claims Company")
	seededUser, err := baseRepo.UpsertAuthUser(subject, "old@example.com", "Old Name")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := baseRepo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	repo := &countingAuthRepo{Repository: baseRepo}
	oldIssuedAt := time.Unix(seededUser.AuthClaimsIssuedAt.Unix()+10, 0).UTC()
	newIssuedAt := oldIssuedAt.Add(10 * time.Second)
	validator := &tokenClaimsValidator{claims: map[string]auth.Claims{
		"old-token": {Subject: subject, Email: "old@example.com", Name: "Old Name", IssuedAt: oldIssuedAt},
		"new-token": {Subject: subject, Email: "new@example.com", Name: "New Name", IssuedAt: newIssuedAt},
	}}
	now := time.Date(2026, 5, 19, 12, 0, 0, 0, time.UTC)
	server := NewServerWithOptions(repo, ServerOptions{
		AuthValidator:          validator,
		AuthMembershipCacheTTL: time.Second,
	})
	server.authCache.now = func() time.Time { return now }
	handler := server.Routes()
	requestMe := func(token string) domain.User {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want %d, body=%s", token, res.Code, http.StatusOK, strings.TrimSpace(res.Body.String()))
		}
		var payload struct {
			User domain.User `json:"user"`
		}
		if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		return payload.User
	}
	assertNewProfile := func(label string, user domain.User) {
		t.Helper()
		if user.Email != "new@example.com" || user.DisplayName != "New Name" {
			t.Fatalf("%s user = %+v, want current new profile", label, user)
		}
	}

	oldUser := requestMe("old-token")
	if oldUser.Email != "old@example.com" || oldUser.DisplayName != "Old Name" {
		t.Fatalf("initial old user = %+v, want old profile", oldUser)
	}
	assertNewProfile("new token", requestMe("new-token"))
	assertNewProfile("repeated old token", requestMe("old-token"))
	assertNewProfile("repeated new token", requestMe("new-token"))
	storedNew, err := baseRepo.GetAuthUser(subject)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Second)
	assertNewProfile("expired old token", requestMe("old-token"))
	assertNewProfile("post-refresh new token", requestMe("new-token"))
	stored, err := baseRepo.GetAuthUser(subject)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Email != "new@example.com" || stored.DisplayName != "New Name" || !stored.UpdatedTimestamp.Equal(storedNew.UpdatedTimestamp) || !stored.AuthClaimsIssuedAt.Equal(newIssuedAt) {
		t.Fatalf("stored user = %+v, want older token to leave new profile unchanged", stored)
	}

	latestAIssuedAt := newIssuedAt.Add(10 * time.Second)
	validator.mu.Lock()
	validator.claims["latest-a-token"] = auth.Claims{Subject: subject, Email: "old@example.com", Name: "Old Name", IssuedAt: latestAIssuedAt}
	validator.mu.Unlock()
	latestA := requestMe("latest-a-token")
	if latestA.Email != "old@example.com" || latestA.DisplayName != "Old Name" {
		t.Fatalf("latest A user = %+v, want a genuinely later A profile change", latestA)
	}
	if staleB := requestMe("new-token"); staleB.Email != "old@example.com" || staleB.DisplayName != "Old Name" {
		t.Fatalf("stale B user = %+v, want latest A profile", staleB)
	}
	now = now.Add(2 * time.Second)
	if expiredStaleB := requestMe("new-token"); expiredStaleB.Email != "old@example.com" || expiredStaleB.DisplayName != "Old Name" {
		t.Fatalf("expired stale B user = %+v, want latest A profile", expiredStaleB)
	}
	storedLatestA, err := baseRepo.GetAuthUser(subject)
	if err != nil {
		t.Fatal(err)
	}
	if storedLatestA.Email != "old@example.com" || storedLatestA.DisplayName != "Old Name" || !storedLatestA.UpdatedTimestamp.Equal(latestA.UpdatedTimestamp) {
		t.Fatalf("stored latest A user = %+v, want stale B token to leave it unchanged", storedLatestA)
	}

	resolutions, memberships := repo.counts()
	if resolutions != 6 || memberships != 6 {
		t.Fatalf("repo auth calls = resolutions %d memberships %d, want 6/6 across three token versions and two expiries", resolutions, memberships)
	}
}

func TestHandleMePreservesStoredDisplayNameWhenClaimsNameBlank(t *testing.T) {
	t.Parallel()

	baseRepo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const subject = "blank-name-refresh-subject"
	const email = "jonathan@example.com"
	baseRepo.EnsureCompany(companyID, "Display Name Company")
	if _, err := baseRepo.UpsertAuthUser(subject, email, "Jonathan Kim"); err != nil {
		t.Fatal(err)
	}
	if _, err := baseRepo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	repo := &countingAuthRepo{Repository: baseRepo}
	validator := &tokenClaimsValidator{claims: map[string]auth.Claims{
		"blank-name-token": {Subject: subject, Email: email},
	}}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: validator}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	req.Header.Set("Authorization", "Bearer blank-name-token")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", res.Code, http.StatusOK, strings.TrimSpace(res.Body.String()))
	}
	var payload struct {
		User domain.User `json:"user"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.User.DisplayName != "Jonathan Kim" {
		t.Fatalf("response display name = %q, want Jonathan Kim", payload.User.DisplayName)
	}
	stored, err := baseRepo.GetAuthUser(subject)
	if err != nil {
		t.Fatal(err)
	}
	if stored.DisplayName != "Jonathan Kim" {
		t.Fatalf("stored display name = %q, want Jonathan Kim", stored.DisplayName)
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

func TestTestAuthHeaderIsExplicitAndMembershipScoped(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111191"
	repo.EnsureCompany(companyID, "Test auth boundary")
	subject := "browser-test-auth-subject"
	if _, err := repo.UpsertAuthUser(subject, subject+"@mangorts.test", "Browser Test"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}

	disabled := NewServerWithOptions(repo, ServerOptions{
		DisableRealtimeSpine: true, DisableAttachmentUploadCleanup: true,
	})
	defer disabled.Close()
	disabledRequest := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	disabledRequest.Header.Set("X-Mango-Test-Subject", subject)
	disabledResponse := httptest.NewRecorder()
	disabled.Routes().ServeHTTP(disabledResponse, disabledRequest)
	if disabledResponse.Code != http.StatusUnauthorized {
		t.Fatalf("disabled test header status = %d, want %d", disabledResponse.Code, http.StatusUnauthorized)
	}

	enabled := NewServerWithOptions(repo, ServerOptions{
		TestAuthHeaderEnabled: true, DisableRealtimeSpine: true, DisableAttachmentUploadCleanup: true,
	})
	defer enabled.Close()
	meRequest := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	meRequest.Header.Set("X-Mango-Test-Subject", subject)
	meResponse := httptest.NewRecorder()
	enabled.Routes().ServeHTTP(meResponse, meRequest)
	if meResponse.Code != http.StatusOK {
		t.Fatalf("enabled test header status = %d, want %d, body=%s", meResponse.Code, http.StatusOK, meResponse.Body.String())
	}

	deniedRequest := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id="+companyID, nil)
	deniedRequest.Header.Set("X-Mango-Test-Subject", "browser-test-auth-no-membership")
	deniedResponse := httptest.NewRecorder()
	enabled.Routes().ServeHTTP(deniedResponse, deniedRequest)
	if deniedResponse.Code != http.StatusForbidden {
		t.Fatalf("unscoped test subject status = %d, want %d, body=%s", deniedResponse.Code, http.StatusForbidden, deniedResponse.Body.String())
	}
}

type blockingAuthPoolRepo struct {
	store.Repository
	pool            chan struct{}
	resolveStarted  chan struct{}
	resolveRelease  chan struct{}
	startOnce       sync.Once
	mu              sync.Mutex
	resolveCalls    int
	membershipCalls int
	companyCalls    int
	addMemberCalls  int
	active          int
	maxActive       int
	membershipDelay time.Duration
}

func newBlockingAuthPoolRepo(base store.Repository, poolSize int) *blockingAuthPoolRepo {
	return &blockingAuthPoolRepo{
		Repository:      base,
		pool:            make(chan struct{}, poolSize),
		resolveStarted:  make(chan struct{}),
		resolveRelease:  make(chan struct{}),
		membershipDelay: 75 * time.Millisecond,
	}
}

func (r *blockingAuthPoolRepo) beginDatabaseUse(ctx context.Context) (func(), error) {
	select {
	case r.pool <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	r.mu.Lock()
	r.active++
	if r.active > r.maxActive {
		r.maxActive = r.active
	}
	r.mu.Unlock()
	return func() {
		r.mu.Lock()
		r.active--
		r.mu.Unlock()
		<-r.pool
	}, nil
}

func (r *blockingAuthPoolRepo) ResolveAuthUserContext(ctx context.Context, cognitoSubject, email, displayName string, claimsIssuedAt time.Time) (domain.User, error) {
	done, err := r.beginDatabaseUse(ctx)
	if err != nil {
		return domain.User{}, err
	}
	defer done()
	r.mu.Lock()
	r.resolveCalls++
	r.mu.Unlock()
	r.startOnce.Do(func() { close(r.resolveStarted) })
	select {
	case <-r.resolveRelease:
	case <-ctx.Done():
		return domain.User{}, ctx.Err()
	}
	return r.Repository.ResolveAuthUserContext(ctx, cognitoSubject, email, displayName, claimsIssuedAt)
}

func (r *blockingAuthPoolRepo) ListUserMembershipsContext(ctx context.Context, userID string) ([]domain.CompanyMembership, error) {
	done, err := r.beginDatabaseUse(ctx)
	if err != nil {
		return nil, err
	}
	defer done()
	r.mu.Lock()
	r.membershipCalls++
	r.mu.Unlock()
	timer := time.NewTimer(r.membershipDelay)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return r.Repository.ListUserMembershipsContext(ctx, userID)
}

func (r *blockingAuthPoolRepo) BootstrapDevAdminContext(ctx context.Context, cognitoSubject, companyName string) (domain.CompanyMembership, bool, error) {
	done, err := r.beginDatabaseUse(ctx)
	if err != nil {
		return domain.CompanyMembership{}, false, err
	}
	defer done()
	r.mu.Lock()
	r.companyCalls++
	r.addMemberCalls++
	r.mu.Unlock()
	return r.Repository.BootstrapDevAdminContext(ctx, cognitoSubject, companyName)
}

func (r *blockingAuthPoolRepo) stats() (resolveCalls, membershipCalls, active, maxActive int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.resolveCalls, r.membershipCalls, r.active, r.maxActive
}

func (r *blockingAuthPoolRepo) bootstrapStats() (companyCalls, addMemberCalls int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.companyCalls, r.addMemberCalls
}

func TestAuthBurstAcrossMeProtectedAndRealtimeStaysBelowTwentyConnectionPool(t *testing.T) {
	base := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const subject = "auth-burst-subject"
	base.EnsureCompany(companyID, "Auth Burst")
	if _, err := base.UpsertAuthUser(subject, "burst@example.com", "Burst User"); err != nil {
		t.Fatal(err)
	}
	if _, err := base.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	repo := newBlockingAuthPoolRepo(base, 20)
	validator := &tokenClaimsValidator{claims: map[string]auth.Claims{
		"burst-token": {Subject: subject, Email: "burst@example.com", Name: "Burst User"},
	}}
	server := NewServerWithOptions(repo, ServerOptions{
		AuthValidator:                  validator,
		DisableRealtimeSpine:           true,
		DisableAttachmentUploadCleanup: true,
		DisableNotificationCleanup:     true,
	})
	server.realtimeSpineReady.Store(true)
	t.Cleanup(server.Close)
	handler := server.Routes()

	type burstRequest struct {
		method string
		path   string
		body   string
		want   int
	}
	requests := []burstRequest{
		{method: http.MethodGet, path: "/v1/me", want: http.StatusOK},
		{method: http.MethodGet, path: "/v1/nodes?company_id=" + companyID, want: http.StatusOK},
		{method: http.MethodPost, path: "/v1/realtime/ticket", body: `{"company_id":"` + companyID + `"}`, want: http.StatusOK},
		{method: http.MethodGet, path: "/v1/realtime/ws?company_id=" + companyID, want: http.StatusBadRequest},
	}
	const requestCount = 60
	start := make(chan struct{})
	errorsFound := make(chan error, requestCount)
	var wg sync.WaitGroup
	for i := 0; i < requestCount; i++ {
		request := requests[i%len(requests)]
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			req := httptest.NewRequest(request.method, request.path, strings.NewReader(request.body))
			req.Header.Set("Authorization", "Bearer burst-token")
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			if res.Code != request.want {
				errorsFound <- errors.New("unexpected status for " + request.path + ": " + res.Body.String())
			}
		}()
	}
	close(start)
	select {
	case <-repo.resolveStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("auth burst did not enter the shared user resolution")
	}
	time.Sleep(50 * time.Millisecond)
	_, _, activeBeforeRelease, maxBeforeRelease := repo.stats()
	if activeBeforeRelease != 1 || maxBeforeRelease != 1 {
		t.Fatalf("database use before release = active %d max %d, want 1/1", activeBeforeRelease, maxBeforeRelease)
	}
	close(repo.resolveRelease)
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("auth burst did not complete")
	}
	close(errorsFound)
	for err := range errorsFound {
		t.Error(err)
	}
	resolveCalls, membershipCalls, active, maxActive := repo.stats()
	if resolveCalls != 1 {
		t.Fatalf("user resolutions = %d, want 1", resolveCalls)
	}
	if membershipCalls < 1 {
		t.Fatal("membership resolution did not run")
	}
	if active != 0 || maxActive != 1 {
		t.Fatalf("database use after burst = active %d max %d, want 0/1 below pool capacity 20", active, maxActive)
	}
}

func TestAuthJoinedWaiterReturnsOnOwnCancellation(t *testing.T) {
	base := store.NewMemoryRepo()
	const subject = "auth-cancel-waiter"
	if _, err := base.UpsertAuthUser(subject, "cancel@example.com", "Cancel User"); err != nil {
		t.Fatal(err)
	}
	repo := newBlockingAuthPoolRepo(base, 20)
	server := NewServerWithOptions(repo, ServerOptions{DisableRealtimeSpine: true, DisableNotificationCleanup: true})
	t.Cleanup(server.Close)
	claims := auth.Claims{Subject: subject, Email: "cancel@example.com", Name: "Cancel User"}
	leaderDone := make(chan error, 1)
	go func() {
		_, err := server.authenticatedActorForClaims(context.Background(), claims)
		leaderDone <- err
	}()
	select {
	case <-repo.resolveStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("leader auth resolution did not start")
	}
	waiterContext, cancelWaiter := context.WithCancel(context.Background())
	waiterDone := make(chan error, 1)
	go func() {
		_, err := server.authenticatedActorForClaims(waiterContext, claims)
		waiterDone <- err
	}()
	cancelWaiter()
	select {
	case err := <-waiterDone:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("waiter error = %v, want context.Canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("canceled auth waiter did not return")
	}
	close(repo.resolveRelease)
	select {
	case err := <-leaderDone:
		if err != nil {
			t.Fatalf("leader resolution failed: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("leader auth resolution did not finish")
	}
	resolveCalls, _, active, maxActive := repo.stats()
	if resolveCalls != 1 || active != 0 || maxActive != 1 {
		t.Fatalf("database use = resolutions %d active %d max %d, want 1/0/1", resolveCalls, active, maxActive)
	}
}

func TestAuthLiveWaiterRetriesAfterShortDeadlineLeader(t *testing.T) {
	base := store.NewMemoryRepo()
	const subject = "auth-short-deadline-leader"
	if _, err := base.UpsertAuthUser(subject, "leader@example.com", "Leader User"); err != nil {
		t.Fatal(err)
	}
	repo := newBlockingAuthPoolRepo(base, 20)
	server := NewServerWithOptions(repo, ServerOptions{DisableRealtimeSpine: true, DisableNotificationCleanup: true})
	t.Cleanup(server.Close)
	claims := auth.Claims{Subject: subject, Email: "leader@example.com", Name: "Leader User"}
	leaderContext, cancelLeader := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancelLeader()
	leaderDone := make(chan error, 1)
	go func() {
		_, err := server.authenticatedActorForClaims(leaderContext, claims)
		leaderDone <- err
	}()
	select {
	case <-repo.resolveStarted:
	case <-time.After(time.Second):
		t.Fatal("short-deadline leader did not start")
	}
	waiterDone := make(chan error, 1)
	go func() {
		_, err := server.authenticatedActorForClaims(context.Background(), claims)
		waiterDone <- err
	}()
	select {
	case err := <-leaderDone:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("leader error = %v, want context.DeadlineExceeded", err)
		}
	case <-time.After(time.Second):
		t.Fatal("short-deadline leader did not return")
	}
	close(repo.resolveRelease)
	select {
	case err := <-waiterDone:
		if err != nil {
			t.Fatalf("live waiter failed after leader deadline: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("live waiter did not retry after leader deadline")
	}
	resolveCalls, _, active, maxActive := repo.stats()
	if resolveCalls != 2 || active != 0 || maxActive != 1 {
		t.Fatalf("database use = resolutions %d active %d max %d, want 2/0/1", resolveCalls, active, maxActive)
	}
}

type recoverableSlowAuthRepo struct {
	store.Repository
	mu     sync.Mutex
	slow   bool
	active int
}

func (r *recoverableSlowAuthRepo) ResolveAuthUserContext(ctx context.Context, cognitoSubject, email, displayName string, claimsIssuedAt time.Time) (domain.User, error) {
	r.mu.Lock()
	r.active++
	slow := r.slow
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		r.active--
		r.mu.Unlock()
	}()
	if slow {
		<-ctx.Done()
		return domain.User{}, ctx.Err()
	}
	return r.Repository.ResolveAuthUserContext(ctx, cognitoSubject, email, displayName, claimsIssuedAt)
}

func TestAuthTimeoutReturnsControlledErrorAndRecoversPool(t *testing.T) {
	base := store.NewMemoryRepo()
	const subject = "auth-timeout-recovery"
	if _, err := base.UpsertAuthUser(subject, "timeout@example.com", "Timeout User"); err != nil {
		t.Fatal(err)
	}
	repo := &recoverableSlowAuthRepo{Repository: base, slow: true}
	validator := &tokenClaimsValidator{claims: map[string]auth.Claims{
		"timeout-token": {Subject: subject, Email: "timeout@example.com", Name: "Timeout User"},
	}}
	server := NewServerWithOptions(repo, ServerOptions{
		AuthValidator:              validator,
		AuthResolutionTimeout:      25 * time.Millisecond,
		DisableRealtimeSpine:       true,
		DisableNotificationCleanup: true,
	})
	t.Cleanup(server.Close)
	handler := server.Routes()

	timedOut := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	timedOut.Header.Set("Authorization", "Bearer timeout-token")
	timedOutResponse := httptest.NewRecorder()
	handler.ServeHTTP(timedOutResponse, timedOut)
	if timedOutResponse.Code != http.StatusGatewayTimeout || !strings.Contains(timedOutResponse.Body.String(), "authentication_timeout") {
		t.Fatalf("timeout response = %d %s, want 504 authentication_timeout", timedOutResponse.Code, timedOutResponse.Body.String())
	}
	repo.mu.Lock()
	repo.slow = false
	repo.mu.Unlock()

	recovered := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	recovered.Header.Set("Authorization", "Bearer timeout-token")
	recoveredResponse := httptest.NewRecorder()
	handler.ServeHTTP(recoveredResponse, recovered)
	if recoveredResponse.Code != http.StatusOK {
		t.Fatalf("recovered response = %d %s, want 200", recoveredResponse.Code, recoveredResponse.Body.String())
	}
	repo.mu.Lock()
	defer repo.mu.Unlock()
	if repo.active != 0 {
		t.Fatalf("active database operations after recovery = %d, want 0", repo.active)
	}
}

type authPostgresTimeoutError string

func (e authPostgresTimeoutError) Error() string    { return "postgres auth timeout" }
func (e authPostgresTimeoutError) SQLState() string { return string(e) }

type authResolutionErrorRepo struct {
	store.Repository
	err error
}

func (r *authResolutionErrorRepo) ResolveAuthUserContext(context.Context, string, string, string, time.Time) (domain.User, error) {
	return domain.User{}, r.err
}

func TestAuthPostgresTimeoutsReturnControlledGatewayTimeout(t *testing.T) {
	for _, sqlState := range []string{"55P03", "57014"} {
		t.Run(sqlState, func(t *testing.T) {
			base := store.NewMemoryRepo()
			repo := &authResolutionErrorRepo{Repository: base, err: authPostgresTimeoutError(sqlState)}
			server := NewServerWithOptions(repo, ServerOptions{
				AuthValidator:              &tokenClaimsValidator{claims: map[string]auth.Claims{"timeout-token": {Subject: "postgres-timeout", Email: "timeout@example.com"}}},
				DisableRealtimeSpine:       true,
				DisableNotificationCleanup: true,
			})
			t.Cleanup(server.Close)
			request := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
			request.Header.Set("Authorization", "Bearer timeout-token")
			response := httptest.NewRecorder()
			server.Routes().ServeHTTP(response, request)
			if response.Code != http.StatusGatewayTimeout || !strings.Contains(response.Body.String(), "authentication_timeout") {
				t.Fatalf("PostgreSQL timeout response = %d %s, want 504 authentication_timeout", response.Code, response.Body.String())
			}
		})
	}
}

type blockingChangedClaimsRepo struct {
	store.Repository
	started chan struct{}
	release chan struct{}
	once    sync.Once
	mu      sync.Mutex
	calls   int
	active  int
	max     int
}

func (r *blockingChangedClaimsRepo) ResolveAuthUserContext(ctx context.Context, cognitoSubject, email, displayName string, claimsIssuedAt time.Time) (domain.User, error) {
	r.mu.Lock()
	r.calls++
	call := r.calls
	r.active++
	if r.active > r.max {
		r.max = r.active
	}
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		r.active--
		r.mu.Unlock()
	}()
	if call == 1 {
		r.once.Do(func() { close(r.started) })
		select {
		case <-r.release:
		case <-ctx.Done():
			return domain.User{}, ctx.Err()
		}
	}
	return r.Repository.ResolveAuthUserContext(ctx, cognitoSubject, email, displayName, claimsIssuedAt)
}

func TestConcurrentChangedClaimsSerializeBySubject(t *testing.T) {
	base := store.NewMemoryRepo()
	const subject = "serialized-claim-change"
	if _, err := base.UpsertAuthUser(subject, "old@example.com", "Old Name"); err != nil {
		t.Fatal(err)
	}
	repo := &blockingChangedClaimsRepo{Repository: base, started: make(chan struct{}), release: make(chan struct{})}
	server := NewServerWithOptions(repo, ServerOptions{DisableRealtimeSpine: true, DisableNotificationCleanup: true})
	t.Cleanup(server.Close)
	oldClaims := auth.Claims{Subject: subject, Email: "old@example.com", Name: "Old Name"}
	newClaims := auth.Claims{Subject: subject, Email: "new@example.com", Name: "New Name"}
	oldDone := make(chan error, 1)
	go func() {
		_, err := server.authenticatedActorForClaims(context.Background(), oldClaims)
		oldDone <- err
	}()
	select {
	case <-repo.started:
	case <-time.After(time.Second):
		t.Fatal("old-claims resolution did not start")
	}
	newDone := make(chan error, 1)
	go func() {
		_, err := server.authenticatedActorForClaims(context.Background(), newClaims)
		newDone <- err
	}()
	close(repo.release)
	for name, done := range map[string]<-chan error{"old": oldDone, "new": newDone} {
		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("%s claims resolution failed: %v", name, err)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("%s claims resolution did not finish", name)
		}
	}
	stored, err := base.GetAuthUser(subject)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Email != "new@example.com" || stored.DisplayName != "New Name" {
		t.Fatalf("stored user = %+v, want new claims", stored)
	}
	repo.mu.Lock()
	defer repo.mu.Unlock()
	if repo.calls != 2 || repo.active != 0 || repo.max != 1 {
		t.Fatalf("claim resolutions = calls %d active %d max %d, want 2/0/1", repo.calls, repo.active, repo.max)
	}
}

func TestAuthFirstBootstrapBurstCreatesOneCompanyAndMembership(t *testing.T) {
	base := store.NewMemoryRepo()
	const subject = "first-bootstrap-burst"
	repo := newBlockingAuthPoolRepo(base, 20)
	server := NewServerWithOptions(repo, ServerOptions{
		BootstrapDevAdmin:              BootstrapDevAdminConfig{Emails: []string{"bootstrap@example.com"}, CompanyName: "Bootstrap Company"},
		DisableRealtimeSpine:           true,
		DisableAttachmentUploadCleanup: true,
		DisableNotificationCleanup:     true,
	})
	t.Cleanup(server.Close)
	claims := auth.Claims{Subject: subject, Email: "bootstrap@example.com", Name: "Bootstrap User"}

	const requestCount = 40
	start := make(chan struct{})
	errorsFound := make(chan error, requestCount)
	var waiters sync.WaitGroup
	for index := 0; index < requestCount; index++ {
		waiters.Add(1)
		go func() {
			defer waiters.Done()
			<-start
			actor, err := server.authenticatedActorForClaims(context.Background(), claims)
			if err != nil {
				errorsFound <- err
				return
			}
			if !actor.IsDevAdmin || len(actor.Memberships) != 1 {
				errorsFound <- errors.New("bootstrap actor did not receive one dev-admin membership")
			}
		}()
	}
	close(start)
	select {
	case <-repo.resolveStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("bootstrap auth resolution did not start")
	}
	time.Sleep(25 * time.Millisecond)
	close(repo.resolveRelease)
	waiters.Wait()
	close(errorsFound)
	for err := range errorsFound {
		t.Error(err)
	}
	resolveCalls, membershipCalls, active, maxActive := repo.stats()
	companyCalls, addMemberCalls := repo.bootstrapStats()
	if resolveCalls != 1 || membershipCalls != 2 || companyCalls != 1 || addMemberCalls != 1 {
		t.Fatalf("bootstrap calls = resolve %d memberships %d companies %d adds %d, want 1/2/1/1", resolveCalls, membershipCalls, companyCalls, addMemberCalls)
	}
	if active != 0 || maxActive != 1 {
		t.Fatalf("bootstrap database use = active %d max %d, want 0/1", active, maxActive)
	}
}

type coordinatedBootstrapRepo struct {
	store.Repository
	started chan struct{}
	release chan struct{}
	mu      sync.Mutex
	calls   int
	created int
}

func (r *coordinatedBootstrapRepo) BootstrapDevAdminContext(ctx context.Context, cognitoSubject, companyName string) (domain.CompanyMembership, bool, error) {
	r.mu.Lock()
	r.calls++
	if r.calls == 2 {
		close(r.started)
	}
	r.mu.Unlock()
	select {
	case <-r.release:
	case <-ctx.Done():
		return domain.CompanyMembership{}, false, ctx.Err()
	}
	membership, created, err := r.Repository.BootstrapDevAdminContext(ctx, cognitoSubject, companyName)
	if created {
		r.mu.Lock()
		r.created++
		r.mu.Unlock()
	}
	return membership, created, err
}

func TestAuthBootstrapIsAtomicAcrossServerInstances(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &coordinatedBootstrapRepo{Repository: base, started: make(chan struct{}), release: make(chan struct{})}
	options := ServerOptions{
		BootstrapDevAdmin:              BootstrapDevAdminConfig{Emails: []string{"cross-server@example.com"}, CompanyName: "Cross Server Bootstrap"},
		DisableRealtimeSpine:           true,
		DisableAttachmentUploadCleanup: true,
		DisableNotificationCleanup:     true,
	}
	servers := []*Server{NewServerWithOptions(repo, options), NewServerWithOptions(repo, options)}
	for _, server := range servers {
		t.Cleanup(server.Close)
	}
	claims := auth.Claims{Subject: "cross-server-bootstrap", Email: "cross-server@example.com", Name: "Cross Server User"}
	actors := make(chan ActorContext, len(servers))
	errorsFound := make(chan error, len(servers))
	for _, server := range servers {
		go func(server *Server) {
			actor, err := server.authenticatedActorForClaims(context.Background(), claims)
			if err != nil {
				errorsFound <- err
				return
			}
			actors <- actor
		}(server)
	}
	select {
	case <-repo.started:
	case <-time.After(2 * time.Second):
		t.Fatal("both server instances did not reach atomic bootstrap")
	}
	close(repo.release)
	for range servers {
		select {
		case err := <-errorsFound:
			t.Fatal(err)
		case actor := <-actors:
			if !actor.IsDevAdmin || len(actor.Memberships) != 1 {
				t.Fatalf("cross-server bootstrap actor = %+v, want one dev-admin membership", actor)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("cross-server bootstrap did not finish")
		}
	}
	companies, err := base.ListCompanies("", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(companies) != 1 {
		t.Fatalf("bootstrap companies = %d, want exactly one", len(companies))
	}
	repo.mu.Lock()
	defer repo.mu.Unlock()
	if repo.calls != 2 || repo.created != 1 {
		t.Fatalf("atomic bootstrap calls = %d created = %d, want 2/1", repo.calls, repo.created)
	}
}

type invalidationRaceAuthRepo struct {
	store.Repository
	started chan struct{}
	release chan struct{}
	once    sync.Once
	mu      sync.Mutex
	calls   int
}

func (r *invalidationRaceAuthRepo) ListUserMembershipsContext(ctx context.Context, userID string) ([]domain.CompanyMembership, error) {
	r.mu.Lock()
	r.calls++
	call := r.calls
	r.mu.Unlock()
	if call == 1 {
		r.once.Do(func() { close(r.started) })
		select {
		case <-r.release:
			return []domain.CompanyMembership{}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return r.Repository.ListUserMembershipsContext(ctx, userID)
}

func TestAuthInvalidationRacingLoadCannotRestoreStaleMemberships(t *testing.T) {
	base := store.NewMemoryRepo()
	const companyID = "25252525-2525-4252-8252-252525252525"
	const subject = "auth-invalidation-race"
	base.EnsureCompany(companyID, "Invalidation Race")
	if _, err := base.UpsertAuthUser(subject, "race@example.com", "Race User"); err != nil {
		t.Fatal(err)
	}
	if _, err := base.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	repo := &invalidationRaceAuthRepo{Repository: base, started: make(chan struct{}), release: make(chan struct{})}
	server := NewServerWithOptions(repo, ServerOptions{DisableRealtimeSpine: true, DisableNotificationCleanup: true})
	t.Cleanup(server.Close)
	claims := auth.Claims{Subject: subject, Email: "race@example.com", Name: "Race User"}
	actorResult := make(chan ActorContext, 1)
	errorResult := make(chan error, 1)
	go func() {
		actor, err := server.authenticatedActorForClaims(context.Background(), claims)
		if err != nil {
			errorResult <- err
			return
		}
		actorResult <- actor
	}()
	select {
	case <-repo.started:
	case <-time.After(time.Second):
		t.Fatal("stale membership load did not start")
	}
	server.authCache.invalidateSubject(subject)
	close(repo.release)
	select {
	case err := <-errorResult:
		t.Fatal(err)
	case actor := <-actorResult:
		if len(actor.Memberships) != 1 || actor.Memberships[0].CompanyID != companyID {
			t.Fatalf("actor memberships = %+v, want current company membership", actor.Memberships)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("auth resolution did not retry after invalidation")
	}
	repo.mu.Lock()
	defer repo.mu.Unlock()
	if repo.calls != 3 {
		t.Fatalf("membership loads = %d, want stale load, fenced membership retry, and fenced actor retry", repo.calls)
	}
}

type revocationRaceMembershipRepo struct {
	store.Repository
	started chan struct{}
	release chan struct{}
	stale   []domain.CompanyMembership
	mu      sync.Mutex
	calls   int
}

func (r *revocationRaceMembershipRepo) ListUserMembershipsContext(ctx context.Context, _ string) ([]domain.CompanyMembership, error) {
	r.mu.Lock()
	r.calls++
	call := r.calls
	r.mu.Unlock()
	if call == 1 {
		close(r.started)
		select {
		case <-r.release:
			return append([]domain.CompanyMembership(nil), r.stale...), nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return []domain.CompanyMembership{}, nil
}

func TestRealtimeMembershipCheckRetriesReadThatRacedRevocation(t *testing.T) {
	base := store.NewMemoryRepo()
	const companyID = "35353535-3535-4353-8353-353535353535"
	const subject = "realtime-revocation-race"
	base.EnsureCompany(companyID, "Realtime Revocation Race")
	user, err := base.UpsertAuthUser(subject, "revoked@example.com", "Revoked User")
	if err != nil {
		t.Fatal(err)
	}
	membership, err := base.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser)
	if err != nil {
		t.Fatal(err)
	}
	repo := &revocationRaceMembershipRepo{
		Repository: base,
		started:    make(chan struct{}),
		release:    make(chan struct{}),
		stale:      []domain.CompanyMembership{membership},
	}
	server := NewServerWithOptions(repo, ServerOptions{DisableRealtimeSpine: true, DisableNotificationCleanup: true})
	t.Cleanup(server.Close)
	actor := ActorContext{User: user, Memberships: []domain.CompanyMembership{membership}}
	type authorizationResult struct {
		authorized bool
		rejectCode string
		err        error
	}
	done := make(chan authorizationResult, 1)
	go func() {
		authorized, rejectCode, err := server.authorizeRealtimeSubscription(context.Background(), actor, companyID, realtimeProcessMapScope)
		done <- authorizationResult{authorized: authorized, rejectCode: rejectCode, err: err}
	}()
	select {
	case <-repo.started:
	case <-time.After(time.Second):
		t.Fatal("stale realtime membership read did not start")
	}
	server.authCache.invalidateUser(user.UserID)
	close(repo.release)
	select {
	case result := <-done:
		if result.err != nil || result.authorized || result.rejectCode != "company_access_denied" {
			t.Fatalf("authorization after revocation race = authorized %v reject %q err %v", result.authorized, result.rejectCode, result.err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("realtime membership check did not retry after revocation")
	}
	repo.mu.Lock()
	defer repo.mu.Unlock()
	if repo.calls != 2 {
		t.Fatalf("realtime membership loads = %d, want stale load plus current retry", repo.calls)
	}
}
