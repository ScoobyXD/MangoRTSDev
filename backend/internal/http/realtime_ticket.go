package httpapi

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

const realtimeTicketTTL = 30 * time.Second
const realtimeTicketCookieName = "mangorts_realtime_ticket"

type realtimeTicket struct {
	Actor     ActorContext
	CompanyID string
	ExpiresAt time.Time
}

type realtimeTicketStore struct {
	mu      sync.Mutex
	tickets map[string]realtimeTicket
}

func newRealtimeTicketStore() *realtimeTicketStore {
	return &realtimeTicketStore{tickets: map[string]realtimeTicket{}}
}

func (s *realtimeTicketStore) mint(actor ActorContext, companyID string) (string, time.Time) {
	if s == nil {
		return "", time.Time{}
	}
	companyID = strings.TrimSpace(companyID)
	token := newRealtimeConnectionID()
	expiresAt := time.Now().UTC().Add(realtimeTicketTTL)
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
