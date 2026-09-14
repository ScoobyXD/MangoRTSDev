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

func TestNylasEmailSourceRequiresStoredViewWhenProviderLinkUnavailable(t *testing.T) {
	for _, tc := range []struct{ provider, id string }{
		{"google", "19aabcd123def987"},
		{"microsoft", "mango-internal-uuid"},
		{"microsoft", "11111111-1111-4111-8111-111111111111"},
		{"microsoft", strings.Repeat("A", 2049)},
	} {
		source, err := resolveNylasEmailSource(tc.provider, "owner@example.com", NylasMessage{ID: tc.id, Date: 1789344660})
		if err != nil || source.URL != "" || source.ArrivedAt.Unix() != 1789344660 {
			t.Fatalf("missing provider link must retain arrival for stored view: %+v %v", source, err)
		}
	}
}

func TestNylasEmailSourceRejectsMissingMetadata(t *testing.T) {
	message := NylasMessage{ID: "AAkALgAAAAAAHYQDEapmEc2byACqAC", Date: 1789344660}
	for _, test := range []struct {
		name, provider, mailbox string
		message                 NylasMessage
	}{
		{"unsupported provider", "imap", "person@example.com", message},
		{"missing arrival", "microsoft", "person@example.com", NylasMessage{ID: message.ID}},
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
