package httpapi

import (
	"strings"
	"sync"
)

type realtimeScopeKey struct {
	companyID string
	scope     string
}

type realtimeSubscription struct {
	CompanyID string
	Scope     string
}

type realtimeSubscriptionRegistry struct {
	mu               sync.RWMutex
	connections      map[string]*realtimeConnection
	connectionScopes map[string]map[string]realtimeSubscription
	scopeConnections map[realtimeScopeKey]map[string]*realtimeConnection
}

func newRealtimeSubscriptionRegistry() *realtimeSubscriptionRegistry {
	return &realtimeSubscriptionRegistry{
		connections:      map[string]*realtimeConnection{},
		connectionScopes: map[string]map[string]realtimeSubscription{},
		scopeConnections: map[realtimeScopeKey]map[string]*realtimeConnection{},
	}
}

func (r *realtimeSubscriptionRegistry) addConnection(conn *realtimeConnection) {
	if r == nil || conn == nil || strings.TrimSpace(conn.id) == "" {
		return
	}
	r.mu.Lock()
	r.connections[conn.id] = conn
	r.mu.Unlock()
}

func (r *realtimeSubscriptionRegistry) removeConnection(connectionID string) {
	connectionID = strings.TrimSpace(connectionID)
	if r == nil || connectionID == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.connections, connectionID)
	for _, sub := range r.connectionScopes[connectionID] {
		key := realtimeScopeKey{companyID: sub.CompanyID, scope: sub.Scope}
		if bucket := r.scopeConnections[key]; bucket != nil {
			delete(bucket, connectionID)
			if len(bucket) == 0 {
				delete(r.scopeConnections, key)
			}
		}
	}
	delete(r.connectionScopes, connectionID)
}

func (r *realtimeSubscriptionRegistry) subscribe(conn *realtimeConnection, scope string) {
	if r == nil || conn == nil {
		return
	}
	scope = strings.TrimSpace(scope)
	companyID := strings.TrimSpace(conn.companyID)
	if conn.id == "" || companyID == "" || scope == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.connections[conn.id] = conn
	scopes := r.connectionScopes[conn.id]
	if scopes == nil {
		scopes = map[string]realtimeSubscription{}
		r.connectionScopes[conn.id] = scopes
	}
	scopes[scope] = realtimeSubscription{CompanyID: companyID, Scope: scope}
	key := realtimeScopeKey{companyID: companyID, scope: scope}
	bucket := r.scopeConnections[key]
	if bucket == nil {
		bucket = map[string]*realtimeConnection{}
		r.scopeConnections[key] = bucket
	}
	bucket[conn.id] = conn
}

func (r *realtimeSubscriptionRegistry) unsubscribe(connectionID, companyID, scope string) {
	connectionID = strings.TrimSpace(connectionID)
	companyID = strings.TrimSpace(companyID)
	scope = strings.TrimSpace(scope)
	if r == nil || connectionID == "" || companyID == "" || scope == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if scopes := r.connectionScopes[connectionID]; scopes != nil {
		delete(scopes, scope)
		if len(scopes) == 0 {
			delete(r.connectionScopes, connectionID)
		}
	}
	key := realtimeScopeKey{companyID: companyID, scope: scope}
	if bucket := r.scopeConnections[key]; bucket != nil {
		delete(bucket, connectionID)
		if len(bucket) == 0 {
			delete(r.scopeConnections, key)
		}
	}
}

func (r *realtimeSubscriptionRegistry) hasSubscription(connectionID, companyID, scope string) bool {
	connectionID = strings.TrimSpace(connectionID)
	companyID = strings.TrimSpace(companyID)
	scope = strings.TrimSpace(scope)
	if r == nil || connectionID == "" || companyID == "" || scope == "" {
		return false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	sub, ok := r.connectionScopes[connectionID][scope]
	return ok && sub.CompanyID == companyID
}

func (r *realtimeSubscriptionRegistry) connectionSubscriptionCount(connectionID string) int {
	connectionID = strings.TrimSpace(connectionID)
	if r == nil || connectionID == "" {
		return 0
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.connectionScopes[connectionID])
}

func (r *realtimeSubscriptionRegistry) scopeSubscriptionCount(companyID, scope string) int {
	companyID = strings.TrimSpace(companyID)
	scope = strings.TrimSpace(scope)
	if r == nil || companyID == "" || scope == "" {
		return 0
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.scopeConnections[realtimeScopeKey{companyID: companyID, scope: scope}])
}

func (r *realtimeSubscriptionRegistry) hasSubscribers(companyID, scope string) bool {
	return r.scopeSubscriptionCount(companyID, scope) > 0
}

func (r *realtimeSubscriptionRegistry) publish(companyID, scope string, payload []byte) int {
	connections := r.connectionsForScope(companyID, scope)
	published := 0
	for _, conn := range connections {
		if conn.sendText(payload) == nil {
			published++
		}
	}
	return published
}

func (r *realtimeSubscriptionRegistry) connectionsForScope(companyID, scope string) []*realtimeConnection {
	companyID = strings.TrimSpace(companyID)
	scope = strings.TrimSpace(scope)
	if r == nil || companyID == "" || scope == "" {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	bucket := r.scopeConnections[realtimeScopeKey{companyID: companyID, scope: scope}]
	connections := make([]*realtimeConnection, 0, len(bucket))
	for _, conn := range bucket {
		connections = append(connections, conn)
	}
	return connections
}
