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

// APIError deliberately excludes provider bodies, which may echo user input
// or credentials. StatusCode is available for the app's error handling.
type APIError struct{ StatusCode int }

func (e *APIError) Error() string {
	switch e.StatusCode {
	case http.StatusUnauthorized:
		return "OpenAI authentication failed; check the backend API key"
	case http.StatusForbidden:
		return "OpenAI access denied; check project permissions and Agents API access"
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

func (c *Client) CreateSession(ctx context.Context, model, instructions, input string, tools []FunctionTool) (Session, error) {
	if strings.TrimSpace(model) == "" {
		return Session{}, errors.New("an agent model is required")
	}
	if strings.TrimSpace(input) == "" {
		return Session{}, errors.New("an initial agent request is required")
	}
	functions := make([]FunctionTool, len(tools))
	for i, tool := range tools {
		if tool.Type != "" && tool.Type != "function" {
			return Session{}, errors.New("only application function tools are supported")
		}
		tool.Type = "function"
		functions[i] = tool
	}
	body := map[string]any{
		"agent":       map[string]any{"model": model, "instructions": instructions, "tools": functions},
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
		return &APIError{StatusCode: response.StatusCode}
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
