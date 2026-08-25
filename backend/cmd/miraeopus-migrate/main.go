package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

const (
	defaultSchemaPath    = "db/schema.sql"
	defaultInventoryPath = "db/schema_inventory.sql"
	defaultMigrationsDir = "db/migrations"
	defaultMode          = "migrate"

	schemaMigrationsTableSQL = `create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);`

	migrationLockID int64 = 4855156563379734401
)

type commandConfig struct {
	SchemaPath         string
	InventoryPath      string
	MigrationsDir      string
	Mode               string
	DryRun             bool
	BaselineMigrations bool
	RequireEmptyDB     bool
	StartAt            string
	StartAfter         string
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

type migrationFile struct {
	Name string
	Path string
}

type envLookup func(string) string

func main() {
	if err := run(context.Background(), os.Args[1:], os.Getenv); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context, args []string, getenv envLookup) error {
	cfg, err := parseCommandConfig(args, getenv)
	if err != nil {
		return err
	}
	dbCfg, err := parseDBConfig(getenv, cfg.Mode == "audit")
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

	conn, err := db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("open database session: %w", err)
	}
	defer conn.Close()

	if cfg.Mode != "audit" {
		if err := acquireMigrationLock(ctx, conn); err != nil {
			return err
		}
		defer func() {
			if err := releaseMigrationLock(context.Background(), conn); err != nil {
				log.Printf("failed to release migration lock: %v", err)
			}
		}()
	}

	if err := conn.PingContext(ctx); err != nil {
		return fmt.Errorf("connect postgres host=%s db=%s sslmode=%s: %w", dbCfg.Host, dbCfg.Name, dbCfg.SSLMode, err)
	}

	switch cfg.Mode {
	case "audit":
		return runAuditMode(ctx, conn, cfg)
	case "schema":
		return runSchemaMode(ctx, conn, cfg)
	case "migrate":
		return runMigrateMode(ctx, conn, cfg)
	case "all":
		if err := runSchemaMode(ctx, conn, cfg); err != nil {
			return err
		}
		return runMigrateMode(ctx, conn, cfg)
	default:
		return fmt.Errorf("invalid -mode %q; expected audit, schema, migrate, or all", cfg.Mode)
	}
}

func parseCommandConfig(args []string, getenv envLookup) (commandConfig, error) {
	flags := flag.NewFlagSet("miraeopus-migrate", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)

	cfg := commandConfig{}
	flags.StringVar(&cfg.SchemaPath, "schema", defaultSchemaPath, "path to schema.sql")
	flags.StringVar(&cfg.InventoryPath, "inventory", defaultInventoryPath, "path to schema_inventory.sql")
	flags.StringVar(&cfg.MigrationsDir, "migrations", defaultMigrationsDir, "directory containing .sql migration files")
	flags.StringVar(&cfg.Mode, "mode", defaultMode, "audit, schema, migrate, or all")
	flags.BoolVar(&cfg.DryRun, "dry-run", false, "print planned work without applying changes")
	flags.BoolVar(&cfg.BaselineMigrations, "baseline-migrations", false, "with -mode schema, record current migration filenames after applying the schema snapshot")
	flags.BoolVar(&cfg.RequireEmptyDB, "require-empty-database", false, "with -mode schema, atomically refuse bootstrap when application schema objects already exist")
	flags.StringVar(&cfg.StartAt, "start-at", strings.TrimSpace(getenv("DB_MIGRATION_START_AT")), "first migration filename to consider")
	flags.StringVar(&cfg.StartAfter, "start-after", strings.TrimSpace(getenv("DB_MIGRATION_START_AFTER")), "start after this migration filename")

	if err := flags.Parse(args); err != nil {
		return commandConfig{}, err
	}
	if flags.NArg() != 0 {
		return commandConfig{}, fmt.Errorf("unexpected positional arguments: %s", strings.Join(flags.Args(), " "))
	}

	cfg.SchemaPath = strings.TrimSpace(cfg.SchemaPath)
	cfg.InventoryPath = strings.TrimSpace(cfg.InventoryPath)
	cfg.MigrationsDir = strings.TrimSpace(cfg.MigrationsDir)
	cfg.Mode = strings.ToLower(strings.TrimSpace(cfg.Mode))
	cfg.StartAt = strings.TrimSpace(cfg.StartAt)
	cfg.StartAfter = strings.TrimSpace(cfg.StartAfter)

	if cfg.SchemaPath == "" {
		return commandConfig{}, errors.New("-schema is required")
	}
	if cfg.InventoryPath == "" {
		return commandConfig{}, errors.New("-inventory is required")
	}
	if cfg.MigrationsDir == "" {
		return commandConfig{}, errors.New("-migrations is required")
	}
	if cfg.StartAt != "" && cfg.StartAfter != "" {
		return commandConfig{}, errors.New("-start-at and -start-after are mutually exclusive")
	}
	switch cfg.Mode {
	case "audit", "schema", "migrate", "all":
		if cfg.BaselineMigrations && cfg.Mode != "schema" {
			return commandConfig{}, errors.New("-baseline-migrations requires -mode schema")
		}
		if cfg.Mode == "audit" && (cfg.StartAt != "" || cfg.StartAfter != "") {
			return commandConfig{}, errors.New("-start-at and -start-after are not valid with -mode audit")
		}
		if cfg.RequireEmptyDB && cfg.Mode != "schema" {
			return commandConfig{}, errors.New("-require-empty-database requires -mode schema")
		}
		return cfg, nil
	default:
		return commandConfig{}, fmt.Errorf("invalid -mode %q; expected audit, schema, migrate, or all", cfg.Mode)
	}
}

func parseDBConfig(getenv envLookup, allowPasswordFile bool) (dbConfig, error) {
	cfg := dbConfig{
		Host:                  strings.TrimSpace(getenv("DB_HOST")),
		Port:                  getenvDefault(getenv, "DB_PORT", "5432"),
		User:                  getenvDefault(getenv, "DB_USER", "postgres"),
		Password:              getenv("DB_PASSWORD"),
		Name:                  getenvDefault(getenv, "DB_NAME", "postgres"),
		SSLMode:               getenvDefault(getenv, "DB_SSLMODE", "require"),
		ConnectTimeoutSeconds: envIntDefault(getenv, "DB_CONNECT_TIMEOUT_SECONDS", 5),
	}
	cfg.Host = strings.TrimPrefix(cfg.Host, "host=")

	var missing []string
	if cfg.Host == "" {
		missing = append(missing, "DB_HOST")
	}
	if strings.TrimSpace(cfg.Password) == "" && !allowPasswordFile {
		missing = append(missing, "DB_PASSWORD")
	}
	if len(missing) > 0 {
		return dbConfig{}, fmt.Errorf("missing required database environment variables: %s", strings.Join(missing, ", "))
	}
	return cfg, nil
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

	userInfo := url.User(cfg.User)
	if cfg.Password != "" {
		userInfo = url.UserPassword(cfg.User, cfg.Password)
	}
	u := url.URL{
		Scheme:   "postgres",
		User:     userInfo,
		Host:     net.JoinHostPort(cfg.Host, cfg.Port),
		Path:     "/" + cfg.Name,
		RawQuery: query.Encode(),
	}
	return u.String()
}

func acquireMigrationLock(ctx context.Context, conn *sql.Conn) error {
	if _, err := conn.ExecContext(ctx, `select pg_advisory_lock($1)`, migrationLockID); err != nil {
		return fmt.Errorf("acquire migration advisory lock: %w", err)
	}
	return nil
}

func releaseMigrationLock(ctx context.Context, conn *sql.Conn) error {
	if _, err := conn.ExecContext(ctx, `select pg_advisory_unlock($1)`, migrationLockID); err != nil {
		return err
	}
	return nil
}

type migrationLedgerAudit struct {
	MissingFromLedger []string
	UnknownToRepo     []string
}

type schemaInventoryItem struct {
	ObjectKind     string `json:"object_kind"`
	ObjectIdentity string `json:"object_identity"`
	Definition     any    `json:"definition"`
}

type repositorySchemaFile struct {
	Label string
	Path  string
}

func classifyMigrationLedger(files []migrationFile, applied map[string]bool) migrationLedgerAudit {
	repository := make(map[string]bool, len(files))
	audit := migrationLedgerAudit{}
	for _, file := range files {
		repository[file.Name] = true
		if !applied[file.Name] {
			audit.MissingFromLedger = append(audit.MissingFromLedger, file.Name)
		}
	}
	for version := range applied {
		if !repository[version] {
			audit.UnknownToRepo = append(audit.UnknownToRepo, version)
		}
	}
	sort.Strings(audit.MissingFromLedger)
	sort.Strings(audit.UnknownToRepo)
	return audit
}

func decodeSchemaInventory(raw []byte) ([]schemaInventoryItem, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var items []schemaInventoryItem
	if err := decoder.Decode(&items); err != nil {
		return nil, fmt.Errorf("decode schema inventory: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return nil, errors.New("decode schema inventory: unexpected trailing JSON value")
		}
		return nil, fmt.Errorf("decode schema inventory trailing data: %w", err)
	}
	for index, item := range items {
		item.ObjectKind = strings.TrimSpace(item.ObjectKind)
		item.ObjectIdentity = strings.TrimSpace(item.ObjectIdentity)
		if item.ObjectKind == "" || item.ObjectIdentity == "" {
			return nil, fmt.Errorf("schema inventory row %d has an empty object kind or identity", index)
		}
		items[index] = item
	}
	return items, nil
}

func schemaInventoryDigest(raw []byte) (int, string, error) {
	items, err := decodeSchemaInventory(raw)
	if err != nil {
		return 0, "", err
	}
	filtered := make([]schemaInventoryItem, 0, len(items))
	for _, item := range items {
		if item.ObjectKind == "grant" || strings.Contains(item.ObjectIdentity, "schema_migrations") {
			continue
		}
		if item.ObjectKind == "column" {
			if definition, ok := item.Definition.(map[string]any); ok {
				delete(definition, "ordinal_position")
			}
		}
		filtered = append(filtered, item)
	}
	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].ObjectKind != filtered[j].ObjectKind {
			return filtered[i].ObjectKind < filtered[j].ObjectKind
		}
		return filtered[i].ObjectIdentity < filtered[j].ObjectIdentity
	})
	for index := 1; index < len(filtered); index++ {
		if filtered[index-1].ObjectKind == filtered[index].ObjectKind && filtered[index-1].ObjectIdentity == filtered[index].ObjectIdentity {
			return 0, "", fmt.Errorf("schema inventory has duplicate object key %s:%s", filtered[index].ObjectKind, filtered[index].ObjectIdentity)
		}
	}

	canonical := make([]map[string]any, 0, len(filtered))
	for _, item := range filtered {
		canonical = append(canonical, map[string]any{
			"definition":      item.Definition,
			"object_identity": item.ObjectIdentity,
			"object_kind":     item.ObjectKind,
		})
	}
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(canonical); err != nil {
		return 0, "", fmt.Errorf("encode normalized schema inventory: %w", err)
	}
	digest := sha256.Sum256(bytes.TrimSuffix(encoded.Bytes(), []byte("\n")))
	return len(filtered), fmt.Sprintf("%x", digest), nil
}

func existingApplicationSchemaObjects(items []schemaInventoryItem) []string {
	existing := make([]string, 0, len(items))
	for _, item := range items {
		if item.ObjectKind == "grant" {
			continue
		}
		if item.ObjectKind == "schema" && item.ObjectIdentity == "public" {
			continue
		}
		if item.ObjectKind == "extension" && item.ObjectIdentity == "plpgsql" {
			continue
		}
		existing = append(existing, item.ObjectKind+":"+item.ObjectIdentity)
	}
	sort.Strings(existing)
	return existing
}

func requireEmptyDatabase(ctx context.Context, tx *sql.Tx, inventorySQL []byte) error {
	var inventoryJSON string
	if err := tx.QueryRowContext(ctx, string(inventorySQL)).Scan(&inventoryJSON); err != nil {
		return fmt.Errorf("inspect database before fresh schema bootstrap: %w", err)
	}
	items, err := decodeSchemaInventory([]byte(inventoryJSON))
	if err != nil {
		return err
	}
	existing := existingApplicationSchemaObjects(items)
	if len(existing) == 0 {
		log.Printf("empty database guard passed inside schema transaction")
		return nil
	}
	shown := existing
	if len(shown) > 10 {
		shown = shown[:10]
	}
	return fmt.Errorf("refusing fresh schema bootstrap: database contains %d application schema objects (first %d: %s)", len(existing), len(shown), strings.Join(shown, ", "))
}

func repositorySchemaFingerprint(schemaPath, inventoryPath, migrationsDir string) (string, error) {
	migrations, err := listMigrationFiles(migrationsDir)
	if err != nil {
		return "", err
	}
	files := []repositorySchemaFile{
		{Label: "schema.sql", Path: schemaPath},
		{Label: "schema_inventory.sql", Path: inventoryPath},
	}
	for _, migration := range migrations {
		files = append(files, repositorySchemaFile{
			Label: "migrations/" + migration.Name,
			Path:  migration.Path,
		})
	}

	digest := sha256.New()
	for _, file := range files {
		raw, readErr := os.ReadFile(file.Path)
		if readErr != nil {
			return "", fmt.Errorf("read repository schema file %s: %w", file.Path, readErr)
		}
		raw = bytes.TrimPrefix(raw, []byte{0xef, 0xbb, 0xbf})
		raw = bytes.ReplaceAll(raw, []byte("\r\n"), []byte("\n"))
		raw = bytes.ReplaceAll(raw, []byte("\r"), []byte("\n"))
		fileDigest := sha256.Sum256(raw)
		if _, writeErr := fmt.Fprintf(digest, "%s\x00%x\n", file.Label, fileDigest); writeErr != nil {
			return "", writeErr
		}
	}
	return fmt.Sprintf("%x", digest.Sum(nil)), nil
}

func runAuditMode(ctx context.Context, conn *sql.Conn, cfg commandConfig) error {
	files, err := listMigrationFiles(cfg.MigrationsDir)
	if err != nil {
		return err
	}
	repositoryDigest, err := repositorySchemaFingerprint(cfg.SchemaPath, cfg.InventoryPath, cfg.MigrationsDir)
	if err != nil {
		return err
	}
	inventorySQL, err := os.ReadFile(cfg.InventoryPath)
	if err != nil {
		return fmt.Errorf("read schema inventory query %s: %w", cfg.InventoryPath, err)
	}
	tx, err := conn.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return fmt.Errorf("begin read-only migration audit: %w", err)
	}
	defer tx.Rollback()

	var currentUser string
	var serverVersion string
	var serverVersionNum int
	var readOnly bool
	var ledgerExists bool
	var applicationTables int
	if err := tx.QueryRowContext(ctx, `select current_user,current_setting('server_version'),current_setting('server_version_num')::integer,current_setting('transaction_read_only')::boolean,to_regclass('public.schema_migrations') is not null,(select count(*)::integer from pg_catalog.pg_tables where schemaname='public')`).Scan(&currentUser, &serverVersion, &serverVersionNum, &readOnly, &ledgerExists, &applicationTables); err != nil {
		return fmt.Errorf("read migration audit identity: %w", err)
	}
	if !readOnly {
		return errors.New("migration audit refused a non-read-only transaction")
	}
	var inventoryJSON string
	if err := tx.QueryRowContext(ctx, string(inventorySQL)).Scan(&inventoryJSON); err != nil {
		return fmt.Errorf("export schema inventory in audit: %w", err)
	}
	inventoryCount, inventoryDigest, err := schemaInventoryDigest([]byte(inventoryJSON))
	if err != nil {
		return err
	}
	applied := map[string]bool{}
	if ledgerExists {
		rows, queryErr := tx.QueryContext(ctx, `select version from schema_migrations order by version`)
		if queryErr != nil {
			return fmt.Errorf("read schema_migrations in audit: %w", queryErr)
		}
		for rows.Next() {
			var version string
			if scanErr := rows.Scan(&version); scanErr != nil {
				rows.Close()
				return scanErr
			}
			if version = strings.TrimSpace(version); version != "" {
				applied[version] = true
			}
		}
		if rowsErr := rows.Close(); rowsErr != nil {
			return rowsErr
		}
	}
	audit := classifyMigrationLedger(files, applied)
	log.Printf("read-only migration audit user=%s server_version=%q server_version_num=%d transaction_read_only=%t public_tables=%d repository_migrations=%d ledger_exists=%t ledger_rows=%d missing_from_ledger=%d unknown_to_repository=%d schema_inventory_objects=%d schema_inventory_sha256=%s repository_schema_sha256=%s", currentUser, serverVersion, serverVersionNum, readOnly, applicationTables, len(files), ledgerExists, len(applied), len(audit.MissingFromLedger), len(audit.UnknownToRepo), inventoryCount, inventoryDigest, repositoryDigest)
	for _, version := range audit.MissingFromLedger {
		log.Printf("missing_from_ledger %s", version)
	}
	for _, version := range audit.UnknownToRepo {
		log.Printf("unknown_to_repository %s", version)
	}
	log.Printf("audit only: classify every missing version against a clean same-commit catalog before any reviewed ledger repair; this command made no database changes")
	return nil
}

func runSchemaMode(ctx context.Context, conn *sql.Conn, cfg commandConfig) error {
	var baselineFiles []migrationFile
	if cfg.BaselineMigrations {
		files, err := listMigrationFiles(cfg.MigrationsDir)
		if err != nil {
			return err
		}
		baselineFiles = files
	}
	if cfg.DryRun {
		log.Printf("dry run: would apply schema %s", cfg.SchemaPath)
		if cfg.RequireEmptyDB {
			log.Printf("dry run: would require an empty database inside the schema transaction")
		}
		if cfg.BaselineMigrations {
			log.Printf("dry run: would baseline %d migration files from %s", len(baselineFiles), cfg.MigrationsDir)
		}
		return nil
	}
	var beforeSchema func(*sql.Tx) error
	if cfg.RequireEmptyDB {
		inventorySQL, err := os.ReadFile(cfg.InventoryPath)
		if err != nil {
			return fmt.Errorf("read schema inventory query %s: %w", cfg.InventoryPath, err)
		}
		beforeSchema = func(tx *sql.Tx) error {
			return requireEmptyDatabase(ctx, tx, inventorySQL)
		}
	}
	log.Printf("applying schema %s", cfg.SchemaPath)
	if err := execSQLFileInTransaction(ctx, conn, cfg.SchemaPath, beforeSchema, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, schemaMigrationsTableSQL); err != nil {
			return err
		}
		if cfg.BaselineMigrations {
			return recordMigrationBaseline(ctx, tx, baselineFiles)
		}
		return nil
	}); err != nil {
		return fmt.Errorf("apply schema %s: %w", cfg.SchemaPath, err)
	}
	if cfg.BaselineMigrations {
		log.Printf("schema applied and %d migration files baselined", len(baselineFiles))
	} else {
		log.Printf("schema applied")
	}
	return nil
}

func recordMigrationBaseline(ctx context.Context, tx *sql.Tx, files []migrationFile) error {
	for _, migration := range files {
		if _, err := tx.ExecContext(ctx, `insert into schema_migrations(version) values ($1) on conflict (version) do nothing`, migration.Name); err != nil {
			return fmt.Errorf("baseline migration %s: %w", migration.Name, err)
		}
	}
	return nil
}

func runMigrateMode(ctx context.Context, conn *sql.Conn, cfg commandConfig) error {
	files, err := listMigrationFiles(cfg.MigrationsDir)
	if err != nil {
		return err
	}

	var applied map[string]bool
	if cfg.DryRun {
		applied, err = readAppliedMigrationsIfTableExists(ctx, conn)
	} else {
		if _, err := conn.ExecContext(ctx, schemaMigrationsTableSQL); err != nil {
			return fmt.Errorf("ensure schema_migrations: %w", err)
		}
		applied, err = readAppliedMigrations(ctx, conn)
	}
	if err != nil {
		return err
	}

	pending, err := selectPendingMigrations(files, applied, cfg.StartAt, cfg.StartAfter)
	if err != nil {
		return err
	}
	if len(pending) == 0 {
		log.Printf("no pending migrations")
		return nil
	}

	log.Printf("pending migrations:")
	for _, migration := range pending {
		log.Printf(" - %s", migration.Name)
	}
	if cfg.DryRun {
		log.Printf("dry run only; no migrations applied")
		return nil
	}

	for _, migration := range pending {
		log.Printf("applying %s", migration.Name)
		if err := execSQLFileInTransaction(ctx, conn, migration.Path, nil, func(tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `insert into schema_migrations(version) values ($1) on conflict (version) do nothing`, migration.Name)
			return err
		}); err != nil {
			return fmt.Errorf("apply migration %s: %w", migration.Name, err)
		}
	}
	log.Printf("database migrations applied")
	return nil
}

func execSQLFileInTransaction(ctx context.Context, conn *sql.Conn, path string, beforeExec, beforeCommit func(*sql.Tx) error) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if beforeExec != nil {
		if err := beforeExec(tx); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, string(raw)); err != nil {
		return err
	}
	if beforeCommit != nil {
		if err := beforeCommit(tx); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func readAppliedMigrationsIfTableExists(ctx context.Context, conn *sql.Conn) (map[string]bool, error) {
	var exists bool
	if err := conn.QueryRowContext(ctx, `select to_regclass('schema_migrations') is not null`).Scan(&exists); err != nil {
		return nil, fmt.Errorf("check schema_migrations: %w", err)
	}
	if !exists {
		return map[string]bool{}, nil
	}
	return readAppliedMigrations(ctx, conn)
}

func readAppliedMigrations(ctx context.Context, conn *sql.Conn) (map[string]bool, error) {
	rows, err := conn.QueryContext(ctx, `select version from schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("read applied migrations: %w", err)
	}
	defer rows.Close()

	applied := map[string]bool{}
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("scan applied migration: %w", err)
		}
		version = strings.TrimSpace(version)
		if version != "" {
			applied[version] = true
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read applied migrations: %w", err)
	}
	return applied, nil
}

func listMigrationFiles(dir string) ([]migrationFile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("list migrations %s: %w", dir, err)
	}

	files := make([]migrationFile, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".sql") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, fmt.Errorf("stat migration %s: %w", entry.Name(), err)
		}
		if !info.Mode().IsRegular() {
			continue
		}
		files = append(files, migrationFile{
			Name: entry.Name(),
			Path: filepath.Join(dir, entry.Name()),
		})
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].Name < files[j].Name
	})
	return files, nil
}

func selectPendingMigrations(files []migrationFile, applied map[string]bool, startAt, startAfter string) ([]migrationFile, error) {
	startAt = strings.TrimSpace(startAt)
	startAfter = strings.TrimSpace(startAfter)
	if startAt != "" && startAfter != "" {
		return nil, errors.New("startAt and startAfter are mutually exclusive")
	}

	if startAt != "" && !containsMigration(files, startAt) {
		return nil, fmt.Errorf("start-at migration %q was not found", startAt)
	}
	if startAfter != "" && !containsMigration(files, startAfter) {
		return nil, fmt.Errorf("start-after migration %q was not found", startAfter)
	}

	pending := make([]migrationFile, 0, len(files))
	shouldConsider := startAt == "" && startAfter == ""
	for _, file := range files {
		if startAfter != "" && !shouldConsider {
			if file.Name == startAfter {
				shouldConsider = true
			}
			continue
		}
		if startAt != "" && !shouldConsider {
			if file.Name == startAt {
				shouldConsider = true
			} else {
				continue
			}
		}
		if applied[file.Name] {
			continue
		}
		pending = append(pending, file)
	}
	return pending, nil
}

func containsMigration(files []migrationFile, name string) bool {
	for _, file := range files {
		if file.Name == name {
			return true
		}
	}
	return false
}
