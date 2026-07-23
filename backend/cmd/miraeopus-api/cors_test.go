package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCORSAllowsFrontendRequestHeaders(t *testing.T) {
	t.Setenv("MANGORTS_ALLOWED_ORIGIN", "http://localhost:5173")

	called := false
	handler := withCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodOptions, "/v1/nodes/node-1?company_id=company-1", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Method", "DELETE")
	req.Header.Set("Access-Control-Request-Headers", "authorization,cache-control,idempotency-key,if-none-match,x-idempotency-key,x-mango-confirmation-display-name")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if called {
		t.Fatal("preflight request reached wrapped handler")
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("allow origin = %q, want configured origin", got)
	}
	allowedHeaders := strings.ToLower(rec.Header().Get("Access-Control-Allow-Headers"))
	for _, header := range []string{"authorization", "cache-control", "idempotency-key", "if-none-match", "x-idempotency-key", "x-mango-confirmation-display-name", "x-mango-company-id"} {
		if !strings.Contains(allowedHeaders, header) {
			t.Fatalf("allow headers = %q, missing %q", allowedHeaders, header)
		}
	}
	if got := rec.Header().Get("Access-Control-Expose-Headers"); !strings.Contains(strings.ToLower(got), "etag") {
		t.Fatalf("expose headers = %q, want ETag exposed", got)
	}
	if got := rec.Header().Get("Access-Control-Max-Age"); got == "" {
		t.Fatal("preflight max age is empty")
	}
}

func TestCORSAllowsPatchPreflight(t *testing.T) {
	t.Setenv("MANGORTS_ALLOWED_ORIGIN", "http://localhost:5173")

	called := false
	handler := withCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodOptions, "/v1/editor-collaboration/node/node-1/documents/document-1", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Method", http.MethodPatch)
	req.Header.Set("Access-Control-Request-Headers", "authorization,content-type")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if called {
		t.Fatal("PATCH preflight request reached wrapped handler")
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("PATCH preflight status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("PATCH preflight allow origin = %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, http.MethodPatch) {
		t.Fatalf("PATCH preflight allow methods = %q, missing PATCH", got)
	}
}

func TestCORSMatchesCommaSeparatedOrigins(t *testing.T) {
	t.Setenv("MANGORTS_ALLOWED_ORIGIN", "https://app.example.com, https://admin.example.com")

	handler := withCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Origin", "https://admin.example.com")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://admin.example.com" {
		t.Fatalf("allow origin = %q, want matched request origin", got)
	}
	if got := rec.Header().Values("Vary"); !strings.Contains(strings.Join(got, ","), "Origin") {
		t.Fatalf("vary headers = %v, want Origin", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("allow credentials = %q, want true", got)
	}
}

func TestCORSAllowsCredentialedRealtimeTicketWithWildcardDevOrigin(t *testing.T) {
	t.Setenv("MANGORTS_ALLOWED_ORIGIN", "*")

	handler := withCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodPost, "/v1/realtime/ticket", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("allow origin = %q, want request origin", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("allow credentials = %q, want true", got)
	}
}

func TestCORSOmitsUnlistedOrigin(t *testing.T) {
	t.Setenv("MANGORTS_ALLOWED_ORIGIN", "https://app.example.com")

	handler := withCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("allow origin = %q, want empty for unlisted origin", got)
	}
}

func TestShouldLogRequestSuppressesSuccessfulNylasWebhookPosts(t *testing.T) {
	t.Setenv("LOG_SUCCESSFUL_NYLAS_WEBHOOKS", "")

	req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", nil)
	if shouldLogRequest(req, http.StatusOK) {
		t.Fatal("successful Nylas webhook POST should be suppressed by default")
	}
	if !shouldLogRequest(req, http.StatusUnauthorized) {
		t.Fatal("failed Nylas webhook POST should still be logged")
	}
	if !shouldLogRequest(httptest.NewRequest(http.MethodGet, "/nylas/webhook", nil), http.StatusOK) {
		t.Fatal("Nylas webhook challenge GET should still be logged")
	}

	t.Setenv("LOG_SUCCESSFUL_NYLAS_WEBHOOKS", "true")
	if !shouldLogRequest(req, http.StatusOK) {
		t.Fatal("LOG_SUCCESSFUL_NYLAS_WEBHOOKS=true should log successful webhook posts")
	}
}
