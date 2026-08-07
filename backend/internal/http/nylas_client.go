package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"miraeopus/backend/internal/domain"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	nylasMessageListSelect   = "id,thread_id,subject,snippet,date,unread,starred,from,to,cc,bcc,reply_to,attachments,folders"
	nylasMessageDetailSelect = "id,thread_id,subject,snippet,body,date,unread,starred,from,to,cc,bcc,reply_to,attachments,folders"
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

func (c NylasConfig) HostedAuthURL(provider, state, loginHint string) (string, error) {
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
	if hint := strings.TrimSpace(strings.ToLower(loginHint)); hint != "" {
		query.Set("login_hint", hint)
	}
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
			"https://www.googleapis.com/auth/calendar",
		}
	case "microsoft":
		if len(c.MicrosoftScopes) > 0 {
			return normalizeNylasProviderScopes("microsoft", c.MicrosoftScopes)
		}
		return []string{"offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite"}
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
	case strings.HasPrefix(scope, "gmail."), strings.HasPrefix(scope, "userinfo."), strings.HasPrefix(scope, "calendar"):
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
	GetThread(ctx context.Context, grantID, threadID string) (NylasThread, error)
	GetMessage(ctx context.Context, grantID, messageID string) (NylasMessage, error)
	GetMessageRawMIME(ctx context.Context, grantID, messageID string) (string, error)
	DownloadAttachment(ctx context.Context, grantID, messageID, attachmentID string) ([]byte, error)
	UpdateMessage(ctx context.Context, grantID, messageID string, update NylasMessageUpdate) (NylasMessage, error)
	DeleteMessage(ctx context.Context, grantID, messageID string) error
	SendMessage(ctx context.Context, grantID string, request NylasSendMessageRequest) (NylasMessage, error)
}

type NylasCalendarClient interface {
	ListEventsByICalUID(ctx context.Context, grantID, iCalUID string) ([]NylasEvent, error)
	SendEventRSVP(ctx context.Context, grantID, eventID, calendarID, status string) error
}

type NylasRESTClient struct {
	apiBase  string
	apiKey   string
	clientID string
	client   *http.Client
}

const nylasOutboundRequestTimeout = 20 * time.Second

func NewNylasRESTClient(apiBase, apiKey, clientID string) *NylasRESTClient {
	return &NylasRESTClient{
		apiBase:  strings.TrimRight(strings.TrimSpace(apiBase), "/"),
		apiKey:   strings.TrimSpace(apiKey),
		clientID: strings.TrimSpace(clientID),
		client: &http.Client{
			Timeout: nylasOutboundRequestTimeout,
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
	UnreadCount  *int     `json:"unread_count,omitempty"`
	TotalCount   *int     `json:"total_count,omitempty"`
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
	EmailMessageID              string                                  `json:"email_message_id,omitempty"`
	ID                          string                                  `json:"id"`
	ThreadID                    string                                  `json:"thread_id,omitempty"`
	Subject                     string                                  `json:"subject"`
	Snippet                     string                                  `json:"snippet,omitempty"`
	Body                        string                                  `json:"body,omitempty"`
	Date                        int64                                   `json:"date,omitempty"`
	Unread                      bool                                    `json:"unread"`
	Starred                     bool                                    `json:"starred"`
	From                        []NylasEmailAddress                     `json:"from,omitempty"`
	To                          []NylasEmailAddress                     `json:"to,omitempty"`
	Cc                          []NylasEmailAddress                     `json:"cc,omitempty"`
	Bcc                         []NylasEmailAddress                     `json:"bcc,omitempty"`
	ReplyTo                     []NylasEmailAddress                     `json:"reply_to,omitempty"`
	Attachments                 []NylasAttachment                       `json:"attachments,omitempty"`
	Folders                     []string                                `json:"folders,omitempty"`
	FolderIDs                   []string                                `json:"folder_ids,omitempty"`
	LogicGateIDs                []string                                `json:"logic_gate_ids,omitempty"`
	LogicGateCount              int                                     `json:"logic_gate_count,omitempty"`
	CollaborationNodeID         string                                  `json:"collaboration_node_id,omitempty"`
	TrackingOptions             *NylasTrackingOptions                   `json:"tracking_options,omitempty"`
	ReadStatus                  *domain.CommunicationsMessageReadStatus `json:"read_status,omitempty"`
	RawMIMEAttachmentsRecovered bool                                    `json:"-"`
}

type NylasThread struct {
	ID                        string              `json:"id"`
	Subject                   string              `json:"subject,omitempty"`
	Snippet                   string              `json:"snippet,omitempty"`
	Unread                    bool                `json:"unread"`
	Starred                   bool                `json:"starred"`
	Folders                   []string            `json:"folders,omitempty"`
	Participants              []NylasEmailAddress `json:"participants,omitempty"`
	MessageIDs                []string            `json:"message_ids,omitempty"`
	DraftIDs                  []string            `json:"draft_ids,omitempty"`
	EarliestMessageDate       int64               `json:"earliest_message_date,omitempty"`
	LatestMessageReceivedDate int64               `json:"latest_message_received_date,omitempty"`
	LatestMessageSentDate     int64               `json:"latest_message_sent_date,omitempty"`
	LatestDraftOrMessage      *NylasMessage       `json:"latest_draft_or_message,omitempty"`
}

type NylasMessageQuery struct {
	Limit             int
	PageToken         string
	Order             string
	FolderID          string
	ThreadID          string
	Query             string
	SearchQueryNative string
	Mailbox           string
	CompanyID         string
	SharedInboxID     string
	Unread            *bool
	Starred           *bool
	Refresh           bool
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

func (u NylasMessageUpdate) MarshalJSON() ([]byte, error) {
	payload := map[string]any{}
	if u.Unread != nil {
		payload["unread"] = *u.Unread
	}
	if u.Starred != nil {
		payload["starred"] = *u.Starred
	}
	if u.Folders != nil {
		payload["folders"] = u.Folders
	}
	return json.Marshal(payload)
}

type NylasSendMessageRequest struct {
	To                  []NylasEmailAddress       `json:"to"`
	Cc                  []NylasEmailAddress       `json:"cc,omitempty"`
	Bcc                 []NylasEmailAddress       `json:"bcc,omitempty"`
	Subject             string                    `json:"subject"`
	Body                string                    `json:"body"`
	Attachments         []NylasAttachment         `json:"attachments,omitempty"`
	OutboundAttachments []NylasOutboundAttachment `json:"-"`
	ReplyToMessageID    string                    `json:"reply_to_message_id,omitempty"`
	TrackingOptions     *NylasTrackingOptions     `json:"tracking_options,omitempty"`
	IdempotencyKey      string                    `json:"-"`
}

type NylasTrackingOptions struct {
	Opens         bool   `json:"opens,omitempty"`
	Links         bool   `json:"links,omitempty"`
	ThreadReplies bool   `json:"thread_replies,omitempty"`
	Label         string `json:"label,omitempty"`
}

type NylasAttachment struct {
	ID                 string `json:"id,omitempty"`
	AttachmentID       string `json:"attachment_id,omitempty"`
	Filename           string `json:"filename"`
	ContentType        string `json:"content_type,omitempty"`
	Content            string `json:"content,omitempty"`
	ContentID          string `json:"content_id,omitempty"`
	ContentDisposition string `json:"content_disposition,omitempty"`
	IsInline           bool   `json:"is_inline,omitempty"`
	Size               int64  `json:"size,omitempty"`
}

// NylasOutboundAttachment is deliberately separate from NylasAttachment.
// NylasAttachment is also the provider/inbound response model, where Content
// contains bounded base64 recovered from raw MIME. Outbound sends instead use
// an exact-size, one-shot opener so stored objects can flow directly into the
// provider request without raw bytes or readers escaping into response JSON.
type NylasOutboundAttachment struct {
	Filename    string
	ContentType string
	ContentID   string
	Size        int64
	SHA256      string
	Open        NylasOutboundAttachmentOpener
}

type NylasOutboundAttachmentOpener func(context.Context) (NylasOutboundAttachmentContent, error)

type NylasOutboundAttachmentContent struct {
	ContentLength int64
	Body          io.ReadCloser
}

var (
	errNylasOutboundAttachmentInvalid               = errors.New("invalid Nylas outbound attachment")
	errNylasOutboundAttachmentMissingStream         = errors.New("Nylas outbound attachment stream required")
	errNylasOutboundAttachmentCountMismatch         = errors.New("Nylas outbound attachment count mismatch")
	errNylasOutboundAttachmentOpen                  = errors.New("failed to open Nylas outbound attachment")
	errNylasOutboundAttachmentContentLengthMismatch = errors.New("Nylas outbound attachment content length mismatch")
	errNylasOutboundAttachmentShort                 = errors.New("Nylas outbound attachment stream shorter than declared size")
	errNylasOutboundAttachmentLong                  = errors.New("Nylas outbound attachment stream longer than declared size")
	errNylasOutboundAttachmentRead                  = errors.New("failed to read Nylas outbound attachment")
	errNylasOutboundAttachmentChecksumMismatch      = errors.New("Nylas outbound attachment checksum mismatch")
)

type nylasOutboundAttachmentFailure struct {
	AttachmentIndex int
	Class           string
	Err             error
}

func (e *nylasOutboundAttachmentFailure) Error() string {
	return e.Err.Error()
}

func (e *nylasOutboundAttachmentFailure) Unwrap() error {
	return e.Err
}

func wrapNylasOutboundAttachmentFailure(index int, class string, err error) error {
	return &nylasOutboundAttachmentFailure{AttachmentIndex: index, Class: class, Err: err}
}

func nylasOutboundAttachmentFailureDetails(err error) (int, string) {
	var failure *nylasOutboundAttachmentFailure
	if errors.As(err, &failure) {
		return failure.AttachmentIndex, failure.Class
	}
	switch {
	case errors.Is(err, errNylasOutboundAttachmentInvalid):
		return 0, "invalid_stream"
	case errors.Is(err, errNylasOutboundAttachmentOpen):
		return 0, "open_failed"
	case errors.Is(err, errNylasOutboundAttachmentContentLengthMismatch):
		return 0, "content_length_mismatch"
	case errors.Is(err, errNylasOutboundAttachmentShort):
		return 0, "short_stream"
	case errors.Is(err, errNylasOutboundAttachmentLong):
		return 0, "long_stream"
	case errors.Is(err, errNylasOutboundAttachmentRead):
		return 0, "read_failed"
	case errors.Is(err, errNylasOutboundAttachmentChecksumMismatch):
		return 0, "checksum_mismatch"
	default:
		return 0, "unknown"
	}
}

type NylasEventParticipant struct {
	Name   string `json:"name,omitempty"`
	Email  string `json:"email,omitempty"`
	Status string `json:"status,omitempty"`
}

type NylasEventWhen struct {
	Object        string `json:"object,omitempty"`
	Time          int64  `json:"time,omitempty"`
	StartTime     int64  `json:"start_time,omitempty"`
	EndTime       int64  `json:"end_time,omitempty"`
	Date          string `json:"date,omitempty"`
	StartDate     string `json:"start_date,omitempty"`
	EndDate       string `json:"end_date,omitempty"`
	StartTimezone string `json:"start_timezone,omitempty"`
	EndTimezone   string `json:"end_timezone,omitempty"`
}

type NylasEventConferencingDetails struct {
	URL         string   `json:"url,omitempty"`
	MeetingCode string   `json:"meeting_code,omitempty"`
	Password    string   `json:"password,omitempty"`
	Phone       []string `json:"phone,omitempty"`
}

type NylasEventConferencing struct {
	Provider string                        `json:"provider,omitempty"`
	Details  NylasEventConferencingDetails `json:"details,omitempty"`
}

type NylasEvent struct {
	ID           string                  `json:"id"`
	CalendarID   string                  `json:"calendar_id,omitempty"`
	ICalUID      string                  `json:"ical_uid,omitempty"`
	Title        string                  `json:"title,omitempty"`
	Status       string                  `json:"status,omitempty"`
	Description  string                  `json:"description,omitempty"`
	Location     string                  `json:"location,omitempty"`
	HTMLLink     string                  `json:"html_link,omitempty"`
	Busy         bool                    `json:"busy,omitempty"`
	ReadOnly     bool                    `json:"read_only,omitempty"`
	Organizer    NylasEmailAddress       `json:"organizer,omitempty"`
	Participants []NylasEventParticipant `json:"participants,omitempty"`
	When         NylasEventWhen          `json:"when,omitempty"`
	Conferencing *NylasEventConferencing `json:"conferencing,omitempty"`
}

func (c *NylasRESTClient) ExchangeCode(ctx context.Context, code, redirectURI string) (NylasGrant, error) {
	var payload struct {
		ClientID        string `json:"client_id"`
		ClientSecret    string `json:"client_secret"`
		GrantType       string `json:"grant_type"`
		Code            string `json:"code"`
		RedirectURI     string `json:"redirect_uri"`
		CodeAccountable string `json:"code_accountable"`
	}
	payload.ClientID = c.clientID
	payload.ClientSecret = c.apiKey
	payload.GrantType = "authorization_code"
	payload.Code = strings.TrimSpace(code)
	payload.RedirectURI = strings.TrimSpace(redirectURI)
	payload.CodeAccountable = "nylas"

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
	values := url.Values{}
	folders := make([]NylasFolder, 0)
	seenPageTokens := map[string]struct{}{}
	for {
		var response struct {
			Data          []NylasFolder `json:"data"`
			NextCursor    string        `json:"next_cursor,omitempty"`
			NextPageToken string        `json:"next_page_token,omitempty"`
		}
		if err := c.do(ctx, http.MethodGet, grantPath(grantID, "folders"), values, nil, &response, true); err != nil {
			return nil, err
		}
		folders = append(folders, response.Data...)
		nextPageToken := firstNonBlank(response.NextPageToken, response.NextCursor)
		if nextPageToken == "" {
			return folders, nil
		}
		if _, repeated := seenPageTokens[nextPageToken]; repeated {
			return nil, NylasAPIError{StatusCode: http.StatusBadGateway, Code: "invalid_folders_pagination"}
		}
		seenPageTokens[nextPageToken] = struct{}{}
		values.Set("page_token", nextPageToken)
	}
}

func (c *NylasRESTClient) ListMessages(ctx context.Context, grantID string, query NylasMessageQuery) (NylasMessagePage, error) {
	values := url.Values{}
	if query.Limit > 0 {
		values.Set("limit", strconv.Itoa(query.Limit))
	}
	if strings.TrimSpace(query.PageToken) != "" {
		values.Set("page_token", strings.TrimSpace(query.PageToken))
	}
	threadID := strings.TrimSpace(query.ThreadID)
	nativeSearch := strings.TrimSpace(query.SearchQueryNative)
	switch {
	case threadID != "":
		values.Set("select", nylasMessageListSelect)
		values.Set("thread_id", threadID)
	case nativeSearch != "":
		values.Set("search_query_native", nativeSearch)
	default:
		values.Set("select", nylasMessageListSelect)
		if strings.TrimSpace(query.FolderID) != "" {
			values.Set("in", strings.TrimSpace(query.FolderID))
		}
		if strings.TrimSpace(query.Query) != "" {
			values.Set("q", strings.TrimSpace(query.Query))
		}
		if query.Unread != nil {
			values.Set("unread", strconv.FormatBool(*query.Unread))
		}
		if query.Starred != nil {
			values.Set("starred", strconv.FormatBool(*query.Starred))
		}
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
	return NylasMessagePage{Messages: normalizeNylasMessageListResponse(response.Data), NextPageToken: next}, nil
}

func normalizeNylasMessageListResponse(messages []NylasMessage) []NylasMessage {
	for messageIndex := range messages {
		messages[messageIndex].Body = ""
		for attachmentIndex := range messages[messageIndex].Attachments {
			messages[messageIndex].Attachments[attachmentIndex].Content = ""
		}
	}
	return messages
}

func (c *NylasRESTClient) GetThread(ctx context.Context, grantID, threadID string) (NylasThread, error) {
	var response struct {
		Data NylasThread `json:"data"`
	}
	if err := c.do(ctx, http.MethodGet, grantPath(grantID, "threads", threadID), nil, nil, &response, true); err != nil {
		return NylasThread{}, err
	}
	return response.Data, nil
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

func (c *NylasRESTClient) GetMessageRawMIME(ctx context.Context, grantID, messageID string) (string, error) {
	var response struct {
		Data struct {
			RawMIME string `json:"raw_mime"`
		} `json:"data"`
	}
	values := url.Values{"fields": []string{"raw_mime"}}
	if err := c.do(ctx, http.MethodGet, grantPath(grantID, "messages", messageID), values, nil, &response, true); err != nil {
		return "", err
	}
	return response.Data.RawMIME, nil
}

func (c *NylasRESTClient) DownloadAttachment(ctx context.Context, grantID, messageID, attachmentID string) ([]byte, error) {
	values := url.Values{}
	values.Set("message_id", strings.TrimSpace(messageID))
	raw, _, err := c.doBytes(ctx, http.MethodGet, grantPath(grantID, "attachments", attachmentID, "download"), values, true, communicationsAttachmentDownloadMaxBytes)
	return raw, err
}

func (c *NylasRESTClient) UpdateMessage(ctx context.Context, grantID, messageID string, update NylasMessageUpdate) (NylasMessage, error) {
	var response struct {
		Data NylasMessage `json:"data"`
	}
	values := url.Values{"select": []string{nylasMessageListSelect}}
	if err := c.do(ctx, http.MethodPut, grantPath(grantID, "messages", messageID), values, update, &response, true); err != nil {
		return NylasMessage{}, err
	}
	return response.Data, nil
}

func (c *NylasRESTClient) DeleteMessage(ctx context.Context, grantID, messageID string) error {
	return c.do(ctx, http.MethodDelete, grantPath(grantID, "messages", messageID), nil, nil, nil, true)
}

func (c *NylasRESTClient) SendMessage(ctx context.Context, grantID string, request NylasSendMessageRequest) (NylasMessage, error) {
	if len(request.Attachments) > 0 && len(request.OutboundAttachments) == 0 {
		return NylasMessage{}, errNylasOutboundAttachmentMissingStream
	}
	if len(request.Attachments) != len(request.OutboundAttachments) {
		return NylasMessage{}, errNylasOutboundAttachmentCountMismatch
	}
	if len(request.OutboundAttachments) > 0 {
		return c.sendMessageMultipart(ctx, grantID, request)
	}
	var response struct {
		Data NylasMessage `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, grantPath(grantID, "messages", "send"), nil, request, &response, true); err != nil {
		return NylasMessage{}, err
	}
	return response.Data, nil
}

func (c *NylasRESTClient) ListEventsByICalUID(ctx context.Context, grantID, iCalUID string) ([]NylasEvent, error) {
	values := url.Values{}
	values.Set("calendar_id", "primary")
	values.Set("ical_uid", strings.TrimSpace(iCalUID))
	var response struct {
		Data []NylasEvent `json:"data"`
	}
	if err := c.do(ctx, http.MethodGet, grantPath(grantID, "events"), values, nil, &response, true); err != nil {
		return nil, err
	}
	return response.Data, nil
}

func (c *NylasRESTClient) SendEventRSVP(ctx context.Context, grantID, eventID, calendarID, status string) error {
	values := url.Values{}
	calendarID = strings.TrimSpace(calendarID)
	if calendarID == "" {
		calendarID = "primary"
	}
	values.Set("calendar_id", calendarID)
	values.Set("skip_nylas_email", "true")
	payload := struct {
		Status string `json:"status"`
	}{Status: strings.TrimSpace(status)}
	return c.do(ctx, http.MethodPost, grantPath(grantID, "events", eventID, "send-rsvp"), values, payload, nil, true)
}

func (c *NylasRESTClient) sendMessageMultipart(ctx context.Context, grantID string, request NylasSendMessageRequest) (NylasMessage, error) {
	plan, err := buildNylasMultipartPlan(request)
	if err != nil {
		return NylasMessage{}, err
	}
	var response struct {
		Data NylasMessage `json:"data"`
	}
	if err := c.doMultipart(ctx, grantPath(grantID, "messages", "send"), plan, &response, request.IdempotencyKey); err != nil {
		return NylasMessage{}, err
	}
	return response.Data, nil
}

type nylasMultipartPlan struct {
	boundary      string
	contentType   string
	contentLength int64
	messageRaw    []byte
	attachments   []NylasOutboundAttachment
}

type nylasMultipartCountingWriter struct {
	count int64
}

func (w *nylasMultipartCountingWriter) Write(p []byte) (int, error) {
	if err := w.add(int64(len(p))); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (w *nylasMultipartCountingWriter) add(count int64) error {
	if count < 0 || count > math.MaxInt64-w.count {
		return fmt.Errorf("%w: multipart content length overflow", errNylasOutboundAttachmentInvalid)
	}
	w.count += count
	return nil
}

func buildNylasMultipartPlan(request NylasSendMessageRequest) (nylasMultipartPlan, error) {
	if len(request.OutboundAttachments) == 0 {
		return nylasMultipartPlan{}, errNylasOutboundAttachmentMissingStream
	}
	messageRequest := request
	messageRequest.Attachments = nil
	messageRaw, err := json.Marshal(messageRequest)
	if err != nil {
		return nylasMultipartPlan{}, err
	}

	counter := &nylasMultipartCountingWriter{}
	writer := multipart.NewWriter(counter)
	if err := writer.WriteField("message", string(messageRaw)); err != nil {
		return nylasMultipartPlan{}, err
	}
	for index, attachment := range request.OutboundAttachments {
		if attachment.Size < 0 || attachment.Open == nil {
			return nylasMultipartPlan{}, fmt.Errorf("%w: attachment %d", errNylasOutboundAttachmentInvalid, index+1)
		}
		if _, err := writer.CreatePart(nylasMultipartAttachmentHeader(index, attachment)); err != nil {
			return nylasMultipartPlan{}, err
		}
		if err := counter.add(attachment.Size); err != nil {
			return nylasMultipartPlan{}, err
		}
	}
	contentType := writer.FormDataContentType()
	boundary := writer.Boundary()
	if err := writer.Close(); err != nil {
		return nylasMultipartPlan{}, err
	}
	return nylasMultipartPlan{
		boundary:      boundary,
		contentType:   contentType,
		contentLength: counter.count,
		messageRaw:    messageRaw,
		attachments:   append([]NylasOutboundAttachment(nil), request.OutboundAttachments...),
	}, nil
}

func nylasMultipartAttachmentHeader(index int, attachment NylasOutboundAttachment) textproto.MIMEHeader {
	filename := strings.TrimSpace(attachment.Filename)
	if filename == "" {
		filename = "attachment"
	}
	fieldName := strings.TrimSpace(attachment.ContentID)
	if fieldName == "" {
		fieldName = fmt.Sprintf("attachment_%d", index+1)
	}
	contentType := strings.TrimSpace(attachment.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, escapeMultipartQuote(fieldName), escapeMultipartQuote(filename)))
	header.Set("Content-Type", contentType)
	return header
}

func escapeMultipartQuote(value string) string {
	return strings.NewReplacer("\\", "\\\\", `"`, `\"`).Replace(value)
}

type nylasMultipartStream struct {
	reader    *io.PipeReader
	cancel    context.CancelFunc
	closeOnce sync.Once
	done      chan struct{}

	mu        sync.Mutex
	active    io.ReadCloser
	closed    bool
	encodeErr error
}

func newNylasMultipartStream(ctx context.Context, plan nylasMultipartPlan) *nylasMultipartStream {
	streamCtx, cancel := context.WithCancel(ctx)
	reader, writer := io.Pipe()
	stream := &nylasMultipartStream{
		reader: reader,
		cancel: cancel,
		done:   make(chan struct{}),
	}
	go func() {
		err := stream.write(streamCtx, writer, plan)
		if err != nil {
			_ = writer.CloseWithError(err)
		} else {
			_ = writer.Close()
		}
		stream.encodeErr = err
		close(stream.done)
	}()
	go func() {
		select {
		case <-streamCtx.Done():
			stream.shutdown(streamCtx.Err())
		case <-stream.done:
		}
	}()
	return stream
}

func (s *nylasMultipartStream) Read(p []byte) (int, error) {
	return s.reader.Read(p)
}

func (s *nylasMultipartStream) Close() error {
	select {
	case <-s.done:
	default:
		s.shutdown(context.Canceled)
	}
	<-s.done
	_ = s.reader.Close()
	return nil
}

func (s *nylasMultipartStream) Err() error {
	<-s.done
	return s.encodeErr
}

func (s *nylasMultipartStream) completed() bool {
	select {
	case <-s.done:
		return true
	default:
		return false
	}
}

func (s *nylasMultipartStream) shutdown(cause error) {
	if cause == nil {
		cause = context.Canceled
	}
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.closed = true
		active := s.active
		s.active = nil
		s.mu.Unlock()
		s.cancel()
		_ = s.reader.CloseWithError(cause)
		if active != nil {
			_ = active.Close()
		}
	})
}

func (s *nylasMultipartStream) setActive(body io.ReadCloser) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		_ = body.Close()
		return context.Canceled
	}
	if s.active != nil {
		s.mu.Unlock()
		_ = body.Close()
		return fmt.Errorf("%w: multiple active streams", errNylasOutboundAttachmentInvalid)
	}
	s.active = body
	s.mu.Unlock()
	return nil
}

func (s *nylasMultipartStream) closeActive(body io.ReadCloser) error {
	s.mu.Lock()
	if s.active != body {
		s.mu.Unlock()
		return nil
	}
	s.active = nil
	s.mu.Unlock()
	return body.Close()
}

func (s *nylasMultipartStream) write(ctx context.Context, pipeWriter *io.PipeWriter, plan nylasMultipartPlan) error {
	writer := multipart.NewWriter(pipeWriter)
	if err := writer.SetBoundary(plan.boundary); err != nil {
		return err
	}
	if err := writer.WriteField("message", string(plan.messageRaw)); err != nil {
		return err
	}
	buffer := make([]byte, 32<<10)
	for index, attachment := range plan.attachments {
		if err := ctx.Err(); err != nil {
			return err
		}
		content, err := attachment.Open(ctx)
		if err != nil {
			if content.Body != nil {
				_ = content.Body.Close()
			}
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			return wrapNylasOutboundAttachmentFailure(index+1, "open_failed", fmt.Errorf("%w: attachment %d: %w", errNylasOutboundAttachmentOpen, index+1, err))
		}
		if content.Body == nil {
			return wrapNylasOutboundAttachmentFailure(index+1, "invalid_stream", fmt.Errorf("%w: attachment %d has no body", errNylasOutboundAttachmentInvalid, index+1))
		}
		if content.ContentLength != attachment.Size {
			_ = content.Body.Close()
			return wrapNylasOutboundAttachmentFailure(index+1, "content_length_mismatch", fmt.Errorf("%w: attachment %d reported %d bytes, expected %d", errNylasOutboundAttachmentContentLengthMismatch, index+1, content.ContentLength, attachment.Size))
		}
		if err := s.setActive(content.Body); err != nil {
			return err
		}
		part, partErr := writer.CreatePart(nylasMultipartAttachmentHeader(index, attachment))
		if partErr == nil {
			partErr = copyNylasOutboundAttachmentExact(ctx, part, content.Body, attachment.Size, attachment.SHA256, buffer)
		}
		_ = s.closeActive(content.Body)
		if partErr != nil {
			if ctx.Err() == nil && isNylasOutboundAttachmentFailure(partErr) {
				_, class := nylasOutboundAttachmentFailureDetails(partErr)
				return wrapNylasOutboundAttachmentFailure(index+1, class, partErr)
			}
			return partErr
		}
	}
	return writer.Close()
}

func copyNylasOutboundAttachmentExact(ctx context.Context, dst io.Writer, src io.Reader, size int64, expectedSHA256 string, buffer []byte) error {
	remaining := size
	emptyReads := 0
	hasher := sha256.New()
	for remaining > 0 {
		if err := ctx.Err(); err != nil {
			return err
		}
		readSize := int64(len(buffer))
		if remaining < readSize {
			readSize = remaining
		}
		n, readErr := src.Read(buffer[:int(readSize)])
		if n < 0 || n > int(readSize) {
			return fmt.Errorf("%w: invalid reader count %d", errNylasOutboundAttachmentRead, n)
		}
		if n > 0 {
			_, _ = hasher.Write(buffer[:n])
			if err := writeNylasMultipartBytes(ctx, dst, buffer[:n]); err != nil {
				return err
			}
			remaining -= int64(n)
			emptyReads = 0
		} else if readErr == nil {
			emptyReads++
			if emptyReads >= 100 {
				return fmt.Errorf("%w: %w", errNylasOutboundAttachmentRead, io.ErrNoProgress)
			}
		}
		if readErr != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			if errors.Is(readErr, io.EOF) {
				if remaining == 0 {
					return validateNylasOutboundAttachmentChecksum(hasher.Sum(nil), expectedSHA256)
				}
				return fmt.Errorf("%w: missing %d bytes", errNylasOutboundAttachmentShort, remaining)
			}
			return fmt.Errorf("%w: %w", errNylasOutboundAttachmentRead, readErr)
		}
	}

	var extra [1]byte
	emptyReads = 0
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, readErr := src.Read(extra[:])
		if n < 0 || n > len(extra) {
			return fmt.Errorf("%w: invalid reader count %d", errNylasOutboundAttachmentRead, n)
		}
		if n > 0 {
			return errNylasOutboundAttachmentLong
		}
		if readErr != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			if errors.Is(readErr, io.EOF) {
				return validateNylasOutboundAttachmentChecksum(hasher.Sum(nil), expectedSHA256)
			}
			return fmt.Errorf("%w: %w", errNylasOutboundAttachmentRead, readErr)
		}
		emptyReads++
		if emptyReads >= 100 {
			return fmt.Errorf("%w: %w", errNylasOutboundAttachmentRead, io.ErrNoProgress)
		}
	}
}

func validateNylasOutboundAttachmentChecksum(actual []byte, expected string) error {
	expected = strings.ToLower(strings.TrimSpace(expected))
	if expected == "" {
		return nil
	}
	if !validAttachmentSHA256Hex(expected) || hex.EncodeToString(actual) != expected {
		return errNylasOutboundAttachmentChecksumMismatch
	}
	return nil
}

func writeNylasMultipartBytes(ctx context.Context, dst io.Writer, content []byte) error {
	for len(content) > 0 {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, err := dst.Write(content)
		if n < 0 || n > len(content) {
			return fmt.Errorf("invalid multipart writer count %d", n)
		}
		content = content[n:]
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
	}
	return nil
}

func isNylasOutboundAttachmentFailure(err error) bool {
	return errors.Is(err, errNylasOutboundAttachmentInvalid) ||
		errors.Is(err, errNylasOutboundAttachmentOpen) ||
		errors.Is(err, errNylasOutboundAttachmentContentLengthMismatch) ||
		errors.Is(err, errNylasOutboundAttachmentShort) ||
		errors.Is(err, errNylasOutboundAttachmentLong) ||
		errors.Is(err, errNylasOutboundAttachmentRead) ||
		errors.Is(err, errNylasOutboundAttachmentChecksumMismatch)
}

func (c *NylasRESTClient) doMultipart(ctx context.Context, path string, plan nylasMultipartPlan, out any, idempotencyKey string) error {
	if c == nil || c.apiBase == "" {
		return NylasAPIError{StatusCode: http.StatusServiceUnavailable, Code: "nylas_not_configured"}
	}
	body := newNylasMultipartStream(ctx, plan)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiBase+path, body)
	if err != nil {
		_ = body.Close()
		return err
	}
	req.ContentLength = plan.contentLength
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", plan.contentType)
	if idempotencyKey = strings.TrimSpace(idempotencyKey); idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	resp, requestErr := c.client.Do(req)
	completedBeforeClose := body.completed()
	_ = body.Close()
	streamErr := body.Err()
	if requestErr != nil {
		if isNylasOutboundAttachmentFailure(streamErr) {
			return streamErr
		}
		if cause := context.Cause(ctx); cause != nil {
			return cause
		}
		return requestErr
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return parseNylasAPIError(resp.StatusCode, resp.Header, raw)
	}
	if completedBeforeClose && streamErr != nil {
		return streamErr
	}
	if out == nil || len(strings.TrimSpace(string(raw))) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return err
	}
	return nil
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
		if sendRequest, ok := body.(NylasSendMessageRequest); ok {
			if idempotencyKey := strings.TrimSpace(sendRequest.IdempotencyKey); idempotencyKey != "" {
				req.Header.Set("Idempotency-Key", idempotencyKey)
			}
		}
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

func (c *NylasRESTClient) doBytes(ctx context.Context, method, path string, query url.Values, authorize bool, maxBytes int64) ([]byte, http.Header, error) {
	if c == nil || c.apiBase == "" {
		return nil, nil, NylasAPIError{StatusCode: http.StatusServiceUnavailable, Code: "nylas_not_configured"}
	}
	endpoint := c.apiBase + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, nil)
	if err != nil {
		return nil, nil, err
	}
	if authorize {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	limit := maxBytes
	if limit <= 0 {
		limit = 8 << 20
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, nil, err
	}
	if int64(len(raw)) > limit {
		return nil, resp.Header.Clone(), NylasAPIError{StatusCode: http.StatusRequestEntityTooLarge, Code: "attachment_too_large"}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, resp.Header.Clone(), parseNylasAPIError(resp.StatusCode, resp.Header, raw)
	}
	return raw, resp.Header.Clone(), nil
}

func parseNylasAPIError(statusCode int, headers http.Header, raw []byte) error {
	var payload struct {
		Error   json.RawMessage `json:"error"`
		Code    string          `json:"code"`
		Type    string          `json:"type"`
		Message string          `json:"message"`
	}
	_ = json.Unmarshal(raw, &payload)
	var errorText string
	var nestedError struct {
		Code    string `json:"code"`
		Type    string `json:"type"`
		Message string `json:"message"`
	}
	if len(payload.Error) > 0 {
		if err := json.Unmarshal(payload.Error, &errorText); err != nil {
			_ = json.Unmarshal(payload.Error, &nestedError)
		}
	}
	code := firstNonBlank(payload.Code, nestedError.Code, payload.Type, nestedError.Type, errorText)
	message := firstNonBlank(payload.Message, nestedError.Message)
	if code == "" && message == "" && len(strings.TrimSpace(string(raw))) > 0 {
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
