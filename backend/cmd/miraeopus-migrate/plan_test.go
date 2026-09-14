package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestMigrationPlanPendingAndAlreadyApplied(t *testing.T) {
	dir := t.TempDir()
	first := writeMigrationRunnerTestSQL(t, dir, "first.sql", "select 1;\r\n")
	second := writeMigrationRunnerTestSQL(t, dir, "second.sql", "select 2;\n")
	files := []migrationFile{{Name: "first.sql", Path: first}, {Name: "second.sql", Path: second}}
	plan, err := buildMigrationPlan(files, map[string]bool{"first.sql": true}, true, 170007, []byte("[]"))
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte("select 2;\n"))
	if !plan.Ready || !reflect.DeepEqual(plan.Applied, []string{"first.sql"}) || !reflect.DeepEqual(plan.Pending, []plannedMigration{{Version: "second.sql", SHA256: fmt.Sprintf("%x", digest)}}) {
		t.Fatalf("incorrect migration plan: %+v", plan)
	}
	plan, err = buildMigrationPlan(files, map[string]bool{"first.sql": true, "second.sql": true}, true, 170007, []byte("[]"))
	if err != nil || !plan.Ready || len(plan.Pending) != 0 {
		t.Fatalf("already applied plan=%+v error=%v", plan, err)
	}
	var output bytes.Buffer
	if err := writeMigrationPlan(&output, plan); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), `"pending":[]`) || strings.Count(output.String(), "\n") != 1 {
		t.Fatalf("plan output not a single machine-readable line: %s", output.String())
	}
}

func TestMigrationPlanFailsClosedAndEmitsBlockers(t *testing.T) {
	tests := []struct {
		name    string
		applied map[string]bool
		ledger  bool
		version int
		want    string
	}{
		{"missing ledger", nil, false, 170007, "schema_migrations is missing"},
		{"unknown ledger version", map[string]bool{"unknown.sql": true}, true, 170007, "absent from this release"},
		{"unsupported postgres", nil, true, 160011, "PostgreSQL 17 or 18"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plan, err := buildMigrationPlan(nil, test.applied, test.ledger, test.version, []byte("[]"))
			if err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			if err := writeMigrationPlan(&output, plan); err == nil || plan.Ready {
				t.Fatalf("unsafe plan accepted: %+v", plan)
			}
			if !strings.Contains(output.String(), test.want) || !strings.HasPrefix(output.String(), "MANGORTS_MIGRATION_PLAN=") {
				t.Fatalf("blocker absent from machine-readable output: %s", output.String())
			}
		})
	}
}

func TestMigrationPlanRejectsManualApplicationBeforeWrites(t *testing.T) {
	targets := map[string]string{
		"20260903_process_steps.sql":                     "public.process_steps",
		"20260904_auth_claim_issue_watermark.sql":        "public.users.auth_claims_issued_at",
		"20260904_process_step_map_layouts.sql":          "public.process_step_map_revision_sequence",
		"20260905_attachment_pending_deletion_index.sql": "public.idx_attachments_pending_deletion",
		"20260905_process_step_sop_bodies.sql":           "public.logic_gate_textboxes_history.resource_type",
		"20260906_user_mailbox_access.sql":               "public.users.mailbox_enabled",
		"20260907_hermes_action_receipts.sql":            "public.ai_chats",
	}
	for version, target := range targets {
		t.Run(version, func(t *testing.T) {
			path := writeMigrationRunnerTestSQL(t, t.TempDir(), version, "select 1;")
			inventory, _ := json.Marshal([]schemaInventoryItem{{ObjectKind: "table", ObjectIdentity: target}})
			plan, err := buildMigrationPlan([]migrationFile{{Name: version, Path: path}}, nil, true, 170007, inventory)
			if err != nil || plan.Ready || !strings.Contains(strings.Join(plan.Blockers, " "), target+" already exists") {
				t.Fatalf("manual application plan=%+v error=%v", plan, err)
			}
		})
	}
}

func TestMigrationPlanRecognizesRetiredHermesHistory(t *testing.T) {
	files, err := listMigrationFiles("../../db/migrations")
	if err != nil {
		t.Fatal(err)
	}
	applied := map[string]bool{"20260907_hermes_action_receipts.sql": true}
	for _, file := range files {
		applied[file.Name] = true
	}
	plan, err := buildMigrationPlan(files, applied, true, 170007, []byte("[]"))
	if err != nil || !plan.Ready || len(plan.Pending) != 0 || len(plan.UnknownToRepository) != 0 {
		t.Fatalf("retired migration must remain recognized without replay: plan=%+v error=%v", plan, err)
	}
}

func TestMigrationPlanRejectsAnchorsAndHashesPortableBytes(t *testing.T) {
	for _, args := range [][]string{{"-mode", "plan", "-start-at", "x.sql"}, {"-mode", "plan", "-start-after", "x.sql"}, {"-mode", "plan", "-baseline-migrations"}} {
		if _, err := parseCommandConfig(args, testEnv(nil)); err == nil {
			t.Fatalf("plan accepted execution-only arguments %v", args)
		}
	}
	if cfg, err := parseCommandConfig([]string{"-mode", "plan"}, testEnv(nil)); err != nil || cfg.Mode != "plan" {
		t.Fatalf("plan config=%+v error=%v", cfg, err)
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "portable.sql")
	if err := os.WriteFile(path, []byte("\xef\xbb\xbfselect 1;\r\n"), 0600); err != nil {
		t.Fatal(err)
	}
	digest, err := normalizedFileDigest(path)
	if err != nil || digest != sha256.Sum256([]byte("select 1;\n")) {
		t.Fatalf("normalized digest=%x error=%v", digest, err)
	}
}
