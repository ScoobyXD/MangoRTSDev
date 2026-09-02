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

func TestActorEmailAndInteractiveFlags(t *testing.T) {
	args := []string{"--company-id", testCompanyID, "--actor-email", " JonathanKim829@Gmail.com ", "--interactive"}
	cfg, err := parseCommandConfig(args)
	if err != nil || cfg.ActorEmail != "jonathankim829@gmail.com" || cfg.ActorUserID != "" || !cfg.Interactive || cfg.Apply {
		t.Fatalf("interactive email config = %+v, error=%v", cfg, err)
	}
	for _, extra := range [][]string{
		{"--actor-user-id", testActorID}, {"--apply"}, {"--apply=false"},
		{"--expect-plan", testPlanToken}, {"--expect-plan", ""},
	} {
		if _, err := parseCommandConfig(append(append([]string{}, args...), extra...)); err == nil {
			t.Fatalf("conflicting interactive flags accepted: %v", extra)
		}
	}
	for _, email := range []string{"not-an-email", "Jonathan <jonathankim829@gmail.com>"} {
		if _, err := parseCommandConfig([]string{"--company-id", testCompanyID, "--actor-email", email}); err == nil {
			t.Fatal("malformed actor email accepted")
		}
	}
}

func TestInteractiveResetRequiresConfirmationAndReusesExactPreviewToken(t *testing.T) {
	for _, test := range []struct {
		name, answer string
		wantCalls    int
	}{
		{"confirmed", "RESET\n", 2}, {"Windows enter", "RESET\r\n", 2},
		{"EOF", "", 1}, {"EOF after RESET", "RESET", 1},
		{"declined", "no\n", 1}, {"lowercase", "reset\n", 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			cfg := commandConfig{ProcessMapResetInput: store.ProcessMapResetInput{CompanyID: testCompanyID, ActorUserID: testActorID}, Interactive: true}
			actor := resetActor{UserID: testActorID, Email: "jonathankim829@gmail.com", DisplayName: "Jonathan", Role: "dev_admin"}
			var calls []store.ProcessMapResetInput
			reset := func(_ context.Context, input store.ProcessMapResetInput) (store.ProcessMapResetResult, error) {
				calls = append(calls, input)
				return store.ProcessMapResetResult{
					CompanyID: testCompanyID, CompanyName: "Original dev company", ServerVersion: "17.7", PlanToken: testPlanToken,
					FolderCount: 8, ProcessCount: 14, ChangedPlacements: 22, RelationshipCount: 7, TraceCount: 6, Applied: input.Apply,
				}, nil
			}
			var output bytes.Buffer
			if err := runConfiguredReset(context.Background(), cfg, actor, strings.NewReader(test.answer), &output, reset); err != nil {
				t.Fatal(err)
			}
			if len(calls) != test.wantCalls || calls[0].Apply || calls[0].ExpectedPlanToken != "" {
				t.Fatalf("reset calls = %+v, want %d with read-only preview first", calls, test.wantCalls)
			}
			for _, required := range []string{"Original dev company", actor.Email, actor.UserID, `"relationships_to_delete": 7`, "Type RESET"} {
				if !strings.Contains(output.String(), required) {
					t.Fatalf("preview omitted %q: %s", required, output.String())
				}
			}
			if test.wantCalls == 2 {
				if !calls[1].Apply || calls[1].ExpectedPlanToken != testPlanToken || calls[1].CompanyID != testCompanyID || calls[1].ActorUserID != testActorID {
					t.Fatalf("apply changed the reviewed identity or token: %+v", calls[1])
				}
				if !strings.Contains(output.String(), "Reset complete. Reload Process Map.") {
					t.Fatal("successful interactive reset omitted completion instruction")
				}
			} else if !strings.Contains(output.String(), "Canceled; no reset applied.") {
				t.Fatal("canceled reset omitted cancellation result")
			}
		})
	}
}

func TestInteractiveResetStopsOnChangedPlanOrExpiredContext(t *testing.T) {
	for _, expire := range []bool{false, true} {
		cfg := commandConfig{ProcessMapResetInput: store.ProcessMapResetInput{CompanyID: testCompanyID, ActorUserID: testActorID}, Interactive: true}
		ctx, cancel := context.WithCancel(context.Background())
		calls := 0
		reset := func(_ context.Context, input store.ProcessMapResetInput) (store.ProcessMapResetResult, error) {
			calls++
			if calls == 1 {
				if expire {
					cancel()
				}
				return store.ProcessMapResetResult{PlanToken: testPlanToken, ServerVersion: "17.7"}, nil
			}
			if calls != 2 || !input.Apply || input.ExpectedPlanToken != testPlanToken {
				t.Fatalf("changed plan triggered an unexpected retry: %+v", input)
			}
			return store.ProcessMapResetResult{ServerVersion: "17.7"}, store.ErrProcessMapResetStalePlan
		}
		var output bytes.Buffer
		err := runConfiguredReset(ctx, cfg, resetActor{UserID: testActorID}, strings.NewReader("RESET\nRESET\n"), &output, reset)
		cancel()
		if err == nil || strings.Contains(output.String(), "Reset complete") {
			t.Fatalf("changed/expired plan did not stop: error=%v output=%s", err, output.String())
		}
		if expire && calls != 1 || !expire && calls != 2 {
			t.Fatalf("changed/expired plan made %d calls", calls)
		}
	}
}

func TestRunHelpAndInvalidInputsNeverReadDatabaseSettings(t *testing.T) {
	noEnvironment := func(string) string {
		t.Fatal("must not inspect database settings")
		return ""
	}
	var output bytes.Buffer
	if err := run(context.Background(), []string{"--help"}, noEnvironment, strings.NewReader(""), &output); err != nil || !strings.Contains(output.String(), "--expect-plan") {
		t.Fatalf("help output = %q, error=%v", output.String(), err)
	}
	if err := run(context.Background(), []string{"--apply"}, noEnvironment, strings.NewReader(""), &output); err == nil {
		t.Fatal("missing scope accepted")
	}
	if err := run(context.Background(), append(testCommandArgs(), "--apply", "--expect-plan", strings.Repeat("g", 64)), noEnvironment, strings.NewReader(""), &output); err == nil {
		t.Fatal("malformed token accepted before loading database settings")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := run(ctx, testCommandArgs(), noEnvironment, strings.NewReader(""), &output); err == nil || !strings.Contains(err.Error(), "canceled") {
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
