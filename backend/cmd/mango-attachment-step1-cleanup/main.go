package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"miraeopus/backend/internal/attachmentcleanup"
	httpapi "miraeopus/backend/internal/http"
)

const applyConfirmation = "DELETE_ATTACHMENT_STEP1_ORPHANS"

type dbConfig struct {
	Host                  string
	Port                  string
	User                  string
	Password              string
	Name                  string
	SSLMode               string
	ConnectTimeoutSeconds int
}

func main() {
	if err := run(context.Background(), os.Args[1:], os.Getenv, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "attachment Step 1 cleanup failed")
		os.Exit(1)
	}
}

func run(
	ctx context.Context,
	args []string,
	getenv func(string) string,
	output io.Writer,
) error {
	flags := flag.NewFlagSet("mango-attachment-step1-cleanup", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	companyID := flags.String("company-id", "", "required company UUID scope")
	limit := flags.Int("limit", 100, "maximum work items for this run")
	apply := flags.Bool("apply", false, "delete objects and finalize database rows")
	confirm := flags.String("confirm", "", "required apply confirmation")
	if err := flags.Parse(args); err != nil {
		return err
	}
	*companyID = strings.TrimSpace(*companyID)
	if *companyID == "" || *limit < 1 {
		return errors.New("company-id and positive limit are required")
	}
	if *apply && strings.TrimSpace(*confirm) != applyConfirmation {
		return errors.New("apply requires the exact confirmation string")
	}
	cfg, err := parseDBConfig(getenv)
	if err != nil {
		return err
	}
	db, err := openDB(cfg)
	if err != nil {
		return err
	}
	defer db.Close()
	pingCtx, cancel := context.WithTimeout(ctx, time.Duration(cfg.ConnectTimeoutSeconds)*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		return err
	}

	rawStorage := httpapi.NewS3AttachmentStorageFromEnv()
	storage, ok := rawStorage.(interface {
		Bucket() string
		DeleteObject(context.Context, string) error
	})
	if !ok || strings.TrimSpace(storage.Bucket()) == "" {
		return errors.New("attachment S3 bucket/region configuration is required")
	}

	mode := "dry-run"
	if *apply {
		mode = "apply"
	}
	fmt.Fprintf(output, "mode=%s company_id=%s limit=%d\n", mode, *companyID, *limit)
	service := attachmentcleanup.Service{
		Repository: attachmentcleanup.PostgresRepository{DB: db},
		Storage:    storage,
	}
	result, err := service.Run(ctx, attachmentcleanup.Options{
		CompanyID: *companyID,
		Limit:     *limit,
		Apply:     *apply,
	})
	if err != nil {
		return err
	}
	for _, item := range result.Items {
		outcome := "dry_run"
		switch {
		case item.Err != nil:
			outcome = "failed"
		case item.Skipped:
			outcome = "skipped_not_eligible"
		case item.Finalized:
			outcome = "finalized"
		}
		fmt.Fprintf(
			output,
			"kind=%s attachment_id=%s outcome=%s objects=%d deleted=%d missing=%d protected=%d\n",
			item.Kind, item.AttachmentID, outcome, item.ObjectCount, item.DeletedObjects,
			item.AlreadyMissing, item.ProtectedObjects,
		)
	}
	fmt.Fprintf(output, "examined=%d finalized=%d failures=%d\n",
		len(result.Items), result.FinalizedCount(), result.FailureCount())
	if result.FailureCount() > 0 {
		return errors.New("one or more cleanup items failed; rerun is safe")
	}
	return nil
}

func parseDBConfig(getenv func(string) string) (dbConfig, error) {
	cfg := dbConfig{
		Host:                  strings.TrimPrefix(strings.TrimSpace(getenv("DB_HOST")), "host="),
		Port:                  envDefault(getenv, "DB_PORT", "5432"),
		User:                  envDefault(getenv, "DB_USER", "postgres"),
		Password:              getenv("DB_PASSWORD"),
		Name:                  envDefault(getenv, "DB_NAME", "postgres"),
		SSLMode:               envDefault(getenv, "DB_SSLMODE", "require"),
		ConnectTimeoutSeconds: envInt(getenv, "DB_CONNECT_TIMEOUT_SECONDS", 5),
	}
	missing := make([]string, 0, 2)
	if cfg.Host == "" {
		missing = append(missing, "DB_HOST")
	}
	if strings.TrimSpace(cfg.Password) == "" {
		missing = append(missing, "DB_PASSWORD")
	}
	if len(missing) > 0 {
		return dbConfig{}, fmt.Errorf(
			"missing required database environment variables: %s",
			strings.Join(missing, ", "),
		)
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
	query := url.Values{
		"sslmode":         []string{cfg.SSLMode},
		"connect_timeout": []string{strconv.Itoa(cfg.ConnectTimeoutSeconds)},
	}
	return (&url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(cfg.User, cfg.Password),
		Host:     net.JoinHostPort(cfg.Host, cfg.Port),
		Path:     "/" + cfg.Name,
		RawQuery: query.Encode(),
	}).String()
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
