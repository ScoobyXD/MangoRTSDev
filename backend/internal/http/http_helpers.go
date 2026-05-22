package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	if w.Header().Get("Cache-Control") == "" {
		w.Header().Set("Cache-Control", "no-store")
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeJSONMaybeNotModified(w http.ResponseWriter, r *http.Request, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_encode_json")
		return
	}
	writeJSONBodyWithETag(w, r, status, body, strongETagFromBytes(body))
}

func writeJSONWithPrecomputedETag(w http.ResponseWriter, r *http.Request, status int, v any, etag string) {
	if writeNotModifiedWithETag(w, r, etag) {
		return
	}
	body, err := json.Marshal(v)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_encode_json")
		return
	}
	writeJSONBodyWithETag(w, r, status, body, etag)
}

func writeNotModifiedWithETag(w http.ResponseWriter, r *http.Request, etag string) bool {
	if strings.TrimSpace(etag) == "" || !requestETagMatches(r, etag) {
		return false
	}
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	w.WriteHeader(http.StatusNotModified)
	return true
}

func writeJSONBodyWithETag(w http.ResponseWriter, r *http.Request, status int, body []byte, etag string) {
	if strings.TrimSpace(etag) == "" {
		etag = strongETagFromBytes(body)
	}
	if writeNotModifiedWithETag(w, r, etag) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	w.WriteHeader(status)
	_, _ = w.Write(append(bytes.Clone(body), '\n'))
}

func strongETagFromBytes(body []byte) string {
	sum := sha256.Sum256(body)
	return `"` + hex.EncodeToString(sum[:]) + `"`
}

func strongETagFromString(value string) string {
	return strongETagFromBytes([]byte(value))
}

func requestETagMatches(r *http.Request, etag string) bool {
	for _, raw := range strings.Split(r.Header.Get("If-None-Match"), ",") {
		candidate := strings.TrimSpace(raw)
		if candidate == "*" || candidate == etag {
			return true
		}
	}
	return false
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func writeErrorMessage(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": code, "message": message})
}
