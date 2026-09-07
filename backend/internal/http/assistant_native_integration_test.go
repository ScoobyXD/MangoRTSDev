package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Run only under hermes/tests/native_smoke.py --go-integration. The Python
// fixture owns an unmodified pinned Hermes gateway and a fake model provider
// on the same Linux loopback interface;
// this test owns the authenticated Go API and the ordinary Mango Node command.
func TestAssistantNativeHTTPIntegration(t *testing.T) {
	nativeURL := os.Getenv("HERMES_NATIVE_URL")
	if nativeURL == "" {
		t.Skip("run hermes/tests/native_smoke.py --go-integration with the pinned native environment")
	}
	parsed, err := url.Parse(nativeURL)
	if err != nil || parsed.Scheme != "http" {
		t.Fatal("native smoke requires an isolated HTTP fixture")
	}
	ip := net.ParseIP(parsed.Hostname())
	if parsed.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
		t.Fatal("native smoke accepts only a loopback service address")
	}
	port, err := strconv.Atoi(os.Getenv("MANGO_NATIVE_CALLBACK_PORT"))
	if err != nil || port < 1024 || port > 65535 {
		t.Fatal("native fixture callback port is required")
	}
	callbackKey := os.Getenv("MANGO_NATIVE_CALLBACK_KEY")
	apiKey := os.Getenv("HERMES_NATIVE_KEY")
	if len(callbackKey) < 32 || len(apiKey) < 32 {
		t.Fatal("native smoke requires synthetic service keys")
	}
	scopeFile := os.Getenv("MANGO_NATIVE_SCOPE_FILE")
	if scopeFile == "" {
		t.Fatal("native smoke scope handoff path is required")
	}

	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-4111-8111-111111111111"
	repo.EnsureCompany(companyID, "Native Hermes smoke")
	user := mustRealtimeAuthUser(t, repo, companyID, "native-hermes-owner", domain.RoleCompanyAdmin)
	process, err := repo.CreateLogicGate(companyID, "Native integration process")
	if err != nil {
		t.Fatal(err)
	}
	step, err := repo.CreateProcessStep(store.ProcessStepCreateInput{CompanyID: companyID, LogicGateID: process.LogicGateID, Name: "Native integration step", ActorUserID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	const accessToken = "isolated-native-test-auth-token"
	route := HermesRoute{CompanyID: companyID, UserID: user.UserID, URL: nativeURL, APIKey: apiKey, CallbackKey: callbackKey}
	server := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{accessToken: {Subject: user.CognitoSubject, Email: user.Email, Name: user.DisplayName}}},
		HermesRoutes:  []HermesRoute{route}, DisableRealtimeSpine: true, DisableNotificationCleanup: true, DisableAttachmentUploadCleanup: true,
	})
	defer server.Close()
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		t.Fatal(err)
	}
	var actionCallbacks atomic.Int32
	routes := server.Routes()
	api := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/internal/hermes/actions" {
			actionCallbacks.Add(1)
		}
		routes.ServeHTTP(w, r)
	}), ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = api.Serve(listener) }()
	defer api.Close()
	apiURL := "http://127.0.0.1:" + strconv.Itoa(port)
	transport := &http.Transport{Proxy: nil}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 60 * time.Second}

	// The runtime binds its fresh persistent home to these exact generated IDs.
	file, err := os.CreateTemp(filepath.Dir(scopeFile), "mango-native-scope-*.json")
	if err != nil {
		t.Fatal(err)
	}
	tempName := file.Name()
	defer os.Remove(tempName)
	if err := json.NewEncoder(file).Encode(map[string]string{"company_id": companyID, "user_id": user.UserID}); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(tempName, scopeFile); err != nil {
		t.Fatal(err)
	}

	startup, cancelStartup := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancelStartup()
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	ready := false
	lastProbe := "no response"
	for !ready {
		probeContext, cancelProbe := context.WithTimeout(startup, time.Second)
		request, _ := http.NewRequestWithContext(probeContext, http.MethodGet, nativeURL+"/v1/capabilities", nil)
		request.Header.Set("Authorization", "Bearer "+apiKey)
		response, err := client.Do(request)
		if err == nil {
			ready = response.StatusCode == http.StatusOK
			lastProbe = fmt.Sprintf("HTTP %d", response.StatusCode)
			response.Body.Close()
		} else {
			lastProbe = err.Error()
		}
		cancelProbe()
		if ready {
			break
		}
		select {
		case <-startup.Done():
			t.Fatalf("native gateway did not become ready: %s", lastProbe)
		case <-ticker.C:
		}
	}

	request := func(method, path string, body any, authenticated bool) (int, []byte) {
		t.Helper()
		var content io.Reader
		if body != nil {
			encoded, _ := json.Marshal(body)
			content = bytes.NewReader(encoded)
		}
		req, err := http.NewRequest(method, apiURL+path, content)
		if err != nil {
			t.Fatal(err)
		}
		if authenticated {
			req.Header.Set("Authorization", "Bearer "+accessToken)
		}
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
		if err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, data
	}
	query := "?company_id=" + companyID
	if status, _ := request(http.MethodGet, "/v1/assistant/conversations"+query, nil, false); status != 401 {
		t.Fatalf("anonymous native admission status=%d", status)
	}
	submission := assistantSubmission{CompanyID: companyID, RequestID: store.NewUUIDv7String(), Message: fmt.Sprintf("fixture action MANGO_PROCESS_ID=%s MANGO_STEP_ID=%s", process.LogicGateID, step.Step.ProcessStepID)}
	status, data := request(http.MethodPost, "/v1/assistant/runs", submission, true)
	if status != 202 {
		t.Fatalf("native admission status=%d body=%s", status, data)
	}
	var accepted assistantRunStatus
	if err := json.Unmarshal(data, &accepted); err != nil || accepted.RunID == "" {
		t.Fatal("native admission did not return its run identity")
	}
	status, data = request(http.MethodPost, "/v1/assistant/runs", submission, true)
	if status != 202 || !strings.Contains(string(data), accepted.RunID) {
		t.Fatalf("submission replay status=%d body=%s", status, data)
	}
	status, data = request(http.MethodGet, "/v1/assistant/runs/"+accepted.RunID+"/events"+query, nil, true)
	if status != 200 || !strings.Contains(string(data), "run.completed") || !strings.Contains(string(data), "Fixture reply complete.") {
		t.Fatalf("native reply stream status=%d body=%s", status, data)
	}
	nodes, err := repo.ListNodes(companyID)
	if err != nil || len(nodes) != 1 || nodes[0].Title != "Fixture Node" {
		t.Fatalf("native action committed %d Nodes, err=%v", len(nodes), err)
	}
	if actionCallbacks.Load() != 2 {
		t.Fatalf("expected two native callbacks deduplicated into one Node, got %d", actionCallbacks.Load())
	}
	work, err := repo.GetLogicGateWork(companyID, process.LogicGateID, user.UserID)
	if err != nil || len(work.Nodes) != 1 {
		t.Fatalf("native command did not save Process work: %v", err)
	}
	assignment := work.Nodes[0]
	if assignment.ProcessStepID == nil || *assignment.ProcessStepID != step.Step.ProcessStepID || assignment.PlacedByUserID != user.UserID {
		t.Fatal("native action did not preserve exact Step and trusted actor")
	}
	status, data = request(http.MethodGet, "/v1/assistant/conversations/"+submission.RequestID+query, nil, true)
	if status != 200 || !strings.Contains(string(data), "Fixture reply complete.") {
		t.Fatalf("native saved conversation status=%d body=%s", status, data)
	}

	stopSubmission := assistantSubmission{CompanyID: companyID, RequestID: store.NewUUIDv7String(), Message: "fixture stop"}
	status, data = request(http.MethodPost, "/v1/assistant/runs", stopSubmission, true)
	if status != 202 {
		t.Fatalf("native stop admission status=%d body=%s", status, data)
	}
	var stopping assistantRunStatus
	if err := json.Unmarshal(data, &stopping); err != nil {
		t.Fatal(err)
	}
	status, data = request(http.MethodPost, "/v1/assistant/runs/"+stopping.RunID+"/cancel", map[string]string{"company_id": companyID}, true)
	if status != 200 {
		t.Fatalf("native cancellation status=%d body=%s", status, data)
	}
	status, data = request(http.MethodGet, "/v1/assistant/runs/"+stopping.RunID+"/events"+query, nil, true)
	if status != 200 || !strings.Contains(string(data), "run.cancelled") {
		t.Fatalf("native cancelled stream status=%d body=%s", status, data)
	}
	gate, err := repo.GetAssistantRun(context.Background(), companyID, user.UserID, stopSubmission.RequestID)
	if err != nil || !gate.Cancelled {
		t.Fatalf("native Stop did not retain the Mango action gate: %v", err)
	}
	t.Log("Real pinned Hermes HTTP → authenticated Go API → native plugin → existing Process/Step/Node command passed; duplicate submission, streamed reply, saved conversation and Stop verified.")
}
