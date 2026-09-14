package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
)

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
}

func buildMigrationPlan(files []migrationFile, applied map[string]bool, ledgerExists bool, serverVersion int, inventoryJSON []byte) (migrationPlan, error) {
	plan := migrationPlan{
		Kind: "mangorts_migration_plan", ServerVersionNum: serverVersion, LedgerExists: ledgerExists,
		Blockers: []string{}, Applied: []string{}, Pending: []plannedMigration{},
		UnknownToRepository: []string{},
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
	case "20260907_hermes_action_receipts.sql":
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
