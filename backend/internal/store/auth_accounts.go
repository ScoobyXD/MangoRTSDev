package store

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

const DefaultInvitationTTL = 7 * 24 * time.Hour

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func normalizeRole(role string) (string, bool) {
	normalized := domain.NormalizeRole(role)
	return normalized, normalized != ""
}

func normalizeInvitableRole(role string) (string, bool) {
	normalized := domain.NormalizeRole(role)
	if normalized == domain.RoleDevAdmin || normalized == "" {
		return "", false
	}
	return normalized, true
}

func normalizeInvitationCognitoStatus(status string) string {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case "", "not_started":
		return "not_started"
	case "not_configured":
		return "not_configured"
	case "created":
		return "created"
	case "resent":
		return "resent"
	case "existing_mango_user":
		return "existing_mango_user"
	case "failed":
		return "failed"
	default:
		return ""
	}
}

func normalizeInvitationEmailStatus(status string) string {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case "", "not_started":
		return "not_started"
	case "not_configured":
		return "not_configured"
	case "sent":
		return "sent"
	case "failed":
		return "failed"
	default:
		return ""
	}
}

func googleConnectionStatus(connection domain.UserEmailConnection) string {
	if strings.TrimSpace(strings.ToLower(connection.Provider)) != "google" {
		return "not_connected"
	}
	switch normalizeEmailConnectionStatus(connection.Status) {
	case "connected":
		return "connected"
	case "reauth_required":
		return "reauth_required"
	default:
		return "not_connected"
	}
}

func newInvitationToken() (string, string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	return token, invitationTokenHash(token), nil
}

func invitationTokenHash(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:])
}

func invitationAvailabilityError(invitation domain.Invitation, now time.Time) error {
	switch invitation.Status {
	case domain.InvitationStatusPending:
		if now.UTC().After(invitation.ExpiresTimestamp) {
			return ErrInvitationExpired
		}
		return nil
	case domain.InvitationStatusAccepted:
		return ErrInvitationAlreadyAccepted
	case domain.InvitationStatusRevoked:
		return ErrInvitationReplaced
	default:
		return ErrInvitationBadToken
	}
}
