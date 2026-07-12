package main

import (
	"strings"
	"testing"
)

func TestParseCommandConfigRequiresCompanyAndExplicitLimit(t *testing.T) {
	for _, args := range [][]string{{}, {"-company-id", "company"}, {"-limit", "25"}} {
		if _, err := parseCommandConfig(args); err == nil {
			t.Fatalf("parseCommandConfig(%q) unexpectedly succeeded", args)
		}
	}
	cfg, err := parseCommandConfig([]string{"-company-id", "company", "-limit", "25"})
	if err != nil {
		t.Fatalf("parse dry-run config: %v", err)
	}
	if cfg.Apply || cfg.CompanyID != "company" || cfg.Limit != 25 {
		t.Fatalf("dry-run config = %+v", cfg)
	}
}

func TestParseCommandConfigApplyRequiresScaryConfirmation(t *testing.T) {
	if _, err := parseCommandConfig([]string{"-company-id", "company", "-limit", "1", "-apply"}); err == nil || !strings.Contains(err.Error(), applyConfirmation) {
		t.Fatalf("missing apply confirmation error = %v", err)
	}
	if _, err := parseCommandConfig([]string{"-company-id", "company", "-limit", "1", "-apply", "-confirm-apply", applyConfirmation}); err != nil {
		t.Fatalf("parse confirmed apply: %v", err)
	}
}

func TestVariantCandidateQuerySelectsOnlyMissingOrStaleCurrentGeneration(t *testing.T) {
	for _, required := range []string{"display.generation_version=1", "thumbnail.generation_version=1", "display.sha256 is not null", "thumbnail.sha256 is not null",
		"/variants/v1/display/%", "/variants/v1/thumbnail/%", "current_db_unverified_storage",
		"a.byte_size <= 67108864", "a.attachment_id > $2::uuid", "limit $3"} {
		if !strings.Contains(variantCandidateQuery, required) {
			t.Fatalf("candidate query missing %q", required)
		}
	}
	if strings.Contains(variantCandidateQuery, "and (display.attachment_id is null or thumbnail.attachment_id is null)") {
		t.Fatal("candidate query excludes DB-current rows whose storage objects still need verification")
	}
	if strings.Contains(variantCandidateQuery, "lower(a.mime_type)") {
		t.Fatal("candidate query excludes magic-valid images whose stored MIME is wrong")
	}
}
