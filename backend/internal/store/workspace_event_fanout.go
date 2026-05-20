package store

import (
	"context"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"strings"
)

type WorkspaceEventNotification struct {
	CompanyID string `json:"company_id"`
	Sequence  int64  `json:"sequence"`
}

type WorkspaceEventFanout interface {
	NotifyWorkspaceEvent(ctx context.Context, event domain.DomainEvent) error
	ListenWorkspaceEvents(ctx context.Context, notify func(WorkspaceEventNotification)) error
}

func WorkspaceEventNotificationFromDomainEvent(event domain.DomainEvent) (WorkspaceEventNotification, bool) {
	companyID := strings.TrimSpace(event.CompanyID)
	if companyID == "" ||
		event.Sequence <= 0 ||
		strings.TrimSpace(event.StreamType) != workspaceDomainStreamType ||
		strings.TrimSpace(event.StreamID) != companyID {
		return WorkspaceEventNotification{}, false
	}
	return WorkspaceEventNotification{CompanyID: companyID, Sequence: event.Sequence}, true
}

func encodeWorkspaceEventNotification(notification WorkspaceEventNotification) (string, error) {
	notification.CompanyID = strings.TrimSpace(notification.CompanyID)
	if notification.CompanyID == "" || notification.Sequence <= 0 {
		return "", ErrInvalid
	}
	payload, err := json.Marshal(notification)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func decodeWorkspaceEventNotification(payload string) (WorkspaceEventNotification, bool) {
	var notification WorkspaceEventNotification
	if err := json.Unmarshal([]byte(payload), &notification); err != nil {
		return WorkspaceEventNotification{}, false
	}
	notification.CompanyID = strings.TrimSpace(notification.CompanyID)
	if notification.CompanyID == "" || notification.Sequence <= 0 {
		return WorkspaceEventNotification{}, false
	}
	return notification, true
}
