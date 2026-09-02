package main

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/mail"
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
  mango-process-map-reset --company-id UUID --actor-email EMAIL --interactive
  mango-process-map-reset --company-id UUID --actor-user-id UUID
  mango-process-map-reset --company-id UUID --actor-user-id UUID --apply --expect-plan TOKEN

Use exactly one actor flag. --actor-email resolves one existing dev_admin member
in the selected company. Interactive mode shows the company, actor, and preview,
then asks you to type RESET and press Enter. It carries the reviewed token into
apply automatically. Any other response or end of input cancels without writing.

The default command previews the reset without writing. Review the company,
counts, PostgreSQL version, and plan token before a human runs --apply.
Apply requires the exact token from the preview and rejects a changed plan.
Apply replaces saved map geometry and deletes the company's operational
relationships and their map traces.

Database settings: DB_HOST, DB_PORT, DB_USER, DB_NAME, DB_SSLMODE, and optional
DB_CONNECT_TIMEOUT_SECONDS. Use an existing protected PostgreSQL passfile
(PGPASSFILE or the standard pgpass location), or DB_PASSWORD in the human session.
Connection settings and passwords are never printed. This command runs no migrations.`

var (
	errActorMissing   = errors.New("reset actor not found")
	errActorAmbiguous = errors.New("reset actor is ambiguous")
	errActorNotAdmin  = errors.New("reset actor is not a company dev_admin")
)

type commandConfig struct {
	store.ProcessMapResetInput
	ActorEmail  string
	Interactive bool
}

type resetActor struct {
	UserID      string `json:"user_id"`
	Email       string `json:"email,omitempty"`
	DisplayName string `json:"display_name,omitempty"`
	Role        string `json:"role,omitempty"`
}

type dbConfig struct {
	Host, Port, User, Password, Name, SSLMode string
	ConnectTimeoutSeconds                     int
}

func main() {
	if err := run(context.Background(), os.Args[1:], os.Getenv, os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "process map reset failed: "+err.Error())
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, getenv func(string) string, confirmation io.Reader, output io.Writer) error {
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
	actor := resetActor{UserID: input.ActorUserID}
	if input.ActorEmail != "" {
		actor, err = resolveActorByEmail(ctx, db, input.CompanyID, input.ActorEmail)
		if err != nil {
			return safeOperationError(err)
		}
		input.ActorUserID = actor.UserID
	}
	return runConfiguredReset(ctx, input, actor, confirmation, output, store.NewPostgresRepo(db).ResetProcessMap)
}

func resolveActorByEmail(ctx context.Context, db *sql.DB, companyID, email string) (resetActor, error) {
	rows, err := db.QueryContext(ctx, `
select app_user.user_id::text,lower(btrim(app_user.email)),app_user.display_name,membership.role
from users app_user
join company_memberships membership on membership.user_id=app_user.user_id
where membership.company_id=$1::uuid and lower(btrim(app_user.email))=$2
order by app_user.user_id
limit 2`, companyID, email)
	if err != nil {
		return resetActor{}, err
	}
	defer rows.Close()
	actors := make([]resetActor, 0, 2)
	for rows.Next() {
		var actor resetActor
		if err := rows.Scan(&actor.UserID, &actor.Email, &actor.DisplayName, &actor.Role); err != nil {
			return resetActor{}, err
		}
		actors = append(actors, actor)
	}
	if err := rows.Err(); err != nil {
		return resetActor{}, err
	}
	if len(actors) == 0 {
		return resetActor{}, errActorMissing
	}
	if len(actors) != 1 {
		return resetActor{}, errActorAmbiguous
	}
	if actors[0].Role != "dev_admin" {
		return resetActor{}, errActorNotAdmin
	}
	return actors[0], nil
}

func runConfiguredReset(
	ctx context.Context, cfg commandConfig, actor resetActor, confirmation io.Reader, output io.Writer,
	reset func(context.Context, store.ProcessMapResetInput) (store.ProcessMapResetResult, error),
) error {
	result, err := reset(ctx, cfg.ProcessMapResetInput)
	if err != nil || !cfg.Interactive {
		return writeResetResult(output, result, err)
	}
	preview := struct {
		store.ProcessMapResetResult
		Actor resetActor `json:"actor"`
	}{ProcessMapResetResult: result, Actor: actor}
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(preview); err != nil {
		return errors.New("could not write the preview; no reset applied")
	}
	if _, err := fmt.Fprint(output, "Type RESET and press Enter to apply this exact preview, or anything else to cancel: "); err != nil {
		return errors.New("could not write the confirmation prompt; no reset applied")
	}
	answer, err := bufio.NewReader(confirmation).ReadString('\n')
	if errors.Is(err, io.EOF) || (err == nil && strings.TrimSpace(answer) != "RESET") {
		if _, err := fmt.Fprintln(output, "Canceled; no reset applied."); err != nil {
			return errors.New("could not write the cancellation result; no reset applied")
		}
		return nil
	}
	if err != nil {
		return errors.New("could not read confirmation; no reset applied")
	}
	if err := ctx.Err(); err != nil {
		return safeOperationError(err)
	}
	applyInput := cfg.ProcessMapResetInput
	applyInput.Apply = true
	applyInput.ExpectedPlanToken = result.PlanToken
	applied, err := reset(ctx, applyInput)
	if err := writeResetResult(output, applied, err); err != nil {
		return err
	}
	if !applied.Applied {
		return errors.New("the reset result did not confirm application; run a new preview")
	}
	if _, err := fmt.Fprintln(output, "Reset complete. Reload Process Map."); err != nil {
		return errors.New("reset completed but the confirmation could not be printed; reload Process Map")
	}
	return nil
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

func parseCommandConfig(args []string) (commandConfig, error) {
	var input commandConfig
	flags := flag.NewFlagSet("mango-process-map-reset", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&input.CompanyID, "company-id", "", "required company UUID")
	flags.StringVar(&input.ActorUserID, "actor-user-id", "", "required acting user UUID")
	flags.StringVar(&input.ActorEmail, "actor-email", "", "email of one existing dev_admin in this company")
	flags.BoolVar(&input.Interactive, "interactive", false, "preview and ask for RESET before applying the exact preview")
	flags.BoolVar(&input.Apply, "apply", false, "apply the reviewed plan; defaults to read-only preview")
	flags.StringVar(&input.ExpectedPlanToken, "expect-plan", "", "exact plan token copied from the preview")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return commandConfig{}, flag.ErrHelp
		}
		return commandConfig{}, errors.New("invalid command arguments; use --help")
	}
	if flags.NArg() != 0 {
		return commandConfig{}, errors.New("positional arguments are not supported; use --help")
	}
	manualApply := false
	flags.Visit(func(item *flag.Flag) {
		if item.Name == "apply" || item.Name == "expect-plan" {
			manualApply = true
		}
	})
	if input.Interactive && manualApply {
		return commandConfig{}, errors.New("--interactive cannot be combined with --apply or --expect-plan")
	}
	input.CompanyID = strings.ToLower(strings.TrimSpace(input.CompanyID))
	input.ActorUserID = strings.ToLower(strings.TrimSpace(input.ActorUserID))
	input.ActorEmail = strings.ToLower(strings.TrimSpace(input.ActorEmail))
	if (input.ActorUserID == "") == (input.ActorEmail == "") {
		return commandConfig{}, errors.New("provide exactly one of --actor-user-id or --actor-email")
	}
	for _, field := range []struct{ name, value string }{{"company-id", input.CompanyID}, {"actor-user-id", input.ActorUserID}} {
		if field.name == "actor-user-id" && input.ActorEmail != "" {
			continue
		}
		var parsed pgtype.UUID
		if err := parsed.Scan(field.value); err != nil || parsed.String() != field.value {
			return commandConfig{}, fmt.Errorf("--%s requires a UUID in the standard hyphenated format", field.name)
		}
	}
	if input.ActorEmail != "" {
		address, err := mail.ParseAddress(input.ActorEmail)
		if err != nil || address.Address != input.ActorEmail {
			return commandConfig{}, errors.New("--actor-email requires an email address without a display name")
		}
	}
	input.ExpectedPlanToken = strings.TrimSpace(input.ExpectedPlanToken)
	if input.Apply {
		if _, err := hex.DecodeString(input.ExpectedPlanToken); len(input.ExpectedPlanToken) != 64 || err != nil {
			return commandConfig{}, errors.New("--apply requires --expect-plan with the 64-character hexadecimal token from a reviewed preview")
		}
	}
	if !input.Apply && input.ExpectedPlanToken != "" {
		return commandConfig{}, errors.New("--expect-plan is only valid with --apply")
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
		{errActorMissing, "no member in this company matches --actor-email"},
		{errActorAmbiguous, "more than one member in this company matches --actor-email; no actor was selected"},
		{errActorNotAdmin, "the member matching --actor-email must be a dev_admin in this company"},
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
