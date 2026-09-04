package store

import (
	"strings"

	"miraeopus/backend/internal/domain"
)

func authoritativeAuthDisplayName(displayName, email string) string {
	displayName = strings.TrimSpace(displayName)
	if displayName == "" {
		return ""
	}
	if normalizeEmail(displayName) == normalizeEmail(email) {
		return ""
	}
	if strings.Contains(displayName, "@") {
		return ""
	}
	return displayName
}

func authInsertDisplayName(cognitoSubject, email, displayName string) string {
	if authoritative := authoritativeAuthDisplayName(displayName, email); authoritative != "" {
		return authoritative
	}
	if email := normalizeEmail(email); email != "" {
		return email
	}
	return strings.TrimSpace(cognitoSubject)
}

func authUserNeedsClaimRefresh(user domain.User, email, displayName string) bool {
	if normalizedEmail := normalizeEmail(email); normalizedEmail != "" && normalizedEmail != normalizeEmail(user.Email) {
		return true
	}
	authoritativeDisplayName := authoritativeAuthDisplayName(displayName, email)
	return authoritativeDisplayName != "" && authoritativeDisplayName != user.DisplayName
}
