package main

import "testing"

func realtimeEnvironmentLookup(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestRealtimeBackplaneEnvironmentAllowsExplicitlyUnconfiguredLocalDevelopment(t *testing.T) {
	config, useLocal, err := realtimeBackplaneEnvironmentFromLookup(realtimeEnvironmentLookup(nil))
	if err != nil || !useLocal || config != (realtimeBackplaneEnvironment{}) {
		t.Fatalf("config=%+v useLocal=%t err=%v", config, useLocal, err)
	}
}

func TestEmailWorkerRealtimeBackplaneRejectsProcessLocalFallback(t *testing.T) {
	for _, key := range []string{
		"MANGORTS_VALKEY_REQUIRED",
		"MANGORTS_VALKEY_ENDPOINT",
		"MANGORTS_VALKEY_REGION",
		"MANGORTS_VALKEY_CACHE_NAME",
		"MANGORTS_VALKEY_USER_ID",
		"MANGORTS_VALKEY_CHANNEL",
	} {
		t.Setenv(key, "")
	}
	if _, _, err := buildRealtimeBackplane(true); err == nil {
		t.Fatal("email worker accepted the process-local realtime backplane")
	}
}

func TestRealtimeBackplaneEnvironmentFailsWhenDeployedConfigurationIsRequiredButMissing(t *testing.T) {
	_, _, err := realtimeBackplaneEnvironmentFromLookup(realtimeEnvironmentLookup(map[string]string{
		"MANGORTS_VALKEY_REQUIRED": "true",
		"AWS_REGION":               "us-west-1",
	}))
	if err == nil {
		t.Fatal("required Valkey configuration unexpectedly fell back to process-local")
	}
}

func TestRealtimeBackplaneEnvironmentRejectsPartialAndInvalidConfiguration(t *testing.T) {
	for name, values := range map[string]map[string]string{
		"partial": {
			"MANGORTS_VALKEY_ENDPOINT": "cache.example:6379",
			"AWS_REGION":               "us-west-1",
		},
		"invalid required value": {
			"MANGORTS_VALKEY_REQUIRED": "sometimes",
		},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := realtimeBackplaneEnvironmentFromLookup(realtimeEnvironmentLookup(values)); err == nil {
				t.Fatal("invalid Valkey environment was accepted")
			}
		})
	}
}

func TestRealtimeBackplaneEnvironmentAcceptsCompleteRequiredConfiguration(t *testing.T) {
	config, useLocal, err := realtimeBackplaneEnvironmentFromLookup(realtimeEnvironmentLookup(map[string]string{
		"MANGORTS_VALKEY_REQUIRED":   "true",
		"MANGORTS_VALKEY_ENDPOINT":   "cache.example:6379",
		"MANGORTS_VALKEY_REGION":     "us-west-1",
		"MANGORTS_VALKEY_CACHE_NAME": "mangorts-dev-realtime",
		"MANGORTS_VALKEY_USER_ID":    "mangorts-dev-api",
		"MANGORTS_VALKEY_CHANNEL":    "mangorts-dev-realtime-v1",
	}))
	if err != nil || useLocal {
		t.Fatalf("useLocal=%t err=%v", useLocal, err)
	}
	if config.Endpoint != "cache.example:6379" || config.Region != "us-west-1" || config.CacheName != "mangorts-dev-realtime" || config.UserID != "mangorts-dev-api" || config.Channel != "mangorts-dev-realtime-v1" {
		t.Fatalf("unexpected complete config: %+v", config)
	}
}
