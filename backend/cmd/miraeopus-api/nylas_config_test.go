package main

import "testing"

func TestSecretEnvValueAllowsPlaintextAndJSONSecrets(t *testing.T) {
	t.Setenv("PLAIN_SECRET", "plain-value")
	if got := secretEnvValue("PLAIN_SECRET", "api_key"); got != "plain-value" {
		t.Fatalf("plaintext secret = %q, want plain-value", got)
	}

	t.Setenv("JSON_SECRET", `{"api_key":"json-value","other":"ignored"}`)
	if got := secretEnvValue("JSON_SECRET", "api_key"); got != "json-value" {
		t.Fatalf("json secret = %q, want json-value", got)
	}
}

func TestBuildNylasConfigExtractsJSONSecretValues(t *testing.T) {
	t.Setenv("NYLAS_CLIENT_ID", "client-id")
	t.Setenv("NYLAS_API_KEY", `{"api_key":"api-key"}`)
	t.Setenv("NYLAS_API_BASE_URL", "https://api.us.nylas.com")
	t.Setenv("NYLAS_REDIRECT_URI", "https://api.example.com/nylas/oauth/callback")
	t.Setenv("NYLAS_FRONTEND_REDIRECT_URL", "https://app.example.com/home")
	t.Setenv("NYLAS_STATE_SECRET", `{"state_secret":"state-secret"}`)
	t.Setenv("NYLAS_WEBHOOK_SECRET", `{"webhook_secret":"webhook-secret"}`)

	config := buildNylasConfig()
	if config.APIKey != "api-key" {
		t.Fatalf("APIKey = %q, want api-key", config.APIKey)
	}
	if config.StateSecret != "state-secret" {
		t.Fatalf("StateSecret = %q, want state-secret", config.StateSecret)
	}
	if config.WebhookSecret != "webhook-secret" {
		t.Fatalf("WebhookSecret = %q, want webhook-secret", config.WebhookSecret)
	}
	if !config.IsConfigured() {
		t.Fatal("config is not configured")
	}
}

func TestBuildNylasClientNeedsOnlyProviderCallConfiguration(t *testing.T) {
	t.Setenv("NYLAS_CLIENT_ID", "worker-client-id")
	t.Setenv("NYLAS_API_KEY", "worker-api-key")
	t.Setenv("NYLAS_API_BASE_URL", "https://api.us.nylas.com")
	t.Setenv("NYLAS_REDIRECT_URI", "")
	t.Setenv("NYLAS_FRONTEND_REDIRECT_URL", "")
	t.Setenv("NYLAS_STATE_SECRET", "")
	t.Setenv("NYLAS_WEBHOOK_SECRET", "")

	config := buildNylasConfig()
	if config.IsConfigured() {
		t.Fatal("worker-only provider configuration unexpectedly enables OAuth")
	}
	if client := buildNylasClient(config); client == nil {
		t.Fatal("worker-only provider configuration did not create a Nylas client")
	}
}
