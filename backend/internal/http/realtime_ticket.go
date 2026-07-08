package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/domain"
	"net/http"
	"strings"
	"sync"
	"time"
)

const realtimeTicketTTL = 30 * time.Second
const realtimeTicketCookieName = "mangorts_realtime_ticket"
const realtimeSignedTicketVersion = 1

type realtimeTicket struct {
	Actor     ActorContext
	CompanyID string
	ExpiresAt time.Time
}

type realtimeSignedTicketPayload struct {
	Version   int          `json:"v"`
	Actor     ActorContext `json:"actor"`
	CompanyID string       `json:"company_id"`
	IssuedAt  int64        `json:"issued_at"`
	ExpiresAt int64        `json:"expires_at"`
}

type realtimeTicketStore struct {
	mu      sync.Mutex
	tickets map[string]realtimeTicket
	secret  string
}

func newRealtimeTicketStore(secret string) *realtimeTicketStore {
	return &realtimeTicketStore{tickets: map[string]realtimeTicket{}, secret: strings.TrimSpace(secret)}
}

func (s *realtimeTicketStore) mint(actor ActorContext, companyID string) (string, time.Time) {
	if s == nil {
		return "", time.Time{}
	}
	companyID = strings.TrimSpace(companyID)
	expiresAt := time.Now().UTC().Add(realtimeTicketTTL)
	if strings.TrimSpace(s.secret) != "" {
		token, err := s.mintSigned(actor, companyID, expiresAt)
		if err == nil {
			return token, expiresAt
		}
		log.Printf("realtime_ticket_signed_mint_failed company_id=%s user_id=%s: %v", companyID, strings.TrimSpace(actor.User.UserID), err)
	}
	token := newRealtimeConnectionID()
	s.mu.Lock()
	s.cleanupLocked(time.Now().UTC())
	s.tickets[token] = realtimeTicket{Actor: actor, CompanyID: companyID, ExpiresAt: expiresAt}
	s.mu.Unlock()
	return token, expiresAt
}

func (s *realtimeTicketStore) consume(token, companyID string) (ActorContext, bool) {
	if s == nil {
		return ActorContext{}, false
	}
	token = strings.TrimSpace(token)
	companyID = strings.TrimSpace(companyID)
	if token == "" || companyID == "" {
		return ActorContext{}, false
	}
	if strings.TrimSpace(s.secret) != "" {
		if actor, ok := s.consumeSigned(token, companyID, time.Now().UTC()); ok {
			return actor, true
		}
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(now)
	ticket, ok := s.tickets[token]
	if !ok || ticket.CompanyID != companyID || ticket.ExpiresAt.Before(now) {
		delete(s.tickets, token)
		return ActorContext{}, false
	}
	delete(s.tickets, token)
	actor := ticket.Actor
	actor.CompanyID = companyID
	actor.CompanyRole = actorRoleForCompany(actor, companyID)
	return actor, true
}

func (s *realtimeTicketStore) cleanupLocked(now time.Time) {
	for token, ticket := range s.tickets {
		if ticket.ExpiresAt.Before(now) {
			delete(s.tickets, token)
		}
	}
}

func (s *realtimeTicketStore) mintSigned(actor ActorContext, companyID string, expiresAt time.Time) (string, error) {
	payload := realtimeSignedTicketPayload{
		Version:   realtimeSignedTicketVersion,
		Actor:     realtimeTicketActor(actor, companyID),
		CompanyID: companyID,
		IssuedAt:  time.Now().UTC().Unix(),
		ExpiresAt: expiresAt.UTC().Unix(),
	}
	if payload.CompanyID == "" || payload.Actor.User.UserID == "" || payload.ExpiresAt <= 0 {
		return "", errors.New("invalid realtime ticket payload")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	body := base64.RawURLEncoding.EncodeToString(raw)
	signature := s.sign(body)
	return body + "." + signature, nil
}

func (s *realtimeTicketStore) consumeSigned(token, companyID string, now time.Time) (ActorContext, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return ActorContext{}, false
	}
	expected := s.sign(parts[0])
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return ActorContext{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return ActorContext{}, false
	}
	var payload realtimeSignedTicketPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return ActorContext{}, false
	}
	if payload.Version != realtimeSignedTicketVersion || strings.TrimSpace(payload.CompanyID) != companyID || payload.ExpiresAt <= 0 {
		return ActorContext{}, false
	}
	expiresAt := time.Unix(payload.ExpiresAt, 0).UTC()
	issuedAt := time.Unix(payload.IssuedAt, 0).UTC()
	if now.Before(issuedAt.Add(-time.Minute)) || now.After(expiresAt) {
		return ActorContext{}, false
	}
	actor := payload.Actor
	actor.User.UserID = strings.TrimSpace(actor.User.UserID)
	if actor.User.UserID == "" {
		return ActorContext{}, false
	}
	actor.Memberships = normalizeMembershipRoles(actor.Memberships)
	actor.CompanyID = companyID
	actor.CompanyRole = actorRoleForCompany(actor, companyID)
	if actor.CompanyRole == "" {
		return ActorContext{}, false
	}
	return actor, true
}

func (s *realtimeTicketStore) sign(body string) string {
	mac := hmac.New(sha256.New, []byte(strings.TrimSpace(s.secret)))
	_, _ = mac.Write([]byte(body))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func realtimeTicketActor(actor ActorContext, companyID string) ActorContext {
	companyID = strings.TrimSpace(companyID)
	userID := strings.TrimSpace(actor.User.UserID)
	out := ActorContext{
		User:       domain.User{UserID: userID},
		IsDevAdmin: actor.IsDevAdmin,
	}
	out.CompanyID = ""
	out.CompanyRole = ""
	for _, membership := range normalizeMembershipRoles(actor.Memberships) {
		if membership.CompanyID == companyID || membership.Role == domain.RoleDevAdmin {
			out.Memberships = append(out.Memberships, domain.CompanyMembership{
				CompanyID: membership.CompanyID,
				UserID:    strings.TrimSpace(membership.UserID),
				Role:      membership.Role,
			})
		}
	}
	return out
}

func (s *Server) handleRealtimeTicket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req struct {
		CompanyID string `json:"company_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	companyID := strings.TrimSpace(req.CompanyID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if actorRoleForCompany(actor, companyID) == "" {
		log.Printf("realtime_ticket_rejected company_id=%s user_id=%s error=company_access_denied", companyID, strings.TrimSpace(actor.User.UserID))
		writeError(w, http.StatusForbidden, "company_access_denied")
		return
	}
	ticket, expiresAt := s.realtimeTickets.mint(actor, companyID)
	if ticket == "" {
		log.Printf("realtime_ticket_rejected company_id=%s user_id=%s error=failed_to_create_realtime_ticket", companyID, strings.TrimSpace(actor.User.UserID))
		writeError(w, http.StatusInternalServerError, "failed_to_create_realtime_ticket")
		return
	}
	log.Printf("realtime_ticket_issued company_id=%s user_id=%s expires_at=%s", companyID, strings.TrimSpace(actor.User.UserID), expiresAt.Format(time.RFC3339))
	http.SetCookie(w, &http.Cookie{
		Name:     realtimeTicketCookieName,
		Value:    ticket,
		Path:     "/v1/realtime/ws",
		Expires:  expiresAt,
		MaxAge:   int(realtimeTicketTTL / time.Second),
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   realtimeTicketCookieSecure(r),
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"expires_at": expiresAt,
	})
}

func realtimeTicketCookieSecure(r *http.Request) bool {
	if r == nil {
		return false
	}
	if r.TLS != nil {
		return true
	}
	if strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https") {
		return true
	}
	return strings.Contains(strings.ToLower(r.Header.Get("Forwarded")), "proto=https")
}
