package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

type fakeNylasClient struct {
	grant         NylasGrant
	deletedGrants []string
	folders       []NylasFolder
	messages      []NylasMessage
	message       NylasMessage
	sent          NylasSendMessageRequest
	update        NylasMessageUpdate
	listErr       error
	exchangeErr   error
}

func (f *fakeNylasClient) ExchangeCode(_ context.Context, _, _ string) (NylasGrant, error) {
	if f.exchangeErr != nil {
		return NylasGrant{}, f.exchangeErr
	}
	return f.grant, nil
}

func (f *fakeNylasClient) DeleteGrant(_ context.Context, grantID string) error {
	f.deletedGrants = append(f.deletedGrants, grantID)
	return nil
}

func (f *fakeNylasClient) ListFolders(_ context.Context, _ string) ([]NylasFolder, error) {
	return f.folders, nil
}

func (f *fakeNylasClient) ListMessages(_ context.Context, _ string, _ NylasMessageQuery) (NylasMessagePage, error) {
	if f.listErr != nil {
		return NylasMessagePage{}, f.listErr
	}
	return NylasMessagePage{Messages: f.messages, NextPageToken: "next-token"}, nil
}

func (f *fakeNylasClient) GetMessage(_ context.Context, _, _ string) (NylasMessage, error) {
	return f.message, nil
}

func (f *fakeNylasClient) UpdateMessage(_ context.Context, _, _ string, update NylasMessageUpdate) (NylasMessage, error) {
	f.update = update
	message := f.message
	if update.Unread != nil {
		message.Unread = *update.Unread
	}
	if update.Starred != nil {
		message.Starred = *update.Starred
	}
	if update.Folders != nil {
		message.Folders = update.Folders
	}
	return message, nil
}

func (f *fakeNylasClient) DeleteMessage(_ context.Context, _, _ string) error {
	return nil
}

func (f *fakeNylasClient) SendMessage(_ context.Context, _ string, request NylasSendMessageRequest) (NylasMessage, error) {
	f.sent = request
	return NylasMessage{ID: "sent-message", Subject: request.Subject, To: request.To}, nil
}

func TestNylasOAuthStateRoundTripAndExpiry(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 5, 8, 12, 0, 0, 0, time.UTC)
	state, err := signNylasOAuthState("secret", nylasOAuthStatePayload{
		UserID:   "user-1",
		Email:    "USER@example.COM",
		Provider: "gmail",
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := parseNylasOAuthState("secret", state, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if payload.UserID != "user-1" || payload.Email != "user@example.com" || payload.Provider != "google" {
		t.Fatalf("payload = %+v, want normalized user/email/provider", payload)
	}
	if _, err := parseNylasOAuthState("secret", state, now.Add(nylasOAuthStateTTL+time.Second)); !errors.Is(err, errExpiredNylasState) {
		t.Fatalf("expired state error = %v, want %v", err, errExpiredNylasState)
	}
	if _, err := parseNylasOAuthState("wrong-secret", state, now); !errors.Is(err, errInvalidNylasState) {
		t.Fatalf("wrong secret error = %v, want %v", err, errInvalidNylasState)
	}
}

func TestCommunicationsAuthURLIncludesSignedState(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   &fakeNylasClient{},
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/auth-url?provider=google", nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, "user@example.com"))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		AuthURL string `json:"auth_url"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(payload.AuthURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Query().Get("client_id") != "client-id" || parsed.Query().Get("provider") != "google" {
		t.Fatalf("auth url query = %s", parsed.RawQuery)
	}
	if scope := parsed.Query().Get("scope"); !strings.Contains(scope, "https://www.googleapis.com/auth/userinfo.email") || strings.Contains(scope, " userinfo.email ") {
		t.Fatalf("scope = %q, want fully-qualified Google scopes", scope)
	}
	state, err := parseNylasOAuthState("state-secret", parsed.Query().Get("state"), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if state.UserID != user.UserID || state.Email != "user@example.com" || state.Provider != "google" {
		t.Fatalf("state = %+v, want user-bound google state", state)
	}
}

func TestNylasGoogleScopesNormalizeShorthandEnvValues(t *testing.T) {
	t.Parallel()

	config := NylasConfig{
		GoogleScopes: []string{"openid", "userinfo.email", "gmail.modify", "gmail.send", "gmail.labels", "gmail.send"},
	}
	scopes := strings.Join(config.ScopesForProvider("google"), " ")
	if strings.Contains(scopes, "openid") || strings.Contains(scopes, " userinfo.email ") {
		t.Fatalf("scopes = %q, want unsupported shorthand scopes removed or normalized", scopes)
	}
	for _, want := range []string{
		"https://www.googleapis.com/auth/userinfo.email",
		"https://www.googleapis.com/auth/gmail.modify",
		"https://www.googleapis.com/auth/gmail.send",
		"https://www.googleapis.com/auth/gmail.labels",
	} {
		if !strings.Contains(scopes, want) {
			t.Fatalf("scopes = %q, missing %q", scopes, want)
		}
	}
	if strings.Count(scopes, "https://www.googleapis.com/auth/gmail.send") != 1 {
		t.Fatalf("scopes = %q, want duplicate scopes removed", scopes)
	}
}

func TestNylasCallbackStoresGrantAndRejectsEmailMismatch(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("subject", "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:   user.UserID,
		Email:    user.Email,
		Provider: "microsoft",
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "grant-1", Email: user.Email, Provider: "microsoft"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("success callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	connection, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.GrantID != "grant-1" || connection.Provider != "microsoft" || connection.AccountEmail != user.Email {
		t.Fatalf("connection = %+v, want stored grant metadata", connection)
	}

	mismatchRepo := store.NewMemoryRepo()
	mismatchUser, err := mismatchRepo.UpsertAuthUser("subject", "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	mismatchState, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:   mismatchUser.UserID,
		Email:    mismatchUser.Email,
		Provider: "google",
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	mismatchNylas := &fakeNylasClient{grant: NylasGrant{GrantID: "grant-2", Email: "other@example.com", Provider: "google"}}
	mismatchHandler := NewServerWithOptions(mismatchRepo, ServerOptions{
		NylasConfig: config,
		NylasClient: mismatchNylas,
	}).Routes()
	mismatchReq := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(mismatchState), nil)
	mismatchRec := httptest.NewRecorder()
	mismatchHandler.ServeHTTP(mismatchRec, mismatchReq)
	if mismatchRec.Code != http.StatusFound {
		t.Fatalf("mismatch callback status = %d", mismatchRec.Code)
	}
	if !strings.Contains(mismatchRec.Header().Get("Location"), "nylas_error=nylas_email_mismatch") {
		t.Fatalf("mismatch redirect = %s", mismatchRec.Header().Get("Location"))
	}
	if _, err := mismatchRepo.GetUserEmailConnection(mismatchUser.UserID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("mismatch connection error = %v, want ErrNotFound", err)
	}
	if len(mismatchNylas.deletedGrants) != 1 || mismatchNylas.deletedGrants[0] != "grant-2" {
		t.Fatalf("deleted grants = %v, want grant cleanup", mismatchNylas.deletedGrants)
	}
}

func TestCommunicationsProxyHandlersUseStoredGrant(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		folders:  []NylasFolder{{ID: "inbox", Name: "Inbox", Attributes: []string{"\\Inbox"}}},
		messages: []NylasMessage{{ID: "message-1", Subject: "Hello", Unread: true}},
		message:  NylasMessage{ID: "message-1", Subject: "Hello", Body: "Body", Unread: true},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/status", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?limit=5&unread=true", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages/message-1", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodPut, "/v1/communications/messages/message-1", `{"unread":false,"folders":["archive"]}`, token, http.StatusOK)
	if nylas.update.Unread == nil || *nylas.update.Unread || len(nylas.update.Folders) != 1 || nylas.update.Folders[0] != "archive" {
		t.Fatalf("update = %+v, want unread=false and archive folder", nylas.update)
	}
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/send", `{"to":[{"email":"friend@example.com"}],"subject":"Hi","body":"Body"}`, token, http.StatusCreated)
	if nylas.sent.To[0].Email != "friend@example.com" || nylas.sent.Subject != "Hi" {
		t.Fatalf("sent = %+v, want normalized send request", nylas.sent)
	}
	assertJSONStatus(t, handler, http.MethodDelete, "/v1/communications/messages/message-1", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/disconnect", "", token, http.StatusOK)
	if _, err := repo.GetUserEmailConnection(user.UserID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("connection after disconnect error = %v, want ErrNotFound", err)
	}
}

func TestCommunicationsCollaborationHandlers(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const subject = "email-user"
	repo.EnsureCompany(companyID, "MangoRTS Dev")
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	messagePath := "/v1/communications/collaboration/message-1"

	assertJSONStatus(t, handler, http.MethodGet, messagePath+"?company_id="+companyID, "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodPut, messagePath, `{"company_id":"`+companyID+`","shared_inbox":true,"assigned_user_id":"`+user.UserID+`","status":"pending"}`, token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodPost, messagePath+"/comments", `{"company_id":"`+companyID+`","body":"checking this"}`, token, http.StatusCreated)
	assertJSONStatus(t, handler, http.MethodPost, messagePath+"/drafts", `{"company_id":"`+companyID+`","subject":"Re: Hello","body":"Shared draft"}`, token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodPost, messagePath+"/read-receipts", `{"company_id":"`+companyID+`"}`, token, http.StatusOK)

	req := httptest.NewRequest(http.MethodGet, messagePath+"?company_id="+companyID, nil)
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("collaboration status = %d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		State struct {
			SharedInbox    bool   `json:"shared_inbox"`
			Status         string `json:"status"`
			AssignedUserID string `json:"assigned_user_id"`
		} `json:"state"`
		Comments     []domain.CommunicationsMessageComment `json:"comments"`
		Drafts       []domain.CommunicationsSharedDraft    `json:"drafts"`
		ReadReceipts []domain.CommunicationsReadReceipt    `json:"read_receipts"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if !payload.State.SharedInbox || payload.State.Status != "pending" || payload.State.AssignedUserID != user.UserID {
		t.Fatalf("state = %+v, want shared pending assigned", payload.State)
	}
	if len(payload.Comments) != 1 || len(payload.Drafts) != 1 || len(payload.ReadReceipts) != 1 {
		t.Fatalf("collaboration payload counts comments=%d drafts=%d receipts=%d", len(payload.Comments), len(payload.Drafts), len(payload.ReadReceipts))
	}
}

func TestNylasWebhookPublishesCommunicationsWorkspaceEvent(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const subject = "email-user"
	repo.EnsureCompany(companyID, "MangoRTS Dev")
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	config.WebhookSecret = "webhook-secret"
	server := NewServerWithOptions(repo, ServerOptions{NylasConfig: config})
	handler := server.Routes()

	ch := server.hub.subscribe()
	defer server.hub.unsubscribe(ch)

	challengeReq := httptest.NewRequest(http.MethodGet, "/nylas/webhooks?challenge=abc123", nil)
	challengeRec := httptest.NewRecorder()
	handler.ServeHTTP(challengeRec, challengeReq)
	if challengeRec.Code != http.StatusOK || challengeRec.Body.String() != "abc123" {
		t.Fatalf("challenge status=%d body=%q", challengeRec.Code, challengeRec.Body.String())
	}

	body := `{"type":"message.created","data":{"object":{"id":"message-1","grant_id":"grant-1","subject":"Hello"}}}`
	req := httptest.NewRequest(http.MethodPost, "/nylas/webhooks", strings.NewReader(body))
	req.Header.Set("x-nylas-signature", signWebhookBody(config.WebhookSecret, body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("webhook status = %d body=%s", rec.Code, rec.Body.String())
	}
	select {
	case raw := <-ch:
		var envelope workspaceEventEnvelope
		if err := json.Unmarshal(raw, &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.CompanyID != companyID || envelope.Type != "communications_message_created" {
			t.Fatalf("envelope = %+v, want communications message event for company", envelope)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for workspace event")
	}
}

func TestCommunicationsNylasAuthErrorMarksReauthRequired(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   &fakeNylasClient{listErr: NylasAPIError{StatusCode: http.StatusUnauthorized, Code: "unauthorized"}},
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages", nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, user.Email))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 body=%s", rec.Code, rec.Body.String())
	}
	connection, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.Status != "reauth_required" {
		t.Fatalf("connection status = %q, want reauth_required", connection.Status)
	}
}

func signWebhookBody(secret, body string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(body))
	return hex.EncodeToString(mac.Sum(nil))
}

func assertJSONStatus(t *testing.T, handler http.Handler, method, path, body, authHeader string, want int) {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != want {
		t.Fatalf("%s %s status = %d, want %d body=%s", method, path, rec.Code, want, rec.Body.String())
	}
}

func testNylasConfig() NylasConfig {
	return NylasConfig{
		ClientID:            "client-id",
		APIKey:              "api-key",
		APIBaseURL:          "https://api.us.nylas.com",
		RedirectURI:         "http://api.test/nylas/oauth/callback",
		FrontendRedirectURL: "http://ui.test/communications",
		StateSecret:         "state-secret",
	}
}
