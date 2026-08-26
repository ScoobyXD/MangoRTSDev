package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
	"time"
)

func (s *Server) handleLogicGateQDRatings(w http.ResponseWriter, r *http.Request, logicGateID string, pathParts []string) {
	if len(pathParts) == 0 && r.Method == http.MethodGet {
		s.handleListLogicGateQDRatings(w, r, logicGateID)
		return
	}
	if len(pathParts) == 1 && r.Method == http.MethodPut {
		s.handlePutLogicGateQDRating(w, r, logicGateID, pathParts[0])
		return
	}
	if len(pathParts) > 1 || (r.Method != http.MethodGet && r.Method != http.MethodPut) {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	writeError(w, http.StatusNotFound, "not_found")
}

func (s *Server) handleListLogicGateQDRatings(w http.ResponseWriter, r *http.Request, logicGateID string) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	monthText := strings.TrimSpace(r.URL.Query().Get("month"))
	if companyID == "" || monthText == "" {
		writeError(w, http.StatusBadRequest, "company_id_and_month_required")
		return
	}
	month, err := time.Parse("2006-01", monthText)
	if err != nil || month.Format("2006-01") != monthText {
		writeError(w, http.StatusBadRequest, "invalid_month")
		return
	}
	if !s.requireEntityEdit(w, r, companyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
		return
	}
	items, err := s.repo.ListLogicGateQDRatings(store.QDRatingMonthQuery{
		CompanyID: companyID, LogicGateID: logicGateID, Year: month.Year(), Month: month.Month(),
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_qd_ratings_query")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_qd_ratings")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"qd_ratings": items})
}

func (s *Server) handlePutLogicGateQDRating(w http.ResponseWriter, r *http.Request, logicGateID, metric string) {
	metric = strings.TrimSpace(metric)
	if metric != store.QDRatingMetricQuality && metric != store.QDRatingMetricCost && metric != store.QDRatingMetricDelivery {
		writeError(w, http.StatusBadRequest, "invalid_qd_rating_metric")
		return
	}
	var request struct {
		CompanyID string          `json:"company_id"`
		Rating    json.RawMessage `json:"rating"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	request.CompanyID = strings.TrimSpace(request.CompanyID)
	if request.CompanyID == "" || len(request.Rating) == 0 {
		writeError(w, http.StatusBadRequest, "company_id_and_rating_required")
		return
	}
	var rating *string
	if !bytes.Equal(bytes.TrimSpace(request.Rating), []byte("null")) {
		var value string
		if err := json.Unmarshal(request.Rating, &value); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_qd_rating")
			return
		}
		rating = &value
	}
	actor, ok := authenticatedActor(r)
	if !ok || strings.TrimSpace(actor.User.UserID) == "" || strings.TrimSpace(actor.User.DisplayName) == "" {
		writeError(w, http.StatusUnauthorized, "authenticated_user_required")
		return
	}
	if !s.requireEntityEdit(w, r, request.CompanyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
		return
	}
	result, err := s.repo.PutLogicGateQDRating(store.QDRatingPutInput{
		CompanyID: request.CompanyID, LogicGateID: logicGateID, Metric: metric, Rating: rating,
		RatedByUserID: actor.User.UserID, RatedByDisplayName: actor.User.DisplayName, Now: time.Now().UTC(),
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_qd_rating")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_save_qd_rating")
		return
	}
	if result.Changed {
		s.wakeRealtimeSpine()
	}
	writeJSON(w, http.StatusOK, map[string]any{"qd_rating": result.QDRating})
}
