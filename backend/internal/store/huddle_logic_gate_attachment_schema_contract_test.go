package store

import (
	"os"
	"strings"
	"testing"
)

func TestHuddleLogicGateAttachmentSchemaContract(t *testing.T) {
	sources := map[string]string{
		"migration":        "../../db/migrations/20260828_z_huddle_logic_gate_attachments.sql",
		"canonical schema": "../../db/schema.sql",
	}
	for name, path := range sources {
		t.Run(name, func(t *testing.T) {
			body, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			normalized := strings.ToLower(strings.Join(strings.Fields(string(body)), " "))
			for _, marker := range []string{
				"attachment_relationships_type_chk",
				"attachment_upload_jobs_resource_type_chk",
				"huddle_logic_gate",
				"elsif new.resource_type='huddle_logic_gate'",
				"from huddle_logic_gates where company_id=new.company_id",
				"and huddle_logic_gate_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end",
			} {
				if !strings.Contains(normalized, marker) {
					t.Fatalf("%s missing %q", name, marker)
				}
			}
		})
	}
}

func TestHuddleLogicGateAttachmentTypeUsesCanonicalIdentity(t *testing.T) {
	if got := NormalizeAttachmentResourceType(EntityTypeHuddleLogicGate); got != EntityTypeHuddleLogicGate {
		t.Fatalf("canonical Huddle Logic Gate attachment type=%q", got)
	}
	if got := NormalizeAttachmentResourceType("huddle-logic-gate"); got != "" {
		t.Fatalf("noncanonical Huddle Logic Gate attachment alias=%q, want rejection", got)
	}
}
