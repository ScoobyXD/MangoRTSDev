package main

import (
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
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

const (
	applyConfirmation        = "COMPACT_DEV_NODE_INFORMATION"
	defaultLargePayloadBytes = 1 << 20
	defaultSavedByLabel      = "Dev history compaction"
)

var uuidTextPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type commandConfig struct {
	Apply             bool
	ConfirmApply      string
	CompanyID         string
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

type report struct {
	GeneratedAt                 time.Time          `json:"generated_at"`
	DryRun                      bool               `json:"dry_run"`
	Apply                       bool               `json:"apply"`
	CompanyID                   string             `json:"company_id"`
	LargePayloadBytes           int                `json:"large_payload_bytes"`
	Before                      compactionSnapshot `json:"before"`
	After                       compactionSnapshot `json:"after"`
	AfterEstimated              bool               `json:"after_estimated"`
	DeletedNodeInformationRows  int64              `json:"deleted_node_information_rows,omitempty"`
	DeletedSeenSnapshotRows     int64              `json:"deleted_node_projection_seen_snapshot_rows,omitempty"`
	InsertedNodeInformationRows int64              `json:"inserted_node_information_rows,omitempty"`
	Warnings                    []string           `json:"warnings,omitempty"`
	RemainingLiveSteps          []string           `json:"remaining_live_steps,omitempty"`
}

type compactionSnapshot struct {
	NodeInformation             tableStats `json:"node_information"`
	NodeProjectionSeenSnapshots tableStats `json:"node_projection_seen_snapshots"`
	NodeProjectionTable         tableStats `json:"node_projection_table"`
	NodeProjectionTextBoxes     tableStats `json:"node_projection_text_boxes"`
	TextBoxProjectionNodeCount  int64      `json:"text_box_projection_node_count"`
}

type tableStats struct {
	RowCount         int64 `json:"row_count"`
	TextBytes        int64 `json:"text_bytes"`
	InlineSignalRows int64 `json:"inline_signal_rows"`
	LargePayloadRows int64 `json:"large_payload_rows"`
}

type projectionRow struct {
	NodeID        string
	InformationID string
	Type          string
	Information   string
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
	if cfg.Apply && cfg.ConfirmApply != applyConfirmation {
		return fmt.Errorf("-apply requires -confirm-apply=%s", applyConfirmation)
	}

	dbCfg, err := parseDBConfig(getenv)
	if err != nil {
		return err
	}
	if reasons := prodLikeTargetReasons(dbCfg, getenv); len(reasons) > 0 {
		return fmt.Errorf("refusing dev-only node history compaction for prod-like target: %s", strings.Join(reasons, ", "))
	}

	db, err := openDB(dbCfg)
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(5 * time.Minute)

	before, err := collectSnapshot(ctx, db, cfg)
	if err != nil {
		return err
	}

	rep := buildDryRunReport(cfg, before)
	if cfg.Apply {
		if err := validateApplySnapshot(before); err != nil {
			return err
		}
		if err := applyCompaction(ctx, db, cfg, &rep); err != nil {
			return err
		}
	}

	return writeReport(rep, cfg.ReportPath, stdout)
}

func parseCommandConfig(args []string, getenv envLookup) (commandConfig, error) {
	flags := flag.NewFlagSet("compact-node-information-from-projections", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	cfg := commandConfig{
		CompanyID:         strings.TrimSpace(getenv("MANGORTS_NODE_HISTORY_COMPACTION_COMPANY_ID")),
		LargePayloadBytes: envIntDefault(getenv, "MANGORTS_NODE_HISTORY_COMPACTION_LARGE_BYTES", defaultLargePayloadBytes),
	}
	flags.BoolVar(&cfg.Apply, "apply", false, "delete/recreate dev node history rows; defaults to dry-run report only")
	flags.StringVar(&cfg.ConfirmApply, "confirm-apply", "", "must equal "+applyConfirmation+" when -apply is used")
	flags.StringVar(&cfg.CompanyID, "company-id", cfg.CompanyID, "required target company id")
	flags.IntVar(&cfg.LargePayloadBytes, "large-payload-bytes", cfg.LargePayloadBytes, "payload byte threshold included in the report")
	flags.StringVar(&cfg.ReportPath, "report", "", "optional JSON report output path")
	if err := flags.Parse(args); err != nil {
		return commandConfig{}, err
	}
	if flags.NArg() != 0 {
		return commandConfig{}, fmt.Errorf("unexpected positional arguments: %s", strings.Join(flags.Args(), " "))
	}
	cfg.CompanyID = strings.TrimSpace(cfg.CompanyID)
	cfg.ConfirmApply = strings.TrimSpace(cfg.ConfirmApply)
	if cfg.CompanyID == "" {
		return commandConfig{}, errors.New("-company-id is required")
	}
	if !uuidTextPattern.MatchString(cfg.CompanyID) {
		return commandConfig{}, fmt.Errorf("-company-id must be a UUID, got %q", cfg.CompanyID)
	}
	if cfg.LargePayloadBytes <= 0 {
		cfg.LargePayloadBytes = defaultLargePayloadBytes
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

func prodLikeTargetReasons(cfg dbConfig, getenv envLookup) []string {
	checks := map[string]string{
		"APP_ENV":        getenv("APP_ENV"),
		"MANGORTS_ENV":   getenv("MANGORTS_ENV"),
		"MANGORTS_STAGE": getenv("MANGORTS_STAGE"),
		"DB_NAME":        cfg.Name,
		"DB_HOST":        cfg.Host,
	}
	reasons := make([]string, 0)
	for key, value := range checks {
		normalized := strings.ToLower(strings.TrimSpace(value))
		if normalized == "" {
			continue
		}
		if normalized == "prod" || normalized == "production" || strings.Contains(normalized, "prod.") || strings.Contains(normalized, "prod-") || strings.Contains(normalized, "-prod") || strings.Contains(normalized, "_prod") || strings.Contains(normalized, "production") {
			reasons = append(reasons, key)
		}
	}
	return reasons
}

func collectSnapshot(ctx context.Context, db queryer, cfg commandConfig) (compactionSnapshot, error) {
	var snapshot compactionSnapshot
	var err error
	if snapshot.NodeInformation, err = collectTableStats(ctx, db, `node_information`, ``, cfg); err != nil {
		return compactionSnapshot{}, err
	}
	if snapshot.NodeProjectionSeenSnapshots, err = collectTableStats(ctx, db, `node_projection_seen_snapshots`, ``, cfg); err != nil {
		return compactionSnapshot{}, err
	}
	if snapshot.NodeProjectionTable, err = collectTableStats(ctx, db, `node_projection_table`, ``, cfg); err != nil {
		return compactionSnapshot{}, err
	}
	if snapshot.NodeProjectionTextBoxes, err = collectTableStats(ctx, db, `node_projection_table`, `and type='Text box'::information_type`, cfg); err != nil {
		return compactionSnapshot{}, err
	}
	if err := db.QueryRowContext(ctx, `
select count(distinct node_id)
  from node_projection_table
 where company_id=$1::uuid
   and type='Text box'::information_type`, cfg.CompanyID).Scan(&snapshot.TextBoxProjectionNodeCount); err != nil {
		return compactionSnapshot{}, fmt.Errorf("count text-box projection nodes: %w", err)
	}
	return snapshot, nil
}

type queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func collectTableStats(ctx context.Context, db queryer, table, extraPredicate string, cfg commandConfig) (tableStats, error) {
	query := fmt.Sprintf(`
select count(*),
       coalesce(sum(octet_length(information)), 0),
       count(*) filter (where %s),
       count(*) filter (where octet_length(information) >= $2)
  from %s
 where company_id=$1::uuid
 %s`, inlineSignalPredicate("information"), table, extraPredicate)
	var stats tableStats
	if err := db.QueryRowContext(ctx, query, cfg.CompanyID, cfg.LargePayloadBytes).Scan(
		&stats.RowCount,
		&stats.TextBytes,
		&stats.InlineSignalRows,
		&stats.LargePayloadRows,
	); err != nil {
		return tableStats{}, fmt.Errorf("collect %s stats: %w", table, err)
	}
	return stats, nil
}

func inlineSignalPredicate(column string) string {
	return fmt.Sprintf(`(%[1]s ilike '%%data:image/%%'
       or %[1]s ilike '%%data:application/%%'
       or %[1]s ilike '%%base64,%%'
       or %[1]s ilike '%%dataURL%%'
       or %[1]s ilike '%%data_url%%')`, column)
}

func buildDryRunReport(cfg commandConfig, before compactionSnapshot) report {
	after := before
	after.NodeInformation = before.NodeProjectionTextBoxes
	after.NodeProjectionSeenSnapshots = tableStats{}
	rep := report{
		GeneratedAt:       time.Now().UTC(),
		DryRun:            !cfg.Apply,
		Apply:             cfg.Apply,
		CompanyID:         cfg.CompanyID,
		LargePayloadBytes: cfg.LargePayloadBytes,
		Before:            before,
		After:             after,
		AfterEstimated:    !cfg.Apply,
		Warnings:          snapshotWarnings(before),
	}
	if !cfg.Apply {
		rep.RemainingLiveSteps = []string{
			"Run python scripts/verify_agent_db_access_boundary.py in the exact DB session before any live dry-run/apply database work.",
			"Run mango-attachment-migrate for -source-scope=node_projection_table first; apply of this compactor is blocked while node projections still contain inline-byte signals.",
			"Review this report with Jonat before running -apply.",
			"Apply only with -apply -confirm-apply=" + applyConfirmation + " for the dev company, then rerun the attachment dry run.",
		}
	}
	return rep
}

func snapshotWarnings(snapshot compactionSnapshot) []string {
	warnings := make([]string, 0)
	if snapshot.NodeProjectionTable.InlineSignalRows > 0 {
		warnings = append(warnings, "node_projection_table rows still contain inline-byte signals; apply is blocked until current projections are migrated to Mango attachment references")
	}
	if snapshot.NodeProjectionTable.InlineSignalRows > snapshot.NodeProjectionTextBoxes.InlineSignalRows {
		warnings = append(warnings, "node_projection_table has non-Text box rows with inline-byte signals; this compactor will preserve projection rows and will not clean chat or attached-email projections")
	}
	if snapshot.NodeProjectionTextBoxes.RowCount == 0 {
		warnings = append(warnings, "no current Text box projection rows found for company; apply is blocked to avoid deleting history for the wrong company")
	}
	return warnings
}

func validateApplySnapshot(snapshot compactionSnapshot) error {
	if snapshot.NodeProjectionTextBoxes.RowCount == 0 {
		return errors.New("apply blocked: no current Text box projection rows found for company")
	}
	if snapshot.NodeProjectionTable.InlineSignalRows > 0 {
		return errors.New("apply blocked: current node_projection_table rows still contain inline-byte signals; run mango-attachment-migrate -source-scope=node_projection_table first")
	}
	return nil
}

func applyCompaction(ctx context.Context, db *sql.DB, cfg commandConfig, rep *report) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	before, err := collectSnapshot(ctx, tx, cfg)
	if err != nil {
		return err
	}
	if err := validateApplySnapshot(before); err != nil {
		return err
	}
	rep.Before = before
	rep.Warnings = snapshotWarnings(before)

	projections, err := selectCurrentTextBoxProjections(ctx, tx, cfg.CompanyID)
	if err != nil {
		return err
	}

	deletedInformation, err := execRowsAffected(ctx, tx, `delete from node_information where company_id=$1::uuid`, cfg.CompanyID)
	if err != nil {
		return fmt.Errorf("delete node_information: %w", err)
	}
	deletedSnapshots, err := execRowsAffected(ctx, tx, `delete from node_projection_seen_snapshots where company_id=$1::uuid`, cfg.CompanyID)
	if err != nil {
		return fmt.Errorf("delete node_projection_seen_snapshots: %w", err)
	}

	batchIDs := map[string]string{}
	var inserted int64
	for _, projection := range projections {
		batchID := batchIDs[projection.NodeID]
		if batchID == "" {
			batchID = newUUIDv4String()
			batchIDs[projection.NodeID] = batchID
		}
		if _, err := tx.ExecContext(ctx, `
insert into node_information (
  company_id,
  information_id,
  node_id,
  type,
  information,
  save_batch_id,
  save_kind,
  saved_by_display_name,
  source_information_id,
  created_timestamp,
  updated_timestamp
) values (
  $1::uuid,
  $2::uuid,
  $3::uuid,
  $4::information_type,
  $5,
  $6::uuid,
  'manual',
  $7,
  $8::uuid,
  now(),
  now()
)`,
			cfg.CompanyID,
			newUUIDv4String(),
			projection.NodeID,
			projection.Type,
			projection.Information,
			batchID,
			defaultSavedByLabel,
			projection.InformationID,
		); err != nil {
			return fmt.Errorf("insert compacted node_information for node %s projection %s: %w", projection.NodeID, projection.InformationID, err)
		}
		inserted++
	}

	after, err := collectSnapshot(ctx, tx, cfg)
	if err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}

	rep.DryRun = false
	rep.Apply = true
	rep.After = after
	rep.AfterEstimated = false
	rep.DeletedNodeInformationRows = deletedInformation
	rep.DeletedSeenSnapshotRows = deletedSnapshots
	rep.InsertedNodeInformationRows = inserted
	rep.RemainingLiveSteps = []string{
		"Rerun mango-attachment-migrate dry run with a high limit to verify node_information and node_projection_seen_snapshots are clean.",
		"Inspect any remaining node_projection_table inline-byte rows before moving on to Logic Gate, project, or email stragglers.",
	}
	return nil
}

type txer interface {
	queryer
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func selectCurrentTextBoxProjections(ctx context.Context, tx txer, companyID string) ([]projectionRow, error) {
	rows, err := tx.QueryContext(ctx, `
select node_id::text, information_id::text, type::text, information
  from node_projection_table
 where company_id=$1::uuid
   and type='Text box'::information_type
 order by node_id, created_timestamp, information_id`, companyID)
	if err != nil {
		return nil, fmt.Errorf("select current text-box projections: %w", err)
	}
	defer rows.Close()

	projections := make([]projectionRow, 0)
	for rows.Next() {
		var item projectionRow
		if err := rows.Scan(&item.NodeID, &item.InformationID, &item.Type, &item.Information); err != nil {
			return nil, fmt.Errorf("scan current text-box projection: %w", err)
		}
		projections = append(projections, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read current text-box projections: %w", err)
	}
	return projections, nil
}

func execRowsAffected(ctx context.Context, tx txer, query string, args ...any) (int64, error) {
	result, err := tx.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	return affected, nil
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
