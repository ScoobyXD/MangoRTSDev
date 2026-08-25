package httpapi

import (
	"sort"
	"strings"
	"sync"
)

const realtimePublishFanoutLimit = 16

type realtimeScopeKey struct {
	companyID string
	scope     string
}

type realtimeSubscriptionRegistry struct {
	mu               sync.RWMutex
	publishLocksMu   sync.Mutex
	publishLocks     map[realtimeScopeKey]*realtimeScopePublishLock
	connections      map[string]*realtimeConnection
	connectionScopes map[string]map[realtimeScopeKey]struct{}
	scopeConnections map[realtimeScopeKey]map[string]*realtimeConnection
}

type realtimeScopePublishLock struct {
	mu   sync.Mutex
	refs int
}

type realtimePublishResult struct {
	delivered int
	failed    int
}

func newRealtimeSubscriptionRegistry() *realtimeSubscriptionRegistry {
	return &realtimeSubscriptionRegistry{
		publishLocks:     map[realtimeScopeKey]*realtimeScopePublishLock{},
		connections:      map[string]*realtimeConnection{},
		connectionScopes: map[string]map[realtimeScopeKey]struct{}{},
		scopeConnections: map[realtimeScopeKey]map[string]*realtimeConnection{},
	}
}

func (r *realtimeSubscriptionRegistry) lockPublishScope(companyID, scope string) func() {
	key := realtimeScopeKey{companyID: strings.TrimSpace(companyID), scope: strings.TrimSpace(scope)}
	r.publishLocksMu.Lock()
	lock := r.publishLocks[key]
	if lock == nil {
		lock = &realtimeScopePublishLock{}
		r.publishLocks[key] = lock
	}
	lock.refs++
	r.publishLocksMu.Unlock()
	lock.mu.Lock()
	return func() {
		lock.mu.Unlock()
		r.publishLocksMu.Lock()
		lock.refs--
		if lock.refs == 0 && r.publishLocks[key] == lock {
			delete(r.publishLocks, key)
		}
		r.publishLocksMu.Unlock()
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

func (r *realtimeSubscriptionRegistry) ownsConnection(connectionID, companyID, userID string) bool {
	connectionID = strings.TrimSpace(connectionID)
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if r == nil || connectionID == "" || companyID == "" || userID == "" {
		return false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	connection := r.connections[connectionID]
	return connection != nil && strings.TrimSpace(connection.companyID) == companyID && strings.TrimSpace(connection.userID) == userID
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
	r.subscribeWithinLimit(conn, scope, 0)
}

func (r *realtimeSubscriptionRegistry) subscribeWithinLimit(conn *realtimeConnection, scope string, limit int) bool {
	if r == nil || conn == nil {
		return false
	}
	scope = strings.TrimSpace(scope)
	companyID := strings.TrimSpace(conn.companyID)
	if conn.id == "" || companyID == "" || scope == "" {
		return false
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
	if _, exists := scopes[key]; exists {
		return true
	}
	if limit > 0 && len(scopes) >= limit {
		return false
	}
	scopes[key] = struct{}{}
	bucket := r.scopeConnections[key]
	if bucket == nil {
		bucket = map[string]*realtimeConnection{}
		r.scopeConnections[key] = bucket
	}
	bucket[conn.id] = conn
	return true
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

func (r *realtimeSubscriptionRegistry) connectionSubscriptionCount(connectionID string) int {
	connectionID = strings.TrimSpace(connectionID)
	if r == nil || connectionID == "" {
		return 0
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.connectionScopes[connectionID])
}

func (r *realtimeSubscriptionRegistry) hasSubscribers(companyID, scope string) bool {
	return r.scopeSubscriptionCount(companyID, scope) > 0
}

func (r *realtimeSubscriptionRegistry) scopeUserIDs(companyID, scope string) []string {
	companyID = strings.TrimSpace(companyID)
	scope = strings.TrimSpace(scope)
	if r == nil || companyID == "" || scope == "" {
		return []string{}
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	seen := map[string]struct{}{}
	for _, conn := range r.scopeConnections[realtimeScopeKey{companyID: companyID, scope: scope}] {
		if conn == nil {
			continue
		}
		if userID := strings.TrimSpace(conn.userID); userID != "" {
			seen[userID] = struct{}{}
		}
	}
	userIDs := make([]string, 0, len(seen))
	for userID := range seen {
		userIDs = append(userIDs, userID)
	}
	sort.Strings(userIDs)
	return userIDs
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

func (r *realtimeSubscriptionRegistry) publishUnlocked(companyID, scope string, payload []byte) realtimePublishResult {
	return r.publishMatchingUnlocked(companyID, scope, payload, nil)
}

func (r *realtimeSubscriptionRegistry) publishToUsersUnlocked(companyID, scope string, payload []byte, allowedUserIDs map[string]struct{}) realtimePublishResult {
	if len(allowedUserIDs) == 0 {
		return realtimePublishResult{}
	}
	return r.publishMatchingUnlocked(companyID, scope, payload, func(conn *realtimeConnection) bool {
		_, allowed := allowedUserIDs[strings.TrimSpace(conn.userID)]
		return allowed
	})
}

// publishMatchingUnlocked fans out one already-serialized exact-scope event.
// Callers must hold the lock returned by lockPublishScope.
func (r *realtimeSubscriptionRegistry) publishMatchingUnlocked(companyID, scope string, payload []byte, matches func(*realtimeConnection) bool) realtimePublishResult {
	if r == nil {
		return realtimePublishResult{}
	}
	connections := r.connectionsForScope(companyID, scope)
	targets := make([]*realtimeConnection, 0, len(connections))
	for _, conn := range connections {
		if conn == nil || (matches != nil && !matches(conn)) {
			continue
		}
		targets = append(targets, conn)
	}
	if len(targets) == 0 {
		return realtimePublishResult{}
	}

	workerCount := len(targets)
	if workerCount > realtimePublishFanoutLimit {
		workerCount = realtimePublishFanoutLimit
	}
	jobs := make(chan *realtimeConnection)
	var workers sync.WaitGroup
	var resultMu sync.Mutex
	result := realtimePublishResult{}
	workers.Add(workerCount)
	for worker := 0; worker < workerCount; worker++ {
		go func() {
			defer workers.Done()
			for conn := range jobs {
				delivered := true
				if err := conn.sendText(payload); err != nil {
					delivered = false
					r.removeConnection(conn.id)
				}
				resultMu.Lock()
				if delivered {
					result.delivered++
				} else {
					result.failed++
				}
				resultMu.Unlock()
			}
		}()
	}
	for _, conn := range targets {
		jobs <- conn
	}
	close(jobs)
	workers.Wait()
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
