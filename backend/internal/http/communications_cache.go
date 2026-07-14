package httpapi

import (
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	communicationsFoldersCacheTTL  = 10 * time.Hour
	communicationsMessagesCacheTTL = 10 * time.Hour
	communicationsMessageCacheTTL  = 10 * time.Hour
	communicationsMaxStaleTTL      = 24 * time.Hour

	communicationsMaxCachedFolderUsers     = 1024
	communicationsMaxMessagePageEntries    = 8192
	communicationsMaxMessageEntries        = 2048
	communicationsMaxMessagePagesPerUser   = 32
	communicationsMaxMessageDetailsPerUser = 64
)

const communicationsCacheKeySeparator = "\x1f"

type communicationsCache struct {
	mu                 sync.RWMutex
	folders            map[string]cachedCommunicationsFolders
	folderGenerations  map[string]communicationsCacheGeneration
	pageGenerations    map[string]communicationsCacheGeneration
	messageGenerations map[string]communicationsCacheGeneration
	messagePages       map[string]cachedCommunicationsMessagePage
	messages           map[string]cachedCommunicationsMessage
}

type communicationsCacheGeneration struct {
	value    uint64
	inFlight int
}

type cachedCommunicationsFolders struct {
	folders   []NylasFolder
	fetchedAt time.Time
}

type cachedCommunicationsMessagePage struct {
	page      NylasMessagePage
	fetchedAt time.Time
}

type cachedCommunicationsMessage struct {
	message   NylasMessage
	fetchedAt time.Time
}

func newCommunicationsCache() *communicationsCache {
	return &communicationsCache{
		folders:            map[string]cachedCommunicationsFolders{},
		folderGenerations:  map[string]communicationsCacheGeneration{},
		pageGenerations:    map[string]communicationsCacheGeneration{},
		messageGenerations: map[string]communicationsCacheGeneration{},
		messagePages:       map[string]cachedCommunicationsMessagePage{},
		messages:           map[string]cachedCommunicationsMessage{},
	}
}

func (c *communicationsCache) getFolders(userID, accountScope string, maxAge time.Duration, now time.Time) ([]NylasFolder, bool) {
	if c == nil {
		return nil, false
	}
	key := communicationsAccountScopedCacheKey(userID, accountScope)
	if key == "" {
		return nil, false
	}
	c.mu.RLock()
	entry, ok := c.folders[key]
	c.mu.RUnlock()
	if !ok || now.Sub(entry.fetchedAt) > maxAge {
		return nil, false
	}
	return cloneNylasFolders(entry.folders), true
}

func (c *communicationsCache) setFolders(userID, accountScope string, folders []NylasFolder, now time.Time) {
	if c == nil {
		return
	}
	key := communicationsAccountScopedCacheKey(userID, accountScope)
	if key == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.folders[key] = cachedCommunicationsFolders{folders: cloneNylasFolders(folders), fetchedAt: now}
	c.evictExpiredFoldersLocked(now, communicationsFoldersCacheTTL+communicationsMaxStaleTTL)
	c.evictOldestFoldersLocked(communicationsMaxCachedFolderUsers)
}

func (c *communicationsCache) beginFolderGeneration(userID, accountScope string) (uint64, func()) {
	if c == nil {
		return 0, func() {}
	}
	key := communicationsAccountScopedCacheKey(userID, accountScope)
	if key == "" {
		return 0, func() {}
	}
	c.mu.Lock()
	if c.folderGenerations == nil {
		c.folderGenerations = map[string]communicationsCacheGeneration{}
	}
	state := c.folderGenerations[key]
	state.inFlight++
	c.folderGenerations[key] = state
	c.mu.Unlock()
	var once sync.Once
	return state.value, func() { once.Do(func() { c.endFolderGeneration(key) }) }
}

func (c *communicationsCache) setFoldersIfGeneration(userID, accountScope string, folders []NylasFolder, now time.Time, generation uint64) bool {
	if c == nil {
		return false
	}
	key := communicationsAccountScopedCacheKey(userID, accountScope)
	if key == "" {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.folderGenerations == nil {
		c.folderGenerations = map[string]communicationsCacheGeneration{}
	}
	state, tracked := c.folderGenerations[key]
	if !tracked || state.value != generation {
		return false
	}
	c.folders[key] = cachedCommunicationsFolders{folders: cloneNylasFolders(folders), fetchedAt: now}
	c.evictExpiredFoldersLocked(now, communicationsFoldersCacheTTL+communicationsMaxStaleTTL)
	c.evictOldestFoldersLocked(communicationsMaxCachedFolderUsers)
	return true
}

func (c *communicationsCache) getMessagePage(userID, accountScope string, query NylasMessageQuery, maxAge time.Duration, now time.Time) (NylasMessagePage, bool) {
	if c == nil {
		return NylasMessagePage{}, false
	}
	key := communicationsMessagePageCacheKey(userID, accountScope, query)
	if key == "" {
		return NylasMessagePage{}, false
	}
	c.mu.RLock()
	entry, ok := c.messagePages[key]
	c.mu.RUnlock()
	if !ok || now.Sub(entry.fetchedAt) > maxAge {
		return NylasMessagePage{}, false
	}
	return cloneNylasMessagePage(entry.page), true
}

func (c *communicationsCache) setMessagePage(userID, accountScope string, query NylasMessageQuery, page NylasMessagePage, now time.Time) {
	if c == nil {
		return
	}
	key := communicationsMessagePageCacheKey(userID, accountScope, query)
	if key == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.messagePages[key] = cachedCommunicationsMessagePage{page: cloneNylasMessagePage(page), fetchedAt: now}
	c.evictExpiredMessagePagesLocked(now, communicationsMessagesCacheTTL+communicationsMaxStaleTTL)
	c.evictOldestMessagePagesForUserLocked(strings.TrimSpace(userID), communicationsMaxMessagePagesPerUser)
	c.evictOldestMessagePagesLocked(communicationsMaxMessagePageEntries)
	c.prunePageGenerationsLinearLocked()
}

func (c *communicationsCache) beginMessagePageGeneration(userID, accountScope string) (uint64, func()) {
	if c == nil {
		return 0, func() {}
	}
	key := communicationsAccountScopedCacheKey(userID, accountScope)
	if key == "" {
		return 0, func() {}
	}
	c.mu.Lock()
	if c.pageGenerations == nil {
		c.pageGenerations = map[string]communicationsCacheGeneration{}
	}
	state := c.pageGenerations[key]
	state.inFlight++
	c.pageGenerations[key] = state
	c.mu.Unlock()
	var once sync.Once
	return state.value, func() { once.Do(func() { c.endMessagePageGeneration(key) }) }
}

func (c *communicationsCache) setMessagePageIfGeneration(userID, accountScope string, query NylasMessageQuery, page NylasMessagePage, now time.Time, generation uint64) bool {
	if c == nil {
		return false
	}
	generationKey := communicationsAccountScopedCacheKey(userID, accountScope)
	cacheKey := communicationsMessagePageCacheKey(userID, accountScope, query)
	if generationKey == "" || cacheKey == "" {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.pageGenerations == nil {
		c.pageGenerations = map[string]communicationsCacheGeneration{}
	}
	state, tracked := c.pageGenerations[generationKey]
	if !tracked || state.value != generation {
		return false
	}
	c.messagePages[cacheKey] = cachedCommunicationsMessagePage{page: cloneNylasMessagePage(page), fetchedAt: now}
	c.evictExpiredMessagePagesLocked(now, communicationsMessagesCacheTTL+communicationsMaxStaleTTL)
	c.evictOldestMessagePagesForUserLocked(strings.TrimSpace(userID), communicationsMaxMessagePagesPerUser)
	c.evictOldestMessagePagesLocked(communicationsMaxMessagePageEntries)
	c.prunePageGenerationsLinearLocked()
	return true
}

func (c *communicationsCache) getMessage(userID, accountScope, messageID string, maxAge time.Duration, now time.Time) (NylasMessage, bool) {
	if c == nil {
		return NylasMessage{}, false
	}
	key := communicationsMessageCacheKey(userID, accountScope, messageID)
	if key == "" {
		return NylasMessage{}, false
	}
	c.mu.RLock()
	entry, ok := c.messages[key]
	c.mu.RUnlock()
	if !ok || now.Sub(entry.fetchedAt) > maxAge {
		return NylasMessage{}, false
	}
	return cloneNylasMessage(entry.message), true
}

func (c *communicationsCache) getMessageFromPages(userID, accountScope, messageID string, maxAge time.Duration, now time.Time) (NylasMessage, bool) {
	if c == nil {
		return NylasMessage{}, false
	}
	userID = strings.TrimSpace(userID)
	accountScope = communicationsNormalizeCacheAccountScope(accountScope)
	messageID = strings.TrimSpace(messageID)
	if userID == "" || messageID == "" {
		return NylasMessage{}, false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	prefix := userID + communicationsCacheKeySeparator + accountScope + communicationsCacheKeySeparator
	for key, entry := range c.messagePages {
		if !strings.HasPrefix(key, prefix) || now.Sub(entry.fetchedAt) > maxAge {
			continue
		}
		for _, message := range entry.page.Messages {
			if strings.TrimSpace(message.ID) == messageID {
				return cloneNylasMessage(message), true
			}
		}
	}
	return NylasMessage{}, false
}

func (c *communicationsCache) setMessage(userID, accountScope string, message NylasMessage, now time.Time) {
	if c == nil {
		return
	}
	key := communicationsMessageCacheKey(userID, accountScope, message.ID)
	if key == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.messages[key] = cachedCommunicationsMessage{message: cloneNylasMessage(message), fetchedAt: now}
	c.evictExpiredMessagesLocked(now, communicationsMessageCacheTTL+communicationsMaxStaleTTL)
	c.evictOldestMessagesForUserLocked(strings.TrimSpace(userID), communicationsMaxMessageDetailsPerUser)
	c.evictOldestMessagesLocked(communicationsMaxMessageEntries)
}

func (c *communicationsCache) beginMessageGeneration(userID, accountScope, messageID string) (uint64, func()) {
	if c == nil {
		return 0, func() {}
	}
	key := communicationsMessageCacheKey(userID, accountScope, messageID)
	if key == "" {
		return 0, func() {}
	}
	c.mu.Lock()
	if c.messageGenerations == nil {
		c.messageGenerations = map[string]communicationsCacheGeneration{}
	}
	state := c.messageGenerations[key]
	state.inFlight++
	c.messageGenerations[key] = state
	c.mu.Unlock()
	var once sync.Once
	return state.value, func() { once.Do(func() { c.endMessageGeneration(key) }) }
}

func (c *communicationsCache) setMessageIfGeneration(userID, accountScope string, message NylasMessage, now time.Time, generation uint64) bool {
	if c == nil {
		return false
	}
	key := communicationsMessageCacheKey(userID, accountScope, message.ID)
	if key == "" {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.messageGenerations == nil {
		c.messageGenerations = map[string]communicationsCacheGeneration{}
	}
	state, tracked := c.messageGenerations[key]
	if !tracked || state.value != generation {
		return false
	}
	c.messages[key] = cachedCommunicationsMessage{message: cloneNylasMessage(message), fetchedAt: now}
	c.evictExpiredMessagesLocked(now, communicationsMessageCacheTTL+communicationsMaxStaleTTL)
	c.evictOldestMessagesForUserLocked(strings.TrimSpace(userID), communicationsMaxMessageDetailsPerUser)
	c.evictOldestMessagesLocked(communicationsMaxMessageEntries)
	return true
}

func (c *communicationsCache) invalidateUser(userID string) {
	if c == nil {
		return
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.bumpFolderGenerationsForUserLocked(userID)
	c.bumpPageGenerationsForUserLocked(userID)
	c.bumpMessageGenerationsForUserLocked(userID)
	c.deleteFoldersForUserLocked(userID)
	c.deleteMessagePagesForUserLocked(userID)
	c.deleteMessagesForUserLocked(userID)
	c.pruneFolderGenerationsForUserLocked(userID)
	c.prunePageGenerationsForUserLocked(userID)
	c.pruneMessageGenerationsForUserLocked(userID)
}

func (c *communicationsCache) invalidateFolders(userID, accountScope string) {
	if c == nil {
		return
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	key := communicationsAccountScopedCacheKey(userID, accountScope)
	c.bumpFolderGenerationLocked(key)
	delete(c.folders, key)
	c.pruneFolderGenerationLocked(key)
}

func (c *communicationsCache) invalidateMessagePages(userID, accountScope string) {
	if c == nil {
		return
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	generationKey := communicationsAccountScopedCacheKey(userID, accountScope)
	c.bumpPageGenerationLocked(generationKey)
	c.deleteMessagePagesForUserAccountLocked(userID, accountScope)
	c.prunePageGenerationLocked(generationKey)
}

func (c *communicationsCache) invalidateMessage(userID, accountScope, messageID string) {
	if c == nil {
		return
	}
	userID = strings.TrimSpace(userID)
	messageID = strings.TrimSpace(messageID)
	if userID == "" || messageID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	key := communicationsMessageCacheKey(userID, accountScope, messageID)
	c.bumpMessageGenerationLocked(key)
	delete(c.messages, key)
	c.pruneMessageGenerationLocked(key)
}

func (c *communicationsCache) invalidateFoldersForAccountScope(accountScope string) {
	if c == nil {
		return
	}
	accountScope = communicationsNormalizeCacheAccountScope(accountScope)
	c.mu.Lock()
	defer c.mu.Unlock()
	for key := range c.folderGenerations {
		if communicationsCacheKeyAccountScope(key) == accountScope {
			c.bumpFolderGenerationLocked(key)
		}
	}
	for key := range c.folders {
		if communicationsCacheKeyAccountScope(key) != accountScope {
			continue
		}
		delete(c.folders, key)
	}
	c.pruneFolderGenerationsForAccountScopeLocked(accountScope)
}

func (c *communicationsCache) invalidateMessagePagesForAccountScope(accountScope string) {
	if c == nil {
		return
	}
	accountScope = communicationsNormalizeCacheAccountScope(accountScope)
	c.mu.Lock()
	defer c.mu.Unlock()
	for key := range c.pageGenerations {
		if communicationsCacheKeyAccountScope(key) == accountScope {
			c.bumpPageGenerationLocked(key)
		}
	}
	for key := range c.messagePages {
		if communicationsCacheKeyAccountScope(key) != accountScope {
			continue
		}
		delete(c.messagePages, key)
	}
	c.prunePageGenerationsForAccountScopeLocked(accountScope)
}

func (c *communicationsCache) invalidateMessageForAccountScope(accountScope, messageID string) {
	if c == nil {
		return
	}
	accountScope = communicationsNormalizeCacheAccountScope(accountScope)
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for key := range c.messageGenerations {
		if communicationsCacheKeyAccountScope(key) == accountScope && communicationsMessageIDFromCacheKey(key) == messageID {
			c.bumpMessageGenerationLocked(key)
		}
	}
	for key := range c.messages {
		if communicationsCacheKeyAccountScope(key) != accountScope || communicationsMessageIDFromCacheKey(key) != messageID {
			continue
		}
		delete(c.messages, key)
	}
	c.pruneMessageGenerationsForAccountMessageLocked(accountScope, messageID)
}

func (c *communicationsCache) patchMessageMetadata(userID, accountScope, messageID string, update NylasMessageUpdate, providerMessage NylasMessage) {
	if c == nil {
		return
	}
	key := communicationsMessageCacheKey(userID, accountScope, messageID)
	if key == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.bumpMessageGenerationLocked(key)
	entry, ok := c.messages[key]
	if !ok {
		return
	}
	message := cloneNylasMessage(entry.message)
	if update.Unread != nil {
		message.Unread = *update.Unread
	}
	if update.Starred != nil {
		message.Starred = *update.Starred
	}
	if update.Folders != nil {
		message.Folders = cloneStringSlice(providerMessage.Folders)
		message.FolderIDs = cloneStringSlice(providerMessage.FolderIDs)
	}
	entry.message = message
	c.messages[key] = entry
}

func (c *communicationsCache) patchMessagePages(userID, accountScope string, message NylasMessage, now time.Time) {
	if c == nil {
		return
	}
	userID = strings.TrimSpace(userID)
	accountScope = communicationsNormalizeCacheAccountScope(accountScope)
	message.ID = strings.TrimSpace(message.ID)
	if userID == "" || message.ID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.bumpPageGenerationLocked(communicationsAccountScopedCacheKey(userID, accountScope))
	for key, entry := range c.messagePages {
		if communicationsCacheKeyUserID(key) != userID {
			continue
		}
		if communicationsCacheKeyAccountScope(key) != accountScope {
			continue
		}
		query, ok := communicationsMessagePageQueryFromCacheKey(key)
		if !ok {
			continue
		}
		changed := false
		messages := make([]NylasMessage, 0, len(entry.page.Messages))
		for _, existing := range entry.page.Messages {
			if strings.TrimSpace(existing.ID) != message.ID {
				messages = append(messages, existing)
				continue
			}
			changed = true
			if nylasMessageMatchesCachedPageQuery(message, query) {
				messages = append(messages, cloneNylasMessage(message))
			}
		}
		if changed {
			page := cloneNylasMessagePage(entry.page)
			page.Messages = messages
			c.messagePages[key] = cachedCommunicationsMessagePage{page: page, fetchedAt: now}
		}
	}
}

func (c *communicationsCache) removeMessagesFromPages(userID, accountScope string, messageIDs []string, mailbox string, now time.Time) {
	if c == nil {
		return
	}
	userID = strings.TrimSpace(userID)
	accountScope = communicationsNormalizeCacheAccountScope(accountScope)
	if userID == "" {
		return
	}
	ids := map[string]bool{}
	for _, messageID := range messageIDs {
		messageID = strings.TrimSpace(messageID)
		if messageID != "" {
			ids[messageID] = true
		}
	}
	if len(ids) == 0 {
		return
	}
	mailbox = strings.TrimSpace(strings.ToLower(mailbox))
	c.mu.Lock()
	defer c.mu.Unlock()
	c.bumpPageGenerationLocked(communicationsAccountScopedCacheKey(userID, accountScope))
	for key, entry := range c.messagePages {
		if communicationsCacheKeyUserID(key) != userID {
			continue
		}
		if communicationsCacheKeyAccountScope(key) != accountScope {
			continue
		}
		query, ok := communicationsMessagePageQueryFromCacheKey(key)
		if !ok {
			continue
		}
		if mailbox != "" && strings.TrimSpace(strings.ToLower(query.Mailbox)) != mailbox {
			continue
		}
		messages := make([]NylasMessage, 0, len(entry.page.Messages))
		changed := false
		for _, message := range entry.page.Messages {
			if ids[strings.TrimSpace(message.ID)] {
				changed = true
				continue
			}
			messages = append(messages, message)
		}
		if changed {
			page := cloneNylasMessagePage(entry.page)
			page.Messages = messages
			c.messagePages[key] = cachedCommunicationsMessagePage{page: page, fetchedAt: now}
		}
	}
}

func (c *communicationsCache) deleteMessagePagesForUserLocked(userID string) {
	prefix := userID + communicationsCacheKeySeparator
	for key := range c.messagePages {
		if strings.HasPrefix(key, prefix) {
			delete(c.messagePages, key)
		}
	}
}

func (c *communicationsCache) deleteMessagePagesForUserAccountLocked(userID, accountScope string) {
	prefix := strings.TrimSpace(userID) + communicationsCacheKeySeparator + communicationsNormalizeCacheAccountScope(accountScope) + communicationsCacheKeySeparator
	for key := range c.messagePages {
		if strings.HasPrefix(key, prefix) {
			delete(c.messagePages, key)
		}
	}
}

func (c *communicationsCache) deleteFoldersForUserLocked(userID string) {
	prefix := userID + communicationsCacheKeySeparator
	for key := range c.folders {
		if strings.HasPrefix(key, prefix) {
			delete(c.folders, key)
		}
	}
}

func (c *communicationsCache) bumpFolderGenerationsForUserLocked(userID string) {
	prefix := strings.TrimSpace(userID) + communicationsCacheKeySeparator
	for key := range c.folderGenerations {
		if strings.HasPrefix(key, prefix) {
			c.bumpFolderGenerationLocked(key)
		}
	}
}

func (c *communicationsCache) bumpFolderGenerationLocked(key string) {
	state, tracked := c.folderGenerations[key]
	if !tracked {
		return
	}
	state.value++
	c.folderGenerations[key] = state
}

func (c *communicationsCache) bumpPageGenerationsForUserLocked(userID string) {
	prefix := strings.TrimSpace(userID) + communicationsCacheKeySeparator
	for key := range c.pageGenerations {
		if strings.HasPrefix(key, prefix) {
			c.bumpPageGenerationLocked(key)
		}
	}
}

func (c *communicationsCache) bumpPageGenerationLocked(key string) {
	state, tracked := c.pageGenerations[key]
	if !tracked {
		return
	}
	state.value++
	c.pageGenerations[key] = state
}

func (c *communicationsCache) bumpMessageGenerationsForUserLocked(userID string) {
	prefix := strings.TrimSpace(userID) + communicationsCacheKeySeparator
	for key := range c.messageGenerations {
		if strings.HasPrefix(key, prefix) {
			c.bumpMessageGenerationLocked(key)
		}
	}
}

func (c *communicationsCache) bumpMessageGenerationLocked(key string) {
	state, tracked := c.messageGenerations[key]
	if !tracked {
		return
	}
	state.value++
	c.messageGenerations[key] = state
}

func (c *communicationsCache) endFolderGeneration(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	state, tracked := c.folderGenerations[key]
	if !tracked {
		return
	}
	if state.inFlight > 0 {
		state.inFlight--
	}
	c.folderGenerations[key] = state
	c.pruneFolderGenerationLocked(key)
}

func (c *communicationsCache) endMessagePageGeneration(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	state, tracked := c.pageGenerations[key]
	if !tracked {
		return
	}
	if state.inFlight > 0 {
		state.inFlight--
	}
	c.pageGenerations[key] = state
	c.prunePageGenerationLocked(key)
}

func (c *communicationsCache) endMessageGeneration(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	state, tracked := c.messageGenerations[key]
	if !tracked {
		return
	}
	if state.inFlight > 0 {
		state.inFlight--
	}
	c.messageGenerations[key] = state
	c.pruneMessageGenerationLocked(key)
}

func (c *communicationsCache) pruneFolderGenerationLocked(key string) {
	state, tracked := c.folderGenerations[key]
	if !tracked || state.inFlight != 0 {
		return
	}
	if _, cached := c.folders[key]; !cached {
		delete(c.folderGenerations, key)
	}
}

func (c *communicationsCache) prunePageGenerationLocked(key string) {
	state, tracked := c.pageGenerations[key]
	if tracked && state.inFlight == 0 && !c.hasMessagePageForGenerationKeyLocked(key) {
		delete(c.pageGenerations, key)
	}
}

func (c *communicationsCache) pruneMessageGenerationLocked(key string) {
	state, tracked := c.messageGenerations[key]
	if !tracked || state.inFlight != 0 {
		return
	}
	if _, cached := c.messages[key]; !cached {
		delete(c.messageGenerations, key)
	}
}

func (c *communicationsCache) pruneFolderGenerationsForUserLocked(userID string) {
	for key, state := range c.folderGenerations {
		if communicationsCacheKeyUserID(key) == userID && state.inFlight == 0 {
			delete(c.folderGenerations, key)
		}
	}
}

func (c *communicationsCache) prunePageGenerationsForUserLocked(userID string) {
	for key, state := range c.pageGenerations {
		if communicationsCacheKeyUserID(key) == userID && state.inFlight == 0 {
			delete(c.pageGenerations, key)
		}
	}
}

func (c *communicationsCache) pruneMessageGenerationsForUserLocked(userID string) {
	for key, state := range c.messageGenerations {
		if communicationsCacheKeyUserID(key) == userID && state.inFlight == 0 {
			delete(c.messageGenerations, key)
		}
	}
}

func (c *communicationsCache) pruneFolderGenerationsForAccountScopeLocked(accountScope string) {
	for key, state := range c.folderGenerations {
		if communicationsCacheKeyAccountScope(key) == accountScope && state.inFlight == 0 {
			delete(c.folderGenerations, key)
		}
	}
}

func (c *communicationsCache) prunePageGenerationsForAccountScopeLocked(accountScope string) {
	for key, state := range c.pageGenerations {
		if communicationsCacheKeyAccountScope(key) == accountScope && state.inFlight == 0 {
			delete(c.pageGenerations, key)
		}
	}
}

func (c *communicationsCache) pruneMessageGenerationsForAccountMessageLocked(accountScope, messageID string) {
	for key, state := range c.messageGenerations {
		if communicationsCacheKeyAccountScope(key) == accountScope && communicationsMessageIDFromCacheKey(key) == messageID && state.inFlight == 0 {
			delete(c.messageGenerations, key)
		}
	}
}

func (c *communicationsCache) hasMessagePageForGenerationKeyLocked(generationKey string) bool {
	prefix := generationKey + communicationsCacheKeySeparator
	for key := range c.messagePages {
		if strings.HasPrefix(key, prefix) {
			return true
		}
	}
	return false
}

func (c *communicationsCache) prunePageGenerationsLinearLocked() {
	cachedGenerationKeys := make(map[string]struct{}, len(c.messagePages))
	for key := range c.messagePages {
		cachedGenerationKeys[communicationsAccountScopedCacheKey(communicationsCacheKeyUserID(key), communicationsCacheKeyAccountScope(key))] = struct{}{}
	}
	for key, state := range c.pageGenerations {
		if state.inFlight != 0 {
			continue
		}
		if _, cached := cachedGenerationKeys[key]; !cached {
			delete(c.pageGenerations, key)
		}
	}
}

func (c *communicationsCache) deleteMessagesForUserLocked(userID string) {
	prefix := userID + communicationsCacheKeySeparator
	for key := range c.messages {
		if strings.HasPrefix(key, prefix) {
			delete(c.messages, key)
		}
	}
}

func communicationsAccountScopedCacheKey(userID, accountScope string) string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ""
	}
	return userID + communicationsCacheKeySeparator + communicationsNormalizeCacheAccountScope(accountScope)
}

func communicationsNormalizeCacheAccountScope(accountScope string) string {
	accountScope = strings.TrimSpace(accountScope)
	if accountScope == "" {
		return "default"
	}
	return accountScope
}

func communicationsMessagePageCacheKey(userID, accountScope string, query NylasMessageQuery) string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ""
	}
	accountScope = communicationsNormalizeCacheAccountScope(accountScope)
	unread := ""
	if query.Unread != nil {
		unread = strconv.FormatBool(*query.Unread)
	}
	starred := ""
	if query.Starred != nil {
		starred = strconv.FormatBool(*query.Starred)
	}
	return strings.Join([]string{
		userID,
		accountScope,
		strconv.Itoa(query.Limit),
		strings.TrimSpace(query.PageToken),
		strings.TrimSpace(query.FolderID),
		strings.TrimSpace(query.ThreadID),
		strings.TrimSpace(query.Query),
		strings.TrimSpace(query.SearchQueryNative),
		strings.TrimSpace(query.Mailbox),
		unread,
		starred,
	}, communicationsCacheKeySeparator)
}

func communicationsMessagePageQueryFromCacheKey(key string) (NylasMessageQuery, bool) {
	parts := strings.Split(key, communicationsCacheKeySeparator)
	if len(parts) != 11 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return NylasMessageQuery{}, false
	}
	limit, _ := strconv.Atoi(parts[2])
	query := NylasMessageQuery{
		Limit:             limit,
		PageToken:         strings.TrimSpace(parts[3]),
		FolderID:          strings.TrimSpace(parts[4]),
		ThreadID:          strings.TrimSpace(parts[5]),
		Query:             strings.TrimSpace(parts[6]),
		SearchQueryNative: strings.TrimSpace(parts[7]),
		Mailbox:           strings.TrimSpace(parts[8]),
	}
	if parts[9] != "" {
		if value, err := strconv.ParseBool(parts[9]); err == nil {
			query.Unread = &value
		}
	}
	if parts[10] != "" {
		if value, err := strconv.ParseBool(parts[10]); err == nil {
			query.Starred = &value
		}
	}
	return query, true
}

func communicationsMessageCacheKey(userID, accountScope, messageID string) string {
	userID = strings.TrimSpace(userID)
	accountScope = communicationsNormalizeCacheAccountScope(accountScope)
	messageID = strings.TrimSpace(messageID)
	if userID == "" || messageID == "" {
		return ""
	}
	return strings.Join([]string{userID, accountScope, messageID}, communicationsCacheKeySeparator)
}

func communicationsCacheKeyUserID(key string) string {
	index := strings.Index(key, communicationsCacheKeySeparator)
	if index <= 0 {
		return ""
	}
	return key[:index]
}

func communicationsCacheKeyAccountScope(key string) string {
	parts := strings.SplitN(key, communicationsCacheKeySeparator, 3)
	if len(parts) < 2 {
		return ""
	}
	return communicationsNormalizeCacheAccountScope(parts[1])
}

func communicationsMessageIDFromCacheKey(key string) string {
	parts := strings.SplitN(key, communicationsCacheKeySeparator, 3)
	if len(parts) != 3 {
		return ""
	}
	return strings.TrimSpace(parts[2])
}

func nylasMessageMatchesCachedPageQuery(message NylasMessage, query NylasMessageQuery) bool {
	if query.Unread != nil && message.Unread != *query.Unread {
		return false
	}
	if query.Starred != nil && message.Starred != *query.Starred {
		return false
	}
	if query.FolderID != "" && !nylasMessageHasFolder(message, query.FolderID) {
		return false
	}
	if strings.TrimSpace(query.ThreadID) != "" && strings.TrimSpace(message.ThreadID) != strings.TrimSpace(query.ThreadID) {
		return false
	}
	if query.Query != "" && !nylasMessageMatchesSearch(message, query.Query) {
		return false
	}
	switch strings.TrimSpace(strings.ToLower(query.Mailbox)) {
	case "", "primary":
		return nylasMessageMatchesPrimaryMailbox(message)
	case "all":
		return true
	case "sent":
		return nylasMessageHasAnyFolder(message, []string{"sent", "\\sent"})
	case "starred":
		return message.Starred
	case "archive":
		if nylasMessageHasAnyFolder(message, []string{"trash", "\\trash", "spam", "\\spam", "junk", "\\junk", "sent", "\\sent", "draft", "\\draft", "drafts", "\\drafts"}) {
			return false
		}
		return !nylasMessageHasAnyFolder(message, []string{"inbox", "\\inbox"})
	case "spam":
		return nylasMessageHasAnyFolder(message, []string{"spam", "\\spam", "junk", "\\junk"})
	default:
		return true
	}
}

func nylasMessageMatchesPrimaryMailbox(message NylasMessage) bool {
	folders := nylasMessageFolderTokens(message)
	hasInbox := len(folders) == 0
	for _, folder := range folders {
		switch folder {
		case "sent", "trash", "spam", "junk", "category:social", "category:promotions":
			return false
		case "inbox":
			hasInbox = true
		}
	}
	return hasInbox
}

func nylasMessageMatchesSearch(message NylasMessage, query string) bool {
	query = strings.TrimSpace(strings.ToLower(query))
	if query == "" {
		return true
	}
	haystack := strings.ToLower(strings.Join([]string{
		message.Subject,
		message.Snippet,
		message.Body,
		formatNylasAddressesForSearch(message.From),
		formatNylasAddressesForSearch(message.To),
		formatNylasAddressesForSearch(message.Cc),
		formatNylasAddressesForSearch(message.Bcc),
	}, " "))
	return strings.Contains(haystack, query)
}

func formatNylasAddressesForSearch(addresses []NylasEmailAddress) string {
	parts := make([]string, 0, len(addresses))
	for _, address := range addresses {
		parts = append(parts, strings.TrimSpace(address.Name)+" "+strings.TrimSpace(address.Email))
	}
	return strings.Join(parts, " ")
}

func nylasMessageHasAnyFolder(message NylasMessage, candidates []string) bool {
	for _, candidate := range candidates {
		if nylasMessageHasFolder(message, candidate) {
			return true
		}
	}
	return false
}

func nylasMessageHasFolder(message NylasMessage, folder string) bool {
	normalized := normalizeNylasCachedFolderToken(folder)
	if normalized == "" {
		return false
	}
	for _, token := range nylasMessageFolderTokens(message) {
		if token == normalized {
			return true
		}
	}
	return false
}

func nylasMessageFolderTokens(message NylasMessage) []string {
	values := append([]string{}, message.Folders...)
	values = append(values, message.FolderIDs...)
	tokens := make([]string, 0, len(values))
	for _, value := range values {
		if token := normalizeNylasCachedFolderToken(value); token != "" {
			tokens = append(tokens, token)
		}
	}
	return tokens
}

func normalizeNylasCachedFolderToken(value string) string {
	token := strings.Trim(strings.ToLower(strings.TrimSpace(value)), "\\")
	if strings.HasPrefix(token, "category_") {
		return "category:" + strings.TrimPrefix(token, "category_")
	}
	return token
}

func (c *communicationsCache) evictExpiredFoldersLocked(now time.Time, maxAge time.Duration) {
	for key, entry := range c.folders {
		if now.Sub(entry.fetchedAt) > maxAge {
			delete(c.folders, key)
			c.pruneFolderGenerationLocked(key)
		}
	}
}

func (c *communicationsCache) evictOldestFoldersLocked(maxEntries int) {
	for len(c.folders) > maxEntries {
		oldestKey := ""
		var oldestTime time.Time
		for key, entry := range c.folders {
			if oldestKey == "" || entry.fetchedAt.Before(oldestTime) {
				oldestKey = key
				oldestTime = entry.fetchedAt
			}
		}
		if oldestKey == "" {
			return
		}
		delete(c.folders, oldestKey)
		c.pruneFolderGenerationLocked(oldestKey)
	}
}

func (c *communicationsCache) evictExpiredMessagePagesLocked(now time.Time, maxAge time.Duration) {
	for key, entry := range c.messagePages {
		if now.Sub(entry.fetchedAt) > maxAge {
			delete(c.messagePages, key)
		}
	}
}

func (c *communicationsCache) evictOldestMessagePagesForUserLocked(userID string, maxEntries int) {
	for countCommunicationsCacheEntriesForUser(c.messagePages, userID) > maxEntries {
		oldestKey := ""
		var oldestTime time.Time
		for key, entry := range c.messagePages {
			if communicationsCacheKeyUserID(key) != userID {
				continue
			}
			if oldestKey == "" || entry.fetchedAt.Before(oldestTime) {
				oldestKey = key
				oldestTime = entry.fetchedAt
			}
		}
		if oldestKey == "" {
			return
		}
		delete(c.messagePages, oldestKey)
	}
}

func (c *communicationsCache) evictOldestMessagePagesLocked(maxEntries int) {
	for len(c.messagePages) > maxEntries {
		oldestKey := ""
		var oldestTime time.Time
		for key, entry := range c.messagePages {
			if oldestKey == "" || entry.fetchedAt.Before(oldestTime) {
				oldestKey = key
				oldestTime = entry.fetchedAt
			}
		}
		if oldestKey == "" {
			return
		}
		delete(c.messagePages, oldestKey)
	}
}

func (c *communicationsCache) evictExpiredMessagesLocked(now time.Time, maxAge time.Duration) {
	for key, entry := range c.messages {
		if now.Sub(entry.fetchedAt) > maxAge {
			delete(c.messages, key)
			c.pruneMessageGenerationLocked(key)
		}
	}
}

func (c *communicationsCache) evictOldestMessagesForUserLocked(userID string, maxEntries int) {
	for countCommunicationsCacheEntriesForUser(c.messages, userID) > maxEntries {
		oldestKey := ""
		var oldestTime time.Time
		for key, entry := range c.messages {
			if communicationsCacheKeyUserID(key) != userID {
				continue
			}
			if oldestKey == "" || entry.fetchedAt.Before(oldestTime) {
				oldestKey = key
				oldestTime = entry.fetchedAt
			}
		}
		if oldestKey == "" {
			return
		}
		delete(c.messages, oldestKey)
		c.pruneMessageGenerationLocked(oldestKey)
	}
}

func (c *communicationsCache) evictOldestMessagesLocked(maxEntries int) {
	for len(c.messages) > maxEntries {
		oldestKey := ""
		var oldestTime time.Time
		for key, entry := range c.messages {
			if oldestKey == "" || entry.fetchedAt.Before(oldestTime) {
				oldestKey = key
				oldestTime = entry.fetchedAt
			}
		}
		if oldestKey == "" {
			return
		}
		delete(c.messages, oldestKey)
		c.pruneMessageGenerationLocked(oldestKey)
	}
}

type communicationsCacheEntry interface {
	cachedCommunicationsMessagePage | cachedCommunicationsMessage
}

func countCommunicationsCacheEntriesForUser[T communicationsCacheEntry](entries map[string]T, userID string) int {
	count := 0
	for key := range entries {
		if communicationsCacheKeyUserID(key) == userID {
			count++
		}
	}
	return count
}

func cloneNylasFolders(folders []NylasFolder) []NylasFolder {
	if folders == nil {
		return nil
	}
	out := make([]NylasFolder, len(folders))
	for i, folder := range folders {
		out[i] = folder
		out[i].Attributes = cloneStringSlice(folder.Attributes)
		out[i].UnreadCount = cloneIntPointer(folder.UnreadCount)
		out[i].TotalCount = cloneIntPointer(folder.TotalCount)
	}
	return out
}

func cloneIntPointer(value *int) *int {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneNylasMessagePage(page NylasMessagePage) NylasMessagePage {
	return NylasMessagePage{
		Messages:      cloneNylasMessages(page.Messages),
		NextPageToken: page.NextPageToken,
	}
}

func cloneNylasMessages(messages []NylasMessage) []NylasMessage {
	if messages == nil {
		return nil
	}
	out := make([]NylasMessage, len(messages))
	for i, message := range messages {
		out[i] = cloneNylasMessage(message)
	}
	return out
}

func cloneNylasMessage(message NylasMessage) NylasMessage {
	message.From = cloneNylasEmailAddresses(message.From)
	message.To = cloneNylasEmailAddresses(message.To)
	message.Cc = cloneNylasEmailAddresses(message.Cc)
	message.Bcc = cloneNylasEmailAddresses(message.Bcc)
	message.ReplyTo = cloneNylasEmailAddresses(message.ReplyTo)
	message.Folders = cloneStringSlice(message.Folders)
	message.FolderIDs = cloneStringSlice(message.FolderIDs)
	message.LogicGateIDs = cloneStringSlice(message.LogicGateIDs)
	if message.TrackingOptions != nil {
		options := *message.TrackingOptions
		message.TrackingOptions = &options
	}
	if message.ReadStatus != nil {
		status := *message.ReadStatus
		message.ReadStatus = &status
	}
	return message
}

func cloneNylasEmailAddresses(items []NylasEmailAddress) []NylasEmailAddress {
	if items == nil {
		return nil
	}
	out := make([]NylasEmailAddress, len(items))
	copy(out, items)
	return out
}

func cloneStringSlice(items []string) []string {
	if items == nil {
		return nil
	}
	out := make([]string, len(items))
	copy(out, items)
	return out
}
