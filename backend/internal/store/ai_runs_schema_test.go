package store

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestAIRunSchemaMatchesMigration(t *testing.T) {
	var canonical string
	for _, source := range []struct {
		path      string
		tableName string
	}{
		{filepath.Join("..", "..", "db", "schema.sql"), "ai_runs"},
		{filepath.Join("..", "..", "db", "migrations", "20260905_ai_runs.sql"), `"AI_runs"`},
	} {
		contents, err := os.ReadFile(source.path)
		if err != nil {
			t.Fatal(err)
		}
		pattern := regexp.MustCompile(`(?s)CREATE TABLE public\.` + regexp.QuoteMeta(source.tableName) + ` \(.*?\n\);`)
		table := pattern.FindString(strings.ReplaceAll(string(contents), "\r\n", "\n"))
		if table == "" {
			t.Fatalf("%s is missing the exact %s table", source.path, source.tableName)
		}
		table = strings.Replace(table, `CREATE TABLE public."AI_runs"`, "CREATE TABLE public.ai_runs", 1)
		if canonical == "" {
			canonical = table
		} else if table != canonical {
			t.Fatal("fresh schema and renamed migration table define different AI archives")
		}
	}
	renameSQL, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260905_z_lowercase_ai_runs.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(renameSQL), `ALTER TABLE public."AI_runs" RENAME TO ai_runs;`) {
		t.Fatal("rename migration must change the original AI_runs table to ai_runs")
	}
}
