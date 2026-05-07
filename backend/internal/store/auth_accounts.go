package store

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"math/big"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

const DefaultInvitationTTL = 7 * 24 * time.Hour
const DefaultPasswordResetTTL = 5 * time.Minute

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

func normalizeResourceType(resourceType string) (string, bool) {
	resourceType = strings.TrimSpace(resourceType)
	return resourceType, domain.IsValidResourceType(resourceType)
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

func newPasswordResetCode() (string, string, string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", "", "", err
	}
	code := fmt.Sprintf("%06d", value.Int64())
	saltBytes := make([]byte, 16)
	if _, err := rand.Read(saltBytes); err != nil {
		return "", "", "", err
	}
	salt := base64.RawURLEncoding.EncodeToString(saltBytes)
	return code, salt, passwordResetCodeHash(salt, code), nil
}

func passwordResetCodeHash(salt, code string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(salt) + ":" + strings.TrimSpace(code)))
	return hex.EncodeToString(sum[:])
}
