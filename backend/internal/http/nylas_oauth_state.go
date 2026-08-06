package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const nylasOAuthStateTTL = 10 * time.Minute

var (
	errInvalidNylasProvider = errors.New("invalid nylas provider")
	errInvalidNylasState    = errors.New("invalid nylas oauth state")
	errExpiredNylasState    = errors.New("expired nylas oauth state")
)

type nylasOAuthStatePayload struct {
	UserID                    string `json:"user_id"`
	Email                     string `json:"email"`
	UserEmail                 string `json:"user_email,omitempty"`
	Provider                  string `json:"provider"`
	StrictEmail               bool   `json:"strict_email,omitempty"`
	CompanyID                 string `json:"company_id,omitempty"`
	SharedInboxCompanyID      string `json:"shared_inbox_company_id,omitempty"`
	SharedInboxID             string `json:"shared_inbox_id,omitempty"`
	SharedInboxParentFolderID string `json:"shared_inbox_parent_folder_id,omitempty"`
	SharedInboxName           string `json:"shared_inbox_name,omitempty"`
	IssuedAt                  int64  `json:"issued_at"`
}

func signNylasOAuthState(secret string, payload nylasOAuthStatePayload, now time.Time) (string, error) {
	secret = strings.TrimSpace(secret)
	payload.UserID = strings.TrimSpace(payload.UserID)
	payload.Email = strings.TrimSpace(strings.ToLower(payload.Email))
	payload.UserEmail = strings.TrimSpace(strings.ToLower(payload.UserEmail))
	payload.Provider = normalizeCommunicationsProvider(payload.Provider)
	payload.CompanyID = strings.TrimSpace(payload.CompanyID)
	payload.SharedInboxCompanyID = strings.TrimSpace(payload.SharedInboxCompanyID)
	payload.SharedInboxID = strings.TrimSpace(payload.SharedInboxID)
	payload.SharedInboxParentFolderID = strings.TrimSpace(payload.SharedInboxParentFolderID)
	payload.SharedInboxName = strings.TrimSpace(payload.SharedInboxName)
	if secret == "" || payload.UserID == "" || payload.Email == "" || payload.Provider == "" {
		return "", errInvalidNylasState
	}
	if payload.SharedInboxCompanyID != "" && payload.SharedInboxID == "" && payload.SharedInboxName == "" {
		return "", errInvalidNylasState
	}
	payload.IssuedAt = now.UTC().Unix()
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	body := base64.RawURLEncoding.EncodeToString(raw)
	signature := signNylasOAuthStateBody(secret, body)
	return body + "." + signature, nil
}

func parseNylasOAuthState(secret, rawState string, now time.Time) (nylasOAuthStatePayload, error) {
	secret = strings.TrimSpace(secret)
	rawState = strings.TrimSpace(rawState)
	if secret == "" || rawState == "" {
		return nylasOAuthStatePayload{}, errInvalidNylasState
	}
	parts := strings.Split(rawState, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return nylasOAuthStatePayload{}, errInvalidNylasState
	}
	expected := signNylasOAuthStateBody(secret, parts[0])
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return nylasOAuthStatePayload{}, errInvalidNylasState
	}
	decoded, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nylasOAuthStatePayload{}, errInvalidNylasState
	}
	var payload nylasOAuthStatePayload
	if err := json.Unmarshal(decoded, &payload); err != nil {
		return nylasOAuthStatePayload{}, errInvalidNylasState
	}
	payload.UserID = strings.TrimSpace(payload.UserID)
	payload.Email = strings.TrimSpace(strings.ToLower(payload.Email))
	payload.UserEmail = strings.TrimSpace(strings.ToLower(payload.UserEmail))
	payload.Provider = normalizeCommunicationsProvider(payload.Provider)
	payload.CompanyID = strings.TrimSpace(payload.CompanyID)
	payload.SharedInboxCompanyID = strings.TrimSpace(payload.SharedInboxCompanyID)
	payload.SharedInboxID = strings.TrimSpace(payload.SharedInboxID)
	payload.SharedInboxParentFolderID = strings.TrimSpace(payload.SharedInboxParentFolderID)
	payload.SharedInboxName = strings.TrimSpace(payload.SharedInboxName)
	if payload.UserID == "" || payload.Email == "" || payload.Provider == "" || payload.IssuedAt <= 0 {
		return nylasOAuthStatePayload{}, errInvalidNylasState
	}
	if payload.SharedInboxCompanyID != "" && payload.SharedInboxID == "" && payload.SharedInboxName == "" {
		return nylasOAuthStatePayload{}, errInvalidNylasState
	}
	issued := time.Unix(payload.IssuedAt, 0).UTC()
	if now.UTC().Before(issued.Add(-time.Minute)) || now.UTC().After(issued.Add(nylasOAuthStateTTL)) {
		return nylasOAuthStatePayload{}, errExpiredNylasState
	}
	return payload, nil
}

func signNylasOAuthStateBody(secret, body string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(body))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func normalizeCommunicationsProvider(provider string) string {
	switch strings.TrimSpace(strings.ToLower(provider)) {
	case "google", "gmail":
		return "google"
	case "microsoft", "outlook", "office365":
		return "microsoft"
	default:
		return ""
	}
}
