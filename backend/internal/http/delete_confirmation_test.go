package httpapi

import (
	"context"
	"miraeopus/backend/internal/domain"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequireActorDisplayNameConfirmationIgnoresCase(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/delete", nil)
	req = req.WithContext(context.WithValue(req.Context(), actorContextKey{}, ActorContext{
		User: domain.User{
			UserID:      "11111111-1111-4111-8111-111111111111",
			DisplayName: "Jonathan Kim",
		},
	}))
	rec := httptest.NewRecorder()

	actor, ok := requireActorDisplayNameConfirmation(rec, req, "  jOnAtHaN kIm  ")
	if !ok {
		t.Fatalf("confirmation rejected, body=%s", rec.Body.String())
	}
	if actor.User.DisplayName != "Jonathan Kim" {
		t.Fatalf("actor display name = %q, want Jonathan Kim", actor.User.DisplayName)
	}
}
