package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"miraeopus/backend/internal/store"
)

// Hermes discovers the same canonical resources and visible paths as Explorer.
// Names are search input only; mutations still require the selected exact IDs.
func (s *Server) handleHermesSearch(w http.ResponseWriter, r *http.Request, companyID string, raw json.RawMessage) {
	var args struct {
		Query         string   `json:"query"`
		ResourceTypes []string `json:"resource_types"`
		Limit         *int     `json:"limit"`
	}
	if !decodeHermesArguments(raw, &args) || strings.TrimSpace(args.Query) == "" || len(args.Query) > 500 || (args.Limit != nil && (*args.Limit <= 0 || *args.Limit > store.CompanyExplorerSearchMaxLimit)) {
		writeError(w, http.StatusBadRequest, "invalid_action_arguments")
		return
	}
	read := hermesReadRequest(r, companyID, "/v1/company-explorer/search")
	query := read.URL.Query()
	query.Set("q", strings.TrimSpace(args.Query))
	query["resource_types"] = args.ResourceTypes
	if args.Limit != nil {
		query.Set("limit", strconv.Itoa(*args.Limit))
	}
	read.URL.RawQuery = query.Encode()
	s.handleCompanyExplorerSearch(w, read)
}
