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

// An empty URL means the worker must link to Mango's exact stored email view.
// The source timestamp remains required regardless of where the email opens.
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
		if len(message.ID) >= 20 && len(message.ID) <= 2048 && microsoftNativeMessageID.MatchString(message.ID) && !uuidMessageID.MatchString(message.ID) {
			link = "https://outlook.office.com/mail/deeplink/read/" + url.PathEscape(message.ID)
		}
	case "google":
		// Gmail supplies no verified browser permalink through this integration.
		// The worker uses the already-stored exact message's Mango popup instead.
	default:
		return NylasEmailSource{}, errors.New("source email provider is unsupported")
	}
	return NylasEmailSource{URL: link, ArrivedAt: time.Unix(message.Date, 0).UTC()}, nil
}
