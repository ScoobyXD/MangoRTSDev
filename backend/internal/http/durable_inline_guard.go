package httpapi

import (
	"errors"
	"miraeopus/backend/internal/attachments/migration"
	"net/http"
	"strings"
)

var errDurableInlineFileBytes = errors.New("durable inline file bytes are not allowed")

func validateDurablePayloadNoInlineFileBytes(surface, payload string) error {
	payload = strings.TrimSpace(payload)
	if payload == "" {
		return nil
	}
	result := migration.ScanPayload(migration.PayloadLocation{
		Table:    strings.TrimSpace(surface),
		Column:   "payload",
		SourcePK: "request",
	}, payload, migration.ScanOptions{})
	if result.HasDurableInlineFileBytes() {
		return errDurableInlineFileBytes
	}
	return nil
}

func rejectDurableInlineFileBytes(w http.ResponseWriter, surface, payload string) bool {
	if err := validateDurablePayloadNoInlineFileBytes(surface, payload); err != nil {
		writeError(w, http.StatusBadRequest, "inline_file_bytes_not_allowed")
		return true
	}
	return false
}

func rejectAnyDurableInlineFileBytes(w http.ResponseWriter, surface string, payloads []string) bool {
	for _, payload := range payloads {
		if rejectDurableInlineFileBytes(w, surface, payload) {
			return true
		}
	}
	return false
}
