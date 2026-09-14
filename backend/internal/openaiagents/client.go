// Package openaiagents implements the managed Agents API boundary used by Mango.
// Reference: https://developers.openai.com/api/docs/guides/agents-api/sessions
package openaiagents

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const maxResponseBytes = 16 << 20

type Client struct {
	apiKey     string
	httpClient *http.Client
	baseURL    string
}

// NewClient keeps credentials on the server. An empty baseURL uses OpenAI;
// the explicit override and HTTP client allow local protocol fixtures.
func NewClient(apiKey string, httpClient *http.Client, baseURL string) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 45 * time.Second}
	}
	clientCopy := *httpClient
	clientCopy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	return &Client{apiKey: strings.TrimSpace(apiKey), httpClient: &clientCopy, baseURL: strings.TrimRight(baseURL, "/")}
}

type FunctionTool struct {
	Type        string         `json:"type"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

// MCPTool is a service-origin HTTP connection, which needs no execution
// environment. Authentication belongs to this session, never to its prompt.
// https://developers.openai.com/api/docs/guides/agents-api/tools/mcp
type MCPTool struct {
	Type             string           `json:"type"`
	ServerLabel      string           `json:"server_label"`
	Transport        MCPHTTPTransport `json:"transport"`
	ConnectionOrigin string           `json:"connection_origin"`
	AllowedTools     []string         `json:"allowed_tools"`
	Required         bool             `json:"required"`
}

type MCPHTTPTransport struct {
	Type          string            `json:"type"`
	ServerURL     string            `json:"server_url"`
	Authorization string            `json:"authorization,omitempty"`
	Headers       map[string]string `json:"headers,omitempty"`
}

type Session struct {
	ID              string           `json:"id"`
	Status          string           `json:"status"`
	Agent           Agent            `json:"agent"`
	Error           string           `json:"error,omitempty"`
	RequiredActions []RequiredAction `json:"required_actions"`
}

type Agent struct {
	Model string `json:"model"`
}

type RequiredAction struct {
	Type      string          `json:"type"`
	TurnID    string          `json:"turn_id"`
	CallID    string          `json:"call_id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type ContentPart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// Item contains the message and function fields Mango uses. Other provider
// item kinds retain their type/status but are never treated as function calls.
type Item struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	TurnID    string          `json:"turn_id"`
	Role      string          `json:"role,omitempty"`
	Status    string          `json:"status"`
	Phase     string          `json:"phase,omitempty"`
	Content   []ContentPart   `json:"content,omitempty"`
	Name      string          `json:"name,omitempty"`
	CallID    string          `json:"call_id,omitempty"`
	Arguments json.RawMessage `json:"arguments,omitempty"`
}

type ItemPage struct {
	Data    []Item `json:"data"`
	HasMore bool   `json:"has_more"`
	LastID  string `json:"last_id"`
}

type Turn struct {
	ID         string     `json:"id"`
	Status     string     `json:"status"`
	SubagentID string     `json:"subagent_id"`
	Error      *TurnError `json:"error"`
}

// Terminal does not equate an idle session with a successful turn.
func (t Turn) Terminal() bool {
	return t.Status == "completed" || t.Status == "failed" || t.Status == "cancelled"
}

type TurnError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type TurnPage struct {
	Data    []Turn `json:"data"`
	HasMore bool   `json:"has_more"`
	LastID  string `json:"last_id"`
}

type ToolResult struct {
	TurnID  string
	CallID  string
	Success bool
	// Output is text; callers serialize structured results as JSON text.
	Output string
	Error  string
}

// APIError retains only recognized diagnostics and a provider request ID.
// Raw provider text may echo user input or credentials and must not escape.
type APIError struct {
	StatusCode int
	RequestID  string
	detail     string
}

func (e *APIError) Error() string {
	message := e.summary()
	if e.RequestID != "" {
		message += "; OpenAI request ID: " + e.RequestID
	}
	return message
}

func (e *APIError) summary() string {
	if e.detail != "" {
		return e.detail
	}
	switch e.StatusCode {
	case http.StatusUnauthorized:
		return "OpenAI authentication failed; check the backend API key"
	case http.StatusForbidden:
		return "OpenAI denied this Agents API request (HTTP 403)"
	case http.StatusNotFound:
		return "OpenAI model or agent session is unavailable"
	case http.StatusConflict:
		return "OpenAI agent session state conflicts with this request"
	case http.StatusTooManyRequests:
		return "OpenAI rate or usage limit reached"
	default:
		return fmt.Sprintf("OpenAI Agents API request failed (HTTP %d)", e.StatusCode)
	}
}

var providerRequestID = regexp.MustCompile(`^req_[a-f0-9]{32}$`)
var missingPermissionScopes = regexp.MustCompile(`(?i)missing scopes: ?([a-z._, ]+)`)

func readAPIError(response *http.Response) *APIError {
	err := &APIError{StatusCode: response.StatusCode}
	if id := response.Header.Get("X-Request-Id"); providerRequestID.MatchString(id) {
		err.RequestID = id
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	data, readErr := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	if readErr != nil || len(data) > 64<<10 || json.Unmarshal(data, &body) != nil {
		return err
	}
	switch body.Error.Code {
	case "invalid_api_key":
		err.detail = "OpenAI rejected the backend API key"
	case "unsupported_country_region_territory":
		err.detail = "OpenAI rejected the request's country or region"
	case "model_not_found":
		err.detail = "OpenAI could not access the configured model; check its name and project access"
	case "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded", "insufficient_quota":
		err.detail = "OpenAI billing or usage restriction: " + body.Error.Code
	}
	if response.StatusCode == http.StatusForbidden || response.StatusCode == http.StatusUnauthorized {
		if match := missingPermissionScopes.FindStringSubmatch(body.Error.Message); len(match) == 2 {
			var scopes []string
			for _, scope := range strings.FieldsFunc(match[1], func(r rune) bool { return r == ',' || r == ' ' }) {
				scope = strings.TrimSuffix(scope, ".")
				switch scope {
				case "api.agents.read", "api.agents.write", "api.responses.write":
					scopes = append(scopes, scope)
				}
			}
			if len(scopes) > 0 {
				err.detail = "OpenAI reports missing permissions: " + strings.Join(scopes, ", ") + "; check both the key and its project role"
			}
		} else if strings.Contains(strings.ToLower(body.Error.Message), "organization must be verified") {
			err.detail = "OpenAI requires organization verification for this request; check OpenAI organization settings"
		}
	}
	return err
}

func (c *Client) CreateSession(ctx context.Context, model, instructions, input string, tools []FunctionTool, mcps ...MCPTool) (Session, error) {
	if strings.TrimSpace(model) == "" {
		return Session{}, errors.New("an agent model is required")
	}
	if strings.TrimSpace(input) == "" {
		return Session{}, errors.New("an initial agent request is required")
	}
	agentTools := make([]any, 0, len(tools)+len(mcps))
	for _, tool := range tools {
		if tool.Type != "" && tool.Type != "function" {
			return Session{}, errors.New("only application function tools are supported")
		}
		tool.Type = "function"
		agentTools = append(agentTools, tool)
	}
	labels := make(map[string]bool, len(mcps))
	for _, mcp := range mcps {
		if err := mcp.validate(); err != nil {
			return Session{}, err
		}
		if labels[mcp.ServerLabel] {
			return Session{}, errors.New("MCP server labels must be unique")
		}
		labels[mcp.ServerLabel] = true
		mcp.Type = "mcp"
		mcp.Transport.Type = "http"
		mcp.ConnectionOrigin = "service"
		agentTools = append(agentTools, mcp)
	}
	body := map[string]any{
		"agent":       map[string]any{"model": model, "instructions": instructions, "tools": agentTools},
		"environment": map[string]string{"type": "none"},
		"input":       input,
		"stream":      false,
	}
	var session Session
	err := c.request(ctx, http.MethodPost, "/agents/sessions", body, "", &session)
	sanitizeSession(&session)
	if err == nil && session.ID == "" {
		err = errors.New("OpenAI returned an agent session without an ID")
	}
	return session, err
}

func (m MCPTool) validate() error {
	if (m.Type != "" && m.Type != "mcp") || (m.Transport.Type != "" && m.Transport.Type != "http") || (m.ConnectionOrigin != "" && m.ConnectionOrigin != "service") {
		return errors.New("MCP tools require service-origin HTTP transport")
	}
	if strings.TrimSpace(m.ServerLabel) == "" || strings.ContainsAny(m.ServerLabel, " \t\r\n") {
		return errors.New("an MCP server label is required")
	}
	serverURL, err := url.Parse(m.Transport.ServerURL)
	if err != nil || serverURL.Scheme != "https" || serverURL.Hostname() == "" || serverURL.User != nil || serverURL.Fragment != "" {
		return errors.New("MCP server URL must be HTTPS without embedded credentials or a fragment")
	}
	if len(m.AllowedTools) == 0 {
		return errors.New("MCP tools require an explicit nonempty tool allowlist")
	}
	for _, name := range m.AllowedTools {
		if strings.TrimSpace(name) == "" || name == "*" {
			return errors.New("MCP allowed tools must name individual tools")
		}
	}
	if strings.ContainsAny(m.Transport.Authorization, "\r\n") {
		return errors.New("invalid MCP authorization value")
	}
	for key, value := range m.Transport.Headers {
		if strings.TrimSpace(key) == "" || strings.ContainsAny(key, " \t\r\n:") || strings.ContainsAny(value, "\r\n") {
			return errors.New("invalid MCP HTTP header")
		}
		if strings.EqualFold(key, "Authorization") && m.Transport.Authorization != "" {
			return errors.New("MCP authorization must use only one source")
		}
	}
	return nil
}

func (c *Client) RetrieveSession(ctx context.Context, sessionID string) (Session, error) {
	path, err := sessionPath(sessionID)
	if err != nil {
		return Session{}, err
	}
	var session Session
	err = c.request(ctx, http.MethodGet, path, nil, "", &session)
	sanitizeSession(&session)
	return session, err
}

func (c *Client) SendMessage(ctx context.Context, sessionID, text string) error {
	if strings.TrimSpace(text) == "" {
		return errors.New("an agent message is required")
	}
	return c.sendEvent(ctx, sessionID, map[string]any{
		"type": "agent.session.input.message",
		"input": []any{map[string]any{
			"role": "user", "content": []ContentPart{{Type: "input_text", Text: text}},
		}},
	}, "")
}

func (c *Client) SubmitToolResult(ctx context.Context, sessionID string, result ToolResult) error {
	if result.TurnID == "" || result.CallID == "" {
		return errors.New("a tool result requires its pending turn and call IDs")
	}
	event := map[string]any{
		"type": "agent.session.input.tool_result", "turn_id": result.TurnID,
		"call_id": result.CallID, "success": result.Success,
	}
	if result.Success {
		event["output"] = result.Output
	} else {
		event["error"] = result.Error
	}
	// The same saved result can be resubmitted after a disconnect without
	// duplicating its input event. Do not rerun a mutation to recover a result.
	key := sha256.Sum256([]byte(sessionID + "\x00" + result.TurnID + "\x00" + result.CallID))
	return c.sendEvent(ctx, sessionID, event, hex.EncodeToString(key[:]))
}

func (c *Client) Cancel(ctx context.Context, sessionID string) error {
	return c.sendEvent(ctx, sessionID, map[string]string{"type": "agent.session.input.cancel"}, "")
}

// DeleteSession removes this provider session. App ownership and retained
// history cleanup remain the caller's responsibility; physical provider cleanup
// may continue after the confirmed public API removal.
func (c *Client) DeleteSession(ctx context.Context, sessionID string) error {
	path, err := sessionPath(sessionID)
	if err != nil {
		return err
	}
	var result struct {
		ID      string `json:"id"`
		Deleted bool   `json:"deleted"`
	}
	if err := c.request(ctx, http.MethodDelete, path, nil, "", &result); err != nil {
		return err
	}
	if result.ID != sessionID || !result.Deleted {
		return errors.New("OpenAI did not confirm agent session deletion")
	}
	return nil
}

func (c *Client) sendEvent(ctx context.Context, sessionID string, event any, key string) error {
	path, err := sessionPath(sessionID)
	if err != nil {
		return err
	}
	return c.request(ctx, http.MethodPost, path+"/events", map[string]any{"events": []any{event}}, key, nil)
}

// ListItems returns one page in ascending order. Pass LastID as after while
// HasMore is true. Function execution must use Session.RequiredActions only.
func (c *Client) ListItems(ctx context.Context, sessionID, after string) (ItemPage, error) {
	path, err := sessionPath(sessionID)
	if err != nil {
		return ItemPage{}, err
	}
	var page ItemPage
	err = c.request(ctx, http.MethodGet, path+"/items?"+pageQuery(after, "asc"), nil, "", &page)
	for i := range page.Data {
		if page.Data[i].Role == "assistant" {
			page.Data[i].Role = "ai"
		}
	}
	return page, err
}

// ListTurns returns newest turns first; inspect Status rather than inferring
// completion from the enclosing session. Pass LastID for another page.
func (c *Client) ListTurns(ctx context.Context, sessionID, after string) (TurnPage, error) {
	path, err := sessionPath(sessionID)
	if err != nil {
		return TurnPage{}, err
	}
	var page TurnPage
	err = c.request(ctx, http.MethodGet, path+"/turns?"+pageQuery(after, "desc"), nil, "", &page)
	for i := range page.Data {
		sanitizeTurn(&page.Data[i])
	}
	return page, err
}

func pageQuery(after, order string) string {
	query := url.Values{"order": {order}, "limit": {"10"}}
	if after != "" {
		query.Set("after", after)
	}
	return query.Encode()
}

func sessionPath(id string) (string, error) {
	if !validID(id) {
		return "", errors.New("invalid OpenAI session ID")
	}
	return "/agents/sessions/" + url.PathEscape(id), nil
}

func validID(id string) bool {
	return id != "" && id != "." && id != ".." && !strings.ContainsAny(id, "/\\%?#\r\n")
}

func sanitizeSession(session *Session) {
	if session.Error != "" {
		session.Error = "OpenAI agent session failed"
	}
}

func sanitizeTurn(turn *Turn) {
	if turn.Error == nil {
		return
	}
	// Stable codes are useful for operators; provider text may echo private input.
	switch turn.Error.Code {
	case "context_length_exceeded", "session_budget_exceeded", "usage_limit_exceeded", "credit_balance_exhausted", "rate_limit_exceeded", "server_overloaded", "cyber_policy", "connection_failed", "server_error", "authentication_error", "invalid_request", "resource_not_found", "sandbox_error", "executor_version_incompatible", "active_turn_not_steerable", "request_timeout", "internal_error":
		turn.Error.Message = "OpenAI agent turn failed: " + turn.Error.Code
	default:
		turn.Error.Code = "internal_error"
		turn.Error.Message = "OpenAI agent turn failed"
	}
}

func (c *Client) request(ctx context.Context, method, path string, body any, key string, out any) error {
	if c.apiKey == "" {
		return errors.New("OpenAI backend API key is not configured")
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return errors.New("could not encode OpenAI request")
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return errors.New("could not create OpenAI request")
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("OpenAI-Beta", "agents=v1")
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	response, err := c.httpClient.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("could not reach OpenAI Agents API")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return readAPIError(response)
	}
	if out == nil {
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return errors.New("could not read OpenAI response")
	}
	if len(data) > maxResponseBytes {
		return errors.New("OpenAI response exceeded the supported size")
	}
	if err := json.Unmarshal(data, out); err != nil {
		return errors.New("OpenAI returned an invalid response")
	}
	return nil
}
