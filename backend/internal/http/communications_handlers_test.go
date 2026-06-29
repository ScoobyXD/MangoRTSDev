package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeNylasClient struct {
	mu                       sync.Mutex
	grant                    NylasGrant
	deletedGrants            []string
	folders                  []NylasFolder
	messages                 []NylasMessage
	messagesByGrantID        map[string][]NylasMessage
	messagesByID             map[string]NylasMessage
	thread                   NylasThread
	message                  NylasMessage
	sent                     NylasSendMessageRequest
	update                   NylasMessageUpdate
	updateCalls              []fakeNylasUpdateCall
	updateErrByID            map[string]error
	downloadContent          []byte
	downloadErr              error
	rawMIME                  string
	rawMIMEErr               error
	lastQuery                NylasMessageQuery
	lastMessageGrantID       string
	lastRawMIMEGrantID       string
	lastRawMIMEMessageID     string
	lastDownloadGrantID      string
	lastDownloadMessageID    string
	lastDownloadAttachmentID string
	lastFolderGrantID        string
	lastSendGrantID          string
	folderCalls              int
	messageCalls             int
	detailCalls              int
	listErr                  error
	exchangeErr              error
}

type fakeNylasUpdateCall struct {
	MessageID string
	Update    NylasMessageUpdate
}

func (f *fakeNylasClient) ExchangeCode(_ context.Context, _, _ string) (NylasGrant, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.exchangeErr != nil {
		return NylasGrant{}, f.exchangeErr
	}
	return f.grant, nil
}

func (f *fakeNylasClient) DeleteGrant(_ context.Context, grantID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deletedGrants = append(f.deletedGrants, grantID)
	return nil
}

func (f *fakeNylasClient) ListFolders(_ context.Context, grantID string) ([]NylasFolder, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.folderCalls++
	f.lastFolderGrantID = grantID
	return f.folders, nil
}

func (f *fakeNylasClient) ListMessages(_ context.Context, grantID string, query NylasMessageQuery) (NylasMessagePage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.messageCalls++
	f.lastQuery = query
	f.lastMessageGrantID = grantID
	if f.listErr != nil {
		return NylasMessagePage{}, f.listErr
	}
	if f.messagesByGrantID != nil {
		if messages, ok := f.messagesByGrantID[grantID]; ok {
			return NylasMessagePage{Messages: messages, NextPageToken: "next-token"}, nil
		}
	}
	return NylasMessagePage{Messages: f.messages, NextPageToken: "next-token"}, nil
}

func (f *fakeNylasClient) GetThread(_ context.Context, _, threadID string) (NylasThread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	thread := f.thread
	if thread.ID == "" {
		thread.ID = threadID
	}
	return thread, nil
}

func (f *fakeNylasClient) GetMessage(_ context.Context, _, messageID string) (NylasMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.detailCalls++
	if f.messagesByID != nil {
		if message, ok := f.messagesByID[messageID]; ok {
			return message, nil
		}
	}
	return f.message, nil
}

func (f *fakeNylasClient) GetMessageRawMIME(_ context.Context, grantID, messageID string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lastRawMIMEGrantID = grantID
	f.lastRawMIMEMessageID = messageID
	if f.rawMIMEErr != nil {
		return "", f.rawMIMEErr
	}
	return f.rawMIME, nil
}

func (f *fakeNylasClient) DownloadAttachment(_ context.Context, grantID, messageID, attachmentID string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lastDownloadGrantID = grantID
	f.lastDownloadMessageID = messageID
	f.lastDownloadAttachmentID = attachmentID
	if f.downloadErr != nil {
		return nil, f.downloadErr
	}
	return append([]byte(nil), f.downloadContent...), nil
}

func (f *fakeNylasClient) UpdateMessage(_ context.Context, _, messageID string, update NylasMessageUpdate) (NylasMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.updateErrByID != nil && f.updateErrByID[messageID] != nil {
		return NylasMessage{}, f.updateErrByID[messageID]
	}
	f.update = update
	f.updateCalls = append(f.updateCalls, fakeNylasUpdateCall{MessageID: messageID, Update: update})
	message := f.message
	if f.messagesByID != nil {
		if stored, ok := f.messagesByID[messageID]; ok {
			message = stored
		}
	}
	if message.ID == "" {
		message.ID = messageID
	}
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

func (f *fakeNylasClient) SendMessage(_ context.Context, grantID string, request NylasSendMessageRequest) (NylasMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lastSendGrantID = grantID
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
	if parsed.Query().Get("login_hint") != "user@example.com" {
		t.Fatalf("login_hint = %q, want user@example.com", parsed.Query().Get("login_hint"))
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
	if state.UserEmail != "user@example.com" {
		t.Fatalf("state.UserEmail = %q, want user@example.com", state.UserEmail)
	}
	if !state.StrictEmail {
		t.Fatalf("state.StrictEmail = false, want true for personal auth URL")
	}
}

func TestCommunicationsAuthURLSharedInboxIntentRequiresManagerOrAdmin(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "company-shared-auth-url-manager-required"
	repo.EnsureCompany(companyID, "Shared Auth URL Manager Required")
	member, err := repo.UpsertAuthUser("subject-shared-auth-url-member", "member@example.com", "Member")
	if err != nil {
		t.Fatal(err)
	}
	manager, err := repo.UpsertAuthUser("subject-shared-auth-url-manager", "manager@example.com", "Manager")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(member.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(manager.CognitoSubject, companyID, domain.RoleCompanyManager); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   &fakeNylasClient{},
	}).Routes()
	path := "/v1/communications/auth-url?provider=google&account_email=support%40example.com&shared_inbox_company_id=" + url.QueryEscape(companyID) + "&shared_inbox_name=Support"

	memberReq := httptest.NewRequest(http.MethodGet, path, nil)
	memberReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", member.CognitoSubject, member.Email))
	memberRec := httptest.NewRecorder()
	handler.ServeHTTP(memberRec, memberReq)
	if memberRec.Code != http.StatusForbidden {
		t.Fatalf("shared auth URL as member status = %d, want %d body=%s", memberRec.Code, http.StatusForbidden, memberRec.Body.String())
	}

	managerReq := httptest.NewRequest(http.MethodGet, path, nil)
	managerReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", manager.CognitoSubject, manager.Email))
	managerRec := httptest.NewRecorder()
	handler.ServeHTTP(managerRec, managerReq)
	if managerRec.Code != http.StatusOK {
		t.Fatalf("shared auth URL as manager status = %d, want %d body=%s", managerRec.Code, http.StatusOK, managerRec.Body.String())
	}
}

func TestNylasGoogleScopesNormalizeShorthandEnvValues(t *testing.T) {
	t.Parallel()

	config := NylasConfig{
		GoogleScopes: []string{"openid", "userinfo.email", "gmail.modify", "gmail.send", "gmail.labels", "calendar", "gmail.send"},
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
		"https://www.googleapis.com/auth/calendar",
	} {
		if !strings.Contains(scopes, want) {
			t.Fatalf("scopes = %q, missing %q", scopes, want)
		}
	}
	if strings.Count(scopes, "https://www.googleapis.com/auth/gmail.send") != 1 {
		t.Fatalf("scopes = %q, want duplicate scopes removed", scopes)
	}
}

func TestNylasFolderUnmarshalAcceptsBooleanSystemFolder(t *testing.T) {
	t.Parallel()

	var payload struct {
		Data []NylasFolder `json:"data"`
	}
	err := json.Unmarshal([]byte(`{"data":[{"id":"inbox","name":"Inbox","system_folder":"inbox"},{"id":"label-1","name":"Label","system_folder":false}]}`), &payload)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload.Data) != 2 {
		t.Fatalf("folders = %d, want 2", len(payload.Data))
	}
	if payload.Data[0].SystemFolder != "inbox" {
		t.Fatalf("string system_folder = %q, want inbox", payload.Data[0].SystemFolder)
	}
	if payload.Data[1].SystemFolder != "" {
		t.Fatalf("boolean system_folder = %q, want empty", payload.Data[1].SystemFolder)
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
		UserID:      user.UserID,
		Email:       user.Email,
		UserEmail:   user.Email,
		Provider:    "microsoft",
		StrictEmail: true,
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
		UserID:      mismatchUser.UserID,
		Email:       mismatchUser.Email,
		Provider:    "google",
		StrictEmail: true,
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

func TestNylasCallbackRejectsPersonalAccountEmailMismatch(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("subject", "profile@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:    user.UserID,
		Email:     user.Email,
		UserEmail: user.Email,
		Provider:  "google",
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "grant-1", Email: "mailbox@example.com", Provider: "google"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Header().Get("Location"), "nylas_error=nylas_email_mismatch") {
		t.Fatalf("callback redirect = %s, want email mismatch", rec.Header().Get("Location"))
	}
	if _, err := repo.GetUserEmailConnection(user.UserID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("connection error = %v, want ErrNotFound", err)
	}
	if len(nylas.deletedGrants) != 1 || nylas.deletedGrants[0] != "grant-1" {
		t.Fatalf("deleted grants = %v, want mismatched grant cleanup", nylas.deletedGrants)
	}
}

func TestNylasCallbackRecoversPersonalUserByEmailWhenStateUserIDIsStale(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("new-subject", "profile@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:      "deleted-user-id",
		Email:       user.Email,
		UserEmail:   user.Email,
		Provider:    "google",
		StrictEmail: true,
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "grant-1", Email: user.Email, Provider: "google"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Header().Get("Location"), "nylas_error=") {
		t.Fatalf("callback redirect = %s, want success", rec.Header().Get("Location"))
	}
	connection, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.UserID != user.UserID || connection.AccountEmail != user.Email || connection.GrantID != "grant-1" {
		t.Fatalf("connection = %+v, want recovered user connection", connection)
	}
	if len(nylas.deletedGrants) != 0 {
		t.Fatalf("deleted grants = %v, want none", nylas.deletedGrants)
	}
}

func TestNylasCallbackDeletesGrantWhenConnectionStoreFails(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:      "missing-user-id",
		Email:       "missing@example.com",
		UserEmail:   "missing@example.com",
		Provider:    "google",
		StrictEmail: true,
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "orphan-grant", Email: "missing@example.com", Provider: "google"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Header().Get("Location"), "nylas_error=mango_user_not_found") {
		t.Fatalf("callback redirect = %s, want mango_user_not_found", rec.Header().Get("Location"))
	}
	if len(nylas.deletedGrants) != 1 || nylas.deletedGrants[0] != "orphan-grant" {
		t.Fatalf("deleted grants = %v, want orphan grant cleanup", nylas.deletedGrants)
	}
}

func TestNylasCallbackStoresSharedAccountWithoutOverwritingPersonalConnection(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("subject", "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "personal-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:      user.UserID,
		Email:       "shared@example.com",
		UserEmail:   user.Email,
		Provider:    "google",
		StrictEmail: true,
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "shared-grant", Email: "shared@example.com", Provider: "google"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	redirect, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if redirect.Query().Get("nylas_scope") != "shared" || redirect.Query().Get("nylas_account_email") != "shared@example.com" {
		t.Fatalf("callback redirect = %s, want shared scope and account email", redirect.String())
	}
	personal, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if personal.AccountEmail != user.Email || personal.GrantID != "personal-grant" {
		t.Fatalf("personal connection = %+v, want unchanged personal grant", personal)
	}
	if _, err := repo.GetUserEmailConnectionByGrantID("shared-grant"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("shared user connection lookup error = %v, want ErrNotFound", err)
	}
}

func TestNylasCallbackCreatesSharedInboxFromOAuthIntent(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	const companyID = "company-shared-oauth-create"
	repo.EnsureCompany(companyID, "Shared OAuth Create")
	user, err := repo.UpsertAuthUser("subject-shared-oauth-create", "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyManager); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		Scope:        "personal",
		GrantID:      "personal-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	parent, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support Group", "")
	if err != nil {
		t.Fatal(err)
	}

	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:                    user.UserID,
		Email:                     "support@example.com",
		UserEmail:                 user.Email,
		Provider:                  "google",
		StrictEmail:               true,
		SharedInboxCompanyID:      companyID,
		SharedInboxParentFolderID: parent.FolderID,
		SharedInboxName:           "Support",
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "shared-oauth-grant", Email: "support@example.com", Provider: "google"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	redirect, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	sharedInboxID := redirect.Query().Get("nylas_shared_inbox_id")
	if redirect.Query().Get("nylas_scope") != "shared" || redirect.Query().Get("nylas_account_email") != "support@example.com" || sharedInboxID == "" {
		t.Fatalf("callback redirect = %s, want shared scope, account email, and shared inbox id", redirect.String())
	}
	created, err := repo.GetCommunicationsSharedInboxFolder(companyID, sharedInboxID)
	if err != nil {
		t.Fatal(err)
	}
	if created.Name != "Support" || created.ParentFolderID == nil || *created.ParentFolderID != parent.FolderID || created.AccountEmail == nil || *created.AccountEmail != "support@example.com" || created.EntryType != "shared_inbox" {
		t.Fatalf("created shared inbox = %+v, want Support mailbox under parent with support account", created)
	}
	personal, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if personal.AccountEmail != user.Email || personal.GrantID != "personal-grant" || personal.Scope != "personal" {
		t.Fatalf("personal connection = %+v, want unchanged personal grant", personal)
	}
	shared, err := repo.GetCompanyEmailConnectionByAccountEmail(companyID, "support@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if shared.AccountEmail != "support@example.com" || shared.GrantID != "shared-oauth-grant" || shared.ConnectedByUserID != user.UserID {
		t.Fatalf("shared company connection = %+v, want company-owned support grant", shared)
	}
}

func TestNylasCallbackRejectsSharedInboxOAuthIntentForCompanyUser(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	const companyID = "company-shared-oauth-create-member-denied"
	repo.EnsureCompany(companyID, "Shared OAuth Create Member Denied")
	user, err := repo.UpsertAuthUser("subject-shared-oauth-create-member", "member@example.com", "Member")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	parent, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support Group", "")
	if err != nil {
		t.Fatal(err)
	}

	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:                    user.UserID,
		Email:                     "support@example.com",
		UserEmail:                 user.Email,
		Provider:                  "google",
		StrictEmail:               true,
		SharedInboxCompanyID:      companyID,
		SharedInboxParentFolderID: parent.FolderID,
		SharedInboxName:           "Support",
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "regular-shared-grant", Email: "support@example.com", Provider: "google"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	redirect, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if redirect.Query().Get("nylas_error") != "company_manager_required" {
		t.Fatalf("callback redirect = %s, want company_manager_required", redirect.String())
	}
	folders, err := repo.ListCommunicationsSharedInboxFolders(companyID)
	if err != nil {
		t.Fatal(err)
	}
	if len(folders) != 1 || folders[0].FolderID != parent.FolderID {
		t.Fatalf("shared inbox folders = %+v, want only original parent", folders)
	}
	if _, err := repo.GetCompanyEmailConnectionByAccountEmail(companyID, "support@example.com"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("shared company connection error = %v, want ErrNotFound", err)
	}
	nylas.mu.Lock()
	deletedGrants := append([]string(nil), nylas.deletedGrants...)
	nylas.mu.Unlock()
	if len(deletedGrants) != 1 || deletedGrants[0] != "regular-shared-grant" {
		t.Fatalf("deleted grants = %+v, want regular-shared-grant cleanup", deletedGrants)
	}
}

func TestNylasCallbackTreatsStrictUserMailboxAsPersonalConnection(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("subject", "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		Scope:        "personal",
		GrantID:      "old-personal-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:      user.UserID,
		Email:       user.Email,
		UserEmail:   user.Email,
		Provider:    "google",
		StrictEmail: true,
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "new-grant", Email: user.Email, Provider: "google"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	connection, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.Scope != "personal" || connection.AccountEmail != user.Email || connection.GrantID != "new-grant" {
		t.Fatalf("connection = %+v, want updated personal user mailbox grant", connection)
	}
	redirect, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if redirect.Query().Get("nylas_scope") != "personal" || redirect.Query().Get("nylas_account_email") != user.Email {
		t.Fatalf("callback redirect = %s, want personal scope and account email", redirect.String())
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
		folders:         []NylasFolder{{ID: "inbox", Name: "Inbox", Attributes: []string{"\\Inbox"}}},
		messages:        []NylasMessage{{ID: "message-1", Subject: "Hello", Unread: true, Attachments: []NylasAttachment{{ID: "attachment-1", Filename: "photo.jpg", ContentType: "image/jpeg", Size: 12}}}},
		message:         NylasMessage{ID: "message-1", Subject: "Hello", Body: "Body", Unread: true, Attachments: []NylasAttachment{{ID: "attachment-1", Filename: "photo.jpg", ContentType: "image/jpeg", Size: 12}}},
		downloadContent: []byte("photo-bytes"),
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
	attachmentReq := httptest.NewRequest(http.MethodGet, "/v1/communications/messages/message-1/attachments/attachment-1", nil)
	attachmentReq.Header.Set("Authorization", token)
	attachmentRec := httptest.NewRecorder()
	handler.ServeHTTP(attachmentRec, attachmentReq)
	if attachmentRec.Code != http.StatusOK {
		t.Fatalf("attachment status = %d body=%s", attachmentRec.Code, attachmentRec.Body.String())
	}
	if attachmentRec.Header().Get("Content-Type") != "image/jpeg" || attachmentRec.Body.String() != "photo-bytes" {
		t.Fatalf("attachment content-type=%q body=%q, want image/jpeg photo-bytes", attachmentRec.Header().Get("Content-Type"), attachmentRec.Body.String())
	}
	if nylas.lastDownloadGrantID != "grant-1" || nylas.lastDownloadMessageID != "message-1" || nylas.lastDownloadAttachmentID != "attachment-1" {
		t.Fatalf("download scope grant=%q message=%q attachment=%q", nylas.lastDownloadGrantID, nylas.lastDownloadMessageID, nylas.lastDownloadAttachmentID)
	}
	assertJSONStatus(t, handler, http.MethodPut, "/v1/communications/messages/message-1", `{"unread":false,"folders":["archive"]}`, token, http.StatusOK)
	if nylas.update.Unread == nil || *nylas.update.Unread || len(nylas.update.Folders) != 1 || nylas.update.Folders[0] != "archive" {
		t.Fatalf("update = %+v, want unread=false and archive folder", nylas.update)
	}
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/send", `{"to":[{"email":"friend@example.com"}],"subject":"Hi","body":"Body","attachments":[{"filename":"note.txt","content":"aGVsbG8="}]}`, token, http.StatusCreated)
	if nylas.sent.To[0].Email != "friend@example.com" || nylas.sent.Subject != "Hi" {
		t.Fatalf("sent = %+v, want normalized send request", nylas.sent)
	}
	if nylas.sent.TrackingOptions == nil || !nylas.sent.TrackingOptions.Opens {
		t.Fatalf("tracking options = %+v, want opens enabled", nylas.sent.TrackingOptions)
	}
	if len(nylas.sent.Attachments) != 1 || nylas.sent.Attachments[0].Filename != "note.txt" || nylas.sent.Attachments[0].ContentType != "application/octet-stream" || nylas.sent.Attachments[0].Content != "aGVsbG8=" {
		t.Fatalf("attachments = %+v, want normalized attachment", nylas.sent.Attachments)
	}
	assertJSONStatus(t, handler, http.MethodDelete, "/v1/communications/messages/message-1", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/disconnect", "", token, http.StatusOK)
	if _, err := repo.GetUserEmailConnection(user.UserID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("connection after disconnect error = %v, want ErrNotFound", err)
	}
}

func TestCommunicationsMessageFallsBackToRawMIMEAttachments(t *testing.T) {
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
		message: NylasMessage{ID: "message-1", Subject: "Photos", Body: "Body"},
		rawMIME: strings.Join([]string{
			"From: Sender <sender@example.com>",
			"To: User <user@example.com>",
			"Subject: Photos",
			"MIME-Version: 1.0",
			`Content-Type: multipart/mixed; boundary="mango-boundary"`,
			"",
			"--mango-boundary",
			"Content-Type: text/plain; charset=utf-8",
			"",
			"Body",
			"--mango-boundary",
			`Content-Type: image/png; name="photo.png"`,
			`Content-Disposition: attachment; filename="photo.png"`,
			"Content-Transfer-Encoding: base64",
			"",
			"aW1hZ2UtYnl0ZXM=",
			"--mango-boundary--",
			"",
		}, "\r\n"),
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages/message-1", nil)
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("message status = %d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Message NylasMessage `json:"message"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if nylas.lastRawMIMEGrantID != "grant-1" || nylas.lastRawMIMEMessageID != "message-1" {
		t.Fatalf("raw mime scope grant=%q message=%q", nylas.lastRawMIMEGrantID, nylas.lastRawMIMEMessageID)
	}
	if len(payload.Message.Attachments) != 1 {
		t.Fatalf("attachments = %+v, want one raw MIME attachment", payload.Message.Attachments)
	}
	attachment := payload.Message.Attachments[0]
	if attachment.Filename != "photo.png" || attachment.ContentType != "image/png" || attachment.Content != "aW1hZ2UtYnl0ZXM=" || attachment.Size != int64(len("image-bytes")) {
		t.Fatalf("attachment = %+v, want png content from raw MIME", attachment)
	}
	attachmentReq := httptest.NewRequest(http.MethodGet, "/v1/communications/messages/message-1/attachments/raw-mime-1", nil)
	attachmentReq.Header.Set("Authorization", token)
	attachmentRec := httptest.NewRecorder()
	handler.ServeHTTP(attachmentRec, attachmentReq)
	if attachmentRec.Code != http.StatusOK {
		t.Fatalf("raw MIME attachment status = %d body=%s", attachmentRec.Code, attachmentRec.Body.String())
	}
	if attachmentRec.Header().Get("Content-Type") != "image/png" || attachmentRec.Body.String() != "image-bytes" {
		t.Fatalf("raw MIME attachment content-type=%q body=%q, want image/png image-bytes", attachmentRec.Header().Get("Content-Type"), attachmentRec.Body.String())
	}
	if nylas.lastDownloadAttachmentID != "" {
		t.Fatalf("download attachment id = %q, want raw MIME inline content without provider download", nylas.lastDownloadAttachmentID)
	}
}

func TestCommunicationsSendAllowsLargeAttachmentBodyWithQueryCompanyID(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "11111111-1111-1111-1111-111111111111"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(companyID, "Company")
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
	nylas := &fakeNylasClient{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	largeContent := strings.Repeat("QUJD", 280000)
	body := `{"to":[{"email":"friend@example.com"}],"subject":"Hi","body":"Body","attachments":[{"filename":"large.txt","content":"` + largeContent + `"}]}`

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/send?company_id="+companyID, body, token, http.StatusCreated)
	if len(nylas.sent.Attachments) != 1 || nylas.sent.Attachments[0].Filename != "large.txt" {
		t.Fatalf("attachments = %+v, want large attachment to reach Nylas send", nylas.sent.Attachments)
	}
}

func TestCommunicationsSendAllowsLargePersonalAttachmentBodyWithoutCompanyID(t *testing.T) {
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
	nylas := &fakeNylasClient{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	largeContent := strings.Repeat("QUJD", 280000)
	body := `{"to":[{"email":"friend@example.com"}],"subject":"Hi","body":"Body","attachments":[{"filename":"large.txt","content":"` + largeContent + `"}]}`

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/send", body, token, http.StatusCreated)
	if len(nylas.sent.Attachments) != 1 || nylas.sent.Attachments[0].Filename != "large.txt" {
		t.Fatalf("attachments = %+v, want large personal attachment to reach Nylas send", nylas.sent.Attachments)
	}
}

func TestCommunicationsFoldersUseSharedInboxConnection(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "company-shared-folders"
	repo.EnsureCompany(companyID, "Shared Folders Company")
	actor, err := repo.UpsertAuthUser("actor-subject", "actor@example.com", "Actor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("actor-subject", companyID, "company_user"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
		CompanyID:         companyID,
		Provider:          "microsoft",
		AccountEmail:      "support@example.com",
		GrantID:           "grant-shared",
		Status:            "connected",
		ConnectedByUserID: actor.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", "support@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeSharedInbox,
		EntityID:   folder.FolderID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   actor.UserID,
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	totalCount := 42
	nylas := &fakeNylasClient{
		folders: []NylasFolder{{ID: "archive", Name: "Archive", Attributes: []string{"\\Archive"}, TotalCount: &totalCount}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", actor.CognitoSubject, actor.Email)

	path := "/v1/communications/folders?company_id=" + url.QueryEscape(companyID) + "&shared_inbox_id=" + url.QueryEscape(folder.FolderID)
	assertJSONStatus(t, handler, http.MethodGet, path, "", token, http.StatusOK)
	if nylas.lastFolderGrantID != "grant-shared" {
		t.Fatalf("folder grant = %q, want shared inbox grant", nylas.lastFolderGrantID)
	}
}

func TestCommunicationsMessagesCacheIsScopedPerSharedInboxAccount(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "company-shared-message-cache"
	repo.EnsureCompany(companyID, "Shared Message Cache Company")
	actor, err := repo.UpsertAuthUser("cache-actor", "actor@example.com", "Actor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       actor.UserID,
		Provider:     "google",
		AccountEmail: actor.Email,
		GrantID:      "grant-personal",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       actor.UserID,
		Provider:     "google",
		AccountEmail: "support@example.com",
		Scope:        "shared",
		GrantID:      "grant-shared",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", "support@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeSharedInbox,
		EntityID:   folder.FolderID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   actor.UserID,
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		messagesByGrantID: map[string][]NylasMessage{
			"grant-personal": {{ID: "personal-message", Subject: "Personal inbox"}},
			"grant-shared":   {{ID: "shared-message", Subject: "Shared inbox"}},
		},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", actor.CognitoSubject, actor.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5", "", token, http.StatusOK)
	if nylas.lastMessageGrantID != "grant-personal" {
		t.Fatalf("personal message grant = %q, want grant-personal", nylas.lastMessageGrantID)
	}

	sharedPath := "/v1/communications/messages?mailbox=primary&limit=5&company_id=" + url.QueryEscape(companyID) + "&shared_inbox_id=" + url.QueryEscape(folder.FolderID)
	req := httptest.NewRequest(http.MethodGet, sharedPath, nil)
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("shared inbox messages status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	if nylas.lastMessageGrantID != "grant-shared" {
		t.Fatalf("shared message grant = %q, want grant-shared", nylas.lastMessageGrantID)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "shared-message") || strings.Contains(body, "personal-message") {
		t.Fatalf("shared inbox response = %s, want shared mailbox messages only", body)
	}
	if nylas.messageCalls != 2 {
		t.Fatalf("message calls = %d, want personal and shared Nylas reads", nylas.messageCalls)
	}
	assertJSONStatus(t, handler, http.MethodGet, sharedPath, "", token, http.StatusOK)
	if nylas.messageCalls != 2 {
		t.Fatalf("message calls after shared cache read = %d, want cached shared page", nylas.messageCalls)
	}
}

func TestCommunicationsSendUsesSharedInboxConnectionAndRequiresEdit(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "company-shared-send"
	repo.EnsureCompany(companyID, "Shared Send Company")
	actor, err := repo.UpsertAuthUser("shared-send-actor", "actor@example.com", "Actor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	sharedUser, err := repo.UpsertAuthUser("shared-send-account", "support@example.com", "Support")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(sharedUser.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       sharedUser.UserID,
		Provider:     "google",
		AccountEmail: sharedUser.Email,
		Scope:        "shared",
		GrantID:      "grant-support",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", sharedUser.Email)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeSharedInbox,
		EntityID:         folder.FolderID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", actor.CognitoSubject, actor.Email)
	path := "/v1/communications/messages/send?company_id=" + url.QueryEscape(companyID) + "&shared_inbox_id=" + url.QueryEscape(folder.FolderID)
	body := `{"to":[{"email":"customer@example.com"}],"subject":"Shared hello","body":"Body"}`
	assertJSONStatus(t, handler, http.MethodPost, path, body, token, http.StatusNotFound)
	if nylas.lastSendGrantID != "" {
		t.Fatalf("send grant after view-only request = %q, want none", nylas.lastSendGrantID)
	}

	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeSharedInbox,
		EntityID:         folder.FolderID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		OverrideUserIDs:  []string{actor.UserID},
	}); err != nil {
		t.Fatal(err)
	}
	largeContent := strings.Repeat("QUJD", 280000)
	largeBody := `{"to":[{"email":"customer@example.com"}],"subject":"Shared hello","body":"Body","attachments":[{"filename":"shared-large.txt","content":"` + largeContent + `"}]}`
	assertJSONStatus(t, handler, http.MethodPost, path, largeBody, token, http.StatusCreated)
	if nylas.lastSendGrantID != "grant-support" {
		t.Fatalf("send grant = %q, want shared inbox grant", nylas.lastSendGrantID)
	}
	if nylas.sent.To[0].Email != "customer@example.com" || nylas.sent.Subject != "Shared hello" {
		t.Fatalf("sent = %+v, want shared inbox send payload", nylas.sent)
	}
	if len(nylas.sent.Attachments) != 1 || nylas.sent.Attachments[0].Filename != "shared-large.txt" {
		t.Fatalf("attachments = %+v, want shared inbox attachment", nylas.sent.Attachments)
	}
}

func TestCommunicationsCacheAvoidsRepeatedNylasReads(t *testing.T) {
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
		Provider:     "microsoft",
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

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders", "", token, http.StatusOK)
	if nylas.folderCalls != 1 {
		t.Fatalf("folder calls = %d, want 1", nylas.folderCalls)
	}

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5", "", token, http.StatusOK)
	if nylas.folderCalls != 1 {
		t.Fatalf("folder calls after mailbox resolution = %d, want 1", nylas.folderCalls)
	}
	if nylas.messageCalls != 1 {
		t.Fatalf("message list calls = %d, want 1", nylas.messageCalls)
	}
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5&refresh=true", "", token, http.StatusOK)
	if nylas.messageCalls != 2 {
		t.Fatalf("message list calls after refresh = %d, want 2", nylas.messageCalls)
	}
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5", "", token, http.StatusOK)
	if nylas.messageCalls != 2 {
		t.Fatalf("message list calls after refreshed cache read = %d, want 2", nylas.messageCalls)
	}

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages/message-1", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages/message-1", "", token, http.StatusOK)
	if nylas.detailCalls != 1 {
		t.Fatalf("message detail calls = %d, want 1", nylas.detailCalls)
	}
}

func TestCommunicationsCacheEvictsBoundedEntries(t *testing.T) {
	t.Parallel()

	cache := newCommunicationsCache()
	now := time.Unix(1000, 0).UTC()

	for i := 0; i < communicationsMaxMessagePagesPerUser+2; i++ {
		query := NylasMessageQuery{Limit: 5, PageToken: fmt.Sprintf("page-%d", i)}
		page := NylasMessagePage{Messages: []NylasMessage{{ID: fmt.Sprintf("message-%d", i)}}}
		cache.setMessagePage("user-1", "account:user@example.com", query, page, now.Add(time.Duration(i)*time.Second))
	}
	if len(cache.messagePages) != communicationsMaxMessagePagesPerUser {
		t.Fatalf("message page cache size = %d, want %d", len(cache.messagePages), communicationsMaxMessagePagesPerUser)
	}
	if _, ok := cache.getMessagePage("user-1", "account:user@example.com", NylasMessageQuery{Limit: 5, PageToken: "page-0"}, communicationsMaxStaleTTL, now.Add(time.Minute)); ok {
		t.Fatal("oldest message page was not evicted")
	}
	if _, ok := cache.getMessagePage("user-1", "account:user@example.com", NylasMessageQuery{Limit: 5, PageToken: fmt.Sprintf("page-%d", communicationsMaxMessagePagesPerUser+1)}, communicationsMaxStaleTTL, now.Add(time.Minute)); !ok {
		t.Fatal("newest message page was evicted")
	}

	for i := 0; i < communicationsMaxMessageEntries+4; i++ {
		cache.setMessage(fmt.Sprintf("global-user-%d", i), "account:user@example.com", NylasMessage{ID: "message-1", Body: "body"}, now.Add(time.Duration(i)*time.Second))
	}
	if len(cache.messages) != communicationsMaxMessageEntries {
		t.Fatalf("message detail cache size = %d, want %d", len(cache.messages), communicationsMaxMessageEntries)
	}
	if _, ok := cache.getMessage("global-user-0", "account:user@example.com", "message-1", communicationsMaxStaleTTL, now.Add(time.Minute)); ok {
		t.Fatal("oldest message detail was not globally evicted")
	}

	for i := 0; i < communicationsMaxMessageDetailsPerUser+2; i++ {
		cache.setMessage("detail-user", "account:user@example.com", NylasMessage{ID: fmt.Sprintf("detail-%d", i), Body: "body"}, now.Add(time.Duration(i)*time.Second))
	}
	if _, ok := cache.getMessage("detail-user", "account:user@example.com", "detail-0", communicationsMaxStaleTTL, now.Add(time.Minute)); ok {
		t.Fatal("oldest per-user message detail was not evicted")
	}
	if _, ok := cache.getMessage("detail-user", "account:user@example.com", fmt.Sprintf("detail-%d", communicationsMaxMessageDetailsPerUser+1), communicationsMaxStaleTTL, now.Add(time.Minute)); !ok {
		t.Fatal("newest per-user message detail was evicted")
	}
}

func TestNylasWebhookCacheInvalidationIsGranular(t *testing.T) {
	t.Parallel()

	now := time.Unix(1000, 0).UTC()
	query := NylasMessageQuery{Limit: 5, Mailbox: "primary"}

	cache := newCommunicationsCache()
	server := &Server{commCache: cache}
	cache.setFolders("user-1", "account:user@example.com", []NylasFolder{{ID: "inbox", Name: "Inbox"}}, now)
	cache.setMessagePage("user-1", "account:user@example.com", query, NylasMessagePage{Messages: []NylasMessage{{ID: "message-1"}}}, now)
	cache.setMessage("user-1", "account:user@example.com", NylasMessage{ID: "message-1", Subject: "Cached"}, now)

	server.applyNylasWebhookCacheInvalidation("user-1", nylasWebhookChange{Trigger: "message.opened", MessageID: "message-1"})

	if _, ok := cache.getFolders("user-1", "account:user@example.com", communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("message webhook invalidated folders; want folder cache preserved")
	}
	if _, ok := cache.getMessagePage("user-1", "account:user@example.com", query, communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("message.opened invalidated message page; want list cache preserved")
	}
	if _, ok := cache.getMessage("user-1", "account:user@example.com", "message-1", communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("message.opened preserved detail; want changed message detail invalidated")
	}

	cache.setMessagePage("user-1", "account:user@example.com", query, NylasMessagePage{Messages: []NylasMessage{{ID: "message-1"}}}, now)
	cache.setMessage("user-1", "account:user@example.com", NylasMessage{ID: "message-1", Subject: "Cached"}, now)
	server.applyNylasWebhookCacheInvalidation("user-1", nylasWebhookChange{Trigger: "message.updated", MessageID: "message-1"})
	if _, ok := cache.getFolders("user-1", "account:user@example.com", communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("message.updated invalidated folders; want folder cache preserved")
	}
	if _, ok := cache.getMessagePage("user-1", "account:user@example.com", query, communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("message.updated preserved message page; want list cache invalidated")
	}
	if _, ok := cache.getMessage("user-1", "account:user@example.com", "message-1", communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("message.updated preserved detail; want changed message detail invalidated")
	}

	cache = newCommunicationsCache()
	server.commCache = cache
	cache.setFolders("user-1", "account:user@example.com", []NylasFolder{{ID: "inbox", Name: "Inbox"}}, now)
	cache.setMessagePage("user-1", "account:user@example.com", query, NylasMessagePage{Messages: []NylasMessage{{ID: "message-1"}}}, now)
	cache.setMessage("user-1", "account:user@example.com", NylasMessage{ID: "message-1", Subject: "Cached"}, now)

	server.applyNylasWebhookCacheInvalidation("user-1", nylasWebhookChange{Trigger: "folder.updated"})

	if _, ok := cache.getFolders("user-1", "account:user@example.com", communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("folder webhook preserved folders; want folder cache invalidated")
	}
	if _, ok := cache.getMessagePage("user-1", "account:user@example.com", query, communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("folder webhook invalidated message page; want list cache preserved")
	}
	if _, ok := cache.getMessage("user-1", "account:user@example.com", "message-1", communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("folder webhook invalidated message detail; want detail cache preserved")
	}
}

func TestCommunicationsPrimaryMailboxUsesGmailNativeSearch(t *testing.T) {
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
	nylas := &fakeNylasClient{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&q=from%3Aops%40example.com&unread=true", "", token, http.StatusOK)
	if nylas.lastQuery.SearchQueryNative != "in:inbox -category:social -category:promotions from:ops@example.com is:unread" {
		t.Fatalf("search_query_native = %q", nylas.lastQuery.SearchQueryNative)
	}
	if nylas.lastQuery.Query != "" || nylas.lastQuery.Unread != nil || nylas.lastQuery.FolderID != "" {
		t.Fatalf("query = %+v, want Gmail-native inbox search only", nylas.lastQuery)
	}
}

func TestCommunicationsArchiveMailboxUsesGmailNativeSearch(t *testing.T) {
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
	nylas := &fakeNylasClient{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=archive&q=invoice&unread=true", "", token, http.StatusOK)
	if nylas.lastQuery.SearchQueryNative != "in:anywhere -in:inbox -in:trash -in:spam -in:sent -in:drafts invoice is:unread" {
		t.Fatalf("search_query_native = %q", nylas.lastQuery.SearchQueryNative)
	}
	if nylas.lastQuery.Query != "" || nylas.lastQuery.Unread != nil || nylas.lastQuery.FolderID != "" {
		t.Fatalf("query = %+v, want Gmail-native archive search only", nylas.lastQuery)
	}
}

func TestCommunicationsAllMailboxUsesGmailNativeSearch(t *testing.T) {
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
	nylas := &fakeNylasClient{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=all&q=invoice&unread=true", "", token, http.StatusOK)
	if nylas.lastQuery.SearchQueryNative != "in:anywhere invoice is:unread" {
		t.Fatalf("search_query_native = %q", nylas.lastQuery.SearchQueryNative)
	}
	if nylas.lastQuery.Query != "" || nylas.lastQuery.Unread != nil {
		t.Fatalf("query = %+v, want Gmail-native all-mail search only", nylas.lastQuery)
	}
}

func TestCommunicationsStarredMailboxAppliesStarredFilter(t *testing.T) {
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
	nylas := &fakeNylasClient{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=starred&q=invoice&unread=true", "", token, http.StatusOK)
	if nylas.lastQuery.Starred == nil || !*nylas.lastQuery.Starred {
		t.Fatalf("starred = %v, want true", nylas.lastQuery.Starred)
	}
	if nylas.lastQuery.SearchQueryNative != "invoice is:unread" {
		t.Fatalf("search_query_native = %q", nylas.lastQuery.SearchQueryNative)
	}
	if nylas.lastQuery.Query != "" || nylas.lastQuery.Unread != nil {
		t.Fatalf("query = %+v, want Gmail-native starred search only", nylas.lastQuery)
	}
}

func TestCommunicationsStarMessagePreservesGmailInboxLabel(t *testing.T) {
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
		message: NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"INBOX", "UNREAD", "CATEGORY_PERSONAL", "SNOOZED", "CHAT", "Label_123"}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodPut, "/v1/communications/messages/message-1", `{"starred":true}`, token, http.StatusOK)
	if nylas.update.Starred == nil || !*nylas.update.Starred {
		t.Fatalf("starred update = %v, want true", nylas.update.Starred)
	}
	if nylas.update.Folders != nil {
		t.Fatalf("folders update = %v, want nil so starring preserves mailbox folders", nylas.update.Folders)
	}
}

func TestCommunicationsCacheIncludesStarredMessagesInSourceMailboxes(t *testing.T) {
	t.Parallel()

	message := NylasMessage{ID: "message-1", Starred: true, Folders: []string{"INBOX", "CATEGORY_PERSONAL"}}
	if !nylasMessageMatchesCachedPageQuery(message, NylasMessageQuery{Mailbox: "primary"}) {
		t.Fatal("primary cache matcher excluded a starred inbox message")
	}
	if !nylasMessageMatchesCachedPageQuery(message, NylasMessageQuery{Mailbox: "starred"}) {
		t.Fatal("starred cache matcher excluded a starred inbox message")
	}
	if !nylasMessageMatchesCachedPageQuery(NylasMessage{ID: "message-2", Starred: true, Folders: []string{"CATEGORY_PERSONAL"}}, NylasMessageQuery{Mailbox: "archive"}) {
		t.Fatal("archive cache matcher excluded a starred archived message")
	}
}

func TestCommunicationsArchiveMessageRemovesGmailInboxLabel(t *testing.T) {
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
		message: NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"INBOX", "UNREAD", "CATEGORY_PERSONAL", "SNOOZED", "CHAT", "STARRED", "Label_123"}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/archive", "", token, http.StatusOK)
	if got, want := strings.Join(nylas.update.Folders, ","), "STARRED,Label_123"; got != want {
		t.Fatalf("folders = %q, want %q", got, want)
	}
	raw, err := json.Marshal(NylasMessageUpdate{Folders: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"folders":[]}` {
		t.Fatalf("empty folder update JSON = %s, want explicit folders array", raw)
	}
}

func TestCommunicationsArchiveMessageMovesFolderProvidersToArchiveFolder(t *testing.T) {
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
		Provider:     "microsoft",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		folders: []NylasFolder{
			{ID: "inbox-id", Name: "Inbox"},
			{ID: "archive-id", Name: "Archive"},
		},
		message: NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"inbox-id"}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/archive", "", token, http.StatusOK)
	if len(nylas.update.Folders) != 1 || nylas.update.Folders[0] != "archive-id" {
		t.Fatalf("folders = %+v, want archive-id", nylas.update.Folders)
	}
	if nylas.detailCalls != 0 {
		t.Fatalf("detail calls = %d, want archive without message body fetch", nylas.detailCalls)
	}
}

func TestCommunicationsArchiveBatchUsesCachedListFoldersAndReturnsCompactResult(t *testing.T) {
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
		messages: []NylasMessage{
			{ID: "message-1", Subject: "One", Folders: []string{"INBOX", "CATEGORY_PERSONAL", "Label_123"}},
			{ID: "message-2", Subject: "Two", Folders: []string{"INBOX", "Label_456"}},
		},
		updateErrByID: map[string]error{
			"message-2": NylasAPIError{StatusCode: http.StatusTooManyRequests, Code: "rate_limited", RetryAfter: "4"},
		},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5", "", token, http.StatusOK)

	body := `{"message_ids":["message-1","message-2","message-1"," "]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/communications/messages/archive-batch", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Retry-After"); got != "4" {
		t.Fatalf("Retry-After = %q, want 4", got)
	}
	if strings.Contains(rec.Body.String(), `"message"`) || strings.Contains(rec.Body.String(), "CATEGORY_PERSONAL") {
		t.Fatalf("batch response should be compact, got %s", rec.Body.String())
	}
	var payload struct {
		ArchivedIDs []string `json:"archived_ids"`
		Failed      []struct {
			MessageID string `json:"message_id"`
			Error     string `json:"error"`
		} `json:"failed"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.ArchivedIDs) != 1 || payload.ArchivedIDs[0] != "message-1" {
		t.Fatalf("archived ids = %+v, want message-1", payload.ArchivedIDs)
	}
	if len(payload.Failed) != 1 || payload.Failed[0].MessageID != "message-2" || payload.Failed[0].Error != "nylas_rate_limited" {
		t.Fatalf("failed = %+v, want message-2 rate limit", payload.Failed)
	}
	if nylas.detailCalls != 0 {
		t.Fatalf("detail calls = %d, want cached list folder data", nylas.detailCalls)
	}
	if len(nylas.updateCalls) != 1 || nylas.updateCalls[0].MessageID != "message-1" || strings.Join(nylas.updateCalls[0].Update.Folders, ",") != "Label_123" {
		t.Fatalf("update calls = %+v, want compact Gmail archive update", nylas.updateCalls)
	}
}

func TestCommunicationsArchiveMutationTrackerClassifiesRecentArchiveEchoOnce(t *testing.T) {
	t.Parallel()

	tracker := newCommunicationsArchiveMutationTracker()
	now := time.Date(2026, 6, 29, 12, 0, 0, 0, time.UTC)
	tracker.remember("grant:grant-1", []string{" message-1 ", "message-2", "message-1"}, now)

	if !tracker.consume("grant:grant-1", "message-1", now.Add(time.Second)) {
		t.Fatal("first recent archive echo was not classified")
	}
	if tracker.consume("grant:grant-1", "message-1", now.Add(2*time.Second)) {
		t.Fatal("archive echo was classified more than once")
	}
	if tracker.consume("grant:other", "message-2", now.Add(time.Second)) {
		t.Fatal("archive echo matched a different cache scope")
	}
	if tracker.consume("grant:grant-1", "message-2", now.Add(communicationsArchiveMutationTTL+time.Second)) {
		t.Fatal("expired archive echo was classified")
	}
}

func TestCommunicationsUnarchiveMessageAddsGmailInboxLabel(t *testing.T) {
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
		message: NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"UNREAD", "CATEGORY_PERSONAL", "Label_123"}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/unarchive", "", token, http.StatusOK)
	if got, want := strings.Join(nylas.update.Folders, ","), "Label_123,INBOX"; got != want {
		t.Fatalf("folders = %q, want %q", got, want)
	}
}

func TestCommunicationsUnarchiveMessageMovesFolderProvidersToInboxFolder(t *testing.T) {
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
		Provider:     "microsoft",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		folders: []NylasFolder{
			{ID: "inbox-id", Name: "Inbox"},
			{ID: "archive-id", Name: "Archive"},
		},
		message: NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"archive-id"}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/unarchive", "", token, http.StatusOK)
	if len(nylas.update.Folders) != 1 || nylas.update.Folders[0] != "inbox-id" {
		t.Fatalf("folders = %+v, want inbox-id", nylas.update.Folders)
	}
	if nylas.detailCalls != 0 {
		t.Fatalf("detail calls = %d, want unarchive without message body fetch", nylas.detailCalls)
	}
}

func TestNylasWebhookVerifiesSignatureAndPublishesMailboxEvent(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "70707070-7070-4070-8070-707070707001"
	token := "communications-webhook-ws-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "communications-webhook-ws", domain.RoleCompanyUser)
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
	server := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
			token: {Subject: user.CognitoSubject, Email: user.Email, Name: user.DisplayName},
		}},
	})
	defer server.Close()
	handler := server.Routes()

	client := openRealtimeWebSocketForTest(t, handler, "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	client.readJSON(t)
	scope := realtimeCommunicationsScope(user.UserID)
	client.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})
	accepted := client.readJSON(t)
	if accepted["type"] != realtimeMessageSubscriptionAccepted || accepted["scope"] != scope {
		t.Fatalf("communications subscription accepted = %+v, want %s", accepted, scope)
	}

	challengeReq := httptest.NewRequest(http.MethodGet, "/nylas/webhook?challenge=abc123", nil)
	challengeRec := httptest.NewRecorder()
	handler.ServeHTTP(challengeRec, challengeReq)
	if challengeRec.Code != http.StatusOK || challengeRec.Body.String() != "abc123" {
		t.Fatalf("challenge status=%d body=%q", challengeRec.Code, challengeRec.Body.String())
	}

	body := `{"type":"message.created","data":{"object":{"id":"message-1","grant_id":"grant-1"}}}`
	req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	req.Header.Set("X-Nylas-Signature", signWebhookBody("webhook-secret", body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("webhook status = %d body=%s", rec.Code, rec.Body.String())
	}
	message := client.readJSON(t)
	if message["type"] != realtimeMessageCommunicationsEvent || message["company_id"] != companyID || message["scope"] != scope {
		t.Fatalf("communications websocket message = %+v, want communications event for %s", message, scope)
	}
	event := message["event"].(map[string]any)
	if event["user_id"] != user.UserID || event["type"] != "mailbox_changed" || event["trigger"] != "message.created" || event["message_id"] != "message-1" {
		t.Fatalf("communications event = %+v", event)
	}

	duplicateReq := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	duplicateReq.Header.Set("X-Nylas-Signature", signWebhookBody("webhook-secret", body))
	duplicateRec := httptest.NewRecorder()
	handler.ServeHTTP(duplicateRec, duplicateReq)
	if duplicateRec.Code != http.StatusOK {
		t.Fatalf("duplicate webhook status = %d body=%s", duplicateRec.Code, duplicateRec.Body.String())
	}
	client.assertNoMessage(t)

	openedBody := `{"type":"message.opened","time":"2026-06-09T21:14:00Z","data":{"object":{"message_id":"message-1","thread_id":"thread-1","grant_id":"grant-1","count":2}}}`
	openedReq := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(openedBody))
	openedReq.Header.Set("X-Nylas-Signature", signWebhookBody("webhook-secret", openedBody))
	openedRec := httptest.NewRecorder()
	handler.ServeHTTP(openedRec, openedReq)
	if openedRec.Code != http.StatusOK {
		t.Fatalf("opened webhook status = %d body=%s", openedRec.Code, openedRec.Body.String())
	}
	statuses, err := repo.ListCommunicationsMessageReadStatuses(user.UserID, []string{"message-1"})
	if err != nil {
		t.Fatalf("ListCommunicationsMessageReadStatuses: %v", err)
	}
	if len(statuses) != 1 || statuses[0].Status != "likely_read" || statuses[0].MessageID != "message-1" || statuses[0].ThreadID != "thread-1" || statuses[0].SignalCount != 2 {
		t.Fatalf("read statuses = %+v, want likely_read count 2", statuses)
	}
	if got := statuses[0].LastSignalTimestamp.Format(time.RFC3339); got != "2026-06-09T21:14:00Z" {
		t.Fatalf("last signal timestamp = %s", got)
	}
	openedMessage := client.readJSON(t)
	openedEvent := openedMessage["event"].(map[string]any)
	if openedEvent["user_id"] != user.UserID || openedEvent["type"] != "mailbox_changed" || openedEvent["trigger"] != "message.opened" || openedEvent["message_id"] != "message-1" {
		t.Fatalf("opened communications event = %+v", openedEvent)
	}

	badReq := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	badReq.Header.Set("X-Nylas-Signature", "bad")
	badRec := httptest.NewRecorder()
	handler.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusUnauthorized {
		t.Fatalf("bad signature status = %d", badRec.Code)
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

func TestCommunicationsSharedNylasAuthErrorMarksCompanyConnectionReauthRequired(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "company-shared-reauth"
	repo.EnsureCompany(companyID, "Shared Reauth Company")
	const subject = "shared-reauth-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "personal-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	companyConnection, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
		CompanyID:         companyID,
		Provider:          "google",
		AccountEmail:      "support@example.com",
		GrantID:           "shared-grant",
		Status:            "connected",
		ConnectedByUserID: user.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", "support@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeSharedInbox,
		EntityID:   folder.FolderID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   &fakeNylasClient{listErr: NylasAPIError{StatusCode: http.StatusUnauthorized, Code: "unauthorized"}},
	}).Routes()

	path := "/v1/communications/messages?company_id=" + url.QueryEscape(companyID) + "&shared_inbox_id=" + url.QueryEscape(folder.FolderID)
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, user.Email))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 body=%s", rec.Code, rec.Body.String())
	}
	updatedCompanyConnection, err := repo.GetCompanyEmailConnectionByID(companyID, companyConnection.CompanyEmailConnectionID)
	if err != nil {
		t.Fatal(err)
	}
	if updatedCompanyConnection.Status != "reauth_required" {
		t.Fatalf("company connection status = %q, want reauth_required", updatedCompanyConnection.Status)
	}
	personal, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if personal.Status != "connected" {
		t.Fatalf("personal status = %q, want connected", personal.Status)
	}
}

func TestCommunicationsNylasRateLimitPreservesRetryAfter(t *testing.T) {
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
		NylasClient: &fakeNylasClient{listErr: NylasAPIError{
			StatusCode: http.StatusTooManyRequests,
			Code:       "rate_limited",
			RetryAfter: "3",
		}},
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages", nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, user.Email))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Retry-After"); got != "3" {
		t.Fatalf("Retry-After = %q, want 3", got)
	}
	if !strings.Contains(rec.Body.String(), "nylas_rate_limited") {
		t.Fatalf("body = %s, want nylas_rate_limited", rec.Body.String())
	}
}

func TestParseNylasMessageQueryCapsLimitAtProviderFriendlySize(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages?limit=100", nil)
	rec := httptest.NewRecorder()

	query, ok := parseNylasMessageQuery(rec, req)
	if !ok {
		t.Fatalf("parseNylasMessageQuery rejected request: status=%d body=%s", rec.Code, rec.Body.String())
	}
	if query.Limit != communicationsNylasMaxMessageLimit {
		t.Fatalf("limit = %d, want %d", query.Limit, communicationsNylasMaxMessageLimit)
	}
}

func signWebhookBody(secret, body string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(body))
	return fmt.Sprintf("%x", mac.Sum(nil))
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
		FrontendRedirectURL: "http://ui.test/home",
		StateSecret:         "state-secret",
	}
}
