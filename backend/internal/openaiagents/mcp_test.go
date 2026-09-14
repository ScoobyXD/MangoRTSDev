package openaiagents

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestSessionWithScopedAuthenticatedMCP(t *testing.T) {
	mcp := MCPTool{
		ServerLabel: "excel", Required: true,
		Transport:    MCPHTTPTransport{ServerURL: "https://excel.example.com/mcp", Authorization: "Bearer run-token", Headers: map[string]string{"X-Run-ID": "run-one"}},
		AllowedTools: []string{"inspect_workbook", "write_timestamp"},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		agent := body["agent"].(map[string]any)
		tools := agent["tools"].([]any)
		if len(tools) != 2 || tools[0].(map[string]any)["type"] != "function" {
			t.Fatalf("ordinary function tool was lost: %#v", tools)
		}
		want := map[string]any{
			"type": "mcp", "server_label": "excel", "connection_origin": "service", "required": true,
			"allowed_tools": []any{"inspect_workbook", "write_timestamp"},
			"transport":     map[string]any{"type": "http", "server_url": "https://excel.example.com/mcp", "authorization": "Bearer run-token", "headers": map[string]any{"X-Run-ID": "run-one"}},
		}
		if !reflect.DeepEqual(tools[1], want) || !reflect.DeepEqual(body["environment"], map[string]any{"type": "none"}) {
			t.Fatalf("incorrect managed MCP request: %#v", body)
		}
		if strings.Contains(agent["instructions"].(string), "run-token") || strings.Contains(body["input"].(string), "run-token") {
			t.Fatal("MCP credential leaked into model input")
		}
		io.WriteString(w, `{"id":"asess_mcp","agent":{"model":"fixture-model"}}`)
	}))
	defer server.Close()
	client := NewClient("fixture-key", server.Client(), server.URL)
	_, err := client.CreateSession(context.Background(), "fixture-model", "Read only this company's workbooks.", "Process the email.", []FunctionTool{{Name: "finish", Parameters: map[string]any{"type": "object"}}}, mcp)
	if err != nil {
		t.Fatal(err)
	}
	if mcp.Type != "" || mcp.Transport.Type != "" || mcp.ConnectionOrigin != "" {
		t.Fatal("caller MCP configuration was mutated")
	}
}

func TestMCPRejectsUnsafeOrUnscopedConfigurationBeforeRequest(t *testing.T) {
	base := MCPTool{ServerLabel: "excel", Transport: MCPHTTPTransport{ServerURL: "https://excel.example.com/mcp"}, AllowedTools: []string{"read"}}
	for _, test := range []struct {
		name string
		edit func(*MCPTool)
	}{
		{"environment transport", func(m *MCPTool) { m.ConnectionOrigin = "environment" }},
		{"stdio transport", func(m *MCPTool) { m.Transport.Type = "stdio" }},
		{"plain HTTP", func(m *MCPTool) { m.Transport.ServerURL = "http://excel.example.com/mcp" }},
		{"embedded secret", func(m *MCPTool) { m.Transport.ServerURL = "https://user:secret@excel.example.com/mcp" }},
		{"missing tools", func(m *MCPTool) { m.AllowedTools = nil }},
		{"wildcard tools", func(m *MCPTool) { m.AllowedTools = []string{"*"} }},
		{"empty tool", func(m *MCPTool) { m.AllowedTools = []string{" "} }},
		{"missing label", func(m *MCPTool) { m.ServerLabel = " " }},
		{"injected auth", func(m *MCPTool) { m.Transport.Authorization = "secret\r\nX-Evil: 1" }},
		{"injected header", func(m *MCPTool) { m.Transport.Headers = map[string]string{"X-Run": "one\r\nX-Evil: 1"} }},
		{"duplicate auth", func(m *MCPTool) {
			m.Transport.Authorization = "secret"
			m.Transport.Headers = map[string]string{"authorization": "other-secret"}
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			mcp := base
			test.edit(&mcp)
			client := NewClient("", nil, "")
			_, err := client.CreateSession(context.Background(), "model", "instructions", "input", nil, mcp)
			if err == nil || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "API key") {
				t.Fatalf("expected safe validation error before network request: %v", err)
			}
		})
	}
	client := NewClient("", nil, "")
	if _, err := client.CreateSession(context.Background(), "model", "instructions", "input", nil, base, base); err == nil || !strings.Contains(err.Error(), "unique") {
		t.Fatalf("duplicate MCP labels accepted: %v", err)
	}
}
