package main

import (
	"context"
	"net/url"
	"strings"
	"testing"
)

func testEnv(values map[string]string) envLookup {
	return func(key string) string {
		return values[key]
	}
}

func TestParseCommandConfigRequiresCompanyIDAndDefaultsDryRun(t *testing.T) {
	if _, err := parseCommandConfig(nil, testEnv(nil)); err == nil || !strings.Contains(err.Error(), "-company-id") {
		t.Fatalf("parse without company id error = %v, want -company-id error", err)
	}

	cfg, err := parseCommandConfig([]string{"-company-id=11111111-1111-1111-1111-111111111111"}, testEnv(nil))
	if err != nil {
		t.Fatalf("parseCommandConfig returned error: %v", err)
	}
	if cfg.Apply {
		t.Fatalf("Apply = true, want dry-run default")
	}
	if cfg.CompanyID != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("CompanyID = %q", cfg.CompanyID)
	}
	if cfg.LargePayloadBytes != defaultLargePayloadBytes {
		t.Fatalf("LargePayloadBytes = %d, want %d", cfg.LargePayloadBytes, defaultLargePayloadBytes)
	}

	if _, err := parseCommandConfig([]string{"-company-id=not-a-uuid"}, testEnv(nil)); err == nil || !strings.Contains(err.Error(), "must be a UUID") {
		t.Fatalf("parse invalid uuid error = %v, want UUID error", err)
	}
}

func TestRunApplyRequiresExplicitConfirmationBeforeDBConfig(t *testing.T) {
	var output strings.Builder
	err := run(context.Background(), []string{
		"-apply",
		"-company-id=11111111-1111-1111-1111-111111111111",
	}, func(string) string { return "" }, &output)
	if err == nil || !strings.Contains(err.Error(), "-confirm-apply="+applyConfirmation) {
		t.Fatalf("error = %v, want apply confirmation error before DB config", err)
	}
}

func TestParseDBConfigDefaultsAndConnectionStringEscapesValues(t *testing.T) {
	if _, err := parseDBConfig(testEnv(nil)); err == nil {
		t.Fatalf("expected missing DB env error")
	} else if !strings.Contains(err.Error(), "DB_HOST") || !strings.Contains(err.Error(), "DB_PASSWORD") {
		t.Fatalf("missing env error = %v, want required env names", err)
	}

	cfg, err := parseDBConfig(testEnv(map[string]string{
		"DB_HOST":                    "host=db.example.com",
		"DB_PASSWORD":                "p@ss word/with:chars'",
		"DB_CONNECT_TIMEOUT_SECONDS": "not-an-int",
	}))
	if err != nil {
		t.Fatalf("parseDBConfig returned error: %v", err)
	}
	if cfg.Host != "db.example.com" || cfg.Port != "5432" || cfg.User != "postgres" || cfg.Name != "postgres" || cfg.SSLMode != "require" {
		t.Fatalf("defaults not applied: %+v", cfg)
	}
	if cfg.ConnectTimeoutSeconds != 5 {
		t.Fatalf("ConnectTimeoutSeconds = %d, want fallback 5", cfg.ConnectTimeoutSeconds)
	}

	parsed, err := url.Parse(buildConnString(cfg))
	if err != nil {
		t.Fatalf("url.Parse: %v", err)
	}
	password, ok := parsed.User.Password()
	if !ok || password != "p@ss word/with:chars'" {
		t.Fatalf("password = %q ok=%v", password, ok)
	}
	if parsed.Query().Get("sslmode") != "require" || parsed.Query().Get("connect_timeout") != "5" {
		t.Fatalf("query params not preserved: %s", parsed.RawQuery)
	}
}

func TestProdLikeTargetReasonsCatchDevOnlyRefusalSignals(t *testing.T) {
	reasons := prodLikeTargetReasons(dbConfig{Host: "mangorts-prod.cluster.local", Name: "mangorts"}, testEnv(map[string]string{
		"APP_ENV": "dev",
	}))
	if !containsString(reasons, "DB_HOST") {
		t.Fatalf("reasons = %#v, want DB_HOST", reasons)
	}

	reasons = prodLikeTargetReasons(dbConfig{Host: "dev.cluster.local", Name: "mangorts_dev"}, testEnv(map[string]string{
		"APP_ENV": "production",
	}))
	if !containsString(reasons, "APP_ENV") {
		t.Fatalf("reasons = %#v, want APP_ENV", reasons)
	}

	reasons = prodLikeTargetReasons(dbConfig{Host: "mangorts-dev.cluster.local", Name: "mangorts_dev"}, testEnv(map[string]string{
		"APP_ENV": "dev",
	}))
	if len(reasons) != 0 {
		t.Fatalf("reasons = %#v, want no prod-like reasons for dev target", reasons)
	}
}

func TestBuildDryRunReportPredictsCompactedHistoryFromTextBoxProjections(t *testing.T) {
	before := compactionSnapshot{
		NodeInformation:             tableStats{RowCount: 3651, TextBytes: 3_000_000_000, InlineSignalRows: 3651, LargePayloadRows: 3000},
		NodeProjectionSeenSnapshots: tableStats{RowCount: 234, TextBytes: 210_000_000, InlineSignalRows: 234, LargePayloadRows: 200},
		NodeProjectionTable:         tableStats{RowCount: 250, TextBytes: 500_000, InlineSignalRows: 0, LargePayloadRows: 0},
		NodeProjectionTextBoxes:     tableStats{RowCount: 219, TextBytes: 400_000, InlineSignalRows: 0, LargePayloadRows: 0},
		TextBoxProjectionNodeCount:  42,
	}

	rep := buildDryRunReport(commandConfig{
		CompanyID:         "11111111-1111-1111-1111-111111111111",
		LargePayloadBytes: defaultLargePayloadBytes,
	}, before)
	if !rep.DryRun || rep.Apply || !rep.AfterEstimated {
		t.Fatalf("dry-run flags = dry_run:%v apply:%v after_estimated:%v", rep.DryRun, rep.Apply, rep.AfterEstimated)
	}
	if rep.After.NodeInformation != before.NodeProjectionTextBoxes {
		t.Fatalf("predicted node_information = %+v, want text-box projection stats %+v", rep.After.NodeInformation, before.NodeProjectionTextBoxes)
	}
	if rep.After.NodeProjectionSeenSnapshots != (tableStats{}) {
		t.Fatalf("predicted seen snapshots = %+v, want zeroed", rep.After.NodeProjectionSeenSnapshots)
	}
	if rep.After.NodeProjectionTable != before.NodeProjectionTable {
		t.Fatalf("projection table changed in prediction: %+v", rep.After.NodeProjectionTable)
	}
	if len(rep.RemainingLiveSteps) == 0 {
		t.Fatalf("dry run report should include remaining live steps")
	}
}

func TestValidateApplySnapshotBlocksDirtyOrMissingTextBoxProjections(t *testing.T) {
	if err := validateApplySnapshot(compactionSnapshot{
		NodeProjectionTable:     tableStats{InlineSignalRows: 1},
		NodeProjectionTextBoxes: tableStats{RowCount: 1, InlineSignalRows: 1},
	}); err == nil || !strings.Contains(err.Error(), "inline-byte signals") {
		t.Fatalf("dirty projection error = %v, want inline-byte block", err)
	}
	if err := validateApplySnapshot(compactionSnapshot{}); err == nil || !strings.Contains(err.Error(), "no current Text box") {
		t.Fatalf("empty projection error = %v, want missing projection block", err)
	}
	if err := validateApplySnapshot(compactionSnapshot{
		NodeProjectionTextBoxes: tableStats{RowCount: 1},
	}); err != nil {
		t.Fatalf("clean projection snapshot blocked: %v", err)
	}
}

func TestInlineSignalPredicateCoversDurableInlineByteShapes(t *testing.T) {
	predicate := inlineSignalPredicate("information")
	for _, want := range []string{"data:image/", "data:application/", "base64,", "dataURL", "data_url"} {
		if !strings.Contains(predicate, want) {
			t.Fatalf("predicate %q missing %q", predicate, want)
		}
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
