package store

import (
	"regexp"
	"strings"
)

var (
	canonicalCreateTablePattern     = regexp.MustCompile(`(?m)^create table public\.([a-z_][a-z0-9_]*)`)
	canonicalCreateFunctionPattern  = regexp.MustCompile(`(?m)^create function public\.`)
	canonicalCreateProcedurePattern = regexp.MustCompile(`(?m)^create procedure public\.`)
	canonicalCreateViewPattern      = regexp.MustCompile(`(?m)^create view public\.`)
	canonicalCreateIndexPattern     = regexp.MustCompile(`(?m)^create (unique )?index ([a-z_][a-z0-9_]*) on public\.([a-z_][a-z0-9_]*) using btree \(`)
)

// normalizeCanonicalSchemaContract keeps source-level schema contract tests
// independent from pg_dump's harmless qualification and idempotency syntax.
// It is test-only and never changes SQL that is applied to PostgreSQL.
func normalizeCanonicalSchemaContract(sql string) string {
	normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(sql, "\r\n", "\n"), "\r", "\n"))
	normalized = canonicalCreateTablePattern.ReplaceAllString(normalized, "create table if not exists $1")
	normalized = canonicalCreateFunctionPattern.ReplaceAllString(normalized, "create or replace function ")
	normalized = canonicalCreateProcedurePattern.ReplaceAllString(normalized, "create or replace procedure ")
	normalized = canonicalCreateViewPattern.ReplaceAllString(normalized, "create or replace view ")
	normalized = canonicalCreateIndexPattern.ReplaceAllString(normalized, "create ${1}index if not exists $2 on $3(")
	normalized = strings.ReplaceAll(normalized, `"position"`, "position")
	return strings.ReplaceAll(normalized, "public.", "")
}
