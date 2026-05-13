package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	nylasMessageListSelect   = "id,thread_id,subject,snippet,date,unread,starred,from,to,cc,bcc,reply_to,folders"
	nylasMessageDetailSelect = "id,thread_id,subject,snippet,body,date,unread,starred,from,to,cc,bcc,reply_to,folders"
)

type NylasConfig struct {
	ClientID            string
	APIKey              string
	APIBaseURL          string
	RedirectURI         string
	FrontendRedirectURL string
	StateSecret         string
	WebhookSecret       string
	GoogleScopes        []string
	MicrosoftScopes     []string
}

func (c NylasConfig) IsConfigured() bool {
	return strings.TrimSpace(c.ClientID) != "" &&
		strings.TrimSpace(c.APIKey) != "" &&
		strings.TrimSpace(c.APIBaseURL) != "" &&
		strings.TrimSpace(c.RedirectURI) != "" &&
		strings.TrimSpace(c.FrontendRedirectURL) != "" &&
		strings.TrimSpace(c.StateSecret) != ""
}

func (c NylasConfig) HostedAuthURL(provider, state string) (string, error) {
	provider = normalizeCommunicationsProvider(provider)
	if provider == "" {
		return "", errInvalidNylasProvider
	}
	base, err := url.Parse(strings.TrimRight(c.APIBaseURL, "/") + "/v3/connect/auth")
	if err != nil {
		return "", err
	}
	query := base.Query()
	query.Set("client_id", c.ClientID)
	query.Set("redirect_uri", c.RedirectURI)
	query.Set("response_type", "code")
	query.Set("access_type", "offline")
	query.Set("provider", provider)
	query.Set("state", state)
	query.Set("scope", strings.Join(c.ScopesForProvider(provider), " "))
	base.RawQuery = query.Encode()
	return base.String(), nil
}

func (c NylasConfig) ScopesForProvider(provider string) []string {
	switch normalizeCommunicationsProvider(provider) {
	case "google":
		if len(c.GoogleScopes) > 0 {
			return normalizeNylasProviderScopes("google", c.GoogleScopes)
		}
		return []string{
			"https://www.googleapis.com/auth/userinfo.email",
			"https://www.googleapis.com/auth/gmail.modify",
			"https://www.googleapis.com/auth/gmail.send",
			"https://www.googleapis.com/auth/gmail.labels",
		}
	case "microsoft":
		if len(c.MicrosoftScopes) > 0 {
			return normalizeNylasProviderScopes("microsoft", c.MicrosoftScopes)
		}
		return []string{"offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send"}
	default:
		return nil
	}
}

func normalizeNylasProviderScopes(provider string, scopes []string) []string {
	provider = normalizeCommunicationsProvider(provider)
	out := make([]string, 0, len(scopes))
	seen := make(map[string]struct{}, len(scopes))
	for _, scope := range scopes {
		scope = strings.TrimSpace(scope)
		if scope == "" {
			continue
		}
		if provider == "google" {
			scope = normalizeGoogleScope(scope)
			if scope == "" {
				continue
			}
		}
		if _, ok := seen[scope]; ok {
			continue
		}
		seen[scope] = struct{}{}
		out = append(out, scope)
	}
	return out
}

func normalizeGoogleScope(scope string) string {
	const googleScopePrefix = "https://www.googleapis.com/auth/"
	switch {
	case scope == "openid":
		return ""
	case strings.HasPrefix(scope, "https://"):
		return scope
	case strings.HasPrefix(scope, "/"):
		return googleScopePrefix + strings.TrimPrefix(scope, "/")
	case strings.HasPrefix(scope, "gmail."), strings.HasPrefix(scope, "userinfo."):
		return googleScopePrefix + scope
	default:
		return scope
	}
}

type NylasClient interface {
	ExchangeCode(ctx context.Context, code, redirectURI string) (NylasGrant, error)
	DeleteGrant(ctx context.Context, grantID string) error
	ListFolders(ctx context.Context, grantID string) ([]NylasFolder, error)
	ListMessages(ctx context.Context, grantID string, query NylasMessageQuery) (NylasMessagePage, error)
	GetMessage(ctx context.Context, grantID, messageID string) (NylasMessage, error)
	UpdateMessage(ctx context.Context, grantID, messageID string, update NylasMessageUpdate) (NylasMessage, error)
	DeleteMessage(ctx context.Context, grantID, messageID string) error
	SendMessage(ctx context.Context, grantID string, request NylasSendMessageRequest) (NylasMessage, error)
}

type NylasRESTClient struct {
	apiBase  string
	apiKey   string
	clientID string
	client   *http.Client
}

func NewNylasRESTClient(apiBase, apiKey, clientID string) *NylasRESTClient {
	return &NylasRESTClient{
		apiBase:  strings.TrimRight(strings.TrimSpace(apiBase), "/"),
		apiKey:   strings.TrimSpace(apiKey),
		clientID: strings.TrimSpace(clientID),
		client: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

type NylasAPIError struct {
	StatusCode int
	Code       string
	Message    string
	RetryAfter string
}

func (e NylasAPIError) Error() string {
	if e.Code != "" && e.Message != "" {
		return fmt.Sprintf("nylas_api_%d_%s: %s", e.StatusCode, e.Code, e.Message)
	}
	if e.Code != "" {
		return fmt.Sprintf("nylas_api_%d_%s", e.StatusCode, e.Code)
	}
	return fmt.Sprintf("nylas_api_%d", e.StatusCode)
}

type NylasGrant struct {
	GrantID  string `json:"grant_id"`
	Email    string `json:"email"`
	Provider string `json:"provider"`
}

type NylasEmailAddress struct {
	Name  string `json:"name,omitempty"`
	Email string `json:"email"`
}

type NylasFolder struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	DisplayName  string   `json:"display_name,omitempty"`
	SystemFolder string   `json:"system_folder,omitempty"`
	Attributes   []string `json:"attributes,omitempty"`
	UnreadCount  int      `json:"unread_count,omitempty"`
	TotalCount   int      `json:"total_count,omitempty"`
}

func (f *NylasFolder) UnmarshalJSON(raw []byte) error {
	type folderAlias NylasFolder
	var payload struct {
		folderAlias
		SystemFolder json.RawMessage `json:"system_folder"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return err
	}
	*f = NylasFolder(payload.folderAlias)
	f.SystemFolder = ""

	rawSystemFolder := strings.TrimSpace(string(payload.SystemFolder))
	if rawSystemFolder == "" || rawSystemFolder == "null" {
		return nil
	}
	var systemFolder string
	if err := json.Unmarshal(payload.SystemFolder, &systemFolder); err == nil {
		f.SystemFolder = strings.TrimSpace(systemFolder)
		return nil
	}
	var isSystemFolder bool
	if err := json.Unmarshal(payload.SystemFolder, &isSystemFolder); err == nil {
		return nil
	}
	return fmt.Errorf("invalid nylas folder system_folder value: %s", rawSystemFolder)
}

type NylasMessage struct {
	ID             string              `json:"id"`
	ThreadID       string              `json:"thread_id,omitempty"`
	Subject        string              `json:"subject"`
	Snippet        string              `json:"snippet,omitempty"`
	Body           string              `json:"body,omitempty"`
	Date           int64               `json:"date,omitempty"`
	Unread         bool                `json:"unread"`
	Starred        bool                `json:"starred"`
	From           []NylasEmailAddress `json:"from,omitempty"`
	To             []NylasEmailAddress `json:"to,omitempty"`
	Cc             []NylasEmailAddress `json:"cc,omitempty"`
	Bcc            []NylasEmailAddress `json:"bcc,omitempty"`
	ReplyTo        []NylasEmailAddress `json:"reply_to,omitempty"`
	Folders        []string            `json:"folders,omitempty"`
	FolderIDs      []string            `json:"folder_ids,omitempty"`
	LogicGateIDs   []string            `json:"logic_gate_ids,omitempty"`
	LogicGateCount int                 `json:"logic_gate_count,omitempty"`
}

type NylasMessageQuery struct {
	Limit             int
	PageToken         string
	FolderID          string
	Query             string
	SearchQueryNative string
	Mailbox           string
	CompanyID         string
	Unread            *bool
}

type NylasMessagePage struct {
	Messages      []NylasMessage `json:"messages"`
	NextPageToken string         `json:"next_page_token,omitempty"`
}

type NylasMessageUpdate struct {
	Unread  *bool    `json:"unread,omitempty"`
	Starred *bool    `json:"starred,omitempty"`
	Folders []string `json:"folders,omitempty"`
}

type NylasSendMessageRequest struct {
	To               []NylasEmailAddress `json:"to"`
	Cc               []NylasEmailAddress `json:"cc,omitempty"`
	Bcc              []NylasEmailAddress `json:"bcc,omitempty"`
	Subject          string              `json:"subject"`
	Body             string              `json:"body"`
	ReplyToMessageID string              `json:"reply_to_message_id,omitempty"`
}

func (c *NylasRESTClient) ExchangeCode(ctx context.Context, code, redirectURI string) (NylasGrant, error) {
	var payload struct {
		ClientID     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
		GrantType    string `json:"grant_type"`
		Code         string `json:"code"`
		RedirectURI  string `json:"redirect_uri"`
		CodeVerifier string `json:"code_verifier"`
	}
	payload.ClientID = c.clientID
	payload.ClientSecret = c.apiKey
	payload.GrantType = "authorization_code"
	payload.Code = strings.TrimSpace(code)
	payload.RedirectURI = strings.TrimSpace(redirectURI)
	payload.CodeVerifier = "nylas"

	var response struct {
		NylasGrant
		Data *NylasGrant `json:"data,omitempty"`
	}
	if err := c.do(ctx, http.MethodPost, "/v3/connect/token", nil, payload, &response, false); err != nil {
		return NylasGrant{}, err
	}
	grant := response.NylasGrant
	if response.Data != nil {
		grant = *response.Data
	}
	grant.Provider = normalizeCommunicationsProvider(grant.Provider)
	if strings.TrimSpace(grant.GrantID) == "" || strings.TrimSpace(grant.Email) == "" {
		return NylasGrant{}, NylasAPIError{StatusCode: http.StatusBadGateway, Code: "invalid_token_exchange_response"}
	}
	return grant, nil
}

func (c *NylasRESTClient) DeleteGrant(ctx context.Context, grantID string) error {
	return c.do(ctx, http.MethodDelete, "/v3/grants/"+url.PathEscape(strings.TrimSpace(grantID)), nil, nil, nil, true)
}

func (c *NylasRESTClient) ListFolders(ctx context.Context, grantID string) ([]NylasFolder, error) {
	var response struct {
		Data []NylasFolder `json:"data"`
	}
	if err := c.do(ctx, http.MethodGet, grantPath(grantID, "folders"), nil, nil, &response, true); err != nil {
		return nil, err
	}
	return response.Data, nil
}

func (c *NylasRESTClient) ListMessages(ctx context.Context, grantID string, query NylasMessageQuery) (NylasMessagePage, error) {
	values := url.Values{"select": []string{nylasMessageListSelect}}
	if query.Limit > 0 {
		values.Set("limit", strconv.Itoa(query.Limit))
	}
	if strings.TrimSpace(query.PageToken) != "" {
		values.Set("page_token", strings.TrimSpace(query.PageToken))
	}
	if strings.TrimSpace(query.FolderID) != "" {
		values.Set("in", strings.TrimSpace(query.FolderID))
	}
	if strings.TrimSpace(query.Query) != "" {
		values.Set("q", strings.TrimSpace(query.Query))
	}
	if strings.TrimSpace(query.SearchQueryNative) != "" {
		values.Set("search_query_native", strings.TrimSpace(query.SearchQueryNative))
	}
	if query.Unread != nil {
		values.Set("unread", strconv.FormatBool(*query.Unread))
	}

	var response struct {
		Data          []NylasMessage `json:"data"`
		NextCursor    string         `json:"next_cursor,omitempty"`
		NextPageToken string         `json:"next_page_token,omitempty"`
	}
	if err := c.do(ctx, http.MethodGet, grantPath(grantID, "messages"), values, nil, &response, true); err != nil {
		return NylasMessagePage{}, err
	}
	next := response.NextPageToken
	if next == "" {
		next = response.NextCursor
	}
	return NylasMessagePage{Messages: response.Data, NextPageToken: next}, nil
}

func (c *NylasRESTClient) GetMessage(ctx context.Context, grantID, messageID string) (NylasMessage, error) {
	var response struct {
		Data NylasMessage `json:"data"`
	}
	values := url.Values{"select": []string{nylasMessageDetailSelect}}
	if err := c.do(ctx, http.MethodGet, grantPath(grantID, "messages", messageID), values, nil, &response, true); err != nil {
		return NylasMessage{}, err
	}
	return response.Data, nil
}

func (c *NylasRESTClient) UpdateMessage(ctx context.Context, grantID, messageID string, update NylasMessageUpdate) (NylasMessage, error) {
	var response struct {
		Data NylasMessage `json:"data"`
	}
	if err := c.do(ctx, http.MethodPut, grantPath(grantID, "messages", messageID), nil, update, &response, true); err != nil {
		return NylasMessage{}, err
	}
	return response.Data, nil
}

func (c *NylasRESTClient) DeleteMessage(ctx context.Context, grantID, messageID string) error {
	return c.do(ctx, http.MethodDelete, grantPath(grantID, "messages", messageID), nil, nil, nil, true)
}

func (c *NylasRESTClient) SendMessage(ctx context.Context, grantID string, request NylasSendMessageRequest) (NylasMessage, error) {
	var response struct {
		Data NylasMessage `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, grantPath(grantID, "messages", "send"), nil, request, &response, true); err != nil {
		return NylasMessage{}, err
	}
	return response.Data, nil
}

func (c *NylasRESTClient) do(ctx context.Context, method, path string, query url.Values, body any, out any, authorize bool) error {
	if c == nil || c.apiBase == "" {
		return NylasAPIError{StatusCode: http.StatusServiceUnavailable, Code: "nylas_not_configured"}
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	endpoint := c.apiBase + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if authorize {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return parseNylasAPIError(resp.StatusCode, resp.Header, raw)
	}
	if out == nil || len(strings.TrimSpace(string(raw))) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return err
	}
	return nil
}

func parseNylasAPIError(statusCode int, headers http.Header, raw []byte) error {
	var payload struct {
		Error   string `json:"error"`
		Code    string `json:"code"`
		Type    string `json:"type"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(raw, &payload)
	code := firstNonBlank(payload.Code, payload.Error, payload.Type)
	message := strings.TrimSpace(payload.Message)
	if code == "" && len(strings.TrimSpace(string(raw))) > 0 {
		message = strings.TrimSpace(string(raw))
	}
	return NylasAPIError{StatusCode: statusCode, Code: code, Message: message, RetryAfter: strings.TrimSpace(headers.Get("Retry-After"))}
}

func grantPath(grantID string, parts ...string) string {
	segments := []string{"/v3/grants", url.PathEscape(strings.TrimSpace(grantID))}
	for _, part := range parts {
		segments = append(segments, url.PathEscape(strings.TrimSpace(part)))
	}
	return strings.Join(segments, "/")
}

func firstNonBlank(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
