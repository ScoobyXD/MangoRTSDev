package httpapi

import (
	"strings"
	"sync"
)

type realtimeScopeKey struct {
	companyID string
	scope     string
}

type realtimeSubscriptionRegistry struct {
	mu               sync.RWMutex
	connections      map[string]*realtimeConnection
	connectionScopes map[string]map[realtimeScopeKey]struct{}
	scopeConnections map[realtimeScopeKey]map[string]*realtimeConnection
}

type realtimePublishResult struct {
	delivered int
	failed    int
}

func newRealtimeSubscriptionRegistry() *realtimeSubscriptionRegistry {
	return &realtimeSubscriptionRegistry{
		connections:      map[string]*realtimeConnection{},
		connectionScopes: map[string]map[realtimeScopeKey]struct{}{},
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
	for key := range r.connectionScopes[connectionID] {
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
		scopes = map[realtimeScopeKey]struct{}{}
		r.connectionScopes[conn.id] = scopes
	}
	key := realtimeScopeKey{companyID: companyID, scope: scope}
	scopes[key] = struct{}{}
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
	key := realtimeScopeKey{companyID: companyID, scope: scope}
	if scopes := r.connectionScopes[connectionID]; scopes != nil {
		delete(scopes, key)
		if len(scopes) == 0 {
			delete(r.connectionScopes, connectionID)
		}
	}
	if bucket := r.scopeConnections[key]; bucket != nil {
		delete(bucket, connectionID)
		if len(bucket) == 0 {
			delete(r.scopeConnections, key)
		}
	}
}

func (r *realtimeSubscriptionRegistry) connectionCount() int {
	if r == nil {
		return 0
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.connections)
}

func (r *realtimeSubscriptionRegistry) scopeTypeCounts() map[string]int {
	counts := map[string]int{}
	if r == nil {
		return counts
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for key, bucket := range r.scopeConnections {
		scopeType := realtimeScopeType(key.scope)
		if scopeType == "" {
			continue
		}
		counts[scopeType] += len(bucket)
	}
	return counts
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

func (r *realtimeSubscriptionRegistry) hasScopeTypeSubscribers(companyID, scopeType string) bool {
	companyID = strings.TrimSpace(companyID)
	scopeType = strings.TrimSpace(scopeType)
	if r == nil || companyID == "" || scopeType == "" {
		return false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for key, bucket := range r.scopeConnections {
		if key.companyID == companyID && len(bucket) > 0 && realtimeScopeType(key.scope) == scopeType {
			return true
		}
	}
	return false
}

func (r *realtimeSubscriptionRegistry) publish(companyID, scope string, payload []byte) realtimePublishResult {
	connections := r.connectionsForScope(companyID, scope)
	result := realtimePublishResult{}
	for _, conn := range connections {
		if err := conn.sendText(payload); err != nil {
			result.failed++
			r.removeConnection(conn.id)
			continue
		}
		result.delivered++
	}
	return result
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
