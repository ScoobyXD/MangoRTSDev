package store

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkspaceDerivedProjectionRuntimeStaysRetired(t *testing.T) {
	forbidden := []string{
		"workspace_derived_projection_requested",
		"company_explorer_folder_item_assign_requested",
		"WorkspaceDerivedProjection",
		"workspaceDerivedCatchup",
		"DeferredFolderItems",
	}

	err := filepath.WalkDir("..", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		contents, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, needle := range forbidden {
			if strings.Contains(string(contents), needle) {
				t.Errorf("retired workspace-derived projection runtime %q found in %s", needle, path)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan backend runtime: %v", err)
	}
}
