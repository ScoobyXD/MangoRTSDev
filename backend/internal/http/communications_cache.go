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
)

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
}

func (c *communicationsCache) invalidateUser(userID string) {
	if c == nil {
		return
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	prefix := userID + "\x1f"
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.folders, userID)
	for key := range c.messagePages {
		if strings.HasPrefix(key, prefix) {
			delete(c.messagePages, key)
		}
	}
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
	}, "\x1f")
}

func communicationsMessageCacheKey(userID, messageID string) string {
	userID = strings.TrimSpace(userID)
	messageID = strings.TrimSpace(messageID)
	if userID == "" || messageID == "" {
		return ""
	}
	return userID + "\x1f" + messageID
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
