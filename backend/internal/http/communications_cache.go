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

func (c *communicationsCache) getMessageFromPages(userID, messageID string, maxAge time.Duration, now time.Time) (NylasMessage, bool) {
	if c == nil {
		return NylasMessage{}, false
	}
	userID = strings.TrimSpace(userID)
	messageID = strings.TrimSpace(messageID)
	if userID == "" || messageID == "" {
		return NylasMessage{}, false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	prefix := userID + communicationsCacheKeySeparator
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

func (c *communicationsCache) patchMessagePages(userID string, message NylasMessage, now time.Time) {
	if c == nil {
		return
	}
	userID = strings.TrimSpace(userID)
	message.ID = strings.TrimSpace(message.ID)
	if userID == "" || message.ID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for key, entry := range c.messagePages {
		if communicationsCacheKeyUserID(key) != userID {
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

func (c *communicationsCache) removeMessagesFromPages(userID string, messageIDs []string, mailbox string, now time.Time) {
	if c == nil {
		return
	}
	userID = strings.TrimSpace(userID)
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
	for key, entry := range c.messagePages {
		if communicationsCacheKeyUserID(key) != userID {
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
	starred := ""
	if query.Starred != nil {
		starred = strconv.FormatBool(*query.Starred)
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
		starred,
	}, communicationsCacheKeySeparator)
}

func communicationsMessagePageQueryFromCacheKey(key string) (NylasMessageQuery, bool) {
	parts := strings.Split(key, communicationsCacheKeySeparator)
	if len(parts) != 9 || strings.TrimSpace(parts[0]) == "" {
		return NylasMessageQuery{}, false
	}
	limit, _ := strconv.Atoi(parts[1])
	query := NylasMessageQuery{
		Limit:             limit,
		PageToken:         strings.TrimSpace(parts[2]),
		FolderID:          strings.TrimSpace(parts[3]),
		Query:             strings.TrimSpace(parts[4]),
		SearchQueryNative: strings.TrimSpace(parts[5]),
		Mailbox:           strings.TrimSpace(parts[6]),
	}
	if parts[7] != "" {
		if value, err := strconv.ParseBool(parts[7]); err == nil {
			query.Unread = &value
		}
	}
	if parts[8] != "" {
		if value, err := strconv.ParseBool(parts[8]); err == nil {
			query.Starred = &value
		}
	}
	return query, true
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
	if query.Query != "" && !nylasMessageMatchesSearch(message, query.Query) {
		return false
	}
	switch strings.TrimSpace(strings.ToLower(query.Mailbox)) {
	case "", "primary":
		if nylasMessageHasAnyFolder(message, []string{"sent", "\\sent", "trash", "\\trash", "spam", "\\spam", "junk", "\\junk"}) {
			return false
		}
		return len(nylasMessageFolderTokens(message)) == 0 || nylasMessageHasAnyFolder(message, []string{"inbox", "\\inbox"})
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
	default:
		return true
	}
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
