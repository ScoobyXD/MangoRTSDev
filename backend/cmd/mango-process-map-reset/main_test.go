package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"miraeopus/backend/internal/store"
)

const testCompanyID = "11111111-1111-1111-1111-111111111111"
const testActorID = "22222222-2222-4222-8222-222222222222"
const testPlanToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func testCommandArgs() []string {
	return []string{"--company-id", testCompanyID, "--actor-user-id", testActorID}
}

func TestParseCommandDefaultsToPreviewAndRequiresReviewedApplyToken(t *testing.T) {
	input, err := parseCommandConfig(testCommandArgs())
	if err != nil || input.Apply || input.ExpectedPlanToken != "" || input.CompanyID != testCompanyID || input.ActorUserID != testActorID {
		t.Fatalf("preview input = %+v, error=%v", input, err)
	}
	input, err = parseCommandConfig(append(testCommandArgs(), "--apply", "--expect-plan", testPlanToken))
	if err != nil || !input.Apply || input.ExpectedPlanToken != testPlanToken {
		t.Fatalf("apply input = %+v, error=%v", input, err)
	}
	for _, tail := range [][]string{{"--apply"}, {"--apply", "--expect-plan", " "}, {"--apply", "--expect-plan", "truncated-token"}, {"--apply", "--expect-plan", strings.Repeat("g", 64)}, {"--expect-plan", testPlanToken}, {"unexpected"}, {"--apply=invalid-secret-value"}} {
		if _, err := parseCommandConfig(append(testCommandArgs(), tail...)); err == nil {
			t.Fatalf("unsafe arguments accepted: %v", tail)
		}
	}
}

func TestParseCommandRejectsMissingOrNoncanonicalUUIDs(t *testing.T) {
	for _, args := range [][]string{
		{}, {"--company-id", testCompanyID}, {"--actor-user-id", testActorID},
		{"--company-id", "not-a-uuid", "--actor-user-id", testActorID},
		{"--company-id", testCompanyID, "--actor-user-id", "22222222222242228222222222222222"},
		{"--company-id", "11111111x1111x1111x1111x111111111111", "--actor-user-id", testActorID},
	} {
		if _, err := parseCommandConfig(args); err == nil {
			t.Fatalf("invalid identity accepted: %v", args)
		}
	}
}

func TestRunHelpAndInvalidInputsNeverReadDatabaseSettings(t *testing.T) {
	noEnvironment := func(string) string {
		t.Fatal("must not inspect database settings")
		return ""
	}
	var output bytes.Buffer
	if err := run(context.Background(), []string{"--help"}, noEnvironment, &output); err != nil || !strings.Contains(output.String(), "--expect-plan") {
		t.Fatalf("help output = %q, error=%v", output.String(), err)
	}
	if err := run(context.Background(), []string{"--apply"}, noEnvironment, &output); err == nil {
		t.Fatal("missing scope accepted")
	}
	if err := run(context.Background(), append(testCommandArgs(), "--apply", "--expect-plan", strings.Repeat("g", 64)), noEnvironment, &output); err == nil {
		t.Fatal("malformed token accepted before loading database settings")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := run(ctx, testCommandArgs(), noEnvironment, &output); err == nil || !strings.Contains(err.Error(), "canceled") {
		t.Fatalf("canceled command error = %v", err)
	}
}

func TestResetFailureReportsOnlyConnectedVersionAndStop(t *testing.T) {
	for _, cause := range []error{store.ErrProcessMapResetVersion, store.ErrProcessMapResetSchema} {
		var output bytes.Buffer
		result := store.ProcessMapResetResult{ServerVersion: "17.7", CompanyName: "must-not-be-printed", PlanToken: testPlanToken}
		err := writeResetResult(&output, result, fmt.Errorf("postgresql://operator:private@host: %w", cause))
		if err == nil || strings.Contains(err.Error(), "private") {
			t.Fatalf("unsafe preflight error = %v", err)
		}
		var report map[string]string
		if err := json.Unmarshal(output.Bytes(), &report); err != nil {
			t.Fatal(err)
		}
		if len(report) != 2 || report["server_version"] != "17.7" || report["status"] != "STOP" {
			t.Fatalf("preflight output disclosed unexpected data: %s", output.String())
		}
	}
	var output bytes.Buffer
	if err := writeResetResult(&output, store.ProcessMapResetResult{}, errors.New("private connection failure")); err == nil || output.Len() != 0 {
		t.Fatalf("failure without connected version: error=%v output=%q", err, output.String())
	}
}

func TestDatabaseConfigAllowsExistingPassfileWithoutPasswordEnvironment(t *testing.T) {
	getenv := func(key string) string {
		if key == "DB_HOST" {
			return "host=database.example.invalid"
		}
		return ""
	}
	cfg, err := parseDBConfig(getenv)
	if err != nil || cfg.Host != "database.example.invalid" || cfg.Port != "5432" || cfg.SSLMode != "require" || cfg.ConnectTimeoutSeconds != 5 {
		t.Fatalf("database defaults = %+v, error=%v", cfg, err)
	}
	connection, err := url.Parse(buildConnString(cfg))
	if err != nil {
		t.Fatal(err)
	}
	if _, present := connection.User.Password(); present {
		t.Fatal("empty password must be omitted so pgx can use pgpass")
	}
	cfg.User, cfg.Password, cfg.Name = "test@user", "synthetic:/@password", "test/database"
	connection, err = url.Parse(buildConnString(cfg))
	if err != nil {
		t.Fatal(err)
	}
	password, present := connection.User.Password()
	if !present || password != cfg.Password || connection.User.Username() != cfg.User || connection.Path != "/"+cfg.Name {
		t.Fatal("connection values did not survive URL escaping")
	}
}

func TestDatabaseConfigRejectsInvalidSettingsWithoutEchoingValues(t *testing.T) {
	for _, values := range []map[string]string{
		{}, {"DB_HOST": "database.example.invalid", "DB_PORT": "sensitive-invalid-value"},
		{"DB_HOST": "database.example.invalid", "DB_PORT": "65536"},
		{"DB_HOST": "database.example.invalid", "DB_CONNECT_TIMEOUT_SECONDS": "0"},
	} {
		_, err := parseDBConfig(func(key string) string { return values[key] })
		if err == nil || strings.Contains(err.Error(), "sensitive-invalid-value") {
			t.Fatalf("unsafe configuration error = %v", err)
		}
	}
}

func TestSafeOperationErrorsNeverExposeConnectionOrServerDetails(t *testing.T) {
	const secret = "synthetic-private-password"
	for _, cause := range []error{
		errors.New("connect postgresql://operator:" + secret + "@database.example.invalid/company"),
		&pgconn.PgError{Code: "28000", Message: secret, Detail: secret, Where: secret},
		&pgconn.PgError{Code: secret, Message: secret},
		fmt.Errorf("%s: %w", secret, store.ErrProcessMapResetStalePlan),
		fmt.Errorf("%s: %w", secret, store.ErrProcessMapResetSchema),
		fmt.Errorf("%s: %w", secret, store.ErrNotFound),
	} {
		err := safeOperationError(cause)
		if err == nil || strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "postgresql://") {
			t.Fatalf("unsafe operation error = %v", err)
		}
	}
	if got := safeOperationError(&pgconn.PgError{Code: "28000", Message: secret}).Error(); !strings.Contains(got, "SQLSTATE 28000") {
		t.Fatalf("missing safe SQLSTATE: %s", got)
	}
	if got := safeOperationError(store.ErrProcessMapResetStalePlan).Error(); !strings.Contains(got, "new preview") {
		t.Fatalf("stale plan guidance = %s", got)
	}
}
