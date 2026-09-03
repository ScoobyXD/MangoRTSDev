package httpapi

import (
	"context"
	"miraeopus/backend/internal/realtime"
	"miraeopus/backend/internal/store"
	"strings"
	"testing"
)

// enqueueRealtimeTestMessage exercises the production durable outbox boundary.
// Its caller must explicitly construct a local backplane, just as local
// development does; the lifecycle publisher remains the only delivery path.
func enqueueRealtimeTestMessage(t *testing.T, s *Server, companyID, scope string, message any) {
	t.Helper()
	payload, eventType, err := realtimeMessagePayload(message)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.enqueueRealtimeOutboxAndWake(context.Background(), store.RealtimeOutboxInput{
		CompanyID: companyID, Scope: scope, EventType: eventType, Payload: payload,
	}); err != nil {
		t.Fatal(err)
	}
	if s.realtimeBackplane == nil {
		t.Fatal("realtime test server requires an explicit backplane")
	}
}

func enqueueRealtimeEntityTestMessage(t *testing.T, s *Server, companyID, scope, resourceType, resourceID, permission string, message any) {
	t.Helper()
	payload, eventType, err := realtimeMessagePayload(message)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.enqueueRealtimeOutboxAndWake(context.Background(), store.RealtimeOutboxInput{
		CompanyID: companyID, Scope: scope, EventType: eventType, Payload: payload,
		ResourceType: resourceType, ResourceID: resourceID, Permission: permission,
	}); err != nil {
		t.Fatal(err)
	}
	if s.realtimeBackplane == nil {
		t.Fatal("realtime test server requires an explicit backplane")
	}
}

func explicitLocalRealtimeTestOptions(options ServerOptions) ServerOptions {
	options.RealtimeBackplane = realtime.NewLocalBackplane()
	return options
}

func publishProcessWorkChangedForTest(t *testing.T, s *Server, companyID, logicGateID, changeType string) {
	t.Helper()
	scope := realtimeProcessWorkScope(logicGateID)
	if logicGateID == "" {
		return
	}
	enqueueRealtimeEntityTestMessage(t, s, companyID, scope, store.EntityTypeLogicGate, logicGateID, store.EntityPermissionEdit, realtimeProcessWorkChangedMessage{
		Type:        realtimeMessageProcessWorkChanged,
		CompanyID:   strings.TrimSpace(companyID),
		Scope:       scope,
		LogicGateID: strings.TrimSpace(logicGateID),
		ChangeType:  strings.TrimSpace(changeType),
	})
}
