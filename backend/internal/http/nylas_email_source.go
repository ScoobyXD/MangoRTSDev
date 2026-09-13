package httpapi

import (
	"errors"
	"net/mail"
	"net/url"
	"regexp"
	"time"
)

// NylasEmailSource is provider context, not a Mango resource identity or access
// grant. The caller must already authorize the exact company/mailbox/message.
type NylasEmailSource struct {
	URL       string    `json:"url"`
	ArrivedAt time.Time `json:"arrived_at"`
}

var microsoftNativeMessageID = regexp.MustCompile(`^[A-Za-z0-9_+/=-]+$`)
var uuidMessageID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Provider readiness can be shown before the user uploads a workbook. It is
// also checked at execution so an unsupported link cannot produce updates.
func ctrlLoopProviderError(provider string) string {
	switch provider {
	case "microsoft":
		return ""
	case "google":
		return "Gmail direct source links are unavailable through the connected Nylas API; a verified Gmail permalink is required before workbook updates"
	default:
		return "source email links are unavailable for this provider"
	}
}

func resolveNylasEmailSource(provider, mailbox string, message NylasMessage) (NylasEmailSource, error) {
	address, err := mail.ParseAddress(mailbox)
	if err != nil || address.Address != mailbox {
		return NylasEmailSource{}, errors.New("source email requires a valid connected mailbox address")
	}
	// The official Nylas SDK defines date as mail-server receipt time, explicitly
	// distinct from the unverified RFC Date header. Never use webhook/run time.
	// https://github.com/nylas/nylas-nodejs/blob/main/src/models/messages.ts
	if message.Date <= 0 || message.Date > 253402300799 {
		return NylasEmailSource{}, errors.New("source email arrival timestamp is unavailable")
	}
	var link string
	switch provider {
	case "microsoft":
		// Nylas v3 returns native Microsoft IDs. Keep their case and exact bytes;
		// do not use the conversation ID or convert immutable IDs ourselves.
		// https://developer.nylas.com/docs/dev-guide/best-practices/search/
		// Microsoft staff documents this exact-message route:
		// https://learn.microsoft.com/en-my/answers/questions/5508811/outlook-web-deeplink-retrieves-subject-of-email-bu
		if len(message.ID) < 20 || len(message.ID) > 2048 || !microsoftNativeMessageID.MatchString(message.ID) || uuidMessageID.MatchString(message.ID) {
			return NylasEmailSource{}, errors.New("source email Microsoft native message ID is unavailable")
		}
		link = "https://outlook.office.com/mail/deeplink/read/" + url.PathEscape(message.ID)
	case "google":
		// Gmail's REST API supplies hex IDs, not its opaque browser permalinks.
		// A legacy #all/<hex> URL is not reliable on a fresh browser load, and a
		// search URL does not meet CtrlLoop's direct-message-link requirement.
		// https://github.com/googleworkspace/cli/issues/858
		return NylasEmailSource{}, errors.New(ctrlLoopProviderError(provider))
	default:
		return NylasEmailSource{}, errors.New(ctrlLoopProviderError(provider))
	}
	return NylasEmailSource{URL: link, ArrivedAt: time.Unix(message.Date, 0).UTC()}, nil
}
