package main

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
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
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/stdlib"
	"miraeopus/backend/internal/store"
)

const usage = `Usage:
  mango-process-map-reset --company-id UUID --actor-user-id UUID
  mango-process-map-reset --company-id UUID --actor-user-id UUID --apply --expect-plan TOKEN

The default command previews the reset without writing. Review the company,
counts, PostgreSQL version, and plan token before a human runs --apply.
Apply requires the exact token from the preview and rejects a changed plan.
Apply replaces saved map geometry and deletes the company's operational
relationships and their map traces.

Database settings: DB_HOST, DB_PORT, DB_USER, DB_NAME, DB_SSLMODE, and optional
DB_CONNECT_TIMEOUT_SECONDS. Use an existing protected PostgreSQL passfile
(PGPASSFILE or the standard pgpass location), or DB_PASSWORD in the human session.
Connection settings and passwords are never printed. This command runs no migrations.`

type dbConfig struct {
	Host, Port, User, Password, Name, SSLMode string
	ConnectTimeoutSeconds                     int
}

func main() {
	if err := run(context.Background(), os.Args[1:], os.Getenv, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "process map reset failed: "+err.Error())
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, getenv func(string) string, output io.Writer) error {
	input, err := parseCommandConfig(args)
	if errors.Is(err, flag.ErrHelp) {
		_, err := fmt.Fprintln(output, usage)
		if err != nil {
			return errors.New("could not write command help")
		}
		return nil
	}
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return safeOperationError(err)
	}
	cfg, err := parseDBConfig(getenv)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	db, err := openDB(cfg)
	if err != nil {
		return errors.New("invalid database configuration; check the DB_* and PostgreSQL connection settings")
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	connectCtx, connectCancel := context.WithTimeout(ctx, time.Duration(cfg.ConnectTimeoutSeconds)*time.Second)
	err = db.PingContext(connectCtx)
	connectCancel()
	if err != nil {
		return safeOperationError(err)
	}
	result, err := store.NewPostgresRepo(db).ResetProcessMap(ctx, input)
	return writeResetResult(output, result, err)
}

func writeResetResult(output io.Writer, result store.ProcessMapResetResult, operationErr error) error {
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	if operationErr != nil {
		if result.ServerVersion != "" {
			preflight := struct {
				ServerVersion string `json:"server_version"`
				Status        string `json:"status"`
			}{ServerVersion: result.ServerVersion, Status: "STOP"}
			if err := encoder.Encode(preflight); err != nil {
				return errors.New("could not write the PostgreSQL preflight result")
			}
		}
		return safeOperationError(operationErr)
	}
	if err := encoder.Encode(result); err != nil {
		return errors.New("could not write the result; preview again to check the current map")
	}
	return nil
}

func parseCommandConfig(args []string) (store.ProcessMapResetInput, error) {
	var input store.ProcessMapResetInput
	flags := flag.NewFlagSet("mango-process-map-reset", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&input.CompanyID, "company-id", "", "required company UUID")
	flags.StringVar(&input.ActorUserID, "actor-user-id", "", "required acting user UUID")
	flags.BoolVar(&input.Apply, "apply", false, "apply the reviewed plan; defaults to read-only preview")
	flags.StringVar(&input.ExpectedPlanToken, "expect-plan", "", "exact plan token copied from the preview")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return store.ProcessMapResetInput{}, flag.ErrHelp
		}
		return store.ProcessMapResetInput{}, errors.New("invalid command arguments; use --help")
	}
	if flags.NArg() != 0 {
		return store.ProcessMapResetInput{}, errors.New("positional arguments are not supported; use --help")
	}
	input.CompanyID = strings.ToLower(strings.TrimSpace(input.CompanyID))
	input.ActorUserID = strings.ToLower(strings.TrimSpace(input.ActorUserID))
	for _, field := range []struct{ name, value string }{{"company-id", input.CompanyID}, {"actor-user-id", input.ActorUserID}} {
		var parsed pgtype.UUID
		if err := parsed.Scan(field.value); err != nil || parsed.String() != field.value {
			return store.ProcessMapResetInput{}, fmt.Errorf("--%s requires a UUID in the standard hyphenated format", field.name)
		}
	}
	input.ExpectedPlanToken = strings.TrimSpace(input.ExpectedPlanToken)
	if input.Apply {
		if _, err := hex.DecodeString(input.ExpectedPlanToken); len(input.ExpectedPlanToken) != 64 || err != nil {
			return store.ProcessMapResetInput{}, errors.New("--apply requires --expect-plan with the 64-character hexadecimal token from a reviewed preview")
		}
	}
	if !input.Apply && input.ExpectedPlanToken != "" {
		return store.ProcessMapResetInput{}, errors.New("--expect-plan is only valid with --apply")
	}
	return input, nil
}

func parseDBConfig(getenv func(string) string) (dbConfig, error) {
	cfg := dbConfig{
		Host: strings.TrimPrefix(strings.TrimSpace(getenv("DB_HOST")), "host="),
		Port: envDefault(getenv, "DB_PORT", "5432"), User: envDefault(getenv, "DB_USER", "postgres"),
		Password: getenv("DB_PASSWORD"), Name: envDefault(getenv, "DB_NAME", "postgres"),
		SSLMode: envDefault(getenv, "DB_SSLMODE", "require"),
	}
	if cfg.Host == "" {
		return dbConfig{}, errors.New("DB_HOST is required")
	}
	port, err := strconv.Atoi(cfg.Port)
	if err != nil || port < 1 || port > 65535 {
		return dbConfig{}, errors.New("DB_PORT must be an integer from 1 to 65535")
	}
	cfg.ConnectTimeoutSeconds, err = strconv.Atoi(envDefault(getenv, "DB_CONNECT_TIMEOUT_SECONDS", "5"))
	if err != nil || cfg.ConnectTimeoutSeconds < 1 || cfg.ConnectTimeoutSeconds > 300 {
		return dbConfig{}, errors.New("DB_CONNECT_TIMEOUT_SECONDS must be an integer from 1 to 300")
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
	user := url.User(cfg.User)
	if cfg.Password != "" {
		user = url.UserPassword(cfg.User, cfg.Password)
	}
	return (&url.URL{
		Scheme: "postgres", User: user, Host: net.JoinHostPort(cfg.Host, cfg.Port), Path: "/" + cfg.Name,
		RawQuery: url.Values{
			"sslmode": {cfg.SSLMode}, "connect_timeout": {strconv.Itoa(cfg.ConnectTimeoutSeconds)},
			"application_name": {"mango-process-map-reset"},
		}.Encode(),
	}).String()
}

func envDefault(getenv func(string) string, key, fallback string) string {
	if value := strings.TrimSpace(getenv(key)); value != "" {
		return value
	}
	return fallback
}

func safeOperationError(err error) error {
	for _, item := range []struct {
		cause   error
		message string
	}{
		{context.Canceled, "operation canceled; preview again before applying"},
		{context.DeadlineExceeded, "operation timed out; preview again before applying"},
		{store.ErrProcessMapResetStalePlan, "the plan changed; run a new preview and review its token before applying"},
		{store.ErrProcessMapResetSchema, "required schema update is missing: 20260902_process_map_nested_layout_capacity.sql"},
		{store.ErrProcessMapResetVersion, "unsupported PostgreSQL version; this command requires PostgreSQL 17 or 18"},
		{store.ErrProcessMapResetSource, "Explorer and Process Map placement identities or parents do not match; resolve the mismatch before resetting"},
		{store.ErrNotFound, "company or acting user is unavailable, or the acting user lacks required access"},
		{store.ErrInvalid, "reset input or saved map geometry is invalid"},
		{store.ErrProcessMapCycle, "the folder hierarchy contains a cycle"},
		{store.ErrProcessMapContainment, "the reset cannot contain this hierarchy within the integer map limits"},
	} {
		if errors.Is(err, item.cause) {
			return errors.New(item.message)
		}
	}
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) && len(databaseError.Code) == 5 {
		validCode := true
		for _, char := range databaseError.Code {
			validCode = validCode && (char >= '0' && char <= '9' || char >= 'A' && char <= 'Z')
		}
		if validCode {
			return fmt.Errorf("database operation failed (SQLSTATE %s); check the database logs in your human session", databaseError.Code)
		}
	}
	return errors.New("database connection or reset failed; check the connection settings and database logs in your human session")
}
