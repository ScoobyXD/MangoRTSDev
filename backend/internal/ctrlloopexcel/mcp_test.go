package ctrlloopexcel

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type testBackend struct {
	mu       sync.Mutex
	original []byte
	targets  []CellTarget
	expired  bool
	loads    int
}

func (b *testBackend) Authorize(ctx context.Context, token string) (Scope, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if token != "run-one" || b.expired {
		return Scope{}, errors.New("expired")
	}
	return Scope{RunID: "run-1", CompanyID: "company-1", Stamp: arrivalStamp(), Workbooks: []Workbook{{JobID: "job-1", Name: "WIP.xlsx", Instructions: "Stamp factory receipt for the exact PO", Timezone: "America/Los_Angeles"}}}, nil
}
func (b *testBackend) Load(ctx context.Context, scope Scope, jobID string) ([]byte, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if scope.CompanyID != "company-1" || jobID != "job-1" || b.expired {
		return nil, errors.New("forbidden")
	}
	b.loads++
	data, _, err := Apply(b.original, b.targets, scope.Stamp)
	return data, err
}
func (b *testBackend) Stage(ctx context.Context, scope Scope, targets []CellTarget) ([]CellChange, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if scope.CompanyID != "company-1" || b.expired {
		return nil, errors.New("forbidden")
	}
	for _, target := range targets {
		if target.JobID != "job-1" {
			return nil, errors.New("forbidden")
		}
	}
	all := append(append([]CellTarget{}, b.targets...), targets...)
	_, changes, err := Apply(b.original, all, scope.Stamp)
	if err == nil {
		b.targets = all
	}
	return changes, err
}

type bearerTransport struct{ token string }

func (b bearerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("Authorization", "Bearer "+b.token)
	return http.DefaultTransport.RoundTrip(req)
}

func connectMCP(t *testing.T, endpoint, token string) *mcp.ClientSession {
	t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "preservation-test", Version: "1"}, nil)
	session, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{Endpoint: endpoint, HTTPClient: &http.Client{Transport: bearerTransport{token}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { session.Close() })
	return session
}

func toolText(result *mcp.CallToolResult) string {
	var text strings.Builder
	for _, content := range result.Content {
		if content, ok := content.(*mcp.TextContent); ok {
			text.WriteString(content.Text)
		}
	}
	return text.String()
}

func TestMCPHTTPIsolationStagingAcrossReplicasAndSavedOutput(t *testing.T) {
	b := &testBackend{original: fixture(t)}
	first := httptest.NewServer(NewHandler(b))
	defer first.Close()
	second := httptest.NewServer(NewHandler(b))
	defer second.Close()
	ctx := context.Background()
	s1 := connectMCP(t, first.URL, "run-one")
	s2 := connectMCP(t, second.URL, "run-one")
	listed, err := s1.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Tools) != 5 {
		t.Fatalf("unexpected broad tool surface: %+v", listed.Tools)
	}
	for _, tool := range listed.Tools {
		if tool.Name == "update_cells" {
			schema, _ := json.Marshal(tool.InputSchema)
			if strings.Contains(string(schema), "source_url") || strings.Contains(string(schema), "arrival_at") || strings.Contains(string(schema), "app_base_url") || strings.Contains(string(schema), "AppBaseURL") {
				t.Fatal("model can choose link or arrival")
			}
		}
	}
	result, err := s1.CallTool(ctx, &mcp.CallToolParams{Name: "inspect_workbook", Arguments: map[string]any{"job_id": "job-1"}})
	if err != nil || result.IsError || !strings.Contains(toolText(result), "Offset layout") {
		t.Fatalf("inspect failed: %v %+v", err, result)
	}
	result, err = s1.CallTool(ctx, &mcp.CallToolParams{Name: "search_cells", Arguments: map[string]any{"job_id": "job-1", "sheet": "Offset layout", "query": "PO-42"}})
	if err != nil || result.IsError || !strings.Contains(toolText(result), "C6") {
		t.Fatalf("search failed: %v %+v", err, result)
	}
	result, err = s1.CallTool(ctx, &mcp.CallToolParams{Name: "update_cells", Arguments: map[string]any{"cells": []CellTarget{{JobID: "job-1", Sheet: "Offset layout", Cell: "F6"}}}})
	if err != nil || result.IsError || !strings.Contains(toolText(result), "9/13/26 2:31PM") {
		t.Fatalf("stage failed: %v %+v", err, result)
	}
	result, err = s2.CallTool(ctx, &mcp.CallToolParams{Name: "read_cells", Arguments: map[string]any{"job_id": "job-1", "sheet": "Offset layout", "start_cell": "F6", "end_cell": "F6"}})
	if err != nil || result.IsError || !strings.Contains(toolText(result), "9/13/26 2:31PM") || !strings.Contains(toolText(result), "outlook.office.com") {
		t.Fatalf("second replica missed staged update: %v %+v", err, result)
	}
	// The worker saves the staged .xlsx after the managed agent turn succeeds.
	b.mu.Lock()
	saved, changes, err := Apply(b.original, b.targets, arrivalStamp())
	b.mu.Unlock()
	if err != nil || len(changes) != 1 || Validate(saved) != nil {
		t.Fatalf("saved output invalid: %v %+v", err, changes)
	}
	b.mu.Lock()
	loads := b.loads
	b.mu.Unlock()
	for _, tool := range []string{"read_cells", "update_cells"} {
		args := map[string]any{"job_id": "company-2-job", "sheet": "WIP", "start_cell": "A1", "end_cell": "A2"}
		if tool == "update_cells" {
			args = map[string]any{"cells": []CellTarget{{JobID: "company-2-job", Sheet: "WIP", Cell: "C2"}}}
		}
		result, err = s2.CallTool(ctx, &mcp.CallToolParams{Name: tool, Arguments: args})
		if err != nil || !result.IsError {
			t.Fatalf("cross-company tool accepted: %s %v %+v", tool, err, result)
		}
	}
	b.mu.Lock()
	if b.loads != loads {
		t.Fatal("unauthorized workbook reached storage")
	}
	b.expired = true
	b.mu.Unlock()
	if _, err = s1.CallTool(ctx, &mcp.CallToolParams{Name: "list_workbooks", Arguments: map[string]any{}}); err == nil {
		t.Fatal("expired bearer remained authorized")
	}
}

func TestMCPRejectsMissingInvalidAndBrowserAuthorization(t *testing.T) {
	b := &testBackend{original: fixture(t)}
	for _, test := range []struct {
		token, origin string
		status        int
	}{{"", "", 401}, {"wrong", "", 401}, {"run-one", "https://untrusted.example", 403}} {
		req := httptest.NewRequest(http.MethodPost, "http://mango.test/api/ctrl-loop/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
		if test.token != "" {
			req.Header.Set("Authorization", "Bearer "+test.token)
		}
		if test.origin != "" {
			req.Header.Set("Origin", test.origin)
		}
		response := httptest.NewRecorder()
		NewHandler(b).ServeHTTP(response, req)
		if response.Code != test.status {
			t.Fatalf("authorization status %d, want %d", response.Code, test.status)
		}
	}
}
