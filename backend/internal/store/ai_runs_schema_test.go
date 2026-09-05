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
	pattern := regexp.MustCompile(`(?s)CREATE TABLE public\.ai_runs \(.*?\n\);`)
	for _, path := range []string{
		filepath.Join("..", "..", "db", "schema.sql"),
		filepath.Join("..", "..", "db", "migrations", "20260905_ai_runs.sql"),
	} {
		contents, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		table := pattern.FindString(strings.ReplaceAll(string(contents), "\r\n", "\n"))
		if table == "" {
			t.Fatalf("%s is missing the exact ai_runs table", path)
		}
		if canonical == "" {
			canonical = table
		} else if table != canonical {
			t.Fatal("fresh schema and creation migration define different AI archives")
		}
	}
}
