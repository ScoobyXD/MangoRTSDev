package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

const realtimeTicketTTL = 30 * time.Second

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
		writeError(w, http.StatusForbidden, "company_access_denied")
		return
	}
	ticket, expiresAt := s.realtimeTickets.mint(actor, companyID)
	if ticket == "" {
		writeError(w, http.StatusInternalServerError, "failed_to_create_realtime_ticket")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ticket":     ticket,
		"expires_at": expiresAt,
	})
}
