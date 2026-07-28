package httpapi

import (
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEditorOwnerTextLimitHTTPMessage(t *testing.T) {
	for name, write := range map[string]func(http.ResponseWriter){
		"json":    func(w http.ResponseWriter) { writeEditorJSONStoreError(w, store.ErrEditorOwnerTextLimit) },
		"node-v2": func(w http.ResponseWriter) { writeNodeV2StoreError(w, store.ErrEditorOwnerTextLimit) },
	} {
		t.Run(name, func(t *testing.T) {
			response := httptest.NewRecorder()
			write(response)
			if response.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			body := response.Body.String()
			for _, required := range []string{
				"editor_owner_text_limit_exceeded",
				"1 GB editor-text limit",
				"Attachments are separate and do not count",
			} {
				if !strings.Contains(body, required) {
					t.Errorf("body missing %q: %s", required, body)
				}
			}
		})
	}
}
