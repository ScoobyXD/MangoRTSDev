package store

import (
	"context"
	"sort"
	"strconv"
)

func (r *MemoryRepo) UpsertAIChat(ctx context.Context, chat AIChat) (AIChat, error) {
	chat, err := normalizeAIChat(chat)
	if err != nil {
		return AIChat{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return AIChat{}, err
	}
	if err := r.aiMemberLocked(chat.CompanyID, chat.UserID); err != nil {
		return AIChat{}, err
	}
	id := aiScopeKey(chat.CompanyID, chat.UserID, chat.ChatID)
	if existing, ok := r.aiChats[id]; ok {
		chat.CreatedAt = existing.CreatedAt
	}
	r.aiChats[id] = chat
	return chat, nil
}

func (r *MemoryRepo) GetAIChat(ctx context.Context, companyID, userID, chatID string) (AIChat, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if err := ctx.Err(); err != nil {
		return AIChat{}, err
	}
	if err := r.aiMemberLocked(companyID, userID); err != nil {
		return AIChat{}, err
	}
	chat, ok := r.aiChats[aiScopeKey(companyID, userID, chatID)]
	if !ok {
		return AIChat{}, ErrNotFound
	}
	return chat, nil
}

func (r *MemoryRepo) ListAIChats(ctx context.Context, companyID, userID string, limit, offset int) ([]AIChat, error) {
	if !aiValidPage(limit, offset) {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := r.aiMemberLocked(companyID, userID); err != nil {
		return nil, err
	}
	chats := []AIChat{}
	for _, chat := range r.aiChats {
		if chat.CompanyID == companyID && chat.UserID == userID {
			chats = append(chats, chat)
		}
	}
	sort.Slice(chats, func(i, j int) bool {
		if chats[i].CreatedAt.Equal(chats[j].CreatedAt) {
			return chats[i].ChatID > chats[j].ChatID
		}
		return chats[i].CreatedAt.After(chats[j].CreatedAt)
	})
	if offset >= len(chats) {
		return []AIChat{}, nil
	}
	return chats[offset:min(offset+limit, len(chats))], nil
}

func (r *MemoryRepo) ImportAIMessages(ctx context.Context, companyID, userID string, messages []AIMessage) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := r.aiMemberLocked(companyID, userID); err != nil {
		return err
	}
	updates := map[string]AIMessage{}
	for _, input := range messages {
		message, err := normalizeAIMessage(companyID, userID, input)
		if err != nil {
			return err
		}
		if _, ok := r.aiChats[aiScopeKey(companyID, userID, message.ChatID)]; !ok {
			return ErrNotFound
		}
		if message.RunID != "" {
			run, err := r.aiRunLocked(companyID, userID, message.RunID)
			if err != nil {
				return err
			}
			if run.ChatID != message.ChatID {
				return ErrConflict
			}
		}
		id := aiScopeKey(companyID, userID, strconv.FormatInt(message.MessageID, 10))
		saved, exists := updates[id]
		if !exists {
			saved, exists = r.aiMessages[id]
		}
		if exists {
			message, err = mergeAIMessage(saved, message)
			if err != nil {
				return err
			}
		}
		updates[id] = message
	}
	for id, message := range updates {
		r.aiMessages[id] = message
	}
	return nil
}

func (r *MemoryRepo) ListAIMessages(ctx context.Context, companyID, userID, chatID string, limit, offset int) ([]AIMessage, error) {
	if !aiValidPage(limit, offset) {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := r.aiMemberLocked(companyID, userID); err != nil {
		return nil, err
	}
	if _, ok := r.aiChats[aiScopeKey(companyID, userID, chatID)]; !ok {
		return nil, ErrNotFound
	}
	messages := []AIMessage{}
	for _, message := range r.aiMessages {
		if message.CompanyID == companyID && message.UserID == userID && message.ChatID == chatID {
			messages = append(messages, message)
		}
	}
	sort.Slice(messages, func(i, j int) bool { return messages[i].MessageID > messages[j].MessageID })
	if offset >= len(messages) {
		return []AIMessage{}, nil
	}
	messages = messages[offset:min(offset+limit, len(messages))]
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}
	return messages, nil
}

func (r *MemoryRepo) PruneAIMessages(ctx context.Context, companyID, userID, chatID string, keepIDs []int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := r.aiMemberLocked(companyID, userID); err != nil {
		return err
	}
	if _, ok := r.aiChats[aiScopeKey(companyID, userID, chatID)]; !ok {
		return ErrNotFound
	}
	keep := make(map[int64]bool, len(keepIDs))
	for _, id := range keepIDs {
		if id <= 0 || keep[id] {
			return ErrInvalid
		}
		message, ok := r.aiMessages[aiScopeKey(companyID, userID, strconv.FormatInt(id, 10))]
		if !ok || message.ChatID != chatID {
			return ErrConflict
		}
		keep[id] = true
	}
	for id, message := range r.aiMessages {
		if message.CompanyID == companyID && message.UserID == userID && message.ChatID == chatID && !keep[message.MessageID] {
			delete(r.aiMessages, id)
		}
	}
	return nil
}
