package store

import "strings"

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
