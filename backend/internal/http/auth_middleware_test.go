package httpapi

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"miraeopus/backend/internal/auth"
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
	_, err := repo.UpsertAuthUser(subject, "dev@example.com")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(companyID, "MangoRTS Dev")
	if _, err := repo.AddCompanyMembership(subject, companyID, "owner"); err != nil {
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
	_, err := repo.UpsertAuthUser(subject, "dev@example.com")
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

func TestAuthMiddlewareChecksBodyCompanyBeforeQueryCompany(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const allowedCompanyID = "11111111-1111-1111-1111-111111111111"
	const deniedCompanyID = "22222222-2222-2222-2222-222222222222"
	const subject = "cognito-user-1"
	_, err := repo.UpsertAuthUser(subject, "dev@example.com")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(allowedCompanyID, "MangoRTS Dev")
	if _, err := repo.AddCompanyMembership(subject, allowedCompanyID, "owner"); err != nil {
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
