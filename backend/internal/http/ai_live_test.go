package httpapi

import (
	"encoding/json"
	"io"
	"miraeopus/backend/internal/openaiagents"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAILiveUsesScopedServerConfiguredClientDelegation(t *testing.T) {
	server, _, original, _, company := aiToolsFixture(t)
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer fixture-openai" {
			t.Error("missing backend authentication")
		}
		var body struct {
			Session struct {
				Model        string
				Instructions string
				Delegation   struct{ Type string }
				Store        bool
				Client       struct {
					DataChannel struct {
						AllowedClientEvents []string `json:"allowed_client_events"`
					} `json:"data_channel"`
				}
			}
			Transport struct {
				Type string
				SDP  string
			}
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Session.Model != "gpt-live-1" || body.Session.Delegation.Type != "client" || body.Session.Store || body.Transport.Type != "webrtc" || body.Transport.SDP != "fixture offer" {
			t.Errorf("incorrect session config: %+v", body)
		}
		if body.Session.Instructions != aiLiveInstructions {
			t.Error("voice prompt is not server controlled")
		}
		if len(body.Session.Client.DataChannel.AllowedClientEvents) == 0 {
			t.Error("missing explicit client event permissions")
		}
		w.WriteHeader(201)
		io.WriteString(w, `{"session":{"id":"live_fixture"},"transport":{"type":"webrtc","sdp":"fixture answer"},"secret":"must not forward"}`)
	}))
	defer provider.Close()
	server.aiAPIKey = "fixture-openai"
	server.aiClient = openaiagents.NewClient("fixture-openai", nil, "")
	server.aiLiveURL = provider.URL
	request := httptest.NewRequest("POST", "/v1/ai/live?company_id="+company, strings.NewReader(`{"sdp":"fixture offer"}`)).WithContext(original.Context())
	rec := httptest.NewRecorder()
	server.handleAILive(rec, request)
	if rec.Code != 201 || !strings.Contains(rec.Body.String(), `"session_id":"live_fixture"`) || strings.Contains(rec.Body.String(), "secret") || strings.Contains(rec.Body.String(), "fixture-openai") {
		t.Fatalf("response=%d %s", rec.Code, rec.Body.String())
	}
	request = httptest.NewRequest("POST", request.URL.String(), strings.NewReader(`{"sdp":"fixture offer","model":"different","instructions":"override"}`)).WithContext(original.Context())
	rec = httptest.NewRecorder()
	server.handleAILive(rec, request)
	if rec.Code != 400 || calls != 1 {
		t.Fatal("accepted browser model override")
	}
	request = httptest.NewRequest("POST", "/v1/ai/live?company_id="+company, strings.NewReader(`{"sdp":"fixture offer"}`))
	rec = httptest.NewRecorder()
	server.handleAILive(rec, request)
	if rec.Code != 401 || calls != 1 {
		t.Fatal("anonymous voice request reached provider")
	}
}

func TestAILiveDoesNotEchoProviderFailure(t *testing.T) {
	server, _, original, _, company := aiToolsFixture(t)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(403)
		io.WriteString(w, `{"error":"private provider payload"}`)
	}))
	defer provider.Close()
	server.aiAPIKey = "fixture-openai"
	server.aiClient = openaiagents.NewClient("fixture-openai", nil, "")
	server.aiLiveURL = provider.URL
	request := httptest.NewRequest("POST", "/v1/ai/live?company_id="+company, strings.NewReader(`{"sdp":"offer"}`)).WithContext(original.Context())
	rec := httptest.NewRecorder()
	server.handleAILive(rec, request)
	if rec.Code != 502 || strings.Contains(rec.Body.String(), "private provider payload") {
		t.Fatalf("response=%d %s", rec.Code, rec.Body.String())
	}
}
