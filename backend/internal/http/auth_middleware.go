package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/domain"
	"net/http"
	"strings"
)

type authClaimsContextKey struct{}
type actorContextKey struct{}

const maxCompanyIDPayloadScanBytes int64 = 1 << 20

var errCompanyIDScanLimit = errors.New("company_id_scan_limit_exceeded")

type ActorContext struct {
	Claims      auth.Claims                `json:"-"`
	User        domain.User                `json:"user"`
	Memberships []domain.CompanyMembership `json:"memberships"`
	CompanyID   string                     `json:"company_id,omitempty"`
	CompanyRole string                     `json:"company_role,omitempty"`
	IsDevAdmin  bool                       `json:"is_dev_admin"`
}

func (s *Server) withAuth(next http.Handler) http.Handler {
	if s.authValidator == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/v1/") && !strings.HasPrefix(r.URL.Path, "/v2/") {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if isPublicAuthEndpoint(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		if actor, ok := s.consumeRealtimeTicketActor(r); ok {
			ctx := context.WithValue(r.Context(), actorContextKey{}, actor)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		claims, err := s.authValidator.Validate(r.Context(), requestAuthToken(r))
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if isClaimsOnlyAuthEndpoint(r.URL.Path) {
			ctx := context.WithValue(r.Context(), authClaimsContextKey{}, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		actor, ok := s.authCache.get(claims)
		if !ok {
			user, err := s.repo.UpsertAuthUser(claims.Subject, claims.Email, claims.Name)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_record_authenticated_user")
				return
			}
			memberships, err := s.repo.ListUserMemberships(user.UserID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_load_memberships")
				return
			}
			if len(memberships) == 0 {
				bootstrapped, err := s.maybeBootstrapDevAdmin(claims)
				if err != nil {
					log.Printf("failed to bootstrap dev admin email=%s subject=%s: %v", claims.Email, claims.Subject, err)
					writeError(w, http.StatusInternalServerError, "failed_to_bootstrap_dev_admin")
					return
				}
				if bootstrapped {
					memberships, err = s.repo.ListUserMemberships(user.UserID)
					if err != nil {
						writeError(w, http.StatusInternalServerError, "failed_to_load_memberships")
						return
					}
				}
			}
			actor = ActorContext{
				Claims:      claims,
				User:        user,
				Memberships: normalizeMembershipRoles(memberships),
			}
			for _, membership := range actor.Memberships {
				if membership.Role == domain.RoleDevAdmin {
					actor.IsDevAdmin = true
					break
				}
			}
			s.authCache.set(claims, actor)
		}

		companyID, err := requestCompanyID(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_company_id_payload")
			return
		}
		if companyID != "" {
			role := actorRoleForCompany(actor, companyID)
			if !actor.IsDevAdmin && role == "" {
				writeError(w, http.StatusForbidden, "company_access_denied")
				return
			}
			actor.CompanyID = companyID
			actor.CompanyRole = role
			if !s.authorizeCompanyRequest(w, r, actor, companyID, role) {
				return
			}
		}

		ctx := context.WithValue(r.Context(), authClaimsContextKey{}, claims)
		ctx = context.WithValue(ctx, actorContextKey{}, actor)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) maybeBootstrapDevAdmin(claims auth.Claims) (bool, error) {
	config := s.bootstrapDevAdmin
	email := normalizeEmailForCompare(claims.Email)
	if email == "" || len(config.Emails) == 0 {
		return false, nil
	}
	allowed := false
	for _, candidate := range config.Emails {
		if candidate == email {
			allowed = true
			break
		}
	}
	if !allowed {
		return false, nil
	}
	company, err := s.repo.CreateCompany(config.CompanyName)
	if err != nil {
		return false, err
	}
	if _, err := s.repo.AddCompanyMembership(claims.Subject, company.CompanyID, domain.RoleDevAdmin); err != nil {
		return false, err
	}
	log.Printf("bootstrapped dev admin email=%s subject=%s company_id=%s", email, claims.Subject, company.CompanyID)
	return true, nil
}

func isPublicAuthEndpoint(path string) bool {
	switch path {
	case "/v1/password-resets/request", "/v1/invitations/validate":
		return true
	default:
		return false
	}
}

func isClaimsOnlyAuthEndpoint(path string) bool {
	switch path {
	case "/v1/invitations/accept":
		return true
	default:
		return false
	}
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

func requestAuthToken(r *http.Request) string {
	if r == nil {
		return ""
	}
	if token := bearerToken(r.Header.Get("Authorization")); token != "" {
		return token
	}
	return ""
}

func (s *Server) consumeRealtimeTicketActor(r *http.Request) (ActorContext, bool) {
	if s == nil || r == nil || r.URL == nil || r.URL.Path != "/v1/realtime/ws" || !isWebSocketUpgradeRequest(r) {
		return ActorContext{}, false
	}
	if strings.TrimSpace(r.URL.Query().Get("ticket")) != "" {
		return ActorContext{}, false
	}
	cookie, err := r.Cookie(realtimeTicketCookieName)
	if err != nil {
		return ActorContext{}, false
	}
	ticket := strings.TrimSpace(cookie.Value)
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	return s.realtimeTickets.consume(ticket, companyID)
}

func requestCompanyID(r *http.Request) (string, error) {
	queryCompanyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if r.Body == nil || (r.Method != http.MethodPost && r.Method != http.MethodPut && r.Method != http.MethodPatch) {
		return queryCompanyID, nil
	}
	if requestBodyCompanyIDIgnoredByHandler(r) {
		return queryCompanyID, nil
	}
	bodyCompanyID, found, err := readCompanyIDFromJSONBody(r, maxCompanyIDPayloadScanBytes)
	if err != nil {
		return "", err
	}
	if found && bodyCompanyID != "" {
		return bodyCompanyID, nil
	}
	return queryCompanyID, nil
}

func requestBodyCompanyIDIgnoredByHandler(r *http.Request) bool {
	return r.Method == http.MethodPost && r.URL.Path == "/v1/communications/messages/send"
}

func readCompanyIDFromJSONBody(r *http.Request, maxScanBytes int64) (string, bool, error) {
	originalBody := r.Body
	recorder := &limitedRecordingReader{source: originalBody, maxBytes: maxScanBytes}
	defer func() {
		r.Body = replayReadCloser{
			Reader: io.MultiReader(bytes.NewReader(recorder.recorded.Bytes()), originalBody),
			closer: originalBody,
		}
	}()

	decoder := json.NewDecoder(recorder)
	token, err := decoder.Token()
	if errors.Is(err, io.EOF) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	delim, ok := token.(json.Delim)
	if !ok || delim != '{' {
		return "", false, errors.New("company_id_payload_must_be_json_object")
	}
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return "", false, err
		}
		key, ok := keyToken.(string)
		if !ok {
			return "", false, errors.New("company_id_payload_key_must_be_string")
		}
		if key != "company_id" {
			var discard json.RawMessage
			if err := decoder.Decode(&discard); err != nil {
				return "", false, err
			}
			continue
		}
		var value *string
		if err := decoder.Decode(&value); err != nil {
			return "", false, err
		}
		if value == nil {
			return "", true, nil
		}
		return strings.TrimSpace(*value), true, nil
	}
	return "", false, nil
}

type limitedRecordingReader struct {
	source   io.Reader
	recorded bytes.Buffer
	maxBytes int64
}

func (r *limitedRecordingReader) Read(p []byte) (int, error) {
	if r.maxBytes <= 0 || int64(r.recorded.Len()) >= r.maxBytes {
		return 0, errCompanyIDScanLimit
	}
	if remaining := int(r.maxBytes - int64(r.recorded.Len())); len(p) > remaining {
		p = p[:remaining]
	}
	n, err := r.source.Read(p)
	if n > 0 {
		_, _ = r.recorded.Write(p[:n])
	}
	return n, err
}

type replayReadCloser struct {
	io.Reader
	closer io.Closer
}

func (r replayReadCloser) Close() error {
	return r.closer.Close()
}

func authenticatedClaims(r *http.Request) (auth.Claims, bool) {
	claims, ok := r.Context().Value(authClaimsContextKey{}).(auth.Claims)
	return claims, ok
}

func authenticatedActor(r *http.Request) (ActorContext, bool) {
	actor, ok := r.Context().Value(actorContextKey{}).(ActorContext)
	return actor, ok
}

func normalizeMembershipRoles(memberships []domain.CompanyMembership) []domain.CompanyMembership {
	normalized := make([]domain.CompanyMembership, 0, len(memberships))
	for _, membership := range memberships {
		role := domain.NormalizeRole(membership.Role)
		if role == "" {
			role = domain.RoleCompanyUser
		}
		membership.Role = role
		normalized = append(normalized, membership)
	}
	return normalized
}

func actorRoleForCompany(actor ActorContext, companyID string) string {
	companyID = strings.TrimSpace(companyID)
	for _, membership := range actor.Memberships {
		if membership.CompanyID == companyID {
			return membership.Role
		}
	}
	if actor.IsDevAdmin {
		return domain.RoleDevAdmin
	}
	return ""
}

func (s *Server) authorizeCompanyRequest(w http.ResponseWriter, r *http.Request, actor ActorContext, companyID, role string) bool {
	if actor.IsDevAdmin || role == domain.RoleCompanyAdmin || role == domain.RoleCompanyUser {
		return true
	}
	writeError(w, http.StatusForbidden, "company_access_denied")
	return false
}
