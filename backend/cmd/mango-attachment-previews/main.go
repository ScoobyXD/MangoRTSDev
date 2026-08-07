package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"miraeopus/backend/internal/domain"
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

const applyConfirmation = "GENERATE_ATTACHMENT_PREVIEWS_FOR_COMPANY"

type commandConfig struct {
	Apply             bool
	ConfirmApply      string
	CompanyID         string
	Limit             int
	AfterAttachmentID string
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

type previewCandidate struct {
	Attachment domain.Attachment
	Reason     string
}

type candidateReport struct {
	AttachmentID string `json:"attachment_id"`
	Filename     string `json:"filename"`
	MimeType     string `json:"mime_type"`
	ByteSize     int64  `json:"byte_size"`
	Reason       string `json:"reason"`
	Status       string `json:"status"`
}

type report struct {
	GeneratedAt       time.Time         `json:"generated_at"`
	DryRun            bool              `json:"dry_run"`
	CompanyID         string            `json:"company_id"`
	Limit             int               `json:"limit"`
	AfterAttachmentID string            `json:"after_attachment_id,omitempty"`
	NextCursor        string            `json:"next_cursor,omitempty"`
	Candidates        []candidateReport `json:"candidates"`
	Generated         int               `json:"generated,omitempty"`
	Current           int               `json:"current,omitempty"`
	Skipped           int               `json:"skipped,omitempty"`
	Failed            int               `json:"failed,omitempty"`
	NextSteps         []string          `json:"next_steps,omitempty"`
}

func main() {
	if err := run(context.Background(), os.Args[1:], os.Getenv, os.Stdout); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context, args []string, getenv func(string) string, stdout io.Writer) error {
	cfg, err := parseCommandConfig(args)
	if err != nil {
		return err
	}
	databaseConfig, err := parseDBConfig(getenv)
	if err != nil {
		return err
	}
	db, err := openDB(databaseConfig)
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(5 * time.Minute)

	candidates, err := listPreviewCandidates(ctx, db, cfg.CompanyID, cfg.AfterAttachmentID, cfg.Limit)
	if err != nil {
		return err
	}
	rep := report{GeneratedAt: time.Now().UTC(), DryRun: !cfg.Apply, CompanyID: cfg.CompanyID, Limit: cfg.Limit, AfterAttachmentID: cfg.AfterAttachmentID,
		Candidates: make([]candidateReport, 0, len(candidates))}
	if len(candidates) == cfg.Limit {
		rep.NextCursor = candidates[len(candidates)-1].Attachment.AttachmentID
	}
	for _, candidate := range candidates {
		rep.Candidates = append(rep.Candidates, candidateReport{AttachmentID: candidate.Attachment.AttachmentID,
			Filename: candidate.Attachment.OriginalFilename, MimeType: candidate.Attachment.MimeType,
			ByteSize: candidate.Attachment.ByteSize, Reason: candidate.Reason, Status: "pending"})
	}
	if !cfg.Apply {
		rep.NextSteps = []string{
			"Review candidate IDs and counts before apply.",
			"Apply is human-only; an agent must never run this command with database writer or attachment S3 access.",
			"The database access accountable is a safety check only and never authorizes an agent writer/S3 apply run.",
			"A human may apply only through an approved human admin session with -apply -confirm-apply=" + applyConfirmation + ".",
		}
		return json.NewEncoder(stdout).Encode(rep)
	}
	storage := httpapi.NewS3AttachmentStorageFromEnv()
	if storage == nil {
		return errors.New("apply requires attachment S3 bucket and region configuration")
	}
	repo := store.NewPostgresRepo(db)
	for index, candidate := range candidates {
		// Intentionally serial: the decoder/storage/upsert pipeline has one owner
		// and each successfully upserted generation is resumable on the next run.
		current, currentErr := httpapi.AttachmentImageVariantsCurrent(ctx, repo, storage, candidate.Attachment)
		if currentErr != nil {
			rep.Candidates[index].Status = "failed: " + boundedReason(currentErr)
			rep.Failed++
			continue
		}
		if current {
			rep.Candidates[index].Status = "current"
			rep.Current++
			continue
		}
		_, ensureErr := httpapi.EnsureAttachmentImageVariants(ctx, repo, storage, candidate.Attachment)
		if ensureErr == nil {
			rep.Candidates[index].Status = "generated"
			rep.Generated++
			continue
		}
		if errors.Is(ensureErr, httpapi.ErrAttachmentImageVariantUnsupported) || errors.Is(ensureErr, httpapi.ErrAttachmentImageVariantBounds) {
			rep.Candidates[index].Status = "skipped: " + boundedReason(ensureErr)
			rep.Skipped++
			continue
		}
		rep.Candidates[index].Status = "failed: " + boundedReason(ensureErr)
		rep.Failed++
	}
	if err := json.NewEncoder(stdout).Encode(rep); err != nil {
		return err
	}
	if rep.Failed > 0 {
		return fmt.Errorf("%d attachment preview candidates failed; see emitted report", rep.Failed)
	}
	return nil
}

func parseCommandConfig(args []string) (commandConfig, error) {
	flags := flag.NewFlagSet("mango-attachment-previews", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	var cfg commandConfig
	flags.BoolVar(&cfg.Apply, "apply", false, "generate and persist previews; defaults to dry-run")
	flags.StringVar(&cfg.ConfirmApply, "confirm-apply", "", "required scary confirmation for apply")
	flags.StringVar(&cfg.CompanyID, "company-id", "", "required company UUID")
	flags.IntVar(&cfg.Limit, "limit", 0, "required explicit maximum candidate count")
	flags.StringVar(&cfg.AfterAttachmentID, "after-attachment-id", "", "optional exclusive attachment UUID cursor")
	if err := flags.Parse(args); err != nil {
		return commandConfig{}, err
	}
	if flags.NArg() != 0 {
		return commandConfig{}, fmt.Errorf("unexpected positional arguments: %s", strings.Join(flags.Args(), " "))
	}
	seenLimit := false
	flags.Visit(func(item *flag.Flag) {
		if item.Name == "limit" {
			seenLimit = true
		}
	})
	cfg.CompanyID = strings.TrimSpace(cfg.CompanyID)
	cfg.AfterAttachmentID = strings.TrimSpace(cfg.AfterAttachmentID)
	if cfg.CompanyID == "" {
		return commandConfig{}, errors.New("-company-id is required")
	}
	if !seenLimit || cfg.Limit < 1 || cfg.Limit > 10000 {
		return commandConfig{}, errors.New("an explicit -limit between 1 and 10000 is required")
	}
	if cfg.Apply && cfg.ConfirmApply != applyConfirmation {
		return commandConfig{}, errors.New("-apply requires -confirm-apply=" + applyConfirmation)
	}
	return cfg, nil
}

func listPreviewCandidates(ctx context.Context, db *sql.DB, companyID, afterAttachmentID string, limit int) ([]previewCandidate, error) {
	rows, err := db.QueryContext(ctx, previewCandidateQuery, companyID, afterAttachmentID, limit)
	if err != nil {
		return nil, fmt.Errorf("query attachment preview candidates: %w", err)
	}
	defer rows.Close()
	items := make([]previewCandidate, 0)
	for rows.Next() {
		var item previewCandidate
		var width, height sql.NullInt64
		if err := rows.Scan(&item.Attachment.CompanyID, &item.Attachment.AttachmentID, &item.Attachment.UploadedByUserID,
			&item.Attachment.OriginalFilename, &item.Attachment.MimeType, &item.Attachment.ByteSize,
			&item.Attachment.SHA256, &item.Attachment.StorageBucket, &item.Attachment.StorageKey,
			&width, &height, &item.Attachment.SourceKind, &item.Attachment.SourceProvider,
			&item.Attachment.CreatedTimestamp, &item.Reason); err != nil {
			return nil, err
		}
		if width.Valid {
			value := int(width.Int64)
			item.Attachment.OriginalWidth = &value
		}
		if height.Valid {
			value := int(height.Int64)
			item.Attachment.OriginalHeight = &value
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const previewCandidateQuery = `
select
  a.company_id::text,
  a.attachment_id::text,
  coalesce(a.uploaded_by_user_id::text, ''),
  a.original_filename,
  a.mime_type,
  a.byte_size,
  a.sha256,
  a.storage_bucket,
  a.storage_key,
  a.original_width,
  a.original_height,
  a.source_kind,
  a.source_provider,
  a.created_timestamp,
  coalesce(nullif(concat_ws(',',
    case when display.attachment_id is null then 'display_missing_or_stale' end,
    case when thumbnail.attachment_id is null then 'thumbnail_missing_or_stale' end
  ), ''), 'current_db_unverified_storage')
from attachments a
left join attachment_previews display
  on display.attachment_id=a.attachment_id
 and display.preview_type='display'
 and display.generation_version=1
 and display.sha256 is not null
	and display.storage_key like 'companies/' || a.company_id::text || '/attachments/' || a.attachment_id::text || '/variants/v1/display/%'
left join attachment_previews thumbnail
  on thumbnail.attachment_id=a.attachment_id
 and thumbnail.preview_type='thumbnail'
 and thumbnail.generation_version=1
 and thumbnail.sha256 is not null
	and thumbnail.storage_key like 'companies/' || a.company_id::text || '/attachments/' || a.attachment_id::text || '/variants/v1/thumbnail/%'
where a.company_id=$1::uuid
  and a.deleted_timestamp is null
  and a.byte_size <= 67108864
  and ($2 = '' or a.attachment_id > $2::uuid)
order by a.attachment_id
limit $3`

func boundedReason(err error) string {
	reason := strings.ReplaceAll(strings.TrimSpace(err.Error()), "\n", " ")
	if len(reason) > 120 {
		reason = reason[:120]
	}
	return reason
}

func parseDBConfig(getenv func(string) string) (dbConfig, error) {
	cfg := dbConfig{
		Host: strings.TrimPrefix(strings.TrimSpace(getenv("DB_HOST")), "host="),
		Port: envDefault(getenv, "DB_PORT", "5432"), User: envDefault(getenv, "DB_USER", "postgres"),
		Password: getenv("DB_PASSWORD"), Name: envDefault(getenv, "DB_NAME", "postgres"),
		SSLMode: envDefault(getenv, "DB_SSLMODE", "require"), ConnectTimeoutSeconds: envInt(getenv, "DB_CONNECT_TIMEOUT_SECONDS", 5),
	}
	missing := make([]string, 0, 2)
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
	parsed, err := pgx.ParseConfig(buildConnString(cfg))
	if err != nil {
		return nil, err
	}
	parsed.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	return stdlib.OpenDB(*parsed), nil
}

func buildConnString(cfg dbConfig) string {
	query := url.Values{"sslmode": []string{cfg.SSLMode}, "connect_timeout": []string{strconv.Itoa(cfg.ConnectTimeoutSeconds)}}
	return (&url.URL{Scheme: "postgres", User: url.UserPassword(cfg.User, cfg.Password), Host: net.JoinHostPort(cfg.Host, cfg.Port),
		Path: "/" + cfg.Name, RawQuery: query.Encode()}).String()
}

func envDefault(getenv func(string) string, key, fallback string) string {
	if value := strings.TrimSpace(getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envInt(getenv func(string) string, key string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(getenv(key)))
	if err != nil || value < 1 {
		return fallback
	}
	return value
}
