package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type Server struct {
	repo store.Repository
}

func NewServer(repo store.Repository) *Server {
	return &Server{repo: repo}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/v1/cases", s.handleCases)
	mux.HandleFunc("/v1/cases/", s.handleCaseSubresource)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleCases(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		Title    string  `json:"title"`
		Owner    string  `json:"owner"`
		ParentID *string `json:"parent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeError(w, http.StatusBadRequest, "title_required")
		return
	}
	if strings.TrimSpace(req.Owner) == "" {
		req.Owner = "unassigned"
	}
	created, err := s.repo.CreateCase(req.Title, req.Owner, req.ParentID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "parent_case_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_case")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) handleCaseSubresource(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/v1/cases/")
	parts := strings.Split(trimmed, "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	caseID := parts[0]

	if len(parts) == 1 {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		result, err := s.repo.GetCase(caseID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "case_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_case")
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	}

	switch parts[1] {
	case "artifacts":
		s.handleArtifacts(caseID, parts, w, r)
	case "children":
		s.handleChildren(caseID, w, r)
	default:
		writeError(w, http.StatusNotFound, "not_found")
	}
}

func (s *Server) handleArtifacts(caseID string, parts []string, w http.ResponseWriter, r *http.Request) {
	if len(parts) == 2 && r.Method == http.MethodPost {
		var req struct {
			Type      domain.ArtifactType `json:"type"`
			SourceRef string              `json:"source_ref"`
			Content   string              `json:"content"`
			CreatedBy string              `json:"created_by"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if req.CreatedBy == "" {
			req.CreatedBy = "system"
		}
		artifact, err := s.repo.AddArtifact(caseID, store.AddArtifactInput{
			Type:      req.Type,
			SourceRef: req.SourceRef,
			Content:   req.Content,
			CreatedBy: req.CreatedBy,
		})
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "case_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_add_artifact")
			return
		}
		writeJSON(w, http.StatusCreated, artifact)
		return
	}

	if len(parts) == 3 && r.Method == http.MethodDelete {
		if err := s.repo.DeleteArtifact(caseID, parts[2]); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "artifact_not_found")
				return
			}
			writeError(w, http.StatusInternalServerError, "failed_to_delete_artifact")
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}

func (s *Server) handleChildren(caseID string, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		Title string `json:"title"`
		Owner string `json:"owner"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeError(w, http.StatusBadRequest, "title_required")
		return
	}
	if strings.TrimSpace(req.Owner) == "" {
		req.Owner = "unassigned"
	}
	created, err := s.repo.CreateCase(req.Title, req.Owner, &caseID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "case_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_child")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}
