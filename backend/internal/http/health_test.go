package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthIncludesDeployMetadata(t *testing.T) {
	t.Setenv("APP_ENV", "staging")
	t.Setenv("AUTH_MODE", "cognito")
	t.Setenv("MANGORTS_ALLOWED_ORIGIN", "https://dev.mangorts.com")
	t.Setenv("MANGORTS_DEPLOY_ENV", "dev")
	t.Setenv("MANGORTS_DEPLOY_REVISION", "test-sha")
	t.Setenv("MANGORTS_APP_URL", "https://dev.mangorts.com")
	t.Setenv("MANGORTS_API_URL", "https://api.dev.mangorts.com")

	rec := httptest.NewRecorder()
	NewServer(nil).handleHealth(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var payload map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode health payload: %v", err)
	}
	for key, want := range map[string]string{
		"app_env":            "staging",
		"auth_mode":          "cognito",
		"allowed_origin":     "https://dev.mangorts.com",
		"deploy_environment": "dev",
		"deploy_revision":    "test-sha",
		"app_url":            "https://dev.mangorts.com",
		"api_url":            "https://api.dev.mangorts.com",
	} {
		if got, _ := payload[key].(string); got != want {
			t.Fatalf("%s = %q, want %q", key, got, want)
		}
	}
	if got, _ := payload["ok"].(bool); !got {
		t.Fatalf("ok = %v, want true", payload["ok"])
	}
}
