package httpapi

import (
	"strings"
	"testing"

	"miraeopus/backend/internal/store"
)

func TestCtrlLoopStoredSourceURLUsesExactCanonicalEmail(t *testing.T) {
	run := store.CtrlLoopRun{ID: store.NewUUIDv7String(), CompanyID: store.NewUUIDv7String(), EmailThreadID: store.NewUUIDv7String(), EmailMessageID: store.NewUUIDv7String(), ProviderMessageID: "provider-id-must-not-be-used"}
	for _, origin := range []string{"https://mango.example.com", "https://mango.example.com/", "http://localhost:5173", "http://LOCALHOST:5173", "http://127.0.0.1:5173", "http://[::1]:5173"} {
		s := &Server{appBaseURL: origin}
		got, err := s.ctrlLoopStoredEmailURL(run)
		want := strings.TrimRight(origin, "/") + "/ctrl-loop/email/" + run.CompanyID + "/" + run.EmailThreadID + "/" + run.EmailMessageID
		if err != nil || got != want || strings.Contains(got, run.ID) || strings.Contains(got, run.ProviderMessageID) {
			t.Fatalf("wrong source URL: %s %v", got, err)
		}
	}
}

func TestCtrlLoopStoredSourceURLRejectsMissingIdentityAndUnsafeOrigin(t *testing.T) {
	run := store.CtrlLoopRun{CompanyID: store.NewUUIDv7String(), EmailThreadID: store.NewUUIDv7String(), EmailMessageID: store.NewUUIDv7String()}
	for _, origin := range []string{"", "//mango.example.com", "http://mango.example.com", "javascript:alert(1)", "https://user:password@mango.example.com", "https://mango.example.com/redirect", "https://mango.example.com?next=evil", "https://mango.example.com?", "https://mango.example.com#source", "https://mango.example.com#"} {
		s := &Server{appBaseURL: origin}
		if got, err := s.ctrlLoopStoredEmailURL(run); err == nil || got != "" {
			t.Fatalf("unsafe configured origin accepted: %s", origin)
		}
	}
	s := &Server{appBaseURL: "https://mango.example.com"}
	for _, invalid := range []store.CtrlLoopRun{
		{CompanyID: run.CompanyID, EmailMessageID: run.EmailMessageID},
		{CompanyID: run.CompanyID, EmailThreadID: run.EmailThreadID},
		{CompanyID: run.CompanyID, EmailThreadID: run.EmailThreadID, EmailMessageID: "../another-email"},
	} {
		if got, err := s.ctrlLoopStoredEmailURL(invalid); err == nil || got != "" {
			t.Fatalf("missing exact stored identity accepted: %s", got)
		}
	}
}
