package httpapi

import (
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestNylasEmailSourceUsesExactNativeMessageAndArrival(t *testing.T) {
	id := "AAkALgAAAAAAHYQDEapmEc2byACqAC-EWg0A+/="
	arrived := time.Date(2026, 9, 13, 21, 31, 0, 0, time.UTC)
	message := NylasMessage{ID: id, ThreadID: "unrelated-conversation", Date: arrived.Unix(), Body: "Factory milestone date: January 1, 2004"}
	source, err := resolveNylasEmailSource("microsoft", "person@example.com", message)
	if err != nil {
		t.Fatal(err)
	}
	if source.URL != "https://outlook.office.com/mail/deeplink/read/"+url.PathEscape(id) || !source.ArrivedAt.Equal(arrived) {
		t.Fatalf("incorrect source: %#v", source)
	}
}

func TestNylasEmailSourceRejectsUnverifiedLinksAndMissingMetadata(t *testing.T) {
	message := NylasMessage{ID: "AAkALgAAAAAAHYQDEapmEc2byACqAC", Date: 1789344660}
	for _, test := range []struct {
		name, provider, mailbox string
		message                 NylasMessage
	}{
		{"Gmail without permalink", "google", "person@gmail.com", NylasMessage{ID: "19aabcd123def987", ThreadID: "19aabcd123def123", Date: message.Date}},
		{"unsupported provider", "imap", "person@example.com", message},
		{"missing arrival", "microsoft", "person@example.com", NylasMessage{ID: message.ID}},
		{"invalid native ID", "microsoft", "person@example.com", NylasMessage{ID: "mango-internal-uuid", Date: message.Date}},
		{"internal UUID is not native", "microsoft", "person@example.com", NylasMessage{ID: "11111111-1111-4111-8111-111111111111", Date: message.Date}},
		{"oversized native ID", "microsoft", "person@example.com", NylasMessage{ID: strings.Repeat("A", 2049), Date: message.Date}},
		{"missing mailbox", "microsoft", "", message},
	} {
		t.Run(test.name, func(t *testing.T) {
			source, err := resolveNylasEmailSource(test.provider, test.mailbox, test.message)
			if err == nil || source.URL != "" || !source.ArrivedAt.IsZero() {
				t.Fatalf("invalid source accepted: %#v, %v", source, err)
			}
		})
	}
}
