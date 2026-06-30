package httpapi

import (
	"net/http"
	"strings"
)

const confirmationDisplayNameHeader = "X-Mango-Confirmation-Display-Name"

func confirmationDisplayNameFromHeader(r *http.Request) string {
	if r == nil {
		return ""
	}
	return r.Header.Get(confirmationDisplayNameHeader)
}

func requireActorDisplayNameConfirmation(w http.ResponseWriter, r *http.Request, submittedDisplayName string) (ActorContext, bool) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return ActorContext{}, false
	}
	expectedDisplayName := strings.TrimSpace(actor.User.DisplayName)
	if expectedDisplayName == "" {
		writeError(w, http.StatusForbidden, "display_name_required")
		return ActorContext{}, false
	}
	if strings.TrimSpace(submittedDisplayName) != expectedDisplayName {
		writeError(w, http.StatusForbidden, "display_name_confirmation_required")
		return ActorContext{}, false
	}
	if strings.TrimSpace(actor.User.UserID) == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return ActorContext{}, false
	}
	return actor, true
}
