package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"miraeopus/backend/internal/store"
)

func parseOptionalExpectedRevision(r *http.Request) (*int64, error) {
	value := strings.TrimSpace(r.URL.Query().Get("expected_revision"))
	if value == "" {
		return nil, nil
	}
	revision, err := strconv.ParseInt(value, 10, 64)
	if err != nil || revision < 0 {
		return nil, store.ErrInvalid
	}
	return &revision, nil
}

func writeProjectionRevisionConflict(w http.ResponseWriter, conflict *store.ProjectionRevisionConflictError) {
	var current any
	if conflict != nil && conflict.NodeCurrent != nil {
		current = conflict.NodeCurrent
	} else if conflict != nil && conflict.LogicGateCurrent != nil {
		current = conflict.LogicGateCurrent
	}
	writeJSON(w, http.StatusConflict, map[string]any{
		"error":   "projection_revision_conflict",
		"current": current,
	})
}
