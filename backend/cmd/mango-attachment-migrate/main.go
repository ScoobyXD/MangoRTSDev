package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"miraeopus/backend/internal/attachments/migration"
	httpapi "miraeopus/backend/internal/http"
	"miraeopus/backend/internal/store"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

const applyConfirmation = "MIGRATE_INLINE_ATTACHMENTS"

type commandConfig struct {
	Apply             bool
	ConfirmApply      string
	CompanyID         string
	SourceScope       string
	Limit             int
	LargePayloadBytes int
	ReportPath        string
}

type dbConfig struct {
	Host                  string
	Port                  string
	User                  string
	Password              string
	Name                  string
	SSLMode               string
	ConnectTimeoutSeconds int
}

type envLookup func(string) string

type candidateSource struct {
	Table  string
	Column string
	Query  string
}

type candidateRow struct {
	Location migration.PayloadLocation
	Payload  string
}

type report struct {
	GeneratedAt        time.Time              `json:"generated_at"`
	DryRun             bool                   `json:"dry_run"`
	Apply              bool                   `json:"apply"`
	CompanyID          string                 `json:"company_id,omitempty"`
	SourceScope        string                 `json:"source_scope,omitempty"`
	LargePayloadBytes  int                    `json:"large_payload_bytes"`
	ScannedRows        int                    `json:"scanned_rows"`
	AffectedRows       int                    `json:"affected_rows"`
	EmbeddedFileCount  int                    `json:"embedded_file_count"`
	EstimatedBytes     int64                  `json:"estimated_decoded_bytes"`
	SkippedApplyRows   int                    `json:"skipped_apply_rows,omitempty"`
	MigratedRows       int                    `json:"migrated_rows,omitempty"`
	MigratedFiles      int                    `json:"migrated_files,omitempty"`
	Results            []migration.ScanResult `json:"results"`
	RemainingLiveSteps []string               `json:"remaining_live_steps,omitempty"`
}

func main() {
	if err := run(context.Background(), os.Args[1:], os.Getenv, os.Stdout); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context, args []string, getenv envLookup, stdout io.Writer) error {
	cfg, err := parseCommandConfig(args, getenv)
	if err != nil {
		return err
	}
	if cfg.Apply {
		if cfg.ConfirmApply != applyConfirmation {
			return fmt.Errorf("-apply requires -confirm-apply=%s", applyConfirmation)
		}
		if strings.TrimSpace(cfg.CompanyID) == "" {
			return errors.New("-apply requires -company-id so the audit run is scoped to one company")
		}
	}
	dbCfg, err := parseDBConfig(getenv)
	if err != nil {
		return err
	}
	db, err := openDB(dbCfg)
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(5 * time.Minute)

	rows, err := collectCandidateRows(ctx, db, cfg)
	if err != nil {
		return err
	}
	rep := buildReport(cfg, rows)
	if cfg.Apply {
		storage := httpapi.NewS3AttachmentStorageFromEnv()
		if storage == nil {
			return errors.New("apply mode requires MANGORTS_ATTACHMENT_S3_BUCKET and attachment AWS region configuration")
		}
		if err := applyReport(ctx, db, storage, cfg, &rep); err != nil {
			return err
		}
	} else {
		rep.RemainingLiveSteps = []string{
			"Review this dry-run report with Jonat before any live data operation.",
			"Run scripts/verify_agent_db_access_boundary.py in the exact apply session before using -apply.",
			"Run apply only from a physically scoped, approved session with attachment S3 access and a company-id.",
			"After apply, verify migrated rows no longer contain inline file bytes and that S3 objects/resource links exist.",
		}
	}
	return writeReport(rep, cfg.ReportPath, stdout)
}

func parseCommandConfig(args []string, getenv envLookup) (commandConfig, error) {
	flags := flag.NewFlagSet("mango-attachment-migrate", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	cfg := commandConfig{
		CompanyID:         strings.TrimSpace(getenv("MANGORTS_ATTACHMENT_MIGRATION_COMPANY_ID")),
		Limit:             envIntDefault(getenv, "MANGORTS_ATTACHMENT_MIGRATION_LIMIT", 1000),
		LargePayloadBytes: envIntDefault(getenv, "MANGORTS_ATTACHMENT_MIGRATION_LARGE_BYTES", migration.DefaultLargePayloadBytes),
	}
	flags.BoolVar(&cfg.Apply, "apply", false, "rewrite rows and upload/create attachment records; defaults to dry-run report only")
	flags.StringVar(&cfg.ConfirmApply, "confirm-apply", "", "must equal "+applyConfirmation+" when -apply is used")
	flags.StringVar(&cfg.CompanyID, "company-id", cfg.CompanyID, "optional dry-run company filter; required for apply")
	flags.StringVar(&cfg.SourceScope, "source-scope", "", "optional source table filter")
	flags.IntVar(&cfg.Limit, "limit", cfg.Limit, "max candidate rows per source")
	flags.IntVar(&cfg.LargePayloadBytes, "large-payload-bytes", cfg.LargePayloadBytes, "payload byte threshold included in the inventory")
	flags.StringVar(&cfg.ReportPath, "report", "", "optional JSON report output path")
	if err := flags.Parse(args); err != nil {
		return commandConfig{}, err
	}
	if flags.NArg() != 0 {
		return commandConfig{}, fmt.Errorf("unexpected positional arguments: %s", strings.Join(flags.Args(), " "))
	}
	cfg.CompanyID = strings.TrimSpace(cfg.CompanyID)
	cfg.SourceScope = strings.TrimSpace(cfg.SourceScope)
	if cfg.Limit <= 0 {
		cfg.Limit = 1000
	}
	if cfg.LargePayloadBytes <= 0 {
		cfg.LargePayloadBytes = migration.DefaultLargePayloadBytes
	}
	return cfg, nil
}

func parseDBConfig(getenv envLookup) (dbConfig, error) {
	cfg := dbConfig{
		Host:                  strings.TrimPrefix(strings.TrimSpace(getenv("DB_HOST")), "host="),
		Port:                  getenvDefault(getenv, "DB_PORT", "5432"),
		User:                  getenvDefault(getenv, "DB_USER", "postgres"),
		Password:              getenv("DB_PASSWORD"),
		Name:                  getenvDefault(getenv, "DB_NAME", "postgres"),
		SSLMode:               getenvDefault(getenv, "DB_SSLMODE", "require"),
		ConnectTimeoutSeconds: envIntDefault(getenv, "DB_CONNECT_TIMEOUT_SECONDS", 5),
	}
	var missing []string
	if cfg.Host == "" {
		missing = append(missing, "DB_HOST")
	}
	if strings.TrimSpace(cfg.Password) == "" {
		missing = append(missing, "DB_PASSWORD")
	}
	if len(missing) > 0 {
		return dbConfig{}, fmt.Errorf("missing required database environment variables: %s", strings.Join(missing, ", "))
	}
	return cfg, nil
}

func openDB(cfg dbConfig) (*sql.DB, error) {
	connConfig, err := pgx.ParseConfig(buildConnString(cfg))
	if err != nil {
		return nil, fmt.Errorf("parse postgres connection config: %w", err)
	}
	connConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	return stdlib.OpenDB(*connConfig), nil
}

func buildConnString(cfg dbConfig) string {
	query := url.Values{}
	query.Set("sslmode", cfg.SSLMode)
	query.Set("connect_timeout", strconv.Itoa(cfg.ConnectTimeoutSeconds))
	u := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(cfg.User, cfg.Password),
		Host:     net.JoinHostPort(cfg.Host, cfg.Port),
		Path:     "/" + cfg.Name,
		RawQuery: query.Encode(),
	}
	return u.String()
}

func collectCandidateRows(ctx context.Context, db *sql.DB, cfg commandConfig) ([]candidateRow, error) {
	items := make([]candidateRow, 0)
	for _, source := range candidateSources() {
		if cfg.SourceScope != "" && !strings.EqualFold(cfg.SourceScope, source.Table) {
			continue
		}
		rows, err := db.QueryContext(ctx, source.Query, cfg.CompanyID, cfg.Limit, cfg.LargePayloadBytes)
		if err != nil {
			return nil, fmt.Errorf("query %s.%s: %w", source.Table, source.Column, err)
		}
		for rows.Next() {
			var item candidateRow
			item.Location.Table = source.Table
			item.Location.Column = source.Column
			if err := rows.Scan(
				&item.Location.SourcePK,
				&item.Location.CompanyID,
				&item.Location.ResourceType,
				&item.Location.ResourceID,
				&item.Location.InformationID,
				&item.Location.MessageID,
				&item.Payload,
			); err != nil {
				rows.Close()
				return nil, fmt.Errorf("scan %s.%s: %w", source.Table, source.Column, err)
			}
			if item.Location.ResourceType == "attached_email" {
				item.Location.ResourceID = attachedEmailMigrationResourceID(item.Location.ResourceID, item.Location.MessageID)
			}
			items = append(items, item)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("read %s.%s: %w", source.Table, source.Column, err)
		}
		rows.Close()
	}
	return items, nil
}

func buildReport(cfg commandConfig, rows []candidateRow) report {
	rep := report{
		GeneratedAt:       time.Now().UTC(),
		DryRun:            !cfg.Apply,
		Apply:             cfg.Apply,
		CompanyID:         cfg.CompanyID,
		SourceScope:       cfg.SourceScope,
		LargePayloadBytes: cfg.LargePayloadBytes,
		ScannedRows:       len(rows),
		Results:           make([]migration.ScanResult, 0, len(rows)),
	}
	for _, row := range rows {
		result := migration.ScanPayload(row.Location, row.Payload, migration.ScanOptions{LargePayloadBytes: cfg.LargePayloadBytes})
		if !result.LargePayload && len(result.EmbeddedFiles) == 0 && len(result.Signals) == 0 {
			continue
		}
		if result.LargePayload || len(result.EmbeddedFiles) > 0 {
			rep.AffectedRows++
		}
		for _, file := range result.EmbeddedFiles {
			rep.EmbeddedFileCount++
			rep.EstimatedBytes += file.DecodedBytes
		}
		rep.Results = append(rep.Results, result)
	}
	return rep
}

func applyReport(ctx context.Context, db *sql.DB, storage httpapi.AttachmentObjectStorage, cfg commandConfig, rep *report) error {
	repo := store.NewPostgresRepo(db)
	runID := newUUIDv4String()
	if _, err := db.ExecContext(ctx, `
insert into attachment_migration_runs (
  migration_run_id, company_id, status, dry_run, source_scope, summary, started_timestamp
) values ($1::uuid, $2::uuid, 'running', false, $3, '{}'::jsonb, now())`,
		runID, cfg.CompanyID, cfg.SourceScope); err != nil {
		return fmt.Errorf("create migration run: %w", err)
	}
	failed := true
	defer func() {
		if failed {
			_, _ = db.ExecContext(context.Background(), `update attachment_migration_runs set status='failed', completed_timestamp=now() where migration_run_id=$1::uuid`, runID)
		}
	}()
	for _, result := range rep.Results {
		if strings.TrimSpace(result.Location.CompanyID) == "" || result.Location.CompanyID != cfg.CompanyID || len(result.EmbeddedFiles) == 0 {
			rep.SkippedApplyRows++
			continue
		}
		if result.RewrittenPayload == "" {
			rep.SkippedApplyRows++
			continue
		}
		for _, file := range result.EmbeddedFiles {
			if file.DecodeError != "" || file.AttachmentID == "" || file.StorageKey == "" {
				rep.SkippedApplyRows++
				continue
			}
			body := file.DecodedByteData()
			if err := storage.PutObject(ctx, httpapi.AttachmentPutObjectInput{
				Key:           file.StorageKey,
				ContentType:   file.MimeType,
				ContentLength: int64(len(body)),
				SHA256:        file.SHA256,
				Body:          bytes.NewReader(body),
			}); err != nil {
				return fmt.Errorf("put attachment object %s: %w", file.AttachmentID, err)
			}
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		for _, file := range result.EmbeddedFiles {
			if file.DecodeError != "" || file.AttachmentID == "" || file.StorageKey == "" {
				continue
			}
			if err := upsertMigratedAttachment(ctx, tx, storage.Bucket(), result.Location, file); err != nil {
				tx.Rollback()
				return err
			}
			if err := insertMigrationItem(ctx, tx, runID, result.Location, file); err != nil {
				tx.Rollback()
				return err
			}
			rep.MigratedFiles++
		}
		if err := updateSourcePayload(ctx, tx, result.Location, result.RewrittenPayload); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		for _, file := range result.EmbeddedFiles {
			if file.DecodeError != "" || file.AttachmentID == "" {
				continue
			}
			attachment, loadErr := repo.GetAttachment(cfg.CompanyID, file.AttachmentID)
			if loadErr != nil {
				log.Printf("attachment_migration_variants status=skipped attachment_id=%s reason=metadata_load_failed", file.AttachmentID)
				continue
			}
			if _, variantErr := httpapi.EnsureAttachmentImageVariants(ctx, repo, storage, attachment); variantErr != nil {
				reason := strings.ReplaceAll(strings.TrimSpace(variantErr.Error()), "\n", " ")
				if len(reason) > 120 {
					reason = reason[:120]
				}
				log.Printf("attachment_migration_variants status=skipped attachment_id=%s reason=%q", file.AttachmentID, reason)
			}
		}
		rep.MigratedRows++
	}
	summary, _ := json.Marshal(map[string]any{
		"scanned_rows":            rep.ScannedRows,
		"affected_rows":           rep.AffectedRows,
		"embedded_file_count":     rep.EmbeddedFileCount,
		"estimated_decoded_bytes": rep.EstimatedBytes,
		"migrated_rows":           rep.MigratedRows,
		"migrated_files":          rep.MigratedFiles,
		"skipped_apply_rows":      rep.SkippedApplyRows,
	})
	if _, err := db.ExecContext(ctx, `
update attachment_migration_runs
set status='completed', summary=$2::jsonb, completed_timestamp=now()
where migration_run_id=$1::uuid`, runID, string(summary)); err != nil {
		return fmt.Errorf("complete migration run: %w", err)
	}
	failed = false
	return nil
}

func upsertMigratedAttachment(ctx context.Context, tx *sql.Tx, bucket string, location migration.PayloadLocation, file migration.EmbeddedFile) error {
	if _, err := tx.ExecContext(ctx, `
insert into attachments (
  company_id, attachment_id, original_filename, mime_type, byte_size, sha256, storage_bucket, storage_key, source_kind, source_provider, created_timestamp
) values (
  $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, 'migration_inline_image', 'mango-attachment-migrate', now()
)
on conflict (company_id, attachment_id) do nothing`,
		location.CompanyID,
		file.AttachmentID,
		file.Filename,
		file.MimeType,
		file.DecodedBytes,
		file.SHA256,
		bucket,
		file.StorageKey,
	); err != nil {
		return fmt.Errorf("upsert attachment %s: %w", file.AttachmentID, err)
	}
	linkID := deterministicUUID("resource-link", location.CompanyID, location.ResourceType, location.ResourceID, file.AttachmentID, location.InformationID, location.MessageID)
	if _, err := tx.ExecContext(ctx, `
insert into resource_attachments (
  resource_attachment_id, company_id, resource_type, resource_id, attachment_id, information_id, message_id, relationship_kind, created_timestamp
) values (
  $1::uuid, $2::uuid, $3, $4, $5::uuid, nullif($6, '')::uuid, $7, 'migrated_inline_image', now()
)
on conflict do nothing`,
		linkID,
		location.CompanyID,
		location.ResourceType,
		location.ResourceID,
		file.AttachmentID,
		location.InformationID,
		location.MessageID,
	); err != nil {
		return fmt.Errorf("upsert resource attachment %s: %w", file.AttachmentID, err)
	}
	return nil
}

func insertMigrationItem(ctx context.Context, tx *sql.Tx, runID string, location migration.PayloadLocation, file migration.EmbeddedFile) error {
	itemID := deterministicUUID("migration-item", runID, location.Table, location.SourcePK, file.SHA256, strconv.Itoa(file.Occurrence))
	if _, err := tx.ExecContext(ctx, `
insert into attachment_migration_items (
  migration_item_id, migration_run_id, company_id, source_table, source_pk, resource_type, resource_id,
  information_id, message_id, attachment_id, embedded_sha256, status, created_timestamp, updated_timestamp
) values (
  $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, nullif($8, '')::uuid, $9, $10::uuid, $11, 'migrated', now(), now()
)
on conflict (migration_item_id) do nothing`,
		itemID,
		runID,
		location.CompanyID,
		location.Table,
		location.SourcePK,
		location.ResourceType,
		location.ResourceID,
		location.InformationID,
		location.MessageID,
		file.AttachmentID,
		file.SHA256,
	); err != nil {
		return fmt.Errorf("record migration item %s: %w", file.AttachmentID, err)
	}
	return nil
}

func updateSourcePayload(ctx context.Context, tx *sql.Tx, location migration.PayloadLocation, payload string) error {
	parts := strings.Split(location.SourcePK, "|")
	switch location.Table {
	case "node_projection_table":
		if len(parts) != 3 {
			return fmt.Errorf("invalid source pk for %s: %s", location.Table, location.SourcePK)
		}
		_, err := tx.ExecContext(ctx, `update node_projection_table set information=$4, updated_timestamp=now() where company_id=$1::uuid and node_id=$2::uuid and information_id=$3::uuid`, parts[0], parts[1], parts[2], payload)
		return err
	case "node_information":
		if len(parts) != 2 {
			return fmt.Errorf("invalid source pk for %s: %s", location.Table, location.SourcePK)
		}
		_, err := tx.ExecContext(ctx, `update node_information set information=$3, updated_timestamp=now() where company_id=$1::uuid and information_id=$2::uuid`, parts[0], parts[1], payload)
		return err
	case "node_projection_seen_snapshots":
		if len(parts) != 4 {
			return fmt.Errorf("invalid source pk for %s: %s", location.Table, location.SourcePK)
		}
		_, err := tx.ExecContext(ctx, `update node_projection_seen_snapshots set information=$5, seen_timestamp=now() where company_id=$1::uuid and node_id=$2::uuid and information_id=$3::uuid and user_id=$4::uuid`, parts[0], parts[1], parts[2], parts[3], payload)
		return err
	case "node_content_changes":
		if len(parts) != 2 {
			return fmt.Errorf("invalid source pk for %s: %s", location.Table, location.SourcePK)
		}
		_, err := tx.ExecContext(ctx, `update node_content_changes set text=$3 where company_id=$1::uuid and change_id=$2::uuid`, parts[0], parts[1], payload)
		return err
	case "logic_gate_projection_table":
		if len(parts) != 3 {
			return fmt.Errorf("invalid source pk for %s: %s", location.Table, location.SourcePK)
		}
		_, err := tx.ExecContext(ctx, `update logic_gate_projection_table set information=$4, updated_timestamp=now() where company_id=$1::uuid and logic_gate_id=$2::uuid and information_id=$3::uuid`, parts[0], parts[1], parts[2], payload)
		return err
	case "logic_gate_information":
		if len(parts) != 2 {
			return fmt.Errorf("invalid source pk for %s: %s", location.Table, location.SourcePK)
		}
		_, err := tx.ExecContext(ctx, `update logic_gate_information set information=$3, updated_timestamp=now() where company_id=$1::uuid and information_id=$2::uuid`, parts[0], parts[1], payload)
		return err
	case "project_projection_table":
		if len(parts) != 3 {
			return fmt.Errorf("invalid source pk for %s: %s", location.Table, location.SourcePK)
		}
		_, err := tx.ExecContext(ctx, `update project_projection_table set information=$4, updated_timestamp=now() where company_id=$1::uuid and project_id=$2::uuid and information_id=$3::uuid`, parts[0], parts[1], parts[2], payload)
		return err
	case "project_information":
		if len(parts) != 2 {
			return fmt.Errorf("invalid source pk for %s: %s", location.Table, location.SourcePK)
		}
		_, err := tx.ExecContext(ctx, `update project_information set information=$3, updated_timestamp=now() where company_id=$1::uuid and information_id=$2::uuid`, parts[0], parts[1], payload)
		return err
	case "communications_email_nodes":
		if len(parts) != 2 {
			return fmt.Errorf("invalid source pk for %s: %s", location.Table, location.SourcePK)
		}
		_, err := tx.ExecContext(ctx, `update communications_email_nodes set message=$3::jsonb, updated_timestamp=now() where company_id=$1::uuid and node_id=$2::uuid`, parts[0], parts[1], payload)
		return err
	case "communications_email_node_attachments":
		if len(parts) != 4 {
			return fmt.Errorf("invalid source pk for %s: %s", location.Table, location.SourcePK)
		}
		_, err := tx.ExecContext(ctx, `update communications_email_node_attachments set message=$5::jsonb, updated_timestamp=now() where company_id=$1::uuid and user_id=$2::uuid and message_id=$3 and node_id=$4::uuid`, parts[0], parts[1], parts[2], parts[3], payload)
		return err
	default:
		return fmt.Errorf("apply is not supported for source table %s", location.Table)
	}
}

func writeReport(rep report, reportPath string, stdout io.Writer) error {
	raw, err := json.MarshalIndent(rep, "", "  ")
	if err != nil {
		return err
	}
	if strings.TrimSpace(reportPath) != "" {
		if err := os.WriteFile(reportPath, append(raw, '\n'), 0o600); err != nil {
			return err
		}
	}
	_, err = stdout.Write(append(raw, '\n'))
	return err
}

func candidateSources() []candidateSource {
	const textPredicate = `(
  %s ilike '%%data:image/%%'
  or %s ilike '%%data:application/%%'
  or %s ilike '%%base64,%%'
  or %s ilike '%%dataURL%%'
  or %s ilike '%%data_url%%'
  or length(%s) >= $3
)`
	pred := func(column string) string {
		return fmt.Sprintf(textPredicate, column, column, column, column, column, column)
	}
	return []candidateSource{
		{
			Table:  "node_projection_table",
			Column: "information",
			Query: `select company_id::text || '|' || node_id::text || '|' || information_id::text,
       company_id::text, 'node', node_id::text, information_id::text, '', information
from node_projection_table
where (nullif($1, '')::uuid is null or company_id=nullif($1, '')::uuid)
  and ` + pred("information") + `
order by updated_timestamp desc
limit $2`,
		},
		{
			Table:  "node_information",
			Column: "information",
			Query: `select company_id::text || '|' || information_id::text,
       company_id::text, 'node', node_id::text, information_id::text, '', information
from node_information
where (nullif($1, '')::uuid is null or company_id=nullif($1, '')::uuid)
  and ` + pred("information") + `
order by updated_timestamp desc
limit $2`,
		},
		{
			Table:  "node_projection_seen_snapshots",
			Column: "information",
			Query: `select company_id::text || '|' || node_id::text || '|' || information_id::text || '|' || user_id::text,
       company_id::text, 'node', node_id::text, information_id::text, '', information
from node_projection_seen_snapshots
where (nullif($1, '')::uuid is null or company_id=nullif($1, '')::uuid)
  and ` + pred("information") + `
order by seen_timestamp desc
limit $2`,
		},
		{
			Table:  "node_content_changes",
			Column: "text",
			Query: `select company_id::text || '|' || change_id::text,
       company_id::text, 'node', node_id::text, information_id::text, '', text
from node_content_changes
where (nullif($1, '')::uuid is null or company_id=nullif($1, '')::uuid)
  and ` + pred("text") + `
order by created_timestamp desc
limit $2`,
		},
		{
			Table:  "logic_gate_projection_table",
			Column: "information",
			Query: `select company_id::text || '|' || logic_gate_id::text || '|' || information_id::text,
       company_id::text, 'logic_gate', logic_gate_id::text, information_id::text, '', information
from logic_gate_projection_table
where (nullif($1, '')::uuid is null or company_id=nullif($1, '')::uuid)
  and ` + pred("information") + `
order by updated_timestamp desc
limit $2`,
		},
		{
			Table:  "logic_gate_information",
			Column: "information",
			Query: `select company_id::text || '|' || information_id::text,
       company_id::text, 'logic_gate', logic_gate_id::text, information_id::text, '', information
from logic_gate_information
where (nullif($1, '')::uuid is null or company_id=nullif($1, '')::uuid)
  and ` + pred("information") + `
order by updated_timestamp desc
limit $2`,
		},
		{
			Table:  "project_projection_table",
			Column: "information",
			Query: `select company_id::text || '|' || project_id::text || '|' || information_id::text,
       company_id::text, 'project', project_id::text, information_id::text, '', information
from project_projection_table
where (nullif($1, '')::uuid is null or company_id=nullif($1, '')::uuid)
  and ` + pred("information") + `
order by updated_timestamp desc
limit $2`,
		},
		{
			Table:  "project_information",
			Column: "information",
			Query: `select company_id::text || '|' || information_id::text,
       company_id::text, 'project', project_id::text, information_id::text, '', information
from project_information
where (nullif($1, '')::uuid is null or company_id=nullif($1, '')::uuid)
  and ` + pred("information") + `
order by updated_timestamp desc
limit $2`,
		},
		{
			Table:  "communications_email_nodes",
			Column: "message",
			Query: `select company_id::text || '|' || node_id::text,
       company_id::text, 'node', node_id::text, '', message_id, message::text
from communications_email_nodes
where (nullif($1, '')::uuid is null or company_id=nullif($1, '')::uuid)
  and ` + pred("message::text") + `
order by updated_timestamp desc
limit $2`,
		},
		{
			Table:  "communications_email_node_attachments",
			Column: "message",
			Query: `select company_id::text || '|' || user_id::text || '|' || message_id || '|' || node_id::text,
       company_id::text, 'attached_email', node_id::text, '', message_id, message::text
from communications_email_node_attachments
where (nullif($1, '')::uuid is null or company_id=nullif($1, '')::uuid)
  and ` + pred("message::text") + `
order by updated_timestamp desc
limit $2`,
		},
		{
			Table:  "communications_triage_items",
			Column: "message",
			Query: `select user_id::text || '|' || message_id,
       '', 'email_message', message_id, '', message_id, message::text
from communications_triage_items
where nullif($1, '') is null
  and ` + pred("message::text") + `
order by updated_timestamp desc
limit $2`,
		},
	}
}

func attachedEmailMigrationResourceID(nodeID, messageID string) string {
	nodeID = strings.TrimSpace(nodeID)
	messageID = strings.TrimSpace(messageID)
	if nodeID == "" || messageID == "" {
		return nodeID
	}
	return "node:" + url.QueryEscape(nodeID) + ":message:" + url.QueryEscape(messageID)
}

func deterministicUUID(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	bytes := append([]byte(nil), sum[:16]...)
	bytes[6] = (bytes[6] & 0x0f) | 0x50
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16])
}

func newUUIDv4String() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		sum := sha256.Sum256([]byte(time.Now().UTC().Format(time.RFC3339Nano)))
		copy(bytes[:], sum[:16])
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(bytes[0:4]),
		hex.EncodeToString(bytes[4:6]),
		hex.EncodeToString(bytes[6:8]),
		hex.EncodeToString(bytes[8:10]),
		hex.EncodeToString(bytes[10:16]),
	)
}

func getenvDefault(getenv envLookup, key, fallback string) string {
	value := strings.TrimSpace(getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func envIntDefault(getenv envLookup, key string, fallback int) int {
	raw := strings.TrimSpace(getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
