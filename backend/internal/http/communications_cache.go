package httpapi

import (
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	communicationsFoldersCacheTTL  = 10 * time.Minute
	communicationsMessagesCacheTTL = 5 * time.Minute
	communicationsMessageCacheTTL  = 10 * time.Minute
	communicationsMaxStaleTTL      = 6 * time.Hour

	communicationsMaxCachedFolderUsers     = 1024
	communicationsMaxMessagePageEntries    = 2048
	communicationsMaxMessageEntries        = 512
	communicationsMaxMessagePagesPerUser   = 8
	communicationsMaxMessageDetailsPerUser = 16
)

const communicationsCacheKeySeparator = "\x1f"

type communicationsCache struct {
	mu           sync.RWMutex
	folders      map[string]cachedCommunicationsFolders
	messagePages map[string]cachedCommunicationsMessagePage
	messages     map[string]cachedCommunicationsMessage
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
		folders:      map[string]cachedCommunicationsFolders{},
		messagePages: map[string]cachedCommunicationsMessagePage{},
		messages:     map[string]cachedCommunicationsMessage{},
	}
}

func (c *communicationsCache) getFolders(userID string, maxAge time.Duration, now time.Time) ([]NylasFolder, bool) {
	if c == nil {
		return nil, false
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, false
	}
	c.mu.RLock()
	entry, ok := c.folders[userID]
	c.mu.RUnlock()
	if !ok || now.Sub(entry.fetchedAt) > maxAge {
		return nil, false
	}
	return cloneNylasFolders(entry.folders), true
}

func (c *communicationsCache) setFolders(userID string, folders []NylasFolder, now time.Time) {
	if c == nil {
		return
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.folders[userID] = cachedCommunicationsFolders{folders: cloneNylasFolders(folders), fetchedAt: now}
	c.evictExpiredFoldersLocked(now, communicationsFoldersCacheTTL+communicationsMaxStaleTTL)
	c.evictOldestFoldersLocked(communicationsMaxCachedFolderUsers)
}

func (c *communicationsCache) getMessagePage(userID string, query NylasMessageQuery, maxAge time.Duration, now time.Time) (NylasMessagePage, bool) {
	if c == nil {
		return NylasMessagePage{}, false
	}
	key := communicationsMessagePageCacheKey(userID, query)
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

func (c *communicationsCache) setMessagePage(userID string, query NylasMessageQuery, page NylasMessagePage, now time.Time) {
	if c == nil {
		return
	}
	key := communicationsMessagePageCacheKey(userID, query)
	if key == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.messagePages[key] = cachedCommunicationsMessagePage{page: cloneNylasMessagePage(page), fetchedAt: now}
	c.evictExpiredMessagePagesLocked(now, communicationsMessagesCacheTTL+communicationsMaxStaleTTL)
	c.evictOldestMessagePagesForUserLocked(userID, communicationsMaxMessagePagesPerUser)
	c.evictOldestMessagePagesLocked(communicationsMaxMessagePageEntries)
}

func (c *communicationsCache) getMessage(userID, messageID string, maxAge time.Duration, now time.Time) (NylasMessage, bool) {
	if c == nil {
		return NylasMessage{}, false
	}
	key := communicationsMessageCacheKey(userID, messageID)
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

func (c *communicationsCache) setMessage(userID string, message NylasMessage, now time.Time) {
	if c == nil {
		return
	}
	key := communicationsMessageCacheKey(userID, message.ID)
	if key == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.messages[key] = cachedCommunicationsMessage{message: cloneNylasMessage(message), fetchedAt: now}
	c.evictExpiredMessagesLocked(now, communicationsMessageCacheTTL+communicationsMaxStaleTTL)
	c.evictOldestMessagesForUserLocked(userID, communicationsMaxMessageDetailsPerUser)
	c.evictOldestMessagesLocked(communicationsMaxMessageEntries)
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
	delete(c.folders, userID)
	c.deleteMessagePagesForUserLocked(userID)
	c.deleteMessagesForUserLocked(userID)
}

func (c *communicationsCache) invalidateFolders(userID string) {
	if c == nil {
		return
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.folders, userID)
}

func (c *communicationsCache) invalidateMessagePages(userID string) {
	if c == nil {
		return
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.deleteMessagePagesForUserLocked(userID)
}

func (c *communicationsCache) invalidateMessage(userID, messageID string) {
	if c == nil {
		return
	}
	key := communicationsMessageCacheKey(userID, messageID)
	if key == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.messages, key)
}

func (c *communicationsCache) deleteMessagePagesForUserLocked(userID string) {
	prefix := userID + communicationsCacheKeySeparator
	for key := range c.messagePages {
		if strings.HasPrefix(key, prefix) {
			delete(c.messagePages, key)
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

func communicationsMessagePageCacheKey(userID string, query NylasMessageQuery) string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ""
	}
	unread := ""
	if query.Unread != nil {
		unread = strconv.FormatBool(*query.Unread)
	}
	return strings.Join([]string{
		userID,
		strconv.Itoa(query.Limit),
		strings.TrimSpace(query.PageToken),
		strings.TrimSpace(query.FolderID),
		strings.TrimSpace(query.Query),
		strings.TrimSpace(query.SearchQueryNative),
		strings.TrimSpace(query.Mailbox),
		unread,
	}, communicationsCacheKeySeparator)
}

func communicationsMessageCacheKey(userID, messageID string) string {
	userID = strings.TrimSpace(userID)
	messageID = strings.TrimSpace(messageID)
	if userID == "" || messageID == "" {
		return ""
	}
	return userID + communicationsCacheKeySeparator + messageID
}

func communicationsCacheKeyUserID(key string) string {
	index := strings.Index(key, communicationsCacheKeySeparator)
	if index <= 0 {
		return ""
	}
	return key[:index]
}

func (c *communicationsCache) evictExpiredFoldersLocked(now time.Time, maxAge time.Duration) {
	for key, entry := range c.folders {
		if now.Sub(entry.fetchedAt) > maxAge {
			delete(c.folders, key)
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
	}
	return out
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
