package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"miraeopus/backend/internal/auth"
	"net/http"
	"strings"
)

type authClaimsContextKey struct{}

func (s *Server) withAuth(next http.Handler) http.Handler {
	if s.authValidator == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/v1/") {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		claims, err := s.authValidator.Validate(r.Context(), bearerToken(r.Header.Get("Authorization")))
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if _, err := s.repo.UpsertAuthUser(claims.Subject, claims.Email); err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_record_authenticated_user")
			return
		}

		companyID, err := requestCompanyID(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_company_id_payload")
			return
		}
		if companyID != "" {
			ok, err := s.repo.UserHasCompanyAccess(claims.Subject, companyID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_check_company_access")
				return
			}
			if !ok {
				writeError(w, http.StatusForbidden, "company_access_denied")
				return
			}
		}

		ctx := context.WithValue(r.Context(), authClaimsContextKey{}, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func bearerToken(header string) string {
	header = strings.TrimSpace(header)
	if header == "" {
		return ""
	}
	prefix := "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, prefix))
}

func requestCompanyID(r *http.Request) (string, error) {
	if r.Body == nil || (r.Method != http.MethodPost && r.Method != http.MethodPut && r.Method != http.MethodPatch) {
		return strings.TrimSpace(r.URL.Query().Get("company_id")), nil
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return "", err
	}
	_ = r.Body.Close()
	r.Body = io.NopCloser(bytes.NewReader(body))
	if len(bytes.TrimSpace(body)) == 0 {
		return "", nil
	}
	var payload struct {
		CompanyID string `json:"company_id"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", err
	}
	if value := strings.TrimSpace(payload.CompanyID); value != "" {
		return value, nil
	}
	return strings.TrimSpace(r.URL.Query().Get("company_id")), nil
}

func authenticatedClaims(r *http.Request) (auth.Claims, bool) {
	claims, ok := r.Context().Value(authClaimsContextKey{}).(auth.Claims)
	return claims, ok
}
