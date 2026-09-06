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
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
	"time"
)

type authClaimsContextKey struct{}
type actorContextKey struct{}

const (
	maxCompanyIDPayloadScanBytes int64 = 1 << 20
	defaultAuthResolutionTimeout       = 6 * time.Second
)

var errCompanyIDScanLimit = errors.New("company_id_scan_limit_exceeded")

type ActorContext struct {
	Claims      auth.Claims                `json:"-"`
	User        domain.User                `json:"user"`
	Memberships []domain.CompanyMembership `json:"memberships"`
	CompanyID   string                     `json:"company_id,omitempty"`
	CompanyRole string                     `json:"company_role,omitempty"`
	IsDevAdmin  bool                       `json:"is_dev_admin"`
}

func (s *Server) testAuthActor(r *http.Request) (ActorContext, error) {
	subject := strings.TrimSpace(r.Header.Get("X-Mango-Test-Subject"))
	if subject == "" || len(subject) > 160 {
		return ActorContext{}, errors.New("test_auth_subject_required")
	}
	return s.authenticatedActorForClaims(r.Context(), auth.Claims{
		Subject: subject,
		Email:   subject + "@mangorts.test",
		Name:    subject,
	})
}

func (s *Server) withAuth(next http.Handler) http.Handler {
	if s.authValidator == nil && !s.testAuthHeaderEnabled {
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
		// Gate before consumeRealtimeTicketActor: an initialization retry must
		// not burn a one-time cookie or register a socket against an uncertified
		// outbox cursor.
		if r.URL.Path == "/v1/realtime/ws" && isWebSocketUpgradeRequest(r) && s.rejectRealtimeAdmissionWhileUnready(w) {
			return
		}
		if actor, ok := s.consumeRealtimeTicketActor(r); ok {
			ctx := context.WithValue(r.Context(), actorContextKey{}, actor)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		if s.authValidator == nil {
			actor, err := s.testAuthActor(r)
			if err != nil {
				if s.testAuthHeaderEnabled {
					log.Printf("test-only authentication failed path=%s header_present=%t: %v", r.URL.Path, strings.TrimSpace(r.Header.Get("X-Mango-Test-Subject")) != "", err)
				}
				writeError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			if !authorizeMailboxRequest(w, r, actor) {
				return
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
				actor.CompanyID, actor.CompanyRole = companyID, role
				if !s.authorizeCompanyRequest(w, r, actor, companyID, role) {
					return
				}
			}
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
		actor, err := s.authenticatedActorForClaims(r.Context(), claims)
		if err != nil {
			s.writeAuthResolutionError(w, r, claims, err)
			return
		}
		if !authorizeMailboxRequest(w, r, actor) {
			return
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

func authorizeMailboxRequest(w http.ResponseWriter, r *http.Request, actor ActorContext) bool {
	if !actor.User.MailboxEnabled && (r.URL.Path == "/v1/communications" || strings.HasPrefix(r.URL.Path, "/v1/communications/")) {
		writeError(w, http.StatusForbidden, "mailbox_disabled")
		return false
	}
	return true
}

type authActorResolution struct {
	claimsKey authMembershipCacheKey
	actor     ActorContext
	retry     bool
}

type authMembershipResolution struct {
	generation  uint64
	memberships []domain.CompanyMembership
}

func (s *Server) authenticatedActorForClaims(ctx context.Context, claims auth.Claims) (ActorContext, error) {
	if ctx == nil {
		return ActorContext{}, errors.New("authentication_context_required")
	}
	if err := ctx.Err(); err != nil {
		return ActorContext{}, err
	}
	resolutionTimeout := s.authResolutionTimeout
	if resolutionTimeout <= 0 {
		resolutionTimeout = defaultAuthResolutionTimeout
	}
	resolutionContext, cancelResolution := context.WithTimeout(ctx, resolutionTimeout)
	defer cancelResolution()
	key := cacheKeyForClaims(claims)
	if key.subject == "" {
		return ActorContext{}, store.ErrInvalid
	}
	for {
		if actor, ok := s.authCache.get(claims); ok {
			return actor, nil
		}
		result := s.authFlights.DoChan(key.subject, func() (any, error) {
			if actor, ok := s.authCache.get(claims); ok {
				return authActorResolution{claimsKey: key, actor: actor}, nil
			}
			generation := s.authCache.snapshotGeneration()
			actor, err := s.loadAuthenticatedActor(resolutionContext, claims)
			if err != nil {
				return authActorResolution{}, err
			}
			if !s.authCache.setIfGeneration(claims, actor, generation) {
				return authActorResolution{retry: true}, nil
			}
			return authActorResolution{claimsKey: key, actor: actor}, nil
		})

		select {
		case <-resolutionContext.Done():
			return ActorContext{}, resolutionContext.Err()
		case completed := <-result:
			if completed.Err != nil {
				if resolutionErr := resolutionContext.Err(); resolutionErr != nil {
					return ActorContext{}, resolutionErr
				}
				if (errors.Is(completed.Err, context.Canceled) || errors.Is(completed.Err, context.DeadlineExceeded)) && resolutionContext.Err() == nil {
					continue
				}
				return ActorContext{}, completed.Err
			}
			resolution, ok := completed.Val.(authActorResolution)
			if !ok {
				return ActorContext{}, errors.New("invalid_auth_actor_resolution")
			}
			if resolution.retry || resolution.claimsKey != key {
				continue
			}
			actor := cloneActorContext(resolution.actor)
			actor.Claims = claims
			return actor, nil
		}
	}
}

func (s *Server) loadAuthenticatedActor(ctx context.Context, claims auth.Claims) (ActorContext, error) {
	user, err := s.repo.ResolveAuthUserContext(ctx, claims.Subject, claims.Email, claims.Name, claims.IssuedAt)
	if err != nil {
		return ActorContext{}, err
	}
	memberships, err := s.freshUserMemberships(ctx, user.UserID)
	if err != nil {
		return ActorContext{}, err
	}
	if len(memberships) == 0 {
		bootstrapped, err := s.maybeBootstrapDevAdmin(ctx, claims)
		if err != nil {
			return ActorContext{}, err
		}
		if !bootstrapped {
			_, bootstrapped, err = s.repo.EnsureInitialCompanyContext(ctx, claims.Subject)
			if err != nil {
				return ActorContext{}, err
			}
			if bootstrapped {
				s.authCache.invalidateUser(user.UserID)
				s.wakeRealtimeSpine()
			}
		}
		memberships, err = s.freshUserMemberships(ctx, user.UserID)
		if err != nil {
			return ActorContext{}, err
		}
	}
	actor := ActorContext{
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
	return actor, nil
}

func (s *Server) freshUserMemberships(ctx context.Context, userID string) ([]domain.CompanyMembership, error) {
	if ctx == nil {
		return nil, errors.New("authentication_context_required")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	resolutionTimeout := s.authResolutionTimeout
	if resolutionTimeout <= 0 {
		resolutionTimeout = defaultAuthResolutionTimeout
	}
	loadContext, cancelLoad := context.WithTimeout(ctx, resolutionTimeout)
	defer cancelLoad()
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, store.ErrInvalid
	}
	for {
		result := s.authMembershipFlights.DoChan(userID, func() (any, error) {
			generation := s.authCache.snapshotGeneration()
			memberships, err := s.repo.ListUserMembershipsContext(loadContext, userID)
			if err != nil {
				return authMembershipResolution{}, err
			}
			return authMembershipResolution{generation: generation, memberships: memberships}, nil
		})
		select {
		case <-loadContext.Done():
			return nil, loadContext.Err()
		case completed := <-result:
			if completed.Err != nil {
				if loadErr := loadContext.Err(); loadErr != nil {
					return nil, loadErr
				}
				if (errors.Is(completed.Err, context.Canceled) || errors.Is(completed.Err, context.DeadlineExceeded)) && loadContext.Err() == nil {
					continue
				}
				return nil, completed.Err
			}
			resolution, ok := completed.Val.(authMembershipResolution)
			if !ok {
				return nil, errors.New("invalid_auth_membership_resolution")
			}
			if resolution.generation != s.authCache.snapshotGeneration() {
				continue
			}
			return append([]domain.CompanyMembership(nil), resolution.memberships...), nil
		}
	}
}

func (s *Server) writeAuthResolutionError(w http.ResponseWriter, r *http.Request, claims auth.Claims, err error) {
	if errors.Is(err, context.Canceled) && r.Context().Err() != nil {
		return
	}
	log.Printf("authentication resolution failed path=%s subject=%s: %v", r.URL.Path, claims.Subject, err)
	if isAuthResolutionTimeout(err) {
		writeError(w, http.StatusGatewayTimeout, "authentication_timeout")
		return
	}
	writeError(w, http.StatusServiceUnavailable, "authentication_unavailable")
}

func isAuthResolutionTimeout(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var postgresError interface{ SQLState() string }
	if !errors.As(err, &postgresError) {
		return false
	}
	switch postgresError.SQLState() {
	case "55P03", "57014":
		return true
	default:
		return false
	}
}

func (s *Server) maybeBootstrapDevAdmin(ctx context.Context, claims auth.Claims) (bool, error) {
	config := s.bootstrapDevAdmin
	email := normalizeEmailForCompare(claims.Email)
	if !claims.EmailVerified || email == "" || len(config.Emails) == 0 {
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
	membership, bootstrapped, err := s.repo.BootstrapDevAdminContext(ctx, claims.Subject, config.CompanyName)
	if err != nil {
		return false, err
	}
	if bootstrapped {
		s.wakeRealtimeSpine()
		log.Printf("bootstrapped dev admin email=%s subject=%s company_id=%s", email, claims.Subject, membership.CompanyID)
	}
	return true, nil
}

func isPublicAuthEndpoint(path string) bool {
	switch path {
	case "/v1/invitations/validate", "/v1/invitations/accept":
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
	return r.Method == http.MethodPost && (r.URL.Path == "/v1/communications/messages/send" || r.URL.Path == "/v1/attachments")
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

func (s *Server) currentActorRoleForCompanyContext(ctx context.Context, actor ActorContext, companyID string) (string, error) {
	userID := strings.TrimSpace(actor.User.UserID)
	companyID = strings.TrimSpace(companyID)
	if userID == "" || companyID == "" {
		return "", nil
	}
	memberships, err := s.freshUserMemberships(ctx, userID)
	if err != nil {
		return "", err
	}
	fresh := actor
	fresh.Memberships = normalizeMembershipRoles(memberships)
	fresh.IsDevAdmin = false
	for _, membership := range fresh.Memberships {
		if membership.Role == domain.RoleDevAdmin {
			fresh.IsDevAdmin = true
			break
		}
	}
	return actorRoleForCompany(fresh, companyID), nil
}

func (s *Server) authorizeCompanyRequest(w http.ResponseWriter, r *http.Request, actor ActorContext, companyID, role string) bool {
	if actor.IsDevAdmin || role == domain.RoleCompanyAdmin || role == domain.RoleCompanyManager || role == domain.RoleCompanyUser {
		return true
	}
	writeError(w, http.StatusForbidden, "company_access_denied")
	return false
}
