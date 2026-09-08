package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
)

const hermesMigration = "20260907_hermes_action_receipts.sql"

type plannedMigration struct {
	Version string `json:"version"`
	SHA256  string `json:"sha256"`
}

type migrationPlan struct {
	Kind                   string             `json:"kind"`
	Ready                  bool               `json:"ready"`
	Blockers               []string           `json:"blockers"`
	ServerVersionNum       int                `json:"server_version_num"`
	LedgerExists           bool               `json:"ledger_exists"`
	RepositorySchemaSHA256 string             `json:"repository_schema_sha256"`
	SchemaInventorySHA256  string             `json:"schema_inventory_sha256"`
	Applied                []string           `json:"applied"`
	Pending                []plannedMigration `json:"pending"`
	UnknownToRepository    []string           `json:"unknown_to_repository"`
	HermesIdentity         string             `json:"hermes_identity"`
}

func buildMigrationPlan(files []migrationFile, applied map[string]bool, ledgerExists bool, serverVersion int, inventoryJSON []byte) (migrationPlan, error) {
	plan := migrationPlan{
		Kind: "mangorts_migration_plan", ServerVersionNum: serverVersion, LedgerExists: ledgerExists,
		Blockers: []string{}, Applied: []string{}, Pending: []plannedMigration{},
		UnknownToRepository: []string{}, HermesIdentity: "not_in_release",
	}
	items, err := decodeSchemaInventory(inventoryJSON)
	if err != nil {
		return plan, err
	}
	if !ledgerExists {
		plan.Blockers = append(plan.Blockers, "schema_migrations is missing; deployment cannot infer applied history or bootstrap an existing database")
	}
	if serverVersion < 170000 || serverVersion >= 190000 {
		plan.Blockers = append(plan.Blockers, "deployment migrations require PostgreSQL 17 or 18")
	}
	for name, recorded := range applied {
		if recorded {
			plan.Applied = append(plan.Applied, name)
		}
	}
	sort.Strings(plan.Applied)
	audit := classifyMigrationLedger(files, applied)
	plan.UnknownToRepository = append(plan.UnknownToRepository, audit.UnknownToRepo...)
	if len(plan.UnknownToRepository) > 0 {
		plan.Blockers = append(plan.Blockers, "migration ledger contains versions absent from this release")
	}
	pending, err := selectPendingMigrations(files, applied, "", "")
	if err != nil {
		return plan, err
	}
	if err := validateProcessMapLayoutMigrationAnchor(files, pending, applied); err != nil {
		plan.Blockers = append(plan.Blockers, err.Error())
	}
	for _, file := range pending {
		digest, err := normalizedFileDigest(file.Path)
		if err != nil {
			return plan, err
		}
		plan.Pending = append(plan.Pending, plannedMigration{Version: file.Name, SHA256: fmt.Sprintf("%x", digest)})
		plan.Blockers = append(plan.Blockers, pendingMigrationCatalogConflicts(file.Name, items)...)
	}
	if containsMigration(files, hermesMigration) {
		plan.HermesIdentity = hermesSchemaIdentity(items)
		if applied[hermesMigration] && plan.HermesIdentity != "current" {
			plan.Blockers = append(plan.Blockers, "Hermes migration is recorded but its scoped native identities are missing or conflicting")
		}
	}
	sort.Strings(plan.Blockers)
	plan.Ready = len(plan.Blockers) == 0
	return plan, nil
}

func writeMigrationPlan(output io.Writer, plan migrationPlan) error {
	raw, err := json.Marshal(plan)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(output, "MANGORTS_MIGRATION_PLAN=%s\n", raw); err != nil {
		return err
	}
	if !plan.Ready {
		return errors.New("migration plan blocked; inspect blockers before maintenance or any migration write")
	}
	return nil
}

// These shipped one-time migrations must not be replayed over manually-created
// targets. The migration scripts retain their transactional data checks; this
// catalog preflight catches known conflicts before taking QA offline.
func pendingMigrationCatalogConflicts(version string, items []schemaInventoryItem) []string {
	var targets []string
	switch version {
	case "20260903_process_steps.sql":
		targets = []string{"public.process_steps", "public.node_logic_gate_assignments.process_step_id"}
	case "20260904_auth_claim_issue_watermark.sql":
		targets = []string{"public.users.auth_claims_issued_at"}
	case "20260904_process_step_map_layouts.sql":
		targets = []string{"public.process_step_map_layouts", "public.process_step_map_revision_sequence", "public.trg_process_step_map_revision()", "public.trg_process_step_map_prune_step()", "public.trg_process_step_map_prune_route()"}
	case "20260905_attachment_pending_deletion_index.sql":
		targets = []string{"public.idx_attachments_pending_deletion"}
	case "20260905_process_step_sop_bodies.sql":
		targets = []string{"public.process_steps.body_json", "public.process_steps.revision", "public.logic_gate_textboxes_history.resource_type", "public.mangorts_enforce_process_step_editor_text_limit()"}
	case "20260906_user_mailbox_access.sql":
		targets = []string{"public.users.mailbox_enabled"}
	case hermesMigration:
		targets = []string{"public.ai_chats", "public.ai_runs", "public.ai_messages", "public.ai_actions"}
	}
	conflicts := []string{}
	for _, target := range targets {
		for _, item := range items {
			if item.ObjectIdentity == target && item.ObjectKind != "grant" {
				conflicts = append(conflicts, fmt.Sprintf("%s is unrecorded but %s already exists; review manual application or legacy identity without replaying or repairing its ledger automatically", version, target))
				break
			}
		}
	}
	return conflicts
}

// Match unordered column sets and native key types, never physical column order.
// This deliberately does not treat the removed inspection archive as Hermes.
func hermesSchemaIdentity(items []schemaInventoryItem) string {
	expected := map[string]map[string]string{
		"ai_chats":    {"company_id": "uuid", "user_id": "uuid", "chat_id": "text", "name": "text", "created_timestamp": "timestamp with time zone"},
		"ai_runs":     {"company_id": "uuid", "user_id": "uuid", "run_id": "uuid", "hermes_run_id": "text", "chat_id": "text", "status": "text", "pending_input": "text", "history": "jsonb", "created_timestamp": "timestamp with time zone"},
		"ai_messages": {"company_id": "uuid", "user_id": "uuid", "message_id": "bigint", "chat_id": "text", "run_id": "uuid", "role": "text", "content": "text", "created_timestamp": "timestamp with time zone"},
		"ai_actions":  {"company_id": "uuid", "user_id": "uuid", "run_id": "uuid", "action_name": "text", "action_key": "text", "result": "jsonb"},
	}
	primaryKeys := map[string]string{
		"ai_chats":    "PRIMARY KEY (company_id, user_id, chat_id)",
		"ai_runs":     "PRIMARY KEY (company_id, user_id, run_id)",
		"ai_messages": "PRIMARY KEY (company_id, user_id, message_id)",
		"ai_actions":  "PRIMARY KEY (company_id, user_id, run_id, action_name, action_key)",
	}
	foundTables := 0
	matchedTables := 0
	for table, columns := range expected {
		found, primaryKey := false, false
		columnCount := 0
		valid := true
		for _, item := range items {
			definition, _ := item.Definition.(map[string]any)
			if item.ObjectIdentity == "public."+table && item.ObjectKind != "grant" {
				found = true
				valid = valid && item.ObjectKind == "table" && definition["relation_type"] == "table"
			}
			if !strings.HasPrefix(item.ObjectIdentity, "public."+table+".") {
				continue
			}
			if item.ObjectKind == "column" {
				columnCount++
				name := strings.TrimPrefix(item.ObjectIdentity, "public."+table+".")
				columnType, exists := columns[name]
				valid = valid && exists && definition["data_type"] == columnType
			}
			if item.ObjectKind == "constraint" && definition["constraint_type"] == "primary_key" {
				primaryKey = definition["definition"] == primaryKeys[table]
			}
		}
		if found {
			foundTables++
		}
		if found && valid && primaryKey && columnCount == len(columns) {
			matchedTables++
		}
	}
	if foundTables == 0 {
		return "absent"
	}
	if matchedTables == len(expected) {
		return "current"
	}
	return "conflicting"
}
