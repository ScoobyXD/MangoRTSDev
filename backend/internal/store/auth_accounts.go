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
