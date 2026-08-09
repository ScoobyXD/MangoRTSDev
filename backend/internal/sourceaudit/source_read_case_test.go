package sourceaudit

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

var sourcePathLiteralRE = regexp.MustCompile(`"([A-Za-z0-9_./\\-]+\.(?:go|sql))"`)

func TestSourceReadPathLiteralsMatchGitCase(t *testing.T) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", ".."))
	backendRoot := filepath.Join(repoRoot, "backend")

	cmd := exec.Command("git", "-C", repoRoot, "ls-files", "-z")
	out, err := cmd.Output()
	if err != nil {
		t.Skipf("git ls-files unavailable for source case audit: %v", err)
	}
	tracked := map[string]struct{}{}
	for _, line := range strings.Split(string(out), "\x00") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		tracked[line] = struct{}{}
	}

	var mismatches []string
	err = filepath.WalkDir(backendRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), "_test.go") {
			return nil
		}
		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		sourceDir := filepath.Dir(path)
		sourceRel, _ := filepath.Rel(repoRoot, path)
		sourceRel = filepath.ToSlash(sourceRel)
		for _, match := range sourcePathLiteralRE.FindAllStringSubmatch(string(raw), -1) {
			literal := match[1]
			if filepath.IsAbs(literal) {
				continue
			}
			candidate := filepath.Clean(filepath.Join(sourceDir, filepath.FromSlash(strings.ReplaceAll(literal, "\\", "/"))))
			if _, statErr := os.Stat(candidate); statErr != nil {
				continue
			}
			rel, relErr := filepath.Rel(repoRoot, candidate)
			if relErr != nil || strings.HasPrefix(rel, "..") {
				continue
			}
			rel = filepath.ToSlash(rel)
			if _, exists := tracked[rel]; !exists {
				mismatches = append(mismatches, sourceRel+" references "+literal+"; resolved path is not tracked with that exact case: "+rel)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("source case audit failed: %v", err)
	}
	if len(mismatches) > 0 {
		t.Fatalf("source file path literals must match Git casing:\n%s", strings.Join(mismatches, "\n"))
	}
}
